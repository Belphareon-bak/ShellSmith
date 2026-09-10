'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const {
  app, BrowserWindow, ipcMain, dialog, clipboard, shell, nativeImage, Menu, nativeTheme
} = require('electron');

const store = require('./store');
const { SessionManager } = require('./sessions');
const { LocalAdapter, SftpAdapter } = require('./fsadapters');
const { TransferJob, TransferQueue, removeRecursive } = require('./transfer');
const { DragServer } = require('./dragserver');

app.setName('C3Term');
app.setAppUserModelId('cz.belphareon.c3term');

const manager = new SessionManager();
const transfers = new TransferQueue();
const dragServer = new DragServer();
const localAdapter = new LocalAdapter();
const sftpAdapters = new Map();   // sessionId -> SftpAdapter
const editWatchers = new Map();   // tempPath -> watcher záznam

let win = null;
let quitting = false;
const isDev = process.argv.includes('--dev');

/** Přeloží argumenty spuštění na pokyn pro okno (druhé spuštění, odkaz z plochy…). */
function commandFromArgv(argv) {
  const url = argv.find((a) => /^ssh:\/\//i.test(a));
  if (url) return { type: 'url', url };
  if (argv.includes('--new-local')) return { type: 'new-local' };
  if (argv.includes('--sessions')) return { type: 'sessions' };
  return null;
}

function sendCommand(cmd) {
  if (!cmd || !win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send('app:command', cmd));
  else win.webContents.send('app:command', cmd);
}

/* ------------------------------------------------------------------ */
/* Okno                                                                */
/* ------------------------------------------------------------------ */

function createWindow() {
  const s = store.getSettings();
  const bounds = s.window || {};
  const native = !!s.appearance.nativeFrame;

  win = new BrowserWindow({
    width: bounds.width || 1360,
    height: bounds.height || 860,
    x: Number.isFinite(bounds.x) ? bounds.x : undefined,
    y: Number.isFinite(bounds.y) ? bounds.y : undefined,
    minWidth: 860,
    minHeight: 520,
    show: false,
    frame: native,
    backgroundColor: '#12161c',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    title: 'C3Term',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    if (bounds.maximized) win.maximize();
    win.show();
    if (process.env.C3TERM_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const b = win.getNormalBounds();
    store.saveSettings({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized } });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('maximize', () => { saveBounds(); send('window:state', { maximized: true }); });
  win.on('unmaximize', () => { saveBounds(); send('window:state', { maximized: false }); });
  // Na zavření se ptáme tady, ať platí stejně pro tlačítko v titulku,
  // Alt+F4 i zavření z panelu plochy.
  win.on('close', (e) => {
    if (quitting) return;
    const active = manager.activeCount();
    if (active === 0 || !store.getSettings().behavior.confirmOnQuit) { quitting = true; return; }
    e.preventDefault();
    dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Ukončit', 'Zpět'],
      defaultId: 1, cancelId: 1,
      title: 'Ukončit C3Term',
      message: `Běží ${active} ${active === 1 ? 'aktivní relace' : active < 5 ? 'aktivní relace' : 'aktivních relací'}.`,
      detail: 'Opravdu chcete aplikaci ukončit?'
    }).then((r) => {
      if (r.response === 0) { quitting = true; win.close(); }
    });
  });

  win.on('closed', () => { win = null; });

  if (isDev) {
    win.webContents.on('console-message', (_e, level, message, line, src) => {
      console.log(`[renderer:${level}] ${message} (${src}:${line})`);
    });
    win.webContents.on('render-process-gone', (_e, d) => console.error('[renderer] spadl:', d));
  }

  // Odkazy z terminálu otevíráme v systémovém prohlížeči, ne v aplikaci.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ------------------------------------------------------------------ */
/* Pomocníci pro IPC                                                   */
/* ------------------------------------------------------------------ */

function handle(channel, fn) {
  ipcMain.handle(channel, async (_evt, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (isDev) console.error(`[ipc:${channel}]`, e);
      return { ok: false, error: msg };
    }
  });
}

async function resolveAdapter(target) {
  if (!target || target === 'local') return localAdapter;
  const session = manager.get(target);
  if (!session) throw new Error('Relace už neexistuje');
  if (session.kind === 'local') return localAdapter;
  const cached = sftpAdapters.get(target);
  // Adaptér platí jen dokud drží ten SFTP kanál, který relace opravdu používá.
  if (cached && session.sftpClient && cached.sftp === session.sftpClient) return cached;
  const sftp = await session.sftp();
  const adapter = new SftpAdapter(sftp, session);
  sftpAdapters.set(target, adapter);
  return adapter;
}

/* ------------------------------------------------------------------ */
/* Události relací → renderer                                          */
/* ------------------------------------------------------------------ */

manager.on('data', (id, data) => send('term:data', { id, data }));
manager.on('status', (id, p) => send('term:status', Object.assign({ id }, p)));
manager.on('cwd', (id, cwd) => send('term:cwd', { id, cwd }));
manager.on('exit', (id, p) => {
  sftpAdapters.delete(id);
  send('term:exit', Object.assign({ id }, p));
});
manager.on('prompt', (id, p) => send('term:prompt', Object.assign({ id }, p)));

transfers.on('progress', (s) => send('files:progress', s));
transfers.on('ask', (q) => send('files:ask', q));
transfers.on('warn', (w) => send('files:warn', w));
transfers.on('finish', (s) => send('files:finish', s));

/* ------------------------------------------------------------------ */
/* IPC – nastavení, uložené relace, tajemství                          */
/* ------------------------------------------------------------------ */

handle('settings:get', async () => store.getSettings());
handle('settings:set', async (patch) => {
  const next = store.saveSettings(patch);
  send('settings:changed', next);
  return next;
});
handle('settings:reset', async () => {
  const next = store.resetSettings();
  send('settings:changed', next);
  return next;
});
handle('settings:configDir', async () => store.configDir());

handle('saved:list', async () => store.getSessions().items);
handle('saved:replace', async (items) => store.saveSessions(items).items);

handle('secret:set', async (id, value) => store.setSecret(id, value));
handle('secret:has', async (id) => store.getSecret(id) != null);
handle('secret:delete', async (id) => { store.deleteSecret(id); return true; });
handle('secret:available', async () => store.secretsAvailable());

handle('state:get', async () => store.getState());
handle('state:save', async (state) => { store.saveState(state); return true; });

/* ------------------------------------------------------------------ */
/* IPC – terminálové relace                                            */
/* ------------------------------------------------------------------ */

handle('term:create', async (opts) => manager.create(opts || {}).info());
handle('term:write', async (id, data) => { manager.write(id, data); return true; });
handle('term:resize', async (id, cols, rows) => { manager.resize(id, cols, rows); return true; });
handle('term:close', async (id) => { manager.close(id); sftpAdapters.delete(id); return true; });
handle('term:list', async () => manager.list());
handle('term:promptReply', async (id, promptId, answers) => {
  const s = manager.get(id);
  if (s && s.promptReply) s.promptReply(promptId, answers);
  return true;
});

/* ------------------------------------------------------------------ */
/* IPC – souborové operace                                             */
/* ------------------------------------------------------------------ */

handle('files:home', async (target) => (await resolveAdapter(target)).home());
handle('files:realpath', async (target, p) => (await resolveAdapter(target)).realpath(p));
handle('files:list', async (target, dir) => {
  const a = await resolveAdapter(target);
  const entries = await a.list(dir);
  return { dir, entries, label: a.label, kind: a.kind };
});
handle('files:stat', async (target, p) => (await resolveAdapter(target)).stat(p));
handle('files:mkdir', async (target, p) => { await (await resolveAdapter(target)).mkdir(p); return true; });
handle('files:rename', async (target, from, to) => { await (await resolveAdapter(target)).rename(from, to); return true; });
handle('files:chmod', async (target, p, mode) => { await (await resolveAdapter(target)).chmod(p, mode); return true; });
handle('files:remove', async (target, paths) => {
  const a = await resolveAdapter(target);
  for (const p of paths) await removeRecursive(a, p);
  return true;
});
handle('files:readText', async (target, p, limit) => {
  const a = await resolveAdapter(target);
  const buf = await a.readFile(p);
  const max = limit || 2 * 1024 * 1024;
  return { text: buf.slice(0, max).toString('utf8'), truncated: buf.length > max, size: buf.length };
});
handle('files:writeText', async (target, p, text) => {
  await (await resolveAdapter(target)).writeFile(p, Buffer.from(text, 'utf8'));
  return true;
});

handle('files:transfer', async ({ srcTarget, srcPaths, dstTarget, dstDir, move }) => {
  const src = await resolveAdapter(srcTarget);
  const dst = await resolveAdapter(dstTarget);
  if (src === dst && move) {
    // Přesun v rámci jednoho stroje zvládne rename, není třeba kopírovat data.
    for (const p of srcPaths) {
      const dest = dst.join(dstDir, dst.basename(p));
      if (dest === p) continue;
      await dst.rename(p, dest);
    }
    return { renamed: true };
  }
  const settings = store.getSettings();
  const job = new TransferJob({
    src, srcPaths, dst, dstDir, move: !!move,
    conflictPolicy: settings.files.confirmOverwrite ? 'ask' : 'overwrite'
  });
  transfers.add(job);
  return job.snapshot();
});
handle('files:transferCancel', async (id) => { transfers.cancel(id); return true; });
handle('files:transferAnswer', async (id, reply) => { transfers.answer(id, reply); return true; });
handle('files:transferList', async () => transfers.list());

/* ---- přetažení souboru z panelu ven do systému --------------------- */

const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAcElEQVR42u3XMQ7AIAxDUd//0nRp' +
  'JZaqYCcM/HmLLQMBAAAAAADgL9Iq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq7cUq' +
  '7cUq7cUq7cUq7cUq7QM8YwF2Ky5r3wAAAABJRU5ErkJggg=='
);

ipcMain.on('files:startDrag', async (evt, { target, paths }) => {
  try {
    const a = await resolveAdapter(target);
    if (a.kind === 'local') {
      evt.sender.startDrag({ files: paths, icon: DRAG_ICON });
    }
  } catch (e) {
    console.error('[drag]', e.message);
  }
});

handle('files:dragUrls', async (target, items) => {
  // Pro vzdálené soubory připravíme jednorázová URL – Chromium je při přetažení
  // do správce souborů stáhne na pozadí (mechanismus DownloadURL).
  const a = await resolveAdapter(target);
  if (a.kind === 'local') return null;
  const out = [];
  for (const it of items.slice(0, 20)) {
    if (it.type === 'dir') continue;
    const url = await dragServer.register(a, it.path, it.name, it.size);
    out.push(`application/octet-stream:${it.name}:${url}`);
  }
  return out;
});

/* ---- otevření souboru v externím editoru --------------------------- */

handle('files:openExternal', async (target, remotePath) => {
  const a = await resolveAdapter(target);
  if (a.kind === 'local') {
    await shell.openPath(remotePath);
    return { local: true };
  }
  const dir = path.join(os.tmpdir(), 'c3term-edit', Date.now().toString(36));
  await fsp.mkdir(dir, { recursive: true });
  const localPath = path.join(dir, a.basename(remotePath));
  await fsp.writeFile(localPath, await a.readFile(remotePath));

  const settings = store.getSettings();
  const cmd = (settings.files.editorCommand || '').trim();
  if (cmd) {
    const parts = cmd.split(/\s+/);
    spawn(parts[0], [...parts.slice(1), localPath], { detached: true, stdio: 'ignore' }).unref();
  } else {
    await shell.openPath(localPath);
  }

  // Uložení v editoru pošleme zpátky na server.
  let timer = null;
  const watcher = fs.watch(localPath, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const data = await fsp.readFile(localPath);
        const adapter = await resolveAdapter(target);
        await adapter.writeFile(remotePath, data);
        send('files:uploaded', { target, path: remotePath });
      } catch (e) {
        send('files:warn', { message: `Nelze uložit ${remotePath}: ${e.message}` });
      }
    }, 400);
  });
  editWatchers.set(localPath, { watcher, target, remotePath });
  return { local: false, tempPath: localPath };
});

handle('files:stopWatch', async (tempPath) => {
  const rec = editWatchers.get(tempPath);
  if (rec) { try { rec.watcher.close(); } catch (_) {} editWatchers.delete(tempPath); }
  return true;
});

/* ------------------------------------------------------------------ */
/* IPC – dialogy, schránka, okno                                       */
/* ------------------------------------------------------------------ */

handle('dialog:openFiles', async (opts) => {
  const r = await dialog.showOpenDialog(win, Object.assign({
    properties: ['openFile', 'multiSelections']
  }, opts || {}));
  return r.canceled ? [] : r.filePaths;
});
handle('dialog:openDir', async (opts) => {
  const r = await dialog.showOpenDialog(win, Object.assign({
    properties: ['openDirectory', 'createDirectory']
  }, opts || {}));
  return r.canceled ? null : r.filePaths[0];
});
handle('dialog:saveFile', async (opts) => {
  const r = await dialog.showSaveDialog(win, opts || {});
  return r.canceled ? null : r.filePath;
});

handle('clipboard:read', async () => clipboard.readText());
handle('clipboard:readSelection', async () => {
  try { return clipboard.readText('selection'); } catch (_) { return ''; }
});
handle('clipboard:write', async (text) => {
  clipboard.writeText(text);
  try { clipboard.writeText(text, 'selection'); } catch (_) {}
  return true;
});

handle('shell:openExternal', async (url) => {
  if (/^https?:|^mailto:/.test(url)) await shell.openExternal(url);
  return true;
});

handle('window:minimize', async () => { win && win.minimize(); return true; });
handle('window:toggleMaximize', async () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
  return win.isMaximized();
});
handle('window:close', async () => { win && win.close(); return true; });
handle('window:isMaximized', async () => !!(win && win.isMaximized()));
handle('app:info', async () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  platform: `${os.type()} ${os.release()}`,
  configDir: store.configDir(),
  home: os.homedir(),
  user: os.userInfo().username,
  hostname: os.hostname(),
  hasAgent: !!process.env.SSH_AUTH_SOCK,
  secretsAvailable: store.secretsAvailable()
}));

/* ------------------------------------------------------------------ */
/* Životní cyklus                                                      */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    sendCommand(commandFromArgv(argv));
  });

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    createWindow();
    sendCommand(commandFromArgv(process.argv));
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  quitting = true;
  store.flushSettings();
  for (const rec of editWatchers.values()) { try { rec.watcher.close(); } catch (_) {} }
  editWatchers.clear();
  manager.closeAll();
  dragServer.close();
});

process.on('uncaughtException', (e) => {
  console.error('[main] neošetřená výjimka:', e);
});
