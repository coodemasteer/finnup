"""api/routers/analysis.py — /api/loan-analysis  historical loan data insights"""
from __future__ import annotations
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
warnings.filterwarnings("ignore")

from src.features.engineering import load_raw, create_target_real

router = APIRouter()

# Module-level cache — populated once on first request, reused forever
_CACHE: dict | None = None

# ── helpers ────────────────────────────────────────────────────────────────────

def _col(df: pd.DataFrame, name: str) -> str | None:
    for c in df.columns:
        if c.strip() == name.strip():
            return c
    return None


def _safe(df: pd.DataFrame, col: str) -> pd.Series:
    c = _col(df, col)
    return df[c] if c else pd.Series(dtype=float)


def _bucket_breakdown(series_all: pd.Series, labels_all: pd.Series,
                       bins: list, labels: list[str]) -> list[dict]:
    cats = pd.cut(pd.to_numeric(series_all, errors="coerce"), bins=bins, labels=labels, right=False)
    out = []
    for lbl in labels:
        mask = cats == lbl
        total = int(mask.sum())
        approved = int((mask & (labels_all == 1)).sum())
        out.append({"bucket": lbl, "total": total, "approved": approved,
                    "rejected": total - approved,
                    "rate": round(approved / total * 100, 1) if total else 0})
    return out


# ── endpoint ───────────────────────────────────────────────────────────────────

@router.get("/loan-analysis")
def loan_analysis():
    """Return pre-aggregated stats from the 6,735 historical MSME loan records.
    Result is cached in memory after the first call — data never changes."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE

    try:
        raw = load_raw()
        df  = create_target_real(raw)
    except Exception as exc:
        raise HTTPException(status_code=503,
                            detail=f"Could not load training data: {exc}")

    y = df["loan_approved"]
    total    = len(df)
    approved = int(y.sum())
    rejected = total - approved
    rate     = round(approved / total * 100, 2)

    # ── 1. Entity type breakdown ────────────────────────────────────────────
    ent_col = _col(df, "Type of Entity")
    if ent_col:
        grp = df.groupby(ent_col)["loan_approved"].agg(["count", "sum"]).reset_index()
        grp.columns = ["entity_type", "total", "approved"]
        grp["rejected"] = grp["total"] - grp["approved"]
        grp["rate"]     = (grp["approved"] / grp["total"] * 100).round(1)
        grp = grp.sort_values("total", ascending=False).head(8)
        by_entity = grp.to_dict("records")
    else:
        by_entity = []

    # ── 2. Product breakdown ───────────────────────────────────────────────
    prod_col = _col(df, "product_name")
    if prod_col:
        grp = df.groupby(prod_col)["loan_approved"].agg(["count", "sum"]).reset_index()
        grp.columns = ["product", "total", "approved"]
        grp["rejected"] = grp["total"] - grp["approved"]
        grp["rate"]     = (grp["approved"] / grp["total"] * 100).round(1)
        grp = grp.sort_values("total", ascending=False).head(10)
        by_product = grp.to_dict("records")
    else:
        by_product = []

    # ── 3. CIBIL score distribution ────────────────────────────────────────
    cibil_col = _col(df, "CIBIL Score")
    if cibil_col:
        cibil = pd.to_numeric(df[cibil_col], errors="coerce")
        by_cibil = _bucket_breakdown(
            cibil, y,
            bins=[0, 500, 600, 650, 700, 750, 850],
            labels=["< 500", "500–599", "600–649", "650–699", "700–749", "750+"]
        )
    else:
        by_cibil = []

    # ── 4. Vintage distribution ────────────────────────────────────────────
    vin_col = _col(df, "Vintage (in months)")
    if vin_col:
        vin = pd.to_numeric(df[vin_col], errors="coerce")
        by_vintage = _bucket_breakdown(
            vin, y,
            bins=[0, 12, 24, 36, 60, 120, 9999],
            labels=["< 1 yr", "1–2 yrs", "2–3 yrs", "3–5 yrs", "5–10 yrs", "10+ yrs"]
        )
    else:
        by_vintage = []

    # ── 5. Loan amount distribution (min requested) ─────────────────────────
    amt_col = _col(df, "Loan Amount Min")
    if amt_col:
        amt = pd.to_numeric(df[amt_col], errors="coerce") / 1e5   # → Lakhs
        by_amount = _bucket_breakdown(
            amt, y,
            bins=[0, 10, 25, 50, 100, 200, 999999],
            labels=["< ₹10L", "₹10–25L", "₹25–50L", "₹50–100L", "₹100–200L", "> ₹200L"]
        )
    else:
        by_amount = []

    # ── 6. Metric comparison: approved vs rejected ──────────────────────────
    def _stat(col_name: str) -> dict:
        col = _col(df, col_name)
        if not col:
            return {}
        s = pd.to_numeric(df[col], errors="coerce")
        return {
            "approved_mean": round(float(s[y == 1].mean()), 2) if (y == 1).any() else 0,
            "rejected_mean": round(float(s[y == 0].mean()), 2) if (y == 0).any() else 0,
            "approved_median": round(float(s[y == 1].median()), 2) if (y == 1).any() else 0,
            "rejected_median": round(float(s[y == 0].median()), 2) if (y == 0).any() else 0,
        }

    metric_comparison = {
        "CIBIL Score":             _stat("CIBIL Score"),
        "Vintage (months)":        _stat("Vintage (in months)"),
        "Net Sales (₹)":           _stat("Net Sales"),
        "Overdue Accounts":        _stat("Count of Overdue Accounts"),
        "DSCR":                    _stat("DSCR (Avg/Min)"),
        "Loan Amount Min (₹)":     _stat("Loan Amount Min"),
    }

    # ── 7. Recent approvals sample (top 20 by company name) ────────────────
    keep_cols = [c for c in [
        _col(df, "company_name"),
        _col(df, "product_name"),
        _col(df, "Type of Entity"),
        _col(df, "CIBIL Score"),
        _col(df, "Vintage (in months)"),
        _col(df, "Net Sales"),
        _col(df, "Loan Amount Min"),
        _col(df, "loanapplication_status"),
        _col(df, "sanctioned_amount"),
    ] if c] + ["loan_approved"]

    approved_df = df[df["loan_approved"] == 1][keep_cols].copy()
    # Rename for clean output
    rename = {
        _col(df, "company_name"):           "company_name",
        _col(df, "product_name"):           "product_name",
        _col(df, "Type of Entity"):         "entity_type",
        _col(df, "CIBIL Score"):            "cibil_score",
        _col(df, "Vintage (in months)"):    "vintage_months",
        _col(df, "Net Sales"):              "net_sales",
        _col(df, "Loan Amount Min"):        "loan_amount_min",
        _col(df, "loanapplication_status"): "status",
        _col(df, "sanctioned_amount"):      "sanctioned_amount",
    }
    approved_df = approved_df.rename(columns={k: v for k, v in rename.items() if k})
    approved_df = approved_df.head(50)

    # Convert NaN → None for JSON safety
    def _clean(val):
        if val is None:
            return None
        if isinstance(val, float) and np.isnan(val):
            return None
        return val

    approvals_list = [
        {k: _clean(v) for k, v in row.items() if k != "loan_approved"}
        for row in approved_df.to_dict("records")
    ]

    # ── 8. DPD 90+ breakdown ───────────────────────────────────────────────
    dpd_col = _col(df, "cnt_dpd_90plus_last_12mo")
    if dpd_col:
        grp = df.groupby(pd.to_numeric(df[dpd_col], errors="coerce")
                          .clip(0, 5).fillna(0).astype(int))["loan_approved"] \
               .agg(["count", "sum"]).reset_index()
        grp.columns = ["dpd_count", "total", "approved"]
        grp["dpd_label"] = grp["dpd_count"].apply(lambda x: f"DPD={x}" if x < 5 else "DPD=5+")
        grp["rate"] = (grp["approved"] / grp["total"] * 100).round(1)
        by_dpd = grp[["dpd_label", "total", "approved", "rate"]].to_dict("records")
    else:
        by_dpd = []

    _CACHE = {
        "summary": {
            "total": total,
            "approved": approved,
            "rejected": rejected,
            "approval_rate": rate,
        },
        "by_entity": by_entity,
        "by_product": by_product,
        "by_cibil": by_cibil,
        "by_vintage": by_vintage,
        "by_amount": by_amount,
        "by_dpd": by_dpd,
        "metric_comparison": metric_comparison,
        "approved_samples": approvals_list,
    }
    return _CACHE
