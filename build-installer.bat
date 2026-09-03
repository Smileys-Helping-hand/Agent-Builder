@echo off
setlocal

echo ========================================
echo Agent Builder - Quick Package Builder
echo ========================================
echo.

REM Check if Rust is installed
where cargo >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Rust is not installed!
    echo.
    echo Please install Rust first:
    echo   1. Run: winget install Rustlang.Rustup
    echo   2. Or visit: https://rustup.rs/
    echo   3. Restart your terminal after installation
    echo   4. Run this script again
    echo.
    pause
    exit /b 1
)

echo Step 1/4: Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo Failed to install root dependencies
    pause
    exit /b 1
)

call npm --prefix dashboard install
if %ERRORLEVEL% NEQ 0 (
    echo Failed to install dashboard dependencies
    pause
    exit /b 1
)

echo.
echo Step 2/4: Building server...
call npm run build:server
if %ERRORLEVEL% NEQ 0 (
    echo Failed to build server
    pause
    exit /b 1
)

echo.
echo Step 3/4: Building dashboard...
call npm run build:dashboard
if %ERRORLEVEL% NEQ 0 (
    echo Failed to build dashboard
    pause
    exit /b 1
)

echo.
echo Step 4/4: Building Windows installer...
echo This may take 10-15 minutes...
call npm run tauri:build
if %ERRORLEVEL% NEQ 0 (
    echo Failed to build installer
    pause
    exit /b 1
)

echo.
echo ========================================
echo BUILD SUCCESSFUL!
echo ========================================
echo.
echo Your installer is located at:
echo src-tauri\target\release\bundle\msi\Agent Builder_1.0.0_x64_en-US.msi
echo.
echo Opening folder...
start explorer.exe "src-tauri\target\release\bundle\msi"
echo.
pause
