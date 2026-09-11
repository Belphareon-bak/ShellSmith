'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const syncFs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter, once } = require('events');
const { spawn, execFileSync } = require('child_process');
const { Server, utils: { parseKey } } = require('ssh2');
const { load } = require('./helpers.cjs');
const { DEFAULTS } = require('../src/shared/defaults');
const { LocalAdapter, SftpAdapter } = require('../src/main/fsadapters');
const { TransferJob } = require('../src/main/transfer');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellsmith-ssh-'));
  const keyPath = path.join(root, 'client-key');
  const passphrase = crypto.randomUUID(), password = crypto.randomUUID();
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', passphrase, '-f', keyPath]);
  const publicKey = parseKey(await fs.readFile(keyPath + '.pub'));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs1' }, publicKeyEncoding: { format: 'pem', type: 'pkcs1' } });
  const clients = new Set(), processes = new Set();
  const server = new Server({ hostKeys: [privateKey] }, client => {
    clients.add(client); client.on('close', () => clients.delete(client)); client.on('error', () => {});
    client.on('authentication', ctx => {
      if (ctx.method === 'publickey' && ctx.key.data.equals(publicKey.getPublicSSH()) && (!ctx.signature || publicKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) ctx.accept();
      else if (ctx.method === 'password' && ctx.password === password) ctx.accept();
      else ctx.reject(['publickey', 'password']);
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', accept => accept());
      session.on('shell', accept => { const stream = accept(); stream.write('fixture ready\r\n'); stream.on('data', data => stream.write(data)); });
      session.on('subsystem', (accept, reject, info) => {
        if (info.name !== 'sftp') return reject();
        const stream = accept();
        const child = spawn('/usr/lib/openssh/sftp-server', ['-d', root, '-u', '077'], { stdio: ['pipe', 'pipe', 'ignore'] });
        processes.add(child); child.on('close', () => { processes.delete(child); stream.end(); });
        child.on('error', () => stream.end()); child.stdin.on('error', () => {});
        stream.pipe(child.stdin); child.stdout.pipe(stream);
        stream.on('close', () => child.kill());
      });
    }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    for (const client of clients) client.end();
    for (const child of processes) child.kill();
    await new Promise(r => server.close(r));
    await fs.rm(root, { recursive: true, force: true });
  });
  const settings = structuredClone(DEFAULTS); settings.ssh.injectOsc7 = false;
  const store = { getSettings: () => settings, getSecret: () => null, configDir: () => root, getSessions: () => ({ items: [] }) };
  const { SshSession } = load('src/main/sessions.js', { 'node-pty': {}, './store': store });
  const make = (authType = 'key') => {
    const s = new SshSession({ kind: 'ssh', host: '127.0.0.1', port: server.address().port, username: 'fixture', authType, keyPath });
    const prompts = [];
    s.on('prompt', req => {
      prompts.push(req);
      s.promptReply(req.promptId, req.type === 'hostkey' ? { decision: 'accept' } : { answers: [authType === 'key' ? passphrase : password] });
    });
    t.after(() => s.close());
    return { s, prompts };
  };
  return { root, make, SshSession, server };
}

test('encrypted OpenSSH key authenticates and SFTP waits for ready; upload/overwrite/download', { timeout: 15000 }, async t => {
  assert.ok(syncFs.existsSync('/usr/lib/openssh/sftp-server'), 'Install openssh-sftp-server for integration tests');
  const f = await fixture(t);
  const { s, prompts } = f.make();
  const pendingSftp = s.sftp();
  pendingSftp.catch(() => {}); // Níže se výsledek asertuje; nečekáme s handlerem na start.
  await s.start();
  assert.equal(s.status, 'connected', s.statusDetail);
  assert.equal(prompts.filter(p => p.type === 'input').length, 1);
  const remote = new SftpAdapter(await pendingSftp, s), local = new LocalAdapter();
  const src = path.join(f.root, 'src'), dst = path.join(f.root, 'remote'), download = path.join(f.root, 'download');
  await fs.mkdir(src); await fs.mkdir(dst); await fs.mkdir(download);
  const file = path.join(src, 'data');
  await fs.writeFile(file, 'first payload');
  const upload = () => new TransferJob({ src: local, srcPaths: [file], dst: remote, dstDir: dst, conflictPolicy: 'overwrite' }).run();
  assert.equal((await upload()).state, 'done');
  await fs.writeFile(file, 'updated € payload');
  const overwrite = await upload();
  assert.equal(overwrite.state, 'done', overwrite.error);
  assert.equal(await fs.readFile(path.join(dst, 'data'), 'utf8'), 'updated € payload');
  const r = await new TransferJob({ src: remote, srcPaths: [path.join(dst, 'data')], dst: local, dstDir: download }).run();
  assert.equal(r.state, 'done', r.error);
  assert.equal(await fs.readFile(path.join(download, 'data'), 'utf8'), 'updated € payload');
  assert.deepEqual(await fs.readdir(dst), ['data']);
  s.close();
});

test('password login and rejecting a changed host key', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const { s } = f.make('password');
  await s.start(); assert.equal(s.status, 'connected', s.statusDetail); s.close();
  await fs.writeFile(path.join(f.root, 'known_hosts.json'), JSON.stringify({ [`127.0.0.1:${f.server.address().port}`]: { fp: 'wrong-fixture-fingerprint' } }));
  const changed = new f.SshSession({ kind: 'ssh', host: '127.0.0.1', port: f.server.address().port, authType: 'agent' });
  t.after(() => changed.close());
  let warned = false;
  changed.on('prompt', req => { warned = req.changed; changed.promptReply(req.promptId, { decision: 'reject' }); });
  await changed.start();
  assert.equal(warned, true); assert.equal(changed.status, 'error'); assert.equal(changed.closed, true);
});

test('UTF-8 and OSC7 split across chunks preserve character and cwd', async () => {
  const settings = structuredClone(DEFAULTS); settings.ssh.injectOsc7 = false;
  const { SshSession } = load('src/main/sessions.js', { 'node-pty': {}, './store': { getSettings: () => settings } });
  const s = new SshSession({ kind: 'ssh', host: 'fixture' });
  const stream = new EventEmitter(); stream.end = () => {};
  s.client = { shell: (_opts, cb) => cb(null, stream), end() {} };
  const data = []; s.on('data', text => data.push(text));
  await s.openShell();
  const bytes = Buffer.from('€');
  stream.emit('data', bytes.subarray(0, 1)); stream.emit('data', bytes.subarray(1));
  assert.equal(data.join(''), '€');
  for (const byte of Buffer.from('\x1b]7;file://fixture/tmp/a%20b\x07')) stream.emit('data', Buffer.from([byte]));
  assert.equal(s.cwd, '/tmp/a b');
  s.close();
});

test('closing during an authentication prompt settles prompt and readiness', async () => {
  const { SshSession } = load('src/main/sessions.js', { 'node-pty': {}, './store': {} });
  const s = new SshSession({ kind: 'ssh', host: 'fixture' });
  const ready = s.ready(); const prompt = s.ask({ type: 'input' });
  const rejection = assert.rejects(ready, /ukončeno/);
  s.close();
  await rejection;
  assert.equal((await prompt).cancelled, true);
  assert.equal(s._pending.size, 0);
  await assert.rejects(s.ready(), /připojená/);
});
