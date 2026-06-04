"""
src/models/lender_matcher.py
-----------------------------
Engine 2 — Rule-based lender policy filter + MatchScore
Meta-learner — Learns optimal Engine 1 / Engine 2 combination weights

Flow:
  1. load_policies()          — load active lender policies from Excel
  2. compute_match_score()    — check eligibility + compute MatchScore (0-1)
                                for each borrower × lender pair
  3. rank_lenders()           — combine P(approved) + MatchScore → Top 3
  4. fit_meta_learner()       — learn optimal weights from labelled outcomes
  5. rank_lenders_meta()      — use learned meta-weights for ranking
"""

from __future__ import annotations

import pickle
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, average_precision_score
from sklearn.model_selection import cross_val_score, StratifiedKFold

warnings.filterwarnings("ignore")

MODELS_DIR = Path("outputs") / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ── Minimum P(approved) threshold — below this a lender is never recommended ─
MIN_P_APPROVED = 0.20

# ── Default fallback weights (used before meta-learner is trained) ────────────
DEFAULT_W1 = 0.6   # Engine 1 — ML
DEFAULT_W2 = 0.4   # Engine 2 — MatchScore


# ─────────────────────────────────────────────────────────────────────────────
# POLICY LOADING
# ─────────────────────────────────────────────────────────────────────────────
def load_policies(
    policy_path: str = "Capstone_Consol Sheet_22.05.2026.xlsx",
    sheet_name: str = "Lender policy",
) -> pd.DataFrame:
    """
    Load active lender policies from the FinnUp policy Excel file.
    Filters to active policies only (Status == 'Active' or equivalent).
    Returns a DataFrame with one row per lender-product policy.
    """
    df = pd.read_excel(policy_path, sheet_name=sheet_name)
    df.columns = [str(c).strip() for c in df.columns]

    # Use 'Lender' column if present, else fall back to first column
    if "Lender" in df.columns:
        df = df.rename(columns={"Lender": "lender_name"})
    else:
        lender_col = df.columns[0]
        df = df.rename(columns={lender_col: "lender_name"})
    df["lender_name"] = df["lender_name"].ffill()  # fill merged cells

    # Keep active policies
    status_cols = [c for c in df.columns if "status" in c.lower()]
    if status_cols:
        sc = status_cols[0]
        df = df[df[sc].astype(str).str.strip().str.lower().isin(["active", "yes", "1"])]

    df = df.reset_index(drop=True)
    print(f"  Loaded {len(df)} active policies from {policy_path} (sheet: {sheet_name})")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# ELIGIBILITY RULES  (hard pass/fail per lender policy)
# ─────────────────────────────────────────────────────────────────────────────
def _check_rule(borrower_val, min_val, max_val=None) -> bool:
    """Returns True if borrower_val passes min/max bounds."""
    try:
        bv = float(borrower_val)
        if not np.isnan(float(min_val)) and bv < float(min_val):
            return False
        if max_val is not None and not np.isnan(float(max_val)) and bv > float(max_val):
            return False
        return True
    except (TypeError, ValueError):
        return True   # can't evaluate → don't penalise


def _headroom(borrower_val, min_val, max_val=None) -> float:
    """
    Returns a 0-1 score indicating how comfortably borrower clears the rule.
    headroom = 1.0 means well above minimum; 0.0 means exactly at boundary.
    """
    try:
        bv = float(borrower_val)
        lo = float(min_val) if min_val is not None and not np.isnan(float(min_val)) else 0.0
        hi = float(max_val) if max_val is not None and not np.isnan(float(max_val)) else bv * 2
        span = hi - lo
        if span <= 0:
            return 1.0
        return min(max((bv - lo) / span, 0.0), 1.0)
    except (TypeError, ValueError):
        return 0.5   # unknown → neutral score


# ─────────────────────────────────────────────────────────────────────────────
# COMPUTE MATCH SCORE
# ─────────────────────────────────────────────────────────────────────────────
def compute_match_score(
    borrower: pd.Series,
    policies: pd.DataFrame,
) -> pd.DataFrame:
    """
    For a single borrower, compute MatchScore against every active lender policy.

    Uses exact column names matching the FinnUp consolidated Excel sheet:
      - Loan Amount Min / Max  (range)
      - CIBIL Score            (min)
      - Vintage (in months)    (min)
      - Count of Overdue Accounts     (max allowed)
      - cnt_dpd_90plus_last_12mo      (max allowed)
      - Suit Filed Count of Loans     (max allowed)
      - Total Number of Inward cheque bounces  (max allowed)
      - enquiry_last30days            (max allowed)

    Returns DataFrame with columns:
      lender_name, eligible (bool), match_score (0-1),
      rule_details (dict of individual scores)
    """
    results = []

    def _nv(series: pd.Series, *keys) -> float | None:
        """Get numeric value from series; exact key match first, then substring."""
        for k in keys:
            if k in series.index:
                try:
                    v = float(series[k])
                    if not np.isnan(v):
                        return v
                except (TypeError, ValueError):
                    pass
        # substring fallback
        for k in keys:
            for col in series.index:
                if k.lower() in str(col).lower():
                    try:
                        v = float(series[col])
                        if not np.isnan(v):
                            return v
                    except (TypeError, ValueError):
                        pass
        return None

    for _, policy in policies.iterrows():
        lender = str(policy.get("lender_name", "Unknown"))

        rule_scores: dict[str, float] = {}
        eligible = True

        # ── Loan amount (range) ──────────────────────────────────────────
        b_loan     = _nv(borrower, "Loan Amount Min", "loan_amount")
        p_loan_min = _nv(policy,   "Loan Amount Min")
        p_loan_max = _nv(policy,   "Loan Amount Max")
        if b_loan is not None and p_loan_min is not None:
            if b_loan < p_loan_min:
                eligible = False
            if p_loan_max is not None and b_loan > p_loan_max:
                eligible = False
            rule_scores["loan_amount"] = _headroom(b_loan, p_loan_min, p_loan_max)

        # ── CIBIL (min) ──────────────────────────────────────────────────
        b_cibil     = _nv(borrower, "CIBIL Score", "cibil")
        p_cibil_min = _nv(policy,   "CIBIL Score", "cibil")
        if b_cibil is not None and p_cibil_min is not None:
            if b_cibil < p_cibil_min:
                eligible = False
            rule_scores["cibil"] = _headroom(b_cibil, p_cibil_min, 900)

        # ── Vintage (min, in months) ─────────────────────────────────────
        b_vintage     = _nv(borrower, "Vintage (in months)", "vintage", "business_age")
        p_vintage_min = _nv(policy,   "Vintage (in months)", "vintage")
        if b_vintage is not None and p_vintage_min is not None:
            if b_vintage < p_vintage_min:
                eligible = False
            rule_scores["vintage"] = _headroom(b_vintage, p_vintage_min)

        # ── Overdue accounts (max allowed) ───────────────────────────────
        b_overdue     = _nv(borrower, "Count of Overdue Accounts")
        p_overdue_max = _nv(policy,   "Count of Overdue Accounts")
        if b_overdue is not None and p_overdue_max is not None:
            if b_overdue > p_overdue_max:
                eligible = False
            rule_scores["overdue"] = max(0.0, 1.0 - b_overdue / max(p_overdue_max, 1))

        # ── DPD 90+ (max allowed) ────────────────────────────────────────
        b_dpd90     = _nv(borrower, "cnt_dpd_90plus_last_12mo")
        p_dpd90_max = _nv(policy,   "cnt_dpd_90plus_last_12mo")
        if b_dpd90 is not None and p_dpd90_max is not None:
            if b_dpd90 > p_dpd90_max:
                eligible = False
            rule_scores["dpd90"] = max(0.0, 1.0 - b_dpd90 / max(p_dpd90_max, 1))

        # ── Suit filed (max allowed) ─────────────────────────────────────
        b_suit     = _nv(borrower, "Suit Filed Count of Loans")
        p_suit_max = _nv(policy,   "Suit Filed Count of Loans")
        if b_suit is not None and p_suit_max is not None:
            if b_suit > p_suit_max:
                eligible = False
            rule_scores["suit_filed"] = max(0.0, 1.0 - b_suit / max(p_suit_max, 1))

        # ── Inward cheque bounces (max allowed) ──────────────────────────
        b_inward     = _nv(borrower, "Total Number of Inward cheque bounces", "inward")
        p_inward_max = _nv(policy,   "Total Number of Inward cheque bounces", "inward")
        if b_inward is not None and p_inward_max is not None:
            if b_inward > p_inward_max:
                eligible = False
            rule_scores["inward_bounce"] = max(0.0, 1.0 - b_inward / max(p_inward_max, 1))

        # ── Enquiries last 30 days (max allowed) ─────────────────────────
        b_enq30     = _nv(borrower, "enquiry_last30days")
        p_enq30_max = _nv(policy,   "enquiry_last30days")
        if b_enq30 is not None and p_enq30_max is not None:
            if b_enq30 > p_enq30_max:
                eligible = False
            rule_scores["enquiries_30d"] = max(0.0, 1.0 - b_enq30 / max(p_enq30_max, 1))

        # ── MatchScore = mean of individual rule headroom scores ──────────
        if rule_scores:
            match_score = round(float(np.mean(list(rule_scores.values()))), 4)
        else:
            match_score = 0.5   # no rules checkable → neutral

        if not eligible:
            match_score = 0.0

        results.append({
            "lender_name":  lender,
            "eligible":     eligible,
            "match_score":  match_score,
            "rule_details": rule_scores,
        })

    return pd.DataFrame(results)


# ─────────────────────────────────────────────────────────────────────────────
# RANK LENDERS — Fixed weights (default 0.6/0.4)
# ─────────────────────────────────────────────────────────────────────────────
def rank_lenders(
    p_approved: float,
    match_df: pd.DataFrame,
    w1: float = DEFAULT_W1,
    w2: float = DEFAULT_W2,
    top_n: int = 3,
    min_p: float = MIN_P_APPROVED,
) -> pd.DataFrame:
    """
    Ranks eligible lenders by Combined Score.
    Combined Score = w1 * P(approved) + w2 * MatchScore

    Applies min_p floor — lenders below threshold excluded.
    Returns top_n lenders sorted by combined score.
    """
    df = match_df[match_df["eligible"]].copy()

    if p_approved < min_p:
        # Below floor — return warning, no recommendations
        return pd.DataFrame(columns=["lender_name", "match_score",
                                     "p_approved", "combined_score", "rank"])

    df["p_approved"]    = round(p_approved, 4)
    df["combined_score"] = round(w1 * p_approved + w2 * df["match_score"], 4)
    df = df.sort_values("combined_score", ascending=False).head(top_n)
    df["rank"] = range(1, len(df) + 1)

    return df[["lender_name", "match_score", "p_approved",
               "combined_score", "rank"]].reset_index(drop=True)


# ─────────────────────────────────────────────────────────────────────────────
# META-LEARNER — Learn optimal weights from historical outcomes
# ─────────────────────────────────────────────────────────────────────────────
def fit_meta_learner(
    p_approved_arr: np.ndarray,
    match_score_arr: np.ndarray,
    y_true: np.ndarray,
    cv_folds: int = 5,
) -> tuple[LogisticRegression, float, float]:
    """
    Learns optimal Engine 1 / Engine 2 combination weights using two strategies:
      1. Logistic Regression meta-model — fits on [P(approved), MatchScore] → y_true
      2. scipy.optimize exact search — maximises ROC-AUC of the combined score directly

    Saves the strategy that achieves higher ROC-AUC on the training data.

    Returns (meta_model, best_w1, best_w2).
    """
    from scipy.optimize import minimize_scalar

    print("\n" + "=" * 60)
    print("  Meta-Learner — Learning Optimal Engine 1 / Engine 2 Weights")
    print("=" * 60)

    X_meta = np.column_stack([p_approved_arr, match_score_arr])

    # ── Strategy 1: Logistic Regression ──────────────────────────────────────
    meta = LogisticRegression(C=1.0, fit_intercept=False, random_state=42, max_iter=500)
    skf = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
    cv_auc = cross_val_score(meta, X_meta, y_true, cv=skf, scoring="roc_auc")
    print(f"  LR meta-learner CV ROC-AUC: {cv_auc.mean():.4f} ± {cv_auc.std():.4f}")
    meta.fit(X_meta, y_true)
    raw_coefs = meta.coef_[0]

    coef_pos = np.maximum(raw_coefs, 0)
    total = coef_pos.sum()
    if total > 0:
        lr_w1, lr_w2 = (coef_pos / total).round(4)
    else:
        lr_w1, lr_w2 = DEFAULT_W1, DEFAULT_W2

    combined_lr = lr_w1 * p_approved_arr + lr_w2 * match_score_arr
    auc_lr = roc_auc_score(y_true, combined_lr)
    print(f"  LR coefficients (raw): Engine1={raw_coefs[0]:.4f}  Engine2={raw_coefs[1]:.4f}")
    print(f"  LR normalised weights: w1={lr_w1:.4f}  w2={lr_w2:.4f}  → ROC-AUC={auc_lr:.4f}")

    # ── Strategy 2: scipy exact optimisation ─────────────────────────────────
    def neg_auc(w1: float) -> float:
        combined = w1 * p_approved_arr + (1.0 - w1) * match_score_arr
        try:
            return -roc_auc_score(y_true, combined)
        except Exception:
            return 0.0

    opt = minimize_scalar(neg_auc, bounds=(0.0, 1.0), method="bounded")
    sp_w1 = round(float(opt.x), 4)
    sp_w2 = round(1.0 - sp_w1, 4)
    combined_sp = sp_w1 * p_approved_arr + sp_w2 * match_score_arr
    auc_sp = roc_auc_score(y_true, combined_sp)
    print(f"  Scipy optimal weights:  w1={sp_w1:.4f}  w2={sp_w2:.4f}  → ROC-AUC={auc_sp:.4f}")

    # ── Fixed baseline for comparison ─────────────────────────────────────────
    combined_fixed = DEFAULT_W1 * p_approved_arr + DEFAULT_W2 * match_score_arr
    auc_fixed = roc_auc_score(y_true, combined_fixed)
    print(f"  Fixed default 0.6/0.4:              w1={DEFAULT_W1}  w2={DEFAULT_W2}"
          f"  → ROC-AUC={auc_fixed:.4f}")

    # ── Pick the strategy with highest ROC-AUC ────────────────────────────────
    if auc_lr >= auc_sp:
        learned_w1, learned_w2 = lr_w1, lr_w2
        best_auc = auc_lr
        chosen = "LR meta-learner"
    else:
        learned_w1, learned_w2 = sp_w1, sp_w2
        best_auc = auc_sp
        chosen = "scipy exact search"

    improvement = (best_auc - auc_fixed) * 100
    print(f"\n  ✓ Chosen: {chosen}")
    print(f"  ✓ Final weights: w1={learned_w1:.4f}  w2={learned_w2:.4f}"
          f"  ROC-AUC={best_auc:.4f}  ({improvement:+.2f} pp vs fixed)")

    # ── Save ──────────────────────────────────────────────────────────────────
    meta_path = MODELS_DIR / "meta_learner.pkl"
    with open(meta_path, "wb") as f:
        pickle.dump({
            "meta_model":   meta,
            "learned_w1":   learned_w1,
            "learned_w2":   learned_w2,
            "lr_w1":        lr_w1,
            "lr_w2":        lr_w2,
            "scipy_w1":     sp_w1,
            "scipy_w2":     sp_w2,
            "auc_fixed":    round(auc_fixed, 4),
            "auc_lr":       round(auc_lr, 4),
            "auc_scipy":    round(auc_sp, 4),
            "auc_learned":  round(best_auc, 4),
            "method":       chosen,
        }, f)
    print(f"  Saved: {meta_path}")

    _plot_weight_comparison(DEFAULT_W1, learned_w1, auc_fixed, best_auc)

    return meta, learned_w1, learned_w2


def _plot_weight_comparison(w1_fixed, w1_learned, auc_fixed, auc_learned):
    fig, ax = plt.subplots(figsize=(7, 4))
    fig.patch.set_facecolor("#F5F7FA")
    ax.set_facecolor("#F0F4F8")

    bars = ax.bar(
        ["Fixed\n(0.6 / 0.4)", f"Learned\n({w1_learned:.2f} / {1-w1_learned:.2f})"],
        [auc_fixed, auc_learned],
        color=["#1B3A6B", "#0D9488"], edgecolor="white", width=0.4
    )
    for bar, val in zip(bars, [auc_fixed, auc_learned]):
        ax.text(bar.get_x() + bar.get_width() / 2, val + 0.002,
                f"{val:.4f}", ha="center", fontsize=11, fontweight="bold")

    ax.set_ylim(max(0, min(auc_fixed, auc_learned) - 0.05), 1.0)
    ax.set_ylabel("ROC-AUC", fontsize=10)
    ax.set_title("Fixed vs Learned Combination Weights", fontsize=12,
                 fontweight="bold", color="#1B3A6B")
    ax.grid(True, axis="y", alpha=0.3)
    plt.tight_layout()
    out = MODELS_DIR / "meta_weight_comparison.png"
    fig.savefig(out, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out}")


# ─────────────────────────────────────────────────────────────────────────────
# RANK LENDERS — Using learned meta weights
# ─────────────────────────────────────────────────────────────────────────────
def rank_lenders_meta(
    p_approved: float,
    match_df: pd.DataFrame,
    meta_path: str = None,
    top_n: int = 3,
    min_p: float = MIN_P_APPROVED,
) -> pd.DataFrame:
    """
    Same as rank_lenders() but uses learned w1/w2 from the saved meta-learner.
    Falls back to DEFAULT_W1/W2 if meta-learner not available.
    """
    w1, w2 = DEFAULT_W1, DEFAULT_W2

    if meta_path is None:
        meta_path = MODELS_DIR / "meta_learner.pkl"

    if Path(meta_path).exists():
        with open(meta_path, "rb") as f:
            saved = pickle.load(f)
        w1 = saved.get("learned_w1", DEFAULT_W1)
        w2 = saved.get("learned_w2", DEFAULT_W2)

    return rank_lenders(p_approved, match_df, w1=w1, w2=w2,
                        top_n=top_n, min_p=min_p)
