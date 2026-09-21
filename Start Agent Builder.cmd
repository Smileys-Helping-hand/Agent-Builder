@echo off
title Agent Builder
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\launcher\start.ps1" %*
