'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { AppDatabase } = require('../src/main/database.cjs');
const { DocumentManager } = require('../src/main/document-manager.cjs');
const { ExportManager } = require('../src/main/export-manager.cjs');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-export-test-'));
  const db = new AppDatabase(path.join(temp, 'data', 'test.sqlite'));
  try {
    const appointmentDate = '2026-08-20';
    const patients = [
      {
        id: 'export-patient-001', status: 'narocen', ime: 'Janez', priimek: 'Novak',
        maticniIndeks: '123456', datumRojstva: '', telefon: '', mrUstanova: '',
        datumVpisa: '2026-07-12', terminDatum: appointmentDate, terminUra: '08:00', opombe: '',
      },
      {
        id: 'export-patient-002', status: 'narocen', ime: 'Ana', priimek: 'Kovac',
        maticniIndeks: '654321', datumRojstva: '', telefon: '', mrUstanova: '',
        datumVpisa: '2026-07-13', terminDatum: appointmentDate, terminUra: '08:40', opombe: '',
      },
    ];
    db.saveState({ patients, settings: { ustanove: [], urnik: { interval: 40, termini: [] } }, expectedRevision: 0 });

    const docRoot = path.join(temp, 'documents');
    const manager = new DocumentManager({
      database: db,
      configDirectory: path.join(temp, 'config'),
      defaultRoot: docRoot,
    });

    const dicom1 = path.join(temp, 'source-dicom-1');
    const dicom2 = path.join(temp, 'source-dicom-2');
    fs.mkdirSync(path.join(dicom1, 'SERIES'), { recursive: true });
    fs.mkdirSync(dicom2, { recursive: true });
    fs.writeFileSync(path.join(dicom1, 'DICOMDIR'), Buffer.from('test-dicomdir'));
    fs.writeFileSync(path.join(dicom1, 'SERIES', 'IMG0001.dcm'), Buffer.alloc(1024, 1));
    fs.writeFileSync(path.join(dicom2, 'IMG0002.dcm'), Buffer.alloc(2048, 2));
    const pdf = path.join(temp, 'izvid.pdf');
    fs.writeFileSync(pdf, Buffer.from('%PDF-1.4\n% test\n%%EOF\n'));

    await manager.importDicom(patients[0].id, dicom1);
    await manager.importPdf(patients[0].id, pdf);
    await manager.importDicom(patients[1].id, dicom2);

    const progress = [];
    const exporter = new ExportManager({
      database: db,
      documentManager: manager,
      onProgress: (item) => progress.push(item),
    });

    const preview = exporter.prepare(appointmentDate);
    assert.equal(preview.patientCount, 2);
    assert.equal(preview.readyPatientCount, 1);
    assert.equal(preview.missing.length, 1);
    assert.equal(preview.missing[0].kind, 'pdf');

    await assert.rejects(
      () => exporter.start({ appointmentDate, destinationRoot: path.join(temp, 'usb'), allowMissing: false }),
      (error) => error.code === 'MISSING_DOCUMENTS',
    );

    const result = await exporter.start({
      appointmentDate,
      destinationRoot: path.join(temp, 'usb'),
      allowMissing: true,
    });
    assert.equal(result.patientCount, 2);
    assert.equal(result.exportedPatientCount, 2);
    assert.equal(result.fileCount, 4);
    assert.ok(fs.existsSync(result.destinationPath));
    assert.ok(fs.existsSync(path.join(result.destinationPath, 'seznam_pacientov.csv')));
    assert.ok(fs.existsSync(path.join(result.destinationPath, 'manifest.json')));

    const folders = fs.readdirSync(result.destinationPath).filter((name) => /^\d{2}_/.test(name));
    assert.equal(folders.length, 2);
    const first = folders.find((name) => name.includes('123456'));
    const second = folders.find((name) => name.includes('654321'));
    assert.ok(first && second);
    assert.ok(fs.existsSync(path.join(result.destinationPath, first, 'DICOM', 'DICOMDIR')));
    assert.ok(fs.readdirSync(path.join(result.destinationPath, first)).some((name) => name.endsWith('_MR_izvid.pdf')));
    assert.equal(fs.readdirSync(path.join(result.destinationPath, second)).some((name) => name.endsWith('_MR_izvid.pdf')), false);

    const manifest = JSON.parse(fs.readFileSync(path.join(result.destinationPath, 'manifest.json'), 'utf8'));
    assert.equal(manifest.patientCount, 2);
    assert.equal(manifest.fileCount, 4);
    assert.equal(manifest.missing.length, 1);
    assert.ok(progress.some((item) => item.phase === 'copying'));
    assert.ok(progress.some((item) => item.phase === 'done'));

    const secondResult = await exporter.start({
      appointmentDate,
      destinationRoot: path.join(temp, 'usb'),
      allowMissing: true,
    });
    assert.notEqual(secondResult.destinationPath, result.destinationPath);
    assert.match(path.basename(secondResult.destinationPath), /^Fuzije_2026_08_20_2$/);

    let cancelExporter;
    let cancelRequested = false;
    cancelExporter = new ExportManager({
      database: db,
      documentManager: manager,
      onProgress: (item) => {
        if (!cancelRequested && item.phase === 'copying') {
          cancelRequested = true;
          cancelExporter.cancel();
        }
      },
    });
    await assert.rejects(
      () => cancelExporter.start({ appointmentDate, destinationRoot: path.join(temp, 'cancel-usb'), allowMissing: true }),
      (error) => error.code === 'EXPORT_CANCELLED',
    );
    const cancelRoot = path.join(temp, 'cancel-usb');
    const remaining = fs.existsSync(cancelRoot) ? fs.readdirSync(cancelRoot) : [];
    assert.equal(remaining.some((name) => name.includes('.tmp-')), false);

    const history = exporter.getHistory();
    assert.equal(history.length, 3);
    assert.equal(history.filter((item) => item.status === 'completed').length, 2);
    assert.equal(history.filter((item) => item.status === 'cancelled').length, 1);
    assert.equal(history[0].appointmentDate, appointmentDate);

    console.log('✓ Množični DICOM/PDF prenos, zaporedno poimenovanje in preklic so uspeli.');
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
