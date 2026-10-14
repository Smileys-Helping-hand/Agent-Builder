# Start the Host Manager at logon, on its own.
#
# The launcher starts it too, but at logon the launcher can die or stall
# before it gets that far (2026-10-14: it logged "Launcher starting" and was
# gone). Started separately, the Host Manager is already up then, sees the
# builder down for three minutes, and starts it again.
#
#   powershell -ExecutionPolicy Bypass -File scripts\host-manager\install.ps1           install (and start now)
#   powershell -ExecutionPolicy Bypass -File scripts\host-manager\install.ps1 -Remove   take it out of startup

param([switch]$Remove)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script = Join-Path $repo "scripts\host-manager\host-manager.mjs"
$log = Join-Path $repo "data\host-manager.log"
$startup = [Environment]::GetFolderPath("Startup")
$entry = Join-Path $startup "Agent Builder Host Manager.vbs"

if ($Remove) {
    Remove-Item $entry -ErrorAction SilentlyContinue
    Write-Host "  Host Manager taken out of startup (it still starts with Agent Builder)." -ForegroundColor Gray
    exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "C:\Program Files\nodejs\node.exe" }
if (-not (Test-Path $node)) { Write-Host "  Node.js is not installed." -ForegroundColor Red; exit 1 }

New-Item -ItemType Directory -Force -Path (Join-Path $repo "data") | Out-Null
# Hidden, no window: a VBScript runs it with window style 0.
$vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$repo"
sh.Run "cmd /c """"$node"" ""$script"" >> ""$log"" 2>&1""", 0, False
"@
Set-Content -Path $entry -Value $vbs -Encoding ascii
Write-Host "  Host Manager starts at logon ($entry)." -ForegroundColor Green

# And now, unless it is already running.
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:4100/api/health" -TimeoutSec 3 -UseBasicParsing | Out-Null
    Write-Host "  Already running on http://127.0.0.1:4100" -ForegroundColor Gray
} catch {
    Start-Process -FilePath "wscript.exe" -ArgumentList "`"$entry`"" -WindowStyle Hidden
    Write-Host "  Started: http://127.0.0.1:4100 (the key is HOST_MANAGER_KEY in .env)" -ForegroundColor Green
}
