import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const fixture = await mkdtemp(path.join(tmpdir(), 'shellsmith-smoke-'));
const shotIndex = process.argv.indexOf('--screenshots');
const screenshots = shotIndex >= 0 ? path.resolve(process.argv[shotIndex + 1]) : '';
const env = { ...process.env, SHELLSMITH_SMOKE_DIR: fixture, SHELLSMITH_SMOKE_SCREENSHOTS: screenshots };
delete env.ELECTRON_RUN_AS_NODE;
delete env.BASH_ENV;
delete env.ENV;
try {
  await mkdir(path.join(fixture, 'config', 'shellsmith'), { recursive: true });
  await writeFile(path.join(fixture, 'config', 'shellsmith', 'settings.json'), JSON.stringify({
    appearance: { theme: 'moba-classic' },
    behavior: { startupTab: 'none', restoreTabs: true, confirmOnQuit: false },
    files: { defaultLocalDir: fixture }
  }));
  for (const phase of ['create', 'restore']) {
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), ['--ozone-platform=headless', '--disable-gpu', '--password-store=basic', path.join(root, 'test/smoke-app.cjs')], {
        cwd: root, env: { ...env, SHELLSMITH_SMOKE_PHASE: phase }, stdio: ['ignore', 'pipe', 'pipe']
      });
      const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Smoke ${phase}: timeout`)); }, 30000);
      let stderr = '', stdout = '';
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
      child.on('error', e => { clearTimeout(timeout); reject(e); });
      child.on('exit', code => {
        clearTimeout(timeout);
        if (code === 0 && stdout.includes('SMOKE_PASS')) { process.stdout.write(stdout); resolve(); }
        else reject(new Error(`Smoke ${phase} failed (${code})\n${stdout}\n${stderr}`));
      });
    });
  }
} finally { await rm(fixture, { recursive: true, force: true }); }
