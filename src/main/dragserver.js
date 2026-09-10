'use strict';
const http = require('http');
const crypto = require('crypto');

/**
 * Malý lokální server, přes který Chromium doručí soubor při přetažení
 * z panelu do správce souborů (mechanismus `DownloadURL` / XDS).
 * Poslouchá jen na 127.0.0.1, každý token platí jednorázově a krátce.
 */
class DragServer {
  constructor() {
    this.tokens = new Map();
    this.server = null;
    this.port = 0;
  }

  async ensure() {
    if (this.server) return this.port;
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
    return this.port;
  }

  /** Zaregistruje soubor k jednorázovému stažení, vrátí URL. */
  async register(adapter, remotePath, filename, size) {
    await this.ensure();
    const token = crypto.randomBytes(24).toString('hex');
    this.tokens.set(token, { adapter, remotePath, filename, size, expires: Date.now() + 5 * 60 * 1000 });
    setTimeout(() => this.tokens.delete(token), 5 * 60 * 1000).unref?.();
    return `http://127.0.0.1:${this.port}/f/${token}`;
  }

  handle(req, res) {
    const m = /^\/f\/([a-f0-9]{48})$/.exec(req.url || '');
    const rec = m ? this.tokens.get(m[1]) : null;
    if (!rec || rec.expires < Date.now()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    this.tokens.delete(m[1]);
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${rec.filename.replace(/["\\]/g, '_')}"`,
      ...(rec.size != null ? { 'content-length': String(rec.size) } : {})
    });
    let stream;
    try { stream = rec.adapter.createReadStream(rec.remotePath); }
    catch (e) { return res.end(); }
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  close() { if (this.server) { try { this.server.close(); } catch (_) {} this.server = null; } }
}

module.exports = { DragServer };
