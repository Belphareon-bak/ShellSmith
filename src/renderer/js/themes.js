/**
 * Motivy. Každý motiv nese dvě části:
 *  - `ui`   proměnné pro rozhraní aplikace (CSS custom properties)
 *  - `term` paletu pro xterm.js
 */

const ANSI_CLASSIC = {
  black: '#2e3436', red: '#cc0000', green: '#4e9a06', yellow: '#c4a000',
  blue: '#3465a4', magenta: '#75507b', cyan: '#06989a', white: '#d3d7cf',
  brightBlack: '#555753', brightRed: '#ef2929', brightGreen: '#8ae234', brightYellow: '#fce94f',
  brightBlue: '#729fcf', brightMagenta: '#ad7fa8', brightCyan: '#34e2e2', brightWhite: '#eeeeec'
};

export const THEMES = {
  /* ---------------------------------------------------------------- */
  'moba-dark': {
    name: 'MobaXterm Dark',
    dark: true,
    description: 'Tmavé rozhraní s černým terminálem – domácí prostředí pro každého, kdo přišel z MobaXtermu.',
    ui: {
      '--bg': '#1e1e1e',
      '--bg-2': '#181818',
      '--panel': '#252526',
      '--panel-2': '#2d2d30',
      '--titlebar': '#2d2d30',
      '--tabbar': '#252526',
      '--border': '#3f3f46',
      '--border-soft': '#333337',
      '--text': '#d4d4d4',
      '--text-dim': '#9b9b9b',
      '--text-faint': '#6e6e6e',
      '--accent': '#3d94d6',
      '--accent-2': '#5aa9e6',
      '--accent-fg': '#ffffff',
      '--hover': '#2a2d2e',
      '--sel': '#094771',
      '--sel-fg': '#ffffff',
      '--danger': '#e05252',
      '--ok': '#5db85d',
      '--warn': '#d9a441',
      '--tab-active': '#1e1e1e',
      '--tab-inactive': '#2d2d30',
      '--scroll': '#4a4a4f',
      '--shadow': 'rgba(0,0,0,.55)'
    },
    term: Object.assign({}, ANSI_CLASSIC, {
      background: '#000000',
      foreground: '#cccccc',
      cursor: '#4ee44e',
      cursorAccent: '#000000',
      selectionBackground: '#3d5a80',
      selectionForeground: '#ffffff'
    })
  },

  /* ---------------------------------------------------------------- */
  'moba-classic': {
    name: 'MobaXterm Classic',
    dark: false,
    description: 'Světlé rozhraní a černý terminál – vzhled MobaXtermu hned po instalaci.',
    ui: {
      '--bg': '#f0f0f0',
      '--bg-2': '#e4e4e4',
      '--panel': '#f7f7f7',
      '--panel-2': '#e9e9e9',
      '--titlebar': '#dfe4ea',
      '--tabbar': '#e9edf1',
      '--border': '#bcc2c9',
      '--border-soft': '#d3d8dd',
      '--text': '#1f2328',
      '--text-dim': '#5a6068',
      '--text-faint': '#8b9098',
      '--accent': '#1f6fb2',
      '--accent-2': '#2b86d3',
      '--accent-fg': '#ffffff',
      '--hover': '#dce6f0',
      '--sel': '#cfe3f7',
      '--sel-fg': '#0d2c46',
      '--danger': '#c33',
      '--ok': '#2e7d32',
      '--warn': '#b8860b',
      '--tab-active': '#ffffff',
      '--tab-inactive': '#dde3e9',
      '--scroll': '#b4bcc4',
      '--shadow': 'rgba(0,0,0,.25)'
    },
    term: Object.assign({}, ANSI_CLASSIC, {
      background: '#000000',
      foreground: '#cccccc',
      cursor: '#4ee44e',
      cursorAccent: '#000000',
      selectionBackground: '#3d5a80',
      selectionForeground: '#ffffff'
    })
  },

  /* ---------------------------------------------------------------- */
  'ss-nocturne': {
    name: 'ShellSmith Nocturne',
    dark: true,
    description: 'Vlastní návrh: chladná modrošedá plocha, tyrkysový akcent a terminál laděný na dlouhé čtení.',
    ui: {
      '--bg': '#0f141a',
      '--bg-2': '#0b1015',
      '--panel': '#141b23',
      '--panel-2': '#1a232d',
      '--titlebar': '#121922',
      '--tabbar': '#111821',
      '--border': '#243140',
      '--border-soft': '#1b2530',
      '--text': '#c8d3e0',
      '--text-dim': '#8a99ab',
      '--text-faint': '#5e6b7a',
      '--accent': '#4fd6be',
      '--accent-2': '#7ae3d0',
      '--accent-fg': '#06231e',
      '--hover': '#1c2733',
      '--sel': '#1f3b4d',
      '--sel-fg': '#dff5ff',
      '--danger': '#ff6b73',
      '--ok': '#63d68a',
      '--warn': '#f2c14e',
      '--tab-active': '#0f141a',
      '--tab-inactive': '#161f29',
      '--scroll': '#2c3b4c',
      '--shadow': 'rgba(0,0,0,.6)'
    },
    term: {
      background: '#0f141a',
      foreground: '#c8d3e0',
      cursor: '#4fd6be',
      cursorAccent: '#0f141a',
      selectionBackground: '#27455a',
      selectionForeground: '#eaf6ff',
      black: '#1b232c', red: '#ff6b73', green: '#63d68a', yellow: '#f2c14e',
      blue: '#5fa8ff', magenta: '#c58cf5', cyan: '#4fd6be', white: '#c8d3e0',
      brightBlack: '#4c5a68', brightRed: '#ff9ba1', brightGreen: '#8fe6ac', brightYellow: '#ffd97a',
      brightBlue: '#8fc4ff', brightMagenta: '#dcb1ff', brightCyan: '#83ecd9', brightWhite: '#eef4fb'
    }
  },

  /* ---------------------------------------------------------------- */
  'ss-daylight': {
    name: 'ShellSmith Daylight',
    dark: false,
    description: 'Vlastní světlý návrh pro práci za dne – teplý papírový podklad, tmavý text, stejný akcent.',
    ui: {
      '--bg': '#f6f4ef',
      '--bg-2': '#ece9e2',
      '--panel': '#fbfaf7',
      '--panel-2': '#eeebe4',
      '--titlebar': '#e8e4db',
      '--tabbar': '#efece5',
      '--border': '#cfc9bd',
      '--border-soft': '#dfdad0',
      '--text': '#2b2a26',
      '--text-dim': '#61605a',
      '--text-faint': '#8d8c85',
      '--accent': '#0f7a68',
      '--accent-2': '#149484',
      '--accent-fg': '#ffffff',
      '--hover': '#e3ded3',
      '--sel': '#cfe7e1',
      '--sel-fg': '#0c2c27',
      '--danger': '#b3261e',
      '--ok': '#2f6f43',
      '--warn': '#96601a',
      '--tab-active': '#fbfaf7',
      '--tab-inactive': '#e3dfd6',
      '--scroll': '#c3bdb1',
      '--shadow': 'rgba(0,0,0,.2)'
    },
    term: {
      background: '#fbfaf7',
      foreground: '#2b2a26',
      cursor: '#0f7a68',
      cursorAccent: '#fbfaf7',
      selectionBackground: '#cfe7e1',
      selectionForeground: '#0c2c27',
      black: '#3b3a35', red: '#b3261e', green: '#2f6f43', yellow: '#96601a',
      blue: '#1c5c9e', magenta: '#7a3e9d', cyan: '#0f7a68', white: '#d9d5cb',
      brightBlack: '#6b6a63', brightRed: '#d2453b', brightGreen: '#3f8a56', brightYellow: '#b57a28',
      brightBlue: '#2f76c0', brightMagenta: '#9455bb', brightCyan: '#199985', brightWhite: '#ffffff'
    }
  }
};

export function themeList() {
  return Object.entries(THEMES).map(([id, t]) => ({ id, name: t.name, dark: t.dark, description: t.description }));
}

/** Motivy se kdysi jmenovaly jinak; uložené nastavení tím nemá trpět. */
const LEGACY_THEMES = { 'c3-nocturne': 'ss-nocturne', 'c3-daylight': 'ss-daylight' };
export const resolveTheme = (id) => LEGACY_THEMES[id] || id;

export function applyTheme(rawId) {
  const id = resolveTheme(rawId);
  const theme = THEMES[id] || THEMES['moba-dark'];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.ui)) root.style.setProperty(k, v);
  root.dataset.theme = id;
  root.dataset.dark = String(!!theme.dark);
  return theme;
}

export function termTheme(rawId) {
  return (THEMES[resolveTheme(rawId)] || THEMES['moba-dark']).term;
}
