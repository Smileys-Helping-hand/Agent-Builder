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
    Remove-Item (Join-Path $desktop "Open Agent Builder.lnk") -ErrorAction SilentlyContinue
    $startup = [Environment]::GetFolderPath("Startup")
    Remove-Item (Join-Path $startup "Start Agent Builder.lnk") -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "  Autostart removed and desktop shortcuts deleted." -ForegroundColor Green
    Write-Host ""
    Start-Sleep -Seconds 3
    exit 0
}

# --- start at logon -----------------------------------------------------------
$startup = [Environment]::GetFolderPath("Startup")
$shell = New-Object -ComObject WScript.Shell

$autostart = $shell.CreateShortcut((Join-Path $startup "Start Agent Builder.lnk"))
$autostart.TargetPath = Join-Path $repo "Start Agent Builder.cmd"
$autostart.WorkingDirectory = $repo
$autostart.IconLocation = (Join-Path $repo "src-tauri\icons\icon.ico")
$autostart.Description = "Start Agent Builder on Windows logon"
$autostart.Save()
Write-Host ""
Write-Host "  Agent Builder autostart shortcut added to Windows Startup." -ForegroundColor Green

# --- desktop shortcuts --------------------------------------------------------
$start = $shell.CreateShortcut((Join-Path $desktop "Start Agent Builder.lnk"))
$start.TargetPath = Join-Path $repo "Start Agent Builder.cmd"
$start.WorkingDirectory = $repo
$start.IconLocation = (Join-Path $repo "src-tauri\icons\icon.ico")
$start.Description = "Start the builder and show the QR code to connect your phone"
$start.Save()

$open = $shell.CreateShortcut((Join-Path $desktop "Open Agent Builder.lnk"))
$open.TargetPath = Join-Path $repo "Open Agent Builder.cmd"
$open.WorkingDirectory = $repo
$open.IconLocation = (Join-Path $repo "src-tauri\icons\icon.ico")
$open.Description = "Open the Agent Builder app, starting the builder first if it is not running"
$open.Save()

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
