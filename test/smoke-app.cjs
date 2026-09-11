'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const fixture = process.env.SHELLSMITH_SMOKE_DIR;
if (!fixture) throw new Error('Run via npm run test:smoke');
const userData = path.join(fixture, 'user-data');
fs.mkdirSync(userData, { recursive: true });
app.setPath('appData', path.join(fixture, 'config'));
app.setPath('userData', userData);
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const evaluate = async code => {
        const result = await win.webContents.executeJavaScript(`(async () => { try { return { ok: true, value: await (${code}) }; } catch (e) { return { ok: false, error: e.stack || e.message }; } })()`);
        if (!result.ok) throw new Error(result.error);
        return result.value;
      };
      let booted = false;
      for (let i = 0; i < 100; i++) {
        booted = await evaluate('Boolean(window.__shellsmith?.remoteTree?.root && !window.__shellsmith.restoringState)');
        if (booted) break;
        await sleep(50);
      }
      assert.ok(booted, 'renderer boot');
      if (process.env.SHELLSMITH_SMOKE_PHASE === 'create') {
        await evaluate(`(async () => {
          const a = window.__shellsmith;
          const opts = { kind: 'local', shell: '/bin/sh', args: ['-i'], cwd: ${JSON.stringify(fixture)}, title: 'Lokální terminál' };
          await a.newLocalTab(opts);
          await a.splitWith('v', { ...opts, title: 'Druhý panel' });
          a.tabs.active.layout.ratio = 0.6; a.tabs.active.render();
          await a.remoteTree.navigate(${JSON.stringify(fixture)});
          if (a.sidebarTab !== 'files') a.selectSidebar('files');
          a.typeInTerminal(${JSON.stringify('printf "SS_%s\\n" "OK"\n')});
          await a.persistState();
        })()`);
        let output = '';
        for (let i = 0; i < 100; i++) {
          output = await evaluate(`(() => { const b = window.__shellsmith.activePane.term.buffer.active; return Array.from({ length: b.length }, (_, i) => b.getLine(i).translateToString(true)).join(String.fromCharCode(10)); })()`);
          if (output.includes('SS_OK')) break;
          await sleep(30);
        }
        // Sentinel vznikne až vykonáním printf; samotné echo příkazu ho neobsahuje.
        assert.ok(output.includes('SS_OK'), `native local PTY command output: ${JSON.stringify(output)}`);
        const screenshots = process.env.SHELLSMITH_SMOKE_SCREENSHOTS;
        if (screenshots) {
          // Neutrální pracovní adresář a prázdná historie; žádná uživatelská data.
          await evaluate(`(async () => {
            const a = window.__shellsmith;
            for (const p of a.tabs.allPanes()) { p.term.reset(); p.term.write(${JSON.stringify('ShellSmith 1.1.1\r\nTerminál připraven.\r\n')}); }
            await a.remoteTree.navigate(${JSON.stringify(fixture)});
          })()`);
          await sleep(150);
          fs.mkdirSync(screenshots, { recursive: true });
          fs.writeFileSync(path.join(screenshots, 'moba-classic.png'), (await win.webContents.capturePage()).toPNG());
        }
      }
      const state = await evaluate(`(async () => {
        const a = window.__shellsmith;
        await a.persistState();
        return { panes: a.tabs.allPanes().length, statuses: a.tabs.allPanes().map(p => p.status), ratio: a.tabs.active.layout.ratio, state: await window.smith.state.get(), theme: document.documentElement.dataset.theme };
      })()`);
      assert.equal(state.panes, 2); assert.deepEqual(state.statuses, ['connected', 'connected']);
      assert.equal(state.ratio, 0.6); assert.equal(state.state.version, 2); assert.equal(state.state.tabs[0].activePane, 1);
      assert.equal(state.theme, 'moba-classic');
      console.log('SMOKE_PASS ' + process.env.SHELLSMITH_SMOKE_PHASE + ' ' + JSON.stringify({ panes: state.panes, ratio: state.ratio, theme: state.theme }));
      app.quit();
    } catch (e) { console.error(e); app.exit(1); }
  });
});
require('../src/main/main');
