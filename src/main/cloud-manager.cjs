'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  assertPassword,
  newSalt,
  deriveKey,
  encryptSnapshot,
  decryptSnapshot,
  recordToRows,
  rowsToRecord,
  metaToRows,
  rowsToMeta,
} = require('./cloud-crypto.cjs');

const SYNC_DEBOUNCE_MS = 2500;
const REQUEST_TIMEOUT_MS = 90000;
const PROTOCOL_VERSION = 1;

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, filePath);
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function validateEndpointUrl(value, allowInsecure = false) {
  const raw = String(value || '').trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error('Apps Script URL ni veljaven.'); }
  if (!allowInsecure && url.protocol !== 'https:') throw new Error('Apps Script povezava mora uporabljati HTTPS.');
  if (!allowInsecure && !/\.google\.com$/.test(url.hostname) && !/\.googleusercontent\.com$/.test(url.hostname)) {
    throw new Error('Vnesi URL objavljenega Google Apps Script web appa.');
  }
  return url.toString();
}

function validateAuthSecret(value) {
  const secret = String(value || '').trim();
  if (secret.length < 32) throw new Error('Dostopni ključ mora imeti najmanj 32 znakov.');
  return secret;
}

class CloudManager {
  constructor({ configDirectory, safeStorage, shell, database, appVersion, log, onStatus, allowInsecureEndpoint = false }) {
    this.configDirectory = configDirectory;
    this.safeStorage = safeStorage;
    this.shell = shell;
    this.database = database;
    this.appVersion = appVersion;
    this.log = typeof log === 'function' ? log : () => {};
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.allowInsecureEndpoint = !!allowInsecureEndpoint;
    this.configPath = path.join(configDirectory, 'cloud-config.json');
    this.config = readJson(this.configPath, {});
    this.syncTimer = null;
    this.syncPromise = null;
    this.syncing = false;
    this.lastError = this.config.lastError || '';
  }

  start() {
    if (this.config.pending && this.isReady()) {
      this.syncTimer = setTimeout(() => this.syncNow().catch(() => {}), 4000);
    }
    this.emitStatus();
  }

  close() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }

  secureAvailable() {
    try { return !!this.safeStorage?.isEncryptionAvailable(); } catch { return false; }
  }

  encryptLocalSecret(text) {
    if (!this.secureAvailable()) throw new Error('Windows zaščita skrivnosti ni na voljo. Cloud povezave ni varno shraniti.');
    return this.safeStorage.encryptString(String(text)).toString('base64');
  }

  decryptLocalSecret(encoded) {
    if (!encoded) return '';
    if (!this.secureAvailable()) throw new Error('Windows zaščita skrivnosti ni na voljo.');
    return this.safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  }

  saveConfig(patch = {}) {
    if (Object.prototype.hasOwnProperty.call(patch, 'lastError')) this.lastError = String(patch.lastError || '');
    this.config = { ...this.config, ...patch };
    atomicWriteJson(this.configPath, this.config);
    this.emitStatus();
  }

  getStatus() {
    return {
      secureStorageAvailable: this.secureAvailable(),
      endpointConfigured: !!(this.config.endpointUrl && this.config.authSecretProtected),
      connectionVerified: !!this.config.connectionVerified,
      spreadsheetFound: !!this.config.spreadsheetUrl,
      backupConfigured: !!(this.config.endpointUrl && this.config.authSecretProtected && this.config.keyProtected),
      existingBackupDetected: !!this.config.existingBackupDetected,
      pending: !!this.config.pending,
      syncing: this.syncing,
      lastSyncAt: this.config.lastSyncAt || '',
      lastSyncRevision: Number(this.config.lastSyncRevision || 0),
      lastError: this.lastError || '',
      remoteUpdatedAt: this.config.remoteUpdatedAt || '',
      remoteRevision: Number(this.config.remoteRevision || 0),
      spreadsheetName: this.config.spreadsheetName || '',
      endpointUrl: this.config.endpointUrl || '',
      appVersion: this.appVersion,
    };
  }

  emitStatus() {
    try { this.onStatus(this.getStatus()); } catch {}
  }

  async configureEndpoint(endpointUrl, authSecret) {
    const url = validateEndpointUrl(endpointUrl, this.allowInsecureEndpoint);
    const secret = validateAuthSecret(authSecret);
    const previousUrl = this.config.endpointUrl || '';
    const endpointChanged = previousUrl && previousUrl !== url;

    this.saveConfig({
      endpointUrl: url,
      authSecretProtected: this.encryptLocalSecret(secret),
      connectionVerified: false,
      spreadsheetUrl: endpointChanged ? '' : (this.config.spreadsheetUrl || ''),
      spreadsheetName: endpointChanged ? '' : (this.config.spreadsheetName || ''),
      keyProtected: endpointChanged ? '' : (this.config.keyProtected || ''),
      existingBackupDetected: endpointChanged ? false : !!this.config.existingBackupDetected,
      pending: endpointChanged ? false : !!this.config.pending,
      lastError: '',
    });

    const remote = await this.ping();
    this.saveConfig({
      connectionVerified: true,
      spreadsheetUrl: remote.spreadsheetUrl || '',
      spreadsheetName: remote.spreadsheetName || '',
      existingBackupDetected: !!remote.initialized,
      remoteUpdatedAt: remote.updatedAt || '',
      remoteRevision: Number(remote.revision || 0),
      lastError: '',
    });
    return {
      connected: true,
      existingBackup: !!remote.initialized,
      spreadsheetName: remote.spreadsheetName || '',
      remoteUpdatedAt: remote.updatedAt || '',
      remoteRevision: Number(remote.revision || 0),
    };
  }

  isReady() {
    return !!(this.config.endpointUrl && this.config.authSecretProtected && this.config.keyProtected && this.config.connectionVerified);
  }

  requireConnection() {
    if (!this.config.endpointUrl || !this.config.authSecretProtected) {
      throw new Error('Apps Script URL in dostopni ključ še nista nastavljena.');
    }
  }

  requireReady() {
    this.requireConnection();
    if (!this.config.connectionVerified) throw new Error('Apps Script povezava še ni preverjena.');
    if (!this.config.keyProtected) throw new Error('Obnovitveno geslo še ni povezano z backupom.');
  }

  loadKey() {
    const encoded = this.decryptLocalSecret(this.config.keyProtected || '');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error('Lokalno shranjen cloud ključ ni veljaven.');
    return key;
  }

  loadAuthSecret() {
    return validateAuthSecret(this.decryptLocalSecret(this.config.authSecretProtected || ''));
  }

  async ping() {
    this.requireConnection();
    return this.apiRequest('ping', {});
  }

  async createNewBackup(password) {
    assertPassword(password);
    this.requireConnection();
    const remote = await this.ping();
    if (remote.initialized) {
      this.saveConfig({ existingBackupDetected: true, connectionVerified: true });
      throw new Error('V tem Google Sheetu že obstaja šifrirani backup. Uporabi »Poveži obstoječi backup«.');
    }

    const salt = newSalt();
    const key = deriveKey(password, salt);
    const now = new Date().toISOString();
    const initialMeta = {
      activeSlot: 'B',
      salt,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      schemaVersion: 1,
      appVersion: this.appVersion,
    };
    await this.apiRequest('writeMeta', { rows: metaToRows(initialMeta), initializeOnly: true });

    this.saveConfig({
      connectionVerified: true,
      spreadsheetUrl: remote.spreadsheetUrl || this.config.spreadsheetUrl || '',
      spreadsheetName: remote.spreadsheetName || this.config.spreadsheetName || '',
      existingBackupDetected: true,
      keyProtected: this.encryptLocalSecret(key.toString('base64')),
      pending: true,
      lastError: '',
    });
    await this.syncNow();
    return { created: true };
  }

  async attachExisting(password) {
    assertPassword(password);
    this.requireConnection();
    const metaResult = await this.apiRequest('readMeta', {});
    if (!metaResult.initialized || !Array.isArray(metaResult.rows)) {
      throw new Error('V tem Google Sheetu še ni backupa. Uporabi »Ustvari nov šifrirani backup«.');
    }
    const meta = rowsToMeta(metaResult.rows);
    const key = deriveKey(password, meta.salt);
    const slotResult = await this.apiRequest('readSlot', { slot: meta.activeSlot });
    const record = rowsToRecord(slotResult.rows || []);
    const snapshot = decryptSnapshot(record, key);
    this.validateSnapshot(snapshot);
    this.saveConfig({
      connectionVerified: true,
      existingBackupDetected: true,
      keyProtected: this.encryptLocalSecret(key.toString('base64')),
      remoteUpdatedAt: meta.updatedAt || record.writtenAt || '',
      remoteRevision: Number(snapshot.revision || 0),
      lastError: '',
      pending: false,
    });
    return {
      attached: true,
      remoteUpdatedAt: meta.updatedAt || record.writtenAt,
      remoteRevision: Number(snapshot.revision || 0),
      patientCount: snapshot.patients.length,
    };
  }

  scheduleRetry(delayMs = 60000) {
    if (!this.isReady() || this.syncTimer || this.syncPromise) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.syncNow().catch((error) => this.recordError(error));
    }, delayMs);
  }

  queueSync(revision) {
    if (!this.isReady()) return;
    this.saveConfig({ pending: true, pendingRevision: Number(revision || 0) });
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.syncNow().catch((error) => this.recordError(error));
    }, SYNC_DEBOUNCE_MS);
  }

  async syncNow() {
    this.requireReady();
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.performSync().finally(() => {
      this.syncPromise = null;
      this.syncing = false;
      this.emitStatus();
    });
    return this.syncPromise;
  }

  async performSync() {
    this.syncing = true;
    this.emitStatus();
    try {
      const state = this.database.loadState();
      const snapshot = {
        format: 'FBX-STATE-V1',
        exportedAt: new Date().toISOString(),
        appVersion: this.appVersion,
        schemaVersion: Number(state.schemaVersion || 1),
        revision: Number(state.revision || 0),
        patients: state.patients,
        settings: state.settings,
      };
      const key = this.loadKey();
      const metaResult = await this.apiRequest('readMeta', {});
      if (!metaResult.initialized) throw new Error('Oddaljeni backup ni inicializiran.');
      const meta = rowsToMeta(metaResult.rows);
      const targetSlot = meta.activeSlot === 'A' ? 'B' : 'A';
      const record = encryptSnapshot(snapshot, key);
      await this.apiRequest('writeSlot', { slot: targetSlot, rows: recordToRows(record) });

      const readBack = await this.apiRequest('readSlot', { slot: targetSlot });
      const verified = decryptSnapshot(rowsToRecord(readBack.rows || []), key);
      if (Number(verified.revision || 0) !== snapshot.revision) throw new Error('Preverjanje cloud revizije ni uspelo.');

      const updatedMeta = {
        ...meta,
        activeSlot: targetSlot,
        updatedAt: record.writtenAt,
        revision: snapshot.revision,
        schemaVersion: snapshot.schemaVersion,
        appVersion: this.appVersion,
      };
      await this.apiRequest('writeMeta', { rows: metaToRows(updatedMeta), initializeOnly: false });
      this.lastError = '';
      this.saveConfig({
        pending: false,
        pendingRevision: 0,
        lastSyncAt: record.writtenAt,
        lastSyncRevision: snapshot.revision,
        remoteUpdatedAt: record.writtenAt,
        remoteRevision: snapshot.revision,
        lastError: '',
      });
      return { synced: true, revision: snapshot.revision, syncedAt: record.writtenAt };
    } catch (error) {
      this.saveConfig({ pending: true });
      this.recordError(error);
      this.scheduleRetry();
      throw error;
    }
  }

  async restoreFromCloud() {
    this.requireReady();
    const metaResult = await this.apiRequest('readMeta', {});
    if (!metaResult.initialized) throw new Error('Oddaljeni backup ni inicializiran.');
    const meta = rowsToMeta(metaResult.rows);
    const slotResult = await this.apiRequest('readSlot', { slot: meta.activeSlot });
    const record = rowsToRecord(slotResult.rows || []);
    const snapshot = decryptSnapshot(record, this.loadKey());
    this.validateSnapshot(snapshot);
    const current = this.database.loadState();
    const result = this.database.saveState({
      patients: snapshot.patients,
      settings: snapshot.settings,
      description: `obnova iz Google Apps Script backupa ${snapshot.exportedAt || record.writtenAt}`,
      expectedRevision: current.revision,
    });
    this.saveConfig({
      pending: false,
      lastSyncAt: meta.updatedAt || record.writtenAt,
      lastSyncRevision: Number(snapshot.revision || 0),
      remoteUpdatedAt: meta.updatedAt || record.writtenAt,
      remoteRevision: Number(snapshot.revision || 0),
      lastError: '',
    });
    return {
      restored: true,
      patientCount: snapshot.patients.length,
      remoteRevision: Number(snapshot.revision || 0),
      localRevision: result.revision,
      updatedAt: meta.updatedAt || record.writtenAt,
    };
  }

  validateSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.patients)) throw new Error('Cloud snapshot nima veljavnega seznama pacientov.');
    if (!snapshot.settings || typeof snapshot.settings !== 'object' || Array.isArray(snapshot.settings)) {
      throw new Error('Cloud snapshot nima veljavnih nastavitev.');
    }
  }

  async verifyBackup() {
    this.requireReady();
    const metaResult = await this.apiRequest('readMeta', {});
    if (!metaResult.initialized) throw new Error('Oddaljeni backup ni inicializiran.');
    const meta = rowsToMeta(metaResult.rows);
    const slotResult = await this.apiRequest('readSlot', { slot: meta.activeSlot });
    const record = rowsToRecord(slotResult.rows || []);
    const snapshot = decryptSnapshot(record, this.loadKey());
    this.validateSnapshot(snapshot);
    this.saveConfig({
      remoteUpdatedAt: meta.updatedAt || record.writtenAt || '',
      remoteRevision: Number(snapshot.revision || 0),
      lastError: '',
    });
    return {
      valid: true,
      patientCount: snapshot.patients.length,
      revision: Number(snapshot.revision || 0),
      updatedAt: meta.updatedAt || record.writtenAt || '',
    };
  }

  async refreshRemoteStatus() {
    this.requireConnection();
    const ping = await this.ping();
    const patch = {
      connectionVerified: true,
      spreadsheetUrl: ping.spreadsheetUrl || '',
      spreadsheetName: ping.spreadsheetName || '',
      existingBackupDetected: !!ping.initialized,
      remoteUpdatedAt: ping.updatedAt || '',
      remoteRevision: Number(ping.revision || 0),
      lastError: '',
    };
    this.saveConfig(patch);
    return {
      found: !!ping.initialized,
      initialized: !!ping.initialized,
      updatedAt: ping.updatedAt || '',
      revision: Number(ping.revision || 0),
    };
  }

  async openSpreadsheet() {
    if (!this.config.spreadsheetUrl) {
      const ping = await this.ping();
      if (ping.spreadsheetUrl) this.saveConfig({ spreadsheetUrl: ping.spreadsheetUrl });
    }
    if (!this.config.spreadsheetUrl) throw new Error('Google Sheet URL ni na voljo.');
    await this.shell.openExternal(this.config.spreadsheetUrl);
    return { opened: true };
  }

  disconnect() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.saveConfig({
      endpointUrl: '',
      authSecretProtected: '',
      connectionVerified: false,
      spreadsheetUrl: '',
      spreadsheetName: '',
      keyProtected: '',
      existingBackupDetected: false,
      pending: false,
      pendingRevision: 0,
      lastSyncAt: '',
      lastSyncRevision: 0,
      remoteUpdatedAt: '',
      remoteRevision: 0,
      lastError: '',
    });
    return { disconnected: true };
  }

  recordError(error) {
    const message = String(error?.message || error || 'Neznana cloud napaka.').slice(0, 500);
    this.lastError = message;
    try {
      this.config = { ...this.config, lastError: message };
      atomicWriteJson(this.configPath, this.config);
    } catch {}
    this.log('Apps Script backup napaka.', error);
    this.emitStatus();
  }

  async apiRequest(action, body = {}) {
    this.requireConnection();
    const endpointUrl = validateEndpointUrl(this.config.endpointUrl, this.allowInsecureEndpoint);
    const secret = this.loadAuthSecret();
    const bodyJson = JSON.stringify(body || {});
    const ts = String(Date.now());
    const nonce = base64Url(crypto.randomBytes(18));
    const canonical = `${ts}\n${nonce}\n${action}\n${sha256Hex(bodyJson)}`;
    const signature = base64Url(crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest());
    const request = JSON.stringify({
      version: PROTOCOL_VERSION,
      action,
      ts,
      nonce,
      body: bodyJson,
      signature,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: request,
        redirect: 'follow',
        signal: controller.signal,
      });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch {
        throw new Error(`Apps Script ni vrnil veljavnega JSON odgovora (HTTP ${response.status}).`);
      }
      if (!response.ok || !json?.ok) {
        const reason = json?.error?.message || json?.error || response.statusText || `HTTP ${response.status}`;
        const error = new Error(`Apps Script napaka: ${reason}`);
        error.code = json?.error?.code || 'APPS_SCRIPT_ERROR';
        throw error;
      }
      return json.result || {};
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Apps Script povezava je potekla. Preveri internet in deployment URL.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  CloudManager,
  validateEndpointUrl,
  validateAuthSecret,
};
