import { el, contextMenu, promptDialog, confirmDialog } from './ui.js';
import { icon } from './icons.js';

let tabSeq = 0;

/** Uzel rozvržení: buď list s panelem, nebo rozdělení na dvě části. */
const leaf = (pane) => ({ type: 'leaf', pane });
const split = (dir, a, b) => ({ type: 'split', dir, a, b, ratio: 0.5 });

export class Tab {
  constructor(manager, pane) {
    this.manager = manager;
    this.id = `tab${++tabSeq}`;
    this.layout = leaf(pane);
    this.activePane = pane;
    this.customTitle = null;
    this.content = el('div', { class: 'tab-content' });
    this.buildTabButton();
    this.attachPane(pane);
    this.render();
  }

  buildTabButton() {
    this.dot = el('span', { class: 'tab-dot' });
    this.iconEl = el('span', { class: 'tab-ico' });
    this.labelEl = el('span', { class: 'tab-label' });
    this.closeBtn = el('button', {
      class: 'tab-close', title: 'Zavřít (Ctrl+Shift+W)', html: icon('close', 13),
      onClick: (e) => { e.stopPropagation(); this.manager.closeTab(this); }
    });
    this.button = el('div', {
      class: 'tab', draggable: 'true',
      onClick: () => this.manager.activate(this),
      onAuxclick: (e) => { if (e.button === 1) { e.preventDefault(); this.manager.closeTab(this); } },
      onContextmenu: (e) => { e.preventDefault(); this.showMenu(e.clientX, e.clientY); },
      onDblclick: (e) => { if (e.target === this.labelEl || e.target === this.button) this.rename(); }
    }, this.iconEl, this.dot, this.labelEl, this.closeBtn);

    this.button.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-c3-tab', this.id);
      e.dataTransfer.effectAllowed = 'move';
      this.button.classList.add('dragging');
    });
    this.button.addEventListener('dragend', () => this.button.classList.remove('dragging'));
    this.button.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-c3-tab')) return;
      e.preventDefault();
      const r = this.button.getBoundingClientRect();
      this.button.classList.toggle('drop-before', e.clientX < r.left + r.width / 2);
      this.button.classList.toggle('drop-after', e.clientX >= r.left + r.width / 2);
    });
    this.button.addEventListener('dragleave', () => {
      this.button.classList.remove('drop-before', 'drop-after');
    });
    this.button.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-c3-tab');
      if (!id) return;
      e.preventDefault();
      const r = this.button.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      this.button.classList.remove('drop-before', 'drop-after');
      this.manager.reorder(id, this.id, before);
    });
  }

  attachPane(pane) {
    pane.onTitleChange = () => this.updateLabel();
    pane.onStatusChange = () => this.updateLabel();
    pane.onCwdChange = () => this.manager.app.onPaneCwd(pane);
    pane.onFocus = () => { this.activePane = pane; this.manager.app.onPaneFocus(pane); };
  }

  /** Najde uzel rozvržení, ve kterém sedí daný panel. */
  findLeaf(pane, node = this.layout) {
    if (!node) return null;
    if (node.type === 'leaf') return node.pane === pane ? node : null;
    return this.findLeaf(pane, node.a) || this.findLeaf(pane, node.b);
  }

  panes(node = this.layout, out = []) {
    if (!node) return out;
    if (node.type === 'leaf') out.push(node.pane);
    else { this.panes(node.a, out); this.panes(node.b, out); }
    return out;
  }

  get title() {
    if (this.customTitle) return this.customTitle;
    const p = this.activePane || this.panes()[0];
    return p ? p.title : 'tab';
  }

  updateLabel() {
    const p = this.activePane || this.panes()[0];
    this.labelEl.textContent = this.title;
    const parts = [this.title];
    if (p && p.info && p.info.host) parts.push(p.info.host);
    if (p && p.remoteTitle && p.remoteTitle !== this.title) parts.push(p.remoteTitle);
    this.button.title = parts.join(' — ');
    const kind = p && p.opts ? p.opts.kind : 'local';
    if (this.manager.app.settings.appearance.tabIcons) {
      this.iconEl.innerHTML = icon(kind === 'ssh' ? 'server' : 'terminal', 14);
      this.iconEl.hidden = false;
    } else {
      this.iconEl.hidden = true;
    }
    const status = p ? p.status : 'closed';
    this.dot.className = `tab-dot status-${status}`;
    this.dot.title = { starting: 'spouští se', connecting: 'připojuji…', connected: 'připojeno', closed: 'ukončeno', error: 'chyba' }[status] || status;
    this.manager.app.updateWindowTitle();
  }

  /* ---------------- rozvržení ---------------- */

  render() {
    this.content.innerHTML = '';
    this.content.append(this.renderNode(this.layout));
    const panes = this.panes();
    const split = panes.length > 1;
    for (const p of panes) {
      p.setSplitMode(split);
      p.scheduleFit();
    }
  }

  renderNode(node) {
    if (node.type === 'leaf') return node.pane.root;
    const wrap = el('div', { class: `split split-${node.dir}` });
    const a = el('div', { class: 'split-part', style: { flex: `${node.ratio} 1 0%` } }, this.renderNode(node.a));
    const bar = el('div', { class: `splitter splitter-${node.dir}` });
    const b = el('div', { class: 'split-part', style: { flex: `${1 - node.ratio} 1 0%` } }, this.renderNode(node.b));
    wrap.append(a, bar, b);
    this.wireSplitter(bar, wrap, a, b, node);
    return wrap;
  }

  wireSplitter(bar, wrap, aEl, bEl, node) {
    bar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const horizontal = node.dir === 'v';   // svislý předěl = táhneme vodorovně
      const rect = wrap.getBoundingClientRect();
      document.body.classList.add(horizontal ? 'resizing-x' : 'resizing-y');
      const move = (ev) => {
        const pos = horizontal ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        node.ratio = Math.min(0.9, Math.max(0.1, pos));
        aEl.style.flex = `${node.ratio} 1 0%`;
        bEl.style.flex = `${1 - node.ratio} 1 0%`;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing-x', 'resizing-y');
        for (const p of this.panes()) p.scheduleFit();
        this.manager.app.persistState();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  /** Vloží nový panel vedle daného (nebo vedle aktivního). */
  splitPane(target, dir, newPane) {
    const replace = (node) => {
      if (node.type === 'leaf') return node.pane === target ? split(dir, node, leaf(newPane)) : node;
      node.a = replace(node.a);
      node.b = replace(node.b);
      return node;
    };
    this.layout = replace(this.layout);
    this.attachPane(newPane);
    this.render();
  }

  /** Odebere panel z rozvržení; vrací true, pokud tab osiřel. */
  removePane(pane) {
    const prune = (node) => {
      if (node.type === 'leaf') return node.pane === pane ? null : node;
      const a = prune(node.a);
      const b = prune(node.b);
      if (!a) return b;
      if (!b) return a;
      node.a = a; node.b = b;
      return node;
    };
    this.layout = prune(this.layout);
    if (!this.layout) return true;
    if (this.activePane === pane) this.activePane = this.panes()[0];
    this.render();
    return false;
  }

  async rename() {
    const name = await promptDialog({
      title: 'Přejmenovat tab', label: 'Název', value: this.title, okLabel: 'Uložit'
    });
    if (name != null) {
      this.customTitle = name.trim() || null;
      this.updateLabel();
      this.manager.app.persistState();
    }
  }

  showMenu(x, y) {
    const p = this.activePane;
    contextMenu(x, y, [
      { label: 'Přejmenovat…', icon: 'pencil', action: () => this.rename() },
      { label: 'Duplikovat relaci', icon: 'copy', action: () => this.manager.app.duplicateTab(this) },
      { label: 'Znovu připojit', icon: 'refresh', disabled: !p, action: () => p && p.reconnect() },
      { separator: true },
      { label: 'Rozdělit vodorovně…', icon: 'splitH', action: () => this.manager.app.splitActive('h') },
      { label: 'Rozdělit svisle…', icon: 'splitV', action: () => this.manager.app.splitActive('v') },
      this.panes().length > 1
        ? { label: 'Zavřít aktivní panel', icon: 'close', accel: 'Ctrl+Shift+W', action: () => p && this.manager.app.closePane(p) }
        : null,
      { separator: true },
      { label: 'Zavřít ostatní', action: () => this.manager.closeOthers(this) },
      { label: 'Zavřít vpravo', action: () => this.manager.closeToRight(this) },
      { label: 'Zavřít tab', icon: 'close', accel: 'Ctrl+Shift+Q', danger: true, action: () => this.manager.closeTab(this) }
    ].filter(Boolean));
  }

  async dispose() {
    for (const p of this.panes()) await p.dispose();
    this.button.remove();
    this.content.remove();
  }
}

/* ------------------------------------------------------------------ */

export class TabManager {
  constructor(app, barEl, hostEl) {
    this.app = app;
    this.bar = barEl;
    this.host = hostEl;
    this.tabs = [];
    this.active = null;

    this.bar.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-c3-tab')) e.preventDefault();
    });
    this.bar.addEventListener('dblclick', (e) => {
      if (e.target === this.bar || e.target === this.strip) this.app.newLocalTab();
    });
  }

  add(tab, activate = true) {
    this.tabs.push(tab);
    this.strip.append(tab.button);
    this.host.append(tab.content);
    tab.updateLabel();
    if (activate) this.activate(tab);
    this.updateOverflow();
    return tab;
  }

  activate(tab) {
    if (!tab) return;
    this.active = tab;
    for (const t of this.tabs) {
      t.button.classList.toggle('active', t === tab);
      t.content.classList.toggle('active', t === tab);
    }
    tab.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const pane = tab.activePane || tab.panes()[0];
    if (pane) { pane.scheduleFit(); pane.focus(); }
    this.app.onTabActivated(tab);
  }

  next(delta) {
    if (!this.tabs.length) return;
    const i = this.tabs.indexOf(this.active);
    const n = (i + delta + this.tabs.length) % this.tabs.length;
    this.activate(this.tabs[n]);
  }

  activateIndex(i) { if (this.tabs[i]) this.activate(this.tabs[i]); }

  reorder(dragId, targetId, before) {
    const from = this.tabs.findIndex((t) => t.id === dragId);
    const to = this.tabs.findIndex((t) => t.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = this.tabs.splice(from, 1);
    const idx = this.tabs.findIndex((t) => t.id === targetId);
    this.tabs.splice(before ? idx : idx + 1, 0, moved);
    this.strip.innerHTML = '';
    for (const t of this.tabs) this.strip.append(t.button);
    this.app.persistState();
  }

  async closeTab(tab, skipConfirm = false) {
    if (!tab) return;
    const live = tab.panes().some((p) => p.status === 'connected');
    if (!skipConfirm && live && this.app.settings.behavior.confirmOnCloseTab) {
      const ok = await confirmDialog({
        title: 'Zavřít tab', message: `Relace „${tab.title}" je aktivní.`, okLabel: 'Zavřít', danger: true
      });
      if (!ok) return;
    }
    const idx = this.tabs.indexOf(tab);
    this.tabs.splice(idx, 1);
    await tab.dispose();
    if (this.active === tab) {
      this.active = null;
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      if (next) this.activate(next); else this.app.onNoTabs();
    }
    this.updateOverflow();
    this.app.updateStatusBar();
    this.app.persistState();
  }

  async closeOthers(keep) {
    for (const t of [...this.tabs]) if (t !== keep) await this.closeTab(t, true);
  }

  async closeToRight(from) {
    const i = this.tabs.indexOf(from);
    for (const t of this.tabs.slice(i + 1)) await this.closeTab(t, true);
  }

  updateOverflow() {
    this.bar.classList.toggle('has-tabs', this.tabs.length > 0);
  }

  activeCount() {
    return this.tabs.reduce((n, t) => n + t.panes().filter((p) => p.status === 'connected').length, 0);
  }

  allPanes() { return this.tabs.flatMap((t) => t.panes()); }

  /** Ke kterému tabu panel patří. */
  tabOf(pane) { return this.tabs.find((t) => t.panes().includes(pane)) || null; }
}
