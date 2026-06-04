"""
app.py — FinnUp Lender Matching Demo
-------------------------------------
Two-tab Streamlit app:
  Tab 1 — 🔍 Lender Matching   : borrower profile → Top 3 lenders
  Tab 2 — 🧠 Train Model       : train all models from the UI with live logs

Run:
    streamlit run app.py
"""

import contextlib
import io
import pickle
import sys
import traceback
import warnings
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import streamlit as st

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).parent))

from src.features.engineering import engineer_features, create_target, create_target_real, load_raw
from src.models.lender_matcher import (
    load_policies,
    compute_match_score,
    rank_lenders_meta,
)

# ── Page config ────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="FinnUp — MSME Lender Matching",
    page_icon="🏦",
    layout="wide",
)

NAVY  = "#1B3A6B"
TEAL  = "#0D9488"
AMBER = "#F59E0B"
GREEN = "#16A34A"
RED   = "#EF4444"
GRAY  = "#94A3B8"


def _card(label, value, color, subtitle=""):
    return (
        f"<div style='background:{color};padding:14px;border-radius:9px;text-align:center'>"
        f"<div style='color:white;font-size:11px;font-weight:bold;letter-spacing:.5px'>{label}</div>"
        f"<div style='color:white;font-size:24px;font-weight:bold;margin:4px 0'>{value}</div>"
        f"<div style='color:rgba(255,255,255,0.75);font-size:10px'>{subtitle}</div>"
        f"</div>"
    )


# ── Cached loaders ─────────────────────────────────────────────────────────────
@st.cache_resource(show_spinner="Loading ML model...")
def load_model():
    p = Path("outputs/models/all_models.pkl")
    if not p.exists():
        return None, None
    with open(p, "rb") as f:
        saved = pickle.load(f)
    return saved["models"], saved["features"]


@st.cache_resource(show_spinner="Loading lender policies...")
def load_lender_policies():
    return load_policies(
        "Capstone_Consol Sheet_22.05.2026.xlsx",
        sheet_name="Lender policy",
    )


@st.cache_resource
def load_meta():
    p = Path("outputs/models/meta_learner.pkl")
    if p.exists():
        with open(p, "rb") as f:
            return pickle.load(f)
    return None


def predict_proba(models, features, borrower_df):
    X = engineer_features(borrower_df)
    for col in features:
        if col not in X.columns:
            X[col] = 0
    X = X[features]
    probas = []
    for model in models.values():
        try:
            probas.append(model.predict_proba(X)[:, 1][0])
        except Exception:
            pass
    return float(np.mean(probas)) if probas else 0.5


def _shap_explanation(models, features, borrower_df):
    """
    Returns a DataFrame of mean |SHAP value| per feature across all
    tree-based models (XGBoost, LightGBM, RandomForest).
    Falls back to permutation-style coefficient magnitudes for LR.
    """
    import shap

    X = engineer_features(borrower_df)
    for col in features:
        if col not in X.columns:
            X[col] = 0
    X = X[features]

    shap_rows = []
    for name, model in models.items():
        try:
            # unwrap Pipeline / CalibratedClassifierCV to get the raw estimator
            est = model
            if hasattr(est, "calibrated_classifiers_"):
                est = est.calibrated_classifiers_[0].estimator
            if hasattr(est, "named_steps"):
                est = list(est.named_steps.values())[-1]

            n_feat = len(features)
            if hasattr(est, "feature_importances_"):          # tree models
                explainer = shap.TreeExplainer(est)
                sv = explainer.shap_values(X)
                if isinstance(sv, list):   # binary → take class-1
                    sv = sv[1]
                row = np.abs(sv[0]).ravel()
                if row.shape[0] == n_feat:
                    shap_rows.append(row)
            elif hasattr(est, "coef_"):                        # logistic
                coef = np.abs(est.coef_[0]).ravel()
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
    df = pd.DataFrame({"feature": features, "importance": mean_shap})
    df = df.sort_values("importance", ascending=False).head(15).reset_index(drop=True)
    return df

def _lime_explanation(models, features, borrower_df):
    """
    Returns a DataFrame of LIME feature weights (signed) for the given borrower.
    Positive weight  → feature pushes P(approved) UP.
    Negative weight  → feature pushes P(approved) DOWN.
    """
    from lime import lime_tabular

    # Background dataset — needed by LIME to learn the feature distribution
    try:
        raw = load_raw()
        X_bg = engineer_features(raw)
        for col in features:
            if col not in X_bg.columns:
                X_bg[col] = 0
        X_bg = X_bg[features].fillna(0).values
    except Exception:
        return None

    # Borrower feature vector
    X_inst = engineer_features(borrower_df)
    for col in features:
        if col not in X_inst.columns:
            X_inst[col] = 0
    X_inst = X_inst[features].fillna(0).values

    # Ensemble predict function (numpy array → class probabilities)
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
        X_bg,
        feature_names=list(features),
        mode="classification",
        discretize_continuous=True,
        random_state=42,
    )
    exp = explainer.explain_instance(
        X_inst[0],
        _predict_fn,
        num_features=15,
        num_samples=300,
        labels=(1,),
    )
    weights = exp.as_list(label=1)
    result = pd.DataFrame(weights, columns=["condition", "weight"])
    result = result.sort_values("weight", key=abs, ascending=False).reset_index(drop=True)
    return result


def _layman_bullets(shap_df: pd.DataFrame, borrower_row) -> list:
    """
    Converts top SHAP features into plain-English, colour-coded bullets the
    borrower can actually act on.  borrower_row is a raw pandas Series.
    """
    def _inr(v):
        try:
            v = float(v)
        except Exception:
            return str(v)
        if v >= 1_00_00_000:
            return f"₹{v/1_00_00_000:.1f} Cr"
        if v >= 1_00_000:
            return f"₹{v/1_00_000:.1f} L"
        return f"₹{int(v):,}"

    def _get(key, default=0):
        for k in borrower_row.index:
            if k.strip().lower() == key.strip().lower():
                try:
                    return float(borrower_row[k])
                except Exception:
                    return borrower_row[k]
        return default

    feats = shap_df["feature"].str.lower().tolist()

    def _in(kw):
        return any(kw in f for f in feats)

    bullets = []

    if _in("cibil"):
        v = _get("CIBIL Score", 0)
        tag = ("🟢 Excellent — strongest asset for approval." if v >= 720
               else "🟡 Good, but some lenders require ≥ 720." if v >= 680
               else "🔴 Low — improving your CIBIL score has the highest single payoff.")
        bullets.append(f"**Credit Score (CIBIL): {int(v)}** — {tag}")

    if _in("dscr"):
        v = _get("DSCR (Avg/Min)", 1.0)
        tag = ("🟢 Business earns enough cash to repay comfortably (≥ 1.25)." if v >= 1.25
               else "🟡 Borderline — just about enough; lenders prefer ≥ 1.25." if v >= 1.0
               else "🔴 Business may not generate enough cash to meet repayments.")
        bullets.append(f"**Repayment Capacity (DSCR): {v:.2f}** — {tag}")

    if _in("dpd_90") or _in("cnt_dpd"):
        v = int(_get("cnt_dpd_90plus_last_12mo", 0))
        tag = ("🟢 No missed EMIs in the last year — clean track record." if v == 0
               else f"🔴 {v} instance(s) of 90+ day delays — a major red flag for lenders.")
        bullets.append(f"**Missed Payments (90+ days late): {v}** — {tag}")

    if _in("overdue") or _in("has_overdue"):
        v = int(_get("Count of Overdue Accounts", 0))
        amt = _get("Total Overdue Amount", 0)
        tag = ("🟢 No outstanding dues." if v == 0
               else f"🔴 {v} account(s) with {_inr(amt)} overdue — clear these before applying.")
        bullets.append(f"**Overdue Accounts: {v}** — {tag}")

    if _in("suit"):
        v = int(_get("Suit Filed Count of Loans", 0))
        tag = ("🟢 No legal disputes on record." if v == 0
               else f"🔴 {v} legal case(s) filed — severely limits lender options.")
        bullets.append(f"**Legal / Suit Cases: {v}** — {tag}")

    if _in("tol") or ("tnw" in " ".join(feats) and "log_tangible" not in " ".join(feats)):
        v = _get("TOL/ TNW", 1.5)
        tag = ("🟢 Low debt relative to business net worth." if v <= 1.5
               else "🟡 Moderate debt load — within most lender limits." if v <= 2.0
               else "🔴 High debt versus net worth — lenders prefer below 1.5.")
        bullets.append(f"**Debt-to-Networth (TOL/TNW): {v:.1f}** — {tag}")

    if _in("current_ratio"):
        v = _get("Current Ratio", 1.0)
        tag = ("🟢 Enough short-term assets to cover liabilities comfortably." if v >= 1.5
               else "🟡 Adequate liquidity, but ≥ 1.5 is preferred." if v >= 1.2
               else "🔴 Thin liquidity — may struggle to meet short-term obligations.")
        bullets.append(f"**Liquidity (Current Ratio): {v:.2f}** — {tag}")

    if _in("pat") or _in("profit") or _in("is_profitable"):
        v = _get("Profit After Tax", 0)
        tag = (f"🟢 Business is profitable ({_inr(v)} PAT)." if v > 0
               else f"🔴 Not profitable (PAT {_inr(v)}) — most lenders require positive profit.")
        bullets.append(f"**Profitability (PAT)** — {tag}")

    if _in("loan_to_sales") or _in("loan_mid"):
        loan = _get("Loan Amount Max", 0)
        sales = max(_get("Net Sales", 1), 1)
        ratio = loan / sales
        tag = ("🟢 Loan is a manageable fraction of annual revenue." if ratio <= 0.5
               else "🟡 Loan is sizeable relative to revenue — repayment capacity will be scrutinised.")
        bullets.append(f"**Loan vs Revenue: {ratio:.0%} of annual sales** — {tag}")

    if _in("vintage"):
        v = int(_get("Vintage (in months)", 0))
        age_str = f"{v // 12}y {v % 12}m" if v >= 12 else f"{v} months"
        tag = ("🟢 Well-established business." if v >= 36
               else "🟡 Some lenders require 3+ years of operations.")
        bullets.append(f"**Business Age: {age_str}** — {tag}")

    if _in("bounce") or _in("total_bounces"):
        inb = int(_get("Total Number of Inward cheque bounces", 0))
        outb = int(_get("Total Number of Outward cheque bounces", 0))
        tag = ("🟢 No cheque bounces — clean banking record." if inb == 0 and outb == 0
               else f"🔴 {inb} inward + {outb} outward bounces — signals cash flow issues.")
        bullets.append(f"**Cheque Bounces: {inb} inward / {outb} outward** — {tag}")

    if _in("enquiry"):
        v = int(_get("enquiry_last30days", 0))
        tag = ("🟢 Low recent enquiries — no concern." if v <= 1
               else f"🟡 {v} enquiries in 30 days — too many signals credit-hungry behaviour.")
        bullets.append(f"**Recent Credit Enquiries (30 days): {v}** — {tag}")

    if _in("gst"):
        gst3 = str(_get("GST Filing in the past 3 months", "Unknown"))
        tag = ("🟢 Regular GST filing builds lender confidence." if "all" in gst3.lower()
               else "🟡 Irregular GST compliance raises doubts about business legitimacy.")
        bullets.append(f"**GST Compliance: {gst3}** — {tag}")

    return bullets[:8]


# ── Global header ──────────────────────────────────────────────────────────────
st.markdown(
    f"<h1 style='color:{NAVY};margin-bottom:0'>🏦 FinnUp — MSME Lender Matching</h1>"
    f"<p style='color:{GRAY};font-size:14px;margin-top:4px'>"
    f"APAL Cohort 2 · IIM Calcutta · Group 1 · Engine1 (ML) + Engine2 (Policy Rules)</p>",
    unsafe_allow_html=True,
)
st.divider()

tab_match, tab_train, tab_batch, tab_charts = st.tabs(["🔍 Lender Matching", "🧠 Train Model", "📋 Batch Score", "📊 Model Diagrams"])


# ══════════════════════════════════════════════════════════════════════════════
# TAB 1 — LENDER MATCHING
# ══════════════════════════════════════════════════════════════════════════════
with tab_match:

    models, feature_names = load_model()
    policies = load_lender_policies()
    meta_saved = load_meta()
    learned_w1 = meta_saved["learned_w1"] if meta_saved else 0.6
    learned_w2 = meta_saved["learned_w2"] if meta_saved else 0.4

    if models is None:
        st.warning(
            "No trained model found. Go to the **🧠 Train Model** tab to train the pipeline first.",
            icon="⚠️",
        )
    else:
        left, right = st.columns([1, 2], gap="large")

        with left:
            st.markdown(f"<h4 style='color:{NAVY}'>Borrower Profile</h4>", unsafe_allow_html=True)

            with st.form("borrower_form"):
                entity_type  = st.selectbox("Type of Entity",
                    ["Sole Proprietorship", "Private Limited", "Partnership", "LLP", "Public Limited"])
                product_name = st.selectbox("Loan Product", [
                    "Unsecured Business Loan", "Personal Loan", "Cash Credit/WCDL",
                    "Term Loan", "Bill Discounting/ Purchase financing",
                    "Loan Against Property", "Overdraft Facility", "Housing Loan"])
                location     = st.text_input("Location (City)", value="Mumbai")

                c1, c2 = st.columns(2)
                loan_min = c1.number_input("Loan Min (₹L)", 10, 500, 20) * 100_000
                loan_max = c2.number_input("Loan Max (₹L)", 10, 5000, 50) * 100_000

                st.markdown("**Credit**")
                cibil          = st.slider("CIBIL Score", 300, 900, 720)
                dpd90          = st.slider("DPD 90+ (last 12 mo)", 0, 10, 0)
                overdue_count  = st.slider("Overdue Accounts", 0, 10, 0)
                overdue_amount = st.number_input("Overdue Amount (₹)", 0, 5_000_000, 0, step=10_000)
                suit_filed     = st.slider("Suit Filed Count", 0, 5, 0)

                st.markdown("**Business**")
                vintage   = st.slider("Vintage (months)", 12, 240, 36)
                age_app   = st.slider("Age of Applicant", 21, 70, 42)
                net_sales = st.number_input("Net Sales (₹L)", 5, 5000, 100) * 100_000
                pat       = st.number_input("Profit After Tax (₹L)", -50, 500, 5) * 100_000
                tnw       = st.number_input("Tangible Networth (₹L)", 0, 1000, 30) * 100_000

                st.markdown("**Ratios**")
                dscr    = st.slider("DSCR", 0.5, 3.0, 1.2, 0.05)
                cr      = st.slider("Current Ratio", 0.5, 3.0, 1.3, 0.05)
                tol_tnw = st.slider("TOL / TNW", 0.5, 5.0, 1.5, 0.1)

                st.markdown("**Banking & GST**")
                inward_b  = st.slider("Inward Bounces", 0, 10, 0)
                outward_b = st.slider("Outward Bounces", 0, 10, 0)
                enq30     = st.slider("Enquiries (30d)", 0, 10, 1)
                ns30      = st.slider("New Sanctions (30d)", 0, 5, 0)
                gst3      = st.selectbox("GST Filing (3 mo)",
                    ["All filed", "Partially filed", "Not filed"])
                gst6      = st.selectbox("GST Filing (6 mo)",
                    ["All filed", "Partially filed", "Not filed"])
                owned     = st.selectbox("Property", ["Owned", "Rented"])

                find_btn = st.form_submit_button(
                    "🔍 Find Best Lenders", type="primary", use_container_width=True
                )

        with right:
            if not find_btn:
                st.markdown(
                    f"<div style='background:#F0F4F8;padding:32px;border-radius:12px;"
                    f"text-align:center;border:2px dashed {TEAL};margin-top:60px'>"
                    f"<span style='color:{NAVY};font-size:15px'>"
                    f"Fill in the borrower profile and click <b>Find Best Lenders</b></span>"
                    f"</div>",
                    unsafe_allow_html=True,
                )
            else:
                borrower_data = {
                    "company_name": "DEMO",
                    "product_name": product_name,
                    "location": location,
                    "Loan Amount Min": loan_min, "Loan Amount Max": loan_max,
                    "Tenor Min": 1, "Tenor Max": 3,
                    "Rate of interest Min": 11, "Rate of interest Max": 18,
                    "Type of Entity": entity_type, "Vintage (in months)": vintage,
                    "Industry": 19.0, "Pincode": 560001, "Age of applicant": age_app,
                    "CIBIL Score": cibil,
                    "Total number of active accounts": 1,
                    "Count of Overdue Accounts": overdue_count,
                    "Total Overdue Amount": overdue_amount,
                    "New sanction in the last 30 days": ns30,
                    "New sanction in the last 90 days": ns30,
                    "enquiry_last7days": min(enq30, 2), "enquiry_last30days": enq30,
                    "cnt_dpd_0plus_last_12mo": dpd90, "cnt_dpd_90plus_last_12mo": dpd90,
                    "Suit Filed Count of Loans": suit_filed,
                    "Owned/Rented Property": owned,
                    "Net Sales": net_sales, "Profit After Tax": pat,
                    "Tangible Networth (TNW)": tnw, "TOL/ TNW ": tol_tnw,
                    "Current Ratio": cr, "DSCR (Avg/Min)": dscr,
                    "Total Amount of Credit Transactions": net_sales * 1.5,
                    "Total Amount of Debit Transactions": int(net_sales * 1.2),
                    "Average EOD Balance": net_sales * 0.05,
                    "Total Number of Inward cheque bounces": inward_b,
                    "Total Number of Outward cheque bounces": outward_b,
                    "GST Filing in the past 3 months": gst3,
                    "GST Filing in the past 6 months": gst6,
                }
                borrower_df  = pd.DataFrame([borrower_data])
                borrower_row = borrower_df.iloc[0]

                with st.spinner("Engine 1 + Engine 2 running..."):
                    p_approved = predict_proba(models, feature_names, borrower_df)
                    match_df   = compute_match_score(borrower_row, policies)
                    top3       = rank_lenders_meta(p_approved, match_df, top_n=3)

                eligible_count = int(match_df["eligible"].sum())
                avg_match = (
                    match_df[match_df["eligible"]]["match_score"].mean()
                    if eligible_count > 0 else 0.0
                )

                p_color = GREEN if p_approved >= 0.3 else (AMBER if p_approved >= 0.2 else RED)
                k1, k2, k3 = st.columns(3)
                k1.markdown(_card("P(APPROVED) — ENGINE 1", f"{p_approved:.1%}",
                                  p_color, "ML ensemble"), unsafe_allow_html=True)
                k2.markdown(_card("ELIGIBLE LENDERS — ENGINE 2",
                                  f"{eligible_count} / {len(match_df)}",
                                  TEAL, f"Avg MatchScore: {avg_match:.2f}"),
                            unsafe_allow_html=True)
                k3.markdown(_card("WEIGHTS (w1 / w2)",
                                  f"{learned_w1:.2f} / {learned_w2:.2f}",
                                  NAVY, "Learned" if meta_saved else "Default 0.6/0.4"),
                            unsafe_allow_html=True)

                st.markdown("<br>", unsafe_allow_html=True)

                if p_approved < 0.20:
                    st.error(
                        f"P(approved) = **{p_approved:.1%}** is below the 20% floor. "
                        "No lenders recommended. Address credit weaknesses (CIBIL, DSCR, overdue).",
                        icon="🚫",
                    )
                elif len(top3) == 0:
                    st.warning(
                        "No lenders passed both eligibility rules and the approval threshold.",
                        icon="⚠️",
                    )
                else:
                    st.markdown(f"<h4 style='color:{NAVY}'>Top 3 Recommended Lenders</h4>",
                                unsafe_allow_html=True)
                    rank_colors = [GREEN, TEAL, AMBER]
                    rank_labels = ["#1 BEST MATCH", "#2", "#3"]
                    cols = st.columns(len(top3))
                    for i, (col, (_, row)) in enumerate(zip(cols, top3.iterrows())):
                        bg  = rank_colors[i] if i < len(rank_colors) else NAVY
                        lbl = rank_labels[i] if i < len(rank_labels) else f"#{i+1}"
                        col.markdown(
                            f"<div style='background:{bg};padding:18px;border-radius:10px;"
                            f"text-align:center'>"
                            f"<div style='color:white;font-size:11px;font-weight:bold'>{lbl}</div>"
                            f"<div style='color:white;font-size:18px;font-weight:bold;"
                            f"margin:6px 0'>{row['lender_name']}</div>"
                            f"<hr style='border-color:rgba(255,255,255,0.3);margin:6px 0'>"
                            f"<div style='color:white;font-size:12px'>"
                            f"Combined: <b>{row.get('combined_score', 0):.3f}</b></div>"
                            f"<div style='color:rgba(255,255,255,0.85);font-size:11px'>"
                            f"P(approved): {row.get('p_approved', p_approved):.2%}</div>"
                            f"<div style='color:rgba(255,255,255,0.85);font-size:11px'>"
                            f"MatchScore: {row.get('match_score', 0):.3f}</div>"
                            f"</div>",
                            unsafe_allow_html=True,
                        )

                    st.markdown("<br>", unsafe_allow_html=True)
                    st.info(
                        f"**Formula:** Combined Score = {learned_w1:.2f} × P(approved) + "
                        f"{learned_w2:.2f} × MatchScore  |  Floor: P(approved) ≥ 20%",
                        icon="ℹ️",
                    )

                with st.expander("All lenders — eligibility & scores"):
                    disp = match_df[["lender_name", "eligible", "match_score"]].copy()
                    disp["p_approved"]     = round(p_approved, 4)
                    disp["combined_score"] = round(
                        learned_w1 * p_approved + learned_w2 * disp["match_score"], 4
                    )
                    st.dataframe(
                        disp.sort_values("combined_score", ascending=False)
                            .reset_index(drop=True),
                        use_container_width=True,
                    )

                # ── SHAP + LIME explanation ───────────────────────────────
                with st.expander("🔬 Why this score? — SHAP & LIME Explanation", expanded=True):
                    xai_shap, xai_lime = st.tabs(["📊 SHAP", "🍋 LIME"])

                    # ── SHAP tab ──
                    with xai_shap:
                        st.markdown(
                            f"<p style='color:{GRAY};font-size:12px'>"
                            f"Mean |SHAP value| averaged across all models. "
                            f"Shows <b>magnitude</b> of each feature's impact on "
                            f"P(approved) = <b>{p_approved:.1%}</b>.</p>",
                            unsafe_allow_html=True,
                        )
                        with st.spinner("Computing SHAP values..."):
                            shap_df = _shap_explanation(models, feature_names, borrower_df)

                        if shap_df is None:
                            st.warning("SHAP unavailable for this model type.")
                        else:
                            fig, ax = plt.subplots(figsize=(8, 4.5))
                            colors = [
                                "#16A34A" if v > shap_df["importance"].median()
                                else "#EF4444"
                                for v in shap_df["importance"]
                            ]
                            ax.barh(
                                shap_df["feature"][::-1],
                                shap_df["importance"][::-1],
                                color=colors[::-1],
                            )
                            ax.set_xlabel("Mean |SHAP value| — impact magnitude", fontsize=9)
                            ax.set_title("SHAP: Top 15 Features by Impact Magnitude",
                                         fontsize=11, color=NAVY, fontweight="bold")
                            ax.tick_params(axis="y", labelsize=8)
                            ax.tick_params(axis="x", labelsize=8)
                            ax.spines[["top", "right"]].set_visible(False)
                            fig.tight_layout()
                            st.pyplot(fig)
                            plt.close(fig)
                            st.caption(
                                "🟢 green = above-median impact magnitude  "
                                "🔴 red = below-median impact magnitude"
                            )

                            # ── Plain-English interpretation ───────────────
                            bullets = _layman_bullets(shap_df, borrower_row)
                            if bullets:
                                st.markdown(
                                    f"<h5 style='color:{NAVY};margin-top:18px;"
                                    f"margin-bottom:4px'>📝 What this means "
                                    f"for your application</h5>",
                                    unsafe_allow_html=True,
                                )
                                for b in bullets:
                                    st.markdown(f"- {b}")

                    # ── LIME tab ──
                    with xai_lime:
                        st.markdown(
                            f"<p style='color:{GRAY};font-size:12px'>"
                            f"LIME perturbs the borrower profile and fits a local linear "
                            f"model. Bar direction shows whether a condition "
                            f"<b>increases (+) or decreases (−)</b> P(approved) = "
                            f"<b>{p_approved:.1%}</b> for this specific applicant.</p>",
                            unsafe_allow_html=True,
                        )
                        with st.spinner("Computing LIME explanation (~5 sec)..."):
                            lime_df = _lime_explanation(models, feature_names, borrower_df)

                        if lime_df is None:
                            st.warning("LIME explanation unavailable.")
                        else:
                            fig2, ax2 = plt.subplots(figsize=(8, 4.5))
                            lime_colors = [
                                "#16A34A" if w > 0 else "#EF4444"
                                for w in lime_df["weight"]
                            ]
                            ax2.barh(
                                lime_df["condition"][::-1],
                                lime_df["weight"][::-1],
                                color=lime_colors[::-1],
                            )
                            ax2.axvline(0, color="#94A3B8", linewidth=0.8, linestyle="--")
                            ax2.set_xlabel(
                                "LIME weight — positive = boosts approval, "
                                "negative = hurts approval",
                                fontsize=9,
                            )
                            ax2.set_title(
                                "LIME: Feature Conditions Driving This Decision",
                                fontsize=11, color=NAVY, fontweight="bold",
                            )
                            ax2.tick_params(axis="y", labelsize=7)
                            ax2.tick_params(axis="x", labelsize=8)
                            ax2.spines[["top", "right"]].set_visible(False)
                            fig2.tight_layout()
                            st.pyplot(fig2)
                            plt.close(fig2)
                            st.caption(
                                "🟢 green (+) = condition pushes approval UP  "
                                "🔴 red (−) = condition pushes approval DOWN"
                            )


# ══════════════════════════════════════════════════════════════════════════════
# TAB 2 — TRAIN MODEL
# ══════════════════════════════════════════════════════════════════════════════
with tab_train:

    st.markdown(f"<h4 style='color:{NAVY}'>Training Configuration</h4>", unsafe_allow_html=True)

    cfg_col, res_col = st.columns([1, 2], gap="large")

    with cfg_col:
        consol_file = st.text_input(
            "Consolidated data file",
            value="Capstone_Consol Sheet_22.05.2026.xlsx",
            help="Single file with sheets: Total borrowers · Approved loans · Loan Applications · Lender policy"
        )
        st.caption(
            "📋 **Training data:** 6,735 loan applications · "
            "582 approved (status=Disbursed/Sanctioned + sanctioned_amount>0) · "
            "6,153 not approved · "
            "**Approval rate: 8.6%** · 19 active lender policies · "
            "Features: 38 financial (CIBIL, GST, overdue...) + application-level"
        )
        test_size   = st.slider("Test size", 0.10, 0.40, 0.20, 0.05)
        cv_folds    = st.slider("CV folds", 3, 10, 5)
        use_smote    = st.checkbox("Apply SMOTE", value=True)
        run_ensemble = st.checkbox("Build ensemble models", value=True)
        run_weights  = st.checkbox("Optimise combination weights", value=True)

        train_btn = st.button("🚀 Train Models", type="primary", use_container_width=True)

    with res_col:
        # ── Saved model status (always visible) ───────────────────────────
        _pkl_path    = Path("outputs/models/all_models.pkl")
        _metrics_path = Path("outputs/models/metrics.json")
        if _pkl_path.exists():
            import json as _json, datetime as _dt
            _ts = _dt.datetime.fromtimestamp(_pkl_path.stat().st_mtime).strftime("%d %b %Y  %H:%M")
            _saved_metrics: list = []
            if _metrics_path.exists():
                with open(_metrics_path) as _mf:
                    _saved_metrics = _json.load(_mf)
            _best_m = max(_saved_metrics, key=lambda x: x["roc_auc"]) if _saved_metrics else None
            st.markdown(
                f"<div style='background:#E8F5E9;padding:14px 18px;border-radius:10px;"
                f"border-left:5px solid {GREEN};margin-bottom:16px'>"
                f"<b style='color:{GREEN}'>✅ Trained model loaded</b>"
                f"&nbsp;&nbsp;<span style='color:{GRAY};font-size:12px'>Last trained: {_ts}</span>"
                + (
                    f"<br><span style='color:{NAVY};font-size:13px'>"
                    f"Best: <b>{_best_m['model']}</b>"
                    f" &nbsp;·&nbsp; ROC-AUC <b>{_best_m['roc_auc']:.4f}</b>"
                    f" &nbsp;·&nbsp; PR-AUC {_best_m['pr_auc']:.4f}"
                    f" &nbsp;·&nbsp; F1 {_best_m['f1']:.4f}</span>"
                    if _best_m else ""
                )
                + "</div>",
                unsafe_allow_html=True,
            )
            if _saved_metrics:
                _sm_df = (
                    pd.DataFrame(_saved_metrics)
                    [["model", "roc_auc", "pr_auc", "f1", "precision", "recall"]]
                    .sort_values("roc_auc", ascending=False)
                    .reset_index(drop=True)
                )
                _sm_df.columns = ["Model", "ROC-AUC", "PR-AUC", "F1", "Precision", "Recall"]
                with st.expander("📊 View all saved model metrics", expanded=False):
                    st.dataframe(_sm_df, use_container_width=True)
        else:
            st.info(
                "No trained model found on disk. Configure settings and click **Train Models**.",
                icon="ℹ️",
            )

        if not train_btn:
            st.markdown(
                f"<div style='background:#F0F4F8;padding:20px;border-radius:12px;"
                f"border:2px dashed {TEAL};text-align:center;margin-top:8px'>"
                f"<span style='color:{NAVY};font-size:14px'>"
                f"Configure settings and click <b>Train Models</b> to retrain</span><br><br>"
                f"<span style='color:{GRAY};font-size:12px'>"
                f"LR · Random Forest · XGBoost · LightGBM + Ensembles<br>"
                f"Approx 3–5 min on 6,000 rows with 5-fold CV</span></div>",
                unsafe_allow_html=True,
            )
        else:
            # Pre-flight
            errors = []
            if not Path(consol_file).exists():
                errors.append(f"Consolidated file not found: `{consol_file}`")
            if errors:
                for e in errors:
                    st.error(e, icon="❌")
                st.stop()

            log_area  = st.empty()
            prog_bar  = st.progress(0, text="Initialising...")
            log_lines: list[str] = []

            def _push(line: str):
                log_lines.append(line)
                log_area.code("\n".join(log_lines[-80:]), language="")

            try:
                from sklearn.model_selection import train_test_split
                from src.models.trainer import (
                    train_and_evaluate,
                    build_weighted_ensemble,
                    build_stacking_ensemble,
                    optimise_combination_weights,
                )
                from src.models.lender_matcher import (
                    load_policies as _load_pol,
                    compute_match_score as _cms,
                    fit_meta_learner,
                )

                # 1 — Load
                prog_bar.progress(5, "Loading data...")
                raw = load_raw()
                _push(f"[1/7] Data loaded: {raw.shape[0]:,} rows × {raw.shape[1]} cols")

                # 2 — Target
                prog_bar.progress(10, "Creating target...")
                TARGET_COL = "loan_approved"
                if TARGET_COL in raw.columns:
                    df = raw.copy()
                    _push(f"[2/7] Real labels found — approval rate: {df[TARGET_COL].mean():.2%}")
                else:
                    # Try real labels from Loan Applications sheet
                    try:
                        df = create_target_real(raw)
                        _push(f"[2/7] Real labels (Loan Applications) — "
                              f"{len(df):,} borrowers | approval rate: {df[TARGET_COL].mean():.2%}")
                    except Exception as e:
                        df = create_target(raw)
                        _push(f"[2/7] Scorecard proxy (real labels unavailable: {e}) — "
                              f"approval rate: {df[TARGET_COL].mean():.2%}")

                # 3 — Features
                prog_bar.progress(18, "Engineering features...")
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    X = engineer_features(df)
                y = df[TARGET_COL]
                _push(f"[3/7] Feature matrix: {X.shape[1]} features")

                # 4 — Split
                prog_bar.progress(22, "Splitting...")
                X_train, X_test, y_train, y_test = train_test_split(
                    X, y, test_size=test_size, random_state=42, stratify=y
                )
                _push(f"[4/7] Train: {len(X_train):,}  Test: {len(X_test):,}"
                      f"  (test approval: {y_test.mean():.2%})")

                # 5 — Train 4 models
                prog_bar.progress(28, "Training models — this may take a few minutes...")
                _push("[5/7] Training LR · RF · XGBoost · LightGBM ...")
                buf2 = io.StringIO()
                with contextlib.redirect_stdout(buf2):
                    best_name, all_metrics = train_and_evaluate(
                        X_train, X_test, y_train, y_test,
                        use_smote=use_smote, cv_folds=cv_folds,
                    )
                for line in buf2.getvalue().splitlines():
                    if line.strip():
                        _push(f"    {line}")
                _push(f"[5/7] ✓  Best model: {best_name}")
                prog_bar.progress(65, "Models trained.")

                # 6 — Ensembles
                if run_ensemble:
                    prog_bar.progress(68, "Building ensembles...")
                    _push("[6/7] Building weighted + stacking ensembles...")
                    with open("outputs/models/all_models.pkl", "rb") as f:
                        trained_models = pickle.load(f)["models"]
                    buf3 = io.StringIO()
                    with contextlib.redirect_stdout(buf3):
                        weighted_proba, weighted_metrics = build_weighted_ensemble(
                            trained_models, all_metrics, X_test, y_test
                        )
                        stacked_proba, stacked_metrics = build_stacking_ensemble(
                            trained_models, X_train, X_test, y_train, y_test,
                            cv_folds=cv_folds,
                        )
                    _push(f"    Weighted   AUC: {weighted_metrics['roc_auc']:.4f}")
                    _push(f"    Stacking   AUC: {stacked_metrics['roc_auc']:.4f}")
                    prog_bar.progress(82, "Ensembles done.")

                    # 7 — Weights
                    if run_weights:
                        prog_bar.progress(85, "Optimising weights...")
                        _push("[7/7] Grid-search + meta-learner for w1/w2 ...")
                        pol_df = _load_pol()
                        match_means = []
                        for idx in X_test.index:
                            md   = _cms(df.loc[idx], pol_df)
                            elig = md[md["eligible"]]["match_score"]
                            match_means.append(elig.mean() if len(elig) > 0 else 0.0)
                        match_arr  = np.array(match_means)
                        best_proba = (
                            stacked_proba
                            if stacked_metrics["roc_auc"] >= weighted_metrics["roc_auc"]
                            else weighted_proba
                        )
                        buf4 = io.StringIO()
                        with contextlib.redirect_stdout(buf4):
                            bw1, bw2, _ = optimise_combination_weights(
                                p_approved=best_proba,
                                match_scores=match_arr,
                                y_true=y_test.values,
                            )
                            _, lw1, lw2 = fit_meta_learner(
                                p_approved_arr=best_proba,
                                match_score_arr=match_arr,
                                y_true=y_test.values,
                            )
                        _push(f"    Grid-search: w1={bw1:.2f}  w2={bw2:.2f}")
                        _push(f"    Meta-learner: w1={lw1:.2f}  w2={lw2:.2f}")

                prog_bar.progress(100, "Complete!")
                _push("")
                _push("=" * 48)
                _push("  Pipeline complete. Artifacts → outputs/models/")
                _push("=" * 48)

                st.success("Training complete!", icon="✅")

                # ── Metrics table ──────────────────────────────────────────
                st.markdown(f"#### Model Performance")
                metrics_list = list(all_metrics.values())
                if run_ensemble:
                    metrics_list += [weighted_metrics, stacked_metrics]
                metrics_df = (
                    pd.DataFrame(metrics_list)
                    [["model", "roc_auc", "pr_auc", "f1", "precision", "recall", "brier_score"]]
                    .sort_values("roc_auc", ascending=False)
                    .reset_index(drop=True)
                )
                st.dataframe(metrics_df, use_container_width=True)

                # ── Charts ─────────────────────────────────────────────────
                out_dir = Path("outputs/models")
                chart_files = [
                    ("ROC & PR Curves",    out_dir / "roc_pr_curves.png"),
                    ("Model Comparison",   out_dir / "model_comparison.png"),
                    ("Weight Optimisation",out_dir / "weight_optimisation.png"),
                ]
                charts = [(t, p) for t, p in chart_files if p.exists()]
                if charts:
                    st.markdown("#### Charts")
                    for title, p in charts:
                        st.markdown(f"**{title}**")
                        st.image(str(p), use_container_width=True)

                st.info(
                    "Cache cleared — next prediction in the Lender Matching tab will use the new model.",
                    icon="🔄",
                )
                st.cache_resource.clear()

            except Exception as exc:
                prog_bar.progress(0, "Failed")
                st.error(f"Training failed: {exc}", icon="❌")
                with st.expander("Traceback"):
                    st.code(traceback.format_exc())

# ══════════════════════════════════════════════════════════════════════════════
# TAB 4 — MODEL DIAGRAMS (shareable)
# ══════════════════════════════════════════════════════════════════════════════
with tab_charts:
    st.markdown(f"<h4 style='color:{NAVY}'>Model Performance Diagrams</h4>", unsafe_allow_html=True)
    st.caption(
        "All charts generated from the latest training run. "
        "Right-click any image → Save As to download, or use the ⬇ buttons below each chart."
    )

    out_dir = Path("outputs/models")

    def _show_chart(title, path, caption_text=""):
        if path.exists():
            st.markdown(f"##### {title}")
            st.image(str(path), use_container_width=True)
            with open(path, "rb") as _f:
                st.download_button(
                    f"⬇ Download {title}",
                    data=_f.read(),
                    file_name=path.name,
                    mime="image/png",
                    key=f"dl_{path.stem}",
                )
            if caption_text:
                st.caption(caption_text)
            st.divider()

    # ── Row 1: ROC/PR + Model Comparison ──────────────────────────────────────
    r1a, r1b = st.columns(2)
    with r1a:
        _show_chart(
            "ROC & PR Curves — All Models",
            out_dir / "roc_pr_curves.png",
            "Left: ROC-AUC (higher = better). Right: PR-AUC (critical for 8.6% positive rate — measures precision-recall tradeoff on the minority class)."
        )
    with r1b:
        _show_chart(
            "Model Comparison",
            out_dir / "model_comparison.png",
            "Side-by-side ROC-AUC, PR-AUC and F1 across all 4 models + 2 ensembles."
        )

    # ── Row 2: Feature Importance ─────────────────────────────────────────────
    st.markdown(f"<h5 style='color:{NAVY}'>Feature Importance — Per Model</h5>", unsafe_allow_html=True)
    st.info(
        "**Why features differ across models:** Each model measures importance differently — "
        "Random Forest uses Gini impurity gain, XGBoost uses weighted gain per split, "
        "LightGBM counts raw number of splits. All models agree on the core drivers: "
        "**Entity type, GST compliance, cheque bounces, overdue accounts, CIBIL Score, DSCR.**",
        icon="ℹ️"
    )
    fi_cols = st.columns(2)
    for i, (name, fname) in enumerate([
        ("XGBoost ★ (Best Model)", "feature_importance_xgboost.png"),
        ("LightGBM", "feature_importance_lightgbm.png"),
        ("Random Forest", "feature_importance_random_forest.png"),
        ("Logistic Regression", "feature_importance_logistic_regression.png"),
    ]):
        with fi_cols[i % 2]:
            _show_chart(name, out_dir / fname)

    # ── Row 3: Confusion Matrices ─────────────────────────────────────────────
    st.markdown(f"<h5 style='color:{NAVY}'>Confusion Matrices</h5>", unsafe_allow_html=True)
    cm_cols = st.columns(4)
    for i, (name, fname) in enumerate([
        ("XGBoost", "confusion_xgboost.png"),
        ("LightGBM", "confusion_lightgbm.png"),
        ("Random Forest", "confusion_random_forest.png"),
        ("Logistic Reg.", "confusion_logistic_regression.png"),
    ]):
        with cm_cols[i]:
            if (out_dir / fname).exists():
                st.markdown(f"**{name}**")
                st.image(str(out_dir / fname), use_container_width=True)
                with open(out_dir / fname, "rb") as _f:
                    st.download_button(f"⬇", data=_f.read(), file_name=fname,
                                       mime="image/png", key=f"dl_cm_{i}")
    st.divider()

    # ── Row 4: Weight Optimisation ────────────────────────────────────────────
    r4a, r4b = st.columns(2)
    with r4a:
        _show_chart(
            "Engine 1 vs Engine 2 — Weight Optimisation",
            out_dir / "weight_optimisation.png",
            "Grid search showing ROC-AUC for each w1/w2 split. Best at w1=1.0 (ML dominates): the ML model already captures lender policy logic."
        )
    with r4b:
        _show_chart(
            "Meta-Learner Weight Comparison",
            out_dir / "meta_weight_comparison.png",
            "Fixed (0.6/0.4) vs learned meta-learner weights. Improvement is marginal — ML signal is strong enough."
        )

    # ── Summary metrics table ─────────────────────────────────────────────────
    import json as _json
    _metrics_path = Path("outputs/models/metrics.json")
    if _metrics_path.exists():
        st.markdown(f"<h5 style='color:{NAVY}'>Model Metrics Summary</h5>", unsafe_allow_html=True)
        _m = _json.load(open(_metrics_path))
        if isinstance(_m, list):
            _mdf = pd.DataFrame(_m)[["model","roc_auc","pr_auc","f1","precision","recall"]].sort_values("roc_auc", ascending=False)
            st.dataframe(_mdf.reset_index(drop=True), use_container_width=True)
            csv_m = _mdf.to_csv(index=False).encode()
            st.download_button("⬇ Download Metrics CSV", csv_m, "model_metrics.csv", "text/csv", key="dl_metrics")


# ── Footer ─────────────────────────────────────────────────────────────────────


# ══════════════════════════════════════════════════════════════════════════════
# TAB 3 — BATCH SCORE (unlabeled borrowers)
# ══════════════════════════════════════════════════════════════════════════════
with tab_batch:
    st.markdown(f"<h4 style='color:{NAVY}'>Batch Score — All Borrowers</h4>", unsafe_allow_html=True)
    st.caption(
        "Runs the trained ML model across all 6,735 loan applications and ranks them by predicted approval probability. "
        "582 confirmed approved · 6,153 not approved · Approval rate 8.6%. "
        "Use this to prioritise outreach."
    )

    if st.button("▶  Score All Borrowers", type="primary", use_container_width=False):
        try:
            models_b, feat_names_b = load_model()
            if models_b is None:
                st.error("No trained model found. Run **Train Model** tab first.", icon="❌")
                st.stop()

            with st.spinner("Loading data and scoring 6,187 borrowers..."):
                # Load all borrowers and assign labels
                raw_all = load_raw()
                df_all = create_target_real(raw_all)
                total_borrowers = len(df_all)

                # Engineer features
                X_all = engineer_features(df_all)
                # Align to trained feature set
                for c in feat_names_b:
                    if c not in X_all.columns:
                        X_all[c] = 0
                X_all = X_all[feat_names_b]

                # Score with best model
                best_mdl = models_b.get("best")
                if best_mdl is None:
                    best_mdl = list(models_b.values())[0]
                proba = best_mdl.predict_proba(X_all)[:, 1]

            # Build results table
            keep_cols = [c for c in ["company_name", "product_name", "CIBIL Score",
                                      "Vintage (in months)", "Net Sales",
                                      "Count of Overdue Accounts",
                                      "Type of Entity"] if c in df_all.columns]
            result_df = df_all[keep_cols + ["loan_approved"]].copy()
            result_df["P(Approved) %"] = (proba * 100).round(1)
            result_df["Label"] = result_df["loan_approved"].map(
                {1: "✅ Confirmed Approved", 0: "⬜ Not Approved / Unlabeled"}
            )
            result_df = result_df.drop(columns=["loan_approved"])
            result_df["Risk Band"] = pd.cut(
                result_df["P(Approved) %"],
                bins=[0, 30, 50, 70, 100],
                labels=["🔴 Low", "🟡 Medium", "🟢 High", "🟢 Very High"]
            )
            result_df = result_df.sort_values("P(Approved) %", ascending=False).reset_index(drop=True)
            result_df.index += 1

            confirmed_appr = int((df_all["loan_approved"] == 1).sum())
            confirmed_rej  = int((df_all["loan_approved"] == 0).sum())

            # Summary cards
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Total applications scored", f"{total_borrowers:,}")
            c2.metric("High probability (>50%)", f"{(proba > 0.5).sum():,}")
            c3.metric("Medium (30–50%)",  f"{((proba >= 0.3) & (proba <= 0.5)).sum():,}")
            c4.metric("Low (<30%)",        f"{(proba < 0.3).sum():,}")

            # Distribution chart
            fig_b, ax_b = plt.subplots(figsize=(9, 3))
            ax_b.hist(proba * 100, bins=40, color=TEAL, edgecolor="white", alpha=0.85)
            ax_b.axvline(50, color=NAVY, linestyle="--", linewidth=1.2, label="50% threshold")
            ax_b.set_xlabel("P(Approved) %", fontsize=10)
            ax_b.set_ylabel("Borrowers", fontsize=10)
            ax_b.set_title(f"Approval Probability Distribution — {total_borrowers:,} Applications (all)",
                           fontsize=11, color=NAVY)
            ax_b.legend(fontsize=9)
            plt.tight_layout()
            st.pyplot(fig_b)
            plt.close(fig_b)

            # Table
            st.markdown(f"#### All 6,735 Applications — sorted by P(Approved)")
            st.caption(
                f"✅ Confirmed Approved: {confirmed_appr:,} · "
                f"⬜ Not Approved: {confirmed_rej:,} · "
                f"Approval rate in training: {confirmed_appr/total_borrowers:.1%}"
            )
            st.dataframe(result_df, use_container_width=True, height=420)

            # CSV download
            csv_bytes = result_df.to_csv(index=True).encode()
            st.download_button(
                "⬇  Download CSV",
                data=csv_bytes,
                file_name="finnup_all_borrowers_scored.csv",
                mime="text/csv",
            )

        except Exception as exc:
            st.error(f"Scoring failed: {exc}", icon="❌")
            with st.expander("Traceback"):
                import traceback as _tb
                st.code(_tb.format_exc())
    else:
        st.markdown(
            f"<div style='background:#F0F4F8;padding:28px;border-radius:12px;"
            f"border:2px dashed {TEAL};text-align:center;margin-top:16px'>"
            f"<span style='color:{NAVY};font-size:14px'>"
            f"Click <b>Score All Borrowers</b> to run the trained model "
            f"across all 6,735 applications.</span><br><br>"
            f"<span style='color:{GRAY};font-size:12px'>"
            f"582 confirmed approved · 6,153 not approved<br>"
            f"Requires a trained model (run Train Model tab first)</span></div>",
            unsafe_allow_html=True,
        )

st.markdown(
    f"<p style='color:{GRAY};font-size:11px;text-align:center'>"
    f"FinnUp MSME Lender Matching · APAL Cohort 2 · IIM Calcutta · Group 1 · "
    f"Combined Score = w1×P(approved) + w2×MatchScore</p>",
    unsafe_allow_html=True,
)
