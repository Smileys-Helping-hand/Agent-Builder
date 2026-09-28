# Agent Builder - Automated Setup and Build Script
# This script will install all prerequisites and build the Windows installer

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Agent Builder - Package Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "⚠️  This script should be run as Administrator for best results" -ForegroundColor Yellow
    Write-Host "   Some installations may require elevation" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne 'y') {
        exit
    }
}

# Step 1: Check Node.js
Write-Host "Step 1: Checking Node.js..." -ForegroundColor Green
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js is installed: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found!" -ForegroundColor Red
    Write-Host "  Please install Node.js 20+ from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Step 2: Check Rust
Write-Host ""
Write-Host "Step 2: Checking Rust..." -ForegroundColor Green
try {
    $cargoVersion = cargo --version
    Write-Host "✓ Rust is installed: $cargoVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Rust not found!" -ForegroundColor Yellow
    Write-Host "  Installing Rust..." -ForegroundColor Yellow
    
    # Try winget first
    try {
        winget install Rustlang.Rustup -e --silent
        Write-Host "✓ Rust installed via winget" -ForegroundColor Green
        Write-Host ""
        Write-Host "⚠️  IMPORTANT: You must restart your terminal after Rust installation!" -ForegroundColor Yellow
        Write-Host "   Close this window, open a new PowerShell, and run this script again." -ForegroundColor Yellow
        exit 0
    } catch {
        Write-Host "  Winget failed. Please install Rust manually from https://rustup.rs/" -ForegroundColor Red
        exit 1
    }
}

# Step 3: Check Visual Studio Build Tools
Write-Host ""
Write-Host "Step 3: Checking Visual Studio Build Tools..." -ForegroundColor Green
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsPath) {
        Write-Host "✓ Visual Studio Build Tools found" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Visual Studio installed but C++ tools may be missing" -ForegroundColor Yellow
        Write-Host "   Build may fail. Install Desktop Development with C++ workload if needed." -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  Visual Studio Build Tools not detected" -ForegroundColor Yellow
    Write-Host "   Attempting to install..." -ForegroundColor Yellow
    try {
        winget install Microsoft.VisualStudio.2022.BuildTools --silent --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
        Write-Host "✓ Build Tools installation started (this may take several minutes)" -ForegroundColor Green
    } catch {
        Write-Host "  Please install manually: https://visualstudio.microsoft.com/downloads/" -ForegroundColor Yellow
    }
}

# Step 4: Install npm dependencies
Write-Host ""
Write-Host "Step 4: Installing npm dependencies..." -ForegroundColor Green
Write-Host "  This may take a few minutes..." -ForegroundColor Gray

try {
    Write-Host "  - Installing root dependencies..." -ForegroundColor Gray
    npm install 2>&1 | Out-Null
    
    Write-Host "  - Installing dashboard dependencies..." -ForegroundColor Gray
    npm --prefix dashboard install 2>&1 | Out-Null
    
    Write-Host "✓ All dependencies installed" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to install dependencies" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
    exit 1
}

# Step 5: Build the application
Write-Host ""
Write-Host "Step 5: Building the application..." -ForegroundColor Green
Write-Host "  This will take several minutes..." -ForegroundColor Gray
Write-Host ""

try {
    # Build with progress output
    npm run package
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "✓ Build Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Your installer is located at:" -ForegroundColor Green
    Write-Host "  src-tauri\target\release\bundle\msi\Agent Builder_1.0.0_x64_en-US.msi" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To install:" -ForegroundColor Green
    Write-Host "  1. Navigate to the above location" -ForegroundColor White
    Write-Host "  2. Double-click the .msi file" -ForegroundColor White
    Write-Host "  3. Follow the installation wizard" -ForegroundColor White
    Write-Host ""
    
    # Try to open the folder
    $bundlePath = "src-tauri\target\release\bundle\msi"
    if (Test-Path $bundlePath) {
        Write-Host "Opening installer location..." -ForegroundColor Gray
        Start-Process explorer.exe -ArgumentList $bundlePath
    }
    
} catch {
    Write-Host ""
    Write-Host "✗ Build failed!" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "  1. Rust not properly installed - restart terminal after installing Rust" -ForegroundColor Gray
    Write-Host "  2. Visual Studio Build Tools missing - install Desktop Development with C++" -ForegroundColor Gray
    Write-Host "  3. Out of memory - close other applications and try again" -ForegroundColor Gray
    Write-Host ""
    exit 1
}
