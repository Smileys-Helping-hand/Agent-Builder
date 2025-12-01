const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

let backendProcess = null;
let win = null;
let crashRestarts = 0;
let dashboardLoaded = false;

const ICON_PATH = path.join(__dirname, 'icon.png');
const ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9pX2NwAAAABJRU5ErkJggg==';

const ensureIcon = () => {
  if (fs.existsSync(ICON_PATH)) return ICON_PATH;
  fs.writeFileSync(ICON_PATH, Buffer.from(ICON_BASE64, 'base64'));
  return ICON_PATH;
};

const resolveBackendEntry = () => {
  if (!app.isPackaged) {
    return path.join(__dirname, '..', 'dist', 'index.js');
  }
  return path.join(process.resourcesPath, 'app.asar', 'dist', 'index.js');
};

const waitForDashboard = () => {
  if (!win || dashboardLoaded) return;
  const req = http.get('http://localhost:3000', (res) => {
    res.resume();
    if (!dashboardLoaded) {
      dashboardLoaded = true;
      win.loadURL('http://localhost:3000');
    }
  });
  req.on('error', () => setTimeout(waitForDashboard, 1500));
};

const startBackend = () => {
  console.log('🔧 Starting AutoDev Forge backend...');
  const entry = resolveBackendEntry();

  backendProcess = spawn(process.execPath, [entry], {
    cwd: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
    env: { ...process.env, FORCE_COLOR: '1', NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '1' },
    shell: false,
    detached: false,
  });

  backendProcess.stdout.on('data', (data) => {
    const msg = data.toString();
    console.log('[backend]', msg.trim());
    if (msg.includes('Agent Builder API running')) {
      dashboardLoaded = true;
      win.loadURL('http://localhost:3000');
    }
  });

  backendProcess.stderr.on('data', (data) => console.error('[backend err]', data.toString()));

  backendProcess.on('exit', (code) => {
    console.log('❌ Backend exited:', code);
    if (code !== 0 && crashRestarts < 3) {
      crashRestarts += 1;
      setTimeout(startBackend, 1000 * crashRestarts);
    }
  });

  waitForDashboard();
};

const createWindow = () => {
  win = new BrowserWindow({
    width: 1300,
    height: 900,
    backgroundColor: '#000000',
    icon: ensureIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
};

app.whenReady().then(() => {
  createWindow();
  startBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    console.log('🛑 Closing backend...');
    if (backendProcess) backendProcess.kill();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('ping', () => 'pong');
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && url.startsWith('http')) {
    void shell.openExternal(url);
  }
});
ipcMain.handle('app-version', () => app.getVersion());
