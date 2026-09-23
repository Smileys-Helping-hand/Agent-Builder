# Start Agent Builder - everything, in one go.
#
# Starts the local model, the builder itself, and (unless told not to) a tunnel
# so your phone can reach this machine from anywhere. Then prints a QR code that
# connects the app in one scan.
#
# Close this window, or press Ctrl+C, to stop everything it started.

param(
    [switch]$NoTunnel,
    [switch]$Quiet
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
        Write-Good "Tailscale is connected ($tailscaleIp) - using the address that never changes"
    } else {
        Write-Host "  Tailscale is installed but not signed in. Run: tailscale up" -ForegroundColor Yellow
    }
}

# --- 2. the builder -----------------------------------------------------------
if (Test-Endpoint "http://127.0.0.1:4000/api/update/check") {
    Write-Good "Builder already running"
} else {
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
    } else {
        Write-Host "  Check $apiLog for what went wrong." -ForegroundColor Yellow
    }
}

# --- 3. a way in from outside -------------------------------------------------
$address = "http://127.0.0.1:4000"
if ($tailscaleIp) {
    $address = "http://${tailscaleIp}:4000"
    [System.IO.File]::WriteAllText($urlFile, $address)
    # Test a real endpoint: the API has no route at / and answers 404 there,
    # which Test-Endpoint reads as unreachable - that produced a false warning
    # saying the builder was only reachable on this PC when it was not true.
    if (-not (Test-Endpoint "$address/api/update/check" 5)) {
        Write-Host "  The builder is running but only on this PC. Use Stop Agent Builder, then start again," -ForegroundColor Yellow
        Write-Host "  so it listens on the Tailscale address too." -ForegroundColor Yellow
    }
} elseif (-not $NoTunnel) {
    $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cloudflared) {
        Write-Step "Opening a tunnel so your phone can reach this machine..."
        # Point cloudflared at an empty config of our own. The machine config
        # (~/.cloudflared/config.yml) routes savestate.co.za and answers 404 to
        # everything else, and a quick tunnel inherits it - which made every
        # request to the tunnel return 404.
        $quickConfig = Join-Path $dataDir "cloudflared-quick.yml"
        if (-not (Test-Path $quickConfig)) {
            Set-Content -Path $quickConfig -Value "# empty on purpose" -Encoding ascii
        }
        Remove-Item $tunnelLog -ErrorAction SilentlyContinue
        $process = Start-Process -FilePath $cloudflared.Source `
            -ArgumentList "tunnel --config `"$quickConfig`" --url http://127.0.0.1:4000 --no-autoupdate" `
            -WindowStyle Hidden -PassThru -RedirectStandardError $tunnelLog -RedirectStandardOutput "$tunnelLog.out"
        $started.tunnel = $process.Id

        # cloudflared prints the address it assigned a few seconds after start.
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

if (-not $Quiet) {
    & npx tsx scripts/launcher/connect-info.ts $address
    Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  Leave this window open. Ctrl+C stops everything." -ForegroundColor Gray
    Write-Host ""
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
