"""
src/models/trainer.py
---------------------
Trains, evaluates, and persists multiple classifiers for the
FinnUp MSME loan-approval prediction task.

Models trained:
  1. Logistic Regression  (baseline)
  2. Random Forest        (tree ensemble)
  3. XGBoost              (gradient boosting)
  4. LightGBM             (fast gradient boosting)

Evaluation metrics: ROC-AUC, PR-AUC, F1, Precision, Recall, Brier Score
Outputs saved to  outputs/models/
"""

from __future__ import annotations

import json
import pickle
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, StackingClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.metrics import (
    roc_auc_score, average_precision_score, f1_score,
    precision_score, recall_score, brier_score_loss,
    roc_curve, precision_recall_curve, confusion_matrix,
    ConfusionMatrixDisplay,
)
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.calibration import CalibratedClassifierCV
from imblearn.over_sampling import SMOTE

try:
    from xgboost import XGBClassifier
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

try:
    from lightgbm import LGBMClassifier
    HAS_LGB = True
except ImportError:
    HAS_LGB = False

warnings.filterwarnings("ignore")

# ── Paths ─────────────────────────────────────────────────────────────────────
MODELS_DIR = Path("outputs") / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ── Brand colours ─────────────────────────────────────────────────────────────
NAVY  = "#1B3A6B"
TEAL  = "#0D9488"
AMBER = "#F59E0B"
RED   = "#EF4444"
GREEN = "#16A34A"
PURPLE= "#7C3AED"


# ── Helpers ───────────────────────────────────────────────────────────────────
def _evaluate(name: str, model, X_test: pd.DataFrame,
              y_test: pd.Series) -> dict[str, Any]:
    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)

    metrics = {
        "model":         name,
        "roc_auc":       round(roc_auc_score(y_test, y_prob), 4),
        "pr_auc":        round(average_precision_score(y_test, y_prob), 4),
        "f1":            round(f1_score(y_test, y_pred), 4),
        "precision":     round(precision_score(y_test, y_pred, zero_division=0), 4),
        "recall":        round(recall_score(y_test, y_pred, zero_division=0), 4),
        "brier_score":   round(brier_score_loss(y_test, y_prob), 4),
    }
    return metrics, y_prob


def _plot_roc_pr(results: list[tuple], y_test: pd.Series, save_dir: Path):
    """Side-by-side ROC and PR curves for all models."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    fig.patch.set_facecolor("#F5F7FA")

    colors = [NAVY, TEAL, AMBER, RED, GREEN, PURPLE]
    for (name, model, X_test), color in zip(results, colors):
        y_prob = model.predict_proba(X_test)[:, 1]

        # ROC
        fpr, tpr, _ = roc_curve(y_test, y_prob)
        auc_val = roc_auc_score(y_test, y_prob)
        axes[0].plot(fpr, tpr, color=color, lw=2, label=f"{name} (AUC={auc_val:.3f})")

        # PR
        prec, rec, _ = precision_recall_curve(y_test, y_prob)
        pr_auc = average_precision_score(y_test, y_prob)
        axes[1].plot(rec, prec, color=color, lw=2, label=f"{name} (AUC={pr_auc:.3f})")

    for ax, title, xl, yl in [
        (axes[0], "ROC Curve", "False Positive Rate", "True Positive Rate"),
        (axes[1], "Precision-Recall Curve", "Recall", "Precision"),
    ]:
        ax.set_facecolor("#F0F4F8")
        ax.set_title(title, fontsize=13, fontweight="bold", color=NAVY)
        ax.set_xlabel(xl, fontsize=10); ax.set_ylabel(yl, fontsize=10)
        ax.legend(fontsize=8); ax.grid(True, alpha=0.3)

    axes[0].plot([0, 1], [0, 1], "k--", lw=1, alpha=0.5)

    plt.tight_layout()
    out = save_dir / "roc_pr_curves.png"
    fig.savefig(out, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out}")


def _plot_confusion(name: str, model, X_test, y_test, save_dir: Path):
    y_pred = model.predict(X_test)
    cm = confusion_matrix(y_test, y_pred)
    fig, ax = plt.subplots(figsize=(5, 4))
    fig.patch.set_facecolor("#F5F7FA")
    disp = ConfusionMatrixDisplay(cm, display_labels=["Rejected", "Approved"])
    disp.plot(ax=ax, colorbar=False, cmap="Blues")
    ax.set_title(f"Confusion Matrix — {name}", fontsize=11, fontweight="bold", color=NAVY)
    plt.tight_layout()
    fname = name.lower().replace(" ", "_")
    out = save_dir / f"confusion_{fname}.png"
    fig.savefig(out, dpi=130, bbox_inches="tight")
    plt.close(fig)


def _plot_feature_importance(name: str, model, feature_names: list[str],
                             save_dir: Path, top_n: int = 20):
    """Works for tree models and LR (coefficients)."""
    try:
        if hasattr(model, "named_steps"):
            est = model.named_steps.get("clf") or list(model.named_steps.values())[-1]
        else:
            est = model

        if hasattr(est, "feature_importances_"):
            imp = est.feature_importances_
        elif hasattr(est, "coef_"):
            imp = np.abs(est.coef_[0])
        else:
            return

        idx = np.argsort(imp)[-top_n:]
        fig, ax = plt.subplots(figsize=(9, 6))
        fig.patch.set_facecolor("#F5F7FA")
        ax.set_facecolor("#F0F4F8")
        bars = ax.barh(
            [feature_names[i] for i in idx],
            imp[idx],
            color=TEAL, edgecolor="white"
        )
        ax.set_title(f"Top {top_n} Features — {name}", fontsize=12,
                     fontweight="bold", color=NAVY)
        ax.set_xlabel("Importance", fontsize=10)
        ax.tick_params(axis="y", labelsize=8)
        ax.grid(True, axis="x", alpha=0.3)
        plt.tight_layout()
        fname = name.lower().replace(" ", "_")
        out = save_dir / f"feature_importance_{fname}.png"
        fig.savefig(out, dpi=130, bbox_inches="tight")
        plt.close(fig)
        print(f"  Saved: {out}")
    except Exception as e:
        print(f"  [warn] Feature importance failed for {name}: {e}")


def _plot_metrics_comparison(all_metrics: list[dict], save_dir: Path):
    metrics_df = pd.DataFrame(all_metrics)
    metrics_df = metrics_df.set_index("model")
    plot_cols = ["roc_auc", "pr_auc", "f1", "precision", "recall"]

    fig, ax = plt.subplots(figsize=(12, 5))
    fig.patch.set_facecolor("#F5F7FA")
    ax.set_facecolor("#F0F4F8")

    x = np.arange(len(metrics_df))
    width = 0.15
    colors = [NAVY, TEAL, AMBER, RED, GREEN]
    for i, (col, color) in enumerate(zip(plot_cols, colors)):
        ax.bar(x + i * width, metrics_df[col], width, label=col.upper().replace("_", " "),
               color=color, edgecolor="white")

    ax.set_xticks(x + width * 2)
    ax.set_xticklabels(metrics_df.index, fontsize=10)
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Score", fontsize=10)
    ax.set_title("Model Comparison — All Metrics", fontsize=13,
                 fontweight="bold", color=NAVY)
    ax.legend(fontsize=8, ncol=5)
    ax.grid(True, axis="y", alpha=0.3)
    plt.tight_layout()
    out = save_dir / "model_comparison.png"
    fig.savefig(out, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out}")


# ── Main training function ────────────────────────────────────────────────────
def train_and_evaluate(
    X_train: pd.DataFrame,
    X_test: pd.DataFrame,
    y_train: pd.Series,
    y_test: pd.Series,
    use_smote: bool = True,
    cv_folds: int = 5,
) -> tuple[dict, dict]:
    """
    Trains all models, evaluates, saves artifacts.
    Returns (best_model_name, all_metrics_dict).
    """
    print("\n" + "=" * 60)
    print("  FinnUp — Loan Approval Prediction Model Training")
    print("=" * 60)
    print(f"  Train: {len(X_train):,} rows  |  Test: {len(X_test):,} rows")
    print(f"  Approval rate — Train: {y_train.mean():.2%}  Test: {y_test.mean():.2%}")

    feature_names = list(X_train.columns)

    # ── SMOTE to handle class imbalance ──────────────────────────────────────
    if use_smote:
        sm = SMOTE(random_state=42, k_neighbors=5)
        X_res, y_res = sm.fit_resample(X_train, y_train)
        print(f"  After SMOTE: {len(X_res):,} rows  |  Approval: {y_res.mean():.2%}")
    else:
        X_res, y_res = X_train, y_train

    # ── Model definitions ─────────────────────────────────────────────────────
    neg_pos_ratio = (y_res == 0).sum() / max((y_res == 1).sum(), 1)

    model_defs = {
        "Logistic Regression": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(
                max_iter=1000, C=0.1, class_weight="balanced", random_state=42
            )),
        ]),
        "Random Forest": RandomForestClassifier(
            n_estimators=200, max_depth=8, min_samples_leaf=10,
            class_weight="balanced", random_state=42, n_jobs=1
        ),
    }

    if HAS_XGB:
        model_defs["XGBoost"] = XGBClassifier(
            n_estimators=400, max_depth=6, learning_rate=0.03,
            subsample=0.8, colsample_bytree=0.75, colsample_bylevel=0.75,
            min_child_weight=5,       # avoids splits on too few samples — helps imbalance
            gamma=0.1,                # min loss reduction required for a split
            reg_alpha=0.05,           # L1 regularisation
            reg_lambda=1.5,           # L2 regularisation
            max_delta_step=1,         # stabilises updates for imbalanced classes
            scale_pos_weight=neg_pos_ratio,
            eval_metric="logloss", random_state=42,
            verbosity=0, use_label_encoder=False,
        )

    if HAS_LGB:
        model_defs["LightGBM"] = LGBMClassifier(
            n_estimators=400, num_leaves=40, max_depth=6, learning_rate=0.03,
            subsample=0.8, colsample_bytree=0.75,
            min_child_samples=20,     # minimum data in a leaf
            reg_alpha=0.05, reg_lambda=1.5,
            scale_pos_weight=neg_pos_ratio,
            random_state=42, verbose=-1, n_jobs=1,
        )

    # ── Train, CV, Evaluate ───────────────────────────────────────────────────
    all_metrics = []
    trained_models = {}
    roc_results = []

    skf = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)

    for name, model in model_defs.items():
        print(f"\n  Training: {name}")
        model.fit(X_res, y_res)

        cv_scores = cross_val_score(model, X_train, y_train,
                                    cv=skf, scoring="roc_auc", n_jobs=1)
        print(f"    CV ROC-AUC: {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

        metrics, _ = _evaluate(name, model, X_test, y_test)
        metrics["cv_roc_auc_mean"] = round(cv_scores.mean(), 4)
        metrics["cv_roc_auc_std"]  = round(cv_scores.std(), 4)
        all_metrics.append(metrics)
        trained_models[name] = model
        roc_results.append((name, model, X_test))

        print(f"    Test ROC-AUC: {metrics['roc_auc']}  PR-AUC: {metrics['pr_auc']}  F1: {metrics['f1']}")

        # Save confusion matrix
        _plot_confusion(name, model, X_test, y_test, MODELS_DIR)

        # Save feature importance
        _plot_feature_importance(name, model, feature_names, MODELS_DIR)

    # ── Summary plots ─────────────────────────────────────────────────────────
    _plot_roc_pr(roc_results, y_test, MODELS_DIR)
    _plot_metrics_comparison(all_metrics, MODELS_DIR)

    # ── Save metrics JSON ─────────────────────────────────────────────────────
    metrics_path = MODELS_DIR / "metrics.json"
    with open(metrics_path, "w") as f:
        json.dump(all_metrics, f, indent=2)
    print(f"\n  Saved metrics: {metrics_path}")

    # ── Pick best model by ROC-AUC ────────────────────────────────────────────
    best = max(all_metrics, key=lambda x: x["roc_auc"])
    best_name = best["model"]
    best_model = trained_models[best_name]
    print(f"\n  Best model: {best_name}  (ROC-AUC={best['roc_auc']})")

    # ── Save best model ───────────────────────────────────────────────────────
    # Compute training medians for robust imputation at predict time
    train_medians = {
        col: float(v) for col, v in X_train.median(numeric_only=True).items()
        if not np.isnan(v)
    }
    # Compute score distribution percentiles so predict endpoint can rank new borrowers
    train_scores = best_model.predict_proba(X_train)[:, 1]
    score_percentiles = {
        str(p): float(np.percentile(train_scores, p))
        for p in [10, 20, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95]
    }
    approval_rate = float(y_train.mean())
    model_path = MODELS_DIR / "best_model.pkl"
    with open(model_path, "wb") as f:
        pickle.dump({"model": best_model, "features": feature_names,
                     "name": best_name, "train_medians": train_medians,
                     "score_percentiles": score_percentiles,
                     "approval_rate": approval_rate}, f)
    print(f"  Saved model: {model_path}")

    # ── Save all models ───────────────────────────────────────────────────────
    all_models_path = MODELS_DIR / "all_models.pkl"
    with open(all_models_path, "wb") as f:
        pickle.dump({"models": trained_models, "features": feature_names}, f)

    print("\n" + "=" * 60)
    return best_name, {m["model"]: m for m in all_metrics}


# ── Ensemble: Weighted Average ────────────────────────────────────────────────
def build_weighted_ensemble(
    trained_models: dict,
    all_metrics: dict,
    X_test: pd.DataFrame,
    y_test: pd.Series,
) -> tuple[np.ndarray, dict]:
    """
    Combines all trained models via AUC-weighted average of predicted probabilities.
    Returns (ensemble_proba, metrics_dict).
    """
    print("\n" + "=" * 60)
    print("  Ensemble — AUC-Weighted Average")
    print("=" * 60)

    weights = {name: m["roc_auc"] for name, m in all_metrics.items()}
    total_w = sum(weights.values())
    weights = {k: v / total_w for k, v in weights.items()}

    print("  Weights:")
    for name, w in weights.items():
        print(f"    {name}: {w:.4f}")

    ensemble_proba = np.zeros(len(y_test))
    for name, model in trained_models.items():
        p = model.predict_proba(X_test)[:, 1]
        ensemble_proba += weights[name] * p

    metrics = {
        "model":       "Weighted Ensemble",
        "roc_auc":     round(roc_auc_score(y_test, ensemble_proba), 4),
        "pr_auc":      round(average_precision_score(y_test, ensemble_proba), 4),
        "f1":          round(f1_score(y_test, (ensemble_proba >= 0.5).astype(int)), 4),
        "precision":   round(precision_score(y_test, (ensemble_proba >= 0.5).astype(int), zero_division=0), 4),
        "recall":      round(recall_score(y_test, (ensemble_proba >= 0.5).astype(int), zero_division=0), 4),
        "brier_score": round(brier_score_loss(y_test, ensemble_proba), 4),
        "weights":     weights,
    }

    print(f"  Weighted Ensemble — ROC-AUC: {metrics['roc_auc']}  PR-AUC: {metrics['pr_auc']}  F1: {metrics['f1']}")

    # Save ensemble proba
    ensemble_path = MODELS_DIR / "ensemble_proba.npy"
    np.save(ensemble_path, ensemble_proba)

    return ensemble_proba, metrics


# ── Ensemble: Stacking ────────────────────────────────────────────────────────
def build_stacking_ensemble(
    trained_models: dict,
    X_train: pd.DataFrame,
    X_test: pd.DataFrame,
    y_train: pd.Series,
    y_test: pd.Series,
    cv_folds: int = 5,
) -> tuple[np.ndarray, dict]:
    """
    Stacking ensemble: Level-1 models generate OOF predictions, 
    Level-2 Logistic Regression meta-model learns optimal combination.
    Returns (stacked_proba, metrics_dict).
    """
    print("\n" + "=" * 60)
    print("  Ensemble — Stacking (OOF Meta-Learner)")
    print("=" * 60)

    skf = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
    model_names = list(trained_models.keys())
    n_models = len(model_names)

    # ── Generate out-of-fold predictions for meta-training ──
    oof_preds = np.zeros((len(X_train), n_models))
    for fold_idx, (tr_idx, val_idx) in enumerate(skf.split(X_train, y_train)):
        X_tr, X_val = X_train.iloc[tr_idx], X_train.iloc[val_idx]
        y_tr = y_train.iloc[tr_idx]
        for mi, (name, model) in enumerate(trained_models.items()):
            # Clone and refit on fold — use same class for a fresh instance
            import copy
            fold_model = copy.deepcopy(model)
            fold_model.fit(X_tr, y_tr)
            oof_preds[val_idx, mi] = fold_model.predict_proba(X_val)[:, 1]

    # ── Level-1 test predictions (average across all folds) ──
    test_preds = np.column_stack([
        model.predict_proba(X_test)[:, 1]
        for model in trained_models.values()
    ])

    # ── Level-2 meta-model ──
    meta = LogisticRegression(C=1.0, random_state=42, max_iter=500)
    meta.fit(oof_preds, y_train)
    stacked_proba = meta.predict_proba(test_preds)[:, 1]

    # Print learned meta-weights
    print("  Meta-model learned coefficients (Level-2 weights):")
    for name, coef in zip(model_names, meta.coef_[0]):
        print(f"    {name}: {coef:.4f}")

    metrics = {
        "model":       "Stacking Ensemble",
        "roc_auc":     round(roc_auc_score(y_test, stacked_proba), 4),
        "pr_auc":      round(average_precision_score(y_test, stacked_proba), 4),
        "f1":          round(f1_score(y_test, (stacked_proba >= 0.5).astype(int)), 4),
        "precision":   round(precision_score(y_test, (stacked_proba >= 0.5).astype(int), zero_division=0), 4),
        "recall":      round(recall_score(y_test, (stacked_proba >= 0.5).astype(int), zero_division=0), 4),
        "brier_score": round(brier_score_loss(y_test, stacked_proba), 4),
        "meta_coefs":  dict(zip(model_names, [round(c, 4) for c in meta.coef_[0]])),
    }

    print(f"  Stacking Ensemble — ROC-AUC: {metrics['roc_auc']}  PR-AUC: {metrics['pr_auc']}  F1: {metrics['f1']}")

    # Save stacking artifacts
    stacking_path = MODELS_DIR / "stacking_meta.pkl"
    with open(stacking_path, "wb") as f:
        pickle.dump({"meta_model": meta, "model_names": model_names}, f)
    np.save(MODELS_DIR / "stacking_proba.npy", stacked_proba)

    return stacked_proba, metrics


# ── Weight Optimiser: Exact search on Combined Score ─────────────────────────
def optimise_combination_weights(
    p_approved: np.ndarray,
    match_scores: np.ndarray,
    y_true: np.ndarray,
    w1_candidates: list[float] | None = None,
) -> tuple[float, float, pd.DataFrame]:
    """
    Finds the exact optimal w1 (Engine 1 weight) that maximises ROC-AUC of
    the combined score:  w1 * P(approved) + (1-w1) * MatchScore

    Uses scipy.optimize.minimize_scalar for continuous search, then also
    evaluates the coarse grid (step 0.05) so we can compare both in logs
    and return a results DataFrame.

    Returns (best_w1, best_w2, results_dataframe).
    """
    from scipy.optimize import minimize_scalar

    print("\n" + "=" * 60)
    print("  Weight Optimisation — Exact Search (Engine 1 vs Engine 2)")
    print("=" * 60)

    def neg_auc(w1: float) -> float:
        combined = w1 * p_approved + (1.0 - w1) * match_scores
        try:
            return -roc_auc_score(y_true, combined)
        except Exception:
            return 0.0

    # Continuous optimisation (Brent method, bounded to [0, 1])
    result = minimize_scalar(neg_auc, bounds=(0.0, 1.0), method="bounded")
    best_w1 = round(float(result.x), 4)
    best_w2 = round(1.0 - best_w1, 4)

    # Also evaluate grid for logging / comparison dataframe
    grid_candidates = w1_candidates or [round(w, 2) for w in np.arange(0.0, 1.01, 0.05)]
    results = []
    for w1 in grid_candidates:
        w2 = round(1.0 - w1, 2)
        combined = w1 * p_approved + w2 * match_scores
        try:
            auc = roc_auc_score(y_true, combined)
            pr  = average_precision_score(y_true, combined)
        except Exception:
            auc, pr = 0.0, 0.0
        results.append({"w1_engine1": w1, "w2_engine2": w2,
                        "roc_auc": round(auc, 4), "pr_auc": round(pr, 4)})

    df = pd.DataFrame(results)
    best_auc = roc_auc_score(y_true, best_w1 * p_approved + best_w2 * match_scores)

    print(f"  Scipy optimal: w1={best_w1:.4f}  w2={best_w2:.4f}  "
          f"→  ROC-AUC={best_auc:.4f}")
    print(f"  (Grid range: w1={df.loc[df['roc_auc'].idxmax(),'w1_engine1']:.2f} "
          f"ROC-AUC={df['roc_auc'].max():.4f})")

    # Save results
    weight_path = MODELS_DIR / "weight_optimisation.csv"
    df.to_csv(weight_path, index=False)

    # Plot
    fig, ax = plt.subplots(figsize=(8, 4))
    fig.patch.set_facecolor("#F5F7FA")
    ax.set_facecolor("#F0F4F8")
    ax.plot(df["w1_engine1"], df["roc_auc"], color=NAVY, marker="o", lw=2, label="ROC-AUC")
    ax.plot(df["w1_engine1"], df["pr_auc"],  color=TEAL, marker="s", lw=2, label="PR-AUC")
    ax.axvline(best_w1, color=AMBER, linestyle="--", lw=1.5, label=f"Best w1={best_w1}")
    ax.set_xlabel("w1 — Engine 1 (ML) weight", fontsize=10)
    ax.set_ylabel("Score", fontsize=10)
    ax.set_title("Combined Score Weight Optimisation", fontsize=12, fontweight="bold", color=NAVY)
    ax.legend(fontsize=9); ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plot_path = MODELS_DIR / "weight_optimisation.png"
    fig.savefig(plot_path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {weight_path}, {plot_path}")

    return best_w1, best_w2, df
