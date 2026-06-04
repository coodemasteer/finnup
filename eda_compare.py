import sys, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, ".")

import pandas as pd
import numpy as np

# OLD data
old = pd.read_excel("to_be_filled_Updated.xlsx", sheet_name="Sheet1")
old.columns = [c.strip() for c in old.columns]

# NEW data
xl = pd.ExcelFile("Capstone_Consol Sheet_22.05.2026.xlsx")
new_borr = xl.parse("Total borrowers")
new_borr.columns = [c.strip() for c in new_borr.columns]
new_appr = xl.parse("Approved loans")
new_apps = xl.parse("Loan Applications")
new_pol  = xl.parse("Lender policy")

print("=== DATASET SIZE ===")
print(f"OLD borrowers   : {old.shape[0]:,} rows x {old.shape[1]} cols")
print(f"NEW borrowers   : {new_borr.shape[0]:,} rows x {new_borr.shape[1]} cols")
print(f"NEW approved    : {new_appr.shape[0]:,} disbursed loans")
print(f"NEW applications: {new_apps.shape[0]:,} rows")
active_pol = new_pol[new_pol["status"] == "Active"]
print(f"NEW policies    : {len(active_pol)} active (was 55)")

# Approval rate
from src.features.engineering import create_target, create_target_real, load_raw
raw = load_raw()
df_real = create_target_real(raw)
df_syn  = create_target(raw)
print(f"\n=== TARGET LABELS ===")
print(f"Synthetic approval rate : {df_syn['loan_approved'].mean():.1%}  ({int(df_syn['loan_approved'].sum())} / {len(df_syn)})")
print(f"Real approval rate      : {df_real['loan_approved'].mean():.1%}  ({int(df_real['loan_approved'].sum())} / {len(df_real)})")

# CIBIL distribution
print(f"\n=== CIBIL SCORE ===")
print(f"OLD  mean={old['CIBIL Score'].mean():.0f}  median={old['CIBIL Score'].median():.0f}  std={old['CIBIL Score'].std():.0f}")
print(f"NEW  mean={new_borr['CIBIL Score'].mean():.0f}  median={new_borr['CIBIL Score'].median():.0f}  std={new_borr['CIBIL Score'].std():.0f}")

# Net Sales
print(f"\n=== NET SALES ===")
print(f"OLD  mean=Rs{old['Net Sales'].mean()/1e5:.1f}L  median=Rs{old['Net Sales'].median()/1e5:.1f}L")
print(f"NEW  mean=Rs{new_borr['Net Sales'].mean()/1e5:.1f}L  median=Rs{new_borr['Net Sales'].median()/1e5:.1f}L")

# Vintage
print(f"\n=== VINTAGE (months) ===")
print(f"OLD  mean={old['Vintage (in months)'].mean():.0f}  median={old['Vintage (in months)'].median():.0f}")
print(f"NEW  mean={new_borr['Vintage (in months)'].mean():.0f}  median={new_borr['Vintage (in months)'].median():.0f}")

# Entity types
print(f"\n=== ENTITY TYPE (top 5) ===")
print("OLD:")
print(old["Type of Entity"].value_counts().head(5).to_string())
print("NEW:")
print(new_borr["Type of Entity"].value_counts().head(5).to_string())

# Overdue
print(f"\n=== OVERDUE ACCOUNTS ===")
print(f"OLD  {(old['Count of Overdue Accounts']==0).mean():.1%} have zero overdue")
print(f"NEW  {(new_borr['Count of Overdue Accounts']==0).mean():.1%} have zero overdue")

# Loan amount
print(f"\n=== LOAN AMOUNT MIN ===")
print(f"OLD  mean=Rs{old['Loan Amount Min'].mean()/1e5:.1f}L  median=Rs{old['Loan Amount Min'].median()/1e5:.1f}L")
print(f"NEW  mean=Rs{new_borr['Loan Amount Min'].mean()/1e5:.1f}L  median=Rs{new_borr['Loan Amount Min'].median()/1e5:.1f}L")

# Lenders
print(f"\n=== ACTIVE LENDERS (19) ===")
for l in active_pol["Lender"].tolist():
    print(f"  - {l}")

# Application outcomes
print(f"\n=== LOAN APPLICATION OUTCOMES ===")
print(new_apps["loanapplication_status"].value_counts().to_string())

print("\nDone.")
