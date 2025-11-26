Write-Host "Starting AutoDev Forge setup..." -ForegroundColor Cyan

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm is required to set up the Agent Builder."; exit 1
}

Write-Host "Installing backend dependencies..." -ForegroundColor Green
npm install | Out-Null

Write-Host "Installing dashboard dependencies..." -ForegroundColor Green
npm --prefix dashboard install | Out-Null

Write-Host "Generating environment file..." -ForegroundColor Green
npm run regen-env | Out-Null

Write-Host "Building dashboard..." -ForegroundColor Green
npm run dashboard:build | Out-Null

Write-Host "Starting application (backend + dashboard)..." -ForegroundColor Green
npm run start-app

Write-Host "Visit http://localhost:3000 to start" -ForegroundColor Cyan
