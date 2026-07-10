/**
 * EcoPilot Web Launcher — 跨平台一键启动
 *
 * Auto-starts the Python backend, Next.js frontend, then opens
 * the app in the default browser.
 *
 * Usage:
 *   node main.js              # 生产模式（需先 build 前端）
 *   node main.js --dev        # 开发模式（HMR 热更新）
 *   node main.js --browser    # 指定浏览器: chrome | edge | firefox | default
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Config ─────────────────────────────────────────────────────────────────
const BACKEND_PORT = 8002;
const FRONTEND_PORT = 3000;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const HEALTH_ENDPOINT = '/api/chat/health';
const MAX_RETRIES = 60;
const RETRY_MS = 1000;

const isDev = process.argv.includes('--dev');
const browser = (() => {
  if (process.argv.includes('--browser')) {
    const idx = process.argv.indexOf('--browser');
    return process.argv[idx + 1] || 'default';
  }
  return 'default';
})();

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const FRONTEND_DIR = path.join(ROOT, 'frontend');

const CLR = { green: '\x1b[32m', blue: '\x1b[34m', cyan: '\x1b[36m', reset: '\x1b[0m' };

// ── Port check ─────────────────────────────────────────────────────────────
function isPortFree(port) {
  try {
    const proc = require('child_process').spawnSync(
      os.platform() === 'win32' ? 'netstat' : 'lsof',
      os.platform() === 'win32'
        ? ['-ano']
        : ['-ti', `:${port}`],
      { encoding: 'utf-8' }
    );
    return proc.status !== 0 || !proc.stdout.trim();
  } catch (_) {
    return true;
  }
}

function killPort(port) {
  try {
    if (os.platform() === 'win32') {
      execSync(`FOR /F "tokens=5" %P IN ('netstat -ano ^| findstr :${port}') DO taskkill /F /PID %P 2>nul`, { stdio: 'ignore' });
    } else {
      execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
    }
  } catch (_) {
    // Port was already free
  }
}

// ── Child processes ────────────────────────────────────────────────────────
const children = [];

function spawnProc(label, cmd, args, opts) {
  const color = label === 'backend' ? CLR.green : label === 'frontend' ? CLR.blue : CLR.cyan;
  console.log(`${color}[${label}]${CLR.reset} ${cmd} ${args.join(' ')}`);

  const isWin = os.platform() === 'win32';
  const child = spawn(cmd, args, {
    ...opts,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin || opts.shell,
  });

  child.stdout.on('data', (d) => {
    d.toString().trim().split('\n').forEach((l) => { if (l) console.log(`${color}[${label}]${CLR.reset} ${l}`); });
  });
  child.stderr.on('data', (d) => {
    d.toString().trim().split('\n').forEach((l) => { if (l) console.error(`${color}[${label}]${CLR.reset} ${l}`); });
  });
  child.on('exit', (code) => { if (code !== 0 && code !== null) console.log(`${color}[${label}]${CLR.reset} exited (${code})`); });

  children.push(child);
  return child;
}

// ── Poll URL ───────────────────────────────────────────────────────────────
function pollUrl(url, label) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const check = () => {
      n++;
      const req = http.get(url, (res) => { res.resume(); if (res.statusCode < 400) return resolve(); retry(); });
      req.on('error', () => retry());
      req.setTimeout(2000, () => { req.destroy(); retry(); });
      function retry() {
        if (n >= MAX_RETRIES) reject(new Error(`${label} not ready after ${MAX_RETRIES}s`));
        else setTimeout(check, RETRY_MS);
      }
    };
    check();
  });
}

// ── Start services ─────────────────────────────────────────────────────────
async function startBackend() {
  const isWin = os.platform() === 'win32';
  const pythonPath = isWin
    ? path.join(SERVER_DIR, '.venv', 'Scripts', 'python.exe')
    : path.join(SERVER_DIR, '.venv', 'bin', 'python3');

  if (!fs.existsSync(pythonPath)) {
    console.log(`[EcoPilot] Python venv 不存在，正在创建...`);
    const pythonBin = isWin ? 'python' : 'python3';
    execSync(`${pythonBin} -m venv ${path.join(SERVER_DIR, '.venv')}`, { cwd: SERVER_DIR, stdio: 'inherit' });
    const pipExe = isWin ? path.join(SERVER_DIR, '.venv', 'Scripts', 'pip') : path.join(SERVER_DIR, '.venv', 'bin', 'pip');
    execSync(`${pipExe} install -r ${path.join(SERVER_DIR, 'requirements.txt')}`, { cwd: SERVER_DIR, stdio: 'inherit' });
    execSync(`${pipExe} -m playwright install chromium`, { cwd: SERVER_DIR, stdio: 'inherit' });
  }

  spawnProc('backend', pythonPath, ['chat_api.py', '--port', String(BACKEND_PORT)], {
    cwd: SERVER_DIR,
    env: { ...process.env },
  });

  await pollUrl(`${BACKEND_URL}${HEALTH_ENDPOINT}`, 'Backend');
  console.log(`${CLR.cyan}[EcoPilot]${CLR.reset} 后端已就绪 ✓`);
}

async function startFrontend() {
  const isWin = os.platform() === 'win32';
  if (!fs.existsSync(path.join(FRONTEND_DIR, 'node_modules'))) {
    console.log(`[EcoPilot] 安装前端依赖...`);
    execSync('npm install', { cwd: FRONTEND_DIR, stdio: 'inherit' });
  }

  const npxCmd = isWin ? 'npx.cmd' : 'npx';
  const args = isDev
    ? ['next', 'dev', '-p', String(FRONTEND_PORT)]
    : ['next', 'start', '-p', String(FRONTEND_PORT)];

  spawnProc('frontend', npxCmd, args, {
    cwd: FRONTEND_DIR,
    env: { ...process.env },
    shell: true,
  });

  await pollUrl(FRONTEND_URL, 'Frontend');
  console.log(`${CLR.cyan}[EcoPilot]${CLR.reset} 前端已就绪 ✓`);
}

// ── Open browser ───────────────────────────────────────────────────────────
function openBrowser() {
  const url = FRONTEND_URL;

  if (browser === 'chrome') {
    openChromeApp(url);
  } else if (browser === 'edge') {
    openEdgeApp(url);
  } else if (browser === 'firefox') {
    // Firefox doesn't have app mode, just open normally
    crossPlatformOpen(url);
  } else {
    crossPlatformOpen(url);
  }
}

function crossPlatformOpen(url) {
  const platform = os.platform();
  try {
    if (platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true });
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true, shell: true });
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    }
    console.log(`${CLR.cyan}[EcoPilot]${CLR.reset} 浏览器已打开 ✓`);
  } catch (_) {
    console.log(`${CLR.cyan}[EcoPilot]${CLR.reset} 请在浏览器中打开: ${url}`);
  }
}

function openChromeApp(url) {
  const paths = os.platform() === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : os.platform() === 'win32'
      ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

  const chrome = paths.find(p => fs.existsSync(p));
  if (!chrome) { crossPlatformOpen(url); return; }

  const args = [`--app=${url}`, '--window-size=1440,900'];
  spawn(chrome, args, { stdio: 'ignore', detached: true });
  console.log(`${CLR.cyan}[EcoPilot]${CLR.reset} Chrome 应用窗口已打开 ✓`);
}

function openEdgeApp(url) {
  const paths = os.platform() === 'darwin'
    ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : os.platform() === 'win32'
      ? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
      : ['microsoft-edge'];

  const edge = paths.find(p => fs.existsSync(p));
  if (!edge) { crossPlatformOpen(url); return; }

  const args = [`--app=${url}`, '--window-size=1440,900'];
  spawn(edge, args, { stdio: 'ignore', detached: true });
  console.log(`${CLR.cyan}[EcoPilot]${CLR.reset} Edge 应用窗口已打开 ✓`);
}

// ── Banner ─────────────────────────────────────────────────────────────────
function showBanner() {
  const lines = [
    '┌─────────────────────────────────────────────┐',
    '│                                             │',
    '│   🌿 EcoPilot — 企业生态环境合规AI管家      │',
    '│                                             │',
    `│   前端  → http://localhost:${FRONTEND_PORT}               │`,
    `│   后端  → http://localhost:${BACKEND_PORT}               │`,
    `│   模式  → ${isDev ? '开发 (HMR)' : '生产'}                    │`,
    `│   系统  → ${os.platform()} ${os.arch()}                           │`,
    '│                                             │',
    '│   Ctrl+C 停止所有服务                         │',
    '│                                             │',
    '└─────────────────────────────────────────────┘',
  ];
  lines.forEach(l => console.log(`${CLR.cyan}${l}${CLR.reset}`));
}

// ── Cleanup ────────────────────────────────────────────────────────────────
function cleanup() {
  console.log(`\n${CLR.cyan}[EcoPilot]${CLR.reset} 正在关闭...`);
  children.forEach(c => { try { c.kill('SIGTERM'); } catch (_) {} });
  process.exit(0);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Clear ports
  if (!isPortFree(BACKEND_PORT)) { console.log(`[EcoPilot] 清理端口 ${BACKEND_PORT}...`); killPort(BACKEND_PORT); }
  if (!isPortFree(FRONTEND_PORT)) { console.log(`[EcoPilot] 清理端口 ${FRONTEND_PORT}...`); killPort(FRONTEND_PORT); }

  try {
    console.log(`${CLR.cyan}[EcoPilot]${CLR.reset} v1.0.0 启动中...\n`);
    await startBackend();
    await startFrontend();
    openBrowser();
    showBanner();

    // Keep alive
    setInterval(() => {}, 1000);
  } catch (err) {
    console.error(`${CLR.cyan}[EcoPilot]${CLR.reset} 启动失败: ${err.message}`);
    cleanup();
  }
}

main();
