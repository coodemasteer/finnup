@echo off
title FinnUp - First Time Setup
color 0A

echo ============================================
echo   FinnUp - First Time Setup
echo ============================================
echo.

:: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed.
    echo.
    echo Please install Python 3.10 or later from:
    echo   https://www.python.org/downloads/
    echo.
    echo IMPORTANT: Check "Add Python to PATH" during install.
    echo.
    pause
    exit /b 1
)

echo [OK] Python found
echo.
echo Setting up Python environment... (this may take 2-3 minutes)
echo.

python -m venv .venv
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat
pip install -r requirements.txt --quiet

if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python packages.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Setup complete! 
echo   Run START.bat to launch the app.
echo ============================================
echo.
pause
