'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const pty = require('node-pty');
const { Client } = require('ssh2');
const store = require('./store');

let seq = 0;
const nextId = () => `s${++seq}-${Date.now().toString(36)}`;

/* ------------------------------------------------------------------ */
/* Sledování pracovního adresáře (OSC 7)                               */
/* ------------------------------------------------------------------ */

// Vytáhne poslední OSC 7 sekvenci  ESC ] 7 ; file://host/cesta  BEL|ST
const OSC7 = /\u001b\]7;file:\/\/([^/\u0007\u001b]*)((?:\/[^\u0007\u001b]*)?)(?:\u0007|\u001b\\)/g;
function extractCwd(chunk) {
  let m, last = null;
  OSC7.lastIndex = 0;
  while ((m = OSC7.exec(chunk)) !== null) last = m[2] || '/';
  if (!last) return null;
  try { return decodeURIComponent(last); } catch (_) { return last; }
}

/* ------------------------------------------------------------------ */
/* Základ relace                                                       */
/* ------------------------------------------------------------------ */

class BaseSession extends EventEmitter {
  constructor(opts) {
    super();
    this.id = nextId();
    this.title = opts.title || 'session';
    this.kind = 'base';
    this.status = 'starting';
    this.statusDetail = null;
    this.cwd = null;
    this.cols = opts.cols || 80;
    this.rows = opts.rows || 24;
    this.config = opts;
    this.createdAt = Date.now();
    this.closed = false;
    this._ready = null;
    this._readyRes = null;
    this._readyRej = null;
  }

  /**
   * Příslib, který se splní, jakmile je relace opravdu připojená.
   * Bez něj by panel souborů otevřel SFTP kanál ještě během výměny klíčů –
   * server v režimu strict KEX takové spojení okamžitě ukončí.
   */
  ready() {
    if (this.status === 'connected') return Promise.resolve();
    if (this.closed) return Promise.reject(new Error('Relace není připojená'));
    if (!this._ready) {
      this._ready = new Promise((res, rej) => { this._readyRes = res; this._readyRej = rej; });
    }
    return this._ready;
  }

  setStatus(status, detail) {
    if (this.closed && status !== 'closed') return;
    this.status = status;
    this.statusDetail = detail || null;
    if (status === 'connected' && this._readyRes) { this._readyRes(); this._readyRes = null; this._readyRej = null; }
    if ((status === 'closed' || status === 'error') && this._readyRej) {
      this._readyRej(new Error(detail || 'Relace skončila'));
      this._readyRes = null; this._readyRej = null;
    }
    this.emit('status', { status, detail: detail || null });
  }

  pushData(chunk) {
    const cwd = extractCwd(chunk);
    if (cwd && cwd !== this.cwd) { this.cwd = cwd; this.emit('cwd', cwd); }
    this.emit('data', chunk);
  }

  info() {
    return {
      id: this.id, kind: this.kind, title: this.title,
      status: this.status, detail: this.statusDetail || null,
      cwd: this.cwd, cols: this.cols, rows: this.rows,
      host: this.config.host || null, username: this.config.username || null,
      sessionRef: this.config.sessionRef || null,
      supportsFiles: this.kind === 'ssh' || this.kind === 'local'
    };
  }
}

/* ------------------------------------------------------------------ */
/* Lokální terminál                                                    */
/* ------------------------------------------------------------------ */

class LocalSession extends BaseSession {
  constructor(opts) {
    super(opts);
    this.kind = 'local';
  }

  start() {
    const settings = store.getSettings();
    const shell = this.config.shell || settings.behavior.defaultShell || process.env.SHELL || '/bin/bash';
    const cwd = this.config.cwd || settings.files.defaultLocalDir || os.homedir();
    const env = Object.assign({}, process.env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'ShellSmith'
    });
    delete env.ELECTRON_RUN_AS_NODE;

    const args = this.config.args || (/(^|\/)(bash|zsh|sh)$/.test(shell) ? ['-l'] : []);
    try {
      this.spawnPty(shell, args, cwd, env);
    } catch (e) {
      this.setStatus('error', `Nelze spustit ${shell}: ${e.message}`);
      this.closed = true;
      setTimeout(() => this.emit('exit', { code: null, error: e.message }), 0);
      return this;
    }
    this.title = this.config.title || path.basename(shell);
    this.cwd = cwd;
    this.setStatus('connected');

    this.proc.onData((d) => this.pushData(d));
    this.proc.onExit(({ exitCode, signal }) => {
      this.setStatus('closed', signal ? `signál ${signal}` : `kód ${exitCode}`);
      this.closed = true;
      this.emit('exit', { code: exitCode, signal });
    });

    // Lokálně umíme přečíst skutečný cwd shellu z /proc – bez injektáže do shellu.
    this.cwdTimer = setInterval(() => this.pollCwd(), 1000);
    this.pollCwd();
    if (this.config.initialCommand && String(this.config.initialCommand).trim()) {
      setTimeout(() => this.write(String(this.config.initialCommand).replace(/\n?$/, '\n')), 400);
    }
    return this;
  }

  spawnPty(shell, args, cwd, env) {
    this.proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: this.cols, rows: this.rows,
      cwd: fs.existsSync(cwd) ? cwd : os.homedir(),
      env
    });
  }

  pollCwd() {
    if (!this.proc || this.closed) return;
    try {
      const p = fs.readlinkSync(`/proc/${this.proc.pid}/cwd`);
      if (p && p !== this.cwd) { this.cwd = p; this.emit('cwd', p); }
    } catch (_) { /* proces skončil nebo jiná platforma */ }
  }

  write(data) { if (this.proc && !this.closed) this.proc.write(data); }

  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    try { if (this.proc && !this.closed) this.proc.resize(cols, rows); } catch (_) {}
  }

  close() {
    this.closed = true;
    clearInterval(this.cwdTimer);
    try { this.proc && this.proc.kill(); } catch (_) {}
  }
}

/* ------------------------------------------------------------------ */
/* Ověření host key proti vlastnímu known_hosts                        */
/* ------------------------------------------------------------------ */

/** Značka, kterou vzdálená strana potvrdí nastavení hooku. */
const HOOK_MARKER = '\u001b]777;ss\u0007';

const KNOWN_HOSTS = 'known_hosts.json';
function knownHostsRead() {
  try { return JSON.parse(fs.readFileSync(path.join(store.configDir(), KNOWN_HOSTS), 'utf8')); }
  catch (_) { return {}; }
}
function knownHostsWrite(db) {
  const p = path.join(store.configDir(), KNOWN_HOSTS);
  fs.writeFileSync(p + '.tmp', JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(p + '.tmp', p);
}
function fingerprint(key) {
  return crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

/* ------------------------------------------------------------------ */
/* SSH relace                                                          */
/* ------------------------------------------------------------------ */

class SshSession extends BaseSession {
  constructor(opts) {
    super(opts);
    this.kind = 'ssh';
    this.title = opts.title || `${opts.username || ''}@${opts.host}`;
    this.client = null;
    this.stream = null;
    this.sftpClient = null;
    this.sftpPending = null;
    this.hopClients = [];
    this.capture = null;
  }

  /** Renderer se ptá uživatele (heslo, 2FA, důvěra k host key). */
  ask(request) {
    return new Promise((resolve) => {
      const promptId = nextId();
      this._pending = this._pending || new Map();
      this._pending.set(promptId, resolve);
      this.emit('prompt', Object.assign({ promptId }, request));
    });
  }

  promptReply(promptId, answers) {
    if (this._pending && this._pending.has(promptId)) {
      const resolve = this._pending.get(promptId);
      this._pending.delete(promptId);
      resolve(answers);
    }
  }

  async start() {
    this.setStatus('connecting');
    try {
      const sock = this.config.proxyJump ? await this.openJump(this.config.proxyJump) : null;
      await this.connectClient(this.config, sock);
      await this.openShell();
    } catch (err) {
      this.setStatus('error', err && err.message ? err.message : String(err));
      this.emit('exit', { code: null, error: String(err && err.message || err) });
      this.closed = true;
    }
    return this;
  }

  /** Naváže spojení přes uložený jump host a vrátí tunelovaný socket. */
  async openJump(refId) {
    const saved = (store.getSessions().items || []).find((s) => s.id === refId);
    if (!saved) throw new Error(`Jump host "${refId}" není mezi uloženými relacemi`);
    this.setStatus('connecting', `přes ${saved.host}`);
    const hop = new Client();
    this.hopClients.push(hop);
    await this.connectClient(Object.assign({}, saved, { sessionRef: saved.id }), null, hop);
    return await new Promise((resolve, reject) => {
      hop.forwardOut('127.0.0.1', 0, this.config.host, Number(this.config.port) || 22, (err, stream) => {
        if (err) reject(new Error(`Jump host: ${err.message}`)); else resolve(stream);
      });
    });
  }

  async connectClient(cfg, sock, clientOverride) {
    const settings = store.getSettings();
    const client = clientOverride || new Client();
    if (!clientOverride) this.client = client;

    const opts = {
      host: cfg.host,
      port: Number(cfg.port) || 22,
      username: cfg.username || os.userInfo().username,
      readyTimeout: (settings.ssh.connectTimeout || 20) * 1000,
      keepaliveInterval: (settings.ssh.keepaliveInterval || 0) * 1000,
      keepaliveCountMax: settings.ssh.keepaliveCountMax || 6,
      tryKeyboard: true,
      sock: sock || undefined,
      hostVerifier: undefined,
      // SHELLSMITH_DEBUG=1 vypíše celý průběh SSH spojení – k diagnostice připojení.
      debug: process.env.SHELLSMITH_DEBUG ? (m) => console.error('[ssh2]', m) : undefined
    };

    // --- ověření klíče serveru -------------------------------------
    const hostKeyId = `${opts.host}:${opts.port}`;
    opts.hostVerifier = (key, callback) => {
      const fp = fingerprint(key);
      const db = knownHostsRead();
      const known = db[hostKeyId];
      if (known && known.fp === fp) return callback(true);
      const changed = !!known;
      this.ask({
        type: 'hostkey',
        title: changed ? 'Klíč serveru se ZMĚNIL' : 'Neznámý server',
        host: hostKeyId,
        fingerprint: `SHA256:${fp}`,
        previous: known ? `SHA256:${known.fp}` : null,
        changed
      }).then((ans) => {
        if (!ans || ans.decision === 'reject') return callback(false);
        if (ans.decision === 'accept') {
          db[hostKeyId] = { fp, at: Date.now() };
          try { knownHostsWrite(db); } catch (e) { console.error('[ssh] known_hosts:', e.message); }
        }
        callback(true); // 'once' i 'accept' pokračují
      }).catch(() => callback(false));
    };

    // --- autentizace ------------------------------------------------
    const authType = cfg.authType || 'agent';
    if (authType === 'agent' || settings.ssh.agentForward) {
      if (process.env.SSH_AUTH_SOCK) {
        opts.agent = process.env.SSH_AUTH_SOCK;
        opts.agentForward = !!settings.ssh.agentForward;
      }
    }
    if (authType === 'key') {
      const keyPath = (cfg.keyPath || '').replace(/^~/, os.homedir());
      if (!keyPath) throw new Error('Není zadána cesta k privátnímu klíči');
      opts.privateKey = fs.readFileSync(keyPath);
      let pass = cfg.sessionRef ? store.getSecret(`${cfg.sessionRef}:passphrase`) : null;
      if (!pass && /ENCRYPTED/.test(opts.privateKey.toString('utf8', 0, 200))) {
        const ans = await this.ask({
          type: 'input', title: 'Privátní klíč je zašifrovaný',
          detail: path.basename(keyPath),
          prompts: [{ prompt: 'Passphrase', echo: false }],
          allowRemember: !!cfg.sessionRef
        });
        if (!ans || ans.cancelled) throw new Error('Připojení zrušeno uživatelem');
        pass = ans.answers[0];
        if (ans.remember && cfg.sessionRef) store.setSecret(`${cfg.sessionRef}:passphrase`, pass);
      }
      if (pass) opts.passphrase = pass;
    }
    if (authType === 'password') {
      let pw = cfg.sessionRef ? store.getSecret(`${cfg.sessionRef}:password`) : null;
      if (!pw) {
        const ans = await this.ask({
          type: 'input', title: `Heslo pro ${opts.username}@${opts.host}`,
          prompts: [{ prompt: 'Heslo', echo: false }],
          allowRemember: !!cfg.sessionRef
        });
        if (!ans || ans.cancelled) throw new Error('Připojení zrušeno uživatelem');
        pw = ans.answers[0];
        if (ans.remember && cfg.sessionRef) store.setSecret(`${cfg.sessionRef}:password`, pw);
      }
      opts.password = pw;
    }

    client.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      // Jednoduchý případ „jen heslo“ vyřídíme uloženým heslem bez ptaní.
      const saved = cfg.sessionRef ? store.getSecret(`${cfg.sessionRef}:password`) : null;
      if (saved && prompts.length === 1 && /password|heslo/i.test(prompts[0].prompt)) return finish([saved]);
      this.ask({
        type: 'input',
        title: name || 'Ověření',
        detail: instructions || `${opts.username}@${opts.host}`,
        prompts: prompts.map((p) => ({ prompt: p.prompt, echo: !!p.echo })),
        allowRemember: false
      }).then((ans) => finish(ans && !ans.cancelled ? ans.answers : []));
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
      client.once('ready', () => done(resolve));
      client.once('error', (err) => done(reject, err));
      client.once('close', () => done(reject, new Error('Spojení bylo uzavřeno před přihlášením')));
      client.connect(opts);
    });

    if (!clientOverride) {
      client.on('error', (err) => {
        if (this.closed) return;
        this.setStatus('error', err.message);
      });
      client.on('close', () => {
        if (this.closed) return;
        this.closed = true;
        this.setStatus('closed', 'spojení ukončeno');
        this.emit('exit', { code: null });
      });
    }
    return client;
  }

  openShell() {
    const settings = store.getSettings();
    return new Promise((resolve, reject) => {
      this.client.shell({
        term: settings.ssh.termType || 'xterm-256color',
        cols: this.cols, rows: this.rows,
        modes: {}
      }, (err, stream) => {
        if (err) return reject(err);
        this.stream = stream;
        this.setStatus('connected');
        stream.on('data', (d) => this.pushData(d.toString('utf8')));
        stream.stderr && stream.stderr.on('data', (d) => this.pushData(d.toString('utf8')));
        stream.on('close', () => {
          if (this.closed) return;
          this.closed = true;
          this.setStatus('closed', 'shell ukončen');
          this.emit('exit', { code: 0 });
          try { this.client.end(); } catch (_) {}
        });
        if (settings.ssh.injectOsc7) this.injectCwdHook();
        else this.afterStartup();
        resolve(stream);
      });
    });
  }

  /**
   * Nastaví na vzdálené straně hook, který po každém promptu ohlásí pracovní
   * adresář sekvencí OSC 7 – díky tomu strom souborů následuje `cd` v terminálu.
   *
   * Aby uživatel z celé té instalace nic neviděl, výstup shellu se do chvíle,
   * než hook doběhne, jen sbírá do bufferu. Z posbíraného textu pak vyřízneme
   * celý řádek s naším příkazem a do terminálu pošleme až zbytek.
   */
  injectCwdHook() {
    const fmtCwd = '\\033]7;file://%s%s\\033\\\\';
    const fmtMark = '\\033]777;ss\\007';
    const hook =
      '__shellsmith_hook() { printf \'' + fmtCwd + '\' "${HOSTNAME:-}" "$PWD"; }; ' +
      'if [ -n "$ZSH_VERSION" ]; then precmd_functions+=(__shellsmith_hook); ' +
      'else PROMPT_COMMAND="__shellsmith_hook${PROMPT_COMMAND:+; $PROMPT_COMMAND}"; fi; ' +
      'printf \'' + fmtMark + '\'';

    this.hookCmd = hook;
    this.capture = { text: '', timer: setTimeout(() => this.flushCapture(true), 2500) };
    try {
      // Mezera na začátku drží příkaz mimo historii (HISTCONTROL=ignorespace).
      this.stream.write(' ' + hook + '\n');
    } catch (_) {
      this.flushCapture(true);
    }
  }

  flushCapture(timedOut) {
    const cap = this.capture;
    if (!cap) return;
    this.capture = null;
    clearTimeout(cap.timer);

    let text = cap.text;
    if (!timedOut) {
      const mi = text.indexOf(HOOK_MARKER);
      if (mi >= 0) {
        // Echo se nemusí vrátit bajt po bajtu – readline dlouhý řádek při
        // zalomení překresluje. Řídíme se proto názvem funkce a ořízneme
        // vše od začátku toho řádku až za značku.
        let from = text.indexOf(this.hookCmd);
        if (from < 0 || from > mi) from = text.indexOf('__shellsmith_hook');
        if (from >= 0 && from < mi) {
          const lineStart = text.lastIndexOf('\n', from) + 1;
          text = text.slice(0, lineStart) + text.slice(mi + HOOK_MARKER.length);
        } else {
          text = text.slice(0, mi) + text.slice(mi + HOOK_MARKER.length);
        }
      }
    }
    if (text) super.pushData(text);
    this.afterStartup();
  }

  /** Po dokončení startu odešleme uvítací příkaz relace, pokud je nastavený. */
  afterStartup() {
    if (this._startupDone) return;
    this._startupDone = true;
    const cmd = this.config.initialCommand;
    if (cmd && String(cmd).trim()) {
      setTimeout(() => {
        try { this.stream.write(String(cmd).replace(/\n?$/, '\n')); } catch (_) {}
      }, 200);
    }
  }

  pushData(chunk) {
    const cap = this.capture;
    if (cap) {
      cap.text += chunk;
      if (cap.text.indexOf(HOOK_MARKER) >= 0) return this.flushCapture(false);
      if (cap.text.length > 65536) return this.flushCapture(true);
      return;
    }
    super.pushData(chunk);
  }

  /** SFTP kanál sdílený panelem souborů (líně vytvořený, znovupoužitý). */
  sftp() {
    if (this.sftpClient) return Promise.resolve(this.sftpClient);
    if (this.sftpPending) return this.sftpPending;
    this.sftpPending = this.ready().then(() => new Promise((resolve, reject) => {
      if (!this.client || this.closed) return reject(new Error('Relace není připojená'));
      this.client.sftp((err, sftp) => {
        this.sftpPending = null;
        if (err) return reject(err);
        sftp.on('close', () => { if (this.sftpClient === sftp) this.sftpClient = null; });
        this.sftpClient = sftp;
        resolve(sftp);
      });
    })).catch((e) => { this.sftpPending = null; throw e; });
    return this.sftpPending;
  }

  write(data) { if (this.stream && !this.closed) this.stream.write(data); }

  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    try { if (this.stream && !this.closed) this.stream.setWindow(rows, cols, 0, 0); } catch (_) {}
  }

  close() {
    this.closed = true;
    try { this.stream && this.stream.end(); } catch (_) {}
    try { this.client && this.client.end(); } catch (_) {}
    for (const h of this.hopClients) { try { h.end(); } catch (_) {} }
  }
}

/* ------------------------------------------------------------------ */
/* Správce                                                             */
/* ------------------------------------------------------------------ */

class SessionManager extends EventEmitter {
  constructor() { super(); this.sessions = new Map(); }

  create(opts) {
    const s = (opts.kind === 'ssh') ? new SshSession(opts) : new LocalSession(opts);
    this.sessions.set(s.id, s);
    for (const ev of ['data', 'status', 'cwd', 'exit', 'prompt']) {
      s.on(ev, (payload) => this.emit(ev, s.id, payload));
    }
    s.on('exit', () => setTimeout(() => this.sessions.delete(s.id), 2000));
    Promise.resolve(s.start()).catch((e) => console.error('[sessions] start:', e));
    return s;
  }

  get(id) { return this.sessions.get(id) || null; }
  write(id, data) { const s = this.get(id); if (s) s.write(data); }
  resize(id, cols, rows) { const s = this.get(id); if (s) s.resize(cols, rows); }
  close(id) { const s = this.get(id); if (s) { s.close(); this.sessions.delete(id); } }
  closeAll() { for (const s of this.sessions.values()) { try { s.close(); } catch (_) {} } this.sessions.clear(); }
  list() { return [...this.sessions.values()].map((s) => s.info()); }
  activeCount() { return [...this.sessions.values()].filter((s) => !s.closed).length; }
}

module.exports = { SessionManager, LocalSession, SshSession };
