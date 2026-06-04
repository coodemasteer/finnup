# start_servers.ps1 — Starts FastAPI (port 8080) + Next.js (port 3000)

Write-Host "Starting FastAPI backend on http://localhost:8080 ..." -ForegroundColor Cyan
$api = Start-Process -FilePath ".\.venv\Scripts\python.exe" `
  -ArgumentList "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1", "--port", "8080", "--reload" `
  -PassThru -NoNewWindow

Write-Host "Starting Next.js frontend on http://localhost:3000 ..." -ForegroundColor Cyan
$web = Start-Process -FilePath "node" `
  -ArgumentList `
    "web\node_modules\next\dist\bin\next", `
    "dev", `
    "web", `
    "--port", "3000" `
  -PassThru -NoNewWindow

Write-Host ""
Write-Host "Both servers running:" -ForegroundColor Green
Write-Host "  FastAPI:  http://localhost:8080/docs" -ForegroundColor Yellow
Write-Host "  Next.js:  http://localhost:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop." -ForegroundColor Gray

try { Wait-Process -Id $api.Id } catch {}
