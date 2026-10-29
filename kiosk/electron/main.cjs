const { app, BrowserWindow, ipcMain, dialog, session: electronSession } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { scryptSync, timingSafeEqual } = require('node:crypto');
const { DemoStore } = require('./core.cjs');
const { ApiGateway } = require('./gateway.cjs');
const { KioskSession } = require('./session.cjs');

let window, kiosk, config, exitAllowed = false, adminAttempts = [];
const windowed = process.argv.includes('--windowed');
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(boot).catch(() => {
    dialog.showErrorBox('S TECH · Kurulum', 'Kiosk başlatılamadı. kiosk.config.json dosyasını ve veri klasörünü kontrol edin.');
    exitAllowed = true; app.quit();
  });
}
async function boot() {
  if (!app.isPackaged && process.env.STECH_KIOSK_DATA_DIR) app.setPath('userData', process.env.STECH_KIOSK_DATA_DIR);
  const file = process.env.STECH_KIOSK_CONFIG || path.join(app.getPath('userData'), 'kiosk.config.json');
  try { config = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; config = { mode: 'demo', idleSeconds: 90, station: 'S TECH · Merkez' }; }
  if (!['demo', 'connected'].includes(config.mode)) throw new Error('Invalid mode');
  if (config.mode === 'connected' && !/^[0-9a-f]{128}$/.test(config.adminPinHash || '')) throw new Error('Admin PIN required');
  const demo = new DemoStore(path.join(app.getPath('userData'), 'demo-wallets.json'));
  if (config.mode === 'demo') await demo.initialize();
  kiosk = new KioskSession({ demo, gateway: config.mode === 'connected' ? new ApiGateway(config) : null,
    mode: config.mode, idleSeconds: Math.max(30, Math.min(120, Number(config.idleSeconds) || 90)),
    onLock: () => window?.webContents.send('kiosk:locked') });
  const uiFile = path.join(__dirname, '../ui/index.html');
  window = new BrowserWindow({ width: 1440, height: 900, minWidth: 1024, minHeight: 720,
    fullscreen: !windowed, kiosk: !windowed, autoHideMenuBar: true, backgroundColor: '#090C12',
    title: 'S TECH', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged } });
  window.setMenu(null);
  electronSession.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  electronSession.defaultSession.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => { kiosk.lock(); window.reload(); });
  window.on('close', event => {
    if (!exitAllowed && !windowed) { event.preventDefault(); window.webContents.send('kiosk:admin'); }
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.alt && input.key.toLowerCase() === 'q') { event.preventDefault(); window.webContents.send('kiosk:admin'); }
    if (!windowed && ['F5', 'F11', 'F12', 'BrowserBack'].includes(input.key)) event.preventDefault();
    if (!windowed && (input.control || input.meta) && ['r', 'l', 'n', 'w', '+', '-', '0'].includes(input.key.toLowerCase())) event.preventDefault();
  });
  const expectedUrl = pathToFileURL(uiFile).href;
  ipcMain.handle('kiosk:call', async (event, action, payload) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== expectedUrl)
      return { ok: false, error: 'İzin verilmeyen istek.' };
    try {
      if (typeof action !== 'string' || JSON.stringify(payload ?? {}).length > 2048) throw new Error('Geçersiz istek.');
      if (action === 'info') return { ok: true, data: { mode: config.mode, station: config.station || 'S TECH · Merkez', reader: 'USB / klavye modu', pos: config.mode === 'demo' ? 'simulation' : 'unavailable' } };
      if (action === 'adminExit') {
        const now = Date.now(); adminAttempts = adminAttempts.filter(t => now - t < 60000);
        if (adminAttempts.length >= 5) throw new Error('Bir dakika sonra tekrar dene.');
        adminAttempts.push(now);
        const pin = payload?.pin;
        if (typeof pin !== 'string' || pin.length > 64) throw new Error('Geçersiz PIN.');
        const valid = config.adminPinHash
          ? timingSafeEqual(scryptSync(pin, 'stech-kiosk-admin-v1', 64), Buffer.from(config.adminPinHash, 'hex'))
          : config.mode === 'demo' && pin === '2026';
        if (!valid) throw new Error('Yetkili PIN kodu hatalı.');
        kiosk.lock(); exitAllowed = true; app.quit(); return { ok: true };
      }
      return { ok: true, data: await kiosk.run(action, payload) };
    } catch (error) { return { ok: false, error: error.message || 'İşlem tamamlanamadı.' }; }
  });
  setInterval(() => {
    kiosk.tick();
    if (kiosk.session) window?.webContents.send('kiosk:countdown', kiosk.remaining());
  }, 1000).unref();
  await window.loadFile(uiFile);
  window.show();
}
app.on('window-all-closed', () => app.quit());
