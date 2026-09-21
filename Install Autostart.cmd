@echo off
title Agent Builder setup
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\launcherutostart.ps1" %*
