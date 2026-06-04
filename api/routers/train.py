"""api/routers/train.py — /api/train with Server-Sent Events for live logs"""
from __future__ import annotations
import contextlib
import io
import json
import pickle
import sys
import traceback
import warnings
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
warnings.filterwarnings("ignore")

from api.schemas import TrainConfig

router = APIRouter()

HISTORY_PATH  = Path("outputs/models/training_history.json")
MODELS_PATH   = Path("outputs/models/all_models.pkl")
CHAMPION_PATH = Path("outputs/models/champion.json")
BACKUP_PATH   = Path("outputs/models/all_models_backup.pkl")
UPLOADS_DIR   = Path("data/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _load_history() -> list[dict]:
    if HISTORY_PATH.exists():
        with open(HISTORY_PATH) as f:
            return json.load(f)
    return []


def _save_history(runs: list[dict]) -> None:
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_PATH, "w") as f:
        json.dump(runs, f, indent=2)


def _get_champion() -> dict | None:
    """Return {roc_auc, run_id, timestamp} of the all-time best run, or None."""
    if CHAMPION_PATH.exists():
        with open(CHAMPION_PATH) as f:
            return json.load(f)
    return None


def _save_champion(roc_auc: float, run_id: int) -> None:
    CHAMPION_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CHAMPION_PATH, "w") as f:
        json.dump({"roc_auc": round(roc_auc, 4), "run_id": run_id,
                   "timestamp": datetime.now().isoformat(timespec="seconds")}, f)


def _explain_winner(best_name: str, all_metrics: dict) -> list[str]:
    """Generate human-readable explanation for why `best_name` won."""
    ranked = sorted(all_metrics.items(), key=lambda x: x[1]["roc_auc"], reverse=True)
    best   = all_metrics[best_name]
    bullets: list[str] = []

    # ── ROC-AUC margin ──
    if len(ranked) >= 2:
        second_name, second = ranked[1]
        margin = best["roc_auc"] - second["roc_auc"]
        bullets.append(
            f"**{best_name}** leads on ROC-AUC with **{best['roc_auc']:.4f}**, "
            f"{margin * 100:.1f} pp ahead of {second_name} ({second['roc_auc']:.4f})."
        )

    # ── F1 / Precision / Recall ──
    best_f1 = max(all_metrics.values(), key=lambda m: m["f1"])
    if best_f1["model"] == best_name:
        bullets.append(
            f"Best F1 score (**{best['f1']:.4f}**) — strongest balance between "
            f"Precision {best['precision']:.4f} and Recall {best['recall']:.4f} "
            f"on the held-out test set."
        )
    else:
        bullets.append(
            f"F1 score **{best['f1']:.4f}** (Precision {best['precision']:.4f} · "
            f"Recall {best['recall']:.4f}). Note: {best_f1['model']} has higher F1 "
            f"({best_f1['f1']:.4f}) but lower discriminative AUC."
        )

    # ── PR-AUC ──
    best_pr = max(all_metrics.values(), key=lambda m: m["pr_auc"])
    if best_pr["model"] == best_name:
        bullets.append(
            f"Highest PR-AUC (**{best['pr_auc']:.4f}**) — best performance on the "
            f"minority approved-loan class (8.6% approval rate)."
        )

    # ── Model-specific algorithmic reason ──
    algo_reasons = {
        "xgboost":    "XGBoost's sequential residual boosting corrects errors iteratively, captures complex non-linear feature interactions, and handles class imbalance via `scale_pos_weight`. Ideal for tabular financial data.",
        "lightgbm":   "LightGBM's leaf-wise tree growth and histogram-based binning make it highly efficient on this 26-feature financial dataset, extracting nuanced patterns in CIBIL scores and financial ratios.",
        "random forest": "Random Forest's bagging-based variance reduction generalises robustly across diverse MSME profiles, avoiding overfitting to any single borrower segment.",
        "logistic regression": "Logistic Regression's L2-regularised linear model provides a well-calibrated probability baseline — winning here suggests strong linear separability in the feature space.",
        "stacking":   "The Stacking ensemble learns a meta-model that optimally blends base model predictions, capturing complementary strengths across all individual classifiers.",
        "weighted":   "The Weighted ensemble assigns learned weights to each model's probability output, reducing individual model variance through linear combination.",
    }
    for key, reason in algo_reasons.items():
        if key in best_name.lower():
            bullets.append(reason)
            break

    # ── Dataset context ──
    bullets.append(
        f"Training used all {len(all_metrics)} models on the same stratified split "
        f"(80/20) with SMOTE oversampling to counter the 8.6% approval rate. "
        f"The winning model is saved as the active predictor."
    )

    return bullets


def _stream_train(config: TrainConfig):
    """Generator that yields SSE lines during training."""

    def _event(msg: str, event_type: str = "log"):
        data = json.dumps({"type": event_type, "message": msg})
        yield f"data: {data}\n\n"

    try:
        import pandas as pd
        from sklearn.model_selection import train_test_split
        from src.features.engineering import engineer_features, load_raw, create_target_real, create_target
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

        # ── Resolve training data file ──
        data_file = config.upload_path or config.consol_file
        if not Path(data_file).exists():
            yield from _event(f"File not found: {data_file}", "error")
            return

        yield from _event(f"[0/7] Data source: {Path(data_file).name}")

        # 1 — Load
        yield from _event("[1/7] Loading data...")
        raw = load_raw(data_file)
        yield from _event(f"[1/7] ✓ {raw.shape[0]:,} rows × {raw.shape[1]} cols")

        # ── Merge accumulated outcome feedback ──────────────────────────────
        if config.include_feedback:
            label_files = sorted(LABELS_DIR.glob("*.*"))
            merged_rows = 0
            for lf in label_files:
                try:
                    if lf.suffix.lower() == ".csv":
                        fb = pd.read_csv(lf)
                    else:
                        fb = pd.read_excel(lf)
                    if "loan_approved" not in fb.columns:
                        continue
                    # Align columns — only keep columns present in raw
                    common_cols = [c for c in fb.columns if c in raw.columns]
                    if common_cols:
                        raw = pd.concat([raw, fb[common_cols]], ignore_index=True)
                        merged_rows += len(fb)
                except Exception as e:
                    yield from _event(f"  [warn] Skipped label file {lf.name}: {e}")
            if merged_rows > 0:
                yield from _event(
                    f"[1/7] ✓ Merged {merged_rows:,} feedback rows → "
                    f"total {raw.shape[0]:,} rows"
                )
            else:
                yield from _event("[1/7] ℹ No feedback data found in data/labels/")


        # 2 — Target
        yield from _event("[2/7] Creating labels...")
        TARGET_COL = "loan_approved"
        if TARGET_COL in raw.columns:
            df = raw.copy()
        else:
            try:
                df = create_target_real(raw)
            except Exception as e:
                df = create_target(raw)
                yield from _event(f"[2/7] Falling back to proxy labels: {e}")
        approval_rate = float(df[TARGET_COL].mean())
        yield from _event(f"[2/7] ✓ Approval rate: {approval_rate:.2%}  ({int(df[TARGET_COL].sum())} approved)")

        # 3 — Features
        yield from _event("[3/7] Engineering features...")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            X = engineer_features(df)
        y = df[TARGET_COL]
        n_features = X.shape[1]
        yield from _event(f"[3/7] ✓ {n_features} features")

        # 4 — Split
        yield from _event("[4/7] Splitting train/test...")
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=config.test_size, random_state=42, stratify=y
        )
        yield from _event(f"[4/7] ✓ Train: {len(X_train):,}  Test: {len(X_test):,}")

        # 5 — Train  (back up current champion first so we can restore if this run is worse)
        if MODELS_PATH.exists():
            import shutil as _shutil
            _shutil.copy2(MODELS_PATH, BACKUP_PATH)

        yield from _event("[5/7] Training LR · RF · XGBoost · LightGBM …")
        buf2 = io.StringIO()
        with contextlib.redirect_stdout(buf2):
            best_name, all_metrics = train_and_evaluate(
                X_train, X_test, y_train, y_test,
                use_smote=config.use_smote, cv_folds=config.cv_folds,
            )
        for line in buf2.getvalue().splitlines():
            if line.strip():
                yield from _event(f"    {line}")
        yield from _event(f"[5/7] ✓ Best base model: {best_name}")

        # Persist approval_rate into best_model.pkl so predict.py can use a dynamic floor
        _bm_path = Path("outputs/models/best_model.pkl")
        if _bm_path.exists():
            with open(_bm_path, "rb") as _f:
                _bm = pickle.load(_f)
            _bm["approval_rate"] = approval_rate
            with open(_bm_path, "wb") as _f:
                pickle.dump(_bm, _f)

        weighted_metrics = stacked_metrics = None
        weighted_proba = stacked_proba = None

        # 6 — Ensembles
        if config.run_ensemble:
            yield from _event("[6/7] Building ensembles…")
            with open("outputs/models/all_models.pkl", "rb") as f:
                trained_models = pickle.load(f)["models"]
            buf3 = io.StringIO()
            with contextlib.redirect_stdout(buf3):
                weighted_proba, weighted_metrics = build_weighted_ensemble(
                    trained_models, all_metrics, X_test, y_test
                )
                stacked_proba, stacked_metrics = build_stacking_ensemble(
                    trained_models, X_train, X_test, y_train, y_test,
                    cv_folds=config.cv_folds,
                )
            yield from _event(f"    Weighted AUC: {weighted_metrics['roc_auc']:.4f}")
            yield from _event(f"    Stacking AUC: {stacked_metrics['roc_auc']:.4f}")

            # 7 — Weights
            if config.run_weights and weighted_proba is not None:
                yield from _event("[7/7] Optimising weights…")
                pol_df = load_policies()
                match_means = []
                for idx in X_test.index:
                    md   = compute_match_score(df.loc[idx], pol_df)
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
                yield from _event(f"    Grid: w1={bw1:.2f}  w2={bw2:.2f}")
                yield from _event(f"    Meta: w1={lw1:.2f}  w2={lw2:.2f}")

        # ── Determine overall best model ──
        metrics_map = dict(all_metrics)
        if weighted_metrics:
            metrics_map[weighted_metrics["model"]] = weighted_metrics
        if stacked_metrics:
            metrics_map[stacked_metrics["model"]] = stacked_metrics

        overall_best = max(metrics_map.items(), key=lambda x: x[1]["roc_auc"])[0]
        best_roc     = metrics_map[overall_best]["roc_auc"]

        # ── Winner explanation ──
        explanation = _explain_winner(overall_best, metrics_map)
        yield from _event(f"[✓] Winner: {overall_best}  (ROC-AUC {best_roc:.4f})")
        for line in explanation:
            yield from _event(line, "explanation")

        # ── Save training history ──
        metrics_list = list(metrics_map.values())
        history = _load_history()
        run = {
            "run_id":           len(history) + 1,
            "timestamp":        datetime.now().isoformat(timespec="seconds"),
            "data_file":        Path(data_file).name,
            "n_rows":           len(df),
            "n_features":       n_features,
            "approval_rate":    round(approval_rate, 4),
            "best_model":       overall_best,
            "best_roc_auc":     round(best_roc, 4),
            "metrics":          metrics_list,
            "winner_explanation": explanation,
        }

        # ── Champion promotion: only keep model if it beats the all-time best ──
        champion      = _get_champion()
        champion_roc  = champion["roc_auc"] if champion else None
        promoted      = champion_roc is None or best_roc > champion_roc

        if promoted:
            _save_champion(best_roc, run["run_id"])
            delta_str = (
                f"+{(best_roc - champion_roc) * 100:.2f} pp vs previous champion"
                if champion_roc else "First champion"
            )
            yield from _event(
                f"🏆 New champion model! ROC-AUC {best_roc:.4f}  ({delta_str})", "champion"
            )
        else:
            # Restore the previous model
            if BACKUP_PATH.exists():
                import shutil as _shutil
                _shutil.copy2(BACKUP_PATH, MODELS_PATH)
            yield from _event(
                f"⚠️ Previous champion retained. This run: ROC-AUC {best_roc:.4f} "
                f"(champion {champion_roc:.4f})", "champion"
            )

        run["promoted"]     = promoted
        run["champion_roc"] = champion_roc if champion_roc is not None else best_roc

        history.append(run)
        _save_history(history)

        # ── Emit final payloads ──
        yield from _event("[✓] Training complete!", "progress")
        yield from _event(json.dumps(metrics_list), "metrics")
        yield from _event(json.dumps(run), "run_saved")

        # Invalidate predict cache so next request loads fresh weights
        from api.routers import predict as _predict_mod
        _predict_mod.clear_cache()

    except Exception as exc:
        yield from _event(f"ERROR: {exc}\n{traceback.format_exc()}", "error")


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/upload-training-data")
async def upload_training_data(file: UploadFile = File(...)):
    """Save an uploaded Excel training file and return its path."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    safe_name = Path(file.filename).name  # strip any directory component
    save_path = UPLOADS_DIR / safe_name
    contents  = await file.read()
    with open(save_path, "wb") as f:
        f.write(contents)

    # Quick row count
    try:
        import pandas as pd
        df_check = pd.read_excel(save_path, sheet_name="Loan Applications", nrows=None)
        n_rows = len(df_check)
    except Exception:
        n_rows = None

    return {"path": str(save_path), "filename": safe_name, "n_rows": n_rows}


@router.post("/train")
def train_model(config: TrainConfig):
    return StreamingResponse(
        _stream_train(config),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/training-history")
def get_training_history():
    """Return all past training runs."""
    return {"runs": _load_history()}


@router.get("/model-status")
def model_status():
    """Return current trained model metadata."""
    import json as _json
    p_metrics = Path("outputs/models/metrics.json")
    p_model   = MODELS_PATH

    if not p_model.exists():
        return {"model_exists": False, "metrics": []}

    mtime = datetime.fromtimestamp(p_model.stat().st_mtime).isoformat(timespec="seconds")
    metrics: list[dict] = []
    if p_metrics.exists():
        with open(p_metrics) as f:
            metrics = _json.load(f)

    best = max(metrics, key=lambda m: m.get("roc_auc", 0)) if metrics else None

    # Also load history for context
    history = _load_history()
    last_run = history[-1] if history else None

    # Champion info
    champion = _get_champion()

    # Live weights from meta_learner.pkl (updated every training run)
    w1 = w2 = None
    meta_path = Path("outputs/models/meta_learner.pkl")
    if meta_path.exists():
        try:
            with open(meta_path, "rb") as f:
                meta = pickle.load(f)
            w1 = float(meta.get("learned_w1", 0.6))
            w2 = float(meta.get("learned_w2", 0.4))
        except Exception:
            pass

    return {
        "model_exists":      True,
        "last_trained":      mtime,
        "best_model":        best["model"] if best else None,
        "best_roc_auc":      best["roc_auc"] if best else None,
        "w1":                w1,
        "w2":                w2,
        "metrics":           metrics,
        "last_run":          last_run,
        "total_runs":        len(history),
        "champion_roc_auc":  champion["roc_auc"] if champion else None,
        "champion_run_id":   champion["run_id"] if champion else None,
    }


@router.get("/export-model")
def export_model():
    """Download the trained model pickle file."""
    if not MODELS_PATH.exists():
        raise HTTPException(status_code=404, detail="No trained model found. Run /api/train first.")
    return FileResponse(
        str(MODELS_PATH),
        media_type="application/octet-stream",
        filename="finnup_model.pkl",
        headers={"Content-Disposition": "attachment; filename=finnup_model.pkl"},
    )


# ── Feedback / Continuous-learning endpoints ───────────────────────────────────

LABELS_DIR = Path("data/labels")
LABELS_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload-outcomes")
async def upload_outcomes(file: UploadFile = File(...)):
    """
    Accept an Excel/CSV file containing actual loan outcomes.
    Required column: loan_approved (0 or 1).
    All other borrower columns are optional but improve future training.
    Saved to data/labels/ with a timestamp prefix for accumulation.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".xlsx", ".xls", ".csv"}:
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files accepted.")

    import pandas as pd
    contents = await file.read()

    try:
        if suffix == ".csv":
            import io as _io
            df = pd.read_csv(_io.BytesIO(contents))
        else:
            import io as _io
            df = pd.read_excel(_io.BytesIO(contents))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}")

    if "loan_approved" not in df.columns:
        raise HTTPException(
            status_code=400,
            detail="File must contain a 'loan_approved' column (0 = rejected, 1 = approved)."
        )

    # Validate values
    valid = df["loan_approved"].dropna()
    if not set(valid.unique()).issubset({0, 1, 0.0, 1.0}):
        raise HTTPException(
            status_code=400,
            detail="'loan_approved' must contain only 0 or 1 values."
        )

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    save_name = f"{ts}_{Path(file.filename).name}"
    save_path = LABELS_DIR / save_name
    with open(save_path, "wb") as f_out:
        f_out.write(contents)

    approved = int((df["loan_approved"] == 1).sum())
    rejected = int((df["loan_approved"] == 0).sum())

    return {
        "filename": save_name,
        "n_rows": len(df),
        "approved": approved,
        "rejected": rejected,
        "approval_rate": round(approved / max(len(df), 1), 4),
    }


@router.get("/feedback-stats")
def feedback_stats():
    """Return stats on all accumulated outcome label files in data/labels/."""
    import pandas as pd

    files = sorted(LABELS_DIR.glob("*.*"))
    if not files:
        return {
            "total_files": 0, "total_rows": 0,
            "total_approved": 0, "total_rejected": 0,
            "approval_rate": 0.0, "uploads": [],
        }

    records = []
    total_rows = total_approved = total_rejected = 0

    for fp in files:
        try:
            if fp.suffix.lower() == ".csv":
                df = pd.read_csv(fp)
            else:
                df = pd.read_excel(fp)
            if "loan_approved" not in df.columns:
                continue
            n = len(df)
            appr = int((df["loan_approved"] == 1).sum())
            rej = int((df["loan_approved"] == 0).sum())
            total_rows += n; total_approved += appr; total_rejected += rej
            records.append({
                "filename": fp.name,
                "n_rows": n,
                "approved": appr,
                "rejected": rej,
                "uploaded_at": fp.name[:15].replace("_", " ") if len(fp.name) >= 15 else fp.name,
            })
        except Exception:
            continue

    return {
        "total_files":    len(records),
        "total_rows":     total_rows,
        "total_approved": total_approved,
        "total_rejected": total_rejected,
        "approval_rate":  round(total_approved / max(total_rows, 1), 4),
        "uploads":        records,
    }


@router.get("/training-template")
def training_data_template():
    """Download a blank training data Excel template with the two required sheets."""
    import pandas as pd
    import io as _io

    # ── Sheet 1: Loan Applications ─────────────────────────────────────────────
    la_cols = [
        "company_name", "product_name", "location",
        "Loan Amount Min", "Loan Amount Max",
        "Tenor Min", "Tenor Max",
        "Rate of interest Min", "Rate of interest Max",
        "loanapplication_status",   # values: Disbursed / Deal Sanctioned / Partially Disbursed / Rejected / etc.
        "sanctioned_amount",        # 0 if not approved; positive rupee amount if approved
    ]
    # ── Sheet 2: Total borrowers ───────────────────────────────────────────────
    tb_cols = [
        "Variable",                 # = company_name — must match Loan Applications
        "Type of Entity",           # Sole Proprietorship / Private Limited / Partnership / LLP / Public Limited
        "Owned/Rented Property",    # Owned / Rented
        "Vintage (in months)",
        "Industry",                 # numeric code — see Overview tab
        "Pincode",
        "Age of applicant",
        "CIBIL Score",
        "Total number of active accounts",
        "Count of Overdue Accounts",
        "Total Overdue Amount",
        "New sanction in the last 30 days",
        "New sanction in the last 90 days",
        "enquiry_last7days",
        "enquiry_last30days",
        "cnt_dpd_0plus_last_12mo",
        "cnt_dpd_90plus_last_12mo",
        "Suit Filed Count of Loans",
        "GST Filing in the past 3 months",  # Yes / No
        "GST Filing in the past 6 months",  # Yes / No
        "Net Sales",
        "Profit After Tax",
        "Tangible Networth (TNW)",
        "TOL/ TNW",
        "Current Ratio",
        "DSCR (Avg/Min)",
        "Total Amount of Credit Transactions",
        "Total Amount of Debit Transactions",
        "Average EOD Balance",
        "Total Number of Inward cheque bounces",
        "Total Number of Outward cheque bounces",
    ]

    la_df = pd.DataFrame(columns=la_cols)
    tb_df = pd.DataFrame(columns=tb_cols)

    # Add one sample row so the user knows the expected format
    la_df.loc[0] = [
        "Example Pvt Ltd", "Unsecured Business Loan", "Mumbai",
        500000, 2000000, 12, 36, 12.0, 18.0,
        "Disbursed", 1500000,
    ]
    tb_df.loc[0] = [
        "Example Pvt Ltd", "Private Limited", "Owned", 60, 7, 400001,
        42, 720, 3, 0, 0, 0, 0, 1, 3, 0, 0, 0,
        "Yes", "Yes",
        5000000, 450000, 2000000, 1.8, 1.5, 1.3,
        4000000, 3500000, 150000, 0, 1,
    ]

    buf = _io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        la_df.to_excel(writer, index=False, sheet_name="Loan Applications")
        tb_df.to_excel(writer, index=False, sheet_name="Total borrowers")
    buf.seek(0)
    from fastapi.responses import Response
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=finnup_training_template.xlsx"},
    )


@router.get("/outcome-template")
def outcome_template():
    """Download a blank outcome feedback Excel template."""
    import pandas as pd
    import io as _io

    template_df = pd.DataFrame({
        "company_name":   ["Example Co Ltd", "Sample Firm"],
        "loan_approved":  [1, 0],
        "CIBIL Score":    [720, 640],
        "Vintage (in months)": [36, 24],
        "Net Sales":      [10_000_000, 5_000_000],
        "Count of Overdue Accounts": [0, 2],
        "Suit Filed Count of Loans": [0, 0],
    })
    buf = _io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        template_df.to_excel(writer, index=False, sheet_name="Outcomes")
    buf.seek(0)
    from fastapi.responses import Response
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=outcome_feedback_template.xlsx"},
    )


@router.post("/train")
def train_model(config: TrainConfig):
    return StreamingResponse(
        _stream_train(config),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
