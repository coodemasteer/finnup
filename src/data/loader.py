"""
loader.py
---------
Reads all 11 sheets from FinnUp_Borrowers.xlsx and returns
typed pandas DataFrames.

Usage:
    from src.data.loader import load_all, SHEET

    data = load_all()
    profile_df = data[SHEET.PROFILE]
    bank_df    = data[SHEET.BANK]
"""

from __future__ import annotations

import os
from pathlib import Path
from enum import Enum
from typing import Optional

import pandas as pd
import numpy as np

# ── Default Excel path ────────────────────────────────────────────────────────
DEFAULT_EXCEL = Path(r"C:\Users\Ganesh.Bisht\Downloads\FinnUp_Borrowers.xlsx")


# ── Sheet name constants ──────────────────────────────────────────────────────
class SHEET(str, Enum):
    PROFILE     = "Borrower Profile"
    DIRECTORS   = "Directors"
    LOANS       = "Loan Requests"
    DOCUMENTS   = "Documents"
    REFERENCES  = "References"
    BANK        = "Bank Statements"
    FIN_KPI     = "Financial KPIs"
    FIN_SUMMARY = "Financial Summary"
    BS          = "Balance Sheet"
    PL          = "P&L Statement"
    CF          = "Cash Flow"


# ── Company type / industry maps (from verified JSON: company_type int IDs) ──
COMPANY_TYPE_MAP: dict[int, str] = {
    1: "Proprietorship",
    2: "Partnership",
    3: "Private Limited",
    4: "Public Limited",
    5: "LLP",
    6: "Trust / NGO",
    7: "Other",
    8: "One Person Company",
}

COMPANY_INDUSTRY_MAP: dict[int, str] = {
    5:  "Manufacturing",
    6:  "Trading",
    7:  "Services",
    8:  "Agriculture",
    9:  "Construction",
    10: "Retail",
    11: "Hospitality",
    12: "Healthcare",
    13: "Education",
    14: "IT / ITES",
    15: "Transport / Logistics",
    16: "Real Estate",
    17: "Food Processing",
    18: "FMCG",
    19: "Auto & Components",
    20: "Textile",
    21: "Pharma",
}


# ── Loader ────────────────────────────────────────────────────────────────────
def load_all(
    excel_path: str | Path = DEFAULT_EXCEL,
    verbose: bool = True,
) -> dict[SHEET, pd.DataFrame]:
    """
    Load every sheet from FinnUp_Borrowers.xlsx.

    Returns a dict keyed by SHEET enum → pd.DataFrame.
    Missing sheets are returned as empty DataFrames (never raises KeyError).
    """
    path = Path(excel_path)
    if not path.exists():
        raise FileNotFoundError(f"Excel file not found: {path}")

    if verbose:
        print(f"Loading: {path}")

    data: dict[SHEET, pd.DataFrame] = {}

    for sheet in SHEET:
        try:
            df = pd.read_excel(path, sheet_name=sheet.value, dtype=str)
            df = _clean_common(df)
            data[sheet] = df
            if verbose:
                print(f"  {sheet.value:<22} {len(df):>6,} rows  {len(df.columns)} cols")
        except Exception as e:
            if verbose:
                print(f"  {sheet.value:<22} ⚠  Could not load: {e}")
            data[sheet] = pd.DataFrame()

    data = _cast_types(data)

    if verbose:
        print("Done.\n")

    return data


# ── Per-sheet type casting ────────────────────────────────────────────────────
def _cast_types(data: dict[SHEET, pd.DataFrame]) -> dict[SHEET, pd.DataFrame]:
    """Apply typed casting per sheet after loading."""

    # ── Borrower Profile ──────────────────────────────────────────────────────
    prof = data.get(SHEET.PROFILE, pd.DataFrame())
    if not prof.empty:
        num_cols = [
            "Borrower ID", "Turnover", "Networth", "Business Age",
            "Profile Complete %", "CIBIL Score",
            "Count Sanctions", "Count Disbursed",
            "Sanction Amount", "Disbursed Amount",
        ]
        prof = _to_numeric(prof, num_cols)

        # Decode company type / industry IDs to names
        if "Company Type ID" in prof.columns:
            prof["Company Type"] = (
                pd.to_numeric(prof["Company Type ID"], errors="coerce")
                .map(COMPANY_TYPE_MAP)
                .fillna(prof["Company Type ID"])
            )
        if "Company Industry ID" in prof.columns:
            prof["Company Industry"] = (
                pd.to_numeric(prof["Company Industry ID"], errors="coerce")
                .map(COMPANY_INDUSTRY_MAP)
                .fillna(prof["Company Industry ID"])
            )

        data[SHEET.PROFILE] = prof

    # ── Directors ─────────────────────────────────────────────────────────────
    dirs = data.get(SHEET.DIRECTORS, pd.DataFrame())
    if not dirs.empty:
        dirs = _to_numeric(dirs, ["Borrower ID", "CIBIL Score", "Ownership %"])
        data[SHEET.DIRECTORS] = dirs

    # ── Bank Statements ───────────────────────────────────────────────────────
    bank = data.get(SHEET.BANK, pd.DataFrame())
    if not bank.empty:
        num_bank = [
            "Borrower ID",
            "Total Credits", "Total Debits",
            "Inward Cheque Bounces", "Outward Cheque Bounces",
            "Avg EOD Balance", "Avg Credit Size", "Avg Debit Size",
        ]
        bank = _to_numeric(bank, num_bank)
        # Derived features
        bank["Total Bounces"]    = bank["Inward Cheque Bounces"].fillna(0) + bank["Outward Cheque Bounces"].fillna(0)
        bank["Bounce Ratio"]     = bank["Total Bounces"] / bank["Total Credits"].replace(0, np.nan)
        bank["Credit Debit Ratio"] = bank["Total Credits"] / bank["Total Debits"].replace(0, np.nan)
        data[SHEET.BANK] = bank

    # ── Financial KPIs ────────────────────────────────────────────────────────
    kpi = data.get(SHEET.FIN_KPI, pd.DataFrame())
    if not kpi.empty:
        kpi = _to_numeric(kpi, ["Borrower ID"])
        # Year columns are dynamic — cast everything after the 4th column to numeric
        fixed_cols = list(kpi.columns[:4])   # Borrower ID, Company Name, Unit, KPI Label
        year_cols  = list(kpi.columns[4:])
        for col in year_cols:
            kpi[col] = pd.to_numeric(kpi[col], errors="coerce")
        data[SHEET.FIN_KPI] = kpi

    # ── Financial Summary, BS, PL, CF ─────────────────────────────────────────
    for sheet in (SHEET.FIN_SUMMARY, SHEET.BS, SHEET.PL, SHEET.CF):
        df = data.get(sheet, pd.DataFrame())
        if not df.empty:
            df = _to_numeric(df, ["Borrower ID"])
            data[sheet] = df

    # ── Loan Requests ─────────────────────────────────────────────────────────
    loans = data.get(SHEET.LOANS, pd.DataFrame())
    if not loans.empty:
        loans = _to_numeric(loans, ["Borrower ID"])
        data[SHEET.LOANS] = loans

    return data


# ── Convenience functions ─────────────────────────────────────────────────────
def get_profile_with_bank(data: dict[SHEET, pd.DataFrame]) -> pd.DataFrame:
    """
    Merge Borrower Profile with aggregated Bank Statement features.
    One row per borrower.
    """
    prof = data[SHEET.PROFILE].copy()
    bank = data[SHEET.BANK]

    if bank.empty:
        return prof

    bank_agg = bank.groupby("Borrower ID").agg(
        total_credits        = ("Total Credits",         "sum"),
        total_debits         = ("Total Debits",          "sum"),
        inward_bounces       = ("Inward Cheque Bounces", "sum"),
        outward_bounces      = ("Outward Cheque Bounces","sum"),
        avg_eod_balance      = ("Avg EOD Balance",       "mean"),
        avg_credit_size      = ("Avg Credit Size",       "mean"),
        avg_debit_size       = ("Avg Debit Size",        "mean"),
        total_bounces        = ("Total Bounces",         "sum"),
        bounce_ratio         = ("Bounce Ratio",          "mean"),
        credit_debit_ratio   = ("Credit Debit Ratio",    "mean"),
        num_bank_accounts    = ("Borrower ID",           "count"),
    ).reset_index()

    merged = prof.merge(bank_agg, on="Borrower ID", how="left")
    return merged


def get_kpi_pivot(
    data: dict[SHEET, pd.DataFrame],
    kpi_labels: list[str] | None = None,
    latest_year_only: bool = True,
) -> pd.DataFrame:
    """
    Pivot Financial KPIs so each row = borrower, each column = one KPI.

    Parameters
    ----------
    kpi_labels : list of KPI labels to keep (None = all 36)
    latest_year_only : if True, keep only the most recent year's value per KPI
    """
    kpi = data[SHEET.FIN_KPI]
    if kpi.empty:
        return pd.DataFrame()

    if kpi_labels:
        kpi = kpi[kpi["KPI Label"].isin(kpi_labels)]

    year_cols = [c for c in kpi.columns if c not in ("Borrower ID", "Company Name", "Financial Unit", "KPI Label")]

    if latest_year_only:
        # Pick the rightmost non-null year for each row
        kpi = kpi.copy()
        kpi["latest_value"] = kpi[year_cols].apply(
            lambda row: row.dropna().iloc[-1] if row.dropna().shape[0] > 0 else np.nan,
            axis=1,
        )
        pivot = kpi.pivot_table(
            index="Borrower ID",
            columns="KPI Label",
            values="latest_value",
            aggfunc="first",
        ).reset_index()
    else:
        # Return long format
        pivot = kpi[["Borrower ID", "KPI Label"] + year_cols]

    pivot.columns.name = None
    return pivot


def get_director_summary(data: dict[SHEET, pd.DataFrame]) -> pd.DataFrame:
    """
    Aggregate Directors sheet to one row per borrower.
    Returns min/max/avg CIBIL across directors.
    """
    dirs = data[SHEET.DIRECTORS]
    if dirs.empty:
        return pd.DataFrame()

    return dirs.groupby("Borrower ID").agg(
        num_directors       = ("CIBIL Score", "count"),
        min_director_cibil  = ("CIBIL Score", "min"),
        max_director_cibil  = ("CIBIL Score", "max"),
        avg_director_cibil  = ("CIBIL Score", "mean"),
        max_ownership       = ("Ownership %",  "max"),
    ).reset_index()


def summary(data: dict[SHEET, pd.DataFrame]) -> None:
    """Print a quick summary of all loaded sheets."""
    print(f"{'Sheet':<25} {'Rows':>7} {'Cols':>5} {'Nulls %':>8}")
    print("-" * 50)
    for sheet, df in data.items():
        if df.empty:
            print(f"{sheet.value:<25} {'(empty)':>7}")
        else:
            null_pct = df.isnull().values.mean() * 100
            print(f"{sheet.value:<25} {len(df):>7,} {len(df.columns):>5} {null_pct:>7.1f}%")


# ── Helpers ───────────────────────────────────────────────────────────────────
def _clean_common(df: pd.DataFrame) -> pd.DataFrame:
    """Strip whitespace from string cells, Replace blank strings with NaN."""
    df = df.copy()
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].str.strip().replace("", np.nan).replace("None", np.nan).replace("nan", np.nan)
    return df


def _to_numeric(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    df = df.copy()
    for col in cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df
