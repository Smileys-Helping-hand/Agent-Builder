# Stop Agent Builder - for when the launcher window is gone but things are still running.

$ErrorActionPreference = "SilentlyContinue"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo

Write-Host ""
Write-Host "  Stopping Agent Builder" -ForegroundColor Cyan

$stopped = 0

# The builder (node running the server, however it was started).
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*src/server/server.ts*" -or $_.CommandLine -like "*dist/bundle/server.js*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        $stopped++
        Write-Host "  Builder stopped" -ForegroundColor Gray
    }

# The Jarvis bridge belongs to the builder (Jarvis himself is left running).
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*jarvis-peer-bridge*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        $stopped++
        Write-Host "  Jarvis bridge stopped" -ForegroundColor Gray
    }

# The packaged sidecar, if the desktop app was running.
Get-Process -Name "agent-builder-api" | ForEach-Object {
    Stop-Process -Id $_.Id -Force
    $stopped++
    Write-Host "  Packaged builder stopped" -ForegroundColor Gray
}

# The tunnel - only the builder's own. SaveState's tunnel (NexusEmuHost) serves savestate.co.za,
# and stopping the builder must not take that site down.
Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" |
    Where-Object { $_.CommandLine -notlike "*NexusEmuHost*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        $stopped++
        Write-Host "  Tunnel closed" -ForegroundColor Gray
    }

Remove-Item (Join-Path $repo "data\remote-url.txt")
Remove-Item (Join-Path $repo "data\launcher-pids.json")

# Stopped on purpose: the Host Manager leaves it stopped until it is started again.
$holdsFile = Join-Path $repo "data\host-holds.json"
$holds = @{}
if (Test-Path $holdsFile) { try { (Get-Content $holdsFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $holds[$_.Name] = $_.Value } } catch { } }
$holds["agent-builder"] = @{ since = (Get-Date).ToString("o"); by = "stop.ps1" }
[System.IO.File]::WriteAllText($holdsFile, ($holds | ConvertTo-Json -Compress))

# Ollama is deliberately left running: it is shared, cheap to keep, and other
# things on this machine may be using it. Pass -IncludeModel to stop it too.
if ($args -contains "-IncludeModel") {
    Get-Process -Name "ollama" | ForEach-Object {
        Stop-Process -Id $_.Id -Force
        Write-Host "  Model server stopped" -ForegroundColor Gray
    }
}

if ($stopped -eq 0) {
    Write-Host "  Nothing was running." -ForegroundColor Gray
} else {
    Write-Host "  Done." -ForegroundColor Green
}
Write-Host ""
Start-Sleep -Seconds 2
