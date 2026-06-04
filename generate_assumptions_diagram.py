"""
generate_assumptions_diagram.py
--------------------------------
Generates  outputs/FinnUp_Assumptions_GuidanceNeeded.png
  – One-page assumption map + professor guidance questions

Run:
    python generate_assumptions_diagram.py
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from pathlib import Path

OUTPUT_PATH = Path("outputs") / "FinnUp_Assumptions_GuidanceNeeded.png"
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

# ── Palette ────────────────────────────────────────────────────────────────────
NAVY    = "#1B3A6B"
TEAL    = "#0D9488"
AMBER   = "#F59E0B"
GREEN   = "#16A34A"
PURPLE  = "#7C3AED"
RED     = "#DC2626"
WHITE   = "#FFFFFF"
DGRAY   = "#334155"
MGRAY   = "#64748B"
LGRAY   = "#EFF6FF"
LBLUE   = "#DBEAFE"
LTEAL   = "#CCFBF1"
LAMBER  = "#FEF3C7"
LGREEN  = "#DCFCE7"
LPURPLE = "#EDE9FE"
LRED    = "#FEE2E2"
LCREAM  = "#FFFBEB"

FW, FH = 24, 17
fig = plt.figure(figsize=(FW, FH), facecolor=LGRAY)
ax  = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, FW); ax.set_ylim(0, FH); ax.axis("off")

# ── Helpers ────────────────────────────────────────────────────────────────────
def box(x, y, w, h, fc, ec, lw=1.5, r=0.25, alpha=1.0, z=3):
    ax.add_patch(FancyBboxPatch(
        (x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}",
        fc=fc, ec=ec, lw=lw, alpha=alpha, zorder=z))

def t(x, y, s, sz=9, c=NAVY, w="normal", ha="center", va="center", z=5):
    ax.text(x, y, s, fontsize=sz, color=c, fontweight=w,
            ha=ha, va=va, zorder=z, linespacing=1.4)

def hline(x1, x2, y, c=MGRAY, lw=1, ls="--"):
    ax.plot([x1, x2], [y, y], color=c, lw=lw, ls=ls, zorder=2)

# ══════════════════════════════════════════════════════════════════════
# TITLE
# ══════════════════════════════════════════════════════════════════════
box(0, 16.15, FW, 0.85, NAVY, NAVY, r=0, z=4)
t(FW/2, 16.68, "FinnUp — Assumptions Made & Key Takeaways", 19, WHITE, "bold")
t(FW/2, 16.28, "APAL Cohort 2  ·  Group 1  ·  IIM Calcutta  |  Capstone Project  |  May 2026", 10, "#93C5FD")

# ══════════════════════════════════════════════════════════════════════
# CONTEXT STRIP  (y 15.25 – 16.10)
# ══════════════════════════════════════════════════════════════════════
box(0.3, 15.25, 23.4, 0.78, LAMBER, AMBER, lw=2, r=0.3, z=4)
t(1.55, 15.91, "CONTEXT", 9, AMBER, "bold", ha="left")
t(3.0, 15.91, "|  Dataset provided by FinnUp (6,187 borrowers, 38 columns). Only missing/blank values were filled by the team using a Biased Logic Engine with exact distribution rules.", 9.5, DGRAY, ha="left")
t(3.0, 15.54, "   Target variable (loan_approved: approved / rejected) is provided by FinnUp. 8–11% approval rate observed in the labelled dataset.", 9, MGRAY, ha="left")

# ══════════════════════════════════════════════════════════════════════
# LEFT COLUMN  —  ASSUMPTIONS  (x 0.3 – 11.7)
# ══════════════════════════════════════════════════════════════════════
box(0.3, 2.6, 11.4, 12.50, LBLUE, NAVY, lw=1.5, r=0.4, alpha=0.25, z=2)
box(0.38, 14.62, 2.2, 0.46, NAVY, NAVY, r=0.18, z=5)
t(1.48, 14.85, "ASSUMPTIONS MADE", 9.5, WHITE, "bold")
t(6.0, 14.25, "Where team judgement was applied to fill gaps", 9, MGRAY)

ASSUMPTIONS = [
    # (num, title, body_lines, fc, ec)
    ("A1", "Dataset from FinnUp — Missing Values Filled by Team",
     ["FinnUp provided real borrower data: 6,187 rows x 38 cols.",
      "Blanks across 20+ columns were filled by the team",
      "using a Biased Logic Engine with exact distribution rules.",
      "Real fields retained; only blank gaps were synthetic-filled."],
     LBLUE, NAVY),

    ("A2", "Target Variable Provided by FinnUp",
     ["FinnUp supplied actual approved / rejected labels.",
      "8–11% of 6,187 borrowers are approved (real data).",
      "Binary target: loan_approved = 1 (approved),",
      "loan_approved = 0 (rejected)."],
     LTEAL, TEAL),

    ("A3", "Distribution Rules Designed by Team (not FinnUp)",
     ["All exact splits (60/20/20, 80/20, etc.) were chosen",
      "by us to reflect plausible MSME credit behaviour.",
      "PAT = 3–5% of Net Sales  |  20% PAT negative",
      "Debit txns = exactly 80% of Credit txns."],
     LAMBER, AMBER),

    ("A4", "Time-Series Constraints Enforced Mathematically",
     ["enquiry_30d >= enquiry_7d  (enforced row-by-row)",
      "sanctions_90d >= sanctions_30d  (sorted & paired)",
      "DPD_0plus >= DPD_90plus  (cascade logic)",
      "These are our constraints, not observed from data."],
     LPURPLE, PURPLE),

    ("A5", "Lender Match Weight is Empirical  (0.6 / 0.4)",
     ["Combined Score = 0.6 x P(approved) + 0.4 x MatchScore",
      "The 60/40 split was chosen judgementally.",
      "No ground-truth lender match data available to",
      "optimise or validate these weights."],
     LGREEN, GREEN),

    ("A6", "Geography Restricted to 4 Cities",
     ["Pincodes limited to Mumbai, Chennai, Hyderabad,",
      "Bangalore and adjacent regions only.",
      "Vintage restricted to 12–24 months.",
      "CIBIL blanks filled with 675–700 range."],
     LRED, RED),
]

AW, AH, AG = 10.8, 1.72, 0.15
AX0, AY0 = 0.6, 2.70

for i, (num, title, lines, fc, ec) in enumerate(ASSUMPTIONS):
    ay = AY0 + i * (AH + AG)
    box(AX0, ay, AW, AH, fc, ec, lw=2, r=0.28, z=4)
    # Number badge
    box(AX0 + 0.12, ay + AH - 0.35, 0.52, 0.30, ec, WHITE, lw=0, r=0.12, z=6)
    t(AX0 + 0.38, ay + AH - 0.20, num, 8, WHITE, "bold")
    # Title
    t(AX0 + 0.80, ay + AH - 0.20, title, 9.5, ec, "bold", ha="left")
    # Body
    for j, line in enumerate(lines):
        t(AX0 + 0.28, ay + AH - 0.56 - j * 0.27, line, 8, DGRAY, ha="left")

# ══════════════════════════════════════════════════════════════════════
# MIDDLE COLUMN  —  DISTRIBUTION RULES TABLE  (x 12.1 – 17.9)
# ══════════════════════════════════════════════════════════════════════
box(12.1, 2.6, 5.7, 12.50, LTEAL, TEAL, lw=1.5, r=0.4, alpha=0.25, z=2)
box(12.18, 14.62, 2.5, 0.46, TEAL, TEAL, r=0.18, z=5)
t(13.43, 14.85, "DISTRIBUTION RULES", 9.5, WHITE, "bold")
t(14.95, 14.25, "Exact % splits enforced row-by-row", 9, MGRAY)

DIST_ROWS = [
    # (feature, rule, fc, ec)
    ("Active Accounts",    "20% = 0  |  30% = 1  |  30% = 2  |  20% = 3–5",    LBLUE,   NAVY),
    ("Overdue Amount",     "60% = 0  |  20% = Rs5K–20K  |  20% = Rs20K–50K",   LTEAL,   TEAL),
    ("Inward Bounces",     "60% = 0  |  20% = 1  |  20% = 3",                   LAMBER,  AMBER),
    ("Outward Bounces",    "80% = 0  |  20% = 1",                               LGREEN,  GREEN),
    ("Enquiry 7d",         "60% = 0  |  20% = 1  |  20% = 3–4",                LPURPLE, PURPLE),
    ("Enquiry 30d",        "60% = 0  |  20% = 1  |  20% = 3–4",                LPURPLE, PURPLE),
    ("Sanctions 30d",      "60% = 0  |  20% = 1  |  20% = 3–4",                LBLUE,   NAVY),
    ("Sanctions 90d",      "40% = 0  |  40% = 1  |  20% = 3–4",                LBLUE,   NAVY),
    ("DPD 0+",             "60% = 0  |  20% = 1  |  20% = 3",                   LRED,    RED),
    ("DPD 90+",            "80% = 0  |  20% = 1–3",                             LRED,    RED),
    ("Net Sales",          "Rs75L – Rs5Cr  (rand, rounded to nearest 100)",     LGREEN,  GREEN),
    ("PAT",                "3–5% of Net Sales  |  20% inverted to negative",    LAMBER,  AMBER),
    ("Credit Txns",        "Rs5L – Rs25L  (random fill for blanks)",            LTEAL,   TEAL),
    ("Debit Txns",         "Exactly 80% of Credit Transactions",                LTEAL,   TEAL),
    ("EOD Balance",        "Rs1L – Rs3L  (random fill for blanks)",             LBLUE,   NAVY),
    ("CIBIL Score",        "Blanks filled: 675 – 700 range",                    LPURPLE, PURPLE),
    ("Vintage",            "12 – 24 months  (whole numbers only)",              LGREEN,  GREEN),
]

DRX0, DRY0 = 12.25, 2.70
DRW, DRH, DRG = 5.55, 0.545, 0.04

for i, (feat, rule, fc, ec) in enumerate(DIST_ROWS):
    dy = DRY0 + i * (DRH + DRG)
    box(DRX0, dy, DRW, DRH, fc, ec, lw=1.2, r=0.15, z=4)
    t(DRX0 + 0.10, dy + DRH/2, feat + ":", 7.8, ec, "bold", ha="left")
    t(DRX0 + 1.82, dy + DRH/2, rule, 7.5, DGRAY, ha="left")

# Constraint legend box
box(12.25, 2.73, 5.55, 0.45, WHITE, MGRAY, lw=1, r=0.15, z=5)
t(12.38, 2.955, "Constraints:", 7.5, NAVY, "bold", ha="left")
t(13.42, 2.955, "30d >= 7d  |  90d_sanctions >= 30d  |  DPD_0plus >= DPD_90plus", 7.5, RED, ha="left")

# ══════════════════════════════════════════════════════════════════════
# RIGHT COLUMN  —  PROFESSOR GUIDANCE QUESTIONS  (x 18.1 – 23.7)
# ══════════════════════════════════════════════════════════════════════
box(18.1, 2.6, 5.6, 12.50, LRED, RED, lw=1.5, r=0.4, alpha=0.25, z=2)
box(18.18, 14.62, 2.8, 0.46, RED, RED, r=0.18, z=5)
t(19.58, 14.85, "OPEN QUESTIONS", 9.5, WHITE, "bold")
t(20.9, 14.25, "Areas needing validation or decision", 9, MGRAY)

QUESTIONS = [
    ("Q1", "Label Time Horizon",
     ["Over what period were FinnUp's approval",
      "labels recorded? Lending norms, RBI policy,",
      "and MSME credit behaviour may have shifted.",
      "Should we time-split train/test accordingly?"],
     RED),

    ("Q2", "Distribution Assumption Validity",
     ["Are our 60/20/20 splits for missing-value fill",
      "close enough to real borrower behaviour?  Should",
      "we validate against RBI / SIDBI MSME reports",
      "before finalising the filled dataset?"],
     AMBER),

    ("Q3", "Class Imbalance Handling",
     ["Real approval rate 8–11% creates ~90:10 imbalance.",
      "We use SMOTE to balance training data.",
      "Should we also evaluate with cost-sensitive",
      "learning or threshold tuning instead?"],
     PURPLE),

    ("Q4", "Lender Match Weight Validation",
     ["Should 0.6 / 0.4 be learned via",
      "optimisation, or is the empirical split",
      "acceptable for capstone scope?",
      "Any suggested method to justify it?"],
     TEAL),

    ("Q5", "Model Output Scope",
     ["Should output be a ranked Top-3 list,",
      "or predict P(approval) per specific",
      "lender individually as a stretch goal?",
      "Which is stronger academically?"],
     GREEN),

    ("Q6", "Missing Value Fill Validation",
     ["Should the distributions we used to fill",
      "blank fields be validated against RBI /",
      "SIDBI MSME benchmarks before final",
      "model training and submission?"],
     NAVY),
]

QW, QH, QG = 5.25, 1.72, 0.15
QX0, QY0 = 18.25, 2.70

for i, (num, title, lines, ec) in enumerate(QUESTIONS):
    qy = QY0 + i * (QH + QG)
    # pick a light bg colour
    bgs = [LRED, LAMBER, LPURPLE, LTEAL, LGREEN, LBLUE]
    box(QX0, qy, QW, QH, bgs[i], ec, lw=2, r=0.28, z=4)
    # Number badge
    box(QX0 + 0.12, qy + QH - 0.35, 0.52, 0.30, ec, WHITE, lw=0, r=0.12, z=6)
    t(QX0 + 0.38, qy + QH - 0.20, num, 8, WHITE, "bold")
    t(QX0 + 0.80, qy + QH - 0.20, title, 9.5, ec, "bold", ha="left")
    for j, line in enumerate(lines):
        t(QX0 + 0.28, qy + QH - 0.56 - j * 0.27, line, 8, DGRAY, ha="left")

# ══════════════════════════════════════════════════════════════════════
# BOTTOM SUMMARY STRIP  (y 0.28 – 2.46)
# ══════════════════════════════════════════════════════════════════════
box(0.3, 0.28, 23.4, 2.2, WHITE, NAVY, lw=2, r=0.35, z=4)
t(FW/2, 2.27, "KEY TAKEAWAYS", 11, NAVY, "bold")
hline(0.6, 23.4, 2.05, MGRAY, 0.8)

SUMMARY = [
    (NAVY,   "Dataset:",    "FinnUp-provided: 6,187 borrowers, 38 features  |  Team filled missing values only  |  No FinnUp approval labels provided"),
    (TEAL,   "Target:",     "Provided by FinnUp  |  Binary: approved / rejected  |  8–11% approval rate  |  Used directly for ML training"),
    (AMBER,  "Engine 1:",   "ML models (LR / RF / XGBoost / LightGBM) trained on synthetic labels  |  output P(approved) 0.0 – 1.0"),
    (GREEN,  "Engine 2:",   "Rule-based policy filter against 55 active lender policies  |  38 lenders  |  output MatchScore 0.0 – 1.0"),
    (PURPLE, "Ranking:",    "Combined Score = 0.6 x P(approved)  +  0.4 x MatchScore   -->   Top 3 lenders returned to borrower"),
    (RED,    "Risk Flag:",  "All results are based on synthetic data. Validation against real approval outcomes is essential before production use."),
]

for i, (ec, label, text) in enumerate(SUMMARY):
    yi = 1.88 - i * 0.27
    box(0.45, yi - 0.11, 0.85, 0.22, ec, ec, lw=0, r=0.08, z=6)
    t(0.875, yi, label, 8, WHITE, "bold")
    t(1.50, yi, text, 8, DGRAY, ha="left")

# ══════════════════════════════════════════════════════════════════════
# FOOTER
# ══════════════════════════════════════════════════════════════════════
box(0, 0, FW, 0.27, NAVY, NAVY, r=0, z=4)
t(FW/2, 0.135,
  "APAL Cohort 2  .  Group 1  .  IIM Calcutta   |   FinnUp MSME Credit Intelligence Platform   |   May 2026",
  8, "#93C5FD")

# ══════════════════════════════════════════════════════════════════════
# SAVE
# ══════════════════════════════════════════════════════════════════════
fig.savefig(OUTPUT_PATH, dpi=150, bbox_inches="tight",
            facecolor=LGRAY, edgecolor="none")
plt.close(fig)
print(f"Saved  ->  {OUTPUT_PATH}")
