'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { AppDatabase } = require('../src/main/database.cjs');

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-backup-test-'));
  const dbPath = path.join(tempDir, 'data.sqlite');
  const backupDir = path.join(tempDir, 'backups');
  let db;
  try {
    db = new AppDatabase(dbPath);
    db.saveState({
      patients: [{ id: 'p1', ime: 'Ana', priimek: 'Test', maticniIndeks: '1', status: 'cakalni', datumVpisa: '2026-07-12' }],
      settings: {},
      description: 'test',
      expectedRevision: 0,
    });
    const result = await db.createSafetyBackup(backupDir, 'pred-posodobitvijo-1.4.1');
    assert.ok(fs.existsSync(result.filePath));
    assert.ok(result.fileSize > 0);
    const copy = new DatabaseSync(result.filePath, { readOnly: true });
    const count = copy.prepare('SELECT COUNT(*) AS count FROM patients').get().count;
    copy.close();
    assert.equal(Number(count), 1);
    console.log('database-backup-test: OK');
  } finally {
    try { db?.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
