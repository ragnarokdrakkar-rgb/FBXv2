'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { backup, DatabaseSync } = require('node:sqlite');

const MAX_INTERNAL_BACKUPS = 10;
const MAX_AUDIT_ROWS = 1000;

function nowIso() {
  return new Date().toISOString();
}

function asText(value, max = 10000) {
  return String(value == null ? '' : value).slice(0, max);
}

function parseJson(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

class AppDatabase {
  constructor(databasePath) {
    this.databasePath = databasePath;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });

    this.db = new DatabaseSync(databasePath, {
      open: true,
      readOnly: false,
      enableForeignKeyConstraints: true,
    });

    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
    `);

    this.#migrate();
    this.#verifyIntegrity();
  }

  #migrate() {
    const current = Number(this.db.prepare('PRAGMA user_version').get().user_version || 0);

    if (current < 1) {
      this.#transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          ) STRICT;

          CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY,
            sort_order INTEGER NOT NULL DEFAULT 0,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            patient_index TEXT NOT NULL,
            status TEXT NOT NULL,
            enrollment_date TEXT NOT NULL,
            birth_date TEXT,
            phone TEXT,
            mr_facility TEXT,
            notes TEXT,
            appointment_date TEXT,
            appointment_time TEXT,
            completion_date TEXT,
            raw_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE INDEX IF NOT EXISTS idx_patients_status
            ON patients(status);
          CREATE INDEX IF NOT EXISTS idx_patients_appointment
            ON patients(appointment_date, appointment_time);
          CREATE INDEX IF NOT EXISTS idx_patients_index
            ON patients(patient_index);

          CREATE TABLE IF NOT EXISTS internal_backups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            description TEXT NOT NULL,
            patients_json TEXT NOT NULL
          ) STRICT;

          CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            action TEXT NOT NULL,
            details_json TEXT NOT NULL
          ) STRICT;

          INSERT OR IGNORE INTO meta(key, value) VALUES ('revision', '0');
          INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');
          INSERT OR IGNORE INTO app_settings(id, json, updated_at)
            VALUES (1, '{}', '1970-01-01T00:00:00.000Z');

          PRAGMA user_version = 1;
        `);
      });
    }

    if (current < 2) {
      this.#transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS patient_assets (
            id TEXT PRIMARY KEY,
            patient_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('dicom', 'mr_pdf')),
            is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
            stored_path TEXT NOT NULL UNIQUE,
            source_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            file_count INTEGER NOT NULL DEFAULT 0,
            total_bytes INTEGER NOT NULL DEFAULT 0,
            verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
            extra_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE INDEX IF NOT EXISTS idx_patient_assets_patient
            ON patient_assets(patient_id, kind, is_current, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_patient_assets_current
            ON patient_assets(patient_id, is_current);

          INSERT INTO meta(key, value) VALUES ('schema_version', '2')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value;

          PRAGMA user_version = 2;
        `);
      });
    }

    if (current < 3) {
      this.#transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS export_runs (
            id TEXT PRIMARY KEY,
            appointment_date TEXT NOT NULL,
            destination_path TEXT NOT NULL,
            patient_count INTEGER NOT NULL DEFAULT 0,
            exported_patient_count INTEGER NOT NULL DEFAULT 0,
            file_count INTEGER NOT NULL DEFAULT 0,
            total_bytes INTEGER NOT NULL DEFAULT 0,
            missing_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            details_json TEXT NOT NULL DEFAULT '{}'
          ) STRICT;

          CREATE INDEX IF NOT EXISTS idx_export_runs_date
            ON export_runs(appointment_date, started_at DESC);

          INSERT INTO meta(key, value) VALUES ('schema_version', '3')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value;

          PRAGMA user_version = 3;
        `);
      });
    }
  }

  #verifyIntegrity() {
    const result = this.db.prepare('PRAGMA quick_check').get();
    const value = result ? Object.values(result)[0] : null;
    if (value !== 'ok') {
      throw new Error(`SQLite integrity check failed: ${value || 'unknown result'}`);
    }
  }

  #transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The original error is more useful.
      }
      throw error;
    }
  }

  #getRevision() {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'revision'").get();
    return Number(row?.value || 0);
  }

  #setRevision(revision) {
    this.db.prepare(`
      INSERT INTO meta(key, value) VALUES ('revision', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(revision));
  }

  #nextRevision() {
    const next = this.#getRevision() + 1;
    this.#setRevision(next);
    return next;
  }

  #assertRevision(expectedRevision) {
    if (expectedRevision == null) return;
    const current = this.#getRevision();
    if (Number(expectedRevision) !== current) {
      const error = new Error('Podatki so bili medtem spremenjeni. Osveži aplikacijo in poskusi znova.');
      error.code = 'REVISION_CONFLICT';
      error.currentRevision = current;
      throw error;
    }
  }

  #readPatients() {
    return this.db
      .prepare('SELECT raw_json FROM patients ORDER BY sort_order ASC, id ASC')
      .all()
      .map((row) => parseJson(row.raw_json, null))
      .filter(Boolean);
  }

  #readSettings() {
    const row = this.db.prepare('SELECT json FROM app_settings WHERE id = 1').get();
    return parseJson(row?.json || '{}', {});
  }

  getPatient(patientId) {
    const row = this.db.prepare('SELECT raw_json FROM patients WHERE id = ?').get(asText(patientId, 100));
    return row ? parseJson(row.raw_json, null) : null;
  }

  #readBackups() {
    return this.db
      .prepare(`
        SELECT id, created_at, description, patients_json
        FROM internal_backups
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(MAX_INTERNAL_BACKUPS)
      .map((row) => ({
        id: Number(row.id),
        cas: row.created_at,
        opis: row.description,
        podatki: row.patients_json,
      }));
  }

  loadState() {
    return {
      patients: this.#readPatients(),
      settings: this.#readSettings(),
      backups: this.#readBackups(),
      revision: this.#getRevision(),
      schemaVersion: 3,
    };
  }

  saveSettings({ settings, expectedRevision } = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new TypeError('Nastavitve niso veljaven objekt.');
    }

    return this.#transaction(() => {
      this.#assertRevision(expectedRevision);
      const timestamp = nowIso();
      this.db.prepare(`
        INSERT INTO app_settings(id, json, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          json = excluded.json,
          updated_at = excluded.updated_at
      `).run(JSON.stringify(settings), timestamp);

      const revision = this.#nextRevision();
      this.#insertAudit('settings_saved', { revision });
      return { revision, backups: this.#readBackups() };
    });
  }

  saveState({ patients, settings, description, expectedRevision } = {}) {
    if (!Array.isArray(patients)) {
      throw new TypeError('Seznam pacientov ni veljaven.');
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new TypeError('Nastavitve niso veljaven objekt.');
    }

    const ids = new Set();
    for (const patient of patients) {
      if (!patient || typeof patient !== 'object' || Array.isArray(patient)) {
        throw new TypeError('Seznam vsebuje neveljaven zapis pacienta.');
      }
      const id = asText(patient.id, 100);
      if (!id || ids.has(id)) {
        throw new TypeError('Pacient nima veljavnega unikatnega ID-ja.');
      }
      ids.add(id);
    }

    return this.#transaction(() => {
      this.#assertRevision(expectedRevision);

      const previousPatients = this.#readPatients();
      const previousJson = JSON.stringify(previousPatients);
      const nextJson = JSON.stringify(patients);
      const timestamp = nowIso();

      if (previousPatients.length > 0 && previousJson !== nextJson) {
        this.db.prepare(`
          INSERT INTO internal_backups(created_at, description, patients_json)
          VALUES (?, ?, ?)
        `).run(timestamp, asText(description || 'sprememba', 300), previousJson);

        this.db.prepare(`
          DELETE FROM internal_backups
          WHERE id NOT IN (
            SELECT id FROM internal_backups ORDER BY id DESC LIMIT ?
          )
        `).run(MAX_INTERNAL_BACKUPS);
      }

      const upsert = this.db.prepare(`
        INSERT INTO patients(
          id, sort_order, first_name, last_name, patient_index, status,
          enrollment_date, birth_date, phone, mr_facility, notes,
          appointment_date, appointment_time, completion_date,
          raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          sort_order = excluded.sort_order,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          patient_index = excluded.patient_index,
          status = excluded.status,
          enrollment_date = excluded.enrollment_date,
          birth_date = excluded.birth_date,
          phone = excluded.phone,
          mr_facility = excluded.mr_facility,
          notes = excluded.notes,
          appointment_date = excluded.appointment_date,
          appointment_time = excluded.appointment_time,
          completion_date = excluded.completion_date,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at
      `);

      patients.forEach((patient, index) => {
        const rawJson = JSON.stringify(patient);
        upsert.run(
          asText(patient.id, 100),
          index,
          asText(patient.ime, 120),
          asText(patient.priimek, 120),
          asText(patient.maticniIndeks, 120),
          asText(patient.status || 'cakalni', 30),
          asText(patient.datumVpisa, 10),
          patient.datumRojstva ? asText(patient.datumRojstva, 10) : null,
          patient.telefon ? asText(patient.telefon, 80) : null,
          patient.mrUstanova ? asText(patient.mrUstanova, 200) : null,
          patient.opombe ? asText(patient.opombe, 10000) : null,
          patient.terminDatum ? asText(patient.terminDatum, 10) : null,
          patient.terminUra ? asText(patient.terminUra, 5) : null,
          patient.datumZakljucka ? asText(patient.datumZakljucka, 10) : null,
          rawJson,
          timestamp,
          timestamp,
        );
      });

      const existingIds = this.db.prepare('SELECT id FROM patients').all().map((row) => row.id);
      const remove = this.db.prepare('DELETE FROM patients WHERE id = ?');
      for (const id of existingIds) {
        if (!ids.has(id)) remove.run(id);
      }

      this.db.prepare(`
        INSERT INTO app_settings(id, json, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          json = excluded.json,
          updated_at = excluded.updated_at
      `).run(JSON.stringify(settings), timestamp);

      const revision = this.#nextRevision();
      this.#insertAudit('state_saved', {
        revision,
        description: asText(description || 'sprememba', 300),
        patientCount: patients.length,
      });

      return {
        revision,
        backups: this.#readBackups(),
        patientCount: patients.length,
      };
    });
  }

  #insertAudit(action, details) {
    this.db.prepare(`
      INSERT INTO audit_log(created_at, action, details_json)
      VALUES (?, ?, ?)
    `).run(nowIso(), asText(action, 100), JSON.stringify(details || {}));

    this.db.prepare(`
      DELETE FROM audit_log
      WHERE id NOT IN (
        SELECT id FROM audit_log ORDER BY id DESC LIMIT ?
      )
    `).run(MAX_AUDIT_ROWS);
  }

  getBackups() {
    return this.#readBackups();
  }

  getDiagnostics() {
    const patientCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM patients').get().count || 0);
    const backupCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM internal_backups').get().count || 0);
    const fileSize = fs.existsSync(this.databasePath) ? fs.statSync(this.databasePath).size : 0;
    return {
      databasePath: this.databasePath,
      patientCount,
      backupCount,
      revision: this.#getRevision(),
      schemaVersion: 3,
      fileSize,
    };
  }

  addPatientAsset(asset = {}) {
    const id = asText(asset.id, 100);
    const patientId = asText(asset.patientId, 100);
    const kind = asText(asset.kind, 20);
    const storedPath = asText(asset.storedPath, 4000);
    if (!id || !patientId || !storedPath || !['dicom', 'mr_pdf'].includes(kind)) {
      throw new TypeError('Dokument nima veljavnih osnovnih podatkov.');
    }
    if (!this.getPatient(patientId)) throw new Error('Pacient za dokument ne obstaja.');

    return this.#transaction(() => {
      const timestamp = nowIso();
      if (asset.isCurrent !== false) {
        this.db.prepare(`
          UPDATE patient_assets
          SET is_current = 0, updated_at = ?
          WHERE patient_id = ? AND kind = ? AND is_current = 1
        `).run(timestamp, patientId, kind);
      }

      this.db.prepare(`
        INSERT INTO patient_assets(
          id, patient_id, kind, is_current, stored_path, source_name,
          display_name, file_count, total_bytes, verified, extra_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        patientId,
        kind,
        asset.isCurrent === false ? 0 : 1,
        storedPath,
        asText(asset.sourceName, 1000),
        asText(asset.displayName, 1000),
        Math.max(0, Number(asset.fileCount || 0)),
        Math.max(0, Number(asset.totalBytes || 0)),
        asset.verified ? 1 : 0,
        JSON.stringify(asset.extra || {}),
        timestamp,
        timestamp,
      );
      this.#insertAudit('patient_asset_added', { id, patientId, kind, storedPath });
      return this.getPatientAsset(id);
    });
  }

  #assetRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      patientId: row.patient_id,
      kind: row.kind,
      isCurrent: !!row.is_current,
      storedPath: row.stored_path,
      sourceName: row.source_name,
      displayName: row.display_name,
      fileCount: Number(row.file_count || 0),
      totalBytes: Number(row.total_bytes || 0),
      verified: !!row.verified,
      extra: parseJson(row.extra_json || '{}', {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getPatientAsset(assetId) {
    return this.#assetRow(this.db.prepare('SELECT * FROM patient_assets WHERE id = ?').get(asText(assetId, 100)));
  }

  findAssetByPath(storedPath) {
    return this.#assetRow(this.db.prepare('SELECT * FROM patient_assets WHERE stored_path = ?').get(asText(storedPath, 4000)));
  }

  getPatientAssets(patientId) {
    return this.db.prepare(`
      SELECT * FROM patient_assets
      WHERE patient_id = ?
      ORDER BY is_current DESC, created_at DESC, id DESC
    `).all(asText(patientId, 100)).map((row) => this.#assetRow(row));
  }

  getCurrentPatientAssets(patientId) {
    const rows = this.db.prepare(`
      SELECT * FROM patient_assets
      WHERE patient_id = ? AND is_current = 1
      ORDER BY kind ASC, created_at DESC, id DESC
    `).all(asText(patientId, 100)).map((row) => this.#assetRow(row));
    return {
      dicom: rows.find((item) => item.kind === 'dicom') || null,
      pdf: rows.find((item) => item.kind === 'mr_pdf') || null,
      all: rows,
    };
  }

  recordExportRun(run = {}) {
    const id = asText(run.id, 100);
    const appointmentDate = asText(run.appointmentDate, 10);
    const destinationPath = asText(run.destinationPath, 4000);
    const status = asText(run.status || 'started', 30);
    if (!id || !appointmentDate || !destinationPath) {
      throw new TypeError('Zapis prenosa nima veljavnih osnovnih podatkov.');
    }
    const startedAt = asText(run.startedAt || nowIso(), 40);
    const completedAt = run.completedAt ? asText(run.completedAt, 40) : null;
    this.db.prepare(`
      INSERT INTO export_runs(
        id, appointment_date, destination_path, patient_count,
        exported_patient_count, file_count, total_bytes, missing_json,
        status, started_at, completed_at, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        destination_path = excluded.destination_path,
        patient_count = excluded.patient_count,
        exported_patient_count = excluded.exported_patient_count,
        file_count = excluded.file_count,
        total_bytes = excluded.total_bytes,
        missing_json = excluded.missing_json,
        status = excluded.status,
        completed_at = excluded.completed_at,
        details_json = excluded.details_json
    `).run(
      id,
      appointmentDate,
      destinationPath,
      Math.max(0, Number(run.patientCount || 0)),
      Math.max(0, Number(run.exportedPatientCount || 0)),
      Math.max(0, Number(run.fileCount || 0)),
      Math.max(0, Number(run.totalBytes || 0)),
      JSON.stringify(Array.isArray(run.missing) ? run.missing : []),
      status,
      startedAt,
      completedAt,
      JSON.stringify(run.details || {}),
    );
    this.#insertAudit('export_run_saved', { id, appointmentDate, status, destinationPath });
    return this.getExportRun(id);
  }

  getExportRun(id) {
    const row = this.db.prepare('SELECT * FROM export_runs WHERE id = ?').get(asText(id, 100));
    if (!row) return null;
    return {
      id: row.id,
      appointmentDate: row.appointment_date,
      destinationPath: row.destination_path,
      patientCount: Number(row.patient_count || 0),
      exportedPatientCount: Number(row.exported_patient_count || 0),
      fileCount: Number(row.file_count || 0),
      totalBytes: Number(row.total_bytes || 0),
      missing: parseJson(row.missing_json || '[]', []),
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at || '',
      details: parseJson(row.details_json || '{}', {}),
    };
  }

  getExportHistory(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
    return this.db.prepare(`
      SELECT id FROM export_runs
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `).all(safeLimit).map((row) => this.getExportRun(row.id)).filter(Boolean);
  }

  getAssetSummary() {
    const rows = this.db.prepare(`
      SELECT patient_id, kind, id, display_name, file_count, total_bytes,
             verified, stored_path, created_at
      FROM patient_assets
      WHERE is_current = 1
      ORDER BY created_at DESC
    `).all();
    const summary = {};
    for (const row of rows) {
      const patientId = row.patient_id;
      if (!summary[patientId]) {
        summary[patientId] = {
          patientId,
          hasDicom: false,
          hasPdf: false,
          dicom: null,
          pdf: null,
          currentCount: 0,
        };
      }
      const item = {
        id: row.id,
        displayName: row.display_name,
        fileCount: Number(row.file_count || 0),
        totalBytes: Number(row.total_bytes || 0),
        verified: !!row.verified,
        storedPath: row.stored_path,
        createdAt: row.created_at,
      };
      if (row.kind === 'dicom') {
        summary[patientId].hasDicom = true;
        summary[patientId].dicom = item;
      } else if (row.kind === 'mr_pdf') {
        summary[patientId].hasPdf = true;
        summary[patientId].pdf = item;
      }
      summary[patientId].currentCount += 1;
    }
    return summary;
  }

  deletePatientAsset(assetId) {
    const asset = this.getPatientAsset(assetId);
    if (!asset) return { deleted: false };
    return this.#transaction(() => {
      this.db.prepare('DELETE FROM patient_assets WHERE id = ?').run(asset.id);
      if (asset.isCurrent) {
        const replacement = this.db.prepare(`
          SELECT id FROM patient_assets
          WHERE patient_id = ? AND kind = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `).get(asset.patientId, asset.kind);
        if (replacement) {
          this.db.prepare('UPDATE patient_assets SET is_current = 1, updated_at = ? WHERE id = ?')
            .run(nowIso(), replacement.id);
        }
      }
      this.#insertAudit('patient_asset_deleted', {
        id: asset.id,
        patientId: asset.patientId,
        kind: asset.kind,
        storedPath: asset.storedPath,
      });
      return { deleted: true, asset };
    });
  }

  getAssetDiagnostics() {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS asset_count,
             SUM(CASE WHEN is_current = 1 THEN 1 ELSE 0 END) AS current_count,
             SUM(total_bytes) AS total_bytes,
             SUM(CASE WHEN kind = 'dicom' THEN 1 ELSE 0 END) AS dicom_count,
             SUM(CASE WHEN kind = 'mr_pdf' THEN 1 ELSE 0 END) AS pdf_count
      FROM patient_assets
    `).get();
    return {
      assetCount: Number(row?.asset_count || 0),
      currentAssetCount: Number(row?.current_count || 0),
      totalAssetBytes: Number(row?.total_bytes || 0),
      dicomAssetCount: Number(row?.dicom_count || 0),
      pdfAssetCount: Number(row?.pdf_count || 0),
    };
  }

  async createSafetyBackup(destinationDirectory, label = 'varnostna-kopija') {
    const safeDirectory = path.resolve(String(destinationDirectory || ''));
    if (!safeDirectory) throw new Error('Ciljna mapa varnostne kopije ni veljavna.');
    fs.mkdirSync(safeDirectory, { recursive: true });

    const safeLabel = asText(label, 100)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'varnostna-kopija';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const finalPath = path.join(safeDirectory, `fuzijska-biopsija-${safeLabel}-${stamp}.sqlite`);
    const temporaryPath = `${finalPath}.tmp`;

    try {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
      await backup(this.db, temporaryPath, { rate: 128 });

      const verificationDb = new DatabaseSync(temporaryPath, {
        open: true,
        readOnly: true,
        enableForeignKeyConstraints: true,
      });
      try {
        const result = verificationDb.prepare('PRAGMA quick_check').get();
        const value = result ? Object.values(result)[0] : null;
        if (value !== 'ok') throw new Error(`Preverjanje kopije SQLite ni uspelo: ${value || 'neznan rezultat'}`);
      } finally {
        verificationDb.close();
      }

      fs.renameSync(temporaryPath, finalPath);
      const backups = fs.readdirSync(safeDirectory)
        .filter((name) => /^fuzijska-biopsija-.*\.sqlite$/i.test(name))
        .map((name) => {
          const filePath = path.join(safeDirectory, name);
          return { filePath, mtime: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      for (const old of backups.slice(10)) {
        try { fs.rmSync(old.filePath, { force: true }); } catch {}
      }
      this.#insertAudit('safety_backup_created', { path: finalPath, label: safeLabel });
      return { filePath: finalPath, fileSize: fs.statSync(finalPath).size };
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }); } catch {}
      throw error;
    }
  }

  close() {
    if (this.db?.isOpen) this.db.close();
  }
}

module.exports = { AppDatabase };
