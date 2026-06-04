"""
train.py — FinnUp Loan Approval Prediction: Full Training Pipeline
------------------------------------------------------------------
Labels    : 'Approved loans' sheet  (Disbursement Status = Disbursed)
Features  : 'Total borrowers' sheet (38 financial/credit features)
Models    : Logistic Regression | Random Forest | XGBoost | LightGBM
Ensembles : AUC-Weighted Average + Stacking (OOF meta-learner)
Outputs   : outputs/models/  (pkl, json, png)

Usage:
    python train.py
"""

from __future__ import annotations

import sys
import asyncio
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from src.features.engineering import load_raw, create_target_real, engineer_features
from src.models.trainer import (
    train_and_evaluate,
    build_weighted_ensemble,
    build_stacking_ensemble,
    optimise_combination_weights,
)
from src.models.lender_matcher import (
    load_policies,
    compute_match_score,
    fit_meta_learner,
)

# ── Config ─────────────────────────────────────────────────────────────────────
TEST_SIZE  = 0.20
CV_FOLDS   = 5
USE_SMOTE  = True
RANDOM_STATE = 42

print("=" * 65)
print("  FinnUp — MSME Loan Approval Prediction")
print("  Full Training Pipeline")
print("=" * 65)

# ── 1. Load raw data ───────────────────────────────────────────────────────────
print("\n[1/7] Loading 'Total borrowers' sheet...")
raw = load_raw()
print(f"  Rows: {raw.shape[0]:,}  |  Columns: {raw.shape[1]}")

# ── 2. Create ground-truth labels from 'Approved loans' sheet ─────────────────
print("\n[2/7] Labelling from 'Approved loans' sheet...")
df = create_target_real(raw)

# ── 3. Feature engineering ────────────────────────────────────────────────────
print("\n[3/7] Engineering features...")
X = engineer_features(df)
y = df["loan_approved"]
print(f"  Feature matrix: {X.shape[1]} features × {X.shape[0]:,} rows")
print(f"  Label distribution: Approved={y.sum():,} ({y.mean():.2%})  "
      f"Not approved={(y==0).sum():,} ({(y==0).mean():.2%})")

# ── 4. Train / test split (stratified) ────────────────────────────────────────
print("\n[4/7] Splitting data...")
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
)
print(f"  Train: {len(X_train):,} rows  |  Test: {len(X_test):,} rows")
print(f"  Approval rate — Train: {y_train.mean():.2%}  |  Test: {y_test.mean():.2%}")

# ── 5. Train individual models (LR, RF, XGBoost, LightGBM) ───────────────────
print("\n[5/7] Training models...")
best_name, all_metrics = train_and_evaluate(
    X_train, X_test, y_train, y_test,
    use_smote=USE_SMOTE,
    cv_folds=CV_FOLDS,
)

print(f"\n  Best single model: {best_name}")
print(f"  {'Model':<25} {'ROC-AUC':>8} {'PR-AUC':>8} {'F1':>8}")
print(f"  {'-'*53}")
for name, m in all_metrics.items():
    print(f"  {name:<25} {m['roc_auc']:>8.4f} {m['pr_auc']:>8.4f} {m['f1']:>8.4f}")

# ── 6. Ensembles ──────────────────────────────────────────────────────────────
print("\n[6/7] Building ensembles...")

import pickle
with open("outputs/models/all_models.pkl", "rb") as f:
    trained_models = pickle.load(f)["models"]

weighted_proba, weighted_metrics = build_weighted_ensemble(
    trained_models, all_metrics, X_test, y_test
)
stacked_proba, stacked_metrics = build_stacking_ensemble(
    trained_models, X_train, X_test, y_train, y_test, cv_folds=CV_FOLDS
)

print(f"\n  Weighted Ensemble  — ROC-AUC: {weighted_metrics['roc_auc']:.4f}  "
      f"PR-AUC: {weighted_metrics['pr_auc']:.4f}  F1: {weighted_metrics['f1']:.4f}")
print(f"  Stacking Ensemble  — ROC-AUC: {stacked_metrics['roc_auc']:.4f}  "
      f"PR-AUC: {stacked_metrics['pr_auc']:.4f}  F1: {stacked_metrics['f1']:.4f}")

# Pick the better ensemble
best_proba = (
    stacked_proba
    if stacked_metrics["roc_auc"] >= weighted_metrics["roc_auc"]
    else weighted_proba
)
best_ensemble = (
    "Stacking"
    if stacked_metrics["roc_auc"] >= weighted_metrics["roc_auc"]
    else "Weighted"
)
print(f"  Using {best_ensemble} ensemble for weight optimisation.")

# ── 7. Weight optimisation (Engine 1 ML vs Engine 2 MatchScore) ───────────────
print("\n[7/7] Optimising Engine 1 / Engine 2 weights...")

pol_df = load_policies()
match_means = []
for idx in X_test.index:
    match_df = compute_match_score(df.loc[idx], pol_df)
    eligible  = match_df[match_df["eligible"]]["match_score"]
    match_means.append(float(eligible.mean()) if len(eligible) > 0 else 0.0)
match_arr = np.array(match_means)

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

print(f"\n  Grid-search best:  w1(ML)={bw1:.2f}  w2(Match)={bw2:.2f}")
print(f"  Meta-learner:      w1(ML)={lw1:.4f}  w2(Match)={lw2:.4f}")

# ── Done ───────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print("  Training complete.  All artifacts saved to outputs/models/")
print("=" * 65)
print("\n  Launch the app:  python run.py")
print("                   http://localhost:8501\n")
