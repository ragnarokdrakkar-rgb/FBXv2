'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppDatabase } = require('../src/main/database.cjs');
const { DocumentManager } = require('../src/main/document-manager.cjs');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-phase7-'));
  const dbPath = path.join(temp, 'data', 'test.sqlite');
  const documentRoot = path.join(temp, 'documents');
  const configDirectory = path.join(temp, 'config');
  const db = new AppDatabase(dbPath);

  try {
    db.saveState({
      patients: [{
        id: 'patient-001',
        status: 'opravljeno',
        ime: 'Test',
        priimek: 'Pacient',
        maticniIndeks: 'TEST-001',
        datumVpisa: '2026-01-01',
        datumZakljucka: '2026-07-12',
        rezultatBiopsije: 'pozitivna',
        datumRezultataBiopsije: '2026-07-12',
        opombe: '',
      }],
      settings: {},
      description: 'phase7 test',
      expectedRevision: 0,
    });

    const patientFolder = path.join(documentRoot, 'Pacienti', 'TEST-001_Pacient_Test_patient-001');
    const dicomPath = path.join(patientFolder, 'DICOM_test');
    const pdfRoot = path.join(patientFolder, 'MR_izvidi');
    const pdfPath = path.join(pdfRoot, 'test.pdf');
    fs.mkdirSync(dicomPath, { recursive: true });
    fs.mkdirSync(pdfRoot, { recursive: true });
    fs.writeFileSync(path.join(dicomPath, 'image.dcm'), 'DICOM');
    fs.writeFileSync(pdfPath, '%PDF-test');

    db.addPatientAsset({
      id: 'asset-dicom',
      patientId: 'patient-001',
      kind: 'dicom',
      isCurrent: true,
      storedPath: dicomPath,
      sourceName: 'DICOM_test',
      displayName: 'DICOM test',
      fileCount: 1,
      totalBytes: 5,
      verified: true,
    });
    db.addPatientAsset({
      id: 'asset-pdf',
      patientId: 'patient-001',
      kind: 'mr_pdf',
      isCurrent: true,
      storedPath: pdfPath,
      sourceName: 'test.pdf',
      displayName: 'test.pdf',
      fileCount: 1,
      totalBytes: 9,
      verified: true,
    });

    const manager = new DocumentManager({
      database: db,
      configDirectory,
      defaultRoot: documentRoot,
      log: () => {},
      onProgress: () => {},
    });

    const result = await manager.deletePatientDocuments('patient-001');
    assert.equal(result.complete, true);
    assert.equal(result.deletedCount, 2);
    assert.equal(db.getPatientAssets('patient-001').length, 0);
    assert.equal(fs.existsSync(dicomPath), false);
    assert.equal(fs.existsSync(pdfPath), false);

    const history = db.getPatientHistory('patient-001', 50);
    assert.ok(history.some(item => item.eventType === 'positive_documents_deleted'));

    console.log('phase7-result-archive-test: OK');
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
