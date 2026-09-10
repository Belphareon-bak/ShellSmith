import defaults from '../../shared/defaults.js';
import { el, modal, confirmDialog, toast } from './ui.js';
import { icon } from './icons.js';
import { THEMES, themeList } from './themes.js';

const { SCHEMA, getPath } = defaults;

/** Malý náhled motivu – plocha, panel, akcent a pruh terminálu. */
function themePreview(id) {
  const t = THEMES[id];
  const sw = (bg, w) => el('span', { class: 'tp-band', style: { background: bg, width: w } });
  return el('div', { class: 'theme-preview', style: { background: t.ui['--bg'], borderColor: t.ui['--border'] } },
    el('div', { class: 'tp-title', style: { background: t.ui['--titlebar'] } },
      sw(t.ui['--accent'], '18px'), sw(t.ui['--text-faint'], '28px')),
    el('div', { class: 'tp-main' },
      el('div', { class: 'tp-side', style: { background: t.ui['--panel'] } },
        sw(t.ui['--text-dim'], '70%'), sw(t.ui['--text-faint'], '50%'), sw(t.ui['--text-faint'], '60%')),
      el('div', { class: 'tp-term', style: { background: t.term.background } },
        el('span', { class: 'tp-line', style: { color: t.term.green }, text: '$' }),
        el('span', { class: 'tp-line', style: { color: t.term.foreground }, text: 'ls -la' }),
        el('span', { class: 'tp-line', style: { color: t.term.blue }, text: 'src' }),
        el('span', { class: 'tp-line', style: { color: t.term.yellow }, text: 'build' })
      )
    )
  );
}

export async function openSettings(app, focusSection = null) {
  const nav = el('div', { class: 'settings-nav' });
  const pane = el('div', { class: 'settings-pane' });

  const renderField = (field) => {
    const value = getPath(app.settings, field.key);
    let input;

    if (field.type === 'bool') {
      input = el('input', { type: 'checkbox', checked: !!value });
      input.addEventListener('change', () => app.setSetting(field.key, input.checked));
      return el('label', { class: 'srow srow-check' },
        el('span', { class: 'srow-main' },
          el('span', { class: 'srow-label', text: field.label }),
          field.hint ? el('span', { class: 'srow-hint', text: field.hint }) : null),
        el('span', { class: 'switch' }, input, el('span', { class: 'switch-track' })));
    }

    if (field.type === 'theme') {
      const grid = el('div', { class: 'theme-grid' });
      for (const t of themeList()) {
        const card = el('div', {
          class: `theme-card ${app.settings.appearance.theme === t.id ? 'active' : ''}`,
          onClick: () => {
            app.setSetting('appearance.theme', t.id);
            for (const c of grid.children) c.classList.remove('active');
            card.classList.add('active');
          }
        },
          themePreview(t.id),
          el('div', { class: 'theme-name' },
            el('span', { text: t.name }),
            el('span', { class: 'theme-badge', text: t.dark ? 'tmavý' : 'světlý' })),
          el('div', { class: 'theme-desc', text: t.description })
        );
        grid.append(card);
      }
      return el('div', { class: 'srow srow-block' },
        el('span', { class: 'srow-label', text: field.label }), grid);
    }

    if (field.type === 'select') {
      input = el('select', { class: 'input' },
        ...field.options.map(([v, label]) => el('option', { value: v, selected: String(value) === String(v) }, label)));
      input.addEventListener('change', () => app.setSetting(field.key, input.value));
    } else if (field.type === 'number') {
      input = el('input', {
        class: 'input', type: 'number',
        min: field.min, max: field.max, step: field.step, value: String(value)
      });
      input.addEventListener('change', () => {
        let v = Number(input.value);
        if (Number.isNaN(v)) v = getPath(defaults.DEFAULTS, field.key);
        v = Math.min(field.max ?? v, Math.max(field.min ?? v, v));
        input.value = String(v);
        app.setSetting(field.key, v);
      });
    } else {
      input = el('input', { class: 'input', type: 'text', value: value == null ? '' : String(value), spellcheck: 'false' });
      input.addEventListener('change', () => app.setSetting(field.key, input.value));
    }

    return el('div', { class: 'srow' },
      el('span', { class: 'srow-main' },
        el('span', { class: 'srow-label', text: field.label }),
        field.hint ? el('span', { class: 'srow-hint', text: field.hint }) : null),
      el('span', { class: 'srow-control' }, input));
  };

  const showSection = (section) => {
    pane.innerHTML = '';
    pane.append(el('h3', { class: 'settings-h', text: section.title }));
    for (const f of section.fields) pane.append(renderField(f));
    for (const b of nav.children) b.classList.toggle('active', b.dataset.id === section.id);
  };

  for (const section of SCHEMA) {
    nav.append(el('button', {
      class: 'settings-navbtn', dataset: { id: section.id },
      onClick: () => showSection(section)
    }, el('span', { html: icon(section.icon === 'sliders' ? 'settings' : section.icon === 'mouse' ? 'monitor' : section.icon === 'palette' ? 'layers' : section.icon, 15) }),
      el('span', { text: section.title })));
  }

  const info = await window.c3.app.info();
  const about = el('div', { class: 'settings-about' },
    el('div', { text: `C3Term ${info.version} · Electron ${info.electron} · Chromium ${info.chrome}` }),
    el('div', { class: 'muted', text: `Nastavení: ${info.configDir}` }),
    el('div', { class: 'muted', text: `SSH agent: ${info.hasAgent ? 'dostupný' : 'není'} · klíčenka: ${info.secretsAvailable ? 'dostupná' : 'nedostupná'}` })
  );

  const body = el('div', { class: 'settings' }, nav, el('div', { class: 'settings-right' }, pane, about));

  showSection(SCHEMA.find((s) => s.id === focusSection) || SCHEMA[0]);

  const res = await modal({
    title: 'Nastavení', icon: 'settings', width: 860, body,
    buttons: [
      { id: 'reset', label: 'Obnovit výchozí' },
      { id: 'close', label: 'Hotovo', primary: true }
    ]
  });

  if (res === 'reset') {
    const ok = await confirmDialog({
      title: 'Obnovit výchozí nastavení', danger: true, okLabel: 'Obnovit',
      message: 'Všechna nastavení se vrátí do výchozího stavu.',
      detail: 'Uložené relace a přihlašovací údaje zůstanou zachovány.'
    });
    if (ok) {
      await app.resetSettings();
      toast('Nastavení obnoveno', { type: 'ok' });
    }
  }
}
