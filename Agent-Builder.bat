@echo off
rem Older desktop shortcut. It used to start the legacy dashboard on port 3000,
rem which Jarvis and Second-Brain also use, and only worked from E:\Projects.
rem It now does exactly what "Open Agent Builder" does: opens the app the builder
rem serves on http://127.0.0.1:4000, starting the builder first if needed.
call "%~dp0Open Agent Builder.cmd" %*
