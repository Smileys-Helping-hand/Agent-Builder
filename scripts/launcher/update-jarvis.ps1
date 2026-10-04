# Update the Jarvis that runs on this PC to the latest GitHub main.
#
# Jarvis is developed elsewhere (another checkout, another chat) and pushed to
# main; this brings the running copy up to date. Following his handover notes:
# stop before building (never build under a running `next start`), always
# delete .next (a cache from an interrupted build poisons later ones), and
# start him again whether the build worked or not.
#
#   powershell -File scripts\launcher\update-jarvis.ps1          # update if behind
#   powershell -File scripts\launcher\update-jarvis.ps1 -Check   # only report

param([switch]$Check, [switch]$Force)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dataDir = Join-Path $repo "data"
$jarvisDir = if ($env:JARVIS_DIR) { $env:JARVIS_DIR } else { "E:\Services\jarvis" }
$jarvisLog = Join-Path $dataDir "jarvis.log"
$flag = Join-Path $dataDir "jarvis-updating.flag"

if (-not (Test-Path (Join-Path $jarvisDir ".git"))) {
    Write-Host "No Jarvis checkout at $jarvisDir." -ForegroundColor Yellow
    exit 1
}

Set-Location $jarvisDir
git fetch --quiet origin main
$behind = [int](git rev-list --count HEAD..origin/main)
$current = git rev-parse --short HEAD
$latest = git rev-parse --short origin/main
Write-Host "Jarvis is at $current; main is at $latest ($behind commit(s) behind)."
if ($Check) { exit 0 }
if ($behind -eq 0 -and -not $Force) { Write-Host "Nothing to do."; exit 0 }

$lockChanged = [bool](git diff --name-only HEAD origin/main -- package-lock.json)

# Tell the launcher's watchdog to leave him alone while he is rebuilt.
Set-Content -Path $flag -Value (Get-Date -Format o) -Encoding ascii
try {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*next*start -p 3005*" -or $_.CommandLine -like "*jarvis-node-agent*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    git merge --ff-only --quiet origin/main
    if ($lockChanged) { & cmd.exe /c "npm ci --no-audit --no-fund >> `"$jarvisLog`" 2>&1" }

    Remove-Item -Recurse -Force (Join-Path $jarvisDir ".next") -ErrorAction SilentlyContinue
    & cmd.exe /c "npx next build >> `"$jarvisLog`" 2>&1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "The new Jarvis did not build; going back to $current." -ForegroundColor Yellow
        git reset --hard --quiet $current
        Remove-Item -Recurse -Force (Join-Path $jarvisDir ".next") -ErrorAction SilentlyContinue
        & cmd.exe /c "npx next build >> `"$jarvisLog`" 2>&1"
    }
} finally {
    Remove-Item $flag -ErrorAction SilentlyContinue
}

# His database changes, as his own updater on the laptop runs them. Both are
# idempotent and only add (tables, columns, indexes), so running them on every
# update is safe; a failure is logged, not fatal, and his doctor says what is
# still missing.
foreach ($migration in @("scripts\migrate-jarvis-hybrid.mjs", "scripts\migrate-jarvis-ops.mjs")) {
    if (Test-Path (Join-Path $jarvisDir $migration)) {
        & cmd.exe /c "node $migration >> `"$jarvisLog`" 2>&1"
        if ($LASTEXITCODE -ne 0) { Write-Host "  $migration did not finish; see data\jarvis.log." -ForegroundColor Yellow }
    }
}
if (Test-Path (Join-Path $jarvisDir "scripts\jarvis-doctor.mjs")) {
    & cmd.exe /c "node scripts\jarvis-doctor.mjs >> `"$jarvisLog`" 2>&1"
}

# Start him here rather than waiting for the watchdog, so the update ends with him up.
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx next start -p 3005 -H 127.0.0.1 >> `"$jarvisLog`" 2>&1" `
    -WorkingDirectory $jarvisDir -WindowStyle Hidden | Out-Null
Start-Process -FilePath "cmd.exe" -ArgumentList "/c node --env-file=.env scripts/jarvis-node-agent.mjs >> `"$jarvisLog`" 2>&1" `
    -WorkingDirectory $jarvisDir -WindowStyle Hidden | Out-Null
# The peer bridge runs from this checkout's script: stop it so the launcher's
# watchdog starts the new one on its next round.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*jarvis-peer-bridge*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "Jarvis is now at $(git rev-parse --short HEAD) and starting." -ForegroundColor Green
