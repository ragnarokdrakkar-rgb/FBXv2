'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { AppDatabase } = require('../src/main/database.cjs');
const { DocumentManager } = require('../src/main/document-manager.cjs');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-phase6-'));
  const db = new AppDatabase(path.join(temp, 'data', 'test.sqlite'));
  try {
    const patient = {
      id: 'phase6-patient-001', status: 'cakalni', ime: 'Test', priimek: 'Pacient',
      maticniIndeks: 'P6-001', datumRojstva: '', telefon: '', mrUstanova: '',
      datumVpisa: '2026-07-12', opombe: '',
    };
    const settings = { ustanove: [], urnik: { interval: 40, termini: [] } };
    db.saveState({ patients: [patient], settings, expectedRevision: 0, description: 'nov pacient' });
    const scheduled = { ...patient, status: 'narocen', terminDatum: '2026-09-01', terminUra: '08:00' };
    db.saveState({ patients: [scheduled], settings, expectedRevision: 1, description: 'termin' });

    const manager = new DocumentManager({
      database: db,
      configDirectory: path.join(temp, 'config'),
      defaultRoot: path.join(temp, 'documents'),
    });
    const dicom = path.join(temp, 'source-dicom');
    const pdf = path.join(temp, 'source.pdf');
    fs.mkdirSync(dicom, { recursive: true });
    fs.writeFileSync(path.join(dicom, 'IMG1.dcm'), Buffer.alloc(321, 1));
    fs.writeFileSync(pdf, Buffer.from('%PDF-1.4\n%%EOF\n'));
    await manager.importDicom(patient.id, dicom);
    const pdfResult = await manager.importPdf(patient.id, pdf);

    const healthy = await manager.verifyAllDocuments();
    assert.equal(healthy.healthy, true);
    assert.equal(healthy.issueCount, 0);

    fs.rmSync(pdfResult.asset.storedPath, { force: true });
    const broken = await manager.verifyAllDocuments();
    assert.equal(broken.healthy, false);
    assert.ok(broken.issues.some((item) => item.kind === 'mr_pdf' && item.issue === 'missing'));

    const history = db.getPatientHistory(patient.id, 100);
    assert.ok(history.some((item) => item.eventType === 'patient_added'));
    assert.ok(history.some((item) => item.eventType === 'appointment_changed'));
    assert.ok(history.some((item) => item.eventType === 'document_added'));

    const health = db.runHealthCheck();
    assert.equal(health.healthy, true);
    assert.equal(health.schemaVersion, 4);

    console.log('✓ Faza 6: zgodovina, zdravje baze in zaznava manjkajočega dokumenta delujejo.');
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
