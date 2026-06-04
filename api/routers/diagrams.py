"""api/routers/diagrams.py — /api/diagrams endpoints"""
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()

MODELS_DIR = Path("outputs/models")

DIAGRAM_MAP = {
    "roc_pr_curves.png":                    "ROC & PR Curves — All Models",
    "model_comparison.png":                  "Model Comparison",
    "weight_optimisation.png":               "Weight Optimisation",
    "meta_weight_comparison.png":            "Meta-Learner Weight Comparison",
    "feature_importance_xgboost.png":        "Feature Importance — XGBoost ★",
    "feature_importance_lightgbm.png":       "Feature Importance — LightGBM",
    "feature_importance_random_forest.png":  "Feature Importance — Random Forest",
    "feature_importance_logistic_regression.png": "Feature Importance — Logistic Regression",
    "confusion_xgboost.png":                 "Confusion Matrix — XGBoost",
    "confusion_lightgbm.png":               "Confusion Matrix — LightGBM",
    "confusion_random_forest.png":           "Confusion Matrix — Random Forest",
    "confusion_logistic_regression.png":     "Confusion Matrix — Logistic Regression",
}


@router.get("/diagrams")
def list_diagrams():
    available = []
    for fname, title in DIAGRAM_MAP.items():
        p = MODELS_DIR / fname
        if p.exists():
            available.append({"filename": fname, "title": title})
    return {"diagrams": available}


@router.get("/diagrams/{filename}")
def get_diagram(filename: str):
    # Prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if filename not in DIAGRAM_MAP:
        raise HTTPException(status_code=404, detail="Diagram not found")
    p = MODELS_DIR / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(str(p), media_type="image/png", filename=filename)


@router.get("/metrics")
def get_metrics():
    import json
    p = Path("outputs/models/metrics.json")
    if not p.exists():
        return {"metrics": []}
    with open(p) as f:
        data = json.load(f)
    return {"metrics": data}
