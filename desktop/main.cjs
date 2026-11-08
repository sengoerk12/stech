const { app, BrowserWindow, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

let window;
let server;
const isAdmin = require('./package.json').desktopMode === 'admin';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };
const configPath = path.join(app.getPath('userData'), 'local-runtime.json');
async function healthy() {
  try {
    const response = await fetch('http://127.0.0.1:3001/api/v1/health', { signal: AbortSignal.timeout(1500) });
    const data = await response.json();
    return response.ok && data.status === 'ok' && data.cafe === 'pancafe';
  } catch { return false; }
}
async function ensureApi() {
  if (await healthy()) return;
  if (!fs.existsSync(configPath)) throw new Error('Yerel sunucu ayarı bulunamadı. S TECH kurulumundaki local-runtime.json dosyasını kontrol et.');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const apiDirectory = path.join(config.projectDirectory, 'apps', 'api');
  const cli = path.join(config.projectDirectory, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!fs.existsSync(cli) || !fs.existsSync(config.nodeExecutable)) throw new Error('S TECH yerel sunucu dosyaları bulunamadı.');
  const log = fs.openSync(path.join(app.getPath('userData'), 'api.log'), 'a');
  const child = spawn(config.nodeExecutable, [cli, 'src/main.ts'], {
    cwd: apiDirectory, detached: true, windowsHide: true,
    stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: 'development' },
  });
  child.on('error', () => {});
  child.unref();
  fs.closeSync(log);
  for (let i = 0; i < 120; i++) {
    if (await healthy()) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Yerel sunucu başlatılamadı. S TECH sunucu günlüğünü ve PanCafe bağlantısını kontrol et.');
}
function startServer() {
  const root = path.join(__dirname, 'web');
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v1/')) {
      const upstream = http.request({ hostname: '127.0.0.1', port: 3001, path: req.url, method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:3001' }, timeout: 30000 }, response => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'S TECH sunucusuna ulaşılamıyor. Uygulamayı yeniden aç.' }));
      });
      req.pipe(upstream);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end(); return; }
    let file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (path.extname(pathname)) { res.writeHead(404).end(); return; }
      file = path.join(root, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    app.setAppUserModelId(isAdmin ? 'com.stech.admin.local' : 'com.stech.desktop.local');
    window = new BrowserWindow({ title: isAdmin ? 'S TECH Yönetim' : 'S TECH', width: isAdmin ? 1380 : 480, height: 900, minWidth: isAdmin ? 900 : 360, minHeight: 640,
      backgroundColor: '#090C12', autoHideMenuBar: true, icon: path.join(__dirname, 'brand-logo.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    window.setMenu(null);
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html lang="tr"><body style="background:#090C12;color:#fff;font:18px sans-serif;display:grid;place-content:center;height:90vh"><h1 style="color:#ffac22">S TECH</h1><p>Uygulama hazırlanıyor…</p></body></html>'));
    try {
      await ensureApi();
      const origin = await startServer();
      window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
      await window.loadURL(origin + '/login');
    } catch (error) {
      dialog.showErrorBox('S TECH başlatılamadı', error.message);
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => server?.close());
}
