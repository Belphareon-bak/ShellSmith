'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

/** Vykreslí práva ve stylu `ls -l` (drwxr-xr-x). */
function modeString(mode, type) {
  const t = type === 'dir' ? 'd' : type === 'link' ? 'l' : '-';
  const rwx = (m) => ((m & 4) ? 'r' : '-') + ((m & 2) ? 'w' : '-') + ((m & 1) ? 'x' : '-');
  return t + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7);
}

function typeFromMode(mode) {
  const S_IFMT = 0o170000;
  switch (mode & S_IFMT) {
    case 0o040000: return 'dir';
    case 0o120000: return 'link';
    default: return 'file';
  }
}

/* ------------------------------------------------------------------ */
/* Lokální souborový systém                                            */
/* ------------------------------------------------------------------ */

class LocalAdapter {
  constructor() { this.kind = 'local'; this.sep = '/'; }
  get label() { return os.hostname(); }

  join(...parts) { return path.posix.join(...parts.map((p) => String(p))); }
  dirname(p) { return path.posix.dirname(p); }
  basename(p) { return path.posix.basename(p); }

  async home() { return os.homedir(); }
  async realpath(p) { try { return await fsp.realpath(p); } catch (_) { return path.resolve(p); } }

  async list(dir) {
    const names = await fsp.readdir(dir);
    const out = [];
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        const st = await fsp.lstat(full);
        let type = st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'file';
        let realType = type;
        if (type === 'link') {
          try { realType = (await fsp.stat(full)).isDirectory() ? 'dir' : 'file'; } catch (_) { realType = 'broken'; }
        }
        out.push({
          name, path: full, type, realType,
          size: st.size, mtime: st.mtimeMs,
          mode: st.mode & 0o7777, modeStr: modeString(st.mode & 0o7777, type),
          uid: st.uid, gid: st.gid
        });
      } catch (_) { /* zmizelo mezi readdir a lstat */ }
    }
    return out;
  }

  async stat(p) {
    const st = await fsp.lstat(p);
    const type = st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'file';
    return { path: p, type, size: st.size, mtime: st.mtimeMs, mode: st.mode & 0o7777 };
  }

  async mkdir(p) { await fsp.mkdir(p, { recursive: true }); }
  async rename(from, to) { await fsp.rename(from, to); }
  async chmod(p, mode) { await fsp.chmod(p, mode); }
  async unlink(p) { await fsp.unlink(p); }
  async rmdir(p) { await fsp.rmdir(p); }
  async exists(p) { try { await fsp.lstat(p); return true; } catch (_) { return false; } }
  async readFile(p) { return await fsp.readFile(p); }
  async writeFile(p, data) { await fsp.writeFile(p, data); }

  createReadStream(p) { return fs.createReadStream(p); }
  createWriteStream(p, mode) { return fs.createWriteStream(p, mode ? { mode } : undefined); }
}

/* ------------------------------------------------------------------ */
/* Vzdálený souborový systém přes SFTP                                 */
/* ------------------------------------------------------------------ */

const P = (fn) => new Promise((resolve, reject) =>
  fn((err, res) => (err ? reject(err) : resolve(res))));

class SftpAdapter {
  constructor(sftp, session) {
    this.sftp = sftp;
    this.session = session;
    this.kind = 'sftp';
    this.sep = '/';
  }
  get label() { return `${this.session.config.username || ''}@${this.session.config.host}`; }

  join(...parts) { return path.posix.join(...parts.map((p) => String(p))); }
  dirname(p) { return path.posix.dirname(p); }
  basename(p) { return path.posix.basename(p); }

  async home() {
    try { return await P((cb) => this.sftp.realpath('.', cb)); } catch (_) { return '/'; }
  }
  async realpath(p) {
    try { return await P((cb) => this.sftp.realpath(p, cb)); } catch (_) { return p; }
  }

  async list(dir) {
    const raw = await P((cb) => this.sftp.readdir(dir, cb));
    const out = [];
    const links = [];
    for (const e of raw) {
      const mode = e.attrs.mode;
      const type = typeFromMode(mode);
      const item = {
        name: e.filename,
        path: path.posix.join(dir, e.filename),
        type, realType: type,
        size: e.attrs.size,
        mtime: (e.attrs.mtime || 0) * 1000,
        mode: mode & 0o7777,
        modeStr: modeString(mode & 0o7777, type),
        uid: e.attrs.uid, gid: e.attrs.gid
      };
      out.push(item);
      if (type === 'link') links.push(item);
    }
    // Symlinky dořešíme, ať víme, co je adresář – ale jen v rozumném počtu.
    const budget = links.slice(0, 300);
    await Promise.all(budget.map(async (item) => {
      try {
        const st = await P((cb) => this.sftp.stat(item.path, cb));
        item.realType = typeFromMode(st.mode) === 'dir' ? 'dir' : 'file';
      } catch (_) { item.realType = 'broken'; }
    }));
    return out;
  }

  async stat(p) {
    const st = await P((cb) => this.sftp.lstat(p, cb));
    return {
      path: p, type: typeFromMode(st.mode), size: st.size,
      mtime: (st.mtime || 0) * 1000, mode: st.mode & 0o7777
    };
  }

  async mkdir(p) {
    // SFTP neumí `-p`, poskládáme cestu po segmentech.
    const parts = p.split('/').filter(Boolean);
    let cur = p.startsWith('/') ? '' : '.';
    for (const part of parts) {
      cur = cur + '/' + part;
      try { await P((cb) => this.sftp.mkdir(cur, cb)); }
      catch (e) { if (!(await this.exists(cur))) throw e; }
    }
  }
  async rename(from, to) { await P((cb) => this.sftp.rename(from, to, cb)); }
  async chmod(p, mode) { await P((cb) => this.sftp.chmod(p, mode, cb)); }
  async unlink(p) { await P((cb) => this.sftp.unlink(p, cb)); }
  async rmdir(p) { await P((cb) => this.sftp.rmdir(p, cb)); }
  async exists(p) { try { await P((cb) => this.sftp.lstat(p, cb)); return true; } catch (_) { return false; } }
  async readFile(p) {
    const chunks = [];
    const rs = this.sftp.createReadStream(p);
    for await (const c of rs) chunks.push(c);
    return Buffer.concat(chunks);
  }
  async writeFile(p, data) {
    await new Promise((resolve, reject) => {
      const ws = this.sftp.createWriteStream(p);
      ws.on('error', reject); ws.on('close', resolve);
      ws.end(data);
    });
  }

  createReadStream(p) { return this.sftp.createReadStream(p, { highWaterMark: 1 << 17 }); }
  createWriteStream(p, mode) {
    return this.sftp.createWriteStream(p, Object.assign({ highWaterMark: 1 << 17 }, mode ? { mode } : {}));
  }
}

module.exports = { LocalAdapter, SftpAdapter, modeString, typeFromMode };
