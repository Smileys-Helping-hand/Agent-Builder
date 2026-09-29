# Agent Builder - older desktop launcher, kept so existing shortcuts still work.
#
# It used to run the legacy dashboard on port 3000 (which Jarvis and Second-Brain
# also default to, so the window could open the wrong app) from a hardcoded
# E:\Projects path. The app now lives on the builder itself at port 4000; this
# hands over to the launcher that starts the model, the builder and the tunnel,
# and opens it.
$repo = Split-Path -Parent $PSScriptRoot
& (Join-Path $repo "scripts\launcher\start.ps1") -Open @args
