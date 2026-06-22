"""
src/features/engineering.py
----------------------------
Feature engineering + synthetic target creation for the
FinnUp MSME loan-approval prediction task.

The to_be_filled_Updated.xlsx sheet has 38 features per applicant.
We synthesise a binary target  loan_approved  so that exactly ~15 %
of applicants are labelled as approved, using a rules-based credit
scorecard that mirrors real MSME lending logic.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_PATH = Path(__file__).parents[2] / "Capstone_Consol Sheet_22.05.2026.xlsx"

# ── Column name aliases (handle any trailing-space variants) ──────────────────
def _col(df: pd.DataFrame, name: str) -> str:
    """Return the actual column name (strips whitespace) matching *name*."""
    for c in df.columns:
        if c.strip() == name.strip():
            return c
    raise KeyError(f"Column '{name}' not found. Available: {list(df.columns)}")


# ── 1. Load raw sheet ─────────────────────────────────────────────────────────
def load_raw(path: str | Path = DATA_PATH) -> pd.DataFrame:
    """
    Returns the merged dataset:
      Base : Loan Applications (6,735 rows — one row per application)
      Join : Total borrowers financial features (deduped on company, left-joined)
    This keeps each application as a distinct training sample so the same
    borrower applying for different products appears as separate rows.
    """
    la = pd.read_excel(path, sheet_name="Loan Applications")
    la.columns = [c.strip() for c in la.columns]

    tb = pd.read_excel(path, sheet_name="Total borrowers")
    tb.columns = [c.strip() for c in tb.columns]
    # Deduplicate Total borrowers: one financial profile per company
    tb_dedup = tb.drop_duplicates(subset="Variable", keep="first")
    tb_dedup = tb_dedup.rename(columns={"Variable": "company_name"})

    merged = la.merge(tb_dedup, on="company_name", how="left")
    return merged


# ── 2a. Real target — loanapplication_status + sanctioned_amount > 0 ─────────
def create_target_real(df: pd.DataFrame) -> pd.DataFrame:
    """
    Labels each application row (already merged in load_raw).

    Approved (y=1):
      loanapplication_status ∈ [Disbursed, Deal Sanctioned, Partially Disbursed]
      AND sanctioned_amount > 0

    6,735 Loan Application rows → 582 approved (8.6%)
    """
    approved_statuses = ["Disbursed", "Deal Sanctioned", "Partially Disbursed"]
    mask = (
        df["loanapplication_status"].isin(approved_statuses)
        & (pd.to_numeric(df["sanctioned_amount"], errors="coerce") > 0)
    )
    df = df.copy()
    df["loan_approved"] = mask.astype(int)
    print(f"  Real labels: {len(df):,} applications "
          f"| Approved: {df['loan_approved'].sum():,} ({df['loan_approved'].mean():.1%})"
          f" | Not approved: {(df['loan_approved'] == 0).sum():,}")
    return df


# ── 2b. Synthetic target fallback (used only when real labels unavailable) ────
def create_target(df: pd.DataFrame, target_rate: float = 0.10, seed: int = 42) -> pd.DataFrame:
    """
    Assigns loan_approved = 1 based on a weighted credit scorecard.

    Scorecard logic (mirrors real MSME lender criteria):
    ──────────────────────────────────────────────────────
    Feature                                 Points
    CIBIL Score >= 720                      +4
    CIBIL Score 700–719                     +2
    CIBIL Score 680–699                     +1
    CIBIL Score < 680 or == 1 (no-hit)      -3

    Count of Overdue Accounts == 0          +3
    Count of Overdue Accounts == 1          +1
    Count of Overdue Accounts >= 2          -2

    Total Overdue Amount == 0               +2
    Total Overdue Amount > 0               -1

    cnt_dpd_90plus_last_12mo == 0           +2
    cnt_dpd_90plus_last_12mo >= 1          -3

    Suit Filed Count of Loans == 0          +2
    Suit Filed Count of Loans >= 1         -4

    DSCR >= 1.25                            +3
    DSCR 1.10–1.24                          +2
    DSCR 0.90–1.09                          +1
    DSCR < 0.90                            -2

    Current Ratio >= 1.5                    +2
    Current Ratio 1.2–1.49                  +1
    Current Ratio < 1.2                    -1

    TOL/TNW <= 1.5                          +1
    TOL/TNW > 2.0                          -2

    Profit After Tax > 0                    +2
    Profit After Tax <= 0                  -2

    New sanction in last 30 days == 0       +1
    New sanction in last 30 days >= 2      -1

    enquiry_last30days <= 1                 +1
    enquiry_last30days >= 4               -1

    GST Filing past 3 months == "All filed" +1

    Top-x% of scores → approved (calibrated so ~15% approve)
    """
    df = df.copy()
    s = pd.Series(0.0, index=df.index)

    # CIBIL Score
    cibil = pd.to_numeric(df["CIBIL Score"], errors="coerce").fillna(0)
    s += np.where(cibil >= 720, 4,
         np.where(cibil >= 700, 2,
         np.where(cibil >= 680, 1, -3)))

    # Overdue Accounts
    oa = pd.to_numeric(df["Count of Overdue Accounts"], errors="coerce").fillna(0)
    s += np.where(oa == 0, 3, np.where(oa == 1, 1, -2))

    # Total Overdue Amount
    toa = pd.to_numeric(df["Total Overdue Amount"], errors="coerce").fillna(0)
    s += np.where(toa == 0, 2, -1)

    # DPD 90+
    dpd90 = pd.to_numeric(df["cnt_dpd_90plus_last_12mo"], errors="coerce").fillna(0)
    s += np.where(dpd90 == 0, 2, -3)

    # Suit Filed
    suit = pd.to_numeric(df["Suit Filed Count of Loans"], errors="coerce").fillna(0)
    s += np.where(suit == 0, 2, -4)

    # DSCR
    dscr = pd.to_numeric(df["DSCR (Avg/Min)"], errors="coerce").fillna(1.0)
    s += np.where(dscr >= 1.25, 3,
         np.where(dscr >= 1.10, 2,
         np.where(dscr >= 0.90, 1, -2)))

    # Current Ratio
    cr = pd.to_numeric(df["Current Ratio"], errors="coerce").fillna(1.0)
    s += np.where(cr >= 1.5, 2, np.where(cr >= 1.2, 1, -1))

    # TOL/TNW
    tol = pd.to_numeric(df["TOL/ TNW"], errors="coerce").fillna(1.5)
    s += np.where(tol <= 1.5, 1, np.where(tol > 2.0, -2, 0))

    # Profit After Tax
    pat = pd.to_numeric(df["Profit After Tax"], errors="coerce").fillna(0)
    s += np.where(pat > 0, 2, -2)

    # New sanction last 30 days
    ns30 = pd.to_numeric(df["New sanction in the last 30 days"], errors="coerce").fillna(0)
    s += np.where(ns30 == 0, 1, np.where(ns30 >= 2, -1, 0))

    # Enquiries last 30 days
    enq30 = pd.to_numeric(df["enquiry_last30days"], errors="coerce").fillna(0)
    s += np.where(enq30 <= 1, 1, np.where(enq30 >= 4, -1, 0))

    # GST Filing
    gst3 = df.get("GST Filing in the past 3 months", pd.Series("", index=df.index)).astype(str)
    s += np.where(gst3.str.lower().str.strip() == "all filed", 1, 0)

    # ── Calibrate threshold to hit exactly target_rate ──────────────────
    threshold = np.quantile(s, 1 - target_rate)
    df["credit_score"] = s
    df["loan_approved"] = (s >= threshold).astype(int)

    actual_rate = df["loan_approved"].mean()
    print(f"[target] threshold={threshold:.2f}  actual approval rate={actual_rate:.2%}  (target={target_rate:.0%})")
    return df


# ── 3. Feature Engineering ────────────────────────────────────────────────────
# LA columns to drop — IDs, dates, post-approval fields (leakage risk)
_LA_DROP = [
    "borrowercreated", "borrower_id", "loan_created_at", "loanrequest_id",
    "updated_at", "loan_app_created_at", "loan_updated_at", "loanapplication_id",
    "loanapplication_status",   # IS the target — must drop
    "finnup_status", "status",  # downstream of decision
    "fee_status", "repayment_status", "roi_status", "credit_line",
    "sanctioned_amount",        # defines label → leakage
    "lendermastername",         # only filled when approved → leakage
    "tenor", "roi",             # actual loan terms, post-approval → leakage
    "loan_amount_request",      # free-text range, not parseable
    "Loan Product",             # always 'UBL' in Total borrowers — no signal
]

CATEGORICAL_COLS = [
    "product_name",              # from Loan Applications — what was applied for
    "location",                  # from Loan Applications
    "Type of Entity",
    "Owned/Rented Property",
    "GST Filing in the past 3 months",
    "GST Filing in the past 6 months",
]

NUMERIC_COLS = [
    "Loan Amount Min", "Loan Amount Max",
    "Tenor Min", "Tenor Max",
    "Rate of interest Min", "Rate of interest Max",
    "Vintage (in months)", "Industry",
    "Age of applicant", "CIBIL Score",
    "Total number of active accounts", "Count of Overdue Accounts",
    "Total Overdue Amount",
    "New sanction in the last 30 days", "New sanction in the last 90 days",
    "enquiry_last7days", "enquiry_last30days",
    "cnt_dpd_0plus_last_12mo", "cnt_dpd_90plus_last_12mo",
    "Suit Filed Count of Loans",
    "Net Sales", "Profit After Tax", "Tangible Networth (TNW)",
    "TOL/ TNW", "Current Ratio", "DSCR (Avg/Min)",
    "Total Amount of Credit Transactions", "Total Amount of Debit Transactions",
    "Average EOD Balance",
    "Total Number of Inward cheque bounces",
    "Total Number of Outward cheque bounces",
]

DROP_COLS = ["company_name", "Pincode", "credit_score", "loan_approved"] + _LA_DROP


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Returns a feature matrix X (no target, no ID columns).
    Steps:
      1. Impute numerics with median
      2. Log-transform right-skewed financial columns
      3. Encode categoricals with one-hot
      4. Derived ratio features
    """
    df = df.copy()

    # ── Derived features ──────────────────────────────────────────────────────
    # Loan-to-turnover proxy
    df["loan_mid"] = (
        pd.to_numeric(df["Loan Amount Min"], errors="coerce") +
        pd.to_numeric(df["Loan Amount Max"], errors="coerce")
    ) / 2

    net_sales = pd.to_numeric(df["Net Sales"], errors="coerce").replace(0, np.nan)
    df["loan_to_sales_ratio"] = df["loan_mid"] / net_sales

    # Bank activity ratio
    credit_tx = pd.to_numeric(df["Total Amount of Credit Transactions"], errors="coerce").replace(0, np.nan)
    debit_tx   = pd.to_numeric(df["Total Amount of Debit Transactions"], errors="coerce")
    df["bank_credit_debit_ratio"] = debit_tx / credit_tx

    # Bounce rate
    total_bounces = (
        pd.to_numeric(df["Total Number of Inward cheque bounces"], errors="coerce").fillna(0) +
        pd.to_numeric(df["Total Number of Outward cheque bounces"], errors="coerce").fillna(0)
    )
    df["total_bounces"] = total_bounces

    # Interest rate spread
    df["rate_spread"] = (
        pd.to_numeric(df["Rate of interest Max"], errors="coerce") -
        pd.to_numeric(df["Rate of interest Min"], errors="coerce")
    )

    # Overdue flag
    df["has_overdue"] = (
        pd.to_numeric(df["Total Overdue Amount"], errors="coerce").fillna(0) > 0
    ).astype(int)

    # Profitable flag
    df["is_profitable"] = (
        pd.to_numeric(df["Profit After Tax"], errors="coerce").fillna(0) > 0
    ).astype(int)

    # ── Numeric imputation ────────────────────────────────────────────────────
    # Add LA numeric features available at application time (no leakage)
    _la_numeric = ["loan_min", "loan_max", "tenor_min", "tenor_max",
                   "roi_min", "roi_max"]
    for col in _la_numeric:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    num_cols_ext = NUMERIC_COLS + ["loan_mid", "loan_to_sales_ratio",
                                   "bank_credit_debit_ratio", "total_bounces",
                                   "rate_spread"] + _la_numeric
    for col in num_cols_ext:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            df[col] = df[col].fillna(df[col].median())

    # ── Log-transform right-skewed columns ───────────────────────────────────
    log_cols = [
        "Net Sales", "Profit After Tax", "Tangible Networth (TNW)",
        "Total Amount of Credit Transactions", "Total Amount of Debit Transactions",
        "Average EOD Balance", "Total Overdue Amount", "loan_mid",
    ]
    for col in log_cols:
        if col in df.columns:
            df[f"log_{col.replace('/', '_').replace(' ', '_')}"] = np.log1p(
                np.abs(df[col])
            )

    # ── Normalise product_name variants → canonical training values ─────────
    _PRODUCT_MAP = {
        "Bill Discounting":              "Bill Discounting/ Purchase financing",
        "Purchase Financing":            "Bill Discounting/ Purchase financing",
        "Purchase financing":            "Bill Discounting/ Purchase financing",
        "bill discounting":              "Bill Discounting/ Purchase financing",
        "purchase financing":            "Bill Discounting/ Purchase financing",
        "Bill Discounting/Purchase financing": "Bill Discounting/ Purchase financing",
        "Bill discounting/ Purchase financing": "Bill Discounting/ Purchase financing",
        "LAP":                           "Loan Against Property",
        "Cash Credit":                   "Cash Credit/WCDL",
        "WCDL":                          "Cash Credit/WCDL",
        "Overdraft":                     "Overdraft Facility",
    }
    if "product_name" in df.columns:
        df["product_name"] = df["product_name"].astype(str).str.strip().replace(_PRODUCT_MAP)

    # ── One-hot encode categoricals ───────────────────────────────────────────
    for col in CATEGORICAL_COLS:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
    df = pd.get_dummies(df, columns=[c for c in CATEGORICAL_COLS if c in df.columns],
                        drop_first=False, dtype=int)

    # ── Drop identifier/target columns ───────────────────────────────────────
    drop = [c for c in DROP_COLS if c in df.columns]
    df = df.drop(columns=drop)

    return df
