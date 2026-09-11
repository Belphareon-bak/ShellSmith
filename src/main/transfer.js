'use strict';
const { EventEmitter } = require('events');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { randomUUID } = require('crypto');

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
    this.filesSkipped = 0;
    this.createdDirs = [];
    this.completedSources = [];
    this.startedAt = 0;
    this.state = 'pending';
    this.error = null;
    this.currentFile = '';
    this._lastEmit = 0;
  }

  cancel() {
    this.cancelled = true;
    this.answer({ action: 'cancel' });
    if (this._activeSrc) { try { this._activeSrc.destroy(); } catch (_) {} }
    if (this._activeDst) { try { this._activeDst.destroy(); } catch (_) {} }
  }

  /** Renderer se ptá uživatele, co s kolizí názvů. */
  ask(question) {
    if (this.cancelled) return Promise.resolve({ action: 'cancel' });
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
      filesSkipped: this.filesSkipped,
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
        this.dirs.push({ rel, srcPath, mode: st.mode & 0o777 });
        const entries = await this.src.list(srcPath);
        for (const e of entries) {
          if (e.name === '.' || e.name === '..' || e.name.includes('/')) throw new Error('Neplatný název ze souborového serveru');
          await walk(e.path, rel);
        }
      } else {
        if (!['file', 'link'].includes(st.type)) throw new Error(`Nepodporovaný typ souboru: ${srcPath}`);
        const size = st.type === 'link' ? 0 : st.size;
        this.files.push({ srcPath, rel, size, mode: st.mode, type: st.type, mtime: st.mtime });
        this.bytesTotal += size || 0;
      }
    };
    // Výběr rodiče a jeho potomka nesmí tutéž věc přenášet dvakrát.
    const roots = [...new Set(this.srcPaths.map(p => this.src.join(p)))];
    this.srcPaths = roots.filter(p => !roots.some(other => p !== other && p.startsWith(other.replace(/\/$/, '') + '/')));
    for (const p of this.srcPaths) {
      if (this.src === this.dst) {
        const canonical = await this.src.realpath(p);
        const target = await this.dst.realpath(this.dst.join(this.dstDir, this.src.basename(p)));
        if (canonical === target || target.startsWith(canonical.replace(/\/$/, '') + '/')) {
          throw new Error('Nelze přenést položku samu na sebe ani do jejího podadresáře');
        }
      }
      await walk(p, ''); // Chyba skenu zastaví přenos ještě před zápisem.
    }
    this.emitProgress(true);
  }

  async resolveConflict(destPath, name) {
    if (this.conflictPolicy === 'overwrite') return { action: 'overwrite' };
    if (this.conflictPolicy === 'skip') return { action: 'skip' };
    if (this.conflictPolicy === 'rename') return { action: 'rename', path: await this.freeName(destPath) };
    const ans = await this.ask({ type: 'conflict', name, path: destPath });
    if (!ans) return { action: 'skip' };
    if (!['overwrite', 'skip', 'rename', 'cancel'].includes(ans.action)) throw new Error('Neplatná odpověď na kolizi');
    if (ans.applyToAll && ans.action !== 'cancel') this.conflictPolicy = ans.action;
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

      for (const dir of this.dirs) {
        this.checkCancelled();
        const p = this.dst.join(this.dstDir, dir.rel);
        if (await this.dst.exists(p)) {
          if ((await this.dst.stat(p)).type !== 'dir') throw new Error(`Cíl není adresář: ${p}`);
        } else {
          // Při plnění zůstává nový adresář soukromý; finální práva nastavíme nakonec.
          await this.dst.mkdir(p, 0o700);
          this.createdDirs.push({ path: p, mode: dir.mode });
        }
      }

      for (const f of this.files) {
        if (this.cancelled) break;
        let destPath = this.dst.join(this.dstDir, f.rel);
        let overwrite = false;
        this.currentFile = f.rel;
        this.emitProgress(true);

        if (await this.dst.exists(destPath)) {
          const res = await this.resolveConflict(destPath, f.rel);
          if (this.cancelled) break;
          if (res.action === 'skip') { this.filesSkipped++; this.emitProgress(true); continue; }
          if (res.action === 'rename') destPath = res.path;
          overwrite = res.action === 'overwrite';
        }

        this.checkCancelled();
        if (this.move && this.src === this.dst) {
          try {
            await this.dst.publish(f.srcPath, destPath, overwrite);
            this.bytesDone += f.size || 0;
          } catch (e) {
            if (e.code !== 'EXDEV') throw e;
            await this.copyFile(f, destPath, overwrite);
            this.completedSources.push(f);
          }
        } else {
          await this.copyFile(f, destPath, overwrite);
          if (this.move) this.completedSources.push(f);
        }
        this.filesDone++;
        this.emitProgress(true);
      }

      if (this.cancelled) {
        this.state = 'cancelled';
      } else {
        if (this.move) await this.removeSources();
        this.state = this.filesSkipped ? 'partial' : 'done';
      }
    } catch (e) {
      this.state = this.cancelled ? 'cancelled' : this.filesDone ? 'partial' : 'error';
      this.error = e && e.message ? e.message : String(e);
    }
    // Režim adresářů obnovíme i při částečném přenosu; existující adresáře neměníme.
    for (const dir of [...this.createdDirs].reverse()) {
      try { await this.dst.chmod(dir.path, dir.mode); }
      catch (e) { this.error = `Nelze nastavit práva ${dir.path}: ${e.message}`; if (this.state !== 'cancelled') this.state = 'partial'; }
    }
    this.emitProgress(true);
    this.emit('finish', this.snapshot());
    return this.snapshot();
  }

  checkCancelled() { if (this.cancelled) throw new Error('Přenos zrušen'); }

  async copyFile(f, destPath, overwrite = false) {
    const temp = this.dst.join(this.dst.dirname(destPath), `.shellsmith-${randomUUID()}.part`);
    let bytes = 0;
    try {
      if (f.type === 'link') {
        await this.dst.symlink(await this.src.readlink(f.srcPath), temp);
      } else {
        const rs = this.src.createReadStream(f.srcPath);
        this._activeSrc = rs;
        const ws = this.dst.createWriteStream(temp, 0o600, 'wx');
        this._activeDst = ws;
        const meter = new Transform({
          transform: (chunk, _enc, cb) => {
            bytes += chunk.length;
            this.bytesDone += chunk.length;
            this.emitProgress(false);
            cb(null, chunk);
          }
        });
        await pipeline(rs, meter, ws);
        if (bytes !== f.size) throw new Error(`Velikost zdroje se během přenosu změnila: ${f.srcPath}`);
        await this.dst.chmod(temp, f.mode & 0o777);
      }
      this.checkCancelled();
      await this.dst.publish(temp, destPath, overwrite);
    } finally {
      this._activeSrc?.destroy(); this._activeDst?.destroy();
      this._activeSrc = null; this._activeDst = null;
      try { if (await this.dst.exists(temp)) await this.dst.unlink(temp); }
      catch (e) { this.emit('warn', `Nelze uklidit dočasný soubor ${temp}: ${e.message}`); }
    }
  }

  async removeSources() {
    for (const f of this.completedSources) {
      this.checkCancelled();
      const st = await this.src.stat(f.srcPath);
      if (st.type !== f.type || (f.type === 'file' && (st.size !== f.size || st.mtime !== f.mtime))) {
        throw new Error(`Zdroj se změnil, ponechán na místě: ${f.srcPath}`);
      }
      await this.src.unlink(f.srcPath);
    }
    for (const dir of [...this.dirs].reverse()) {
      this.checkCancelled();
      // Nikdy rekurzivně nemažeme přeskočené ani nově vzniklé soubory.
      if ((await this.src.list(dir.srcPath)).length === 0) await this.src.rmdir(dir.srcPath);
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
  constructor() { super(); this.jobs = new Map(); this.tail = Promise.resolve(); }

  add(job) {
    this.jobs.set(job.id, job);
    job.on('progress', (s) => this.emit('progress', s));
    job.on('ask', (q) => this.emit('ask', q));
    job.on('warn', (w) => this.emit('warn', { id: job.id, message: w }));
    job.on('finish', (s) => {
      this.emit('finish', s);
      setTimeout(() => this.jobs.delete(job.id), 30000).unref?.();
    });
    this.tail = this.tail.then(() => job.run());
    return job;
  }

  get(id) { return this.jobs.get(id) || null; }
  cancel(id) { const j = this.get(id); if (j) j.cancel(); }
  answer(id, reply) { const j = this.get(id); if (j) j.answer(reply); }
  list() { return [...this.jobs.values()].map((j) => j.snapshot()); }
}

module.exports = { TransferJob, TransferQueue, removeRecursive };
