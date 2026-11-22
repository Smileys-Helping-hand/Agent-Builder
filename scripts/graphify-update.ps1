# Rebuild Agent Builder's code graph with Graphify, locally, with no AI model.
#
#   powershell -ExecutionPolicy Bypass -File scripts\graphify-update.ps1 [-Force]
#
# - Code only: `graphify update` parses the code with tree-sitter on this PC. No model, no network.
# - GRAPHIFY_BACKEND=none is set so nothing can ever fall back to an AI backend, even though .env
#   holds API keys (`graphify extract` would auto-detect them; this script never uses it).
# - GRAPHIFY_QUERY_LOG_DISABLE=1: queries are not logged to ~/.cache.
# - What is indexed: the repository, minus .gitignore and .graphifyignore (builds, data, generated
#   app output, games, site templates, the graph itself). The output, graphify-out/, is git-ignored.
# - The source code stays the authority: the graph is a map for finding things, rebuilt after changes.
param([switch]$Force)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$graphify = if ($env:GRAPHIFY_EXE) { $env:GRAPHIFY_EXE } else { "E:\Tools\graphify-venv\Scripts\graphify.exe" }
if (-not (Test-Path $graphify)) { throw "Graphify is not installed at $graphify (python -m venv E:\Tools\graphify-venv; E:\Tools\graphify-venv\Scripts\pip install graphifyy)." }

$env:GRAPHIFY_BACKEND = "none"
$env:GRAPHIFY_QUERY_LOG_DISABLE = "1"

Push-Location $repo
try {
    $started = Get-Date
    $arguments = @("update", ".")
    if ($Force) { $arguments += "--force" }
    & $graphify @arguments
    if ($LASTEXITCODE -ne 0) { throw "graphify update failed ($LASTEXITCODE)" }
    $state = @{ builtAt = (Get-Date).ToString("o"); commit = (git rev-parse HEAD).Trim(); seconds = [math]::Round(((Get-Date) - $started).TotalSeconds) }
    $state | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $repo "graphify-out\built-at.json")
    Write-Host ("Graph rebuilt in {0} s at commit {1}" -f $state.seconds, $state.commit.Substring(0, 8))
} finally {
    Pop-Location
}
