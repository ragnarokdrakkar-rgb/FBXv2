'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  safeStorage,
} = require('electron');
const { AppDatabase } = require('./database.cjs');
const { CloudManager } = require('./cloud-manager.cjs');
const { DocumentManager } = require('./document-manager.cjs');
const { ExportManager } = require('./export-manager.cjs');
const { UpdateManager } = require('./update-manager.cjs');

const PRODUCT_NAME = 'Fuzijska biopsija';
const localAppData = process.env.LOCALAPPDATA || app.getPath('appData');
const userDataRoot = path.join(localAppData, 'FuzijskaBiopsija');
const dataDirectory = path.join(userDataRoot, 'data');
const databasePath = path.join(dataDirectory, 'fuzijska-biopsija.sqlite');
const logsDirectory = path.join(userDataRoot, 'logs');
const cloudDirectory = path.join(userDataRoot, 'cloud');
const documentsConfigDirectory = path.join(userDataRoot, 'documents');
const updatesDirectory = path.join(userDataRoot, 'updates');
const updateBackupsDirectory = path.join(updatesDirectory, 'database-backups');

fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(logsDirectory, { recursive: true });
fs.mkdirSync(cloudDirectory, { recursive: true });
fs.mkdirSync(documentsConfigDirectory, { recursive: true });
fs.mkdirSync(updateBackupsDirectory, { recursive: true });
app.setPath('userData', userDataRoot);
app.setPath('sessionData', path.join(userDataRoot, 'chromium'));
app.setAppLogsPath(logsDirectory);
app.setName(PRODUCT_NAME);

let mainWindow = null;
let database = null;
let cloudManager = null;
let documentManager = null;
let exportManager = null;
let updateManager = null;

function log(message, error) {
  const line = `[${new Date().toISOString()}] ${message}${error ? `\n${error.stack || error.message || error}` : ''}\n`;
  try {
    fs.appendFileSync(path.join(logsDirectory, 'app.log'), line, 'utf8');
  } catch {
    // Logging must never crash the application.
  }
}

function serializableError(error) {
  return {
    ok: false,
    error: {
      code: error?.code || 'APP_ERROR',
      message: error?.message || 'Neznana napaka.',
      currentRevision: error?.currentRevision,
      requiredBytes: error?.requiredBytes,
      availableBytes: error?.availableBytes,
      missing: error?.missing,
    },
  };
}

function syncHandler(channel, handler) {
  ipcMain.on(channel, (event, payload) => {
    try {
      event.returnValue = { ok: true, result: handler(payload) };
    } catch (error) {
      log(`IPC napaka: ${channel}`, error);
      event.returnValue = serializableError(error);
    }
  });
}

function registerIpc() {
  syncHandler('desktop:load-state', () => database.loadState());
  syncHandler('desktop:save-state', (payload) => {
    const result = database.saveState(payload);
    cloudManager?.queueSync(result.revision);
    return result;
  });
  syncHandler('desktop:save-settings', (payload) => {
    const result = database.saveSettings(payload);
    cloudManager?.queueSync(result.revision);
    return result;
  });
  syncHandler('desktop:get-backups', () => database.getBackups());
  syncHandler('desktop:get-diagnostics', () => ({
    ...database.getDiagnostics(),
    dataDirectory,
    logsDirectory,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('health:database', async () => database.runHealthCheck());
  ipcMain.handle('patients:get-history', async (_event, payload = {}) => database.getPatientHistory(
    String(payload.patientId || ''),
    Number(payload.limit || 100),
  ));
  ipcMain.handle('preparation:get-day', async (_event, appointmentDate) => {
    const date = String(appointmentDate || '');
    const preparation = exportManager.prepare(date);
    const lastExport = exportManager.getHistory(100).find((item) => item.appointmentDate === date) || null;
    return { ...preparation, lastExport };
  });
  ipcMain.handle('health:export-diagnostics', async () => {
    const databaseHealth = database.runHealthCheck();
    const documentStatus = await documentManager.getStatus();
    const cloudStatus = cloudManager?.getStatus?.() || {};
    const updateStatus = updateManager?.getStatus?.() || {};
    const report = {
      format: 'FBX-DIAGNOSTICS-V1',
      generatedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      database: databaseHealth,
      documents: {
        exists: documentStatus.exists,
        writable: documentStatus.writable,
        error: documentStatus.error || '',
        freeBytes: documentStatus.freeBytes,
        assetCount: documentStatus.assetCount,
        currentAssetCount: documentStatus.currentAssetCount,
        totalAssetBytes: documentStatus.totalAssetBytes,
      },
      cloud: {
        endpointConfigured: !!cloudStatus.endpointConfigured,
        connectionVerified: !!cloudStatus.connectionVerified,
        backupConfigured: !!cloudStatus.backupConfigured,
        lastSyncAt: cloudStatus.lastSyncAt || '',
        lastSyncRevision: cloudStatus.lastSyncRevision || 0,
        pending: !!cloudStatus.pending,
      },
      updates: {
        status: updateStatus.status || '',
        currentVersion: updateStatus.currentVersion || app.getVersion(),
        availableVersion: updateStatus.availableVersion || '',
        lastCheckedAt: updateStatus.lastCheckedAt || '',
        error: updateStatus.error || '',
      },
    };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Izvozi diagnostiko brez osebnih podatkov',
      defaultPath: path.join(app.getPath('documents'), `fuzijska-diagnostika-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON diagnostika', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, JSON.stringify(report, null, 2), 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('desktop:open-data-folder', async () => {
    const error = await shell.openPath(dataDirectory);
    if (error) throw new Error(error);
    return { ok: true };
  });

  ipcMain.handle('desktop:open-logs-folder', async () => {
    const error = await shell.openPath(logsDirectory);
    if (error) throw new Error(error);
    return { ok: true };
  });

  ipcMain.handle('desktop:save-text-file', async (_event, options = {}) => {
    const suggestedName = path.basename(String(options.suggestedName || 'izvoz.txt'));
    const result = await dialog.showSaveDialog(mainWindow, {
      title: options.title || 'Shrani datoteko',
      defaultPath: path.join(app.getPath('documents'), suggestedName),
      filters: Array.isArray(options.filters) ? options.filters : undefined,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (result.canceled || !result.filePath) return { canceled: true };

    const content = String(options.content == null ? '' : options.content);
    await fs.promises.writeFile(result.filePath, content, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('desktop:open-json-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Uvozi JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON datoteke', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const content = await fs.promises.readFile(filePath, 'utf8');
    return { canceled: false, filePath, content };
  });


  syncHandler('documents:get-summary', () => documentManager.getSummary());

  ipcMain.handle('documents:get-status', async () => documentManager.getStatus());
  ipcMain.handle('documents:verify-all', async () => documentManager.verifyAllDocuments());
  ipcMain.handle('documents:choose-root', async () => {
    const current = await documentManager.getStatus();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Izberi glavno mapo za DICOM in MR izvide',
      defaultPath: current.rootPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, status: await documentManager.setRoot(result.filePaths[0]) };
  });
  ipcMain.handle('documents:open-root', async () => {
    const status = await documentManager.getStatus();
    const error = await shell.openPath(status.rootPath);
    if (error) throw new Error(error);
    return { opened: true };
  });
  ipcMain.handle('documents:get-patient', async (_event, patientId) => ({
    patientId: String(patientId || ''),
    assets: documentManager.getPatientAssets(String(patientId || '')),
  }));
  ipcMain.handle('documents:import-dicom', async (_event, patientId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Izberi mapo z MR DICOM datotekami',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, ...(await documentManager.importDicom(String(patientId || ''), result.filePaths[0])) };
  });
  ipcMain.handle('documents:import-pdf', async (_event, patientId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Izberi MR izvid v PDF obliki',
      properties: ['openFile'],
      filters: [{ name: 'PDF datoteke', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, ...(await documentManager.importPdf(String(patientId || ''), result.filePaths[0])) };
  });
  ipcMain.handle('documents:open-asset', async (_event, assetId) => {
    const filePath = documentManager.getOpenPath(String(assetId || ''));
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    return { opened: true };
  });
  ipcMain.handle('documents:reveal-asset', async (_event, assetId) => {
    const filePath = documentManager.getRevealPath(String(assetId || ''));
    shell.showItemInFolder(filePath);
    return { revealed: true };
  });
  ipcMain.handle('documents:open-patient-folder', async (_event, patientId) => {
    const folderPath = documentManager.getPatientFolder(String(patientId || ''));
    const error = await shell.openPath(folderPath);
    if (error) throw new Error(error);
    return { opened: true };
  });
  ipcMain.handle('documents:delete-asset', async (_event, assetId) => documentManager.deleteAsset(String(assetId || '')));
  ipcMain.handle('documents:delete-patient', async (_event, patientId) => documentManager.deletePatientDocuments(String(patientId || '')));

  ipcMain.handle('exports:prepare', async (_event, appointmentDate) => exportManager.prepare(String(appointmentDate || '')));
  ipcMain.handle('exports:choose-and-start', async (_event, payload = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Izberi USB ali ciljno mapo za prenos',
      defaultPath: app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return {
      canceled: false,
      result: await exportManager.start({
        appointmentDate: String(payload.appointmentDate || ''),
        destinationRoot: result.filePaths[0],
        allowMissing: !!payload.allowMissing,
      }),
    };
  });
  ipcMain.handle('exports:cancel', async () => exportManager.cancel());
  ipcMain.handle('exports:open-folder', async (_event, folderPath) => {
    const target = path.resolve(String(folderPath || ''));
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return { opened: true };
  });
  ipcMain.handle('exports:get-history', async (_event, limit) => exportManager.getHistory(Number(limit || 20)));

  ipcMain.handle('cloud:get-status', async () => cloudManager.getStatus());
  ipcMain.handle('cloud:configure-appscript', async (_event, payload = {}) => cloudManager.configureEndpoint(
    String(payload.endpointUrl || ''),
    String(payload.authSecret || ''),
  ));
  ipcMain.handle('cloud:create-backup', async (_event, payload = {}) => cloudManager.createNewBackup(String(payload.password || '')));
  ipcMain.handle('cloud:attach-existing', async (_event, payload = {}) => cloudManager.attachExisting(String(payload.password || '')));
  ipcMain.handle('cloud:sync-now', async () => cloudManager.syncNow());
  ipcMain.handle('cloud:restore', async () => cloudManager.restoreFromCloud());
  ipcMain.handle('cloud:refresh-status', async () => cloudManager.refreshRemoteStatus());
  ipcMain.handle('cloud:verify', async () => cloudManager.verifyBackup());
  ipcMain.handle('cloud:open-sheet', async () => cloudManager.openSpreadsheet());
  ipcMain.handle('cloud:disconnect', async () => cloudManager.disconnect());


  ipcMain.handle('updates:get-status', async () => updateManager.getStatus());
  ipcMain.handle('updates:check', async () => updateManager.checkNow());
  ipcMain.handle('updates:download', async () => updateManager.download());
  ipcMain.handle('updates:install', async () => updateManager.install());
  ipcMain.handle('updates:open-backups-folder', async () => {
    const error = await shell.openPath(updateBackupsDirectory);
    if (error) throw new Error(error);
    return { opened: true };
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 760,
    minHeight: 620,
    show: false,
    backgroundColor: '#F3F7F8',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    try {
      database = new AppDatabase(databasePath);
      documentManager = new DocumentManager({
        database,
        configDirectory: documentsConfigDirectory,
        defaultRoot: path.join(app.getPath('documents'), 'FuzijskaBiopsijaDokumenti'),
        log,
        onProgress: (progress) => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          const channel = progress?.kind === 'health_check' ? 'health:documents-progress' : 'documents:progress';
          mainWindow.webContents.send(channel, progress);
        },
      });
      exportManager = new ExportManager({
        database,
        documentManager,
        log,
        onProgress: (progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('exports:progress', progress);
        },
      });
      cloudManager = new CloudManager({
        configDirectory: cloudDirectory,
        safeStorage,
        shell,
        database,
        appVersion: app.getVersion(),
        log,
        onStatus: (status) => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cloud:status-changed', status);
        },
      });

      let electronAutoUpdater = null;
      if (app.isPackaged && process.platform === 'win32') {
        try {
          ({ autoUpdater: electronAutoUpdater } = require('electron-updater'));
        } catch (error) {
          log('Modula electron-updater ni mogoče naložiti.', error);
        }
      }
      updateManager = new UpdateManager({
        app,
        updater: electronAutoUpdater,
        log,
        onStatus: (status) => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:status-changed', status);
        },
        beforeInstall: async ({ availableVersion }) => {
          const backup = await database.createSafetyBackup(
            updateBackupsDirectory,
            `pred-posodobitvijo-${availableVersion || 'nova-verzija'}`,
          );
          try {
            const cloudStatus = cloudManager.getStatus();
            if (cloudStatus.backupConfigured) {
              await Promise.race([
                cloudManager.syncNow(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Cloud sinhronizacija je trajala predolgo.')), 30000)),
              ]);
            }
          } catch (error) {
            log('Cloud sinhronizacija pred posodobitvijo ni uspela; lokalna varnostna kopija je ustvarjena.', error);
          }
          return { safetyBackupPath: backup.filePath };
        },
      });
      registerIpc();
      createWindow();
      cloudManager.start();
      updateManager.start();
      log(`Aplikacija ${app.getVersion()} je zagnana. Baza: ${databasePath}`);
    } catch (error) {
      log('Zagon aplikacije ni uspel.', error);
      dialog.showErrorBox(
        'Fuzijska biopsija – napaka baze',
        `Lokalne baze ni bilo mogoče odpreti.\n\n${error.message}\n\nPodatki niso bili izbrisani. Mapa baze:\n${dataDirectory}`,
      );
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  try {
    updateManager?.close();
    cloudManager?.close();
    database?.close();
  } catch (error) {
    log('Zapiranje baze ni uspelo.', error);
  }
});

process.on('uncaughtException', (error) => {
  log('Neobravnavana napaka glavnega procesa.', error);
});

process.on('unhandledRejection', (error) => {
  log('Neobravnavana zavrnitev glavnega procesa.', error);
});
