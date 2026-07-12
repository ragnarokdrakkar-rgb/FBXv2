'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { AppDatabase } = require('../src/main/database.cjs');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuzijska-biopsija-test-'));
const dbPath = path.join(tempDir, 'test.sqlite');

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
  }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
}

try {
  const db = new AppDatabase(dbPath);
  const initial = db.loadState();
  assert.deepEqual(initial.patients, []);
  assert.equal(initial.revision, 0);

  const patient = {
    id: 'test-patient-001',
    status: 'cakalni',
    ime: 'Janez',
    priimek: 'Novak',
    maticniIndeks: '123456',
    datumRojstva: '1960-01-02',
    telefon: '041 111 222',
    mrUstanova: 'Test',
    datumVpisa: '2026-07-12',
    opombe: 'Testni zapis'
  };
  const settings = { ustanove: ['Test'], urnik: { interval: 40, termini: [] } };

  const firstSave = db.saveState({
    patients: [patient],
    settings,
    description: 'nov pacient',
    expectedRevision: 0,
  });
  assert.equal(firstSave.revision, 1);
  assert.equal(firstSave.patientCount, 1);

  const loaded = db.loadState();
  assert.equal(loaded.patients.length, 1);
  assert.equal(loaded.patients[0].priimek, 'Novak');
  assert.deepEqual(loaded.settings.ustanove, ['Test']);

  const updatedPatient = { ...patient, status: 'narocen', terminDatum: '2026-08-10', terminUra: '08:00' };
  const secondSave = db.saveState({
    patients: [updatedPatient],
    settings,
    description: 'termin',
    expectedRevision: 1,
  });
  assert.equal(secondSave.revision, 2);
  assert.equal(secondSave.backups.length, 1);
  const backupPatients = JSON.parse(secondSave.backups[0].podatki);
  assert.equal(backupPatients[0].status, 'cakalni');

  const settingsSave = db.saveSettings({
    settings: { ...settings, pin: '1234' },
    expectedRevision: 2,
  });
  assert.equal(settingsSave.revision, 3);

  assert.throws(() => {
    db.saveSettings({ settings, expectedRevision: 1 });
  }, (error) => error.code === 'REVISION_CONFLICT');

  const diagnostics = db.getDiagnostics();
  assert.equal(diagnostics.patientCount, 1);
  assert.equal(diagnostics.backupCount, 1);
  assert.ok(diagnostics.fileSize > 0);

  db.close();
  console.log('✓ SQLite smoke test je uspel.');
} finally {
  cleanup();
}
