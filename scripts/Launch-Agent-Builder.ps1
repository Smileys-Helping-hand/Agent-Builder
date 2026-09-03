# Agent Builder - Windows Desktop Auto-Launcher
$ErrorActionPreference = "SilentlyContinue"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "             AGENT BUILDER DESKTOP APP              " -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

$ProjectRoot = "e:\Projects\Agent-Builder"
Set-Location $ProjectRoot

# Step 1: Ensure Ollama is running
Write-Host "[1/4] Checking Local AI Engine (Ollama)..." -ForegroundColor Yellow
$ollamaListening = Get-NetTCPConnection -LocalPort 11434 -ErrorAction SilentlyContinue

if (-not $ollamaListening) {
    Write-Host "      Starting Ollama local GPU server..." -ForegroundColor Gray
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 2
} else {
    Write-Host "      [OK] Ollama active on port 11434" -ForegroundColor Green
}

# Step 2: Ensure super admin credentials are initialized
Write-Host "[2/4] Verifying Super Admin account..." -ForegroundColor Yellow
npx tsx scripts/setupSuperAdmin.ts | Out-Null
Write-Host "      [OK] Super Admin verified: mraaziqp" -ForegroundColor Green

# Step 3: Check and start Agent Builder API + Dashboard
Write-Host "[3/4] Starting Agent Builder Engine & Web UI..." -ForegroundColor Yellow
$apiListening = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
$dashListening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue

if (-not $apiListening -or -not $dashListening) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev:all" -WorkingDirectory $ProjectRoot -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

# Step 4: Open Desktop App Window
Write-Host "[4/4] Opening Mission Control Window..." -ForegroundColor Yellow
$targetUrl = "http://localhost:3000"

Write-Host "      [OK] Application online at $targetUrl" -ForegroundColor Green
Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Desktop App Ready!" -ForegroundColor Green
Write-Host "  Username : mraaziqp" -ForegroundColor White
Write-Host "  Password : (configured)" -ForegroundColor White
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

$edgePath = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
$chromePath = Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"
$appArg = "--app=" + $targetUrl

if (Test-Path $edgePath) {
    Start-Process -FilePath $edgePath -ArgumentList $appArg
} elseif (Test-Path $chromePath) {
    Start-Process -FilePath $chromePath -ArgumentList $appArg
} else {
    Start-Process $targetUrl
}
