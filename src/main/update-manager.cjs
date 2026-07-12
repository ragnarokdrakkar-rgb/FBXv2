'use strict';

const { EventEmitter } = require('node:events');

function cleanNotes(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      return item?.note || item?.version || '';
    }).filter(Boolean).join('\n').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
  }
  return '';
}

class UpdateManager extends EventEmitter {
  constructor({
    app,
    updater,
    log = () => {},
    onStatus = () => {},
    beforeInstall = async () => ({}),
    autoCheckDelayMs = 12000,
    checkIntervalMs = 6 * 60 * 60 * 1000,
    autoDownload = true,
    platform = process.platform,
  } = {}) {
    super();
    this.app = app;
    this.updater = updater;
    this.log = log;
    this.onStatus = onStatus;
    this.beforeInstall = beforeInstall;
    this.autoCheckDelayMs = autoCheckDelayMs;
    this.checkIntervalMs = checkIntervalMs;
    this.autoDownload = autoDownload;
    this.startTimer = null;
    this.intervalTimer = null;
    this.downloadStarted = false;
    this.started = false;
    this.state = {
      supported: !!(app?.isPackaged && platform === 'win32' && updater),
      currentVersion: app?.getVersion?.() || '0.0.0',
      status: app?.isPackaged ? 'idle' : 'development',
      availableVersion: '',
      releaseDate: '',
      releaseNotes: '',
      progressPercent: 0,
      transferred: 0,
      total: 0,
      bytesPerSecond: 0,
      lastCheckedAt: '',
      error: '',
      safetyBackupPath: '',
    };
  }

  #emit(patch = {}) {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getStatus();
    try { this.onStatus(snapshot); } catch {}
    this.emit('status', snapshot);
    return snapshot;
  }

  #configureUpdater() {
    if (!this.updater) return;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    if ('disableWebInstaller' in this.updater) this.updater.disableWebInstaller = true;
    this.updater.logger = {
      info: (...args) => this.log(`UPDATE info: ${args.join(' ')}`),
      warn: (...args) => this.log(`UPDATE opozorilo: ${args.join(' ')}`),
      error: (...args) => this.log(`UPDATE napaka: ${args.join(' ')}`),
      debug: (...args) => this.log(`UPDATE debug: ${args.join(' ')}`),
    };

    this.updater.on('checking-for-update', () => {
      this.#emit({ status: 'checking', error: '', progressPercent: 0 });
    });

    this.updater.on('update-available', (info = {}) => {
      this.downloadStarted = false;
      this.#emit({
        status: 'available',
        availableVersion: String(info.version || ''),
        releaseDate: String(info.releaseDate || ''),
        releaseNotes: cleanNotes(info.releaseNotes),
        lastCheckedAt: new Date().toISOString(),
        error: '',
      });
      if (this.autoDownload) {
        setTimeout(() => this.download().catch((error) => this.#handleError(error)), 300);
      }
    });

    this.updater.on('update-not-available', () => {
      this.downloadStarted = false;
      this.#emit({
        status: 'up-to-date',
        availableVersion: '',
        releaseDate: '',
        releaseNotes: '',
        progressPercent: 0,
        lastCheckedAt: new Date().toISOString(),
        error: '',
      });
    });

    this.updater.on('download-progress', (progress = {}) => {
      this.#emit({
        status: 'downloading',
        progressPercent: Math.max(0, Math.min(100, Number(progress.percent || 0))),
        transferred: Math.max(0, Number(progress.transferred || 0)),
        total: Math.max(0, Number(progress.total || 0)),
        bytesPerSecond: Math.max(0, Number(progress.bytesPerSecond || 0)),
        error: '',
      });
    });

    this.updater.on('update-downloaded', (info = {}) => {
      this.downloadStarted = true;
      this.#emit({
        status: 'downloaded',
        availableVersion: String(info.version || this.state.availableVersion || ''),
        releaseDate: String(info.releaseDate || this.state.releaseDate || ''),
        releaseNotes: cleanNotes(info.releaseNotes) || this.state.releaseNotes,
        progressPercent: 100,
        lastCheckedAt: new Date().toISOString(),
        error: '',
      });
    });

    this.updater.on('error', (error) => this.#handleError(error));
  }

  #handleError(error) {
    const message = error?.message || String(error || 'Neznana napaka pri posodobitvi.');
    this.log('Samodejna posodobitev ni uspela.', error);
    this.downloadStarted = false;
    return this.#emit({ status: 'error', error: message, lastCheckedAt: new Date().toISOString() });
  }

  start() {
    if (this.started) return this.getStatus();
    this.started = true;
    if (!this.state.supported) return this.#emit({ status: this.app?.isPackaged ? 'unsupported' : 'development' });
    this.#configureUpdater();
    this.startTimer = setTimeout(() => this.checkNow().catch((error) => this.#handleError(error)), this.autoCheckDelayMs);
    this.intervalTimer = setInterval(() => this.checkNow().catch((error) => this.#handleError(error)), this.checkIntervalMs);
    this.startTimer.unref?.();
    this.intervalTimer.unref?.();
    return this.getStatus();
  }

  getStatus() {
    return JSON.parse(JSON.stringify(this.state));
  }

  async checkNow() {
    if (!this.state.supported) return this.getStatus();
    if (['checking', 'downloading', 'installing'].includes(this.state.status)) return this.getStatus();
    this.#emit({ status: 'checking', error: '', progressPercent: 0 });
    await this.updater.checkForUpdates();
    return this.getStatus();
  }

  async download() {
    if (!this.state.supported) return this.getStatus();
    if (this.state.status === 'downloaded' || this.state.status === 'downloading') return this.getStatus();
    if (!['available', 'error'].includes(this.state.status)) {
      await this.checkNow();
      return this.getStatus();
    }
    this.downloadStarted = true;
    this.#emit({ status: 'downloading', error: '', progressPercent: 0 });
    await this.updater.downloadUpdate();
    return this.getStatus();
  }

  async install() {
    if (!this.state.supported) throw new Error('Samodejna namestitev v tej različici ni podprta.');
    if (this.state.status !== 'downloaded') throw new Error('Posodobitev še ni prenesena.');
    this.#emit({ status: 'installing', error: '' });
    try {
      const result = await this.beforeInstall({
        currentVersion: this.state.currentVersion,
        availableVersion: this.state.availableVersion,
      });
      this.#emit({ safetyBackupPath: String(result?.safetyBackupPath || '') });
      setTimeout(() => this.updater.quitAndInstall(false, true), 250);
      return this.getStatus();
    } catch (error) {
      this.#handleError(error);
      throw error;
    }
  }

  close() {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startTimer = null;
    this.intervalTimer = null;
  }
}

module.exports = { UpdateManager, cleanNotes };
