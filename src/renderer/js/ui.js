import { icon } from './icons.js';

/* ------------------------------------------------------------------ */
/* DOM pomocníci                                                       */
/* ------------------------------------------------------------------ */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------ */
/* Formátování                                                         */
/* ------------------------------------------------------------------ */

export function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatSpeed(bps) {
  return bps ? `${formatSize(bps)}/s` : '';
}

export function formatTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const p = (n) => String(n).padStart(2, '0');
  return sameYear
    ? `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`
    : `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ */
/* Toasty                                                              */
/* ------------------------------------------------------------------ */

let toastHost = null;
export function toast(message, opts = {}) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const type = opts.type || 'info';
  const node = el('div', { class: `toast toast-${type}` },
    el('span', { class: 'toast-ico', html: icon(type === 'error' ? 'alert' : type === 'ok' ? 'check' : 'bolt', 16) }),
    el('span', { class: 'toast-msg', text: message })
  );
  node.addEventListener('click', () => node.remove());
  toastHost.append(node);
  const ttl = opts.timeout != null ? opts.timeout : (type === 'error' ? 8000 : 4000);
  if (ttl > 0) setTimeout(() => { node.classList.add('leaving'); setTimeout(() => node.remove(), 220); }, ttl);
  return node;
}

/* ------------------------------------------------------------------ */
/* Modální dialogy                                                     */
/* ------------------------------------------------------------------ */

let openModals = 0;

export function modal(opts = {}) {
  const { title = '', icon: ic = null, width = 460, body = null, buttons = [], onOpen = null, dismissable = true } = opts;
  let resolveFn;
  const promise = new Promise((r) => { resolveFn = r; });

  const bodyEl = el('div', { class: 'modal-body' });
  if (body instanceof Node) bodyEl.append(body);
  else if (typeof body === 'string') bodyEl.innerHTML = body;

  const footer = el('div', { class: 'modal-footer' });
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal', style: { width: `${width}px` } },
    el('div', { class: 'modal-head' },
      ic ? el('span', { class: 'modal-ico', html: icon(ic, 18) }) : null,
      el('div', { class: 'modal-title', text: title }),
      dismissable ? el('button', { class: 'icon-btn', title: 'Zavřít', html: icon('close', 16), onClick: () => done(null) }) : null
    ),
    bodyEl, footer
  );

  let finished = false;
  function done(result) {
    if (finished) return;
    finished = true;
    openModals--;
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.add('leaving');
    setTimeout(() => overlay.remove(), 140);
    resolveFn(result);
  }

  for (const b of buttons) {
    footer.append(el('button', {
      class: `btn ${b.primary ? 'btn-primary' : ''} ${b.danger ? 'btn-danger' : ''}`.trim(),
      text: b.label,
      onClick: () => done(b.id)
    }));
  }

  function onKey(e) {
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); e.preventDefault(); done(null); }
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      const def = buttons.find((b) => b.primary);
      if (def) { e.stopPropagation(); e.preventDefault(); done(def.id); }
    }
  }

  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && dismissable) done(null); });
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  openModals++;

  requestAnimationFrame(() => {
    // Fokus patří prvnímu poli, ne křížku v záhlaví – pořadí selektorů rozhoduje.
    let focusable = null;
    for (const sel of ['.modal-body input:not([type=checkbox])', '.modal-body textarea',
                       '.modal-body select', 'button.btn-primary', '.modal-body button']) {
      focusable = box.querySelector(sel);
      if (focusable) break;
    }
    if (focusable) focusable.focus();
    if (onOpen) onOpen({ box, body: bodyEl, close: done });
  });

  return Object.assign(promise, { close: done, box, bodyEl });
}

export async function confirmDialog({ title = 'Potvrzení', message = '', detail = '', okLabel = 'Potvrdit', danger = false }) {
  const body = el('div', {},
    el('p', { class: 'modal-message', text: message }),
    detail ? el('p', { class: 'modal-detail', text: detail }) : null
  );
  const r = await modal({
    title, icon: danger ? 'alert' : null, body, width: 440,
    buttons: [{ id: 'cancel', label: 'Zrušit' }, { id: 'ok', label: okLabel, primary: true, danger }]
  });
  return r === 'ok';
}

export async function promptDialog({ title = '', label = '', value = '', placeholder = '', okLabel = 'OK', selectAll = true }) {
  const input = el('input', { class: 'input', type: 'text', value, placeholder });
  const body = el('div', { class: 'form' },
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), input));
  const r = await modal({
    title, body, width: 440,
    buttons: [{ id: 'cancel', label: 'Zrušit' }, { id: 'ok', label: okLabel, primary: true }],
    onOpen: () => { input.focus(); if (selectAll) input.select(); }
  });
  return r === 'ok' ? input.value : null;
}

/* ------------------------------------------------------------------ */
/* Kontextové menu                                                     */
/* ------------------------------------------------------------------ */

let activeMenu = null;

export function closeContextMenu() {
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
}

export function contextMenu(x, y, items) {
  closeContextMenu();
  const menu = el('div', { class: 'ctx-menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.separator) { menu.append(el('div', { class: 'ctx-sep' })); continue; }
    const row = el('div', {
      class: `ctx-item ${it.disabled ? 'disabled' : ''} ${it.danger ? 'danger' : ''}`.trim(),
      onClick: () => {
        if (it.disabled) return;
        closeContextMenu();
        it.action && it.action();
      }
    },
      el('span', { class: 'ctx-ico', html: it.icon ? icon(it.icon, 15) : (it.checked ? icon('check', 15) : '') }),
      el('span', { class: 'ctx-label', text: it.label }),
      it.accel ? el('span', { class: 'ctx-accel', text: it.accel }) : null
    );
    menu.append(row);
  }
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 8);
  const py = Math.min(y, window.innerHeight - r.height - 8);
  menu.style.left = `${Math.max(4, px)}px`;
  menu.style.top = `${Math.max(4, py)}px`;
  activeMenu = menu;

  const off = (e) => {
    if (activeMenu && !activeMenu.contains(e.target)) { closeContextMenu(); cleanup(); }
  };
  const onEsc = (e) => { if (e.key === 'Escape') { closeContextMenu(); cleanup(); } };
  const cleanup = () => {
    document.removeEventListener('mousedown', off, true);
    document.removeEventListener('keydown', onEsc, true);
    window.removeEventListener('blur', closeContextMenu);
  };
  setTimeout(() => {
    document.addEventListener('mousedown', off, true);
    document.addEventListener('keydown', onEsc, true);
    window.addEventListener('blur', closeContextMenu);
  }, 0);
  return menu;
}

export const hasOpenModal = () => openModals > 0;
