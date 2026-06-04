"""api/routers/predict.py — /api/predict endpoint"""
from __future__ import annotations
import pickle
import sys
import warnings
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
warnings.filterwarnings("ignore")

from api.schemas import BorrowerInput, PredictResponse, LenderResult, ShapRow, LimeRow, RuleDetail, WeightExplanation
from src.features.engineering import engineer_features, load_raw
from src.models.lender_matcher import load_policies, compute_match_score, rank_lenders_meta

router = APIRouter()

MODELS_PATH      = Path("outputs/models/all_models.pkl")
BEST_MODEL_PATH  = Path("outputs/models/best_model.pkl")
META_PATH        = Path("outputs/models/meta_learner.pkl")
EXCEL_PATH       = "Capstone_Consol Sheet_22.05.2026.xlsx"

# ── module-level cache ──────────────────────────────────────────────────────────────────
_models = None
_features = None
_policies = None
_meta = None
_best_model_name: str | None = None
_approval_rate: float | None = None   # training-data approval rate → drives dynamic floor
_train_medians: dict | None = None    # per-feature training medians for NaN imputation
_score_percentiles: dict | None = None  # score distribution thresholds saved at train time


def _get_floor() -> float:
    """Return recommendation floor = max(1.5 × training approval rate, 0.05).
    Falls back to 0.12 if training stats not available yet."""
    if _approval_rate is not None:
        return max(round(_approval_rate * 1.5, 4), 0.05)
    return 0.12   # sensible default until first retrain


def clear_cache() -> None:
    global _models, _features, _policies, _meta, _best_model_name, _approval_rate, _train_medians, _score_percentiles
    _models = _features = _policies = _meta = _best_model_name = _approval_rate = _train_medians = _score_percentiles = None


def _load_all():
    global _models, _features, _policies, _meta, _best_model_name, _approval_rate, _train_medians, _score_percentiles
    if _models is None:
        if not MODELS_PATH.exists():
            raise HTTPException(status_code=503, detail="No trained model found. Run /api/train first.")
        with open(MODELS_PATH, "rb") as f:
            saved = pickle.load(f)
        _models   = saved["models"]
        _features = saved["features"]
        # Load the best-model name, training approval rate and feature medians saved by trainer.py
        if BEST_MODEL_PATH.exists():
            with open(BEST_MODEL_PATH, "rb") as f:
                best_saved = pickle.load(f)
            _best_model_name = best_saved.get("name")
            _approval_rate   = best_saved.get("approval_rate")
            _train_medians   = best_saved.get("train_medians")
            _score_percentiles = best_saved.get("score_percentiles")  # may be None for older pkl
        else:
            _best_model_name = None
            _approval_rate   = None
            _train_medians   = None
            _score_percentiles = None
    if _policies is None:
        _policies = load_policies(EXCEL_PATH, sheet_name="Lender policy")
    if _meta is None and META_PATH.exists():
        with open(META_PATH, "rb") as f:
            _meta = pickle.load(f)
    return _models, _features, _policies, _meta


def _borrower_to_df(b: BorrowerInput) -> pd.DataFrame:
    return pd.DataFrame([{
        "company_name":                           b.company_name or "DEMO",
        "product_name":                           b.product_name,
        "location":                               b.location,
        "Loan Amount Min":                        b.loan_min,
        "Loan Amount Max":                        b.loan_max,
        "Tenor Min": max(1, round(b.tenor_min / 12)), "Tenor Max": max(3, round(b.tenor_max / 12)),
        "Rate of interest Min": 11, "Rate of interest Max": 18,
        "Type of Entity":                         b.entity_type,
        "Vintage (in months)":                    b.vintage,
        # Industry and Pincode are not collected from the user.
        # Leave as NaN — feature engineering will impute with the training-data mean,
        # which is far less biasing than a single hardcoded value.
        "Age of applicant":                       b.age_app,
        "CIBIL Score":                            b.cibil,
        "Total number of active accounts":        max(1, b.overdue_count + 2),  # at least 2; rises with overdue accounts
        "Count of Overdue Accounts":              b.overdue_count,
        "Total Overdue Amount":                   b.overdue_amount,
        "New sanction in the last 30 days":       b.ns30,
        "New sanction in the last 90 days":       b.ns30,
        "enquiry_last7days":                      min(b.enq30, 2),
        "enquiry_last30days":                     b.enq30,
        "cnt_dpd_0plus_last_12mo":                b.dpd90,
        "cnt_dpd_90plus_last_12mo":               b.dpd90,
        "Suit Filed Count of Loans":              b.suit_filed,
        "Owned/Rented Property":                  b.owned,
        "Net Sales":                              b.net_sales,
        "Profit After Tax":                       b.pat,
        "Tangible Networth (TNW)":                b.tnw,
        "TOL/ TNW":                               b.tol_tnw,
        "Current Ratio":                          b.current_ratio,
        "DSCR (Avg/Min)":                         b.dscr,
        "Total Amount of Credit Transactions":    b.net_sales * 1.5,
        "Total Amount of Debit Transactions":     int(b.net_sales * 1.2),
        "Average EOD Balance":                    b.net_sales * 0.05,
        "Total Number of Inward cheque bounces":  b.inward_bounces,
        "Total Number of Outward cheque bounces": b.outward_bounces,
        "GST Filing in the past 3 months":        b.gst3,
        "GST Filing in the past 6 months":        b.gst6,
    }])


def _score_rank(p_approved: float) -> tuple[int | None, str | None]:
    """Return (percentile_rank, credit_tier) using training score distribution.
    Falls back to approval-rate-based tiers if percentile data not yet available."""
    tier: str
    pct: int | None = None
    if _score_percentiles:
        # Find which percentile bucket the score falls into
        thresholds = sorted((int(k), v) for k, v in _score_percentiles.items())
        pct = 0
        for rank, threshold in thresholds:
            if p_approved >= threshold:
                pct = rank
        tier_map = [
            (90, "Exceptional — top 10%"),
            (75, "Strong — top 25%"),
            (50, "Good — above median"),
            (25, "Moderate — below median"),
            (0,  "Marginal — lower quartile"),
        ]
        tier = next(label for cutoff, label in tier_map if pct >= cutoff)
    else:
        # Fallback: tier based on multiples of approval rate
        ar = _approval_rate or 0.0864
        ratio = p_approved / ar if ar > 0 else 0
        if ratio >= 5:
            tier = "Exceptional — 5× avg approval rate"
        elif ratio >= 3:
            tier = "Strong — 3–5× avg approval rate"
        elif ratio >= 2:
            tier = "Good — 2–3× avg approval rate"
        elif ratio >= 1.5:
            tier = "Marginal — just above floor"
        else:
            tier = "Below Threshold"
    return pct, tier


def _predict_proba(models, features, df: pd.DataFrame) -> float:
    """Use the best model selected during training; fall back to mean of all models."""
    X = engineer_features(df)
    for col in features:
        if col not in X.columns:
            X[col] = _train_medians.get(col, 0) if _train_medians else 0
        elif X[col].isna().any() and _train_medians:
            X[col] = X[col].fillna(_train_medians.get(col, 0))
    X = X[features]
    # Use the model that won the ROC-AUC comparison during training
    if _best_model_name and _best_model_name in models:
        try:
            return float(models[_best_model_name].predict_proba(X)[:, 1][0])
        except Exception:
            pass
    # Fallback: mean of all available models
    probas = []
    for model in models.values():
        try:
            probas.append(model.predict_proba(X)[:, 1][0])
        except Exception:
            pass
    return float(np.mean(probas)) if probas else 0.5


def _all_model_scores(models, features, df: pd.DataFrame) -> dict[str, float]:
    """Return per-model approval probabilities for comparison display."""
    X = engineer_features(df)
    for col in features:
        if col not in X.columns:
            X[col] = _train_medians.get(col, 0) if _train_medians else 0
        elif X[col].isna().any() and _train_medians:
            X[col] = X[col].fillna(_train_medians.get(col, 0))
    X = X[features]
    scores: dict[str, float] = {}
    for name, model in models.items():
        try:
            scores[name] = round(float(model.predict_proba(X)[:, 1][0]), 4)
        except Exception:
            pass
    return scores


def _shap_explanation(
    models, features, df: pd.DataFrame,
    champion_name: str | None = None,
) -> Optional[list[ShapRow]]:
    try:
        import shap
        X = engineer_features(df)
        for col in features:
            if col not in X.columns:
                X[col] = _train_medians.get(col, 0) if _train_medians else 0
            elif X[col].isna().any() and _train_medians:
                X[col] = X[col].fillna(_train_medians.get(col, 0))
        X = X[features]
        # Use only the champion model so SHAP explains the actual prediction
        if champion_name and champion_name in models:
            models_for_shap = {champion_name: models[champion_name]}
        else:
            models_for_shap = models
        shap_rows = []
        for name, model in models_for_shap.items():
            try:
                est = model
                if hasattr(est, "calibrated_classifiers_"):
                    est = est.calibrated_classifiers_[0].estimator
                if hasattr(est, "named_steps"):
                    est = list(est.named_steps.values())[-1]
                n_feat = len(features)
                if hasattr(est, "feature_importances_"):
                    explainer = shap.TreeExplainer(est)
                    sv = explainer.shap_values(X)
                    if isinstance(sv, list):
                        sv = sv[1]
                    row = sv[0].ravel()          # signed — positive = pushes toward approval
                    if row.shape[0] == n_feat:
                        shap_rows.append(row)
                elif hasattr(est, "coef_"):
                    # LR coef_ is on SCALED features — multiply by scaled values
                    # so that features at value=0 (e.g. has_overdue=0) don't show as large negatives
                    pipe = model
                    if hasattr(pipe, "calibrated_classifiers_"):
                        pipe = pipe.calibrated_classifiers_[0].estimator
                    X_lr = X.copy()
                    if hasattr(pipe, "named_steps"):
                        for _step_name, _step_obj in pipe.named_steps.items():
                            if _step_obj is est:
                                break
                            if hasattr(_step_obj, "transform"):
                                try:
                                    X_lr = pd.DataFrame(
                                        _step_obj.transform(X_lr),
                                        columns=X_lr.columns,
                                    )
                                except Exception:
                                    pass
                    coef = est.coef_[0].ravel() * X_lr.iloc[0].values
                    if coef.shape[0] == n_feat:
                        shap_rows.append(coef)
            except Exception:
                continue
        if not shap_rows:
            return None
        n = len(features)
        shap_rows = [r for r in shap_rows if len(r) == n]
        if not shap_rows:
            return None
        mean_shap = np.mean(np.vstack(shap_rows), axis=0)
        df_shap = pd.DataFrame({"feature": features, "importance": mean_shap})
        # Drop zero-valued one-hot dummy features (unselected categories add confusion, not insight)
        _ONEHOT_PREFIXES = (
            "product_name_", "location_", "Type of Entity_",
            "Owned/Rented Property_", "GST Filing",
        )
        feat_vals = X.iloc[0]
        def _is_zero_onehot(feat: str) -> bool:
            return any(feat.startswith(p) for p in _ONEHOT_PREFIXES) and feat_vals.get(feat, 1) == 0
        df_shap = df_shap[~df_shap["feature"].map(_is_zero_onehot)]
        # Sort by absolute magnitude — keep sign for directional coloring
        df_shap_sorted = df_shap.reindex(df_shap["importance"].abs().sort_values(ascending=False).index)
        top_features = set(df_shap_sorted.head(15)["feature"].tolist())

        # Guarantee every direct user-input field appears regardless of SHAP rank
        _USER_INPUT_FEATURES = (
            "CIBIL Score",
            "log_Net_Sales",
            "cnt_dpd_90plus_last_12mo",
            "Vintage (in months)",
            "log_Profit_After_Tax",
            "log_Tangible_Networth_(TNW)",
            "DSCR (Avg/Min)",
            "Current Ratio",
            "TOL/ TNW",
            "total_bounces",
            "enquiry_last30days",
            "has_overdue",
            "Suit Filed Count of Loans",
            "New sanction in the last 90 days",
            "Age of applicant",
        )
        # Pick missing user-input features sorted by abs SHAP, append after top-15
        missing = df_shap_sorted[
            df_shap_sorted["feature"].isin(_USER_INPUT_FEATURES) &
            ~df_shap_sorted["feature"].isin(top_features)
        ]
        combined = pd.concat([df_shap_sorted.head(15), missing]).drop_duplicates("feature")
        return [ShapRow(feature=r.feature, importance=float(r.importance)) for _, r in combined.iterrows()]
    except Exception:
        return None


def _lime_explanation(models, features, borrower_df: pd.DataFrame) -> Optional[list[LimeRow]]:
    try:
        from lime import lime_tabular
        raw = load_raw()
        X_bg = engineer_features(raw)
        for col in features:
            if col not in X_bg.columns:
                X_bg[col] = _train_medians.get(col, 0) if _train_medians else 0
        X_bg = X_bg[features].fillna(0).values

        X_inst = engineer_features(borrower_df)
        for col in features:
            if col not in X_inst.columns:
                X_inst[col] = _train_medians.get(col, 0) if _train_medians else 0
        X_inst = X_inst[features].fillna(0).values

        def _predict_fn(arr):
            df_arr = pd.DataFrame(arr, columns=features)
            probas = []
            for model in models.values():
                try:
                    probas.append(model.predict_proba(df_arr)[:, 1])
                except Exception:
                    continue
            if not probas:
                return np.column_stack([np.full(len(arr), 0.5), np.full(len(arr), 0.5)])
            avg = np.mean(probas, axis=0)
            return np.column_stack([1 - avg, avg])

        explainer = lime_tabular.LimeTabularExplainer(
            X_bg, feature_names=list(features), mode="classification",
            discretize_continuous=True, random_state=42,
        )
        exp = explainer.explain_instance(X_inst[0], _predict_fn, num_features=15,
                                         num_samples=100, labels=(1,))
        weights = exp.as_list(label=1)
        result = pd.DataFrame(weights, columns=["condition", "weight"])
        result = result.sort_values("weight", key=abs, ascending=False)
        return [LimeRow(condition=r.condition, weight=float(r.weight)) for _, r in result.iterrows()]
    except Exception:
        return None


def _layman_bullets(shap_rows: list[ShapRow], borrower: BorrowerInput) -> list[str]:
    feats = [r.feature.lower() for r in shap_rows]
    # Build lookup: feature name → importance (negative = hurts score)
    importance_map = {r.feature.lower(): r.importance for r in shap_rows}

    def _in(kw):
        return any(kw in f for f in feats)

    bullets = []
    mapped_features: set[str] = set()   # track which features got a bullet

    if _in("cibil"):
        v = borrower.cibil
        tag = ("Excellent — strongest asset for approval." if v >= 720
               else "Good, but some lenders require ≥ 720." if v >= 680
               else "Low — improving your CIBIL score has the highest single payoff.")
        icon = "🟢" if v >= 720 else ("🟡" if v >= 680 else "🔴")
        bullets.append(f"{icon} **Credit Score (CIBIL): {v}** — {tag}")
        mapped_features.update(f for f in feats if "cibil" in f)

    if _in("dscr"):
        v = borrower.dscr
        tag = ("Business earns enough cash to repay comfortably (≥ 1.25)." if v >= 1.25
               else "Borderline — just about enough; lenders prefer ≥ 1.25." if v >= 1.0
               else "Business may not generate enough cash to meet repayments.")
        icon = "🟢" if v >= 1.25 else ("🟡" if v >= 1.0 else "🔴")
        bullets.append(f"{icon} **Repayment Capacity (DSCR): {v:.2f}** — {tag}")
        mapped_features.update(f for f in feats if "dscr" in f)

    if _in("dpd_90") or _in("cnt_dpd"):
        v = borrower.dpd90
        icon = "🟢" if v == 0 else "🔴"
        if v == 0:
            tag = "No missed EMIs in the last year — clean track record."
        elif v == 1:
            tag = ("1 instance of a 90+ day delay. Even a single DPD 90+ event is treated as a "
                   "hard disqualifier by most lenders and is the strongest negative predictor in "
                   "the model — strong CIBIL or DSCR cannot offset it. Wait for 12 months of "
                   "clean repayment history before reapplying.")
        else:
            tag = (f"{v} instances of 90+ day delays. This is the primary reason for the low ML "
                   "score — it overrides all positive signals (CIBIL, DSCR, revenue, etc.). "
                   "Most lenders hard-reject any application with DPD 90+ ≥ 1. "
                   "Resolve all overdue accounts and maintain 12 months of clean repayment before reapplying.")
        bullets.append(f"{icon} **Missed Payments (90+ days late): {v}** — {tag}")
        mapped_features.update(f for f in feats if "dpd" in f)

    if _in("overdue") or _in("has_overdue"):
        v = borrower.overdue_count
        icon = "🟢" if v == 0 else "🔴"
        tag = ("No outstanding dues." if v == 0
               else f"{v} account(s) with overdue — clear these before applying.")
        bullets.append(f"{icon} **Overdue Accounts: {v}** — {tag}")
        mapped_features.update(f for f in feats if "overdue" in f)

    if _in("suit"):
        v = borrower.suit_filed
        icon = "🟢" if v == 0 else "🔴"
        tag = ("No legal suits filed — clean record." if v == 0
               else f"{v} suit(s) filed against the borrower — almost always disqualifying.")
        bullets.append(f"{icon} **Legal Suits Filed: {v}** — {tag}")
        mapped_features.update(f for f in feats if "suit" in f)

    if _in("bounce") or _in("total_bounces"):
        inb, outb = borrower.inward_bounces, borrower.outward_bounces
        icon = "🟢" if inb == 0 and outb == 0 else "🔴"
        tag = ("No cheque bounces — clean banking record." if inb == 0 and outb == 0
               else f"{inb} inward + {outb} outward bounces — signals cash flow issues.")
        bullets.append(f"{icon} **Cheque Bounces: {inb} inward / {outb} outward** — {tag}")
        mapped_features.update(f for f in feats if "bounce" in f)

    if _in("enq") or _in("enquir"):
        v = borrower.enq30
        icon = "🟢" if v <= 2 else ("🟡" if v <= 4 else "🔴")
        tag = ("Normal enquiry activity." if v <= 2
               else "Elevated — suggests multiple simultaneous applications." if v <= 4
               else f"{v} enquiries in 30 days — high credit hunger, raises lender concern.")
        bullets.append(f"{icon} **Credit Enquiries (30 days): {v}** — {tag}")
        mapped_features.update(f for f in feats if "enq" in f)

    if _in("tol"):
        v = borrower.tol_tnw
        icon = "🟢" if v <= 1.5 else ("🟡" if v <= 2.0 else "🔴")
        tag = ("Low debt relative to business net worth." if v <= 1.5
               else "Moderate debt load." if v <= 2.0
               else "High debt versus net worth — lenders prefer below 1.5.")
        bullets.append(f"{icon} **Debt-to-Networth (TOL/TNW): {v:.1f}** — {tag}")
        mapped_features.update(f for f in feats if "tol" in f)

    if _in("current_ratio") or _in("current ratio"):
        v = borrower.current_ratio
        icon = "🟢" if v >= 1.33 else ("🟡" if v >= 1.0 else "🔴")
        tag = ("Healthy liquidity — business can meet short-term obligations." if v >= 1.33
               else "Adequate, but lenders prefer ≥ 1.33." if v >= 1.0
               else "Liquidity concern — current assets may not cover current liabilities.")
        bullets.append(f"{icon} **Liquidity (Current Ratio): {v:.2f}** — {tag}")
        mapped_features.update(f for f in feats if "current" in f)

    if _in("pat") or _in("profit"):
        v = borrower.pat
        v_lakh = v / 1e5
        icon = "🟢" if v > 0 else "🔴"
        tag = (f"₹{v_lakh:.1f}L profit — profitable business." if v > 0
               else "Business is loss-making — most lenders require consistent profitability.")
        bullets.append(f"{icon} **Profitability (PAT): ₹{v_lakh:.1f}L** — {tag}")
        mapped_features.update(f for f in feats if "pat" in f or "profit" in f)

    if _in("net_sales") or _in("loan_to_sales") or _in("sales"):
        v = borrower.net_sales / 1e5
        icon = "🟢" if borrower.net_sales >= 5_000_000 else "🟡"
        tag = (f"₹{v:.0f}L annual revenue — strong business scale." if borrower.net_sales >= 5_000_000
               else f"₹{v:.0f}L annual revenue — some lenders require higher turnover.")
        bullets.append(f"{icon} **Annual Revenue: ₹{v:.0f}L** — {tag}")
        mapped_features.update(f for f in feats if "sales" in f)

    if _in("vintage"):
        v = borrower.vintage
        age_str = f"{v // 12}y {v % 12}m" if v >= 12 else f"{v} months"
        icon = "🟢" if v >= 36 else "🟡"
        tag = ("Well-established business." if v >= 36 else "Some lenders require 3+ years.")
        bullets.append(f"{icon} **Business Age: {age_str}** — {tag}")
        mapped_features.update(f for f in feats if "vintage" in f)

    if _in("gst"):
        gst3 = borrower.gst3
        icon = "🟢" if "all" in gst3.lower() else "🟡"
        tag = ("Regular GST filing builds lender confidence." if "all" in gst3.lower()
               else "Irregular GST compliance raises doubts about business legitimacy.")
        bullets.append(f"{icon} **GST Compliance: {gst3}** — {tag}")
        mapped_features.update(f for f in feats if "gst" in f)

    if _in("age of applicant") or _in("age_of_applicant"):
        v = borrower.age_app
        icon = "🟢" if 30 <= v <= 55 else "🟡"
        tag = ("Prime working-age applicant — optimal for lenders." if 30 <= v <= 55
               else "Younger or older applicant — some lenders apply age caps.")
        bullets.append(f"{icon} **Applicant Age: {v}** — {tag}")
        mapped_features.update(f for f in feats if "age" in f)

    if _in("loan_to_sales"):
        loan_mid = (borrower.loan_min + borrower.loan_max) / 2
        ratio = loan_mid / borrower.net_sales if borrower.net_sales > 0 else 0
        icon = "🟢" if ratio <= 0.3 else ("🟡" if ratio <= 0.6 else "🔴")
        tag = (f"Loan-to-sales ratio {ratio:.1%} — conservative ask." if ratio <= 0.3
               else f"Ratio {ratio:.1%} — moderate; ensure revenue can service repayments." if ratio <= 0.6
               else f"Ratio {ratio:.1%} — loan amount is high relative to revenue.")
        bullets.append(f"{icon} **Loan vs Revenue Ratio: {ratio:.1%}** — {tag}")
        mapped_features.update(f for f in feats if "loan_to_sales" in f)
        mapped_features.update(f for f in feats if "gst" in f)

    # ── Handlers for selected categorical (one-hot) features ──
    # Product type
    for row in shap_rows:
        f = row.feature
        if not f.startswith("product_name_"):
            continue
        if f in mapped_features:
            continue
        product_label = f.replace("product_name_", "").replace("_", " ")
        icon = "🟢" if row.importance >= 0 else "🟡"
        if row.importance < 0:
            tag = (f"Unsecured products have lower historical approval rates than secured ones "
                   f"in this dataset. Adding collateral (LAP, machinery) would improve odds.")
        else:
            tag = f"This product type has historically strong approval rates."
        bullets.append(f"{icon} **Loan Product: {product_label}** — {tag}")
        mapped_features.add(f)
        break

    # Entity type
    for row in shap_rows:
        f = row.feature
        if not f.startswith("Type of Entity_"):
            continue
        if f in mapped_features:
            continue
        entity_label = f.replace("Type of Entity_", "")
        icon = "🟢" if row.importance >= 0 else "🟡"
        if "sole" in entity_label.lower():
            tag = ("Sole Proprietorships have lower approval rates in this dataset vs "
                   "Private Limited companies. Incorporating can improve access to credit.")
        elif row.importance < 0:
            tag = (f"{entity_label} entities score below the dataset average. "
                   f"This is a structural factor lenders use in risk profiling.")
        else:
            tag = f"{entity_label} — entity type is well-regarded by lenders."
        bullets.append(f"{icon} **Entity Type: {entity_label}** — {tag}")
        mapped_features.add(f)
        break

    # Property ownership
    for row in shap_rows:
        f = row.feature
        if not f.startswith("Owned/Rented Property_"):
            continue
        if f in mapped_features:
            continue
        prop_label = f.replace("Owned/Rented Property_", "")
        icon = "🟢" if "owned" in prop_label.lower() else "🟡"
        if "owned" in prop_label.lower():
            tag = ("Property ownership is a positive signal for secured loans. "
                   "For unsecured products, its impact on approval varies by lender.")
        else:
            tag = "Rented premises are accepted by most lenders but marginally less preferred."
        bullets.append(f"{icon} **Property: {prop_label}** — {tag}")
        mapped_features.add(f)
        break

    # ── Fallback: remaining unmapped negative SHAP features ──
    # Skip zero-valued one-hot dummies (already filtered at SHAP level, but guard here too)
    _SKIP_PREFIXES = ("product_name_", "location_", "Type of Entity_",
                      "Owned/Rented Property_", "GST Filing")
    for row in sorted(shap_rows, key=lambda r: r.importance):
        if row.importance >= 0:
            break
        fname = row.feature
        if fname.lower() in mapped_features:
            continue
        if any(fname.startswith(p) for p in _SKIP_PREFIXES):
            continue  # categorical one-hot — handled above or not relevant
        readable = fname.replace("_", " ").title()
        bullets.append(f"🔴 **{readable}** is pulling the score down (SHAP impact: {row.importance:.3f}). "
                        f"Review this metric against lender benchmarks.")

    return bullets[:13]


# ─────────────────────────────────────────────────────────────────────────────
# ENGINE 2 — per-lender rule justification
# ─────────────────────────────────────────────────────────────────────────────
_RULE_LABELS: dict[str, str] = {
    "loan_amount":    "Loan Amount",
    "cibil":          "CIBIL Score",
    "vintage":        "Business Vintage",
    "overdue":        "Overdue Accounts",
    "dpd90":          "DPD 90+ (last 12 mo)",
    "suit_filed":     "Suit Filed",
    "inward_bounce":  "Inward Cheque Bounces",
    "enquiries_30d":  "Enquiries (30 days)",
}


def _build_rule_details(
    match_row: pd.Series,
    borrower: BorrowerInput,
    policy_row: pd.Series,
    w1: float,
    w2: float,
) -> tuple[list[RuleDetail], list[str]]:
    """Build per-rule RuleDetail list and plain-English narrative bullets."""
    rule_scores: dict = match_row.get("rule_details") or {}
    eligible: bool = bool(match_row.get("eligible", False))
    details: list[RuleDetail] = []
    narratives: list[str] = []

    def _nv(series: pd.Series, *keys):
        for k in keys:
            if k in series.index:
                try:
                    v = float(series[k])
                    if not np.isnan(v):
                        return v
                except Exception:
                    pass
        return None

    # Loan amount
    p_loan_min = _nv(policy_row, "Loan Amount Min")
    p_loan_max = _nv(policy_row, "Loan Amount Max")
    b_loan     = borrower.loan_min
    if p_loan_min is not None:
        passed = b_loan >= p_loan_min and (p_loan_max is None or b_loan <= p_loan_max)
        hr = rule_scores.get("loan_amount", 0.5)
        rng = f"₹{p_loan_min/1e5:.0f}L–₹{p_loan_max/1e5:.0f}L" if p_loan_max else f"min ₹{p_loan_min/1e5:.0f}L"
        icon = "✅" if passed else "❌"
        details.append(RuleDetail(label="Loan Amount", passed=passed, borrower_value=b_loan,
                                   lender_min=p_loan_min, lender_max=p_loan_max, headroom=hr,
                                   narrative=f"{icon} Loan ₹{b_loan/1e5:.0f}L vs lender range {rng}"))
        narratives.append(f"{icon} Loan ₹{b_loan/1e5:.0f}L — lender range {rng}")

    # CIBIL
    p_cibil = _nv(policy_row, "CIBIL Score", "cibil")
    if p_cibil is not None:
        passed = borrower.cibil >= p_cibil
        hr = rule_scores.get("cibil", 0.5)
        icon = "✅" if passed else "❌"
        diff = borrower.cibil - p_cibil
        diff_str = f"+{diff:.0f}" if diff >= 0 else f"{diff:.0f}"
        details.append(RuleDetail(label="CIBIL Score", passed=passed, borrower_value=float(borrower.cibil),
                                   lender_min=p_cibil, headroom=hr,
                                   narrative=f"{icon} CIBIL {borrower.cibil} vs min {p_cibil:.0f} ({diff_str})"))
        narratives.append(f"{icon} CIBIL {borrower.cibil} vs min {p_cibil:.0f} ({diff_str})")

    # Vintage
    p_vintage = _nv(policy_row, "Vintage (in months)", "vintage")
    if p_vintage is not None:
        passed = borrower.vintage >= p_vintage
        hr = rule_scores.get("vintage", 0.5)
        icon = "✅" if passed else "❌"
        details.append(RuleDetail(label="Business Vintage", passed=passed, borrower_value=float(borrower.vintage),
                                   lender_min=p_vintage, headroom=hr,
                                   narrative=f"{icon} Vintage {borrower.vintage}mo vs min {p_vintage:.0f}mo"))
        narratives.append(f"{icon} Vintage {borrower.vintage}mo vs min {p_vintage:.0f}mo")

    # Overdue
    p_overdue = _nv(policy_row, "Count of Overdue Accounts")
    if p_overdue is not None:
        passed = borrower.overdue_count <= p_overdue
        hr = rule_scores.get("overdue", 0.5)
        icon = "✅" if passed else "❌"
        details.append(RuleDetail(label="Overdue Accounts", passed=passed, borrower_value=float(borrower.overdue_count),
                                   lender_max=p_overdue, headroom=hr,
                                   narrative=f"{icon} Overdue accounts {borrower.overdue_count} vs max {p_overdue:.0f}"))
        narratives.append(f"{icon} Overdue {borrower.overdue_count} vs max {p_overdue:.0f}")

    # DPD 90+
    p_dpd = _nv(policy_row, "cnt_dpd_90plus_last_12mo")
    if p_dpd is not None:
        passed = borrower.dpd90 <= p_dpd
        hr = rule_scores.get("dpd90", 0.5)
        icon = "✅" if passed else "❌"
        details.append(RuleDetail(label="DPD 90+ (last 12 mo)", passed=passed, borrower_value=float(borrower.dpd90),
                                   lender_max=p_dpd, headroom=hr,
                                   narrative=f"{icon} DPD90+ {borrower.dpd90} vs max {p_dpd:.0f}"))
        narratives.append(f"{icon} DPD90+ {borrower.dpd90} vs max {p_dpd:.0f}")

    # Suit filed
    p_suit = _nv(policy_row, "Suit Filed Count of Loans")
    if p_suit is not None:
        passed = borrower.suit_filed <= p_suit
        hr = rule_scores.get("suit_filed", 0.5)
        icon = "✅" if passed else "❌"
        details.append(RuleDetail(label="Suit Filed", passed=passed, borrower_value=float(borrower.suit_filed),
                                   lender_max=p_suit, headroom=hr,
                                   narrative=f"{icon} Suit filed {borrower.suit_filed} vs max {p_suit:.0f}"))
        narratives.append(f"{icon} Suit filed {borrower.suit_filed} vs max {p_suit:.0f}")

    # Inward bounces
    p_inward = _nv(policy_row, "Total Number of Inward cheque bounces", "inward")
    if p_inward is not None:
        passed = borrower.inward_bounces <= p_inward
        hr = rule_scores.get("inward_bounce", 0.5)
        icon = "✅" if passed else "❌"
        details.append(RuleDetail(label="Inward Cheque Bounces", passed=passed,
                                   borrower_value=float(borrower.inward_bounces),
                                   lender_max=p_inward, headroom=hr,
                                   narrative=f"{icon} Inward bounces {borrower.inward_bounces} vs max {p_inward:.0f}"))
        narratives.append(f"{icon} Inward bounces {borrower.inward_bounces} vs max {p_inward:.0f}")

    # Enquiries 30d
    p_enq = _nv(policy_row, "enquiry_last30days")
    if p_enq is not None:
        passed = borrower.enq30 <= p_enq
        hr = rule_scores.get("enquiries_30d", 0.5)
        icon = "✅" if passed else "❌"
        details.append(RuleDetail(label="Enquiries (30 days)", passed=passed,
                                   borrower_value=float(borrower.enq30),
                                   lender_max=p_enq, headroom=hr,
                                   narrative=f"{icon} Enquiries {borrower.enq30} vs max {p_enq:.0f}"))
        narratives.append(f"{icon} Enquiries {borrower.enq30} vs max {p_enq:.0f}")

    return details, narratives


def _weight_explanation(w1: float, w2: float, meta) -> WeightExplanation:
    if meta and "learned_w1" in meta:
        method = meta.get("method", "optimisation")
        auc_fixed   = meta.get("auc_fixed", None)
        auc_learned = meta.get("auc_learned", None)
        improvement = f" (+{(auc_learned - auc_fixed)*100:.2f} pp vs fixed 0.6/0.4)" if (auc_fixed and auc_learned) else ""
        how = (
            f"Dynamically learned via {method} on the training dataset{improvement}. "
            f"Both Logistic Regression meta-learner and scipy continuous optimisation were run; "
            f"the strategy with higher ROC-AUC was selected. "
            f"Retrain any time to update these weights with new data."
        )
    else:
        how = "Default fixed weights (0.6/0.4) — no meta-learner trained yet. Run training to learn optimal weights from your data."

    interp = (
        f"Every borrower–lender pair is scored as: "
        f"{w1:.2f} × P(ML-approved) + {w2:.2f} × PolicyMatchScore. "
        f"Engine 1 (ML) captures subtle non-linear credit patterns across {w1:.0%} of the score. "
        f"Engine 2 (Policy) captures hard lender eligibility constraints across {w2:.0%}. "
        f"A lender with MatchScore 1.0 but P(approved)=0.1 scores {w1*0.1+w2*1.0:.3f}, "
        f"while one with MatchScore 0.5 and P(approved)=0.8 scores {w1*0.8+w2*0.5:.3f}."
    )
    return WeightExplanation(
        w1=w1, w2=w2,
        formula=f"CombinedScore = {w1:.2f} × P(approved) + {w2:.2f} × MatchScore",
        how_weights_learned=how,
        interpretation=interp,
    )


# ─────────────────────────────────────────────────────────────────────────────
# SHARED PREDICT LOGIC
# ─────────────────────────────────────────────────────────────────────────────
def _run_predict(borrower: BorrowerInput) -> PredictResponse:
    models, features, policies, meta = _load_all()
    w1 = meta["learned_w1"] if meta else 0.6
    w2 = meta["learned_w2"] if meta else 0.4

    borrower_df  = _borrower_to_df(borrower)
    borrower_row = borrower_df.iloc[0]

    p_approved   = _predict_proba(models, features, borrower_df)
    model_scores = _all_model_scores(models, features, borrower_df)
    match_df   = compute_match_score(borrower_row, policies)
    floor_p    = _get_floor()
    top3_df    = rank_lenders_meta(p_approved, match_df, top_n=3, min_p=floor_p)

    eligible_count = int(match_df["eligible"].sum())
    avg_match = (
        match_df[match_df["eligible"]]["match_score"].mean()
        if eligible_count > 0 else 0.0
    )

    # Build policy_map: lender_name → policy row
    policy_map = {str(r.get("lender_name", "")): r for _, r in policies.iterrows()}

    # Build enriched Top 3
    top3: list[LenderResult] = []
    for i, (_, row) in enumerate(top3_df.iterrows()):
        lname = row["lender_name"]
        ms    = float(row.get("match_score", 0))
        cs    = float(row.get("combined_score", w1 * p_approved + w2 * ms))

        # find matching row in match_df for rule_details
        mrow = match_df[match_df["lender_name"] == lname]
        match_row = mrow.iloc[0] if not mrow.empty else pd.Series()

        policy_row = policy_map.get(lname, pd.Series())
        rule_details, rule_narratives = _build_rule_details(match_row, borrower, policy_row, w1, w2)

        top3.append(LenderResult(
            rank=i + 1,
            lender_name=lname,
            combined_score=round(cs, 4),
            p_approved=round(p_approved, 4),
            match_score=round(ms, 4),
            engine1_contribution=round(w1 * p_approved, 4),
            engine2_contribution=round(w2 * ms, 4),
            engine2_rules=rule_details,
            match_reasons=rule_narratives,
        ))

    all_lenders = (
        match_df[["lender_name", "eligible", "match_score"]]
        .assign(
            p_approved=round(p_approved, 4),
            combined_score=(w1 * p_approved + w2 * match_df["match_score"]).round(4),
            engine1_contribution=round(w1 * p_approved, 4),
            engine2_contribution=(w2 * match_df["match_score"]).round(4),
        )
        .sort_values("combined_score", ascending=False)
        .reset_index(drop=True)
        .to_dict("records")
    )

    shap_rows = _shap_explanation(models, features, borrower_df, champion_name=_best_model_name)
    lime_rows = _lime_explanation(models, features, borrower_df)
    bullets   = _layman_bullets(shap_rows, borrower) if shap_rows else None
    wt_expl   = _weight_explanation(w1, w2, meta)
    score_pct, credit_tier = _score_rank(p_approved)

    return PredictResponse(
        p_approved=round(p_approved, 4),
        primary_model=_best_model_name or "Ensemble",
        model_scores=model_scores,
        eligible_lenders=eligible_count,
        total_lenders=len(match_df),
        avg_match_score=round(float(avg_match), 4),
        w1=w1, w2=w2,
        weight_explanation=wt_expl,
        top3=top3,
        all_lenders=all_lenders,
        shap=shap_rows,
        lime=lime_rows,
        bullets=bullets,
        floor_p=round(floor_p, 4),
        score_percentile=score_pct,
        credit_tier=credit_tier,
        engine1_contribution=round(w1 * p_approved, 4),
        engine2_contribution=round(w2 * float(avg_match), 4),
    )


@router.post("/predict", response_model=PredictResponse)
def predict(borrower: BorrowerInput):
    return _run_predict(borrower)


@router.post("/match", response_model=PredictResponse,
             summary="Match lenders — all fields optional (POST body)",
             description=(
                 "Score a borrower against all lender policies. "
                 "Send a JSON body with any subset of BorrowerInput fields — "
                 "every field has a sensible default so `{}` is a valid request. "
                 "Returns Top 3 lenders with Engine-1 (ML) + Engine-2 (Policy) "
                 "breakdown, per-rule justifications, and dynamic weight explanation."
             ))
def match(borrower: BorrowerInput = BorrowerInput()):
    return _run_predict(borrower)


@router.get("/lenders", summary="All active lender policies",
            description="Returns every active lender with their policy thresholds (Engine 2 rules). Does NOT require a trained model.")
def get_lenders():
    """Load and expose all lender policy rows from the Lender policy sheet."""
    global _policies
    try:
        if _policies is None:
            _policies = load_policies(EXCEL_PATH, sheet_name="Lender policy")
        policies = _policies
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Cannot load lender policies: {exc}")

    def _nv(row, *keys):
        for k in keys:
            if k in row.index:
                try:
                    v = float(row[k])
                    if not np.isnan(v):
                        return v
                except Exception:
                    pass
        return None

    def _sv(row, *keys):
        for k in keys:
            if k in row.index:
                v = str(row[k]).strip()
                if v and v.lower() not in ("nan", "none", ""):
                    return v
        return None

    lenders = []
    for _, row in policies.iterrows():
        # Build a clean raw dict, skipping NaN/None
        raw: dict = {}
        for col in policies.columns:
            val = row[col]
            try:
                if isinstance(val, float) and np.isnan(val):
                    continue
            except Exception:
                pass
            if isinstance(val, float) and val == int(val):
                raw[col] = int(val)
            elif isinstance(val, (int, float)):
                raw[col] = round(float(val), 4)
            else:
                s = str(val).strip()
                if s and s.lower() not in ("nan", "none", ""):
                    raw[col] = s

        lenders.append({
            "lender_name":        str(row.get("lender_name", "Unknown")),
            "product_name":       _sv(row, "product_name", "Product Name", "Product"),
            "entity_types":       _sv(row, "Type of Entity", "entity_type", "Entity Type"),
            "loan_min":           _nv(row, "Loan Amount Min"),
            "loan_max":           _nv(row, "Loan Amount Max"),
            "cibil_min":          _nv(row, "CIBIL Score", "cibil"),
            "vintage_min":        _nv(row, "Vintage (in months)", "vintage"),
            "overdue_max":        _nv(row, "Count of Overdue Accounts"),
            "dpd90_max":          _nv(row, "cnt_dpd_90plus_last_12mo"),
            "suit_max":           _nv(row, "Suit Filed Count of Loans"),
            "inward_bounce_max":  _nv(row, "Total Number of Inward cheque bounces"),
            "enq30_max":          _nv(row, "enquiry_last30days"),
            "raw":                raw,
        })

    return {"lenders": lenders, "total": len(lenders)}


@router.get("/model-status")
def model_status():
    import json, datetime
    pkl = Path("outputs/models/all_models.pkl")
    metrics_path = Path("outputs/models/metrics.json")
    if not pkl.exists():
        return {"model_exists": False, "metrics": []}
    ts = datetime.datetime.fromtimestamp(pkl.stat().st_mtime).strftime("%d %b %Y %H:%M")
    metrics = []
    best = None
    if metrics_path.exists():
        with open(metrics_path) as f:
            raw = json.load(f)
        metrics = raw
        best = max(raw, key=lambda x: x["roc_auc"]) if raw else None
    return {
        "model_exists": True,
        "last_trained": ts,
        "best_model": best["model"] if best else None,
        "best_roc_auc": best["roc_auc"] if best else None,
        "metrics": metrics,
    }
