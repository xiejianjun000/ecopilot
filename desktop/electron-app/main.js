/**
 * EcoPilot Desktop — 原生 Electron 桌面应用
 *
 * 特性:
 *   - 内嵌 BrowserWindow（非浏览器启动）
 *   - 自动启动 Python 后端 + Next.js 前端
 *   - 自动检查更新 (electron-updater)
 *   - 系统托盘
 *   - 安全退出清理子进程
 *
 * 开发: node main.js --dev
 * 构建: npx electron-builder
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── 仅在打包后加载 autoUpdater（开发模式跳过） ──
let autoUpdater = null;
if (app.isPackaged) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (_) { /* 开发模式无此模块 */ }
}

// ── 配置 ──
const BACKEND_PORT = 8002;
const FRONTEND_PORT = 3000;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const HEALTH_ENDPOINT = '/api/chat/health';
const MAX_RETRIES = 60;
const RETRY_MS = 1000;

const isDev = process.argv.includes('--dev');
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const FRONTEND_DIR = path.join(ROOT, 'frontend');

let mainWindow = null;
let tray = null;
let backendProcess = null;
let frontendProcess = null;

const CLR = { green: '\x1b[32m', blue: '\x1b[34m', cyan: '\x1b[36m', reset: '\x1b[0m' };

// ═══════════════════════════════════════════════
// 端口检查 / 清理
// ═══════════════════════════════════════════════

function isPortFree(port) {
  try {
    const proc = spawnSync(os.platform() === 'win32' ? 'netstat' : 'lsof',
      os.platform() === 'win32' ? ['-ano'] : ['-ti', `:${port}`],
      { encoding: 'utf-8' }
    );
    return proc.status !== 0 || !proc.stdout.trim();
  } catch (_) { return true; }
}

function killPort(port) {
  try {
    if (os.platform() === 'win32') {
      execSync(`netstat -ano | findstr :${port}`, { stdio: 'pipe' });
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      for (const line of out.trim().split('\n')) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== '0') execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      }
    } else {
      const pid = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
      if (pid) execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    }
  } catch (_) { /* 端口空闲 */ }
}

// ═══════════════════════════════════════════════
// 后端启动
// ═══════════════════════════════════════════════

function startBackend() {
  return new Promise((resolve, reject) => {
    const pythonCmd = os.platform() === 'win32' ? 'python' : 'python3';
    const serverFile = path.join(SERVER_DIR, 'chat_api.py');

    if (!fs.existsSync(serverFile)) {
      console.log(`${CLR.cyan}[backend]${CLR.reset} 未找到 chat_api.py，跳过后端启动`);
      resolve(false);
      return;
    }

    if (!isPortFree(BACKEND_PORT)) {
      console.log(`${CLR.cyan}[backend]${CLR.reset} 端口 ${BACKEND_PORT} 已被占用，跳过启动`);
      resolve(true);
      return;
    }

    console.log(`${CLR.cyan}[backend]${CLR.reset} 启动后端服务...`);
    backendProcess = spawn(pythonCmd, [serverFile, '--port', String(BACKEND_PORT)], {
      cwd: SERVER_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    backendProcess.stdout.on('data', d => process.stdout.write(`${CLR.cyan}[backend]${CLR.reset} ${d}`));
    backendProcess.stderr.on('data', d => process.stderr.write(`${CLR.cyan}[backend]${CLR.reset} ${d}`));
    backendProcess.on('error', () => reject(new Error('后端启动失败')));
    backendProcess.on('exit', code => {
      if (code !== 0 && code !== null) {
        console.log(`${CLR.cyan}[backend]${CLR.reset} 进程退出 code=${code}`);
      }
    });

    // 等待后端就绪
    let retries = 0;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}${HEALTH_ENDPOINT}`);
        if (res.ok) {
          clearInterval(interval);
          console.log(`${CLR.green}[backend]${CLR.reset} 后端就绪 ✅`);
          resolve(true);
        }
      } catch (_) { /* 还没起来 */ }
      if (++retries >= MAX_RETRIES) {
        clearInterval(interval);
        reject(new Error('后端启动超时'));
      }
    }, RETRY_MS);
  });
}

// ═══════════════════════════════════════════════
// 前端启动
// ═══════════════════════════════════════════════

function startFrontend() {
  return new Promise((resolve, reject) => {
    const isBuilt = fs.existsSync(path.join(FRONTEND_DIR, '.next', 'BUILD_ID'));

    if (!isBuilt && !isDev) {
      console.log(`${CLR.blue}[frontend]${CLR.reset} 前端未构建，尝试构建...`);
      try {
        execSync('pnpm build', { cwd: FRONTEND_DIR, stdio: 'inherit' });
      } catch (e) {
        reject(new Error('前端构建失败: ' + e.message));
        return;
      }
    }

    if (!isPortFree(FRONTEND_PORT)) {
      console.log(`${CLR.blue}[frontend]${CLR.reset} 端口 ${FRONTEND_PORT} 已被占用，跳过启动`);
      resolve(true);
      return;
    }

    const cmd = isDev ? 'pnpm' : 'pnpm';
    const args = isDev ? ['dev', '--port', String(FRONTEND_PORT)] : ['start', '--port', String(FRONTEND_PORT)];

    console.log(`${CLR.blue}[frontend]${CLR.reset} 启动前端服务 (${isDev ? 'dev' : 'prod'})...`);
    frontendProcess = spawn(cmd, args, {
      cwd: FRONTEND_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(FRONTEND_PORT) },
    });

    frontendProcess.stdout.on('data', d => process.stdout.write(`${CLR.blue}[frontend]${CLR.reset} ${d}`));
    frontendProcess.stderr.on('data', d => process.stderr.write(`${CLR.blue}[frontend]${CLR.reset} ${d}`));
    frontendProcess.on('error', () => reject(new Error('前端启动失败')));

    // 等待前端就绪
    let retries = 0;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(FRONTEND_URL);
        if (res.ok) {
          clearInterval(interval);
          console.log(`${CLR.green}[frontend]${CLR.reset} 前端就绪 ✅`);
          resolve(true);
        }
      } catch (_) { /* 还没起来 */ }
      if (++retries >= MAX_RETRIES) {
        clearInterval(interval);
        reject(new Error('前端启动超时'));
      }
    }, RETRY_MS);
  });
}

// ═══════════════════════════════════════════════
// Electron 窗口
// ═══════════════════════════════════════════════

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'EcoPilot',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadURL(FRONTEND_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 外部链接在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 创建托盘
  createTray();
}

// ═══════════════════════════════════════════════
// 系统托盘
// ═══════════════════════════════════════════════

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;
  try { trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }); }
  catch (_) { trayIcon = nativeImage.createEmpty(); }

  tray = new Tray(trayIcon);
  tray.setToolTip('EcoPilot');

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: '检查更新', click: () => checkForUpdates() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

// ═══════════════════════════════════════════════
// 自动更新
// ═══════════════════════════════════════════════

function checkForUpdates() {
  if (!autoUpdater) {
    console.log('[updater] 开发模式，跳过更新检查');
    return;
  }
  autoUpdater.checkForUpdatesAndNotify();
}

function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.on('checking-for-update', () => console.log('[updater] 检查更新...'));
  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] 发现新版本 ${info.version}`);
    mainWindow?.webContents.executeJavaScript(
      `new Notification('EcoPilot 更新', { body: '发现新版本 ${info.version}，正在后台下载...' })`
    );
  });
  autoUpdater.on('update-not-available', () => console.log('[updater] 已是最新版本'));
  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] 下载进度: ${p.percent.toFixed(1)}%`);
  });
  autoUpdater.on('update-downloaded', () => {
    console.log('[updater] 更新已下载，准备安装');
    mainWindow?.webContents.executeJavaScript(
      `new Notification('EcoPilot 更新', { body: '更新已下载，重启后生效' })`
    );
    // 下次启动时安装
    autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (e) => console.log('[updater] 错误:', e.message));
}

// ═══════════════════════════════════════════════
// IPC 处理
// ═══════════════════════════════════════════════

ipcMain.handle('backend:status', async () => {
  try {
    const res = await fetch(`${BACKEND_URL}${HEALTH_ENDPOINT}`);
    const data = await res.json();
    return { running: true, health: data };
  } catch { return { running: false }; }
});

ipcMain.handle('shell:openExternal', async (_, url) => {
  shell.openExternal(url);
});

ipcMain.handle('app:check-update', async () => {
  checkForUpdates();
  return { checking: true };
});

ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

// ═══════════════════════════════════════════════
// 应用生命周期
// ═══════════════════════════════════════════════

app.whenReady().then(async () => {
  console.log(`\n  ${CLR.green}EcoPilot Desktop${CLR.reset}`);
  console.log(`  模式: ${isDev ? '开发' : '生产'}`);
  console.log(`  版本: ${app.getVersion()}\n`);

  // 启动后端
  try {
    await startBackend();
  } catch (e) {
    console.error(`  ${CLR.cyan}[backend]${CLR.reset} 启动失败:`, e.message);
  }

  // 启动前端
  try {
    await startFrontend();
  } catch (e) {
    console.error(`  ${CLR.blue}[frontend]${CLR.reset} 启动失败:`, e.message);
  }

  // 创建窗口
  createWindow();

  // 设置自动更新
  setupAutoUpdater();
  if (app.isPackaged) {
    // 首次启动延迟检查更新
    setTimeout(() => checkForUpdates(), 30000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (os.platform() !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // 清理子进程
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    setTimeout(() => { try { backendProcess.kill('SIGKILL'); } catch (_) {} }, 3000);
  }
  if (frontendProcess) {
    frontendProcess.kill('SIGTERM');
    setTimeout(() => { try { frontendProcess.kill('SIGKILL'); } catch (_) {} }, 3000);
  }
});

console.log(`\n  ${CLR.green}EcoPilot Desktop${CLR.reset}`);
console.log(`  版本 ${app.getVersion()} — 企业生态环境合规AI管家\n`);
