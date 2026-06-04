@echo off
title FinnUp - Lender Matching App
color 0B

echo ============================================
echo   Starting FinnUp App...
echo ============================================
echo.

:: Check setup was done
if not exist ".venv\Scripts\activate.bat" (
    echo [ERROR] Setup not complete.
    echo Please run SETUP.bat first.
    echo.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat

echo Starting FastAPI backend on http://localhost:8080 ...
start "FastAPI" /B .venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8080

echo Starting Next.js frontend on http://localhost:3000 ...
start "NextJS" /B node web\node_modules\next\dist\bin\next dev web --port 3000

echo.
echo Both servers starting...
timeout /t 4 /nobreak >nul

echo Opening browser...
start http://localhost:3000

echo.
echo App is running at http://localhost:3000
echo To stop, close this window and end the background processes.
echo.
pause
