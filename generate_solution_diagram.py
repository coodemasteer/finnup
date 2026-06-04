import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from pathlib import Path

OUTPUT_PATH = Path("outputs") / "FinnUp_Solution_Architecture.png"
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

NAVY="#1B3A6B"; TEAL="#0D9488"; AMBER="#F59E0B"; GREEN="#16A34A"; PURPLE="#7C3AED"
WHITE="#FFFFFF"; DGRAY="#334155"; MGRAY="#64748B"; LGRAY="#EFF6FF"
LBLUE="#DBEAFE"; LTEAL="#CCFBF1"; LAMBER="#FEF3C7"; LGREEN="#DCFCE7"; LPURPLE="#EDE9FE"

FW, FH = 22, 16
fig = plt.figure(figsize=(FW, FH), facecolor=LGRAY)
ax  = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, FW); ax.set_ylim(0, FH); ax.axis("off")

def box(x, y, w, h, fc, ec, lw=1.5, r=0.28, alpha=1.0, z=3):
    ax.add_patch(FancyBboxPatch((x,y),w,h,
        boxstyle=f"round,pad=0,rounding_size={r}",
        fc=fc,ec=ec,lw=lw,alpha=alpha,zorder=z))

def t(x, y, s, sz=9, c=NAVY, w="normal", ha="center", va="center", z=5):
    ax.text(x,y,s,fontsize=sz,color=c,fontweight=w,ha=ha,va=va,zorder=z)

def arr(x1,y1,x2,y2,c=NAVY,lw=2,rad=0.0):
    ax.annotate("",xy=(x2,y2),xytext=(x1,y1),
        arrowprops=dict(arrowstyle="->, head_width=0.22, head_length=0.18",
        color=c,lw=lw,connectionstyle=f"arc3,rad={rad}"),zorder=6)

# === TITLE y=15.0-16.0 ===
box(0,15.0,FW,1.0,NAVY,NAVY,r=0,z=4)
t(FW/2,15.68,"FinnUp  --  MSME Credit Intelligence Platform",20,WHITE,"bold")
t(FW/2,15.22,"Solution Architecture   |   APAL Cohort 2 . Group 1   |   IIM Calcutta   |   May 2026",10,"#93C5FD")

# === INPUT ZONE y=11.70-14.80 ===
box(0.2,11.70,21.6,3.10,LBLUE,NAVY,lw=1,alpha=0.35,r=0.4)
box(0.28,14.08,1.45,0.50,NAVY,NAVY,r=0.18,z=5)
t(1.005,14.33,"① INPUT",8.5,WHITE,"bold")
t(FW/2,14.55,"Borrower Loan Application",13,NAVY,"bold")
t(FW/2,13.92,"38 features across credit, financial, banking, compliance and loan-product dimensions",9,MGRAY)

FEAT=[
  ("Credit Bureau",  ["CIBIL Score","DPD 90+ Last 12M","Overdue A/C & Amount","Suit Filed Count"],LBLUE,NAVY),
  ("Financial KPIs", ["DSCR (Avg/Min)","Current Ratio","TOL / TNW","Profit After Tax"],LTEAL,TEAL),
  ("Banking Data",   ["Credit & Debit Txns","Avg EOD Balance","Inward/Outward Bounces","Enquiries 7/30d"],LAMBER,AMBER),
  ("Compliance",     ["GST Filing 3M/6M","Business Vintage (mo)","Entity Type","New Sanctions 30/90d"],LPURPLE,PURPLE),
  ("Loan Parameters",["Product Type","Amount Range (Rs)","Tenor (months)","Rate of Interest %"],LGREEN,GREEN),
]
FCW,FCG,FCX0=3.70,0.22,0.55
FCYB,FCH=11.82,1.86
for i,(title,lines,fc,ec) in enumerate(FEAT):
    fx=FCX0+i*(FCW+FCG)
    box(fx,FCYB,FCW,FCH,fc,ec,lw=1.8,r=0.28,z=4)
    t(fx+FCW/2,FCYB+FCH-0.23,title,9.5,ec,"bold")
    for j,line in enumerate(lines):
        t(fx+FCW/2,FCYB+FCH-0.55-j*0.30,line,8,DGRAY)
arr(FW/2,11.70,FW/2,11.44,NAVY,2)

# === DATA ZONE y=9.70-11.40 ===
box(0.2,9.70,21.6,1.70,LAMBER,AMBER,lw=1,alpha=0.4,r=0.4)
box(0.28,10.62,1.45,0.50,AMBER,AMBER,r=0.18,z=5)
t(1.005,10.87,"② DATA",8.5,WHITE,"bold")

DSETS=[
  ("to_be_filled_Updated.xlsx","6,187 Borrowers  38 Features  Post-EDA Cleaned",LBLUE,NAVY),
  ("Policy sheet_Finnup.xlsx","55 Active Policies  38 Lenders  5 Products",LTEAL,TEAL),
  ("FinnUp_Borrowers.xlsx","Raw Profiles  11 Sheets  Full Financial Detail",LAMBER,AMBER),
]
DW,DG,DX0=6.40,0.35,0.55
for i,(fname,detail,fc,ec) in enumerate(DSETS):
    dx=DX0+i*(DW+DG)
    box(dx,9.80,DW,1.45,fc,ec,lw=1.8,r=0.28,z=4)
    box(dx+0.15,11.02,0.52,0.18,ec,ec,lw=0,r=0.06,z=6)
    t(dx+0.41,11.11,"XLS",6,WHITE,"bold")
    t(dx+DW/2+0.1,10.90,fname,9,ec,"bold")
    t(dx+DW/2,10.52,detail,8,DGRAY)
arr(FW/2,9.70,FW/2,9.45,TEAL,2)

# === FEATURE ENGINEERING BAR y=8.92-9.42 ===
box(0.4,8.92,21.2,0.50,WHITE,MGRAY,lw=1.5,r=0.25,z=4)
t(1.78,9.175,"Feature Engineering",9,NAVY,"bold",ha="left")
t(4.0,9.32,"Imputation: median  |  Log-transform: Net Sales, PAT, TNW, EOD Bal, Txns",8,DGRAY,ha="left")
t(4.0,9.04,"Encode: one-hot Entity/GST/Product  |  Derived: loan-to-sales, credit-debit ratio, bounce rate, rate spread, overdue flag",7.8,DGRAY,ha="left")
arr(FW/2,8.92,FW/2,8.67,NAVY,2)

# === SMOTE y=8.18-8.64 ===
box(7.8,8.18,6.4,0.46,LPURPLE,PURPLE,lw=2,r=0.22,z=5)
t(FW/2,8.415,"SMOTE  --  Synthetic Minority Oversampling  (85:15 imbalance  -->  balanced 50:50 for training)",9,PURPLE,"bold")
arr(8.0,8.415,5.45,7.90,NAVY,2)
arr(14.0,8.415,16.55,7.90,TEAL,2)

# === ENGINE ZONE y=3.15-8.05 ===
box(0.2,3.15,21.6,4.90,LTEAL,TEAL,lw=1,alpha=0.18,r=0.4)
box(10.55,5.33,0.90,0.55,TEAL,TEAL,r=0.18,z=5)
t(11.0,5.61,"③",10,WHITE,"bold"); t(11.0,5.37,"ENG",6.5,WHITE,"bold")

# ENGINE 1
E1X,E1W=0.45,10.0; E1CX=5.45
box(E1X,3.30,E1W,4.55,WHITE,NAVY,lw=2.5,r=0.38,z=4)
t(E1CX,7.60,"ENGINE 1  --  ML Prediction",12,NAVY,"bold")
t(E1CX,7.28,"Learns which borrower profiles get approved  (6,187 labelled training records)",8.5,MGRAY)

MODELS=[
  ("Logistic\nRegression",["Interpretable baseline","L2 regularisation","class_weight balanced"],LBLUE,NAVY),
  ("Random\nForest",["200 trees  depth=8","Non-linear feature splits","Feature importance chart"],LTEAL,TEAL),
  ("XGBoost",["300 est  LR=0.05","scale_pos_weight=neg/pos","Gradient boosting"],LAMBER,AMBER),
  ("LightGBM",["300 est  LR=0.05","Leaf-wise growth","Fastest  highest AUC"],LGREEN,GREEN),
]
MW,MG,MX0=2.10,0.22,0.65; MB,MH=5.45,1.60
for i,(mname,lines,fc,ec) in enumerate(MODELS):
    mx=MX0+i*(MW+MG)
    box(mx,MB,MW,MH,fc,ec,lw=1.8,r=0.25,z=5)
    t(mx+MW/2,MB+MH-0.22,mname,9,ec,"bold")
    for j,line in enumerate(lines):
        t(mx+MW/2,MB+MH-0.58-j*0.30,line,7.5,DGRAY)

box(E1X+0.2,4.58,E1W-0.4,0.62,LGRAY,MGRAY,lw=1,r=0.2,z=5)
t(E1X+0.45,4.91,"Output:",8.5,NAVY,"bold",ha="left")
t(E1CX+1.0,4.91,"P(approved) = 0.0 to 1.0  per applicant",9,NAVY,"bold")
box(E1X+0.2,3.45,E1W-0.4,0.92,LGRAY,MGRAY,lw=1,r=0.2,z=5)
t(E1X+0.45,4.12,"Eval:",8,NAVY,"bold",ha="left")
t(E1CX,4.12,"5-Fold CV   ROC-AUC   PR-AUC   F1   Precision   Recall   Brier Score",8,DGRAY)
t(E1X+0.45,3.73,"Saved:",7.5,NAVY,"bold",ha="left")
t(E1CX,3.73,"Best model  ->  outputs/models/best_model.pkl      All metrics  ->  outputs/models/metrics.json",7.5,DGRAY)

# ENGINE 2
E2X,E2W=11.55,10.0; E2CX=16.55
box(E2X,3.30,E2W,4.55,WHITE,TEAL,lw=2.5,r=0.38,z=4)
t(E2CX,7.60,"ENGINE 2  --  Rule-Based Policy Filter",12,TEAL,"bold")
t(E2CX,7.28,"Hard-eliminates lenders whose policies the borrower does NOT satisfy",8.5,MGRAY)

RULES=[
  ("Loan Amount\n& Tenor",["Min/Max Rs range check","Tenor min/max months","Loan product type match"],LBLUE,NAVY),
  ("CIBIL Score\n& Vintage",["Per-lender min CIBIL","Business age threshold","New sanctions 30/90d"],LTEAL,TEAL),
  ("Entity Type\n& Industry",["Proprietorship/Pvt Ltd","LLP/Partnership/Other","Negative industry list"],LAMBER,AMBER),
  ("Financial\nFloor Checks",["DSCR minimum threshold","Current Ratio >= floor","Net Sales >= turnover min"],LGREEN,GREEN),
]
RX0=E2X+0.20
for i,(rname,lines,fc,ec) in enumerate(RULES):
    rx=RX0+i*(MW+MG)
    box(rx,MB,MW,MH,fc,ec,lw=1.8,r=0.25,z=5)
    t(rx+MW/2,MB+MH-0.22,rname,9,ec,"bold")
    for j,line in enumerate(lines):
        t(rx+MW/2,MB+MH-0.58-j*0.30,line,7.5,DGRAY)

box(E2X+0.2,4.58,E2W-0.4,0.62,LGRAY,MGRAY,lw=1,r=0.2,z=5)
t(E2X+0.45,4.91,"Output:",8.5,TEAL,"bold",ha="left")
t(E2CX+1.0,4.91,"MatchScore = 0.0 to 1.0  per eligible lender",9,TEAL,"bold")
box(E2X+0.2,3.45,E2W-0.4,0.92,LGRAY,MGRAY,lw=1,r=0.2,z=5)
t(E2X+0.45,4.12,"Scope:",8,TEAL,"bold",ha="left")
t(E2CX,4.12,"55 Active Policies   38 Lenders   5 Product Types   (Inactive policies excluded)",8,DGRAY)
t(E2X+0.45,3.73,"Match scoring:",7.5,TEAL,"bold",ha="left")
t(E2CX,3.73,"CIBIL headroom   Amount centrality   Vintage margin   Financial ratio slack",7.5,DGRAY)

arr(E1CX,3.30,E1CX,3.06,NAVY,2)
arr(E2CX,3.30,E2CX,3.06,TEAL,2)

# === COMBINED SCORE FORMULA y=2.28-3.02 ===
box(2.0,2.28,18.0,0.74,WHITE,PURPLE,lw=2.8,r=0.28,z=5)
t(FW/2,2.80,"Combined Score  =  0.6  x  P(approved)   +   0.4  x  MatchScore",13,PURPLE,"bold")
t(FW/2,2.44,"All eligible lenders ranked by combined score   -->   Top 3 returned to the borrower",9,DGRAY)
arr(FW/2,2.28,FW/2,2.04,PURPLE,2)

# === OUTPUT ZONE y=0.28-2.00 ===
box(0.2,0.28,21.6,1.72,LGREEN,GREEN,lw=1,alpha=0.40,r=0.4)
box(0.28,1.01,1.45,0.50,GREEN,GREEN,r=0.18,z=5)
t(1.005,1.26,"④ OUTPUT",8.5,WHITE,"bold")

LOUT=[
  ("#1","#1 Best Match",["Highest combined score","Strongest ML prob + policy fit","Recommended lender"],GREEN,LGREEN),
  ("#2","#2 Best Match",["Strong alternative lender","Different product/rate band","Second-ranked score"],TEAL,LTEAL),
  ("#3","#3 Best Match",["Fallback/backup option","Broader eligibility criteria","Third-ranked score"],AMBER,LAMBER),
]
LOW,LOG,LOX0=3.80,0.22,0.50; LB,LH=0.38,1.52
for i,(badge,rank,lines,ec,fc) in enumerate(LOUT):
    lx=LOX0+i*(LOW+LOG)
    box(lx,LB,LOW,LH,fc,ec,lw=2.5,r=0.32,z=5)
    box(lx+0.14,LB+LH-0.28,0.56,0.23,ec,WHITE,lw=0,r=0.10,z=6)
    t(lx+0.42,LB+LH-0.165,badge,8,WHITE,"bold")
    t(lx+LOW/2,LB+LH-0.47,rank,10,ec,"bold")
    for j,line in enumerate(lines):
        t(lx+LOW/2,LB+LH-0.82-j*0.28,line,8,DGRAY)

# Key Stats panel
KSX,KSW=12.25,9.55
box(KSX,LB,KSW,LH,WHITE,NAVY,lw=2,r=0.3,z=5)
t(KSX+KSW/2,LB+LH-0.20,"KEY STATS",10,NAVY,"bold")
KS=[
  ("Dataset",    "6,187 borrower applications   38 features   post-EDA"),
  ("Lenders",    "38 lenders   55 active policies   5 product types"),
  ("Target",     "8–11% approval rate  (real labels from FinnUp)"),
  ("Models",     "Logistic Reg  Random Forest  XGBoost  LightGBM"),
  ("Imbalance",  "SMOTE oversampling  (~90:10  to  balanced 50:50)"),
  ("Formula",    "Score = 0.6 x P(approved) + 0.4 x MatchScore"),
]
for i,(k,v) in enumerate(KS):
    yi=LB+LH-0.50-i*0.20
    t(KSX+0.25,yi,k+":",7.5,NAVY,"bold",ha="left")
    t(KSX+1.55,yi,v,7.5,DGRAY,ha="left")

# === FOOTER ===
box(0,0,FW,0.27,NAVY,NAVY,r=0,z=4)
t(FW/2,0.135,"APAL Cohort 2  .  Group 1  .  IIM Calcutta   |   FinnUp MSME Credit Intelligence Platform   |   May 2026",8,"#93C5FD")

fig.savefig(OUTPUT_PATH,dpi=150,bbox_inches="tight",facecolor=LGRAY,edgecolor="none")
plt.close(fig)
print(f"Saved -> {OUTPUT_PATH}")
