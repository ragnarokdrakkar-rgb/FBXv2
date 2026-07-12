'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { CloudManager } = require('../src/main/cloud-manager.cjs');

const secret = 'testni-dostopni-kljuc-ki-je-dovolj-dolg-1234567890';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-appscript-manager-'));
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8'),
};

let state = {
  patients: [{ id: 'p1', ime: 'Ana', priimek: 'Test', maticniIndeks: '111', status: 'cakalni', datumVpisa: '2026-07-12' }],
  settings: { urnik: { termini: [] } },
  revision: 5,
  schemaVersion: 1,
};
let restoredPayload = null;
const database = {
  loadState: () => JSON.parse(JSON.stringify({ ...state, backups: [] })),
  saveState: (payload) => {
    restoredPayload = payload;
    state = { patients: payload.patients, settings: payload.settings, revision: state.revision + 1, schemaVersion: 1 };
    return { revision: state.revision, backups: [], patientCount: payload.patients.length };
  },
};

const store = { meta: [], A: [], B: [] };
const seenNonces = new Set();
function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}
function verifyRequest(req) {
  assert.equal(req.version, 1);
  assert.ok(Math.abs(Date.now() - Number(req.ts)) < 300000);
  assert.ok(!seenNonces.has(req.nonce));
  seenNonces.add(req.nonce);
  const canonical = `${req.ts}\n${req.nonce}\n${req.action}\n${sha256Hex(req.body)}`;
  const expected = base64Url(crypto.createHmac('sha256', secret).update(canonical).digest());
  assert.equal(req.signature, expected);
}
function metaInitialized() {
  return store.meta.some((row) => row[0] === 'format' && row[1] === 'FBX-CLOUD-META-V1');
}
function metaValue(key) {
  const row = store.meta.find((item) => item[0] === key);
  return row ? row[1] : '';
}

const server = http.createServer((request, response) => {
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    try {
      const req = JSON.parse(raw);
      verifyRequest(req);
      const body = JSON.parse(req.body || '{}');
      let result;
      switch (req.action) {
        case 'ping':
          result = {
            initialized: metaInitialized(),
            spreadsheetName: 'Test backup',
            spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit',
            updatedAt: metaValue('updated_at'),
            revision: Number(metaValue('revision') || 0),
          };
          break;
        case 'readMeta': result = { initialized: metaInitialized(), rows: store.meta }; break;
        case 'writeMeta':
          if (body.initializeOnly && metaInitialized()) throw new Error('already initialized');
          store.meta = body.rows;
          result = { written: true };
          break;
        case 'readSlot': result = { slot: body.slot, rows: store[body.slot] || [] }; break;
        case 'writeSlot': store[body.slot] = body.rows; result = { written: true, slot: body.slot }; break;
        default: throw new Error('unknown action');
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'TEST_ERROR', message: error.message } }));
    }
  });
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/exec`;
  try {
    const manager = new CloudManager({
      configDirectory: tempDir,
      safeStorage,
      shell: { openExternal: async () => {} },
      database,
      appVersion: '1.1.0',
      log: () => {},
      onStatus: () => {},
      allowInsecureEndpoint: true,
    });

    const connected = await manager.configureEndpoint(endpoint, secret);
    assert.equal(connected.connected, true);
    assert.equal(connected.existingBackup, false);

    const created = await manager.createNewBackup('Mocno-testno-geslo-2026!');
    assert.equal(created.created, true);
    assert.equal(manager.getStatus().backupConfigured, true);
    assert.equal(manager.getStatus().lastSyncRevision, 5);

    state = {
      ...state,
      revision: 6,
      patients: [...state.patients, { id: 'p2', ime: 'Boris', priimek: 'Test', maticniIndeks: '222', status: 'cakalni', datumVpisa: '2026-07-13' }],
    };
    const synced = await manager.syncNow();
    assert.equal(synced.revision, 6);

    const verified = await manager.verifyBackup();
    assert.equal(verified.valid, true);
    assert.equal(verified.patientCount, 2);

    state = { patients: [], settings: {}, revision: 20, schemaVersion: 1 };
    const restored = await manager.restoreFromCloud();
    assert.equal(restored.restored, true);
    assert.equal(restored.patientCount, 2);
    assert.equal(restoredPayload.patients[1].ime, 'Boris');

    const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-appscript-attach-'));
    const second = new CloudManager({
      configDirectory: secondDir,
      safeStorage,
      shell: { openExternal: async () => {} },
      database,
      appVersion: '1.1.0',
      log: () => {},
      onStatus: () => {},
      allowInsecureEndpoint: true,
    });
    const secondConnected = await second.configureEndpoint(endpoint, secret);
    assert.equal(secondConnected.existingBackup, true);
    const attached = await second.attachExisting('Mocno-testno-geslo-2026!');
    assert.equal(attached.patientCount, 2);
    await assert.rejects(() => second.attachExisting('Popolnoma-napacno-geslo!'));
    second.close();
    fs.rmSync(secondDir, { recursive: true, force: true });
    manager.close();
    console.log('✓ Apps Script podpis, A/B zapis, preverjanje, obnova in ponovna povezava so preverjeni.');
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
