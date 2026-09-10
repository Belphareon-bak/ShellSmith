import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { el, contextMenu, confirmDialog, toast } from './ui.js';
import { icon } from './icons.js';
import { termTheme } from './themes.js';

let paneSeq = 0;

/**
 * Jeden terminálový panel = xterm.js napojený na jednu relaci v main procesu.
 * Panelů může být v jednom tabu víc (rozdělené zobrazení).
 */
export class TerminalPane {
  constructor(app, opts) {
    this.app = app;
    this.key = `p${++paneSeq}`;
    this.opts = opts;
    this.sessionId = null;
    this.info = null;
    this.status = 'starting';
    this.cwd = null;
    this.title = opts.title || (opts.kind === 'ssh' ? `${opts.username || ''}@${opts.host}` : 'shell');
    this.disposed = false;
    this.onTitleChange = null;
    this.onStatusChange = null;
    this.onCwdChange = null;
    this.onFocus = null;
    this.buildDom();
  }

  /* ---------------- DOM ---------------- */

  buildDom() {
    this.termHost = el('div', { class: 'term-host' });
    this.overlay = el('div', { class: 'pane-overlay', hidden: true });
    this.searchBar = this.buildSearchBar();
    this.header = this.buildHeader();
    this.root = el('div', { class: 'pane', tabindex: '-1' },
      this.header, this.searchBar, this.termHost, this.overlay);

    this.root.addEventListener('mousedown', () => this.app.setActivePane(this), true);
  }

  /**
   * Lišta nad panelem. Ukazuje se jen v rozděleném tabu – tam je potřeba vědět,
   * co v kterém panelu běží, umět to přepnout a panel zavřít jedním kliknutím.
   */
  buildHeader() {
    this.headDot = el('span', { class: 'tab-dot' });
    this.headIcon = el('span', { class: 'pane-head-ico' });
    this.headTitle = el('span', { class: 'pane-head-title' });
    return el('div', { class: 'pane-head', hidden: true },
      this.headIcon, this.headDot, this.headTitle,
      el('button', {
        class: 'icon-btn tiny', title: 'Zvolit, co se v panelu zobrazí',
        html: icon('layers', 13),
        onClick: (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          this.app.showPaneChooser(this, r.left, r.bottom + 2);
        }
      }),
      el('button', {
        class: 'icon-btn tiny pane-head-close', title: 'Zavřít panel (Ctrl+Shift+W)',
        html: icon('close', 13),
        onClick: (e) => { e.stopPropagation(); this.app.closePane(this); }
      })
    );
  }

  /** Hlavička dává smysl jen v rozděleném tabu. */
  setSplitMode(on) {
    this.header.hidden = !on;
    this.updateHeader();
  }

  updateHeader() {
    if (this.header.hidden) return;
    this.headTitle.textContent = this.title;
    this.headTitle.title = this.info && this.info.host ? `${this.title} — ${this.info.host}` : this.title;
    this.headIcon.innerHTML = icon(this.opts.kind === 'ssh' ? 'server' : 'terminal', 13);
    this.headDot.className = `tab-dot status-${this.status}`;
  }

  buildSearchBar() {
    this.searchInput = el('input', {
      class: 'input search-input', type: 'text', placeholder: 'Hledat v terminálu…',
      onInput: () => this.runSearch(false),
      onKeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.runSearch(!e.shiftKey); }
        if (e.key === 'Escape') { e.preventDefault(); this.toggleSearch(false); }
        e.stopPropagation();
      }
    });
    this.searchCount = el('span', { class: 'search-count' });
    const bar = el('div', { class: 'search-bar', hidden: true },
      el('span', { class: 'search-ico', html: icon('search', 15) }),
      this.searchInput,
      this.searchCount,
      el('button', { class: 'icon-btn', title: 'Předchozí (Shift+Enter)', html: icon('chevronDown', 15) + '', onClick: () => this.runSearch(false) }),
      el('button', { class: 'icon-btn', title: 'Další (Enter)', html: icon('chevronRight', 15), onClick: () => this.runSearch(true) }),
      el('button', { class: 'icon-btn', title: 'Zavřít (Esc)', html: icon('close', 15), onClick: () => this.toggleSearch(false) })
    );
    return bar;
  }

  /* ---------------- xterm ---------------- */

  async start() {
    const s = this.app.settings;
    this.term = new Terminal({
      allowProposedApi: true,
      fontFamily: s.terminal.fontFamily,
      fontSize: this.app.fontSize,
      lineHeight: s.terminal.lineHeight,
      letterSpacing: s.terminal.letterSpacing,
      cursorStyle: s.terminal.cursorStyle,
      cursorBlink: s.terminal.cursorBlink,
      scrollback: s.terminal.scrollback,
      scrollSensitivity: s.terminal.scrollSensitivity,
      wordSeparator: s.terminal.wordSeparators,
      theme: termTheme(s.appearance.theme),
      macOptionIsMeta: false,
      rightClickSelectsWord: false,
      allowTransparency: false,
      convertEol: false,
      windowsMode: false
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    this.term.loadAddon(new WebLinksAddon((_e, uri) => window.smith.app.openExternal(uri)));
    const uni = new Unicode11Addon();
    this.term.loadAddon(uni);
    this.term.unicode.activeVersion = '11';

    this.term.open(this.termHost);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => { try { webgl.dispose(); } catch (_) {} });
      this.term.loadAddon(webgl);
    } catch (_) { /* bez GPU akcelerace se jede na canvasu */ }

    this.term.attachCustomKeyEventHandler((e) => this.keyFilter(e));
    this.term.onData((d) => this.sessionId && window.smith.term.write(this.sessionId, d));
    this.term.onBinary((d) => this.sessionId && window.smith.term.write(this.sessionId, d));
    this.term.onTitleChange((t) => {
      // Pojmenovanou relaci nepřepisujeme tím, co si zvolí vzdálený shell –
      // uživatel chce v tabu vidět svůj název; titulek ze shellu jde do tooltipu.
      this.remoteTitle = t && t.trim() ? t.trim() : null;
      if (this.opts.title) { this.updateHeader(); this.onTitleChange && this.onTitleChange(this); return; }
      if (this.remoteTitle) {
        this.title = this.remoteTitle;
        this.updateHeader();
        this.onTitleChange && this.onTitleChange(this);
      }
    });
    this.term.onBell(() => {
      if (this.app.settings.terminal.bell === 'visual') {
        this.root.classList.add('bell');
        setTimeout(() => this.root.classList.remove('bell'), 180);
      }
    });

    this.wireMouse();
    this.observeResize();

    await this.connect();
    return this;
  }

  async connect() {
    this.setStatus('starting');
    this.fit();
    try {
      const info = await window.smith.term.create(Object.assign({}, this.opts, {
        cols: this.term.cols, rows: this.term.rows
      }));
      this.sessionId = info.id;
      this.info = info;
      this.app.registerSession(this);
      if (info.title && !this.opts.title) { this.title = info.title; this.onTitleChange && this.onTitleChange(this); }
      this.hideOverlay();
      // Relace může naskočit (nebo spadnout) dřív, než se stihneme zaregistrovat
      // pro události – aktuální stav si proto po registraci ještě doptáme.
      await this.reconcileStatus(info);
    } catch (e) {
      this.setStatus('error', e.message);
      this.showDisconnected(e.message);
    }
  }

  /** Srovná stav panelu se skutečným stavem relace v main procesu. */
  async reconcileStatus(info) {
    let current = info;
    try {
      const live = await window.smith.term.list();
      current = live.find((s) => s.id === this.sessionId) || null;
    } catch (_) { /* zůstaneme u toho, co vrátilo vytvoření relace */ }

    if (!current) {
      this.setStatus('closed', 'Relace skončila hned po spuštění');
      this.showDisconnected('Relace skončila hned po spuštění');
      return;
    }
    if (current.cwd) this.setCwd(current.cwd);
    this.setStatus(current.status, current.detail);
    if (current.status === 'closed' || current.status === 'error') {
      this.showDisconnected(current.detail || 'Spojení se nepodařilo navázat');
    }
  }

  async reconnect() {
    if (this.sessionId) {
      this.app.unregisterSession(this.sessionId);
      try { await window.smith.term.close(this.sessionId); } catch (_) {}
      this.sessionId = null;
    }
    this.term.reset();
    this.term.write(`\x1b[90m— nové připojení —\x1b[0m\r\n`);
    await this.connect();
    this.focus();
  }

  /* ---------------- myš a schránka ---------------- */

  wireMouse() {
    const s = () => this.app.settings.terminal;

    // Označení myší rovnou kopíruje (chování MobaXtermu / PuTTY).
    let selTimer = null;
    this.term.onSelectionChange(() => {
      if (!s().copyOnSelect) return;
      clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        const text = this.term.getSelection();
        if (text) window.smith.clipboard.write(text);
      }, 60);
    });

    const screen = this.termHost;

    screen.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const mode = s().rightClick;
      const sel = this.term.getSelection();
      if (mode === 'menu') return this.showContextMenu(e.clientX, e.clientY);
      if (mode === 'copypaste' && sel) {
        window.smith.clipboard.write(sel);
        this.term.clearSelection();
        return;
      }
      this.pasteFromClipboard();
    });

    // Prostřední tlačítko vloží primární výběr (unixový zvyk).
    screen.addEventListener('mousedown', (e) => {
      if (e.button === 1 && s().middleClickPaste) {
        e.preventDefault();
        window.smith.clipboard.readSelection().then((t) => { if (t) this.pasteText(t, true); });
      }
    });

    screen.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        this.app.zoom(e.deltaY < 0 ? 1 : -1);
      }
    }, { passive: false });
  }

  showContextMenu(x, y) {
    const sel = this.term.getSelection();
    contextMenu(x, y, [
      { label: 'Kopírovat', icon: 'copy', accel: 'Ctrl+Shift+C', disabled: !sel, action: () => window.smith.clipboard.write(sel) },
      { label: 'Vložit', icon: 'clipboard', accel: 'Ctrl+Shift+V', action: () => this.pasteFromClipboard() },
      { label: 'Vybrat vše', action: () => this.term.selectAll() },
      { separator: true },
      { label: 'Hledat…', icon: 'search', accel: 'Ctrl+Shift+F', action: () => this.toggleSearch(true) },
      { label: 'Vymazat obrazovku', icon: 'refresh', action: () => this.term.clear() },
      { separator: true },
      { label: 'Rozdělit vodorovně…', icon: 'splitH', action: () => this.app.showSplitPicker('h', x, y) },
      { label: 'Rozdělit svisle…', icon: 'splitV', action: () => this.app.showSplitPicker('v', x, y) },
      { label: 'Zvolit obsah panelu…', icon: 'layers', action: () => this.app.showPaneChooser(this, x, y) },
      { separator: true },
      { label: 'Znovu připojit', icon: 'refresh', action: () => this.reconnect() },
      { label: 'Zavřít panel', icon: 'close', accel: 'Ctrl+Shift+W', danger: true, action: () => this.app.closePane(this) }
    ]);
  }

  async pasteFromClipboard() {
    const text = await window.smith.clipboard.read();
    if (text) this.pasteText(text);
  }

  async pasteText(text, skipConfirm) {
    const s = this.app.settings.terminal;
    if (!skipConfirm && s.confirmPasteMultiline && /\n/.test(text.trim())) {
      const lines = text.trim().split('\n').length;
      const ok = await confirmDialog({
        title: 'Vložit více řádků?',
        message: `Chystáte se vložit ${lines} řádků do terminálu.`,
        detail: text.slice(0, 400) + (text.length > 400 ? '…' : ''),
        okLabel: 'Vložit'
      });
      if (!ok) return;
    }
    this.term.paste(text);
    this.focus();
  }

  /* ---------------- vyhledávání ---------------- */

  toggleSearch(show) {
    const visible = show != null ? show : this.searchBar.hidden;
    this.searchBar.hidden = !visible;
    if (visible) { this.searchInput.focus(); this.searchInput.select(); }
    else { this.searchAddon.clearDecorations(); this.focus(); }
    this.fit();
  }

  runSearch(forward = true) {
    const q = this.searchInput.value;
    if (!q) { this.searchCount.textContent = ''; this.searchAddon.clearDecorations(); return; }
    const opts = {
      decorations: {
        matchBackground: '#5a4b1f', matchBorder: '#c9a227', matchOverviewRuler: '#c9a227',
        activeMatchBackground: '#c9a227', activeMatchBorder: '#ffe08a', activeMatchColorOverviewRuler: '#ffe08a'
      }
    };
    const found = forward ? this.searchAddon.findNext(q, opts) : this.searchAddon.findPrevious(q, opts);
    this.searchCount.textContent = found ? '' : 'nenalezeno';
    this.searchCount.classList.toggle('miss', !found);
  }

  /* ---------------- rozměry ---------------- */

  observeResize() {
    this.ro = new ResizeObserver(() => this.scheduleFit());
    this.ro.observe(this.root);
  }

  scheduleFit() {
    cancelAnimationFrame(this._fitRaf);
    this._fitRaf = requestAnimationFrame(() => this.fit());
  }

  fit() {
    if (this.disposed || !this.term) return;
    const r = this.root.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    try { this.fitAddon.fit(); } catch (_) { return; }
    if (this.sessionId) window.smith.term.resize(this.sessionId, this.term.cols, this.term.rows);
    this.app.updateStatusBar();
  }

  applySettings(settings) {
    if (!this.term) return;
    const t = settings.terminal;
    const o = this.term.options;
    o.fontFamily = t.fontFamily;
    o.fontSize = this.app.fontSize;
    o.lineHeight = t.lineHeight;
    o.letterSpacing = t.letterSpacing;
    o.cursorStyle = t.cursorStyle;
    o.cursorBlink = t.cursorBlink;
    o.scrollback = t.scrollback;
    o.scrollSensitivity = t.scrollSensitivity;
    o.wordSeparator = t.wordSeparators;
    o.theme = termTheme(settings.appearance.theme);
    this.scheduleFit();
  }

  /* ---------------- stav relace ---------------- */

  write(data) { if (this.term) this.term.write(data); }

  setStatus(status, detail) {
    this.status = status;
    this.statusDetail = detail || null;
    this.updateHeader();
    this.onStatusChange && this.onStatusChange(this);
    this.app.updateStatusBar();
  }

  setCwd(cwd) {
    this.cwd = cwd;
    this.onCwdChange && this.onCwdChange(this);
  }

  showDisconnected(message) {
    this.overlay.hidden = false;
    this.overlay.innerHTML = '';
    this.overlay.append(el('div', { class: 'pane-overlay-card' },
      el('div', { class: 'pane-overlay-ico', html: icon('alert', 28) }),
      el('div', { class: 'pane-overlay-title', text: 'Relace skončila' }),
      message ? el('div', { class: 'pane-overlay-msg', text: message }) : null,
      el('div', { class: 'pane-overlay-actions' },
        el('button', { class: 'btn btn-primary', text: 'Znovu připojit', onClick: () => this.reconnect() }),
        el('button', { class: 'btn', text: 'Zavřít panel', onClick: () => this.app.closePane(this) })
      )
    ));
  }

  hideOverlay() { this.overlay.hidden = true; this.overlay.innerHTML = ''; }

  keyFilter(e) {
    if (e.type !== 'keydown') return true;
    // Klávesy aplikace nechceme posílat do shellu.
    if (e.ctrlKey && e.shiftKey && ['C', 'V', 'F', 'T', 'W', 'N', 'E', 'O', 'S', 'P'].includes(e.key.toUpperCase())) return false;
    if (e.ctrlKey && ['+', '-', '=', '0'].includes(e.key)) return false;
    if (e.altKey && /^[0-9]$/.test(e.key)) return false;
    if (e.ctrlKey && e.key === 'Tab') return false;
    if (e.key === 'F11') return false;
    return true;
  }

  focus() {
    if (this.term) this.term.focus();
    this.onFocus && this.onFocus(this);
  }

  hasSelection() { return this.term && this.term.hasSelection(); }
  selection() { return this.term ? this.term.getSelection() : ''; }

  supportsFiles() { return !!(this.info && this.info.supportsFiles); }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.ro && this.ro.disconnect(); } catch (_) {}
    if (this.sessionId) {
      this.app.unregisterSession(this.sessionId);
      try { await window.smith.term.close(this.sessionId); } catch (_) {}
    }
    try { this.term && this.term.dispose(); } catch (_) {}
    this.root.remove();
  }
}
