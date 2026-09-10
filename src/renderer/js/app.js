import '@xterm/xterm/css/xterm.css';
import '../styles/app.css';

import defaults from '../../shared/defaults.js';
import { el, $, contextMenu, modal, confirmDialog, toast, formatSize, formatSpeed, closeContextMenu } from './ui.js';
import { icon } from './icons.js';
import { applyTheme, THEMES } from './themes.js';
import { TerminalPane } from './terminal.js';
import { Tab, TabManager } from './tabs.js';
import { FileTree } from './files.js';
import { SessionManagerPanel } from './sessionmgr.js';
import { openSettings } from './settingsdlg.js';

const { getPath, setPath, deepMerge } = defaults;

class App {
  constructor() {
    this.settings = null;
    this.sessionPanes = new Map();   // sessionId -> TerminalPane
    this.activePane = null;
    this.transfers = new Map();
    this.fontSize = 14;
    this.sidebarTab = 'sessions';
    this.localPaneIsSecondary = false;
    this.info = null;
  }

  /* ================================================================ */
  /* Start                                                            */
  /* ================================================================ */

  async boot() {
    this.settings = await window.smith.settings.get();
    this.info = await window.smith.app.info();
    this.fontSize = this.settings.terminal.fontSize;
    applyTheme(this.settings.appearance.theme);

    this.buildChrome();
    this.wireEvents();
    this.wireShortcuts();

    this.sessions = new SessionManagerPanel(this);
    $('#panel-sessions').append(this.sessions.root_el);
    await this.sessions.load();

    this.remoteTree = new FileTree(this, { target: 'local', label: 'lokální' });
    this.localTree = new FileTree(this, { target: 'local', label: `${this.info.hostname} (lokální)` });
    $('#files-primary').append(this.remoteTree.root_el);
    $('#files-secondary').append(this.localTree.root_el);
    await this.remoteTree.goHome();

    this.applyChromeSettings();
    await this.restoreOrStart();
    this.updateStatusBar();
  }

  /* ================================================================ */
  /* Rám aplikace                                                     */
  /* ================================================================ */

  buildChrome() {
    /* --- horní lišta ------------------------------------------------ */
    const menubar = $('#menubar');
    const menus = [
      ['Relace', () => this.menuSession()],
      ['Zobrazení', () => this.menuView()],
      ['Terminál', () => this.menuTerminal()],
      ['Nápověda', () => this.menuHelp()]
    ];
    for (const [label, builder] of menus) {
      const btn = el('button', { class: 'menu-btn', text: label });
      btn.addEventListener('click', () => {
        const r = btn.getBoundingClientRect();
        contextMenu(r.left, r.bottom + 2, builder());
      });
      menubar.append(btn);
    }

    $('#win-min').addEventListener('click', () => window.smith.win.minimize());
    $('#win-max').addEventListener('click', () => window.smith.win.toggleMaximize());
    $('#win-close').addEventListener('click', () => this.quit());
    $('#titlebar').addEventListener('dblclick', (e) => {
      if (e.target.closest('.no-drag')) return;
      window.smith.win.toggleMaximize();
    });
    window.smith.win.onState(({ maximized }) => {
      $('#win-max').innerHTML = icon(maximized ? 'restore' : 'maximize', 14);
    });

    /* --- nástrojová lišta ------------------------------------------- */
    const tb = $('#toolbar');
    const tool = (ico, label, title, fn, cls = '') => el('button', {
      class: `tool ${cls}`.trim(), title, onClick: fn
    }, el('span', { html: icon(ico, 16) }), el('span', { class: 'tool-label', text: label }));

    tb.append(
      tool('plus', 'Nová relace', 'Vytvořit uloženou relaci (Ctrl+Shift+N)', () => this.sessions.editSession(null)),
      tool('terminal', 'Lokální', 'Nový lokální terminál (Ctrl+Shift+T)', () => this.newLocalTab()),
      el('div', { class: 'tool-sep' }),
      tool('splitV', 'Rozdělit', 'Rozdělit svisle – s výběrem, co se v panelu zobrazí', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this.showSplitPicker('v', r.left, r.bottom + 2);
      }),
      tool('splitH', '', 'Rozdělit vodorovně – s výběrem, co se v panelu zobrazí', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this.showSplitPicker('h', r.left, r.bottom + 2);
      }, 'icon-only'),
      el('div', { class: 'tool-sep' }),
      tool('search', '', 'Hledat v terminálu (Ctrl+Shift+F)', () => this.activePane && this.activePane.toggleSearch(true), 'icon-only'),
      tool('upload', '', 'Nahrát soubory na server', () => this.remoteTree.uploadDialog(), 'icon-only'),
      tool('download', '', 'Stáhnout vybrané', () => this.remoteTree.downloadDialog(), 'icon-only'),
      el('div', { class: 'tool-grow' }),
      tool('settings', '', 'Nastavení (Ctrl+,)', () => openSettings(this), 'icon-only')
    );

    /* --- postranní lišta -------------------------------------------- */
    const rail = $('#siderail');
    for (const [id, ico, label] of [['sessions', 'server', 'Relace'], ['files', 'folder', 'Soubory']]) {
      const b = el('button', {
        class: `rail-btn ${id === this.sidebarTab ? 'active' : ''}`, dataset: { id },
        title: label, onClick: () => this.selectSidebar(id)
      }, el('span', { html: icon(ico, 18) }), el('span', { class: 'rail-label', text: label }));
      rail.append(b);
    }

    $('#files-split-toggle').addEventListener('click', () => this.toggleLocalPane());

    /* --- taby ------------------------------------------------------- */
    this.tabs = new TabManager(this, $('#tabbar'), $('#tabhost'));
    this.tabs.strip = $('#tabstrip');
    $('#newtab').addEventListener('click', () => this.newLocalTab());
    $('#newtab').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, this.menuSession());
    });

    /* --- šířka postranního panelu ------------------------------------ */
    const grip = $('#sideresize');
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.body.classList.add('resizing-x');
      const startX = e.clientX;
      const startW = $('#sidebar').getBoundingClientRect().width;
      const move = (ev) => {
        const w = Math.min(700, Math.max(180, startW + ev.clientX - startX));
        document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing-x');
        const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10);
        this.updateSettings({ appearance: { sidebarWidth: w } });
        for (const p of this.tabs.allPanes()) p.scheduleFit();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    /* --- výška lokálního panelu -------------------------------------- */
    const fgrip = $('#files-resize');
    fgrip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.body.classList.add('resizing-y');
      const host = $('#panel-files');
      const rect = host.getBoundingClientRect();
      const move = (ev) => {
        const ratio = Math.min(0.85, Math.max(0.15, (ev.clientY - rect.top) / rect.height));
        document.documentElement.style.setProperty('--files-split', String(ratio));
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing-y');
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  applyChromeSettings() {
    const a = this.settings.appearance;
    document.documentElement.style.setProperty('--sidebar-w', `${a.sidebarWidth}px`);
    $('#toolbar').hidden = !a.showToolbar;
    $('#statusbar').hidden = !a.showStatusBar;
    $('#titlebar').hidden = !!a.nativeFrame;
    document.body.classList.toggle('native-frame', !!a.nativeFrame);
  }

  selectSidebar(id) {
    if (this.sidebarTab === id && !document.body.classList.contains('sidebar-collapsed')) {
      document.body.classList.add('sidebar-collapsed');
    } else {
      document.body.classList.remove('sidebar-collapsed');
      this.sidebarTab = id;
      for (const b of $('#siderail').children) b.classList.toggle('active', b.dataset.id === id);
      $('#panel-sessions').hidden = id !== 'sessions';
      $('#panel-files').hidden = id !== 'files';
    }
    for (const p of this.tabs.allPanes()) p.scheduleFit();
  }

  toggleLocalPane() {
    this.localPaneIsSecondary = !this.localPaneIsSecondary;
    document.body.classList.toggle('files-split', this.localPaneIsSecondary);
    $('#files-split-toggle').classList.toggle('on', this.localPaneIsSecondary);
    if (this.localPaneIsSecondary && !this.localTree.root) this.localTree.goHome();
  }

  /* ================================================================ */
  /* Menu                                                             */
  /* ================================================================ */

  menuSession() {
    const saved = this.sessions.items.slice(0, 12);
    return [
      { label: 'Nový lokální terminál', icon: 'terminal', accel: 'Ctrl+Shift+T', action: () => this.newLocalTab() },
      { label: 'Nová uložená relace…', icon: 'plus', accel: 'Ctrl+Shift+N', action: () => this.sessions.editSession(null) },
      { separator: true },
      ...saved.map((s) => ({
        label: s.name, icon: s.kind === 'local' ? 'terminal' : 'server', action: () => this.connectSaved(s)
      })),
      saved.length ? { separator: true } : null,
      { label: 'Duplikovat aktuální relaci', icon: 'copy', disabled: !this.tabs.active, action: () => this.duplicateTab(this.tabs.active) },
      { label: 'Znovu připojit', icon: 'refresh', disabled: !this.activePane, action: () => this.activePane.reconnect() },
      { separator: true },
      { label: 'Zavřít tab', icon: 'close', accel: 'Ctrl+Shift+W', disabled: !this.tabs.active, action: () => this.tabs.closeTab(this.tabs.active) },
      { label: 'Ukončit', danger: true, action: () => this.quit() }
    ].filter(Boolean);
  }

  menuView() {
    const s = this.settings;
    return [
      { label: 'Panel relací', icon: 'server', checked: this.sidebarTab === 'sessions', action: () => this.selectSidebar('sessions') },
      { label: 'Panel souborů', icon: 'folder', checked: this.sidebarTab === 'files', action: () => this.selectSidebar('files') },
      { label: 'Skrýt/zobrazit postranní panel', accel: 'Ctrl+B', action: () => document.body.classList.toggle('sidebar-collapsed') },
      { label: 'Lokální panel souborů', checked: this.localPaneIsSecondary, action: () => this.toggleLocalPane() },
      { separator: true },
      { label: 'Nástrojová lišta', checked: s.appearance.showToolbar, action: () => this.updateSettings({ appearance: { showToolbar: !s.appearance.showToolbar } }) },
      { label: 'Stavový řádek', checked: s.appearance.showStatusBar, action: () => this.updateSettings({ appearance: { showStatusBar: !s.appearance.showStatusBar } }) },
      { separator: true },
      { label: 'Zvětšit písmo', accel: 'Ctrl++', action: () => this.zoom(1) },
      { label: 'Zmenšit písmo', accel: 'Ctrl+-', action: () => this.zoom(-1) },
      { label: 'Původní velikost', accel: 'Ctrl+0', action: () => this.zoom(0) },
      { separator: true },
      ...Object.entries(THEMES).map(([id, t]) => ({
        label: t.name, checked: s.appearance.theme === id, action: () => this.setSetting('appearance.theme', id)
      }))
    ];
  }

  menuTerminal() {
    const p = this.activePane;
    return [
      { label: 'Kopírovat', icon: 'copy', accel: 'Ctrl+Shift+C', disabled: !p || !p.hasSelection(), action: () => window.smith.clipboard.write(p.selection()) },
      { label: 'Vložit', icon: 'clipboard', accel: 'Ctrl+Shift+V', disabled: !p, action: () => p.pasteFromClipboard() },
      { label: 'Hledat…', icon: 'search', accel: 'Ctrl+Shift+F', disabled: !p, action: () => p.toggleSearch(true) },
      { separator: true },
      { label: 'Rozdělit svisle…', icon: 'splitV', accel: 'Ctrl+Shift+E', disabled: !p, action: () => this.showSplitPicker('v') },
      { label: 'Rozdělit vodorovně…', icon: 'splitH', accel: 'Ctrl+Shift+O', disabled: !p, action: () => this.showSplitPicker('h') },
      { label: 'Zvolit obsah panelu…', icon: 'layers', disabled: !p, action: () => this.showPaneChooser(p) },
      { label: 'Zavřít panel', icon: 'close', accel: 'Ctrl+Shift+W', disabled: !p, action: () => this.closePane(p) },
      { separator: true },
      { label: 'Vymazat obrazovku', icon: 'refresh', disabled: !p, action: () => p.term.clear() },
      { label: 'Nastavení terminálu…', icon: 'settings', action: () => openSettings(this, 'terminal') }
    ];
  }

  menuHelp() {
    return [
      { label: 'Klávesové zkratky', icon: 'bolt', action: () => this.showShortcuts() },
      { label: 'Složka s nastavením', icon: 'folder', action: async () => {
          const dir = await window.smith.settings.configDir();
          window.smith.clipboard.write(dir);
          toast(`Cesta zkopírována: ${dir}`, { type: 'ok' });
        } },
      { separator: true },
      { label: 'O aplikaci', icon: 'server', action: () => this.showAbout() }
    ];
  }

  showShortcuts() {
    const rows = [
      ['Ctrl+Shift+T', 'Nový lokální terminál'],
      ['Ctrl+Shift+N', 'Nová uložená relace'],
      ['Ctrl+Shift+W', 'Zavřít panel (poslední panel zavře tab)'],
      ['Ctrl+Shift+Q', 'Zavřít celý tab'],
      ['Ctrl+Tab / Ctrl+Shift+Tab', 'Další / předchozí tab'],
      ['Alt+1 … Alt+9', 'Přepnout na tab podle čísla'],
      ['Ctrl+Shift+E / Ctrl+Shift+O', 'Rozdělit svisle / vodorovně (s výběrem relace)'],
      ['Ctrl+Shift+C / Ctrl+Shift+V', 'Kopírovat / vložit'],
      ['Označení myší', 'Kopírovat do schránky'],
      ['Pravé tlačítko', 'Vložit ze schránky'],
      ['Prostřední tlačítko', 'Vložit primární výběr'],
      ['Ctrl+Shift+F', 'Hledat v terminálu'],
      ['Ctrl + kolečko', 'Zvětšit / zmenšit písmo'],
      ['Ctrl+B', 'Skrýt postranní panel'],
      ['Ctrl+,', 'Nastavení'],
      ['F5 (panel souborů)', 'Obnovit'],
      ['F2 / Delete (panel souborů)', 'Přejmenovat / smazat']
    ];
    const body = el('div', { class: 'shortcuts' },
      ...rows.map(([k, d]) => el('div', { class: 'sc-row' },
        el('kbd', { text: k }), el('span', { text: d }))));
    modal({ title: 'Klávesové zkratky', icon: 'bolt', width: 560, body, buttons: [{ id: 'ok', label: 'Zavřít', primary: true }] });
  }

  async showAbout() {
    const i = await window.smith.app.info();
    const body = el('div', { class: 'about' },
      el('div', { class: 'about-logo', html: icon('terminal', 40) }),
      el('h2', { text: 'ShellSmith' }),
      el('p', { class: 'muted', text: `Verze ${i.version}` }),
      el('p', { text: 'SSH a SFTP klient s adresářovým stromem, taby a rozdělenými panely.' }),
      el('dl', { class: 'about-list' },
        el('dt', { text: 'Electron' }), el('dd', { text: i.electron }),
        el('dt', { text: 'Chromium' }), el('dd', { text: i.chrome }),
        el('dt', { text: 'Node' }), el('dd', { text: i.node }),
        el('dt', { text: 'Systém' }), el('dd', { text: i.platform }),
        el('dt', { text: 'Nastavení' }), el('dd', { text: i.configDir })
      ));
    modal({ title: 'O aplikaci', width: 480, body, buttons: [{ id: 'ok', label: 'Zavřít', primary: true }] });
  }

  /* ================================================================ */
  /* Relace a taby                                                    */
  /* ================================================================ */

  async newLocalTab(opts = {}) {
    const pane = new TerminalPane(this, Object.assign({ kind: 'local' }, opts));
    const tab = new Tab(this.tabs, pane);
    this.tabs.add(tab);
    await pane.start();
    this.setActivePane(pane);
    this.persistState();
    return tab;
  }

  /** Uložená relace → parametry pro nový panel. */
  paneOptsFor(cfg) {
    return cfg.kind === 'local'
      ? { kind: 'local', shell: cfg.shell, cwd: cfg.cwd, title: cfg.name, sessionRef: cfg.id, initialCommand: cfg.initialCommand }
      : {
          kind: 'ssh', host: cfg.host, port: cfg.port, username: cfg.username,
          authType: cfg.authType, keyPath: cfg.keyPath, proxyJump: cfg.proxyJump || null,
          title: cfg.name, sessionRef: cfg.id, initialCommand: cfg.initialCommand
        };
  }

  async connectSaved(cfg, opts = {}) {
    const paneOpts = this.paneOptsFor(cfg);

    const pane = new TerminalPane(this, paneOpts);
    if (opts.split && this.tabs.active) {
      this.tabs.active.splitPane(this.tabs.active.activePane, opts.split, pane);
      await pane.start();
    } else {
      const tab = new Tab(this.tabs, pane);
      this.tabs.add(tab);
      await pane.start();
    }
    this.setActivePane(pane);
    this.persistState();
    return pane;
  }

  async duplicateTab(tab) {
    const p = tab.activePane || tab.panes()[0];
    if (!p) return;
    const clone = new TerminalPane(this, Object.assign({}, p.opts));
    const t = new Tab(this.tabs, clone);
    this.tabs.add(t);
    await clone.start();
    this.setActivePane(clone);
  }

  /** Rychlé rozdělení: zopakuje relaci z aktivního panelu (klávesová zkratka). */
  async splitActive(dir) {
    const src = this.activePane;
    if (!src) return;
    return this.splitWith(dir, Object.assign({}, src.opts, { cwd: src.cwd || src.opts.cwd }), src);
  }

  /** Rozdělí panel a do nové poloviny vloží relaci podle zadání. */
  async splitWith(dir, opts, targetPane) {
    const src = targetPane || this.activePane;
    const tab = this.tabs.tabOf(src);
    if (!tab) return;
    const pane = new TerminalPane(this, opts);
    tab.splitPane(src, dir, pane);
    await pane.start();
    this.setActivePane(pane);
    this.persistState();
    return pane;
  }

  /**
   * Nabídka „co dát do nové poloviny". Kromě nové relace umí i přesunout sem
   * terminál, který už běží v jiném tabu – kvůli tomu tahle nabídka vznikla.
   */
  showSplitPicker(dir, x, y) {
    const src = this.activePane;
    if (!src) return;
    const anchor = this.menuAnchor(x, y, src);
    const others = this.tabs.allPanes().filter((p) => p !== src);

    contextMenu(anchor.x, anchor.y, [
      { label: 'Nový lokální terminál', icon: 'terminal', action: () => this.splitWith(dir, { kind: 'local' }, src) },
      { label: `Zopakovat: ${src.title}`, icon: 'copy',
        action: () => this.splitWith(dir, Object.assign({}, src.opts, { cwd: src.cwd || src.opts.cwd }), src) },
      this.sessions.items.length ? { separator: true } : null,
      ...this.sessions.items.slice(0, 12).map((cfg) => ({
        label: cfg.name, icon: cfg.kind === 'local' ? 'terminal' : 'server',
        action: () => this.splitWith(dir, this.paneOptsFor(cfg), src)
      })),
      others.length ? { separator: true } : null,
      ...others.map((p) => ({
        label: `Přesunout sem: ${this.paneLabel(p)}`, icon: 'layers',
        action: () => this.movePaneIntoSplit(p, src, dir)
      }))
    ].filter(Boolean));
  }

  /** Nabídka na hlavičce panelu: prohodit, odpojit, znovu připojit, zavřít. */
  showPaneChooser(pane, x, y) {
    const a = this.menuAnchor(x, y, pane);
    x = a.x; y = a.y;
    const others = this.tabs.allPanes().filter((p) => p !== pane);
    const tab = this.tabs.tabOf(pane);
    const alone = !tab || tab.panes().length === 1;

    contextMenu(x, y, [
      ...others.map((p) => ({
        label: `Prohodit s: ${this.paneLabel(p)}`, icon: 'layers',
        action: () => this.swapPanes(pane, p)
      })),
      others.length ? { separator: true } : null,
      { label: 'Rozdělit vodorovně…', icon: 'splitH', action: () => this.showSplitPicker('h', x, y) },
      { label: 'Rozdělit svisle…', icon: 'splitV', action: () => this.showSplitPicker('v', x, y) },
      { label: 'Odpojit do vlastního tabu', icon: 'externalLink', disabled: alone, action: () => this.detachPane(pane) },
      { separator: true },
      { label: 'Znovu připojit', icon: 'refresh', action: () => pane.reconnect() },
      { label: 'Zavřít panel', icon: 'close', accel: 'Ctrl+Shift+W', danger: true, action: () => this.closePane(pane) }
    ].filter(Boolean));
  }

  paneLabel(pane) {
    const tab = this.tabs.tabOf(pane);
    const sameName = !tab || tab.title === pane.title;
    const where = tab && tab !== this.tabs.active && !sameName ? ` — ${tab.title}` : '';
    return `${pane.title}${where}`;
  }

  menuAnchor(x, y, pane) {
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    const r = pane.root.getBoundingClientRect();
    return { x: r.left + 12, y: r.top + 12 };
  }

  /** Přesune běžící panel z jeho tabu do nové poloviny cílového panelu. */
  async movePaneIntoSplit(moved, target, dir) {
    if (moved === target) return;
    const srcTab = this.tabs.tabOf(moved);
    const dstTab = this.tabs.tabOf(target);
    if (!srcTab || !dstTab) return;

    const orphan = srcTab.removePane(moved);
    dstTab.splitPane(target, dir, moved);
    if (orphan) await this.tabs.closeTab(srcTab, true);
    this.tabs.activate(dstTab);
    this.setActivePane(moved);
    this.persistState();
  }

  /** Prohodí obsah dvou panelů – i napříč taby. */
  swapPanes(a, b) {
    const ta = this.tabs.tabOf(a);
    const tb = this.tabs.tabOf(b);
    if (!ta || !tb || a === b) return;
    const la = ta.findLeaf(a);
    const lb = tb.findLeaf(b);
    if (!la || !lb) return;

    la.pane = b;
    lb.pane = a;
    ta.attachPane(b);
    tb.attachPane(a);
    if (ta.activePane === a) ta.activePane = b;
    if (tb.activePane === b) tb.activePane = a;
    ta.render();
    ta.updateLabel();
    if (tb !== ta) { tb.render(); tb.updateLabel(); }
    const current = this.tabs.active;
    if (current) this.setActivePane(current.activePane);
    this.persistState();
  }

  /** Vyjme panel z rozděleného tabu a udělá z něj samostatný tab. */
  detachPane(pane) {
    const tab = this.tabs.tabOf(pane);
    if (!tab || tab.panes().length === 1) return;
    tab.removePane(pane);
    const fresh = new Tab(this.tabs, pane);
    this.tabs.add(fresh);
    this.setActivePane(pane);
    this.persistState();
  }

  async closePane(pane) {
    const tab = this.tabs.tabs.find((t) => t.panes().includes(pane));
    if (!tab) return;
    if (tab.panes().length === 1) return this.tabs.closeTab(tab);
    const orphan = tab.removePane(pane);
    await pane.dispose();
    if (orphan) this.tabs.closeTab(tab, true);
    else this.setActivePane(tab.activePane);
  }

  setActivePane(pane) {
    if (!pane || this.activePane === pane) {
      if (pane) this.bindFilesTo(pane);
      return;
    }
    this.activePane = pane;
    for (const p of this.tabs.allPanes()) p.root.classList.toggle('focused', p === pane);
    const tab = this.tabs.tabs.find((t) => t.panes().includes(pane));
    if (tab) tab.activePane = pane;
    this.bindFilesTo(pane);
    this.updateStatusBar();
  }

  onPaneFocus(pane) { this.setActivePane(pane); }

  onTabActivated(tab) {
    const pane = tab.activePane || tab.panes()[0];
    if (pane) this.setActivePane(pane);
    this.persistState();
  }

  onNoTabs() {
    this.activePane = null;
    this.updateStatusBar();
    this.updateWindowTitle();
  }

  onPaneCwd(pane) {
    if (pane !== this.activePane) return;
    this.updateStatusBar();
    if (!this.settings.files.followTerminalCwd) return;
    if (this.remoteTree.target !== (pane.sessionId || 'local')) return;
    if (pane.cwd && pane.cwd !== this.remoteTree.root) this.remoteTree.navigate(pane.cwd);
  }

  /** Naváže hlavní panel souborů na relaci právě aktivního terminálu. */
  async bindFilesTo(pane) {
    if (!pane || !pane.sessionId || !pane.supportsFiles()) return;
    // Dokud relace není přihlášená, nemá smysl otevírat SFTP kanál.
    if (pane.status !== 'connected') return;
    const target = pane.sessionId;
    if (this.remoteTree.target === target && this.remoteTree.bound) return;
    this.remoteTree.target = target;
    this.remoteTree.bound = false;
    const isSsh = pane.opts.kind === 'ssh';
    this.remoteTree.setLabel(
      isSsh ? `${pane.opts.username ? pane.opts.username + '@' : ''}${pane.opts.host}` : `${this.info.hostname} (lokální)`,
      pane.title);
    this.remoteTree.nodes.clear();
    try {
      const start = pane.cwd || await window.smith.files.home(target);
      await this.remoteTree.navigate(start);
      this.remoteTree.bound = true;
    } catch (e) {
      this.remoteTree.bound = false;
      this.remoteTree.setStatus(`Souborový panel: ${e.message}`, true);
    }
  }

  targetKind(target) {
    if (target === 'local') return 'local';
    const pane = this.sessionPanes.get(target);
    return pane ? pane.opts.kind : 'local';
  }

  registerSession(pane) {
    // Uvítací příkaz posílá main proces, až doběhne start relace.
    this.sessionPanes.set(pane.sessionId, pane);
  }

  unregisterSession(id) { this.sessionPanes.delete(id); }

  typeInTerminal(text) {
    if (this.activePane && this.activePane.sessionId) {
      window.smith.term.write(this.activePane.sessionId, text);
      this.activePane.focus();
    }
  }

  /* ================================================================ */
  /* Události z main procesu                                          */
  /* ================================================================ */

  wireEvents() {
    window.smith.term.onData(({ id, data }) => {
      const p = this.sessionPanes.get(id);
      if (p) p.write(data);
    });
    window.smith.term.onStatus(({ id, status, detail }) => {
      const p = this.sessionPanes.get(id);
      if (!p) return;
      p.setStatus(status, detail);
      if (status === 'connected' && p === this.activePane) this.bindFilesTo(p);
    });
    window.smith.term.onCwd(({ id, cwd }) => {
      const p = this.sessionPanes.get(id);
      if (p) p.setCwd(cwd);
    });
    window.smith.term.onExit(({ id, code, error }) => {
      const p = this.sessionPanes.get(id);
      if (!p) return;
      p.setStatus('closed', error || null);
      p.showDisconnected(error || (code != null ? `Ukončeno s kódem ${code}` : 'Spojení uzavřeno'));
      this.sessionPanes.delete(id);
    });
    window.smith.term.onPrompt((req) => this.handlePrompt(req));

    window.smith.settings.onChange((s) => {
      this.settings = s;
      applyTheme(s.appearance.theme);
      this.applyChromeSettings();
      for (const p of this.tabs.allPanes()) p.applySettings(s);
      this.remoteTree.render();
      this.localTree.render();
    });

    window.smith.files.onProgress((s) => this.updateTransfer(s));
    window.smith.files.onFinish((s) => this.finishTransfer(s));
    window.smith.files.onAsk((q) => this.handleConflict(q));
    window.smith.files.onWarn((w) => toast(w.message, { type: 'error' }));
    window.smith.files.onUploaded(({ path }) => toast(`Uloženo na server: ${path}`, { type: 'ok' }));

    window.smith.app.onCommand((cmd) => this.runCommand(cmd));

    window.addEventListener('beforeunload', () => this.persistState());
    window.addEventListener('resize', () => {
      for (const p of this.tabs.allPanes()) p.scheduleFit();
    });
    window.addEventListener('blur', () => closeContextMenu());

    // Přetažení odkudkoli mimo panely nemá spouštět navigaci prohlížeče.
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
  }

  /* ---------------- dotazy SSH (heslo, 2FA, host key) -------------- */

  async handlePrompt(req) {
    const { id, promptId } = req;
    if (req.type === 'hostkey') {
      const body = el('div', {},
        el('p', { class: 'modal-message', text: req.changed
          ? 'Otisk klíče serveru neodpovídá tomu, který máte uložený. Může jít o legitimní změnu na serveru – nebo o pokus o podvržení spojení.'
          : 'K tomuto serveru se připojujete poprvé. Ověřte prosím otisk klíče.' }),
        el('dl', { class: 'about-list' },
          el('dt', { text: 'Server' }), el('dd', { text: req.host }),
          el('dt', { text: 'Otisk' }), el('dd', { class: 'mono', text: req.fingerprint }),
          ...(req.previous ? [el('dt', { text: 'Uložený' }), el('dd', { class: 'mono', text: req.previous })] : [])
        ));
      const res = await modal({
        title: req.title, icon: 'alert', width: 560, body, dismissable: false,
        buttons: [
          { id: 'reject', label: 'Odmítnout' },
          { id: 'once', label: 'Jen tentokrát' },
          { id: 'accept', label: req.changed ? 'Přepsat a pokračovat' : 'Přijmout a uložit', primary: true, danger: req.changed }
        ]
      });
      return window.smith.term.promptReply(id, promptId, { decision: res || 'reject' });
    }

    const inputs = req.prompts.map((p) => el('input', {
      class: 'input', type: p.echo ? 'text' : 'password', autocomplete: 'off'
    }));
    const remember = el('input', { type: 'checkbox' });
    const body = el('div', { class: 'form' },
      req.detail ? el('p', { class: 'modal-detail', text: req.detail }) : null,
      ...req.prompts.map((p, i) => el('label', { class: 'field' },
        el('span', { class: 'field-label', text: p.prompt.replace(/:\s*$/, '') }), inputs[i])),
      req.allowRemember ? el('label', { class: 'check-row' }, remember,
        el('span', { text: 'Zapamatovat v klíčence systému' })) : null
    );
    const res = await modal({
      title: req.title, icon: 'lock', width: 460, body, dismissable: true,
      buttons: [{ id: 'cancel', label: 'Zrušit' }, { id: 'ok', label: 'Přihlásit', primary: true }]
    });
    window.smith.term.promptReply(id, promptId, res === 'ok'
      ? { answers: inputs.map((i) => i.value), remember: remember.checked, cancelled: false }
      : { cancelled: true, answers: [] });
  }

  /* ================================================================ */
  /* Přenosy souborů                                                  */
  /* ================================================================ */

  async startTransfer(req) {
    try {
      const res = await window.smith.files.transfer(req);
      if (res && res.renamed) {
        toast('Přesunuto', { type: 'ok' });
        return;
      }
      if (res && res.id) this.updateTransfer(res);
    } catch (e) {
      toast(`Přenos selhal: ${e.message}`, { type: 'error' });
    }
  }

  updateTransfer(s) {
    let rec = this.transfers.get(s.id);
    if (!rec) {
      const bar = el('div', { class: 'tr-bar' }, el('div', { class: 'tr-fill' }));
      const label = el('div', { class: 'tr-label' });
      const detail = el('div', { class: 'tr-detail' });
      const row = el('div', { class: 'tr-row' },
        el('span', { class: 'tr-ico', html: icon(s.move ? 'bolt' : 'upload', 15) }),
        el('div', { class: 'tr-main' }, label, bar, detail),
        el('button', { class: 'icon-btn', title: 'Zrušit', html: icon('close', 14), onClick: () => window.smith.files.cancel(s.id) })
      );
      rec = { row, bar: bar.firstChild, label, detail };
      this.transfers.set(s.id, rec);
      $('#transfers').append(row);
      document.body.classList.add('has-transfers');
    }
    const pct = s.bytesTotal ? Math.min(100, (s.bytesDone / s.bytesTotal) * 100) : (s.state === 'scanning' ? 0 : 100);
    rec.bar.style.width = `${pct}%`;
    rec.label.textContent = s.state === 'scanning'
      ? `${s.label} — zjišťuji obsah…`
      : `${s.label} — ${s.currentFile || ''}`;
    rec.detail.textContent = s.state === 'scanning'
      ? `${s.filesTotal} souborů`
      : `${s.filesDone}/${s.filesTotal} · ${formatSize(s.bytesDone)} / ${formatSize(s.bytesTotal)} · ${formatSpeed(s.speed)}`;
  }

  finishTransfer(s) {
    const rec = this.transfers.get(s.id);
    if (rec) {
      rec.row.remove();
      this.transfers.delete(s.id);
    }
    if (!this.transfers.size) document.body.classList.remove('has-transfers');
    if (s.state === 'error') toast(`Přenos selhal: ${s.error}`, { type: 'error' });
    else if (s.state === 'cancelled') toast('Přenos zrušen');
    else toast(`Hotovo: ${s.filesDone} souborů (${formatSize(s.bytesDone)})`, { type: 'ok' });
    this.remoteTree.refresh();
    if (this.localPaneIsSecondary) this.localTree.refresh();
  }

  async handleConflict(q) {
    const applyAll = el('input', { type: 'checkbox' });
    const body = el('div', {},
      el('p', { class: 'modal-message', text: `V cíli už existuje „${q.name}".` }),
      el('p', { class: 'modal-detail mono', text: q.path }),
      el('label', { class: 'check-row' }, applyAll, el('span', { text: 'Použít pro všechny další kolize' })));
    const res = await modal({
      title: 'Soubor už existuje', icon: 'alert', width: 480, body, dismissable: false,
      buttons: [
        { id: 'cancel', label: 'Zrušit přenos', danger: true },
        { id: 'skip', label: 'Přeskočit' },
        { id: 'rename', label: 'Přejmenovat' },
        { id: 'overwrite', label: 'Přepsat', primary: true }
      ]
    });
    window.smith.files.answer(q.jobId, { action: res || 'skip', applyToAll: applyAll.checked });
  }

  /* ================================================================ */
  /* Nastavení                                                        */
  /* ================================================================ */

  async updateSettings(patch) {
    this.settings = await window.smith.settings.set(patch);
    return this.settings;
  }

  async setSetting(dotted, value) {
    const patch = {};
    setPath(patch, dotted, value);
    if (dotted === 'terminal.fontSize') this.fontSize = value;
    return this.updateSettings(patch);
  }

  async resetSettings() {
    this.settings = await window.smith.settings.reset();
    this.fontSize = this.settings.terminal.fontSize;
    return this.settings;
  }

  zoom(dir) {
    if (dir === 0) this.fontSize = this.settings.terminal.fontSize;
    else this.fontSize = Math.min(40, Math.max(6, this.fontSize + dir));
    for (const p of this.tabs.allPanes()) {
      if (p.term) { p.term.options.fontSize = this.fontSize; p.scheduleFit(); }
    }
    this.updateStatusBar();
  }

  /* ================================================================ */
  /* Stavový řádek, titulek, obnova                                   */
  /* ================================================================ */

  updateStatusBar() {
    const p = this.activePane;
    const set = (id, text, title) => {
      const n = $(id);
      if (!n) return;
      n.textContent = text || '';
      n.hidden = !text;
      if (title) n.title = title;
    };
    const statusText = {
      starting: 'spouští se', connecting: 'připojuji…', connected: 'připojeno',
      closed: 'ukončeno', error: 'chyba'
    };
    set('#sb-session', p ? p.title : 'žádná relace');
    set('#sb-status', p ? (statusText[p.status] || p.status) : '');
    const dot = $('#sb-dot');
    dot.className = `sb-dot status-${p ? p.status : 'closed'}`;
    set('#sb-cwd', p && p.cwd ? p.cwd : '');
    set('#sb-size', p && p.term ? `${p.term.cols}×${p.term.rows}` : '');
    set('#sb-font', `${this.fontSize} px`);
    const n = this.tabs.tabs.length;
    set('#sb-tabs', `${n} ${n === 1 ? 'tab' : n < 5 ? 'taby' : 'tabů'}`);
    this.updateWindowTitle();
  }

  updateWindowTitle() {
    const t = this.tabs && this.tabs.active ? this.tabs.active.title : null;
    document.title = t ? `${t} — ShellSmith` : 'ShellSmith';
    const el2 = $('#tb-title');
    if (el2) el2.textContent = t ? `${t} — ShellSmith` : 'ShellSmith';
  }

  async persistState() {
    if (!this.tabs) return;
    const tabs = this.tabs.tabs.map((t) => {
      const p = t.panes()[0];
      return p ? { opts: p.opts, title: t.customTitle } : null;
    }).filter(Boolean);
    try { await window.smith.state.save({ tabs, sidebar: this.sidebarTab }); } catch (_) {}
  }

  async restoreOrStart() {
    const state = await window.smith.state.get();
    if (this.settings.behavior.restoreTabs && state.tabs && state.tabs.length) {
      for (const t of state.tabs.slice(0, 20)) {
        const pane = new TerminalPane(this, t.opts);
        const tab = new Tab(this.tabs, pane);
        if (t.title) tab.customTitle = t.title;
        this.tabs.add(tab, false);
        await pane.start();
      }
      this.tabs.activate(this.tabs.tabs[0]);
      return;
    }
    if (this.settings.behavior.startupTab === 'local') await this.newLocalTab();
  }

  /* ================================================================ */
  /* Klávesové zkratky                                                */
  /* ================================================================ */

  wireShortcuts() {
    window.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey && !e.altKey;
      const shift = e.shiftKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (ctrl && shift) {
        const map = {
          t: () => this.newLocalTab(),
          n: () => this.sessions.editSession(null),
          w: () => this.activePane ? this.closePane(this.activePane)
                                   : this.tabs.active && this.tabs.closeTab(this.tabs.active),
          q: () => this.tabs.active && this.tabs.closeTab(this.tabs.active),
          e: () => this.splitActive('v'),
          o: () => this.splitActive('h'),
          f: () => this.activePane && this.activePane.toggleSearch(true),
          c: () => this.activePane && this.activePane.hasSelection() && window.smith.clipboard.write(this.activePane.selection()),
          v: () => this.activePane && this.activePane.pasteFromClipboard(),
          p: () => openSettings(this)
        };
        if (map[key]) { e.preventDefault(); map[key](); return; }
      }

      if (ctrl && !shift) {
        if (key === ',') { e.preventDefault(); openSettings(this); return; }
        if (key === 'b') { e.preventDefault(); document.body.classList.toggle('sidebar-collapsed'); for (const p of this.tabs.allPanes()) p.scheduleFit(); return; }
        if (key === '+' || key === '=') { e.preventDefault(); this.zoom(1); return; }
        if (key === '-') { e.preventDefault(); this.zoom(-1); return; }
        if (key === '0') { e.preventDefault(); this.zoom(0); return; }
        if (key === 'Tab') { e.preventDefault(); this.tabs.next(1); return; }
      }
      if (ctrl && shift && key === 'Tab') { e.preventDefault(); this.tabs.next(-1); return; }

      if (e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        this.tabs.activateIndex(Number(e.key) - 1);
        return;
      }
      if (e.key === 'F11') {
        e.preventDefault();
        document.body.classList.toggle('zen');
        for (const p of this.tabs.allPanes()) p.scheduleFit();
      }
    }, true);
  }

  /** Pokyn zvenčí: druhé spuštění aplikace, akce v nabídce, ssh:// odkaz. */
  async runCommand(cmd) {
    if (!cmd) return;
    if (cmd.type === 'new-local') return void this.newLocalTab();
    if (cmd.type === 'sessions') return this.selectSidebar('sessions');
    if (cmd.type === 'url') {
      const m = /^ssh:\/\/(?:([^@/:]+)(?::[^@/]*)?@)?([^/:\s]+)(?::(\d+))?(\/.*)?$/i.exec(cmd.url);
      if (!m) return toast(`Odkazu nerozumím: ${cmd.url}`, { type: 'error' });
      const [, user, host, port, path] = m;
      const cd = path && path !== '/' ? `cd '${decodeURIComponent(path)}'` : '';
      const saved = this.sessions.items.find((i) =>
        i.kind === 'ssh' && i.host === host && (!user || i.username === user));
      if (saved) return void this.connectSaved(cd ? Object.assign({}, saved, { initialCommand: cd }) : saved);
      this.connectSaved({
        kind: 'ssh', host, port: Number(port) || 22, username: user || '',
        authType: 'agent', name: `${user ? user + '@' : ''}${host}`,
        initialCommand: cd
      });
    }
  }

  async quit() {
    // Potvrzení řeší main proces, ať se ptá stejně i při Alt+F4 nebo z panelu.
    await this.persistState();
    window.smith.win.close();
  }
}

const app = new App();
window.__shellsmith = app;
app.boot().catch((e) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#e05252;font-family:monospace">Chyba při startu:\n${e.stack || e}</pre>`;
});
