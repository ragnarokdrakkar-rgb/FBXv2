'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scanDirectory, safeSegment } = require('./document-manager.cjs');

const COPY_CONCURRENCY = 4;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nowIso() {
  return new Date().toISOString();
}

function dateLabel(iso) {
  return String(iso || '').replace(/-/g, '_');
}

function isPathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath).toLowerCase();
  const candidate = path.resolve(candidatePath).toLowerCase();
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function availableBytes(directoryPath) {
  try {
    const stat = await fs.promises.statfs(directoryPath);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

function csvCell(value) {
  let text = String(value == null ? '' : value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function makeCsv(rows) {
  const header = ['Zaporedna', 'Ura', 'Maticni indeks', 'Priimek', 'Ime', 'DICOM', 'MR izvid'];
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

class ExportCancelledError extends Error {
  constructor() {
    super('Prenos je bil preklican.');
    this.code = 'EXPORT_CANCELLED';
  }
}

class ExportManager {
  constructor({ database, documentManager, log, onProgress }) {
    this.database = database;
    this.documentManager = documentManager;
    this.log = typeof log === 'function' ? log : () => {};
    this.onProgress = typeof onProgress === 'function' ? onProgress : () => {};
    this.active = null;
  }

  emit(payload) {
    try { this.onProgress(payload); } catch {}
  }

  scheduledPatients(appointmentDate) {
    if (!DATE_RE.test(String(appointmentDate || ''))) throw new Error('Datum prenosa ni veljaven.');
    return this.database.loadState().patients
      .filter((patient) => patient.status === 'narocen' && patient.terminDatum === appointmentDate)
      .sort((a, b) => String(a.terminUra || '').localeCompare(String(b.terminUra || '')) || String(a.priimek || '').localeCompare(String(b.priimek || ''), 'sl'));
  }

  inspectPatient(patient) {
    const assets = this.database.getCurrentPatientAssets(patient.id);
    const dicomExists = !!(assets.dicom && assets.dicom.verified && fs.existsSync(assets.dicom.storedPath));
    const pdfExists = !!(assets.pdf && assets.pdf.verified && fs.existsSync(assets.pdf.storedPath));
    const missing = [];
    if (!dicomExists) missing.push('dicom');
    if (!pdfExists) missing.push('pdf');
    return {
      patient: {
        id: patient.id,
        ime: patient.ime,
        priimek: patient.priimek,
        maticniIndeks: patient.maticniIndeks,
        terminUra: patient.terminUra || '',
      },
      dicom: dicomExists ? assets.dicom : null,
      pdf: pdfExists ? assets.pdf : null,
      missing,
      estimatedFiles: (dicomExists ? Number(assets.dicom.fileCount || 0) : 0) + (pdfExists ? 1 : 0),
      estimatedBytes: (dicomExists ? Number(assets.dicom.totalBytes || 0) : 0) + (pdfExists ? Number(assets.pdf.totalBytes || 0) : 0),
    };
  }

  prepare(appointmentDate) {
    const patients = this.scheduledPatients(appointmentDate);
    const items = patients.map((patient, index) => ({ order: index + 1, ...this.inspectPatient(patient) }));
    const missing = items.flatMap((item) => item.missing.map((kind) => ({
      patientId: item.patient.id,
      name: `${item.patient.priimek} ${item.patient.ime}`.trim(),
      kind,
    })));
    return {
      appointmentDate,
      patientCount: items.length,
      readyPatientCount: items.filter((item) => item.missing.length === 0).length,
      missing,
      estimatedFiles: items.reduce((sum, item) => sum + item.estimatedFiles, 0),
      estimatedBytes: items.reduce((sum, item) => sum + item.estimatedBytes, 0),
      patients: items.map((item) => ({
        order: item.order,
        ...item.patient,
        hasDicom: !!item.dicom,
        hasPdf: !!item.pdf,
        estimatedFiles: item.estimatedFiles,
        estimatedBytes: item.estimatedBytes,
        missing: item.missing,
      })),
    };
  }

  cancel() {
    if (!this.active) return { cancelled: false };
    this.active.cancelled = true;
    return { cancelled: true, operationId: this.active.id };
  }

  assertNotCancelled(operation) {
    if (operation.cancelled) throw new ExportCancelledError();
  }

  async chooseFinalPath(destinationRoot, appointmentDate) {
    const base = `Fuzije_${dateLabel(appointmentDate)}`;
    for (let index = 0; index < 1000; index += 1) {
      const suffix = index === 0 ? '' : `_${index + 1}`;
      const candidate = path.join(destinationRoot, `${base}${suffix}`);
      try {
        await fs.promises.access(candidate);
      } catch {
        return candidate;
      }
    }
    throw new Error('V ciljni mapi je preveč map z enakim imenom.');
  }

  async buildPlan(items, operation) {
    const plan = [];
    let totalFiles = 0;
    let totalBytes = 0;
    for (const item of items) {
      this.assertNotCancelled(operation);
      const patientPlan = { ...item, dicomFiles: [], pdfFile: null };
      if (item.dicom) {
        const stat = await fs.promises.stat(item.dicom.storedPath).catch(() => null);
        if (!stat?.isDirectory()) {
          patientPlan.dicom = null;
          if (!patientPlan.missing.includes('dicom')) patientPlan.missing.push('dicom');
        } else {
          const scanned = await scanDirectory(item.dicom.storedPath);
          if (!scanned.files.length) {
            patientPlan.dicom = null;
            if (!patientPlan.missing.includes('dicom')) patientPlan.missing.push('dicom');
          } else {
            patientPlan.dicomFiles = scanned.files;
            totalFiles += scanned.files.length;
            totalBytes += scanned.totalBytes;
          }
        }
      }
      if (item.pdf) {
        const stat = await fs.promises.stat(item.pdf.storedPath).catch(() => null);
        if (!stat?.isFile()) {
          patientPlan.pdf = null;
          if (!patientPlan.missing.includes('pdf')) patientPlan.missing.push('pdf');
        } else {
          patientPlan.pdfFile = { sourcePath: item.pdf.storedPath, size: Number(stat.size || 0) };
          totalFiles += 1;
          totalBytes += Number(stat.size || 0);
        }
      }
      plan.push(patientPlan);
      this.emit({
        operationId: operation.id,
        phase: 'scanning',
        message: `Pregledujem dokumente: ${plan.length} / ${items.length}`,
        patientsDone: plan.length,
        totalPatients: items.length,
      });
    }
    return { plan, totalFiles, totalBytes };
  }

  async copyPlan(plan, stagingPath, operation, totals) {
    const tasks = [];
    const manifestPatients = [];
    let filesDone = 0;
    let bytesDone = 0;
    let lastEmit = 0;

    const emitCopy = (message) => {
      const now = Date.now();
      if (now - lastEmit < 120 && filesDone !== totals.totalFiles) return;
      lastEmit = now;
      this.emit({
        operationId: operation.id,
        phase: 'copying',
        message,
        filesDone,
        totalFiles: totals.totalFiles,
        bytesDone,
        totalBytes: totals.totalBytes,
      });
    };

    for (const item of plan) {
      this.assertNotCancelled(operation);
      const patient = item.patient;
      const folderName = [
        String(item.order).padStart(2, '0'),
        safeSegment(String(patient.terminUra || 'brez-ure').replace(':', ''), 'brez-ure', 8),
        safeSegment(patient.maticniIndeks, 'brez-MI', 36),
        safeSegment(patient.priimek, 'brez-priimka', 36),
        safeSegment(patient.ime, 'brez-imena', 36),
      ].join('_');
      const patientPath = path.join(stagingPath, folderName);
      await fs.promises.mkdir(patientPath, { recursive: true });
      const patientManifest = {
        order: item.order,
        time: patient.terminUra || '',
        patientIndex: patient.maticniIndeks || '',
        lastName: patient.priimek || '',
        firstName: patient.ime || '',
        folder: folderName,
        dicom: !!item.dicom,
        pdf: !!item.pdf,
        missing: item.missing.slice(),
        fileCount: 0,
        totalBytes: 0,
      };

      if (item.dicom && item.dicomFiles.length) {
        for (const file of item.dicomFiles) {
          tasks.push({
            sourcePath: file.sourcePath,
            destinationPath: path.join(patientPath, 'DICOM', file.relativePath),
            size: file.size,
            patientManifest,
          });
        }
      }
      if (item.pdf && item.pdfFile) {
        const pdfName = [
          safeSegment(patient.maticniIndeks, 'brez-MI', 36),
          safeSegment(patient.priimek, 'brez-priimka', 36),
          safeSegment(patient.ime, 'brez-imena', 36),
          'MR_izvid.pdf',
        ].join('_');
        tasks.push({
          sourcePath: item.pdfFile.sourcePath,
          destinationPath: path.join(patientPath, pdfName),
          size: item.pdfFile.size,
          patientManifest,
        });
      }
      manifestPatients.push(patientManifest);
    }

    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        this.assertNotCancelled(operation);
        const index = nextIndex++;
        if (index >= tasks.length) return;
        const task = tasks[index];
        await fs.promises.mkdir(path.dirname(task.destinationPath), { recursive: true });
        await fs.promises.copyFile(task.sourcePath, task.destinationPath, fs.constants.COPYFILE_EXCL);
        const stat = await fs.promises.stat(task.destinationPath);
        if (!stat.isFile() || Number(stat.size) !== task.size) {
          throw new Error(`Preverjanje kopije ni uspelo: ${path.basename(task.destinationPath)}`);
        }
        filesDone += 1;
        bytesDone += task.size;
        task.patientManifest.fileCount += 1;
        task.patientManifest.totalBytes += task.size;
        emitCopy(`Kopiram in preverjam: ${filesDone} / ${totals.totalFiles} datotek`);
      }
    };

    if (tasks.length) {
      await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, tasks.length) }, worker));
    }
    this.assertNotCancelled(operation);
    if (filesDone !== totals.totalFiles || bytesDone !== totals.totalBytes) {
      throw new Error('Končno preverjanje števila ali velikosti datotek ni uspelo.');
    }
    return { filesDone, bytesDone, manifestPatients };
  }

  async start({ appointmentDate, destinationRoot, allowMissing = false } = {}) {
    if (this.active) throw new Error('En prenos že poteka. Počakaj ali ga prekliči.');
    const destination = path.resolve(String(destinationRoot || '').trim());
    if (!path.isAbsolute(destination)) throw new Error('Ciljna mapa ni veljavna.');
    await fs.promises.mkdir(destination, { recursive: true });
    await fs.promises.access(destination, fs.constants.R_OK | fs.constants.W_OK);
    if (this.documentManager.isManagedPath(destination)) {
      throw new Error('Cilj prenosa ne sme biti znotraj glavne mape DICOM/PDF shrambe. Izberi USB ali drugo mapo.');
    }

    const patients = this.scheduledPatients(appointmentDate);
    if (!patients.length) throw new Error('Za izbrani datum ni naročenih pacientov.');
    const items = patients.map((patient, index) => ({ order: index + 1, ...this.inspectPatient(patient) }));
    const initialMissing = items.flatMap((item) => item.missing.map((kind) => ({ patientId: item.patient.id, name: `${item.patient.priimek} ${item.patient.ime}`, kind })));
    if (initialMissing.length && !allowMissing) {
      const error = new Error('Nekaterim pacientom manjka DICOM ali MR izvid. Pred prenosom potrdi, da želiš nadaljevati brez njih.');
      error.code = 'MISSING_DOCUMENTS';
      error.missing = initialMissing;
      throw error;
    }

    const operation = { id: crypto.randomUUID(), cancelled: false, startedAt: nowIso() };
    this.active = operation;
    let stagingPath = '';
    let finalPath = '';
    let recorded = false;

    try {
      this.emit({ operationId: operation.id, phase: 'scanning', message: 'Pripravljam seznam datotek …', totalPatients: items.length, patientsDone: 0 });
      const built = await this.buildPlan(items, operation);
      const missing = built.plan.flatMap((item) => item.missing.map((kind) => ({ patientId: item.patient.id, name: `${item.patient.priimek} ${item.patient.ime}`, kind })));
      if (missing.length && !allowMissing) {
        const error = new Error('Med pripravo prenosa je bilo ugotovljeno, da dokumenti manjkajo.');
        error.code = 'MISSING_DOCUMENTS';
        error.missing = missing;
        throw error;
      }
      if (!built.totalFiles) throw new Error('Za izbrani dan ni nobene dosegljive DICOM ali PDF datoteke.');

      const free = await availableBytes(destination);
      const reserve = Math.max(100 * 1024 * 1024, Math.ceil(built.totalBytes * 0.02));
      if (free != null && free < built.totalBytes + reserve) {
        const error = new Error('Na izbranem cilju ni dovolj prostora za prenos.');
        error.code = 'NOT_ENOUGH_SPACE';
        error.requiredBytes = built.totalBytes + reserve;
        error.availableBytes = free;
        throw error;
      }

      finalPath = await this.chooseFinalPath(destination, appointmentDate);
      stagingPath = `${finalPath}.tmp-${operation.id}`;
      await fs.promises.mkdir(stagingPath, { recursive: false });
      this.database.recordExportRun({
        id: operation.id,
        appointmentDate,
        destinationPath: finalPath,
        patientCount: items.length,
        exportedPatientCount: 0,
        fileCount: 0,
        totalBytes: 0,
        missing,
        status: 'started',
        startedAt: operation.startedAt,
      });
      recorded = true;

      const copied = await this.copyPlan(built.plan, stagingPath, operation, built);
      const csvRows = built.plan.map((item) => [
        item.order,
        item.patient.terminUra || '',
        item.patient.maticniIndeks || '',
        item.patient.priimek || '',
        item.patient.ime || '',
        item.dicom ? 'DA' : 'NE',
        item.pdf ? 'DA' : 'NE',
      ]);
      await fs.promises.writeFile(path.join(stagingPath, 'seznam_pacientov.csv'), makeCsv(csvRows), 'utf8');
      const manifest = {
        format: 'FBX-EXPORT-V1',
        appointmentDate,
        generatedAt: nowIso(),
        patientCount: items.length,
        exportedPatientCount: copied.manifestPatients.filter((item) => item.fileCount > 0).length,
        fileCount: copied.filesDone,
        totalBytes: copied.bytesDone,
        missing,
        patients: copied.manifestPatients,
      };
      await fs.promises.writeFile(path.join(stagingPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      this.assertNotCancelled(operation);
      await fs.promises.rename(stagingPath, finalPath);
      stagingPath = '';
      const completedAt = nowIso();
      const result = {
        operationId: operation.id,
        appointmentDate,
        destinationPath: finalPath,
        patientCount: items.length,
        exportedPatientCount: manifest.exportedPatientCount,
        fileCount: copied.filesDone,
        totalBytes: copied.bytesDone,
        missing,
        completedAt,
      };
      this.database.recordExportRun({
        id: operation.id,
        appointmentDate,
        destinationPath: finalPath,
        patientCount: items.length,
        exportedPatientCount: result.exportedPatientCount,
        fileCount: result.fileCount,
        totalBytes: result.totalBytes,
        missing,
        status: 'completed',
        startedAt: operation.startedAt,
        completedAt,
        details: { manifest: 'manifest.json', patientList: 'seznam_pacientov.csv' },
      });
      this.emit({ operationId: operation.id, phase: 'done', message: 'Prenos je končan in preverjen.', ...result });
      return result;
    } catch (error) {
      if (stagingPath) await fs.promises.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
      if (recorded) {
        this.database.recordExportRun({
          id: operation.id,
          appointmentDate,
          destinationPath: finalPath || destination,
          patientCount: patients.length,
          exportedPatientCount: 0,
          fileCount: 0,
          totalBytes: 0,
          missing: initialMissing,
          status: error.code === 'EXPORT_CANCELLED' ? 'cancelled' : 'failed',
          startedAt: operation.startedAt,
          completedAt: nowIso(),
          details: { error: error.message },
        });
      }
      this.emit({ operationId: operation.id, phase: error.code === 'EXPORT_CANCELLED' ? 'cancelled' : 'error', message: error.message });
      this.log('Množični prenos ni uspel.', error);
      throw error;
    } finally {
      this.active = null;
    }
  }

  getHistory(limit = 20) {
    return this.database.getExportHistory(limit);
  }
}

module.exports = { ExportManager, makeCsv };
