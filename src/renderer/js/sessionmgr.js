import { el, modal, contextMenu, confirmDialog, toast } from './ui.js';
import { icon } from './icons.js';

const uid = () => 'sess-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Rozdělí uložené relace do stromu podle pole `folder` ("Produkce/Web"). */
function buildTree(items) {
  const root = { name: '', path: '', folders: new Map(), items: [] };
  for (const it of items) {
    const parts = (it.folder || '').split('/').map((s) => s.trim()).filter(Boolean);
    let node = root;
    let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path, folders: new Map(), items: [] });
      node = node.folders.get(part);
    }
    node.items.push(it);
  }
  return root;
}

export class SessionManagerPanel {
  constructor(app) {
    this.app = app;
    this.items = [];
    this.collapsed = new Set();
    this.filter = '';
    this.buildDom();
  }

  buildDom() {
    this.search = el('input', {
      class: 'filter-input wide', type: 'text', placeholder: 'Hledat relaci…', spellcheck: 'false',
      onInput: () => { this.filter = this.search.value.toLowerCase(); this.render(); },
      onKeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { this.search.value = ''; this.filter = ''; this.render(); }
        if (e.key === 'Enter') {
          const first = this.visibleItems()[0];
          if (first) this.app.connectSaved(first);
        }
      }
    });

    this.quick = el('input', {
      class: 'input quick-input', type: 'text', spellcheck: 'false',
      placeholder: 'rychlé připojení: user@host:port',
      onKeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.quickConnect();
      }
    });

    this.list = el('div', { class: 'slist' });

    this.root_el = el('div', { class: 'spanel' },
      el('div', { class: 'spanel-head' },
        this.search,
        el('button', { class: 'icon-btn', title: 'Nová relace (Ctrl+Shift+N)', html: icon('plus', 16), onClick: () => this.editSession(null) })
      ),
      el('div', { class: 'quick-row' },
        el('span', { class: 'quick-ico', html: icon('bolt', 14) }),
        this.quick,
        el('button', { class: 'icon-btn', title: 'Připojit', html: icon('play', 14), onClick: () => this.quickConnect() })
      ),
      this.list
    );
  }

  async load() {
    this.items = await window.c3.saved.list();
    this.render();
  }

  async persist() {
    await window.c3.saved.replace(this.items);
    this.render();
  }

  visibleItems() {
    if (!this.filter) return this.items;
    return this.items.filter((i) =>
      [i.name, i.host, i.username, i.folder].filter(Boolean).join(' ').toLowerCase().includes(this.filter));
  }

  render() {
    const tree = buildTree(this.visibleItems());
    this.list.innerHTML = '';
    if (!this.items.length) {
      this.list.append(el('div', { class: 'slist-empty' },
        el('div', { html: icon('server', 26) }),
        el('p', { text: 'Zatím žádné uložené relace.' }),
        el('button', { class: 'btn btn-primary', text: 'Vytvořit první', onClick: () => this.editSession(null) })
      ));
      return;
    }
    this.renderNode(tree, 0, this.list);
    if (this.filter && !this.visibleItems().length) {
      this.list.append(el('div', { class: 'slist-empty' }, el('p', { text: 'Nic neodpovídá hledání.' })));
    }
  }

  renderNode(node, depth, host) {
    const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    for (const f of folders) {
      const isCollapsed = this.collapsed.has(f.path) && !this.filter;
      const count = this.countItems(f);
      host.append(el('div', {
        class: 'sfolder',
        style: { paddingLeft: `${6 + depth * 12}px` },
        onClick: () => {
          if (this.collapsed.has(f.path)) this.collapsed.delete(f.path); else this.collapsed.add(f.path);
          this.render();
        }
      },
        el('span', { class: 'row-chevron', html: icon(isCollapsed ? 'chevronRight' : 'chevronDown', 13) }),
        el('span', { class: 'row-ico', html: icon(isCollapsed ? 'folder' : 'folderOpen', 15) }),
        el('span', { class: 'row-name', text: f.name }),
        el('span', { class: 'sfolder-count', text: String(count) })
      ));
      if (!isCollapsed) this.renderNode(f, depth + 1, host);
    }
    const items = [...node.items].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'cs'));
    for (const it of items) host.append(this.renderItem(it, depth));
  }

  countItems(node) {
    let n = node.items.length;
    for (const f of node.folders.values()) n += this.countItems(f);
    return n;
  }

  renderItem(it, depth) {
    const sub = it.kind === 'local'
      ? (it.shell || 'lokální shell')
      : `${it.username ? it.username + '@' : ''}${it.host}${it.port && it.port !== 22 ? ':' + it.port : ''}`;
    return el('div', {
      class: 'sitem',
      style: { paddingLeft: `${6 + depth * 12}px` },
      title: `${it.name}\n${sub}`,
      onDblclick: () => this.app.connectSaved(it),
      onClick: (e) => { if (e.detail === 1) this.selectItem(it.id); },
      onContextmenu: (e) => { e.preventDefault(); this.selectItem(it.id); this.showMenu(e.clientX, e.clientY, it); }
    },
      el('span', { class: 'row-ico', html: icon(it.kind === 'local' ? 'terminal' : 'server', 15) }),
      el('span', { class: 'sitem-text' },
        el('span', { class: 'row-name', text: it.name || it.host }),
        el('span', { class: 'sitem-sub', text: sub })
      ),
      el('button', {
        class: 'icon-btn tiny', title: 'Připojit', html: icon('play', 13),
        onClick: (e) => { e.stopPropagation(); this.app.connectSaved(it); }
      })
    );
  }

  selectItem(id) {
    for (const n of this.list.querySelectorAll('.sitem')) n.classList.remove('selected');
    this.selected = id;
    const items = [...this.list.querySelectorAll('.sitem')];
    const idx = this.visibleItems().findIndex((i) => i.id === id);
    if (idx >= 0 && items[idx]) items[idx].classList.add('selected');
  }

  showMenu(x, y, it) {
    contextMenu(x, y, [
      { label: 'Připojit', icon: 'play', action: () => this.app.connectSaved(it) },
      { label: 'Připojit a rozdělit', icon: 'splitV', action: () => this.app.connectSaved(it, { split: 'v' }) },
      { separator: true },
      { label: 'Upravit…', icon: 'pencil', action: () => this.editSession(it) },
      { label: 'Duplikovat', icon: 'copy', action: () => this.duplicate(it) },
      { label: 'Zapomenout uložené heslo', icon: 'lock', action: () => this.forgetSecrets(it) },
      { separator: true },
      { label: 'Smazat', icon: 'trash', danger: true, action: () => this.remove(it) }
    ]);
  }

  async quickConnect() {
    const raw = this.quick.value.trim();
    if (!raw) return;
    const m = /^(?:([^@\s]+)@)?([^\s:]+)(?::(\d+))?$/.exec(raw);
    if (!m) return toast('Očekává se tvar user@host nebo host:port', { type: 'error' });
    const cfg = {
      kind: 'ssh', host: m[2], port: Number(m[3]) || 22,
      username: m[1] || '', authType: m[1] ? 'agent' : 'agent',
      name: raw
    };
    this.quick.value = '';
    this.app.connectSaved(cfg);
  }

  async duplicate(it) {
    const copy = Object.assign({}, it, { id: uid(), name: `${it.name} (kopie)` });
    this.items.push(copy);
    await this.persist();
  }

  async remove(it) {
    const ok = await confirmDialog({
      title: 'Smazat relaci', danger: true, okLabel: 'Smazat',
      message: `Opravdu smazat „${it.name}"?`
    });
    if (!ok) return;
    this.items = this.items.filter((i) => i.id !== it.id);
    await window.c3.secret.remove(`${it.id}:password`).catch(() => {});
    await window.c3.secret.remove(`${it.id}:passphrase`).catch(() => {});
    await this.persist();
  }

  async forgetSecrets(it) {
    await window.c3.secret.remove(`${it.id}:password`).catch(() => {});
    await window.c3.secret.remove(`${it.id}:passphrase`).catch(() => {});
    toast('Uložené přihlašovací údaje smazány', { type: 'ok' });
  }

  /* ---------------- editor relace ---------------- */

  async editSession(existing) {
    const it = Object.assign({
      id: uid(), name: '', folder: '', kind: 'ssh', host: '', port: 22,
      username: '', authType: 'agent', keyPath: '', proxyJump: '',
      shell: '', cwd: '', initialCommand: ''
    }, existing || {});
    const isNew = !existing;

    const f = {};
    const field = (label, node, hint) => el('label', { class: 'field' },
      el('span', { class: 'field-label', text: label }), node,
      hint ? el('span', { class: 'field-hint', text: hint }) : null);

    f.name = el('input', { class: 'input', value: it.name, placeholder: 'např. Produkční web' });
    f.folder = el('input', { class: 'input', value: it.folder, placeholder: 'např. Produkce/Web', list: 'folder-list' });
    const folderList = el('datalist', { id: 'folder-list' },
      ...[...new Set(this.items.map((i) => i.folder).filter(Boolean))].map((v) => el('option', { value: v })));

    f.kind = el('select', { class: 'input' },
      el('option', { value: 'ssh', selected: it.kind === 'ssh' }, 'SSH'),
      el('option', { value: 'local', selected: it.kind === 'local' }, 'Lokální shell'));

    f.host = el('input', { class: 'input', value: it.host, placeholder: 'server.example.com' });
    f.port = el('input', { class: 'input', type: 'number', min: '1', max: '65535', value: String(it.port || 22) });
    f.username = el('input', { class: 'input', value: it.username, placeholder: 'root' });

    f.authType = el('select', { class: 'input' },
      el('option', { value: 'agent', selected: it.authType === 'agent' }, 'SSH agent / výchozí klíče'),
      el('option', { value: 'key', selected: it.authType === 'key' }, 'Soubor s privátním klíčem'),
      el('option', { value: 'password', selected: it.authType === 'password' }, 'Heslo'));

    f.keyPath = el('input', { class: 'input', value: it.keyPath, placeholder: '~/.ssh/id_ed25519' });
    const browseKey = el('button', {
      class: 'btn btn-slim', text: 'Procházet…',
      onClick: async () => {
        const p = await window.c3.dialog.openFiles({ title: 'Vyberte privátní klíč', properties: ['openFile', 'showHiddenFiles'] });
        if (p.length) f.keyPath.value = p[0];
      }
    });

    f.password = el('input', { class: 'input', type: 'password', placeholder: existing ? '(beze změny)' : '' });
    f.savePassword = el('input', { type: 'checkbox', checked: true });

    f.proxyJump = el('select', { class: 'input' },
      el('option', { value: '' }, '— přímé připojení —'),
      ...this.items.filter((i) => i.kind === 'ssh' && i.id !== it.id)
        .map((i) => el('option', { value: i.id, selected: it.proxyJump === i.id }, `${i.name} (${i.host})`)));

    f.shell = el('input', { class: 'input', value: it.shell, placeholder: 'prázdné = $SHELL' });
    f.cwd = el('input', { class: 'input', value: it.cwd, placeholder: 'prázdné = domovský adresář' });
    f.initialCommand = el('input', { class: 'input', value: it.initialCommand, placeholder: 'např. sudo -i' });

    const sshBox = el('div', { class: 'form-group' },
      el('div', { class: 'form-row' }, field('Server', f.host), field('Port', f.port, '')),
      field('Uživatel', f.username),
      field('Ověření', f.authType),
      el('div', { class: 'auth-key', hidden: it.authType !== 'key' },
        field('Privátní klíč', el('div', { class: 'row-inline' }, f.keyPath, browseKey))),
      el('div', { class: 'auth-pass', hidden: it.authType !== 'password' },
        field('Heslo', f.password),
        el('label', { class: 'check-row' }, f.savePassword,
          el('span', { text: 'Uložit do klíčenky systému' }))),
      field('Přes jump host', f.proxyJump)
    );

    const localBox = el('div', { class: 'form-group', hidden: it.kind !== 'local' },
      field('Shell', f.shell),
      field('Výchozí adresář', f.cwd));

    const syncKind = () => {
      const ssh = f.kind.value === 'ssh';
      sshBox.hidden = !ssh;
      localBox.hidden = ssh;
    };
    const syncAuth = () => {
      sshBox.querySelector('.auth-key').hidden = f.authType.value !== 'key';
      sshBox.querySelector('.auth-pass').hidden = f.authType.value !== 'password';
    };
    f.kind.addEventListener('change', syncKind);
    f.authType.addEventListener('change', syncAuth);
    syncKind(); syncAuth();

    const body = el('div', { class: 'form' },
      folderList,
      el('div', { class: 'form-row' }, field('Název', f.name), field('Složka', f.folder)),
      field('Typ', f.kind),
      sshBox, localBox,
      field('Příkaz po připojení', f.initialCommand, 'Odešle se do shellu hned po startu relace')
    );

    const res = await modal({
      title: isNew ? 'Nová relace' : `Upravit „${it.name}"`,
      icon: 'server', width: 560, body,
      buttons: [{ id: 'cancel', label: 'Zrušit' }, { id: 'save', label: isNew ? 'Vytvořit' : 'Uložit', primary: true }]
    });
    if (res !== 'save') return null;

    const next = {
      id: it.id,
      name: f.name.value.trim() || f.host.value.trim() || 'Bez názvu',
      folder: f.folder.value.trim(),
      kind: f.kind.value,
      host: f.host.value.trim(),
      port: Number(f.port.value) || 22,
      username: f.username.value.trim(),
      authType: f.authType.value,
      keyPath: f.keyPath.value.trim(),
      proxyJump: f.proxyJump.value,
      shell: f.shell.value.trim(),
      cwd: f.cwd.value.trim(),
      initialCommand: f.initialCommand.value
    };

    if (next.kind === 'ssh' && !next.host) {
      toast('Bez adresy serveru relaci uložit nelze', { type: 'error' });
      return null;
    }

    if (f.authType.value === 'password' && f.password.value && f.savePassword.checked) {
      const stored = await window.c3.secret.set(`${next.id}:password`, f.password.value);
      if (!stored) toast('Klíčenka není dostupná, heslo se neuložilo – budete dotázáni při připojení', { type: 'error' });
    }

    const idx = this.items.findIndex((i) => i.id === next.id);
    if (idx >= 0) this.items[idx] = next; else this.items.push(next);
    await this.persist();
    toast(isNew ? 'Relace vytvořena' : 'Relace uložena', { type: 'ok' });
    return next;
  }
}
