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

# The tunnel.
Get-Process -Name "cloudflared" | ForEach-Object {
    Stop-Process -Id $_.Id -Force
    $stopped++
    Write-Host "  Tunnel closed" -ForegroundColor Gray
}

Remove-Item (Join-Path $repo "data\remote-url.txt")
Remove-Item (Join-Path $repo "data\launcher-pids.json")

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
