$rd = Get-Process -Name "remotedesk" -ErrorAction SilentlyContinue
$path = if ($rd) { $rd.Path } else { "C:\Program Files\RemoteDesk\remotedesk.exe" }
if ($rd) {
    Write-Host "Stopping RemoteDesk (PID $($rd.Id))..."
    Stop-Process -Id $rd.Id -Force
    Start-Sleep -Seconds 1
}

Write-Host "Starting Agent Builder on port 4000..."
$process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c set HOST=0.0.0.0&& npx tsx src/server/server.ts" -WorkingDirectory (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) -WindowStyle Hidden -PassThru
Write-Host "Agent Builder started with PID $($process.Id)"

for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/update/check" -TimeoutSec 2 -ErrorAction Stop
        Write-Host "Agent Builder is UP and answering on port 4000!"
        break
    } catch {
        Write-Host "Waiting for Agent Builder..."
    }
}

if ($path -and (Test-Path $path)) {
    Write-Host "Restarting RemoteDesk on port 4001+..."
    Start-Process -FilePath $path
    Start-Sleep -Seconds 2
}

Write-Host "Checking listening ports:"
Get-NetTCPConnection -LocalPort 4000, 4001 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, State, OwningProcess
