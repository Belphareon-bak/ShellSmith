'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { LocalAdapter, SftpAdapter } = require('../src/main/fsadapters');
const { TransferJob, TransferQueue } = require('../src/main/transfer');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellsmith-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const src = path.join(root, 'src'), dst = path.join(root, 'dst');
  await fs.mkdir(src); await fs.mkdir(dst);
  return { src, dst, a: new LocalAdapter(), from: path.join(src, 'file'), to: path.join(dst, 'file') };
}
const job = (f, opts = {}) => new TransferJob({ src: f.a, srcPaths: [f.from], dst: f.a, dstDir: f.dst, ...opts });

test('recursive copy preserves contents, private directory modes and symlinks', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.src, 'private'), { mode: 0o700 });
  await fs.writeFile(path.join(f.src, 'private', 'file'), 'payload', { mode: 0o640 });
  await fs.symlink('file', path.join(f.src, 'private', 'link'));
  await fs.symlink('missing', path.join(f.src, 'private', 'broken'));
  const result = await job(f, { srcPaths: [path.join(f.src, 'private')] }).run();
  assert.equal(result.state, 'done'); assert.equal(result.filesDone, 3);
  const target = path.join(f.dst, 'private');
  assert.equal((await fs.stat(target)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(target, 'file'))).mode & 0o777, 0o640);
  assert.equal(await fs.readFile(path.join(target, 'file'), 'utf8'), 'payload');
  assert.equal(await fs.readlink(path.join(target, 'link')), 'file');
  assert.equal(await fs.readlink(path.join(target, 'broken')), 'missing');
});

test('same-adapter move waits for overwrite confirmation and preserves inode', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.from, 'incoming'); await fs.writeFile(f.to, 'original');
  const inode = (await fs.stat(f.from)).ino;
  const j = job(f, { move: true });
  let answer;
  const asked = new Promise(r => { answer = r; });
  j.once('ask', answer);
  const pending = j.run();
  await asked;
  assert.equal(await fs.readFile(f.to, 'utf8'), 'original');
  assert.equal(await fs.readFile(f.from, 'utf8'), 'incoming');
  j.answer({ action: 'overwrite' });
  assert.equal((await pending).state, 'done');
  assert.equal(await fs.readFile(f.to, 'utf8'), 'incoming');
  assert.equal((await fs.stat(f.to)).ino, inode);
  assert.equal(await f.a.exists(f.from), false);
});

test('skip during move preserves source, reports partial and does not count it as copied', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.from, 'source'); await fs.writeFile(f.to, 'original');
  for (const dst of [f.a, new LocalAdapter()]) {
    const r = await job(f, { dst, move: true, conflictPolicy: 'skip' }).run();
    assert.equal(r.state, 'partial'); assert.equal(r.filesSkipped, 1); assert.equal(r.filesDone, 0);
    assert.equal(await fs.readFile(f.from, 'utf8'), 'source');
    assert.equal(await fs.readFile(f.to, 'utf8'), 'original');
  }
});

test('copy failure keeps existing destination and removes staging file', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.from, 'new complete'); await fs.writeFile(f.to, 'old complete');
  const failing = new LocalAdapter();
  failing.createReadStream = () => Readable.from((async function* () { yield 'part'; throw new Error('connection lost'); })());
  const r = await job(f, { src: failing, conflictPolicy: 'overwrite' }).run();
  assert.equal(r.state, 'error'); assert.match(r.error, /connection lost/);
  assert.equal(await fs.readFile(f.to, 'utf8'), 'old complete');
  assert.deepEqual(await fs.readdir(f.dst), ['file']);
});

test('cancel while copying keeps original destination', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.from, 'new complete'); await fs.writeFile(f.to, 'old complete');
  let sent;
  const started = new Promise(r => { sent = r; });
  const slow = new LocalAdapter();
  slow.createReadStream = () => new Readable({ read() { this.push('part'); sent(); this._read = () => {}; } });
  const j = job(f, { src: slow, conflictPolicy: 'overwrite' });
  const pending = j.run(); await started; j.cancel();
  assert.equal((await pending).state, 'cancelled');
  assert.equal(await fs.readFile(f.to, 'utf8'), 'old complete');
  assert.deepEqual(await fs.readdir(f.dst), ['file']);
});

test('cancel resolves a pending conflict without another dialog response', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.from, 'new'); await fs.writeFile(f.to, 'old');
  const j = job(f);
  j.once('ask', () => j.cancel());
  assert.equal((await j.run()).state, 'cancelled');
  assert.equal(await fs.readFile(f.to, 'utf8'), 'old');
});

test('scan failure produces error before copying anything', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.from, 'source');
  const r = await job(f, { srcPaths: [f.from, path.join(f.src, 'missing')] }).run();
  assert.equal(r.state, 'error'); assert.match(r.error, /ENOENT/);
  assert.deepEqual(await fs.readdir(f.dst), []);
});

test('same path and directory descendant transfers fail without changing source', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.from, 'source');
  const same = await job(f, { dstDir: f.src, conflictPolicy: 'overwrite' }).run();
  assert.equal(same.state, 'error'); assert.equal(await fs.readFile(f.from, 'utf8'), 'source');
  const nested = await job(f, { srcPaths: [f.src], dstDir: f.src }).run();
  assert.equal(nested.state, 'error');
});

test('cross-adapter move removes only copied files and leaves skipped children', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.src, 'dir')); await fs.mkdir(path.join(f.dst, 'dir'));
  await fs.writeFile(path.join(f.src, 'dir', 'skip'), 'source');
  await fs.writeFile(path.join(f.src, 'dir', 'copy'), 'copy');
  await fs.writeFile(path.join(f.dst, 'dir', 'skip'), 'target');
  const r = await job(f, { srcPaths: [path.join(f.src, 'dir')], dst: new LocalAdapter(), move: true, conflictPolicy: 'skip' }).run();
  assert.equal(r.state, 'partial');
  assert.deepEqual(await fs.readdir(path.join(f.src, 'dir')), ['skip']);
  assert.equal(await fs.readFile(path.join(f.dst, 'dir', 'copy'), 'utf8'), 'copy');
});

test('destination created during copy is never silently overwritten', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.from, 'source');
  const publish = f.a.publish.bind(f.a);
  f.a.publish = async (...args) => { await fs.writeFile(f.to, 'concurrent'); return publish(...args); };
  const r = await job(f).run();
  assert.equal(r.state, 'error');
  assert.equal(await fs.readFile(f.to, 'utf8'), 'concurrent');
});

test('SFTP refuses non-atomic overwrite, without removing the destination', async () => {
  let renamed = false;
  const a = new SftpAdapter({
    ext_openssh_rename(_a, _b, cb) { cb(Object.assign(new Error('unsupported'), { code: 8 })); },
    rename() { renamed = true; }, unlink() { throw new Error('must never unlink'); }
  }, { config: {} });
  await assert.rejects(a.publish('tmp', 'destination', true), /atomické/);
  assert.equal(renamed, false);
});

test('adapter existence checks propagate access errors', async () => {
  const a = new SftpAdapter({ lstat(_p, cb) { cb(Object.assign(new Error('denied'), { code: 3 })); } }, { config: {} });
  await assert.rejects(a.exists('/private'), /denied/);
});

test('queued transfers run one at a time', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.from, 'source');
  const first = job(f); const second = job(f, { conflictPolicy: 'rename' });
  const queue = new TransferQueue();
  const order = [];
  first.on('finish', () => order.push('first'));
  second.on('progress', s => { if (s.state === 'scanning') assert.deepEqual(order, ['first']); });
  queue.add(first); queue.add(second); await queue.tail;
  assert.equal(second.state, 'done');
  assert.equal(await fs.readFile(path.join(f.dst, 'file (1)'), 'utf8'), 'source');
});
