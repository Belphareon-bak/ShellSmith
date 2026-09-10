'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** Zabalí odpověď z main procesu: chybu vyhodí, hodnotu vrátí. */
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || res.ok !== true) throw new Error((res && res.error) || 'Neznámá chyba');
  return res.value;
}

const listeners = new Map();
function on(channel, fn) {
  const wrapped = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, wrapped);
  listeners.set(fn, [channel, wrapped]);
  return () => {
    const rec = listeners.get(fn);
    if (rec) { ipcRenderer.removeListener(rec[0], rec[1]); listeners.delete(fn); }
  };
}

contextBridge.exposeInMainWorld('smith', {
  /** Skutečná cesta souboru přetaženého ze systému (Electron 32+). */
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return null; } },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
    reset: () => call('settings:reset'),
    configDir: () => call('settings:configDir'),
    onChange: (fn) => on('settings:changed', fn)
  },
  saved: {
    list: () => call('saved:list'),
    replace: (items) => call('saved:replace', items)
  },
  secret: {
    set: (id, value) => call('secret:set', id, value),
    has: (id) => call('secret:has', id),
    remove: (id) => call('secret:delete', id),
    available: () => call('secret:available')
  },
  state: {
    get: () => call('state:get'),
    save: (s) => call('state:save', s)
  },
  term: {
    create: (opts) => call('term:create', opts),
    write: (id, data) => call('term:write', id, data),
    resize: (id, cols, rows) => call('term:resize', id, cols, rows),
    close: (id) => call('term:close', id),
    list: () => call('term:list'),
    promptReply: (id, promptId, answers) => call('term:promptReply', id, promptId, answers),
    onData: (fn) => on('term:data', fn),
    onStatus: (fn) => on('term:status', fn),
    onCwd: (fn) => on('term:cwd', fn),
    onExit: (fn) => on('term:exit', fn),
    onPrompt: (fn) => on('term:prompt', fn)
  },
  files: {
    home: (t) => call('files:home', t),
    realpath: (t, p) => call('files:realpath', t, p),
    list: (t, dir) => call('files:list', t, dir),
    stat: (t, p) => call('files:stat', t, p),
    mkdir: (t, p) => call('files:mkdir', t, p),
    rename: (t, from, to) => call('files:rename', t, from, to),
    chmod: (t, p, mode) => call('files:chmod', t, p, mode),
    remove: (t, paths) => call('files:remove', t, paths),
    readText: (t, p, limit) => call('files:readText', t, p, limit),
    writeText: (t, p, text) => call('files:writeText', t, p, text),
    transfer: (req) => call('files:transfer', req),
    cancel: (id) => call('files:transferCancel', id),
    answer: (id, reply) => call('files:transferAnswer', id, reply),
    transfers: () => call('files:transferList'),
    startDrag: (target, paths) => ipcRenderer.send('files:startDrag', { target, paths }),
    dragUrls: (target, items) => call('files:dragUrls', target, items),
    openExternal: (t, p) => call('files:openExternal', t, p),
    stopWatch: (tempPath) => call('files:stopWatch', tempPath),
    onProgress: (fn) => on('files:progress', fn),
    onAsk: (fn) => on('files:ask', fn),
    onWarn: (fn) => on('files:warn', fn),
    onFinish: (fn) => on('files:finish', fn),
    onUploaded: (fn) => on('files:uploaded', fn)
  },
  dialog: {
    openFiles: (opts) => call('dialog:openFiles', opts),
    openDir: (opts) => call('dialog:openDir', opts),
    saveFile: (opts) => call('dialog:saveFile', opts)
  },
  clipboard: {
    read: () => call('clipboard:read'),
    readSelection: () => call('clipboard:readSelection'),
    write: (text) => call('clipboard:write', text)
  },
  win: {
    minimize: () => call('window:minimize'),
    toggleMaximize: () => call('window:toggleMaximize'),
    close: () => call('window:close'),
    isMaximized: () => call('window:isMaximized'),
    onState: (fn) => on('window:state', fn)
  },
  app: {
    info: () => call('app:info'),
    openExternal: (url) => call('shell:openExternal', url),
    onCommand: (fn) => on('app:command', fn)
  }
});
