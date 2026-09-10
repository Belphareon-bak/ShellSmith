'use strict';
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { DEFAULTS, deepMerge } = require('../shared/defaults');

let dir = null;
function configDir() {
  if (!dir) {
    dir = path.join(app.getPath('appData'), 'shellsmith');
    if (!fs.existsSync(dir)) migrateLegacyConfig(dir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/** Aplikace se dřív jmenovala jinak – nastavení a relace si vezmeme s sebou. */
function migrateLegacyConfig(target) {
  for (const legacy of ['c3term']) {
    const from = path.join(app.getPath('appData'), legacy);
    if (!fs.existsSync(from)) continue;
    try {
      fs.renameSync(from, target);
      console.log(`[store] převzata konfigurace z ~/.config/${legacy}`);
      return;
    } catch (e) {
      console.error('[store] konfiguraci se nepodařilo převzít:', e.message);
    }
  }
}
const file = (name) => path.join(configDir(), name);

function readJSON(name, fallback) {
  try {
    const raw = fs.readFileSync(file(name), 'utf8');
    const val = JSON.parse(raw);
    return val && typeof val === 'object' ? val : fallback;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Poškozený soubor neztrácíme, odložíme ho stranou.
      try { fs.renameSync(file(name), file(name + '.corrupt-' + Date.now())); } catch (_) {}
      console.error('[store] nelze načíst', name, e.message);
    }
    return fallback;
  }
}

function writeJSON(name, value) {
  const target = file(name);
  const tmp = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

/* ------------------------------------------------------------------ */
/* Nastavení                                                           */
/* ------------------------------------------------------------------ */

let settings = null;
let saveTimer = null;

function getSettings() {
  if (!settings) settings = deepMerge(DEFAULTS, readJSON('settings.json', {}));
  return settings;
}

function saveSettings(patch) {
  settings = deepMerge(getSettings(), patch || {});
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJSON('settings.json', settings), 120);
  return settings;
}

function flushSettings() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (settings) writeJSON('settings.json', settings);
}

function resetSettings() {
  settings = deepMerge(DEFAULTS, {});
  writeJSON('settings.json', settings);
  return settings;
}

/* ------------------------------------------------------------------ */
/* Uložené relace                                                      */
/* ------------------------------------------------------------------ */

let sessions = null;

function getSessions() {
  if (!sessions) {
    const data = readJSON('sessions.json', null);
    sessions = Array.isArray(data) ? { items: data } : (data || { items: [] });
    if (!Array.isArray(sessions.items)) sessions.items = [];
  }
  return sessions;
}

function saveSessions(items) {
  sessions = { items: Array.isArray(items) ? items : [] };
  writeJSON('sessions.json', sessions);
  return sessions;
}

/* ------------------------------------------------------------------ */
/* Tajemství (hesla, passphrase) – šifrovaná klíčenkou plochy          */
/* ------------------------------------------------------------------ */

let secrets = null;
function loadSecrets() {
  if (!secrets) secrets = readJSON('secrets.json', {});
  return secrets;
}

function secretsAvailable() {
  try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

function setSecret(id, value) {
  const s = loadSecrets();
  if (value == null || value === '') { delete s[id]; }
  else if (secretsAvailable()) {
    s[id] = { enc: 'safeStorage', v: safeStorage.encryptString(String(value)).toString('base64') };
  } else {
    // Bez klíčenky raději nic neukládáme na disk v čitelné podobě.
    delete s[id];
    writeJSON('secrets.json', s);
    return false;
  }
  writeJSON('secrets.json', s);
  return true;
}

function getSecret(id) {
  const rec = loadSecrets()[id];
  if (!rec) return null;
  try {
    if (rec.enc === 'safeStorage') return safeStorage.decryptString(Buffer.from(rec.v, 'base64'));
  } catch (e) {
    console.error('[store] nelze dešifrovat tajemství', id, e.message);
  }
  return null;
}

function deleteSecret(id) { setSecret(id, null); }

/* ------------------------------------------------------------------ */
/* Stav oken / relací pro obnovu                                       */
/* ------------------------------------------------------------------ */

function getState() { return readJSON('state.json', { tabs: [] }); }
function saveState(state) { writeJSON('state.json', state || { tabs: [] }); }

module.exports = {
  configDir, getSettings, saveSettings, flushSettings, resetSettings,
  getSessions, saveSessions,
  setSecret, getSecret, deleteSecret, secretsAvailable,
  getState, saveState
};
