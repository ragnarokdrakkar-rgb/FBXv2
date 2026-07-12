'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UpdateManager } = require('../src/main/update-manager.cjs');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checked = 0;
    this.downloaded = 0;
    this.installed = 0;
  }
  async checkForUpdates() { this.checked += 1; }
  async downloadUpdate() { this.downloaded += 1; }
  quitAndInstall() { this.installed += 1; }
}

(async () => {
  const updater = new FakeUpdater();
  let backupCalls = 0;
  const manager = new UpdateManager({
    app: { isPackaged: true, getVersion: () => '1.4.0' },
    updater,
    autoCheckDelayMs: 999999,
    checkIntervalMs: 999999,
    autoDownload: false,
    platform: 'win32',
    beforeInstall: async () => {
      backupCalls += 1;
      return { safetyBackupPath: 'C:/backup.sqlite' };
    },
  });

  manager.start();
  assert.equal(manager.getStatus().supported, true);
  await manager.checkNow();
  assert.equal(updater.checked, 1);

  updater.emit('update-available', {
    version: '1.4.1',
    releaseDate: '2026-07-12T10:00:00.000Z',
    releaseNotes: '<b>Popravek</b> shranjevanja',
  });
  assert.equal(manager.getStatus().status, 'available');
  assert.equal(manager.getStatus().releaseNotes, 'Popravek shranjevanja');

  await manager.download();
  assert.equal(updater.downloaded, 1);
  updater.emit('download-progress', { percent: 54.2, transferred: 10, total: 20, bytesPerSecond: 5 });
  assert.equal(manager.getStatus().status, 'downloading');
  assert.equal(manager.getStatus().progressPercent, 54.2);

  updater.emit('update-downloaded', { version: '1.4.1' });
  assert.equal(manager.getStatus().status, 'downloaded');
  await manager.install();
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(backupCalls, 1);
  assert.equal(updater.installed, 1);
  assert.equal(manager.getStatus().safetyBackupPath, 'C:/backup.sqlite');
  manager.close();

  const dev = new UpdateManager({ app: { isPackaged: false, getVersion: () => '1.4.0' } });
  assert.equal(dev.start().status, 'development');

  console.log('update-manager-test: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
