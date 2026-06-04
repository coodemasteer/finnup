"""
run.py — Launch wrapper for FinnUp Streamlit app
Applies WindowsSelectorEventLoopPolicy BEFORE uvicorn starts,
fixing the WinError 10054 / WebSocket crash on Windows + Python 3.11.
"""
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from streamlit.web import cli as stcli

sys.argv = [
    "streamlit", "run", "app.py",
    "--server.enableCORS=false",
    "--server.enableXsrfProtection=false",
    "--server.address=0.0.0.0",
    "--server.port=8501",
]
sys.exit(stcli.main())
