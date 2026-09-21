# Make Agent Builder start when you log in, and put shortcuts on the desktop.
#
# Run it again with -Remove to undo both.

param([switch]$Remove)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskName = "Agent Builder"
$startScript = Join-Path $repo "scripts\launcher\start.ps1"
$desktop = [Environment]::GetFolderPath("Desktop")

if ($Remove) {
    schtasks /Delete /TN $taskName /F 2>&1 | Out-Null
    Remove-Item (Join-Path $desktop "Start Agent Builder.lnk") -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $desktop "Stop Agent Builder.lnk") -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "  Autostart removed and desktop shortcuts deleted." -ForegroundColor Green
    Write-Host ""
    Start-Sleep -Seconds 3
    exit 0
}

# --- start at logon -----------------------------------------------------------
# Quiet, so it does not throw a window in your face at every logon; the app and
# the tray are how you check on it.
$command = "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -Quiet"
schtasks /Create /TN $taskName /TR $command /SC ONLOGON /RL LIMITED /F | Out-Null
Write-Host ""
Write-Host "  Agent Builder will now start when you log in." -ForegroundColor Green

# --- desktop shortcuts --------------------------------------------------------
$shell = New-Object -ComObject WScript.Shell

$start = $shell.CreateShortcut((Join-Path $desktop "Start Agent Builder.lnk"))
$start.TargetPath = Join-Path $repo "Start Agent Builder.cmd"
$start.WorkingDirectory = $repo
$start.IconLocation = (Join-Path $repo "src-tauri\icons\icon.ico")
$start.Description = "Start the builder and show the QR code to connect your phone"
$start.Save()

$stop = $shell.CreateShortcut((Join-Path $desktop "Stop Agent Builder.lnk"))
$stop.TargetPath = Join-Path $repo "Stop Agent Builder.cmd"
$stop.WorkingDirectory = $repo
$stop.IconLocation = (Join-Path $repo "src-tauri\icons\icon.ico")
$stop.Description = "Stop the builder and close the tunnel"
$stop.Save()

Write-Host "  Shortcuts added to your desktop." -ForegroundColor Green
Write-Host ""
Write-Host "  Undo either with: Install Autostart.cmd -Remove" -ForegroundColor DarkGray
Write-Host ""
Start-Sleep -Seconds 4
