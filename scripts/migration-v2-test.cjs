'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { AppDatabase } = require('../src/main/database.cjs');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-migration-v3-'));
const dbPath = path.join(tempDir, 'test.sqlite');

try {
  const db = new AppDatabase(dbPath);
  const patient = {
    id: 'migration-patient-001',
    status: 'cakalni',
    ime: 'Ana',
    priimek: 'Kovac',
    maticniIndeks: '987654',
    datumRojstva: '',
    telefon: '',
    mrUstanova: '',
    datumVpisa: '2026-07-12',
    opombe: '',
  };
  db.saveState({
    patients: [patient],
    settings: { ustanove: [], urnik: { interval: 40, termini: [] } },
    description: 'migration seed',
    expectedRevision: 0,
  });
  db.close();

  // Simulira pravo bazo iz verzije 1.1.0: user_version 1 brez tabele dokumentov.
  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    DROP TABLE IF EXISTS patient_assets;
    UPDATE meta SET value = '1' WHERE key = 'schema_version';
    PRAGMA user_version = 1;
  `);
  raw.close();

  const migrated = new AppDatabase(dbPath);
  const state = migrated.loadState();
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.patients.length, 1);
  assert.equal(state.patients[0].id, patient.id);
  assert.deepEqual(migrated.getPatientAssets(patient.id), []);
  assert.equal(migrated.getDiagnostics().schemaVersion, 3);
  assert.deepEqual(migrated.getExportHistory(), []);
  migrated.close();

  console.log('✓ Migracija SQLite sheme 1 → 3 je uspela brez izgube pacienta.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
