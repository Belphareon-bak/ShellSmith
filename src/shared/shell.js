'use strict';

/** Argument pro bash/zsh/POSIX shell posílaný přes interaktivní terminál. */
function quoteShellArg(value) {
  const text = String(value);
  // Řídicí znaky by interpretoval už terminál/readline, ještě před shellem.
  if (/[\x00-\x1f\x7f]/.test(text)) throw new Error('Cesta obsahuje řídicí znaky a nelze ji vložit do terminálu');
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

function parseSshUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'ssh:' || !url.hostname || url.password || url.search || url.hash) {
    throw new Error('Očekává se ssh://user@host:port/cesta bez hesla');
  }
  const port = url.port ? Number(url.port) : 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Neplatný SSH port');
  const username = decodeURIComponent(url.username);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const path = decodeURIComponent(url.pathname);
  quoteShellArg(path);
  if (/[\x00-\x20\x7f]/.test(username + host)) throw new Error('Neplatný uživatel nebo server');
  return { username, host, port, path };
}

module.exports = { quoteShellArg, parseSshUrl };
