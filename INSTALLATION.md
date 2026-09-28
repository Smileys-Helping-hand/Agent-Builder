# 📦 Creating an Installable Application

This guide shows you how to package Agent Builder into a Windows installer (.msi) that can be installed like any normal application.

## Automated Setup (Recommended)

Run the automated setup script:

```powershell
# Make sure you're in the Agent-Builder directory
.\setup-and-build.ps1
```

This script will:
- ✅ Check if Rust is installed (and install it if missing)
- ✅ Check for Visual Studio Build Tools
- ✅ Install all npm dependencies
- ✅ Build the application
- ✅ Create the Windows installer

**Note:** If Rust is installed by the script, you'll need to restart your terminal and run the script again.

## Manual Setup

### Prerequisites

1. **Install Rust**
   ```powershell
   winget install Rustlang.Rustup
   ```
   Or download from: https://rustup.rs/
   
   **⚠️ Important: Restart your terminal after installation!**

2. **Install Visual Studio Build Tools**
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools
   ```
   Make sure to install the "Desktop development with C++" workload.

3. **Install Dependencies**
   ```powershell
   npm install
   npm --prefix dashboard install
   ```

### Build the Installer

```powershell
npm run package
```

This command will:
1. Build the backend server
2. Build the Next.js dashboard frontend  
3. Compile the Tauri desktop application
4. Create a Windows installer (.msi file)

### Find Your Installer

After a successful build (takes 5-15 minutes), your installer will be at:

```
src-tauri\target\release\bundle\msi\Agent Builder_1.0.0_x64_en-US.msi
```

## Installing the Application

1. Navigate to the `.msi` file location
2. Double-click to run the installer
3. Follow the installation wizard
4. Agent Builder will be installed to: `C:\Program Files\Agent Builder\`
5. A Start Menu shortcut will be created

## Running the Installed App

After installation, launch Agent Builder from:
- **Start Menu**: Search for "Agent Builder"
- **Desktop shortcut** (if created during installation)
- **Direct path**: `C:\Program Files\Agent Builder\Agent Builder.exe`

## Development vs Production

### Development Mode
```powershell
npm run tauri:dev
```
- Hot reload enabled
- Opens dev tools
- Faster startup
- Uses local files

### Production Build
```powershell
npm run package
```
- Creates installer
- Optimized for performance
- Standalone executable
- Can distribute to users

## File Sizes

- **Development build**: ~500MB-1GB (includes debug symbols)
- **Release build**: ~200-300MB
- **Installer (.msi)**: ~150-250MB

## Distribution

Once you have the `.msi` file, you can:
- ✅ Share it with other users
- ✅ Upload to a file hosting service
- ✅ Distribute via company network
- ✅ Create a download page

### Requirements for End Users

Users who install your app will need:
- Windows 10 or Windows 11
- WebView2 runtime (usually pre-installed on Windows 10/11)
- No other dependencies needed!

**Optional services** (if using full features):
- PostgreSQL (for database features)
- Redis (for queue features)
- OpenAI API key (for AI features)

## Troubleshooting

### Build Errors

**"cargo: command not found"**
- Rust is not installed or terminal wasn't restarted
- Solution: Install Rust and restart your terminal

**"link.exe not found" or C++ compilation errors**
- Visual Studio Build Tools not installed
- Solution: Install with "Desktop development with C++" workload

**Out of memory errors**
- Not enough RAM during build
- Solution: Close other applications, restart, try again

**Dashboard build fails**
- Next.js build errors
- Solution: `cd dashboard && npm install && npm run build`

### Installation Errors

**"Unknown Publisher" warning**
- The app is not code-signed
- Solution: Click "More info" → "Install anyway" (safe for personal use)
- For distribution: Get a code signing certificate

**Installation blocked by antivirus**
- False positive due to unsigned binary
- Solution: Add exception or sign the application

## Advanced Options

### Custom Installer Name

Edit `src-tauri/tauri.conf.json`:
```json
{
  "productName": "Your Custom Name",
  "version": "1.0.0"
}
```

### Add Application Icon

1. Place icon files in `src-tauri/icons/`
2. Update `tauri.conf.json` → `bundle.icon`
3. Rebuild

### Code Signing

1. Obtain a code signing certificate
2. Configure in `tauri.conf.json`:
   ```json
   {
     "bundle": {
       "windows": {
         "certificateThumbprint": "YOUR_CERT_THUMBPRINT"
       }
     }
   }
   ```

### Auto-Updates

Configure in `tauri.conf.json`:
```json
{
  "updater": {
    "active": true,
    "endpoints": ["https://your-server.com/updates"]
  }
}
```

## Need Help?

- See [PACKAGING_GUIDE.md](PACKAGING_GUIDE.md) for detailed documentation
- See [QUICK_PACKAGE.md](QUICK_PACKAGE.md) for a quick reference
- Check Tauri documentation: https://tauri.app/v1/guides/building/
