'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { load } = require('./helpers.cjs');
const { DEFAULTS } = require('../src/shared/defaults');

async function mainHarness() {
  const handlers = new Map(), sent = new EventEmitter();
  let window;
  class BrowserWindow extends EventEmitter {
    constructor() {
      super(); window = this;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: pathToFileURL(path.resolve(__dirname, '../src/renderer/index.html')).href },
        send: (channel, data) => sent.emit(channel, data), setWindowOpenHandler() {}, isLoading: () => false
      });
    }
    loadFile() {} isDestroyed() { return false; }
  }
  const app = new EventEmitter();
  Object.assign(app, { setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve() });
  class Manager extends EventEmitter { get() { return null; } }
  load('src/main/main.js', {
    electron: { app, BrowserWindow, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on() {} }, nativeImage: { createFromDataURL: () => ({}) }, nativeTheme: {}, Menu: { setApplicationMenu() {} } },
    './store': { getSettings: () => structuredClone(DEFAULTS) }, './sessions': { SessionManager: Manager }
  }, { process: { env: {}, argv: [], on() {} } });
  await Promise.resolve();
  const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { sent, sender, invoke: (channel, ...args) => handlers.get(channel)(sender, ...args), handlers };
}

test('IPC rejects foreign web contents before performing any operation', async () => {
  const h = await mainHarness();
  const good = await h.invoke('settings:get'); assert.equal(good.ok, true);
  const bad = await h.handlers.get('settings:get')({ sender: {}, senderFrame: h.sender.senderFrame });
  assert.equal(bad.ok, false); assert.match(bad.error, /odesílatel/);
  const childFrame = await h.handlers.get('settings:get')({ sender: h.sender.sender, senderFrame: { ...h.sender.senderFrame } });
  assert.equal(childFrame.ok, false);
});

test('actual transfer IPC routes local moves through conflict confirmation', { timeout: 3000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellsmith-ipc-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const from = path.join(root, 'data'), dst = path.join(root, 'dst'); await fs.mkdir(dst);
  await fs.writeFile(from, 'incoming'); await fs.writeFile(path.join(dst, 'data'), 'existing');
  const h = await mainHarness();
  const question = new Promise(r => h.sent.once('files:ask', r));
  const finish = new Promise(r => h.sent.once('files:finish', r));
  const reply = await h.invoke('files:transfer', { srcTarget: 'local', dstTarget: 'local', srcPaths: [from], dstDir: dst, move: true });
  assert.equal(reply.ok, true); assert.ok(reply.value.id); assert.equal(reply.value.renamed, undefined);
  const ask = await question;
  assert.equal(await fs.readFile(path.join(dst, 'data'), 'utf8'), 'existing');
  await h.invoke('files:transferAnswer', ask.jobId, { action: 'skip' });
  assert.equal((await finish).state, 'partial');
  assert.equal(await fs.readFile(from, 'utf8'), 'incoming');
});
