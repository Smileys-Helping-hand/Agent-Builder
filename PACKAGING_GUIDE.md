# Agent Builder - Packaging Guide

This guide will help you package Agent Builder as a Windows installer that can be installed like a normal application.

## Prerequisites

### 1. Install Rust (Required for Tauri Desktop App)

Download and install Rust from: https://rustup.rs/

Or run this command in PowerShell:
```powershell
winget install Rustlang.Rustup
```

After installation, restart your terminal and verify:
```powershell
cargo --version
rustc --version
```

### 2. Install Visual Studio C++ Build Tools

Tauri requires Windows development tools. Download and install:
https://visualstudio.microsoft.com/downloads/

Or use winget:
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --silent --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

### 3. Install WebView2 (Usually pre-installed on Windows 10/11)

If needed, download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### 4. Install Node.js dependencies

```powershell
# Install root dependencies
npm install

# Install dashboard dependencies
npm --prefix dashboard install

# Install Tauri CLI globally (optional but recommended)
npm install -g @tauri-apps/cli
```

## Building the Application

### Option 1: Using npm scripts (Recommended)

```powershell
# Build everything (server + dashboard + Tauri app)
npm run tauri build
```

### Option 2: Step-by-step build

```powershell
# 1. Build the backend server
npm run build:server

# 2. Build the Next.js dashboard
npm run build:dashboard

# 3. Build the Tauri desktop app
cd src-tauri
cargo tauri build
cd ..
```

## Finding Your Installer

After a successful build, you'll find the installer at:

**Windows Installer (MSI):**
```
src-tauri/target/release/bundle/msi/Agent Builder_1.0.0_x64_en-US.msi
```

**Windows Executable:**
```
src-tauri/target/release/Agent Builder.exe
```

## Installing the Application

1. Navigate to the `src-tauri/target/release/bundle/msi/` folder
2. Double-click the `.msi` file
3. Follow the installation wizard
4. The app will be installed to `C:\Program Files\Agent Builder\`
5. A desktop shortcut will be created

## Running the Installed Application

After installation, you can run Agent Builder from:
- Start Menu: Search for "Agent Builder"
- Desktop shortcut
- `C:\Program Files\Agent Builder\Agent Builder.exe`

## Development vs Production

### Development Mode
```powershell
# Run in development mode (hot reload enabled)
npm run tauri dev
```

### Production Build
```powershell
# Create production installer
npm run tauri build
```

## Troubleshooting

### Build fails with Rust errors
- Make sure Rust is properly installed: `cargo --version`
- Update Rust: `rustup update`
- Restart your terminal after installing Rust

### WebView2 errors
- Install WebView2 runtime from Microsoft's website
- Usually pre-installed on Windows 10/11

### Node.js version issues
- Ensure you're using Node.js 20+ : `node --version`
- Update if needed from: https://nodejs.org/

### Database/Redis not found errors
- The packaged app still needs external services (PostgreSQL, Redis)
- Make sure these services are running before starting the app
- Configure connection strings in the app's settings

## Distribution

Once built, you can distribute the `.msi` installer to users. They will need:
1. Windows 10/11
2. WebView2 runtime (usually pre-installed)
3. PostgreSQL database (if using database features)
4. Redis (if using queue features)

For a completely standalone app without external dependencies, consider:
- Using SQLite instead of PostgreSQL
- Using in-memory queues instead of Redis
- Bundling these services with the installer

## File Size Optimization

The initial build will be large (~200MB+). To reduce size:
- Remove unused dependencies
- Use production builds only
- Enable code splitting in Next.js
- Configure Cargo to strip debug symbols (already configured in release mode)

## Code Signing (Optional)

For professional distribution, consider code signing your installer:
1. Obtain a code signing certificate
2. Configure in `src-tauri/tauri.conf.json` under `bundle.windows.certificateThumbprint`
3. Users won't see "Unknown Publisher" warnings

## Auto-Updates (Optional)

Tauri supports auto-updates. Configure in `tauri.conf.json`:
```json
{
  "updater": {
    "active": true,
    "endpoints": ["https://your-server.com/updates/{{target}}/{{current_version}}"]
  }
}
```
