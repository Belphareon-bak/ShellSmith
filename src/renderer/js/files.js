import { el, contextMenu, promptDialog, confirmDialog, toast, formatSize, formatTime } from './ui.js';
import { icon } from './icons.js';

const collator = new Intl.Collator('cs', { numeric: true, sensitivity: 'base' });

function sortEntries(list) {
  return [...list].sort((a, b) => {
    const ad = (a.realType || a.type) === 'dir', bd = (b.realType || b.type) === 'dir';
    if (ad !== bd) return ad ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

const parentOf = (p) => {
  if (!p || p === '/') return '/';
  const i = p.replace(/\/+$/, '').lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
};

/**
 * Adresářový strom nad jedním cílem (lokální stroj nebo SSH relace).
 * Načítá se líně – rozbalený adresář si vyžádá obsah, ostatní se nečtou.
 */
export class FileTree {
  constructor(app, opts = {}) {
    this.app = app;
    this.target = opts.target || 'local';
    this.label = opts.label || 'lokální';
    this.root = null;
    this.nodes = new Map();
    this.selection = new Set();
    this.lastClicked = null;
    this.filter = '';
    this.history = [];
    this.historyIndex = -1;
    this.onNavigate = opts.onNavigate || null;
    this.buildDom();
  }

  /* ---------------- DOM ---------------- */

  buildDom() {
    this.titleEl = el('span', { class: 'ftree-title', text: this.label });
    this.pathInput = el('input', {
      class: 'path-input', type: 'text', spellcheck: 'false',
      onKeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.navigate(this.pathInput.value.trim());
        if (e.key === 'Escape') { this.pathInput.value = this.root || ''; this.pathInput.blur(); }
      }
    });

    this.filterInput = el('input', {
      class: 'filter-input', type: 'text', placeholder: 'filtr…', spellcheck: 'false',
      onInput: () => { this.filter = this.filterInput.value.toLowerCase(); this.render(); },
      onKeydown: (e) => { e.stopPropagation(); if (e.key === 'Escape') { this.filterInput.value = ''; this.filter = ''; this.render(); } }
    });

    const btn = (name, title, fn, cls = '') => el('button', {
      class: `icon-btn ${cls}`.trim(), title, html: icon(name, 15), onClick: fn
    });

    this.followBtn = btn('link', 'Následovat adresář terminálu', () => this.toggleFollow());
    this.hiddenBtn = btn('eye', 'Zobrazit skryté soubory', () => this.toggleHidden());

    this.toolbar = el('div', { class: 'ftree-toolbar' },
      btn('arrowUp', 'O úroveň výš (Backspace)', () => this.navigate(parentOf(this.root))),
      btn('home', 'Domovský adresář', () => this.goHome()),
      btn('refresh', 'Obnovit (F5)', () => this.refresh()),
      btn('folderPlus', 'Nový adresář', () => this.createFolder()),
      btn('upload', 'Nahrát soubory…', () => this.uploadDialog()),
      btn('download', 'Stáhnout výběr…', () => this.downloadDialog()),
      this.hiddenBtn,
      this.followBtn
    );

    this.body = el('div', { class: 'ftree-body', tabindex: '0' });
    this.body.addEventListener('contextmenu', (e) => {
      if (e.target === this.body || e.target.classList.contains('ftree-list')) {
        e.preventDefault();
        this.showBackgroundMenu(e.clientX, e.clientY);
      }
    });
    this.body.addEventListener('keydown', (e) => this.onKey(e));

    this.list = el('div', { class: 'ftree-list' });
    this.body.append(this.list);

    this.status = el('div', { class: 'ftree-status' });

    this.header = el('div', { class: 'ftree-header' },
      el('div', { class: 'ftree-titlebar' }, this.titleEl, this.filterInput),
      el('div', { class: 'ftree-pathbar' }, el('span', { class: 'path-ico', html: icon('folder', 14) }), this.pathInput),
      this.toolbar
    );

    this.root_el = el('div', { class: 'ftree' }, this.header, this.body, this.status);
    this.wireDropTarget(this.body, () => this.root);
    this.updateToggles();
  }

  updateToggles() {
    const s = this.app.settings.files;
    this.hiddenBtn.classList.toggle('on', s.showHidden);
    this.followBtn.classList.toggle('on', s.followTerminalCwd);
    this.followBtn.hidden = this.target === 'local' && this.app.localPaneIsSecondary;
  }

  setLabel(text, sub) {
    this.label = text;
    this.titleEl.textContent = text;
    this.titleEl.title = sub || text;
  }

  /* ---------------- navigace ---------------- */

  async goHome() {
    try { await this.navigate(await window.c3.files.home(this.target)); }
    catch (e) { this.setStatus(`Nelze zjistit domovský adresář: ${e.message}`, true); }
  }

  async navigate(path, { record = true } = {}) {
    if (!path) return;
    const before = this.root;
    this.root = path;
    this.pathInput.value = path;
    this.nodes.clear();
    this.selection.clear();
    if (record && before !== path) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(path);
      this.historyIndex = this.history.length - 1;
    }
    this.renderBreadcrumbTitle();
    await this.loadDir(path, true);
    this.render();
    this.onNavigate && this.onNavigate(path);
  }

  renderBreadcrumbTitle() {
    this.pathInput.title = this.root || '';
  }

  async refresh() {
    const expanded = [...this.nodes.entries()].filter(([, n]) => n.expanded).map(([p]) => p);
    this.nodes.clear();
    await this.loadDir(this.root, true);
    for (const p of expanded) {
      if (p !== this.root) { const n = this.node(p); n.expanded = true; await this.loadDir(p); }
    }
    this.render();
  }

  node(path) {
    if (!this.nodes.has(path)) this.nodes.set(path, { children: null, expanded: false, loading: false, error: null });
    return this.nodes.get(path);
  }

  async loadDir(path, isRoot = false) {
    const n = this.node(path);
    if (n.loading) return;
    n.loading = true;
    n.error = null;
    if (isRoot) this.setStatus('Načítám…');
    this.render();
    try {
      const res = await window.c3.files.list(this.target, path);
      n.children = sortEntries(res.entries);
      if (isRoot) this.setStatus(this.summary(n.children));
    } catch (e) {
      n.error = e.message;
      n.children = [];
      this.setStatus(`${path}: ${e.message}`, true);
    } finally {
      n.loading = false;
      this.render();
    }
  }

  summary(children) {
    const dirs = children.filter((c) => (c.realType || c.type) === 'dir').length;
    const files = children.length - dirs;
    const bytes = children.reduce((s, c) => s + ((c.realType || c.type) === 'dir' ? 0 : (c.size || 0)), 0);
    return `${dirs} adresářů · ${files} souborů · ${formatSize(bytes)}`;
  }

  setStatus(text, isError = false) {
    this.status.textContent = text;
    this.status.classList.toggle('error', isError);
  }

  async toggleExpand(path) {
    const n = this.node(path);
    n.expanded = !n.expanded;
    if (n.expanded && !n.children) await this.loadDir(path);
    else this.render();
  }

  toggleHidden() {
    const v = !this.app.settings.files.showHidden;
    this.app.updateSettings({ files: { showHidden: v } });
  }

  toggleFollow() {
    const v = !this.app.settings.files.followTerminalCwd;
    this.app.updateSettings({ files: { followTerminalCwd: v } });
  }

  /* ---------------- vykreslení ---------------- */

  visibleEntries(path, depth, out) {
    const n = this.nodes.get(path);
    if (!n || !n.children) return;
    const showHidden = this.app.settings.files.showHidden;
    for (const e of n.children) {
      if (!showHidden && e.name.startsWith('.')) continue;
      if (this.filter && !e.name.toLowerCase().includes(this.filter)) {
        // Skrytý filtrem, ale rozbalené podadresáře mohou obsahovat shodu.
        const sub = this.nodes.get(e.path);
        if (!(sub && sub.expanded)) continue;
      }
      out.push({ entry: e, depth });
      const sub = this.nodes.get(e.path);
      if (sub && sub.expanded) this.visibleEntries(e.path, depth + 1, out);
    }
  }

  render() {
    if (!this.root) return;
    const rows = [];
    this.visibleEntries(this.root, 0, rows);
    const frag = document.createDocumentFragment();

    const rootNode = this.nodes.get(this.root);
    if (rootNode && rootNode.loading && !rootNode.children) {
      frag.append(el('div', { class: 'ftree-empty', text: 'Načítám…' }));
    } else if (!rows.length) {
      frag.append(el('div', { class: 'ftree-empty', text: this.filter ? 'Filtru nic neodpovídá' : 'Prázdný adresář' }));
    }

    for (const r of rows) frag.append(this.renderRow(r.entry, r.depth));
    this.list.innerHTML = '';
    this.list.append(frag);
    this.updateToggles();
  }

  renderRow(entry, depth) {
    const type = entry.realType || entry.type;
    const isDir = type === 'dir';
    const n = this.nodes.get(entry.path);
    const expanded = !!(n && n.expanded);
    const selected = this.selection.has(entry.path);

    const chevron = el('span', {
      class: `row-chevron ${isDir ? '' : 'hidden'}`,
      html: isDir ? icon(expanded ? 'chevronDown' : 'chevronRight', 13) : '',
      onClick: (e) => { e.stopPropagation(); if (isDir) this.toggleExpand(entry.path); }
    });

    const iconName = isDir ? (expanded ? 'folderOpen' : 'folder')
      : entry.type === 'link' ? 'link' : 'file';

    const row = el('div', {
      class: `frow ${selected ? 'selected' : ''} ${isDir ? 'is-dir' : ''} ${type === 'broken' ? 'broken' : ''}`.trim(),
      draggable: 'true',
      dataset: { path: entry.path, type },
      title: `${entry.path}\n${entry.modeStr || ''}  ${formatSize(entry.size)}  ${formatTime(entry.mtime)}`,
      onClick: (e) => this.onRowClick(e, entry),
      onDblclick: (e) => { e.preventDefault(); this.onRowActivate(entry); },
      onContextmenu: (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!this.selection.has(entry.path)) this.selectOnly(entry.path);
        this.showItemMenu(e.clientX, e.clientY, entry);
      }
    },
      el('span', { class: 'row-indent', style: { width: `${depth * 13}px` } }),
      chevron,
      el('span', { class: `row-ico type-${type}`, html: icon(iconName, 15) }),
      el('span', { class: 'row-name', text: entry.name }),
      el('span', { class: 'row-size', text: isDir ? '' : formatSize(entry.size) }),
      el('span', { class: 'row-date', text: formatTime(entry.mtime) })
    );

    row.addEventListener('dragstart', (e) => this.onDragStart(e, entry));
    if (isDir) this.wireDropTarget(row, () => entry.path, true);
    return row;
  }

  /* ---------------- výběr ---------------- */

  selectOnly(path) {
    this.selection.clear();
    this.selection.add(path);
    this.lastClicked = path;
    this.render();
  }

  onRowClick(e, entry) {
    if (e.ctrlKey) {
      if (this.selection.has(entry.path)) this.selection.delete(entry.path);
      else this.selection.add(entry.path);
      this.lastClicked = entry.path;
      this.render();
    } else if (e.shiftKey && this.lastClicked) {
      const rows = [];
      this.visibleEntries(this.root, 0, rows);
      const paths = rows.map((r) => r.entry.path);
      const a = paths.indexOf(this.lastClicked), b = paths.indexOf(entry.path);
      if (a >= 0 && b >= 0) {
        for (const p of paths.slice(Math.min(a, b), Math.max(a, b) + 1)) this.selection.add(p);
        this.render();
      }
    } else {
      this.selectOnly(entry.path);
    }
    this.body.focus();
  }

  onRowActivate(entry) {
    const type = entry.realType || entry.type;
    if (type === 'dir') this.navigate(entry.path);
    else this.openEntry(entry);
  }

  selectedEntries() {
    const rows = [];
    this.visibleEntries(this.root, 0, rows);
    return rows.filter((r) => this.selection.has(r.entry.path)).map((r) => r.entry);
  }

  onKey(e) {
    if (e.key === 'F5') { e.preventDefault(); this.refresh(); }
    else if (e.key === 'Backspace') { e.preventDefault(); this.navigate(parentOf(this.root)); }
    else if (e.key === 'F2') { e.preventDefault(); this.renameSelected(); }
    else if (e.key === 'Delete') { e.preventDefault(); this.deleteSelected(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = this.selectedEntries();
      if (sel.length === 1) this.onRowActivate(sel[0]);
    } else if (e.key === 'a' && e.ctrlKey) {
      e.preventDefault();
      const rows = [];
      this.visibleEntries(this.root, 0, rows);
      for (const r of rows) this.selection.add(r.entry.path);
      this.render();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [];
      this.visibleEntries(this.root, 0, rows);
      const paths = rows.map((r) => r.entry.path);
      const i = paths.indexOf(this.lastClicked);
      const next = paths[Math.min(paths.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        this.selectOnly(next);
        const node = this.list.querySelector(`.frow[data-path="${CSS.escape(next)}"]`);
        node && node.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const sel = this.selectedEntries()[0];
      if (sel && (sel.realType || sel.type) === 'dir') {
        const n = this.node(sel.path);
        if ((e.key === 'ArrowRight') !== n.expanded) this.toggleExpand(sel.path);
      }
    }
  }

  /* ---------------- drag & drop ---------------- */

  async onDragStart(e, entry) {
    if (!this.selection.has(entry.path)) this.selectOnly(entry.path);
    const items = this.selectedEntries();
    const paths = items.map((i) => i.path);

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('application/x-c3-files',
      JSON.stringify({ target: this.target, paths, label: this.label }));

    if (this.target === 'local' || (this.app.targetKind(this.target) === 'local')) {
      // Lokální soubory umí systém převzít přímo přes file:// URI.
      e.dataTransfer.setData('text/uri-list', paths.map((p) => 'file://' + encodeURI(p)).join('\r\n'));
      e.dataTransfer.setData('text/plain', paths.join('\n'));
    } else {
      // U vzdálených souborů necháme Chromium stáhnout obsah z našeho
      // dočasného lokálního serveru, až když je uživatel někam pustí.
      const files = items.filter((i) => (i.realType || i.type) !== 'dir');
      if (files.length) {
        try {
          const urls = await window.c3.files.dragUrls(this.target, files.map((f) => ({
            path: f.path, name: f.name, size: f.size, type: f.realType || f.type
          })));
          if (urls && urls.length) e.dataTransfer.setData('DownloadURL', urls[0]);
        } catch (_) { /* přetažení dovnitř aplikace funguje i tak */ }
      }
      e.dataTransfer.setData('text/plain', paths.join('\n'));
    }

    const ghost = el('div', { class: 'drag-ghost' },
      el('span', { html: icon('file', 14) }),
      el('span', { text: paths.length === 1 ? entry.name : `${paths.length} položek` }));
    document.body.append(ghost);
    e.dataTransfer.setDragImage(ghost, 12, 12);
    setTimeout(() => ghost.remove(), 0);
  }

  wireDropTarget(node, dirFn, isRow = false) {
    const cls = isRow ? 'drop-into' : 'drop-active';
    let depth = 0;

    node.addEventListener('dragenter', (e) => {
      if (!this.acceptsDrag(e)) return;
      e.preventDefault(); e.stopPropagation();
      depth++;
      node.classList.add(cls);
    });
    node.addEventListener('dragover', (e) => {
      if (!this.acceptsDrag(e)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : (this.isSameTargetDrag(e) ? 'move' : 'copy');
    });
    node.addEventListener('dragleave', (e) => {
      if (--depth <= 0) { depth = 0; node.classList.remove(cls); }
    });
    node.addEventListener('drop', async (e) => {
      if (!this.acceptsDrag(e)) return;
      e.preventDefault(); e.stopPropagation();
      depth = 0;
      node.classList.remove(cls);
      await this.handleDrop(e, dirFn());
    });
  }

  acceptsDrag(e) {
    const t = e.dataTransfer.types;
    return t.includes('application/x-c3-files') || t.includes('Files');
  }

  isSameTargetDrag(e) {
    try {
      const raw = e.dataTransfer.getData('application/x-c3-files');
      return raw ? JSON.parse(raw).target === this.target : false;
    } catch (_) { return false; }
  }

  async handleDrop(e, destDir) {
    if (!destDir) return;
    const raw = e.dataTransfer.getData('application/x-c3-files');
    if (raw) {
      let payload;
      try { payload = JSON.parse(raw); } catch (_) { return; }
      const sameTarget = payload.target === this.target;
      if (sameTarget && payload.paths.every((p) => parentOf(p) === destDir)) return; // nikam se nehýbeme
      await this.app.startTransfer({
        srcTarget: payload.target, srcPaths: payload.paths,
        dstTarget: this.target, dstDir: destDir,
        move: sameTarget && !e.ctrlKey
      });
      this.refresh();
      return;
    }

    // Soubory přetažené ze systému (Dolphin, plocha…).
    const paths = [];
    for (const f of e.dataTransfer.files) {
      const p = window.c3.pathForFile(f);
      if (p) paths.push(p);
    }
    if (!paths.length) {
      toast('Přetažené položky se nepodařilo přečíst', { type: 'error' });
      return;
    }
    await this.app.startTransfer({
      srcTarget: 'local', srcPaths: paths, dstTarget: this.target, dstDir: destDir, move: false
    });
    this.refresh();
  }

  /* ---------------- operace ---------------- */

  async openEntry(entry) {
    try {
      const res = await window.c3.files.openExternal(this.target, entry.path);
      if (!res.local) toast(`Otevřeno v editoru, změny se uloží zpět na server`, { type: 'ok' });
    } catch (e) {
      toast(`Nelze otevřít: ${e.message}`, { type: 'error' });
    }
  }

  async createFolder() {
    const name = await promptDialog({ title: 'Nový adresář', label: 'Název', value: 'nový adresář', okLabel: 'Vytvořit' });
    if (!name) return;
    try {
      await window.c3.files.mkdir(this.target, `${this.root.replace(/\/$/, '')}/${name}`);
      await this.refresh();
    } catch (e) { toast(`Nelze vytvořit adresář: ${e.message}`, { type: 'error' }); }
  }

  async renameSelected() {
    const sel = this.selectedEntries();
    if (sel.length !== 1) return;
    const name = await promptDialog({ title: 'Přejmenovat', label: 'Nový název', value: sel[0].name, okLabel: 'Přejmenovat' });
    if (!name || name === sel[0].name) return;
    try {
      await window.c3.files.rename(this.target, sel[0].path, `${parentOf(sel[0].path)}/${name}`.replace('//', '/'));
      await this.refresh();
    } catch (e) { toast(`Přejmenování selhalo: ${e.message}`, { type: 'error' }); }
  }

  async deleteSelected() {
    const sel = this.selectedEntries();
    if (!sel.length) return;
    if (this.app.settings.files.confirmDelete) {
      const ok = await confirmDialog({
        title: 'Smazat', danger: true, okLabel: 'Smazat',
        message: sel.length === 1 ? `Smazat „${sel[0].name}"?` : `Smazat ${sel.length} položek?`,
        detail: sel.slice(0, 8).map((s) => s.path).join('\n') + (sel.length > 8 ? '\n…' : '')
      });
      if (!ok) return;
    }
    try {
      await window.c3.files.remove(this.target, sel.map((s) => s.path));
      this.selection.clear();
      await this.refresh();
    } catch (e) { toast(`Mazání selhalo: ${e.message}`, { type: 'error' }); }
  }

  async chmodSelected() {
    const sel = this.selectedEntries();
    if (sel.length !== 1) return;
    const cur = (sel[0].mode || 0o644).toString(8).padStart(3, '0');
    const val = await promptDialog({ title: 'Změnit práva', label: `Oktalově pro ${sel[0].name}`, value: cur, okLabel: 'Nastavit' });
    if (!val) return;
    const mode = parseInt(val, 8);
    if (Number.isNaN(mode)) return toast('Neplatná hodnota', { type: 'error' });
    try {
      await window.c3.files.chmod(this.target, sel[0].path, mode);
      await this.refresh();
    } catch (e) { toast(`Nelze změnit práva: ${e.message}`, { type: 'error' }); }
  }

  async uploadDialog() {
    const paths = await window.c3.dialog.openFiles({ title: `Nahrát do ${this.root}` });
    if (!paths.length) return;
    await this.app.startTransfer({ srcTarget: 'local', srcPaths: paths, dstTarget: this.target, dstDir: this.root, move: false });
    this.refresh();
  }

  async downloadDialog() {
    const sel = this.selectedEntries();
    if (!sel.length) return toast('Nejdřív vyberte, co se má stáhnout');
    const dir = await window.c3.dialog.openDir({ title: 'Stáhnout do…' });
    if (!dir) return;
    await this.app.startTransfer({ srcTarget: this.target, srcPaths: sel.map((s) => s.path), dstTarget: 'local', dstDir: dir, move: false });
  }

  showItemMenu(x, y, entry) {
    const sel = this.selectedEntries();
    const one = sel.length === 1;
    const isDir = (entry.realType || entry.type) === 'dir';
    contextMenu(x, y, [
      { label: isDir ? 'Otevřít' : 'Otevřít v editoru', icon: isDir ? 'folderOpen' : 'externalLink', disabled: !one, action: () => this.onRowActivate(entry) },
      { label: 'Stáhnout do…', icon: 'download', action: () => this.downloadDialog() },
      { label: 'Nahrát sem…', icon: 'upload', disabled: !isDir, action: async () => {
          const paths = await window.c3.dialog.openFiles({ title: `Nahrát do ${entry.path}` });
          if (paths.length) { await this.app.startTransfer({ srcTarget: 'local', srcPaths: paths, dstTarget: this.target, dstDir: entry.path, move: false }); this.refresh(); }
        } },
      { separator: true },
      { label: 'Přejmenovat…', icon: 'pencil', accel: 'F2', disabled: !one, action: () => this.renameSelected() },
      { label: 'Změnit práva…', icon: 'lock', disabled: !one, action: () => this.chmodSelected() },
      { label: 'Nový adresář…', icon: 'folderPlus', action: () => this.createFolder() },
      { separator: true },
      { label: 'Kopírovat cestu', icon: 'copy', action: () => window.c3.clipboard.write(sel.map((s) => s.path).join('\n')) },
      { label: 'Vložit cestu do terminálu', icon: 'terminal', action: () => this.app.typeInTerminal(sel.map((s) => `'${s.path}'`).join(' ')) },
      isDir ? { label: 'Přejít v terminálu (cd)', icon: 'play', action: () => this.app.typeInTerminal(`cd '${entry.path}'\n`) } : null,
      { separator: true },
      { label: 'Obnovit', icon: 'refresh', accel: 'F5', action: () => this.refresh() },
      { label: 'Smazat', icon: 'trash', accel: 'Del', danger: true, action: () => this.deleteSelected() }
    ].filter(Boolean));
  }

  showBackgroundMenu(x, y) {
    contextMenu(x, y, [
      { label: 'Nový adresář…', icon: 'folderPlus', action: () => this.createFolder() },
      { label: 'Nahrát soubory…', icon: 'upload', action: () => this.uploadDialog() },
      { separator: true },
      { label: this.app.settings.files.showHidden ? 'Skrýt skryté soubory' : 'Zobrazit skryté soubory', icon: 'eye', action: () => this.toggleHidden() },
      { label: 'Kopírovat cestu adresáře', icon: 'copy', action: () => window.c3.clipboard.write(this.root) },
      { label: 'Obnovit', icon: 'refresh', accel: 'F5', action: () => this.refresh() }
    ]);
  }
}
