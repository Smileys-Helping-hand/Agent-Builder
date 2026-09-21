@echo off
title Stop Agent Builder
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\launcher\stop.ps1" %*
