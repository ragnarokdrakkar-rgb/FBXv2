'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COPY_CONCURRENCY = 4;

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function safeSegment(value, fallback = 'brez-podatka', maxLength = 48) {
  let text = String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[. _]+|[. _]+$/g, '')
    .slice(0, maxLength);

  if (!text) text = fallback;
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(text)) text = `_${text}`;
  return text;
}

function compactTimestamp(date = new Date()) {
  const p = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function dateStamp(date = new Date()) {
  const p = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function isPathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath).toLowerCase();
  const candidate = path.resolve(candidatePath).toLowerCase();
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function scanDirectory(rootPath) {
  const root = path.resolve(rootPath);
  const files = [];
  const stack = [root];
  let totalBytes = 0;
  let skippedLinks = 0;

  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        skippedLinks += 1;
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.promises.stat(fullPath);
      const relativePath = path.relative(root, fullPath);
      files.push({ sourcePath: fullPath, relativePath, size: Number(stat.size || 0) });
      totalBytes += Number(stat.size || 0);
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, totalBytes, skippedLinks };
}

async function availableBytes(directoryPath) {
  try {
    const stat = await fs.promises.statfs(directoryPath);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

async function readPdfHeader(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(5);
    const { bytesRead } = await handle.read(buffer, 0, 5, 0);
    return buffer.subarray(0, bytesRead).toString('ascii');
  } finally {
    await handle.close();
  }
}

class DocumentManager {
  constructor({ database, configDirectory, defaultRoot, log, onProgress }) {
    this.database = database;
    this.configDirectory = configDirectory;
    this.defaultRoot = path.resolve(defaultRoot);
    this.log = typeof log === 'function' ? log : () => {};
    this.onProgress = typeof onProgress === 'function' ? onProgress : () => {};
    this.configPath = path.join(configDirectory, 'documents-config.json');
    this.config = readJson(this.configPath, {});
    this.activePatients = new Set();
    this.healthScanActive = false;
    this.initError = '';
    try { this.ensureRoot(); } catch (error) { this.initError = error.message || String(error); }
  }

  get rootPath() {
    return path.resolve(this.config.rootPath || this.defaultRoot);
  }

  get knownRoots() {
    const roots = Array.isArray(this.config.knownRoots) ? this.config.knownRoots : [];
    return Array.from(new Set([this.rootPath, ...roots.map((item) => path.resolve(item))]));
  }

  isManagedPath(candidatePath) {
    return this.knownRoots.some((root) => isPathInside(root, candidatePath));
  }

  ensureRoot() {
    fs.mkdirSync(path.join(this.rootPath, 'Pacienti'), { recursive: true });
    if (!this.config.rootPath) this.config.rootPath = this.rootPath;
    this.config.knownRoots = Array.from(new Set([...(this.config.knownRoots || []), this.rootPath]));
    this.saveConfig();
  }

  saveConfig() {
    atomicWriteJson(this.configPath, this.config);
  }

  setRoot(rootPath) {
    const resolved = path.resolve(String(rootPath || '').trim());
    if (!path.isAbsolute(resolved)) throw new Error('Izbrana mapa dokumentov ni veljavna.');
    fs.mkdirSync(path.join(resolved, 'Pacienti'), { recursive: true });
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    this.config.knownRoots = Array.from(new Set([...(this.config.knownRoots || []), this.rootPath, resolved]));
    this.config.rootPath = resolved;
    this.saveConfig();
    return this.getStatus();
  }

  async getStatus() {
    const diagnostics = this.database.getAssetDiagnostics();
    try {
      this.ensureRoot();
      this.initError = '';
      return {
        rootPath: this.rootPath,
        exists: fs.existsSync(this.rootPath),
        writable: true,
        error: '',
        freeBytes: await availableBytes(this.rootPath),
        ...diagnostics,
      };
    } catch (error) {
      this.initError = error.message || String(error);
      return {
        rootPath: this.rootPath,
        exists: fs.existsSync(this.rootPath),
        writable: false,
        error: this.initError,
        freeBytes: null,
        ...diagnostics,
      };
    }
  }

  requireRoot() {
    this.ensureRoot();
    fs.accessSync(this.rootPath, fs.constants.R_OK | fs.constants.W_OK);
    return this.rootPath;
  }

  getSummary() {
    return this.database.getAssetSummary();
  }

  getPatientAssets(patientId) {
    return this.database.getPatientAssets(String(patientId || ''));
  }

  getPatient(patientId) {
    const patient = this.database.getPatient(String(patientId || ''));
    if (!patient) throw new Error('Pacienta ni več v lokalni bazi.');
    return patient;
  }

  patientFolderName(patient) {
    const index = safeSegment(patient.maticniIndeks, 'brez-MI', 36);
    const lastName = safeSegment(patient.priimek, 'brez-priimka', 36);
    const firstName = safeSegment(patient.ime, 'brez-imena', 36);
    const id = safeSegment(patient.id, 'id', 12);
    return `${index}_${lastName}_${firstName}_${id}`;
  }

  patientRoot(patient) {
    return path.join(this.rootPath, 'Pacienti', this.patientFolderName(patient));
  }

  emit(operationId, payload) {
    try {
      this.onProgress({ operationId, ...payload });
    } catch {
      // Progress reporting must never interrupt a copy.
    }
  }

  beginPatientOperation(patientId) {
    if (this.activePatients.has(patientId)) {
      throw new Error('Za tega pacienta že poteka kopiranje dokumentov. Počakaj, da se konča.');
    }
    this.activePatients.add(patientId);
  }

  endPatientOperation(patientId) {
    this.activePatients.delete(patientId);
  }

  async importDicom(patientId, sourcePath) {
    const patient = this.getPatient(patientId);
    this.requireRoot();
    this.beginPatientOperation(patient.id);
    const operationId = crypto.randomUUID();
    let stagingPath = '';
    let finalPath = '';

    try {
      const source = await fs.promises.realpath(path.resolve(sourcePath));
      const sourceStat = await fs.promises.stat(source);
      if (!sourceStat.isDirectory()) throw new Error('Izbrani DICOM vir ni mapa.');
      if (this.isManagedPath(source)) {
        throw new Error('Izbrana mapa je že znotraj shrambe aplikacije. Izberi originalno DICOM mapo.');
      }

      this.emit(operationId, { patientId: patient.id, kind: 'dicom', phase: 'scanning', message: 'Pregledujem DICOM mapo …' });
      const scanned = await scanDirectory(source);
      if (!scanned.files.length) throw new Error('Izbrana mapa ne vsebuje nobene datoteke.');

      const free = await availableBytes(this.rootPath);
      const reserve = Math.max(100 * 1024 * 1024, Math.ceil(scanned.totalBytes * 0.03));
      if (free != null && free < scanned.totalBytes + reserve) {
        const error = new Error('Na ciljnem disku ni dovolj prostora za DICOM mapo.');
        error.code = 'NOT_ENOUGH_SPACE';
        error.requiredBytes = scanned.totalBytes + reserve;
        error.availableBytes = free;
        throw error;
      }

      const patientRoot = this.patientRoot(patient);
      await fs.promises.mkdir(patientRoot, { recursive: true });
      const stamp = compactTimestamp();
      finalPath = path.join(patientRoot, `DICOM_${stamp}_${operationId.slice(0, 8)}`);
      stagingPath = path.join(patientRoot, `.tmp-DICOM-${operationId}`);
      if (isPathInside(source, stagingPath)) throw new Error('Ciljna mapa ne sme biti znotraj izvorne DICOM mape.');
      await fs.promises.mkdir(stagingPath, { recursive: true });

      let nextIndex = 0;
      let filesDone = 0;
      let bytesDone = 0;
      let lastProgressAt = 0;
      const copyWorker = async () => {
        while (true) {
          const index = nextIndex++;
          if (index >= scanned.files.length) return;
          const file = scanned.files[index];
          const destination = path.join(stagingPath, file.relativePath);
          await fs.promises.mkdir(path.dirname(destination), { recursive: true });
          await fs.promises.copyFile(file.sourcePath, destination, fs.constants.COPYFILE_EXCL);
          filesDone += 1;
          bytesDone += file.size;
          const now = Date.now();
          if (now - lastProgressAt > 150 || filesDone === scanned.files.length) {
            lastProgressAt = now;
            this.emit(operationId, {
              patientId: patient.id,
              kind: 'dicom',
              phase: 'copying',
              filesDone,
              totalFiles: scanned.files.length,
              bytesDone,
              totalBytes: scanned.totalBytes,
              message: `Kopiram DICOM: ${filesDone} / ${scanned.files.length}`,
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, scanned.files.length) }, copyWorker));

      this.emit(operationId, {
        patientId: patient.id,
        kind: 'dicom',
        phase: 'verifying',
        filesDone: 0,
        totalFiles: scanned.files.length,
        bytesDone: 0,
        totalBytes: scanned.totalBytes,
        message: 'Preverjam kopirane datoteke …',
      });

      let verifiedBytes = 0;
      for (let index = 0; index < scanned.files.length; index += 1) {
        const file = scanned.files[index];
        const destination = path.join(stagingPath, file.relativePath);
        const stat = await fs.promises.stat(destination);
        if (!stat.isFile() || Number(stat.size) !== file.size) {
          throw new Error(`Preverjanje kopije ni uspelo pri datoteki: ${file.relativePath}`);
        }
        verifiedBytes += Number(stat.size);
        if (index % 100 === 0 || index + 1 === scanned.files.length) {
          this.emit(operationId, {
            patientId: patient.id,
            kind: 'dicom',
            phase: 'verifying',
            filesDone: index + 1,
            totalFiles: scanned.files.length,
            bytesDone: verifiedBytes,
            totalBytes: scanned.totalBytes,
            message: `Preverjam DICOM: ${index + 1} / ${scanned.files.length}`,
          });
        }
      }
      if (verifiedBytes !== scanned.totalBytes) throw new Error('Skupna velikost DICOM kopije se ne ujema z izvorom.');

      await fs.promises.rename(stagingPath, finalPath);
      stagingPath = '';
      const asset = this.database.addPatientAsset({
        id: crypto.randomUUID(),
        patientId: patient.id,
        kind: 'dicom',
        isCurrent: true,
        storedPath: finalPath,
        sourceName: path.basename(source),
        displayName: `DICOM – ${scanned.files.length} datotek`,
        fileCount: scanned.files.length,
        totalBytes: scanned.totalBytes,
        verified: true,
        extra: { skippedLinks: scanned.skippedLinks },
      });

      this.emit(operationId, {
        patientId: patient.id,
        kind: 'dicom',
        phase: 'done',
        filesDone: scanned.files.length,
        totalFiles: scanned.files.length,
        bytesDone: scanned.totalBytes,
        totalBytes: scanned.totalBytes,
        message: 'DICOM mapa je kopirana in preverjena.',
      });
      return { operationId, asset, assets: this.getPatientAssets(patient.id), summary: this.getSummary()[patient.id] || {} };
    } catch (error) {
      if (stagingPath) await fs.promises.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
      if (finalPath && !this.database.findAssetByPath(finalPath)) {
        await fs.promises.rm(finalPath, { recursive: true, force: true }).catch(() => {});
      }
      this.emit(operationId, { patientId: patient.id, kind: 'dicom', phase: 'error', message: error.message });
      this.log('DICOM uvoz ni uspel.', error);
      throw error;
    } finally {
      this.endPatientOperation(patient.id);
    }
  }

  async importPdf(patientId, sourcePath) {
    const patient = this.getPatient(patientId);
    this.requireRoot();
    this.beginPatientOperation(patient.id);
    const operationId = crypto.randomUUID();
    let tempPath = '';
    let finalPath = '';

    try {
      const source = await fs.promises.realpath(path.resolve(sourcePath));
      const stat = await fs.promises.stat(source);
      if (!stat.isFile()) throw new Error('Izbrani MR izvid ni datoteka.');
      if (path.extname(source).toLowerCase() !== '.pdf') throw new Error('MR izvid mora biti PDF datoteka.');
      if (stat.size < 5 || (await readPdfHeader(source)) !== '%PDF-') throw new Error('Izbrana datoteka ni veljaven PDF.');

      const patientRoot = this.patientRoot(patient);
      const pdfRoot = path.join(patientRoot, 'MR_izvidi');
      await fs.promises.mkdir(pdfRoot, { recursive: true });
      const baseName = [
        safeSegment(patient.maticniIndeks, 'brez-MI', 36),
        safeSegment(patient.priimek, 'brez-priimka', 36),
        safeSegment(patient.ime, 'brez-imena', 36),
        'MR_izvid',
        dateStamp(),
        compactTimestamp().slice(9),
        operationId.slice(0, 8),
      ].join('_');
      finalPath = path.join(pdfRoot, `${baseName}.pdf`);
      tempPath = `${finalPath}.tmp-${operationId}`;

      this.emit(operationId, {
        patientId: patient.id,
        kind: 'mr_pdf',
        phase: 'copying',
        filesDone: 0,
        totalFiles: 1,
        bytesDone: 0,
        totalBytes: Number(stat.size),
        message: 'Kopiram MR izvid …',
      });
      await fs.promises.copyFile(source, tempPath, fs.constants.COPYFILE_EXCL);
      const copied = await fs.promises.stat(tempPath);
      if (Number(copied.size) !== Number(stat.size) || (await readPdfHeader(tempPath)) !== '%PDF-') {
        throw new Error('Preverjanje kopiranega PDF-izvida ni uspelo.');
      }
      await fs.promises.rename(tempPath, finalPath);
      tempPath = '';

      const asset = this.database.addPatientAsset({
        id: crypto.randomUUID(),
        patientId: patient.id,
        kind: 'mr_pdf',
        isCurrent: true,
        storedPath: finalPath,
        sourceName: path.basename(source),
        displayName: path.basename(finalPath),
        fileCount: 1,
        totalBytes: Number(stat.size),
        verified: true,
        extra: {},
      });
      this.emit(operationId, {
        patientId: patient.id,
        kind: 'mr_pdf',
        phase: 'done',
        filesDone: 1,
        totalFiles: 1,
        bytesDone: Number(stat.size),
        totalBytes: Number(stat.size),
        message: 'MR izvid je kopiran, poimenovan in preverjen.',
      });
      return { operationId, asset, assets: this.getPatientAssets(patient.id), summary: this.getSummary()[patient.id] || {} };
    } catch (error) {
      if (tempPath) await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      if (finalPath && !this.database.findAssetByPath(finalPath)) await fs.promises.rm(finalPath, { force: true }).catch(() => {});
      this.emit(operationId, { patientId: patient.id, kind: 'mr_pdf', phase: 'error', message: error.message });
      this.log('Uvoz MR PDF izvida ni uspel.', error);
      throw error;
    } finally {
      this.endPatientOperation(patient.id);
    }
  }

  async verifyAllDocuments() {
    if (this.healthScanActive) throw new Error('Preverjanje dokumentov že poteka.');
    this.healthScanActive = true;
    const operationId = crypto.randomUUID();
    const assets = this.database.getCurrentAssetRecords();
    const issues = [];
    let checked = 0;

    try {
      this.emit(operationId, {
        kind: 'health_check',
        phase: 'scanning',
        message: `Preverjam dokumente: 0 / ${assets.length}`,
        filesDone: 0,
        totalFiles: assets.length,
      });

      for (const asset of assets) {
        const patient = this.database.getPatient(asset.patientId);
        const base = {
          assetId: asset.id,
          patientId: asset.patientId,
          patientName: patient ? `${patient.priimek || ''} ${patient.ime || ''}`.trim() : 'Pacient ne obstaja',
          patientIndex: patient?.maticniIndeks || '',
          kind: asset.kind,
          displayName: asset.displayName,
          storedPath: asset.storedPath,
        };

        if (!patient) {
          issues.push({ ...base, issue: 'missing_patient', message: 'Dokument je vezan na pacienta, ki ga ni več v evidenci.' });
        } else {
          const stat = await fs.promises.stat(asset.storedPath).catch(() => null);
          if (!stat) {
            issues.push({ ...base, issue: 'missing', message: 'Datoteka ali mapa na disku ne obstaja.' });
          } else if (asset.kind === 'dicom') {
            if (!stat.isDirectory()) {
              issues.push({ ...base, issue: 'wrong_type', message: 'DICOM pot ni mapa.' });
            } else {
              try {
                const scanned = await scanDirectory(asset.storedPath);
                if (!scanned.files.length) {
                  issues.push({ ...base, issue: 'empty', message: 'DICOM mapa je prazna.' });
                } else if (Number(asset.fileCount || 0) !== scanned.files.length || Number(asset.totalBytes || 0) !== scanned.totalBytes) {
                  issues.push({
                    ...base,
                    issue: 'mismatch',
                    message: `DICOM se ne ujema z zapisom (${scanned.files.length}/${asset.fileCount} datotek; ${scanned.totalBytes}/${asset.totalBytes} bajtov).`,
                    actualFileCount: scanned.files.length,
                    actualBytes: scanned.totalBytes,
                  });
                }
              } catch (error) {
                issues.push({ ...base, issue: 'unreadable', message: `DICOM mape ni mogoče prebrati: ${error.message}` });
              }
            }
          } else if (asset.kind === 'mr_pdf') {
            if (!stat.isFile()) {
              issues.push({ ...base, issue: 'wrong_type', message: 'MR izvid ni datoteka.' });
            } else {
              let header = '';
              try { header = await readPdfHeader(asset.storedPath); } catch {}
              if (header !== '%PDF-') {
                issues.push({ ...base, issue: 'invalid_pdf', message: 'Datoteka nima veljavne PDF glave.' });
              } else if (Number(stat.size || 0) !== Number(asset.totalBytes || 0)) {
                issues.push({
                  ...base,
                  issue: 'mismatch',
                  message: `Velikost PDF-ja se ne ujema z zapisom (${stat.size}/${asset.totalBytes} bajtov).`,
                  actualBytes: Number(stat.size || 0),
                });
              }
            }
          }
        }

        checked += 1;
        this.emit(operationId, {
          kind: 'health_check',
          phase: 'scanning',
          message: `Preverjam dokumente: ${checked} / ${assets.length}`,
          filesDone: checked,
          totalFiles: assets.length,
        });
      }

      const result = {
        operationId,
        checkedAt: new Date().toISOString(),
        assetCount: assets.length,
        healthyCount: Math.max(0, assets.length - issues.length),
        issueCount: issues.length,
        issues,
        healthy: issues.length === 0,
      };
      this.emit(operationId, {
        kind: 'health_check',
        phase: 'done',
        message: issues.length ? `Preverjanje končano: ${issues.length} težav.` : 'Vsi dokumenti so dosegljivi in se ujemajo z evidenco.',
        filesDone: assets.length,
        totalFiles: assets.length,
        ...result,
      });
      return result;
    } catch (error) {
      this.emit(operationId, { kind: 'health_check', phase: 'error', message: error.message });
      this.log('Preverjanje dokumentov ni uspelo.', error);
      throw error;
    } finally {
      this.healthScanActive = false;
    }
  }

  async deleteAsset(assetId) {
    const asset = this.database.getPatientAsset(String(assetId || ''));
    if (!asset) throw new Error('Dokument ne obstaja več.');
    const storedPath = path.resolve(asset.storedPath);
    if (!this.isManagedPath(storedPath)) {
      throw new Error('Dokument je izven znanih map shrambe. Zaradi varnosti ga aplikacija ne bo izbrisala.');
    }
    await fs.promises.rm(storedPath, { recursive: asset.kind === 'dicom', force: false });
    this.database.deletePatientAsset(asset.id);
    return { deleted: true, patientId: asset.patientId, assets: this.getPatientAssets(asset.patientId), summary: this.getSummary()[asset.patientId] || {} };
  }

  async deletePatientDocuments(patientId) {
    const patient = this.getPatient(patientId);
    const assets = this.getPatientAssets(patient.id);
    if (this.activePatients.has(patient.id)) {
      throw new Error('Za tega pacienta trenutno poteka drugo delo z dokumenti. Počakaj, da se konča.');
    }

    for (const asset of assets) {
      const storedPath = path.resolve(asset.storedPath);
      if (!this.isManagedPath(storedPath)) {
        throw new Error('Vsaj en dokument je izven znanih map shrambe. Zaradi varnosti avtomatsko brisanje ni dovoljeno.');
      }
    }

    this.beginPatientOperation(patient.id);
    const errors = [];
    let deletedCount = 0;
    let deletedBytes = 0;
    const cleanupFolders = new Set();

    const removeIfEmpty = async (folderPath) => {
      try {
        if (!this.isManagedPath(folderPath)) return;
        const entries = await fs.promises.readdir(folderPath);
        if (!entries.length) await fs.promises.rmdir(folderPath);
      } catch {}
    };

    try {
      for (const asset of assets) {
        const storedPath = path.resolve(asset.storedPath);
        try {
          await fs.promises.rm(storedPath, {
            recursive: asset.kind === 'dicom',
            force: true,
          });
          this.database.deletePatientAsset(asset.id);
          deletedCount += 1;
          deletedBytes += Number(asset.totalBytes || 0);

          if (asset.kind === 'mr_pdf') {
            cleanupFolders.add(path.dirname(storedPath));
            cleanupFolders.add(path.dirname(path.dirname(storedPath)));
          } else {
            cleanupFolders.add(path.dirname(storedPath));
          }
        } catch (error) {
          errors.push({
            assetId: asset.id,
            kind: asset.kind,
            storedPath,
            message: error.message || String(error),
          });
        }
      }

      const folders = Array.from(cleanupFolders).sort((a, b) => b.length - a.length);
      for (const folder of folders) await removeIfEmpty(folder);

      const complete = errors.length === 0;
      this.database.recordPatientEvent(
        patient.id,
        complete ? 'positive_documents_deleted' : 'positive_documents_delete_partial',
        complete
          ? 'Vsi DICOM in MR dokumenti izbrisani po pozitivnem rezultatu'
          : 'Brisanje dokumentov po pozitivnem rezultatu ni bilo popolno',
        { deletedCount, deletedBytes, errorCount: errors.length },
      );

      return {
        complete,
        patientId: patient.id,
        deletedCount,
        deletedBytes,
        errorCount: errors.length,
        errors,
        remainingAssets: this.getPatientAssets(patient.id),
        summary: this.getSummary()[patient.id] || {},
      };
    } finally {
      this.endPatientOperation(patient.id);
    }
  }

  resolveAsset(assetId) {
    const asset = this.database.getPatientAsset(String(assetId || ''));
    if (!asset) throw new Error('Dokument ne obstaja več.');
    if (!fs.existsSync(asset.storedPath)) {
      const error = new Error('Dokument na disku ni več dosegljiv.');
      error.code = 'DOCUMENT_MISSING';
      throw error;
    }
    return asset;
  }

  getOpenPath(assetId) {
    return this.resolveAsset(assetId).storedPath;
  }

  getRevealPath(assetId) {
    return this.resolveAsset(assetId).storedPath;
  }

  getPatientFolder(patientId) {
    const patient = this.getPatient(patientId);
    const assets = this.getPatientAssets(patient.id);
    if (assets.length) {
      const newest = assets[0];
      return newest.kind === 'dicom' ? path.dirname(newest.storedPath) : path.dirname(path.dirname(newest.storedPath));
    }
    this.requireRoot();
    const folder = this.patientRoot(patient);
    fs.mkdirSync(folder, { recursive: true });
    return folder;
  }
}

module.exports = {
  DocumentManager,
  scanDirectory,
  safeSegment,
};
