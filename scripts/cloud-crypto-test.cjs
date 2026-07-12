'use strict';

const assert = require('node:assert/strict');
const {
  newSalt,
  deriveKey,
  encryptSnapshot,
  decryptSnapshot,
  recordToRows,
  rowsToRecord,
  metaToRows,
  rowsToMeta,
} = require('../src/main/cloud-crypto.cjs');

const password = 'Zelo-mocno-testno-geslo-2026!';
const salt = newSalt();
const key = deriveKey(password, salt);
const snapshot = {
  format: 'FBX-STATE-V1',
  exportedAt: new Date().toISOString(),
  appVersion: '1.1.0',
  schemaVersion: 1,
  revision: 42,
  patients: [
    {
      id: 'p-1',
      ime: 'Janez',
      priimek: 'Novak',
      maticniIndeks: '123456',
      status: 'cakalni',
      datumVpisa: '2026-07-12',
    },
  ],
  settings: { ustanove: ['Test'], urnik: { termini: [] } },
};

const encrypted = encryptSnapshot(snapshot, key);
assert.doesNotMatch(encrypted.payload, /Janez|Novak|123456/);
const rows = recordToRows(encrypted);
const parsed = rowsToRecord(rows);
assert.deepEqual(decryptSnapshot(parsed, key), snapshot);

assert.throws(
  () => decryptSnapshot(parsed, deriveKey('Napacno-geslo-ki-je-dovolj-dolgo', salt)),
  (error) => error.code === 'CLOUD_DECRYPT_FAILED',
);

const meta = {
  activeSlot: 'A',
  salt,
  createdAt: '2026-07-12T10:00:00.000Z',
  updatedAt: '2026-07-12T10:01:00.000Z',
  revision: 42,
  schemaVersion: 1,
  appVersion: '1.1.0',
};
assert.deepEqual(rowsToMeta(metaToRows(meta)), {
  format: 'FBX-CLOUD-META-V1',
  activeSlot: meta.activeSlot,
  salt: meta.salt,
  kdf: 'scrypt-N32768-r8-p1',
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
  revision: meta.revision,
  schemaVersion: meta.schemaVersion,
  appVersion: meta.appVersion,
});

console.log('✓ Cloud šifriranje, deljenje v celice in napačno geslo so preverjeni.');
