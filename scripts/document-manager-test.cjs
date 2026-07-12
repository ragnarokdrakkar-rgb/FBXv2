'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { AppDatabase } = require('../src/main/database.cjs');
const { DocumentManager } = require('../src/main/document-manager.cjs');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-documents-test-'));
  const dbPath = path.join(temp, 'data', 'test.sqlite');
  const configDirectory = path.join(temp, 'config');
  const documentRoot = path.join(temp, 'documents');
  const sourceA = path.join(temp, 'source-a');
  const sourceB = path.join(temp, 'source-b');
  const pdfPath = path.join(temp, 'izvid.pdf');

  try {
    fs.mkdirSync(path.join(sourceA, 'SERIES_1'), { recursive: true });
    fs.writeFileSync(path.join(sourceA, 'DICOMDIR'), Buffer.from('DICOMDIR-test'));
    fs.writeFileSync(path.join(sourceA, 'SERIES_1', 'IMG0001.dcm'), Buffer.alloc(1001, 1));
    fs.writeFileSync(path.join(sourceA, 'SERIES_1', 'IMG0002.dcm'), Buffer.alloc(2002, 2));
    fs.mkdirSync(sourceB, { recursive: true });
    fs.writeFileSync(path.join(sourceB, 'IMG1000.dcm'), Buffer.alloc(512, 3));
    fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\n% test pdf\n%%EOF\n'));

    const db = new AppDatabase(dbPath);
    const patient = {
      id: 'patient-docs-001',
      status: 'cakalni',
      ime: 'Janez',
      priimek: 'Novak',
      maticniIndeks: '123456',
      datumRojstva: '1960-01-02',
      telefon: '',
      mrUstanova: '',
      datumVpisa: '2026-07-12',
      opombe: '',
    };
    db.saveState({ patients: [patient], settings: { ustanove: [], urnik: { interval: 40, termini: [] } }, expectedRevision: 0 });

    const progress = [];
    const manager = new DocumentManager({
      database: db,
      configDirectory,
      defaultRoot: documentRoot,
      onProgress: (item) => progress.push(item),
    });

    const initial = await manager.getStatus();
    assert.equal(path.resolve(initial.rootPath), path.resolve(documentRoot));
    assert.equal(initial.assetCount, 0);

    const firstDicom = await manager.importDicom(patient.id, sourceA);
    assert.equal(firstDicom.asset.kind, 'dicom');
    assert.equal(firstDicom.asset.fileCount, 3);
    assert.equal(firstDicom.asset.totalBytes, 13 + 1001 + 2002);
    assert.ok(fs.existsSync(path.join(firstDicom.asset.storedPath, 'DICOMDIR')));
    assert.ok(fs.existsSync(path.join(firstDicom.asset.storedPath, 'SERIES_1', 'IMG0002.dcm')));
    assert.ok(progress.some((item) => item.phase === 'copying'));
    assert.ok(progress.some((item) => item.phase === 'verifying'));
    assert.ok(progress.some((item) => item.phase === 'done'));

    const pdf = await manager.importPdf(patient.id, pdfPath);
    assert.equal(pdf.asset.kind, 'mr_pdf');
    assert.match(path.basename(pdf.asset.storedPath), /^123456_Novak_Janez_MR_izvid_\d{4}-\d{2}-\d{2}_\d{6}_[a-f0-9-]{8}\.pdf$/);
    assert.equal(fs.readFileSync(pdf.asset.storedPath, 'utf8').slice(0, 5), '%PDF-');

    const summary = manager.getSummary()[patient.id];
    assert.equal(summary.hasDicom, true);
    assert.equal(summary.hasPdf, true);

    const firstHealth = await manager.verifyAllDocuments();
    assert.equal(firstHealth.healthy, true);
    assert.equal(firstHealth.issueCount, 0);
    assert.equal(firstHealth.assetCount, 2);

    const secondDicom = await manager.importDicom(patient.id, sourceB);
    assert.equal(secondDicom.asset.fileCount, 1);
    let assets = manager.getPatientAssets(patient.id);
    const dicoms = assets.filter((item) => item.kind === 'dicom');
    assert.equal(dicoms.length, 2);
    assert.equal(dicoms.filter((item) => item.isCurrent).length, 1);
    assert.equal(dicoms.find((item) => item.isCurrent).id, secondDicom.asset.id);

    const newRoot = path.join(temp, 'documents-new');
    const changedStatus = await manager.setRoot(newRoot);
    assert.equal(path.resolve(changedStatus.rootPath), path.resolve(newRoot));
    assert.equal(changedStatus.writable, true);

    // Dokument v prejšnji znani shrambi mora biti še vedno varno obvladljiv.
    await manager.deleteAsset(secondDicom.asset.id);
    assets = manager.getPatientAssets(patient.id);
    const remainingDicom = assets.find((item) => item.kind === 'dicom');
    assert.ok(remainingDicom);
    assert.equal(remainingDicom.isCurrent, true);
    assert.equal(fs.existsSync(secondDicom.asset.storedPath), false);

    const diagnostics = db.getAssetDiagnostics();
    assert.equal(diagnostics.assetCount, 2);
    assert.equal(diagnostics.dicomAssetCount, 1);
    assert.equal(diagnostics.pdfAssetCount, 1);

    db.close();
    console.log('✓ DICOM/PDF document manager test je uspel.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
