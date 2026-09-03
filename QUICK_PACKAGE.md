# Quick Start: Package Agent Builder

Follow these steps to create an installable Windows application:

## Step 1: Install Rust

Open PowerShell as Administrator and run:
```powershell
winget install Rustlang.Rustup
```

Or download from: https://rustup.rs/

**Important:** Restart your terminal after installation!

## Step 2: Install Visual Studio Build Tools

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

During installation, make sure to select "Desktop development with C++".

## Step 3: Install Dependencies

```powershell
# In the Agent-Builder directory
npm install
npm --prefix dashboard install
```

## Step 4: Build the Installer

```powershell
npm run package
```

This will:
- Build the backend server
- Build the Next.js dashboard
- Create a Windows installer (.msi file)

## Step 5: Find Your Installer

The installer will be located at:
```
src-tauri\target\release\bundle\msi\Agent Builder_1.0.0_x64_en-US.msi
```

## Step 6: Install & Run

Double-click the `.msi` file to install Agent Builder like any other Windows application!

---

## Development Mode

To run the app in development mode with hot-reload:
```powershell
npm run tauri:dev
```

## Troubleshooting

### "cargo: command not found"
- Rust is not installed or terminal wasn't restarted
- Install Rust and restart your terminal

### Build errors mentioning "link.exe" or "cl.exe"
- Visual Studio Build Tools not installed
- Install with C++ development workload

### Out of memory errors
- Close other applications
- Try building on a machine with more RAM

### Need help?
See [PACKAGING_GUIDE.md](PACKAGING_GUIDE.md) for detailed instructions.
