'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { load, rendererApp } = require('./helpers.cjs');
const { quoteShellArg, parseSshUrl } = require('../src/shared/shell');
const { saveLayout, readLayout } = require('../src/shared/layout');

test('shell arguments retain apostrophes and metacharacters as literal data', () => {
  for (const value of ["demo'; printf UNEXPECTED; #", '$(printf UNEXPECTED)', '`printf UNEXPECTED`', 'a b', '-x']) {
    const output = execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', `printf %s ${quoteShellArg(value)}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
    assert.equal(output, value);
  }
  for (const value of ['a\nb', 'a\rb', 'a\x1bb', 'a\0b']) assert.throws(() => quoteShellArg(value), /řídicí/);
});

test('file menu cd reaches directory with apostrophe without running injected command', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellsmith-quote-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "demo'; printf UNEXPECTED; #");
  await fs.mkdir(dir);
  let items, command;
  const { FileTree } = load('src/renderer/js/files.js', { './icons.js': {}, './ui.js': { contextMenu: (_x, _y, menu) => { items = menu; }, toast: message => assert.fail(message) } });
  const tree = Object.create(FileTree.prototype);
  const entry = { type: 'dir', path: dir, name: path.basename(dir) };
  tree.selectedEntries = () => [entry];
  tree.app = { typeInTerminal: s => { command = s; } };
  tree.showItemMenu(0, 0, entry);
  items.find(i => i.label === 'Přejít v terminálu (cd)').action();
  const output = execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', command + 'pwd'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  assert.equal(output.trim(), dir);
});

test('SSH URL keeps exact port and safely quotes initial directory', async () => {
  const errors = [];
  const App = rendererApp({}, { './ui.js': { toast: message => errors.push(message) } });
  const app = new App();
  app.sessions = { items: [{ kind: 'ssh', host: 'host', username: 'user', port: 22 }, { kind: 'ssh', host: 'host', username: 'user', port: 2222 }] };
  let selected;
  app.connectSaved = cfg => { selected = cfg; };
  await app.runCommand({ type: 'url', url: "ssh://user@host:2222/tmp%27%3B%20printf%20UNEXPECTED%3B%20%23" });
  assert.equal(selected.port, 2222);
  assert.equal(selected.initialCommand, "cd -- '/tmp'\\''; printf UNEXPECTED; #'" );
  assert.equal(parseSshUrl('ssh://user@[::1]:2222/path').host, '::1');
  await app.runCommand({ type: 'url', url: 'ssh://host/%0Aecho' });
  assert.equal(errors.length, 1);
});

test('late home reply cannot navigate the newly selected session', async () => {
  let release;
  const delayed = new Promise(r => { release = r; });
  const App = rendererApp({ smith: { files: { home: id => id === 'A' ? delayed : Promise.resolve('/B') } } });
  const app = new App();
  app.info = {};
  const calls = [];
  app.remoteTree = { nodes: new Map(), setLabel() {}, setStatus() {}, async navigate(p) { this.root = p; calls.push([this.target, p]); } };
  const pane = id => ({ sessionId: id, status: 'connected', supportsFiles: () => true, opts: { kind: 'ssh', host: id } });
  const pending = app.bindFilesTo(pane('A'));
  await app.bindFilesTo(pane('B'));
  release('/A'); await pending;
  assert.equal(app.remoteTree.root, '/B');
  assert.deepEqual(calls, [['B', '/B']]);
});

test('late directory listing cannot populate a replacement node', async () => {
  let release;
  const response = new Promise(r => { release = r; });
  const { FileTree } = load('src/renderer/js/files.js', { './icons.js': {}, './ui.js': {} }, { window: { smith: { files: { list: () => response } } } });
  const tree = Object.create(FileTree.prototype);
  tree.target = 'A'; tree.nodes = new Map(); tree.render = () => {}; tree.setStatus = () => {};
  const pending = tree.loadDir('/same');
  tree.target = 'B'; tree.nodes.clear(); const fresh = tree.node('/same');
  release({ entries: [{ name: 'old', path: '/same/old', type: 'file' }] });
  await pending;
  assert.equal(fresh.children, null);
});

test('split state roundtrips nested layout and migrates version 1', async () => {
  const layout = { type: 'split', dir: 'v', ratio: 0.3, a: { type: 'leaf', pane: { opts: { kind: 'local' }, cwd: '/tmp' } }, b: { type: 'split', dir: 'h', ratio: 0.65, a: { type: 'leaf', pane: { opts: { kind: 'ssh', host: 'one' } } }, b: { type: 'leaf', pane: { opts: { kind: 'ssh', host: 'two' } } } } };
  const saved = saveLayout(layout);
  assert.deepEqual(readLayout({ layout: JSON.parse(JSON.stringify(saved)) }), saved);
  assert.equal(saved.a.opts.cwd, '/tmp');
  assert.equal(saved.b.b.opts.host, 'two');
  assert.equal(readLayout({ opts: { kind: 'local' } }).type, 'leaf');
  assert.throws(() => readLayout({ layout: { type: 'split', dir: 'bad' } }));
  let state;
  const App = rendererApp({ smith: { state: { save: async value => { state = value; } } } });
  const app = new App();
  const panes = [layout.a.pane, layout.b.a.pane, layout.b.b.pane];
  const tab = { layout, activePane: panes[2], panes: () => panes, customTitle: 'servers' };
  app.tabs = { tabs: [tab], active: tab };
  await app.persistState();
  assert.equal(state.version, 2); assert.equal(state.tabs[0].activePane, 2);
  assert.equal(state.tabs[0].layout.b.b.opts.host, 'two');
});

test('partial transfer is shown as partial, never as a success toast', () => {
  const messages = [];
  const App = rendererApp({}, { './ui.js': { toast: (message, opts) => messages.push({ message, opts }) } });
  const app = new App(); app.transfers.set('id', { row: { remove() {} } });
  app.transfers.set('keep', {}); app.remoteTree = { refresh() {} };
  app.finishTransfer({ id: 'id', state: 'partial', filesDone: 1, filesSkipped: 1 });
  assert.match(messages[0].message, /částečně/); assert.equal(messages[0].opts.type, 'error');
});
