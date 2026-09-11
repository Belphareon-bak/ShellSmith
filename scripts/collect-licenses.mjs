/**
 * Přegeneruje THIRD-PARTY-NOTICES.md ze skutečného stavu produkčních
 * závislostí. Spouští se přes `npm run licenses` po každé změně závislostí.
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readPkg(name) {
  // Balíček může ležet i vnořeně pod jiným (npm ho tam dá při konfliktu verzí).
  const candidates = [path.join(root, 'node_modules', name, 'package.json')];
  const tree = path.join(root, 'node_modules');
  for (const parent of ['node-pty', 'ssh2', 'cpu-features']) {
    candidates.push(path.join(tree, parent, 'node_modules', name, 'package.json'));
  }
  for (const c of candidates) {
    if (existsSync(c)) return JSON.parse(readFileSync(c, 'utf8'));
  }
  return null;
}

function licenseOf(pkg) {
  if (!pkg) return '?';
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === 'string' ? x : x.type)).join(', ');
  if (l && typeof l === 'object') return l.type || '?';
  return '?';
}

function sourceOf(pkg) {
  if (!pkg) return '';
  const r = pkg.repository;
  const url = (typeof r === 'string' ? r : r?.url) || pkg.homepage || '';
  return url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
}

const out = execFileSync('npm', ['ls', '--prod', '--all', '--json'], { cwd: root, encoding: 'utf8' });
const tree = JSON.parse(out || '{}');

const found = new Map();
(function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies || {})) {
    if (!found.has(name)) found.set(name, info.version);
    walk(info);
  }
})(tree);

const rows = [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, version]) => {
  const pkg = readPkg(name);
  return { name, version, license: licenseOf(pkg), source: sourceOf(pkg) };
});

const electron = JSON.parse(readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8'));
const link = (u) => (u.startsWith('http') ? `[${u}](${u})` : u || '—');
const table = (items) => [
  '| Knihovna | Verze | Licence | Zdroj |',
  '|---|---|---|---|',
  ...items.map((r) => `| \`${r.name}\` | ${r.version} | ${r.license} | ${link(r.source)} |`)
].join('\n');

const md = `# Licence použitých knihoven

ShellSmith je [MIT](LICENSE). Do spustitelného balíčku (AppImage, \`.deb\`)
se spolu s ním distribuují níže uvedené knihovny. Všechny jsou pod
permisivními licencemi, které distribuci v rámci MIT projektu dovolují.

Seznam odpovídá stavu produkčních závislostí v \`package-lock.json\`;
po změně závislostí ho přegenerujte příkazem \`npm run licenses\`.

## Běhové závislosti

${table(rows)}

## Běhové prostředí

${table([{ name: 'electron', version: electron.version, license: licenseOf(electron), source: 'https://github.com/electron/electron' }])}

Electron s sebou nese Chromium a Node.js, které stojí na dalších licencích
(BSD-3-Clause a další). Jejich úplné znění najdete v balíčku v souborech
\`LICENSES.chromium.html\` a \`LICENSE.electron.txt\`, které tam Electron přikládá.

## Co ShellSmith nepřibaluje

Ikony aplikace jsou původní. Žádné písmo se nedistribuuje – rozhraní i
terminál používají písma nainstalovaná v systému, a pokud zvolené písmo
chybí, sáhne se po systémovém záložním.
`;

writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), md);
console.log(`THIRD-PARTY-NOTICES.md: ${rows.length} knihoven`);
const unknown = rows.filter((r) => r.license === '?');
if (unknown.length) {
  console.error('Pozor, u těchto balíčků se licenci nepodařilo zjistit:', unknown.map((r) => r.name).join(', '));
  process.exitCode = 1;
}
