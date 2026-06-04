"""Pydantic schemas for the FinnUp FastAPI backend."""
from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel


# ── Borrower input ─────────────────────────────────────────────────────────────
class BorrowerInput(BaseModel):
    company_name: str = ""              # borrower / entity name
    entity_type: str = "Sole Proprietorship"
    product_name: str = "Unsecured Business Loan"
    location: str = "Mumbai"
    loan_min: float = 800_000        # ₹ (Rs 8 lakhs — training median)
    loan_max: float = 7_500_000       # ₹ (Rs 75 lakhs)
    tenor_min: int = 12               # months
    tenor_max: int = 36               # months
    cibil: int = 720
    dpd90: int = 0
    overdue_count: int = 0
    overdue_amount: float = 0
    suit_filed: int = 0
    vintage: int = 36
    age_app: int = 42
    net_sales: float = 700_000_000   # ₹ (Rs 70 crore — matches approved-borrower median)
    pat: float = 21_000_000          # ₹ (Rs 2.1 crore, ~3% margin)
    tnw: float = 50_000_000          # ₹ (Rs 5 crore)
    dscr: float = 1.2
    current_ratio: float = 1.3
    tol_tnw: float = 1.5
    inward_bounces: int = 0
    outward_bounces: int = 0
    enq30: int = 1
    ns30: int = 0
    gst3: str = "All filed"
    gst6: str = "All filed"
    owned: str = "Owned"


# ── SHAP / LIME rows ───────────────────────────────────────────────────────────
class ShapRow(BaseModel):
    feature: str
    importance: float


class LimeRow(BaseModel):
    condition: str
    weight: float


# ── Engine 2 — per-rule detail ─────────────────────────────────────────────────
class RuleDetail(BaseModel):
    label: str                          # human-readable rule name
    passed: bool
    borrower_value: Optional[float] = None
    lender_min: Optional[float] = None
    lender_max: Optional[float] = None
    headroom: float = 0.0               # 0-1 how comfortably borrower clears this rule
    narrative: str = ""                 # plain-English one-liner


# ── Weight explanation ─────────────────────────────────────────────────────────
class WeightExplanation(BaseModel):
    w1: float
    w2: float
    formula: str
    engine1_name: str = "ML Ensemble (Engine 1)"
    engine2_name: str = "Policy Rules (Engine 2)"
    how_weights_learned: str
    interpretation: str


# ── Enriched lender result ─────────────────────────────────────────────────────
class LenderResult(BaseModel):
    rank: int
    lender_name: str
    combined_score: float
    p_approved: float
    match_score: float
    engine1_contribution: Optional[float] = None   # w1 × p_approved
    engine2_contribution: Optional[float] = None   # w2 × match_score
    engine2_rules: Optional[list[RuleDetail]] = None
    match_reasons: Optional[list[str]] = None      # plain-English rule pass/fail bullets


# ── Predict response ───────────────────────────────────────────────────────────
class PredictResponse(BaseModel):
    p_approved: float
    primary_model: str = "XGBoost"          # model used for P(approved)
    model_scores: dict[str, float] = {}     # all model probabilities for comparison
    eligible_lenders: int
    total_lenders: int
    avg_match_score: float
    w1: float
    w2: float
    weight_explanation: Optional[WeightExplanation] = None
    top3: list[LenderResult]
    all_lenders: list[dict[str, Any]]
    shap: Optional[list[ShapRow]] = None
    lime: Optional[list[LimeRow]] = None
    bullets: Optional[list[str]] = None
    floor_p: float = 0.20          # dynamic recommendation floor (1.5 × training approval rate)
    score_percentile: Optional[int] = None   # borrower's score percentile rank in training distribution
    credit_tier: Optional[str] = None        # e.g. "Good", "Strong", "Exceptional"
    primary_model: str = "XGBoost"
    all_model_scores: Optional[dict[str, float]] = None
    engine1_contribution: float = 0.0
    engine2_contribution: float = 0.0
    error: Optional[str] = None


# ── Model status ───────────────────────────────────────────────────────────────
class ModelMetric(BaseModel):
    model: str
    roc_auc: float
    pr_auc: float
    f1: float
    precision: float
    recall: float


class ModelStatusResponse(BaseModel):
    model_exists: bool
    last_trained: Optional[str] = None
    best_model: Optional[str] = None
    best_roc_auc: Optional[float] = None
    metrics: list[ModelMetric] = []


# ── Train config ───────────────────────────────────────────────────────────────
class TrainConfig(BaseModel):
    consol_file: str = "Capstone_Consol Sheet_22.05.2026.xlsx"
    include_feedback: bool = False   # merge accumulated outcome labels before training
    upload_path: Optional[str] = None   # path from /api/upload-training-data
    test_size: float = 0.20
    cv_folds: int = 5
    use_smote: bool = True
    run_ensemble: bool = True
    run_weights: bool = True


# ── Training history run ───────────────────────────────────────────────────────
class TrainingRun(BaseModel):
    run_id: int
    timestamp: str
    data_file: str
    n_rows: int
    n_features: int
    approval_rate: float
    best_model: str
    best_roc_auc: float
    metrics: list[dict]
    winner_explanation: list[str]


# ── Batch score row ────────────────────────────────────────────────────────────
class BatchRow(BaseModel):
    index: int
    company_name: Optional[str] = None
    product_name: Optional[str] = None
    cibil_score: Optional[float] = None
    vintage: Optional[float] = None
    net_sales: Optional[float] = None
    overdue_accounts: Optional[float] = None
    entity_type: Optional[str] = None
    p_approved_pct: float
    label: str
    risk_band: str


class BatchScoreResponse(BaseModel):
    total: int
    high_prob: int
    medium_prob: int
    low_prob: int
    confirmed_approved: int
    confirmed_rejected: int
    rows: list[BatchRow]
    histogram: list[float]  # raw proba values for histogram rendering
