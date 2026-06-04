# FinnUp Lender Matching — Setup Guide

## Prerequisites

| Tool | Version | Download |
|---|---|---|
| Python | 3.10+ | https://python.org |
| Node.js | 18+ | https://nodejs.org |

---

## Setup (One-time)

### 1. Python backend

```powershell
# From the project root
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

> **Windows ExecutionPolicy error?** Run this first:
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
> ```

### 2. Next.js frontend

```powershell
cd web
npm install
cd ..
```

---

## Run the App

### Option A — Full stack (FastAPI + Next.js UI)

```powershell
.\.venv\Scripts\Activate.ps1
.\start_servers.ps1
```

- Next.js UI: http://localhost:3000
- FastAPI docs: http://localhost:8080/docs

### Option B — Streamlit UI only

```powershell
.\.venv\Scripts\Activate.ps1
streamlit run app.py
```

- Opens automatically at http://localhost:8501

---

## Train the Model

```powershell
.\.venv\Scripts\Activate.ps1
python train.py
```

Model outputs saved to `outputs/models/`.

---

## Project Structure

```
finnup-prediction/
├── app.py               # Streamlit UI
├── train.py             # Model training script
├── requirements.txt     # Python dependencies
├── api/                 # FastAPI backend
├── src/                 # Core ML logic
│   ├── data/            # Data loading
│   ├── features/        # Feature engineering
│   └── models/          # Model training & lender matching
├── web/                 # Next.js frontend
├── data/                # Input data files
├── outputs/             # Trained model artifacts
└── notebooks/           # EDA and modeling notebooks
```

---

## Data Files

Place the following files in the project root (already included in the zip):
- `FinnUp_Borrowers.xlsx` — borrower data
- `Policy sheet_Finnup.xlsx` — lender policy rules
- `Capstone_Consol Sheet_22.05.2026.xlsx` — consolidated dataset
