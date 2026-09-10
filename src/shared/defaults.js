'use strict';
/**
 * Jediný zdroj pravdy pro uživatelské nastavení.
 * DEFAULTS drží výchozí hodnoty, SCHEMA popisuje, jak se má nastavení vykreslit
 * v dialogu (renderer si dialog generuje z tohoto popisu, nic se nedubluje).
 */

const DEFAULTS = {
  terminal: {
    fontFamily: 'JetBrains Mono, Fira Code, DejaVu Sans Mono, Consolas, monospace',
    fontSize: 14,
    lineHeight: 1.15,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 10000,
    scrollSensitivity: 3,
    copyOnSelect: true,
    rightClick: 'paste',
    middleClickPaste: true,
    confirmPasteMultiline: true,
    wordSeparators: ' ()[]{}\'",;:│`',
    bell: 'none'
  },
  appearance: {
    theme: 'moba-dark',
    sidebarWidth: 260,
    showStatusBar: true,
    showToolbar: true,
    tabIcons: true,
    nativeFrame: false
  },
  behavior: {
    defaultShell: '',
    startupTab: 'local',
    confirmOnQuit: true,
    confirmOnCloseTab: false,
    restoreTabs: true,
    zoomStep: 1
  },
  ssh: {
    keepaliveInterval: 20,
    keepaliveCountMax: 6,
    connectTimeout: 20,
    agentForward: false,
    injectOsc7: true,
    termType: 'xterm-256color'
  },
  files: {
    showHidden: false,
    followTerminalCwd: true,
    defaultLocalDir: '',
    editorCommand: '',
    confirmDelete: true,
    confirmOverwrite: true
  },
  window: { width: 1360, height: 860, x: null, y: null, maximized: false }
};

const SCHEMA = [
  {
    id: 'terminal', title: 'Terminál', icon: 'terminal',
    fields: [
      { key: 'terminal.fontFamily', label: 'Font', type: 'text', hint: 'CSS seznam fontů, první dostupný vyhraje' },
      { key: 'terminal.fontSize', label: 'Velikost písma', type: 'number', min: 6, max: 40, step: 1 },
      { key: 'terminal.lineHeight', label: 'Výška řádku', type: 'number', min: 0.8, max: 2.5, step: 0.05 },
      { key: 'terminal.letterSpacing', label: 'Prostrkání', type: 'number', min: -2, max: 6, step: 0.5 },
      { key: 'terminal.cursorStyle', label: 'Kurzor', type: 'select', options: [['block','Blok'],['bar','Svislice'],['underline','Podtržítko']] },
      { key: 'terminal.cursorBlink', label: 'Blikající kurzor', type: 'bool' },
      { key: 'terminal.scrollback', label: 'Historie (řádků)', type: 'number', min: 100, max: 500000, step: 500 },
      { key: 'terminal.scrollSensitivity', label: 'Citlivost kolečka', type: 'number', min: 1, max: 20, step: 1 },
      { key: 'terminal.bell', label: 'Zvonek', type: 'select', options: [['none','Vypnuto'],['visual','Vizuální']] }
    ]
  },
  {
    id: 'mouse', title: 'Myš a schránka', icon: 'mouse',
    fields: [
      { key: 'terminal.copyOnSelect', label: 'Označení myší = kopírovat', type: 'bool', hint: 'Chování jako v MobaXtermu / PuTTY' },
      { key: 'terminal.rightClick', label: 'Pravé tlačítko', type: 'select', options: [['paste','Vložit ze schránky'],['menu','Kontextové menu'],['copypaste','Kopírovat výběr, jinak vložit']] },
      { key: 'terminal.middleClickPaste', label: 'Prostřední tlačítko vkládá primární výběr', type: 'bool' },
      { key: 'terminal.confirmPasteMultiline', label: 'Potvrdit vložení víceřádkového textu', type: 'bool' },
      { key: 'terminal.wordSeparators', label: 'Oddělovače slov (dvojklik)', type: 'text' }
    ]
  },
  {
    id: 'appearance', title: 'Vzhled', icon: 'palette',
    fields: [
      { key: 'appearance.theme', label: 'Motiv', type: 'theme' },
      { key: 'appearance.showToolbar', label: 'Zobrazit nástrojovou lištu', type: 'bool' },
      { key: 'appearance.showStatusBar', label: 'Zobrazit stavový řádek', type: 'bool' },
      { key: 'appearance.tabIcons', label: 'Ikony v tabech', type: 'bool' },
      { key: 'appearance.nativeFrame', label: 'Systémový rámeček okna', type: 'bool', hint: 'Místo vlastního titulku použije dekorace KDE (vyžaduje restart)' }
    ]
  },
  {
    id: 'behavior', title: 'Chování', icon: 'sliders',
    fields: [
      { key: 'behavior.defaultShell', label: 'Výchozí shell', type: 'text', hint: 'Prázdné = $SHELL' },
      { key: 'behavior.startupTab', label: 'Po startu otevřít', type: 'select', options: [['local','Lokální terminál'],['none','Nic']] },
      { key: 'behavior.restoreTabs', label: 'Obnovit taby po startu', type: 'bool', hint: 'Znovu otevře uložené relace, které běžely při ukončení' },
      { key: 'behavior.confirmOnQuit', label: 'Potvrdit ukončení při aktivních relacích', type: 'bool' },
      { key: 'behavior.confirmOnCloseTab', label: 'Potvrdit zavření tabu', type: 'bool' }
    ]
  },
  {
    id: 'ssh', title: 'SSH', icon: 'key',
    fields: [
      { key: 'ssh.termType', label: 'TERM', type: 'text' },
      { key: 'ssh.keepaliveInterval', label: 'Keepalive interval (s)', type: 'number', min: 0, max: 600, step: 5 },
      { key: 'ssh.keepaliveCountMax', label: 'Keepalive max. pokusů', type: 'number', min: 1, max: 50, step: 1 },
      { key: 'ssh.connectTimeout', label: 'Timeout připojení (s)', type: 'number', min: 5, max: 300, step: 5 },
      { key: 'ssh.agentForward', label: 'Forwardovat SSH agenta', type: 'bool' },
      { key: 'ssh.injectOsc7', label: 'Sledovat pracovní adresář (OSC 7)', type: 'bool', hint: 'Po přihlášení nastaví hook, aby panel souborů následoval `cd` v terminálu' }
    ]
  },
  {
    id: 'files', title: 'Soubory', icon: 'folder',
    fields: [
      { key: 'files.showHidden', label: 'Zobrazit skryté soubory', type: 'bool' },
      { key: 'files.followTerminalCwd', label: 'Strom následuje adresář terminálu', type: 'bool' },
      { key: 'files.defaultLocalDir', label: 'Výchozí lokální adresář', type: 'text', hint: 'Prázdné = domovský adresář' },
      { key: 'files.editorCommand', label: 'Externí editor', type: 'text', hint: 'Prázdné = systémový výchozí (xdg-open)' },
      { key: 'files.confirmDelete', label: 'Potvrdit mazání', type: 'bool' },
      { key: 'files.confirmOverwrite', label: 'Potvrdit přepis při přenosu', type: 'bool' }
    ]
  }
];

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = Array.isArray(base) ? [] : Object.assign({}, base);
  for (const k of Object.keys(patch)) {
    const b = base && typeof base === 'object' ? base[k] : undefined;
    const p = patch[k];
    out[k] = (p && typeof p === 'object' && !Array.isArray(p) && b && typeof b === 'object')
      ? deepMerge(b, p) : p;
  }
  return out;
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

module.exports = { DEFAULTS, SCHEMA, deepMerge, getPath, setPath };
