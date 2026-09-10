'use strict';
const { EventEmitter } = require('events');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

let jobSeq = 0;

/**
 * Jeden přenos = seznam zdrojových cest (soubory i adresáře) z jednoho
 * adaptéru do cílového adresáře jiného adaptéru. Protože oba adaptéry mají
 * stejné rozhraní, stejný kód obslouží upload, download, kopii mezi dvěma
 * servery i kopii v rámci jednoho stroje.
 */
class TransferJob extends EventEmitter {
  constructor({ src, srcPaths, dst, dstDir, move = false, conflictPolicy = 'ask' }) {
    super();
    this.id = `t${++jobSeq}-${Date.now().toString(36)}`;
    this.src = src;
    this.srcPaths = srcPaths;
    this.dst = dst;
    this.dstDir = dstDir;
    this.move = move;
    this.conflictPolicy = conflictPolicy; // ask | overwrite | skip | rename
    this.cancelled = false;
    this.files = [];
    this.dirs = [];
    this.bytesTotal = 0;
    this.bytesDone = 0;
    this.filesDone = 0;
    this.startedAt = 0;
    this.state = 'pending';
    this.error = null;
    this.currentFile = '';
    this._lastEmit = 0;
  }

  cancel() {
    this.cancelled = true;
    if (this._activeSrc) { try { this._activeSrc.destroy(); } catch (_) {} }
    if (this._activeDst) { try { this._activeDst.destroy(); } catch (_) {} }
  }

  /** Renderer se ptá uživatele, co s kolizí názvů. */
  ask(question) {
    return new Promise((resolve) => {
      this._resolveAsk = resolve;
      this.emit('ask', Object.assign({ jobId: this.id }, question));
    });
  }
  answer(reply) {
    const r = this._resolveAsk;
    this._resolveAsk = null;
    if (r) r(reply);
  }

  snapshot() {
    const elapsed = Math.max(1, Date.now() - this.startedAt);
    return {
      id: this.id, state: this.state, error: this.error,
      label: `${this.src.label} → ${this.dst.label}`,
      move: this.move,
      filesTotal: this.files.length, filesDone: this.filesDone,
      bytesTotal: this.bytesTotal, bytesDone: this.bytesDone,
      currentFile: this.currentFile,
      speed: this.startedAt ? Math.round((this.bytesDone / elapsed) * 1000) : 0
    };
  }

  emitProgress(force) {
    const now = Date.now();
    if (!force && now - this._lastEmit < 120) return;
    this._lastEmit = now;
    this.emit('progress', this.snapshot());
  }

  /** Projde zdrojové cesty a sestaví plochý seznam souborů + adresářů. */
  async scan() {
    this.state = 'scanning';
    this.emitProgress(true);
    const walk = async (srcPath, relDir) => {
      if (this.cancelled) return;
      const st = await this.src.stat(srcPath);
      const name = this.src.basename(srcPath);
      const rel = relDir ? `${relDir}/${name}` : name;
      if (st.type === 'dir') {
        this.dirs.push(rel);
        const entries = await this.src.list(srcPath);
        for (const e of entries) {
          if (e.type === 'link' && e.realType === 'broken') continue;
          await walk(e.path, rel);
        }
      } else {
        this.files.push({ srcPath, rel, size: st.size, mode: st.mode });
        this.bytesTotal += st.size || 0;
      }
    };
    for (const p of this.srcPaths) {
      try { await walk(p, ''); }
      catch (e) { this.emit('warn', `${p}: ${e.message}`); }
    }
    this.emitProgress(true);
  }

  async resolveConflict(destPath, name) {
    if (this.conflictPolicy === 'overwrite') return { action: 'overwrite' };
    if (this.conflictPolicy === 'skip') return { action: 'skip' };
    if (this.conflictPolicy === 'rename') return { action: 'rename', path: await this.freeName(destPath) };
    const ans = await this.ask({ type: 'conflict', name, path: destPath });
    if (!ans) return { action: 'skip' };
    if (ans.applyToAll) this.conflictPolicy = ans.action;
    if (ans.action === 'cancel') { this.cancel(); return { action: 'skip' }; }
    if (ans.action === 'rename') return { action: 'rename', path: await this.freeName(destPath) };
    return { action: ans.action };
  }

  async freeName(destPath) {
    const dir = this.dst.dirname(destPath);
    const base = this.dst.basename(destPath);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 1; i < 1000; i++) {
      const cand = this.dst.join(dir, `${stem} (${i})${ext}`);
      if (!(await this.dst.exists(cand))) return cand;
    }
    return `${destPath}.${Date.now()}`;
  }

  async run() {
    this.startedAt = Date.now();
    try {
      await this.scan();
      if (this.cancelled) throw new Error('Přenos zrušen');
      this.state = 'running';

      for (const rel of this.dirs) {
        if (this.cancelled) break;
        await this.dst.mkdir(this.dst.join(this.dstDir, rel));
      }

      for (const f of this.files) {
        if (this.cancelled) break;
        let destPath = this.dst.join(this.dstDir, f.rel);
        this.currentFile = f.rel;
        this.emitProgress(true);

        if (await this.dst.exists(destPath)) {
          const res = await this.resolveConflict(destPath, f.rel);
          if (this.cancelled) break;
          if (res.action === 'skip') { this.filesDone++; this.bytesDone += f.size || 0; this.emitProgress(true); continue; }
          if (res.action === 'rename') destPath = res.path;
        }

        await this.copyFile(f, destPath);
        this.filesDone++;
        this.emitProgress(true);
      }

      if (this.cancelled) {
        this.state = 'cancelled';
      } else {
        if (this.move) await this.removeSources();
        this.state = 'done';
      }
    } catch (e) {
      this.state = this.cancelled ? 'cancelled' : 'error';
      this.error = e && e.message ? e.message : String(e);
    }
    this.emitProgress(true);
    this.emit('finish', this.snapshot());
    return this.snapshot();
  }

  async copyFile(f, destPath) {
    const rs = this.src.createReadStream(f.srcPath);
    const ws = this.dst.createWriteStream(destPath, f.mode & 0o777);
    this._activeSrc = rs; this._activeDst = ws;
    const meter = new Transform({
      transform: (chunk, _enc, cb) => {
        this.bytesDone += chunk.length;
        this.emitProgress(false);
        cb(null, chunk);
      }
    });
    try {
      await pipeline(rs, meter, ws);
    } finally {
      this._activeSrc = null; this._activeDst = null;
    }
  }

  async removeSources() {
    for (const p of this.srcPaths) {
      try { await removeRecursive(this.src, p); }
      catch (e) { this.emit('warn', `nelze smazat ${p}: ${e.message}`); }
    }
  }
}

async function removeRecursive(adapter, p) {
  const st = await adapter.stat(p);
  if (st.type === 'dir') {
    const entries = await adapter.list(p);
    for (const e of entries) await removeRecursive(adapter, e.path);
    await adapter.rmdir(p);
  } else {
    await adapter.unlink(p);
  }
}

class TransferQueue extends EventEmitter {
  constructor() { super(); this.jobs = new Map(); }

  add(job) {
    this.jobs.set(job.id, job);
    job.on('progress', (s) => this.emit('progress', s));
    job.on('ask', (q) => this.emit('ask', q));
    job.on('warn', (w) => this.emit('warn', { id: job.id, message: w }));
    job.on('finish', (s) => {
      this.emit('finish', s);
      setTimeout(() => this.jobs.delete(job.id), 30000);
    });
    job.run();
    return job;
  }

  get(id) { return this.jobs.get(id) || null; }
  cancel(id) { const j = this.get(id); if (j) j.cancel(); }
  answer(id, reply) { const j = this.get(id); if (j) j.answer(reply); }
  list() { return [...this.jobs.values()].map((j) => j.snapshot()); }
}

module.exports = { TransferJob, TransferQueue, removeRecursive };
