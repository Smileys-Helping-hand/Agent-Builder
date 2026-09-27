@echo off
rem Open the Agent Builder app. If the builder is already running, just open it;
rem otherwise start everything (this window stays open while it runs) and open it.
title Agent Builder
powershell.exe -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:4000/api/update/check -UseBasicParsing -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" "http://127.0.0.1:4000/"
  exit /b 0
)
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\launcher\start.ps1" -Open %*
