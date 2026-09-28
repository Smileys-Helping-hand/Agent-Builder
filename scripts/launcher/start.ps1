# Start Agent Builder - everything, in one go.
#
# Starts the local model, the builder itself, and (unless told not to) a tunnel
# so your phone can reach this machine from anywhere. Then prints a QR code that
# connects the app in one scan.
#
# Close this window, or press Ctrl+C, to stop everything it started.

param(
    [switch]$NoTunnel,
    # Use the public tunnel even when Tailscale is connected - needed when the
    # phone is signed into a different Tailscale account, and so on a different
    # tailnet, and therefore cannot see this machine.
    [switch]$ForceTunnel,
    [switch]$Quiet,
    [switch]$Daemon,
    # Open the app in the browser once everything is up (the desktop's "Open
    # Agent Builder" does this; starting at logon does not).
    [switch]$Open
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo

$dataDir = Join-Path $repo "data"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$pidFile = Join-Path $dataDir "launcher-pids.json"
$urlFile = Join-Path $dataDir "remote-url.txt"
$tunnelLog = Join-Path $dataDir "tunnel.log"
$apiLog = Join-Path $dataDir "api.log"

$started = @{ api = $null; ollama = $null; tunnel = $null }

function Write-Step($text) {
    if (-not $Quiet) { Write-Host "  $text" -ForegroundColor Gray }
}

function Write-Good($text) {
    if (-not $Quiet) { Write-Host "  $text" -ForegroundColor Green }
}

function Test-Endpoint($url, $timeoutSeconds = 3) {
    try {
        Invoke-WebRequest -Uri $url -TimeoutSec $timeoutSeconds -UseBasicParsing | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-For($url, $seconds, $what) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Test-Endpoint $url 2) { return $true }
        Start-Sleep -Seconds 1
    }
    Write-Host "  $what did not answer within $seconds seconds." -ForegroundColor Yellow
    return $false
}

if (-not $Quiet) {
    Write-Host ""
    Write-Host "  Agent Builder" -ForegroundColor Cyan
    Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
}

# --- 1. the local model -------------------------------------------------------
if (Test-Endpoint "http://localhost:11434/api/tags") {
    Write-Good "Model server already running"
} else {
    $ollama = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "C:\Program Files\Ollama\ollama.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($ollama) {
        Write-Step "Starting the model server..."
        $process = Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden -PassThru
        $started.ollama = $process.Id
        if (Wait-For "http://localhost:11434/api/tags" 60 "The model server") { Write-Good "Model server ready" }
    } else {
        Write-Host "  Ollama is not installed - install it from ollama.com, then run this again." -ForegroundColor Yellow
    }
}

# --- 1b. a stable address, if Tailscale is set up -----------------------------
# Tailscale gives this machine an address that never changes, which beats a
# quick tunnel whose hostname is different on every restart.
$tailscaleIp = $null
$tailscaleExe = @(
    "C:\Program Files\Tailscale\tailscale.exe",
    "$env:LOCALAPPDATA\Tailscale\tailscale.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($tailscaleExe) {
    $candidate = (& $tailscaleExe ip -4 2>$null | Select-Object -First 1)
    if ($candidate -and $candidate -match "^100\.") {
        $tailscaleIp = $candidate.Trim()
        if ($ForceTunnel) {
            Write-Good "Tailscale is connected ($tailscaleIp), but -ForceTunnel was asked for - using a public tunnel"
        } else {
            Write-Good "Tailscale is connected ($tailscaleIp) - using the address that never changes"
        }
    } else {
        Write-Host "  Tailscale is installed but not signed in. Run: tailscale up" -ForegroundColor Yellow
    }
}

# --- 2. the builder -----------------------------------------------------------
if (Test-Endpoint "http://127.0.0.1:4000/api/update/check") {
    Write-Good "Builder already running"
} else {
    # Check if port 4000 is held by another application (e.g. RemoteDesk).
    # RemoteDesk supports automatic scanning (4000-4009). If we restart it after
    # Agent Builder starts, it will cleanly take port 4001 without conflict.
    $restartRemoteDeskPath = $null
    $port4000Conn = Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1
    if ($port4000Conn) {
        $blockingProc = Get-Process -Id $port4000Conn.OwningProcess -ErrorAction SilentlyContinue
        if ($blockingProc -and $blockingProc.ProcessName -eq "remotedesk") {
            Write-Step "Port 4000 was held by RemoteDesk. Shifting RemoteDesk to port 4001+..."
            $restartRemoteDeskPath = $blockingProc.Path
            Stop-Process -Id $blockingProc.Id -Force
            Start-Sleep -Seconds 1
        }
    }

    Write-Step "Starting the builder..."
    # Bind beyond loopback when Tailscale is present: a tailnet address cannot
    # reach a server listening only on 127.0.0.1. Everything here needs an agent
    # key or a login regardless of which interface it is reached on.
    $bindHost = if ($tailscaleIp) { "0.0.0.0" } else { "127.0.0.1" }
    $process = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c set HOST=$bindHost&& npx tsx src/server/server.ts > `"$apiLog`" 2>&1" `
        -WorkingDirectory $repo -WindowStyle Hidden -PassThru
    $started.api = $process.Id
    if (Wait-For "http://127.0.0.1:4000/api/update/check" 90 "The builder") {
        Write-Good "Builder ready on http://127.0.0.1:4000"
        if ($restartRemoteDeskPath -and (Test-Path $restartRemoteDeskPath)) {
            Start-Process -FilePath $restartRemoteDeskPath
            Write-Good "RemoteDesk restarted (now active on port 4001+)"
        }
    } else {
        Write-Host "  Check $apiLog for what went wrong." -ForegroundColor Yellow
        if ($restartRemoteDeskPath -and (Test-Path $restartRemoteDeskPath)) {
            Start-Process -FilePath $restartRemoteDeskPath
        }
    }
}

# --- 3. a way in from outside -------------------------------------------------
$address = "http://127.0.0.1:4000"
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
$namedConfig = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
$hasNamedSubdomain = (Test-Path $namedConfig) -and (Select-String -Path $namedConfig -Pattern "agent\.savestate\.co\.za" -Quiet)

if (-not $NoTunnel -and $cloudflared -and $hasNamedSubdomain) {
    # Custom Cloudflare Subdomain: https://agent.savestate.co.za
    # Provides permanent HTTPS address with trusted SSL that works everywhere,
    # including outside Wi-Fi and mobile networks with zero mixed content blocking.
    Write-Step "Starting Cloudflare HTTPS tunnel for agent.savestate.co.za..."
    Remove-Item $tunnelLog -ErrorAction SilentlyContinue
    $process = Start-Process -FilePath $cloudflared.Source `
        -ArgumentList "tunnel run" `
        -WindowStyle Hidden -PassThru -RedirectStandardError $tunnelLog -RedirectStandardOutput "$tunnelLog.out"
    $started.tunnel = $process.Id
    $address = "https://agent.savestate.co.za"
    [System.IO.File]::WriteAllText($urlFile, $address)
    Write-Good "Reachable worldwide at https://agent.savestate.co.za"
} elseif ($tailscaleIp -and -not $ForceTunnel) {
    $address = "http://${tailscaleIp}:4000"
    [System.IO.File]::WriteAllText($urlFile, $address)
    if (-not (Test-Endpoint "$address/api/update/check" 5)) {
        Write-Host "  The builder is running but only on this PC. Use Stop Agent Builder, then start again," -ForegroundColor Yellow
        Write-Host "  so it listens on the Tailscale address too." -ForegroundColor Yellow
    }
} elseif (-not $NoTunnel) {
    if ($cloudflared) {
        Write-Step "Opening a quick tunnel so your phone can reach this machine..."
        $quickConfig = Join-Path $dataDir "cloudflared-quick.yml"
        if (-not (Test-Path $quickConfig)) {
            Set-Content -Path $quickConfig -Value "# empty on purpose" -Encoding ascii
        }
        Remove-Item $tunnelLog -ErrorAction SilentlyContinue
        $process = Start-Process -FilePath $cloudflared.Source `
            -ArgumentList "tunnel --config `"$quickConfig`" --url http://127.0.0.1:4000 --no-autoupdate" `
            -WindowStyle Hidden -PassThru -RedirectStandardError $tunnelLog -RedirectStandardOutput "$tunnelLog.out"
        $started.tunnel = $process.Id

        $found = $null
        for ($i = 0; $i -lt 40 -and -not $found; $i++) {
            Start-Sleep -Seconds 1
            if (Test-Path $tunnelLog) {
                $match = Select-String -Path $tunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($match) { $found = $match.Matches[0].Value }
            }
        }

        if ($found) {
            $address = $found
            [System.IO.File]::WriteAllText($urlFile, $found)
            Write-Good "Reachable from anywhere at $found"
        } else {
            Write-Host "  The tunnel did not report an address; using the local one." -ForegroundColor Yellow
            Write-Host "  See $tunnelLog" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  cloudflared is not installed, so this machine is only reachable on this network." -ForegroundColor Yellow
    }
} else {
    Remove-Item $urlFile -ErrorAction SilentlyContinue
}

# --- 4. how to connect --------------------------------------------------------
[System.IO.File]::WriteAllText($pidFile, ($started | ConvertTo-Json))

# The app is served by the builder itself from remote\out. Rebuild it when its
# source is newer than the last build, so an update shows up without a step.
$appIndex = Join-Path $repo "remote\out\index.html"
$appStale = -not (Test-Path $appIndex)
if (-not $appStale) {
    $builtAt = (Get-Item $appIndex).LastWriteTime
    $appStale = [bool](Get-ChildItem (Join-Path $repo "remote\app"), (Join-Path $repo "remote\lib") -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt $builtAt } | Select-Object -First 1)
}
if ($appStale) {
    Write-Step "Building the app (a minute, only after an update)..."
    $appLog = Join-Path $dataDir "app-build.log"
    & cmd.exe /c "npm --prefix remote run build > `"$appLog`" 2>&1"
    if ($LASTEXITCODE -eq 0) { Write-Good "App ready" } else { Write-Host "  The app did not build; see $appLog" -ForegroundColor Yellow }
}

if ($Open) {
    # On this PC the builder connects the app by itself; nothing to type.
    Start-Process "http://127.0.0.1:4000/"
}

if (-not $Quiet) {
    & npx tsx scripts/launcher/connect-info.ts $address
    Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  Leave this window open. Ctrl+C stops everything." -ForegroundColor Gray
    Write-Host ""
}

if ($Daemon) {
    Write-Good "Agent Builder is active in background daemon mode."
    exit 0
}

# --- 5. stay up until asked to stop -------------------------------------------
try {
    while ($true) {
        Start-Sleep -Seconds 5
        if ($started.api -and -not (Get-Process -Id $started.api -ErrorAction SilentlyContinue)) {
            Write-Host "  The builder stopped unexpectedly. See $apiLog" -ForegroundColor Yellow
            break
        }
    }
} finally {
    if (-not $Daemon) {
        if (-not $Quiet) { Write-Host "  Stopping..." -ForegroundColor Gray }
        foreach ($id in @($started.tunnel, $started.api, $started.ollama)) {
            if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
        }
        # The builder runs under a cmd wrapper, so stop the node process it spawned.
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*src/server/server.ts*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Remove-Item $urlFile -ErrorAction SilentlyContinue
        Remove-Item $pidFile -ErrorAction SilentlyContinue
        if (-not $Quiet) { Write-Host "  Stopped." -ForegroundColor Gray }
    }
}
