'use strict';

function saveLayout(node) {
  if (node.type === 'leaf') {
    const opts = { ...node.pane.opts };
    if (opts.kind === 'local' && node.pane.cwd) opts.cwd = node.pane.cwd;
    return { type: 'leaf', opts };
  }
  return { type: 'split', dir: node.dir, ratio: node.ratio, a: saveLayout(node.a), b: saveLayout(node.b) };
}

/** Načte i původní formát, který obsahoval jen opts prvního panelu. */
function readLayout(tab) {
  let leaves = 0;
  const read = (node, depth = 0) => {
    if (!node || depth > 12) throw new Error('Neplatné rozvržení panelů');
    if (node.type === 'leaf') {
      if (++leaves > 32 || !node.opts || !['local', 'ssh'].includes(node.opts.kind)) throw new Error('Neplatná uložená relace');
      return { type: 'leaf', opts: { ...node.opts } };
    }
    if (node.type !== 'split' || !['h', 'v'].includes(node.dir)) throw new Error('Neplatné rozdělení panelů');
    return {
      type: 'split', dir: node.dir,
      ratio: Number.isFinite(node.ratio) ? Math.max(0.1, Math.min(0.9, node.ratio)) : 0.5,
      a: read(node.a, depth + 1), b: read(node.b, depth + 1)
    };
  };
  return read(tab.layout || { type: 'leaf', opts: tab.opts });
}

module.exports = { saveLayout, readLayout };
