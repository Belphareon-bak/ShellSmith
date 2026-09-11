'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '..');

function load(rel, overrides = {}, globals = {}) {
  const filename = path.join(root, rel);
  let code = fs.readFileSync(filename, 'utf8');
  if (rel.startsWith('src/renderer/')) code = require('esbuild').transformSync(code, { format: 'cjs', loader: 'js' }).code;
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(code, {
    require: id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id),
    module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, Error, TypeError, console, process, setTimeout, clearTimeout, setInterval, clearInterval,
    ...globals
  }, { filename });
  return module.exports;
}

function rendererApp(window, extra = {}) {
  const mocks = Object.fromEntries(['./ui.js', './icons.js', './themes.js', './terminal.js', './tabs.js', './files.js', './sessionmgr.js', './settingsdlg.js', '@xterm/xterm/css/xterm.css', '../styles/app.css'].map(s => [s, {}]));
  return load('src/renderer/js/app.js', { ...mocks, ...extra }, { window }).App;
}

module.exports = { load, rendererApp };
