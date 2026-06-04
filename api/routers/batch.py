"""api/routers/batch.py — /api/batch-score endpoint"""
from __future__ import annotations
import pickle
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
warnings.filterwarnings("ignore")

from api.schemas import BatchScoreResponse, BatchRow
from src.features.engineering import engineer_features, load_raw, create_target_real

router = APIRouter()

MODELS_PATH = Path("outputs/models/all_models.pkl")


@router.post("/batch-score", response_model=BatchScoreResponse)
def batch_score():
    if not MODELS_PATH.exists():
        raise HTTPException(status_code=503, detail="No trained model found. Run /api/train first.")

    with open(MODELS_PATH, "rb") as f:
        saved = pickle.load(f)
    models    = saved["models"]
    feat_names = saved["features"]

    raw_all = load_raw()
    df_all  = create_target_real(raw_all)
    total   = len(df_all)

    X_all = engineer_features(df_all)
    for c in feat_names:
        if c not in X_all.columns:
            X_all[c] = 0
    X_all = X_all[feat_names]

    best_mdl = models.get("best") or list(models.values())[0]
    proba    = best_mdl.predict_proba(X_all)[:, 1]

    keep = [c for c in ["company_name", "product_name", "CIBIL Score",
                         "Vintage (in months)", "Net Sales",
                         "Count of Overdue Accounts", "Type of Entity"]
            if c in df_all.columns]
    result_df = df_all[keep + ["loan_approved"]].copy()
    result_df["p_approved"] = proba
    result_df = result_df.sort_values("p_approved", ascending=False).reset_index(drop=True)

    confirmed_approved = int((df_all["loan_approved"] == 1).sum())
    confirmed_rejected = int((df_all["loan_approved"] == 0).sum())
    ar = confirmed_approved / total if total > 0 else 0.0864  # base approval rate

    def _risk_band(p: float) -> str:
        # Bands relative to dataset approval rate, not arbitrary absolutes
        if p >= 4 * ar: return "Prime"      # 4× avg ≈ top borrowers
        if p >= 2 * ar: return "Strong"     # 2–4× avg
        if p >= ar:     return "Moderate"   # at or above average
        return "Watch"                       # below average approval odds

    rows = []
    for i, r in result_df.iterrows():
        rows.append(BatchRow(
            index=int(i) + 1,
            company_name=str(r["company_name"]) if "company_name" in r else None,
            product_name=str(r["product_name"]) if "product_name" in r else None,
            cibil_score=float(r["CIBIL Score"]) if "CIBIL Score" in r and pd.notna(r.get("CIBIL Score")) else None,
            vintage=float(r["Vintage (in months)"]) if "Vintage (in months)" in r and pd.notna(r.get("Vintage (in months)")) else None,
            net_sales=round(float(r["Net Sales"]) / 100_000, 2) if "Net Sales" in r and pd.notna(r.get("Net Sales")) else None,
            overdue_accounts=float(r["Count of Overdue Accounts"]) if "Count of Overdue Accounts" in r and pd.notna(r.get("Count of Overdue Accounts")) else None,
            entity_type=str(r["Type of Entity"]) if "Type of Entity" in r else None,
            p_approved_pct=round(float(r["p_approved"]) * 100, 1),
            label="Confirmed Approved" if int(r["loan_approved"]) == 1 else "Not Approved",
            risk_band=_risk_band(float(r["p_approved"])),
        ))

    return BatchScoreResponse(
        total=total,
        high_prob=int((proba >= 4 * ar).sum()),
        medium_prob=int(((proba >= ar) & (proba < 4 * ar)).sum()),
        low_prob=int((proba < ar).sum()),
        confirmed_approved=confirmed_approved,
        confirmed_rejected=confirmed_rejected,
        rows=rows,
        histogram=[round(float(p), 4) for p in proba],
    )


def _score_dataframe(df_raw: pd.DataFrame) -> BatchScoreResponse:
    """Core scoring logic shared by both endpoints."""
    if not MODELS_PATH.exists():
        raise HTTPException(status_code=503, detail="No trained model found. Run /api/train first.")

    with open(MODELS_PATH, "rb") as f:
        saved = pickle.load(f)
    models     = saved["models"]
    feat_names = saved["features"]

    # Ensure target column exists (use 0 if unknown)
    if "loan_approved" not in df_raw.columns:
        df_raw["loan_approved"] = 0

    X_all = engineer_features(df_raw)
    for c in feat_names:
        if c not in X_all.columns:
            X_all[c] = 0
    X_all = X_all[feat_names]

    best_mdl = models.get("best") or list(models.values())[0]
    proba    = best_mdl.predict_proba(X_all)[:, 1]

    keep = [c for c in ["company_name", "product_name", "CIBIL Score",
                         "Vintage (in months)", "Net Sales",
                         "Count of Overdue Accounts", "Type of Entity"]
            if c in df_raw.columns]
    result_df = df_raw[keep + ["loan_approved"]].copy()
    result_df["p_approved"] = proba
    result_df = result_df.sort_values("p_approved", ascending=False).reset_index(drop=True)

    confirmed_approved = int((df_raw["loan_approved"] == 1).sum())
    confirmed_rejected = int((df_raw["loan_approved"] == 0).sum())
    _n = len(df_raw)
    ar = confirmed_approved / _n if _n > 0 else 0.0864

    def _risk_band(p: float) -> str:
        if p >= 4 * ar: return "Prime"
        if p >= 2 * ar: return "Strong"
        if p >= ar:     return "Moderate"
        return "Watch"

    rows = []
    for i, r in result_df.iterrows():
        rows.append(BatchRow(
            index=int(i) + 1,
            company_name=str(r["company_name"]) if "company_name" in r else None,
            product_name=str(r["product_name"]) if "product_name" in r else None,
            cibil_score=float(r["CIBIL Score"]) if "CIBIL Score" in r and pd.notna(r.get("CIBIL Score")) else None,
            vintage=float(r["Vintage (in months)"]) if "Vintage (in months)" in r and pd.notna(r.get("Vintage (in months)")) else None,
            net_sales=round(float(r["Net Sales"]) / 100_000, 2) if "Net Sales" in r and pd.notna(r.get("Net Sales")) else None,
            overdue_accounts=float(r["Count of Overdue Accounts"]) if "Count of Overdue Accounts" in r and pd.notna(r.get("Count of Overdue Accounts")) else None,
            entity_type=str(r["Type of Entity"]) if "Type of Entity" in r else None,
            p_approved_pct=round(float(r["p_approved"]) * 100, 1),
            label="Confirmed Approved" if int(r["loan_approved"]) == 1 else "Not Approved",
            risk_band=_risk_band(float(r["p_approved"])),
        ))

    return BatchScoreResponse(
        total=len(df_raw),
        high_prob=int((proba >= 4 * ar).sum()),
        medium_prob=int(((proba >= ar) & (proba < 4 * ar)).sum()),
        low_prob=int((proba < ar).sum()),
        confirmed_approved=confirmed_approved,
        confirmed_rejected=confirmed_rejected,
        rows=rows,
        histogram=[round(float(p), 4) for p in proba],
    )
