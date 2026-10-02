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
    [switch]$Open,
    # Start on the code as it is, without fetching updates from GitHub first.
    [switch]$NoUpdate
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
$launcherLog = Join-Path $dataDir "launcher.log"

# One line per thing the launcher did on its own, so "why was it down at 7pm"
# has an answer. Kept short: the newest 500 lines.
function Write-LauncherLog($text) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text
    Add-Content -Path $launcherLog -Value $line -Encoding ascii
    $lines = Get-Content $launcherLog -ErrorAction SilentlyContinue
    if ($lines.Count -gt 500) { $lines | Select-Object -Last 500 | Set-Content $launcherLog -Encoding ascii }
}

# Game mode (set from the app): the graphics card is the gamer's, so the model
# server stays off until it is switched off again. See src/utils/GameMode.ts.
$gameModeFile = Join-Path $dataDir "game-mode.json"
function Test-GameMode {
    if (-not (Test-Path $gameModeFile)) { return $false }
    try { return [bool]((Get-Content $gameModeFile -Raw | ConvertFrom-Json).on) } catch { return $false }
}

$started = @{ api = $null; ollama = $null; tunnel = $null; jarvis = $null; jarvisAgent = $null }

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

# --- 0. bring the code up to date ---------------------------------------------
# Every start picks up what has been merged on GitHub, so restarting is all an
# update needs. Fast-forward only: if this PC has its own commits or edits in
# the way, git refuses, nothing is overwritten, and it starts as it is.
if (-not $NoUpdate -and (Test-Path (Join-Path $repo ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    # git and npm write progress to stderr; Windows PowerShell would treat that
    # as a failure under "Stop" and end the launcher. An update must never stop a start.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $before = (& git rev-parse HEAD 2>$null)
    $pulled = $false
    try {
        $env:GIT_TERMINAL_PROMPT = "0"
        $output = (& git pull --ff-only --quiet 2>&1 | Out-String)
        $pulled = ($LASTEXITCODE -eq 0)
    } catch {
        $output = $_.Exception.Message
    }
    $after = (& git rev-parse HEAD 2>$null)
    if (-not $pulled) {
        Write-Host "  Could not update from GitHub (starting as it is): $("$output".Trim().Split([Environment]::NewLine)[0])" -ForegroundColor Yellow
        Write-LauncherLog "Update skipped: $("$output".Trim().Split([Environment]::NewLine)[0])"
    } elseif ($before -ne $after) {
        $changed = (& git diff --name-only $before $after 2>$null)
        Write-Good "Updated to $($after.Substring(0, 7)) ($(@($changed).Count) file(s) changed)"
        Write-LauncherLog "Updated $($before.Substring(0, 7)) -> $($after.Substring(0, 7))"
        if ($changed -match '^(package\.json|package-lock\.json)$') {
            Write-Step "Installing the builder's packages..."
            & npm install --no-audit --no-fund 2>&1 | Out-Null
        }
        if (($changed -match '^remote/') -and (Test-Path (Join-Path $repo "remote\node_modules"))) {
            Write-Step "Rebuilding the app this PC serves..."
            Push-Location (Join-Path $repo "remote")
            if ($changed -match '^remote/package(-lock)?\.json$') { & npm install --no-audit --no-fund 2>&1 | Out-Null }
            & npm run build 2>&1 | Out-Null
            Pop-Location
        }
    } else {
        Write-Good "Up to date ($($after.Substring(0, 7)))"
    }
    $ErrorActionPreference = $previousPreference
}

# --- 1. the local model -------------------------------------------------------
# Every caller gets the builder's 16k window by default. Jarvis talks to Ollama
# through its OpenAI-style endpoint, which cannot ask for a window; without
# this the model would be reloaded each time he and a build take turns.
if (-not $env:OLLAMA_CONTEXT_LENGTH) { $env:OLLAMA_CONTEXT_LENGTH = "16384" }
if (Test-GameMode) {
    Write-Step "Game mode is on: leaving the model server off (switch it off in the app)"
} elseif (Test-Endpoint "http://localhost:11434/api/tags") {
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
# Bind beyond loopback when Tailscale is present: a tailnet address cannot
# reach a server listening only on 127.0.0.1. Everything here needs an agent
# key or a login regardless of which interface it is reached on.
$bindHost = if ($tailscaleIp) { "0.0.0.0" } else { "127.0.0.1" }

# Appends rather than overwrites, so a restart does not erase the reason for it.
function Start-Api {
    Add-Content -Path $apiLog -Value ("`n==== started {0} ====" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding ascii
    $process = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c set HOST=$bindHost&& npx tsx src/server/server.ts >> `"$apiLog`" 2>&1" `
        -WorkingDirectory $repo -WindowStyle Hidden -PassThru
    return $process.Id
}

function Stop-ApiProcesses {
    if ($started.api) { Stop-Process -Id $started.api -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*src/server/server.ts*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

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
    $started.api = Start-Api
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

# --- 2b. Jarvis ---------------------------------------------------------------
# Jarvis (the Second Brain assistant) runs from his own checkout of GitHub main,
# kept apart from the copy he is developed in, so work in progress there never
# takes him down. scripts/launcher/update-jarvis.ps1 pulls and rebuilds it.
$jarvisDir = if ($env:JARVIS_DIR) { $env:JARVIS_DIR } else { "E:\Services\jarvis" }
$jarvisLog = Join-Path $dataDir "jarvis.log"
$jarvisUrl = "http://127.0.0.1:3005/api/jarvis/status"
$hasJarvis = Test-Path (Join-Path $jarvisDir ".next\BUILD_ID")

function Start-Jarvis {
    Add-Content -Path $jarvisLog -Value ("`n==== started {0} ====" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding ascii
    $process = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npx next start -p 3005 -H 127.0.0.1 >> `"$jarvisLog`" 2>&1" `
        -WorkingDirectory $jarvisDir -WindowStyle Hidden -PassThru
    return $process.Id
}

# His heartbeat: presence, project probes and keeping the model warm.
function Start-JarvisAgent {
    $process = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c node --env-file=.env scripts/jarvis-node-agent.mjs >> `"$jarvisLog`" 2>&1" `
        -WorkingDirectory $jarvisDir -WindowStyle Hidden -PassThru
    return $process.Id
}

function Stop-JarvisProcesses {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*next*start -p 3005*" -or $_.CommandLine -like "*jarvis-node-agent*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($hasJarvis) {
    if (Test-Endpoint $jarvisUrl 3) {
        Write-Good "Jarvis already running"
    } else {
        Write-Step "Starting Jarvis..."
        Stop-JarvisProcesses
        $started.jarvis = Start-Jarvis
        if (Wait-For $jarvisUrl 90 "Jarvis") { Write-Good "Jarvis ready on port 3005" }
        $started.jarvisAgent = Start-JarvisAgent
    }
} else {
    Write-Step "Jarvis is not set up on this PC (no build in $jarvisDir) - skipping."
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
# This used to stop everything the moment the builder exited, which is the
# wrong thing for a machine left running while you are out: one crash and it
# stayed down until someone was back at the PC. Now it brings the builder and
# the model server back, waiting longer after each failure so a build that is
# broken outright cannot spin in a tight loop.
$ollamaExe = @(
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "C:\Program Files\Ollama\ollama.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$backoff = @(5, 15, 30, 60, 120, 300)
$apiFailures = 0
$apiMisses = 0
$ollamaMisses = 0
$jarvisMisses = 0
$healthySince = Get-Date
Write-LauncherLog "Launcher watching the builder, the model server and Jarvis"

try {
    while ($true) {
        Start-Sleep -Seconds 15

        # The builder: gone, or up but not answering for a minute.
        $apiAlive = $started.api -and (Get-Process -Id $started.api -ErrorAction SilentlyContinue)
        $apiAnswers = Test-Endpoint "http://127.0.0.1:4000/api/update/check" 5
        if ($apiAnswers) { $apiMisses = 0 } else { $apiMisses++ }

        if (-not $apiAnswers -and (-not $apiAlive -or $apiMisses -ge 4)) {
            $wait = $backoff[[Math]::Min($apiFailures, $backoff.Count - 1)]
            $why = if ($apiAlive) { "stopped answering" } else { "exited" }
            Write-LauncherLog "Builder $why; restarting in ${wait}s (restart $($apiFailures + 1))"
            if (-not $Quiet) { Write-Host "  The builder $why - restarting in $wait seconds." -ForegroundColor Yellow }
            Stop-ApiProcesses
            Start-Sleep -Seconds $wait
            $started.api = Start-Api
            $apiFailures++
            $apiMisses = 0
            $healthySince = Get-Date
            if (Wait-For "http://127.0.0.1:4000/api/update/check" 90 "The builder") {
                Write-LauncherLog "Builder back up"
            } else {
                Write-LauncherLog "Builder did not come back within 90s; will try again"
            }
            continue
        }

        # Ten healthy minutes clears the slate, so the next hiccup restarts fast.
        if ($apiFailures -gt 0 -and ((Get-Date) - $healthySince).TotalMinutes -ge 10) {
            $apiFailures = 0
            Write-LauncherLog "Builder stable for 10 minutes"
        }

        # Jarvis: bring him back if he stops answering for a minute.
        # Not while update-jarvis.ps1 is rebuilding him (a flag older than 25 minutes is a crashed update).
        $jarvisUpdating = $false
        $jarvisFlag = Join-Path $dataDir "jarvis-updating.flag"
        if (Test-Path $jarvisFlag) { $jarvisUpdating = ((Get-Date) - (Get-Item $jarvisFlag).LastWriteTime).TotalMinutes -lt 25 }
        if ($hasJarvis -and -not $jarvisUpdating) {
            if (Test-Endpoint $jarvisUrl 5) {
                $jarvisMisses = 0
            } else {
                $jarvisMisses++
                if ($jarvisMisses -ge 4) {
                    Write-LauncherLog "Jarvis not answering; restarting him"
                    Stop-JarvisProcesses
                    $started.jarvis = Start-Jarvis
                    $jarvisMisses = 0
                    if (Wait-For $jarvisUrl 90 "Jarvis") { Write-LauncherLog "Jarvis back up" }
                    $started.jarvisAgent = Start-JarvisAgent
                }
            }
        }

        # The model server: builds, repairs and research all need it.
        # Not while game mode is on: then it is off on purpose.
        if ($ollamaExe -and -not (Test-GameMode)) {
            if (Test-Endpoint "http://localhost:11434/api/tags" 5) {
                $ollamaMisses = 0
            } else {
                $ollamaMisses++
                if ($ollamaMisses -ge 2) {
                    Write-LauncherLog "Model server not answering; starting it"
                    $process = Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden -PassThru
                    $started.ollama = $process.Id
                    $ollamaMisses = 0
                    if (Wait-For "http://localhost:11434/api/tags" 60 "The model server") { Write-LauncherLog "Model server back up" }
                }
            }
        }
    }
} finally {
    Write-LauncherLog "Launcher stopping everything it started"
    if (-not $Daemon) {
        if (-not $Quiet) { Write-Host "  Stopping..." -ForegroundColor Gray }
        foreach ($id in @($started.tunnel, $started.api, $started.ollama, $started.jarvis, $started.jarvisAgent)) {
            if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
        }
        # The builder runs under a cmd wrapper, so stop the node process it spawned.
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*src/server/server.ts*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        if ($hasJarvis) { Stop-JarvisProcesses }
        Remove-Item $urlFile -ErrorAction SilentlyContinue
        Remove-Item $pidFile -ErrorAction SilentlyContinue
        if (-not $Quiet) { Write-Host "  Stopped." -ForegroundColor Gray }
    }
}
