'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function sync(channel, payload) {
  return ipcRenderer.sendSync(channel, payload);
}

contextBridge.exposeInMainWorld('desktopApi', Object.freeze({
  isDesktop: true,
  loadState: () => sync('desktop:load-state'),
  saveState: (payload) => sync('desktop:save-state', payload),
  saveSettings: (payload) => sync('desktop:save-settings', payload),
  getBackups: () => sync('desktop:get-backups'),
  getDiagnostics: () => sync('desktop:get-diagnostics'),
  healthDatabase: () => ipcRenderer.invoke('health:database'),
  healthDocuments: () => ipcRenderer.invoke('documents:verify-all'),
  exportDiagnostics: () => ipcRenderer.invoke('health:export-diagnostics'),
  getPatientHistory: (patientId, limit = 100) => ipcRenderer.invoke('patients:get-history', { patientId, limit }),
  preparationGetDay: (appointmentDate) => ipcRenderer.invoke('preparation:get-day', appointmentDate),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data-folder'),
  openLogsFolder: () => ipcRenderer.invoke('desktop:open-logs-folder'),
  saveTextFile: (options) => ipcRenderer.invoke('desktop:save-text-file', options),
  openJsonFile: () => ipcRenderer.invoke('desktop:open-json-file'),
  documentsGetSummary: () => sync('documents:get-summary'),
  documentsGetStatus: () => ipcRenderer.invoke('documents:get-status'),
  documentsChooseRoot: () => ipcRenderer.invoke('documents:choose-root'),
  documentsOpenRoot: () => ipcRenderer.invoke('documents:open-root'),
  documentsGetPatient: (patientId) => ipcRenderer.invoke('documents:get-patient', patientId),
  documentsImportDicom: (patientId) => ipcRenderer.invoke('documents:import-dicom', patientId),
  documentsImportPdf: (patientId) => ipcRenderer.invoke('documents:import-pdf', patientId),
  documentsOpenAsset: (assetId) => ipcRenderer.invoke('documents:open-asset', assetId),
  documentsRevealAsset: (assetId) => ipcRenderer.invoke('documents:reveal-asset', assetId),
  documentsOpenPatientFolder: (patientId) => ipcRenderer.invoke('documents:open-patient-folder', patientId),
  documentsDeleteAsset: (assetId) => ipcRenderer.invoke('documents:delete-asset', assetId),
  documentsDeletePatient: (patientId) => ipcRenderer.invoke('documents:delete-patient', patientId),
  exportsPrepare: (appointmentDate) => ipcRenderer.invoke('exports:prepare', appointmentDate),
  exportsChooseAndStart: (appointmentDate, allowMissing) => ipcRenderer.invoke('exports:choose-and-start', { appointmentDate, allowMissing }),
  exportsCancel: () => ipcRenderer.invoke('exports:cancel'),
  exportsOpenFolder: (folderPath) => ipcRenderer.invoke('exports:open-folder', folderPath),
  exportsGetHistory: (limit) => ipcRenderer.invoke('exports:get-history', limit),
  onExportsProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('exports:progress', listener);
    return () => ipcRenderer.removeListener('exports:progress', listener);
  },
  onDocumentsProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('documents:progress', listener);
    return () => ipcRenderer.removeListener('documents:progress', listener);
  },
  onHealthDocumentsProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('health:documents-progress', listener);
    return () => ipcRenderer.removeListener('health:documents-progress', listener);
  },
  cloudGetStatus: () => ipcRenderer.invoke('cloud:get-status'),
  cloudConfigureAppScript: (endpointUrl, authSecret) => ipcRenderer.invoke('cloud:configure-appscript', { endpointUrl, authSecret }),
  cloudCreateBackup: (password) => ipcRenderer.invoke('cloud:create-backup', { password }),
  cloudAttachExisting: (password) => ipcRenderer.invoke('cloud:attach-existing', { password }),
  cloudSyncNow: () => ipcRenderer.invoke('cloud:sync-now'),
  cloudRestore: () => ipcRenderer.invoke('cloud:restore'),
  cloudRefreshStatus: () => ipcRenderer.invoke('cloud:refresh-status'),
  cloudVerify: () => ipcRenderer.invoke('cloud:verify'),
  cloudOpenSheet: () => ipcRenderer.invoke('cloud:open-sheet'),
  cloudDisconnect: () => ipcRenderer.invoke('cloud:disconnect'),
  updatesGetStatus: () => ipcRenderer.invoke('updates:get-status'),
  updatesCheck: () => ipcRenderer.invoke('updates:check'),
  updatesDownload: () => ipcRenderer.invoke('updates:download'),
  updatesInstall: () => ipcRenderer.invoke('updates:install'),
  updatesOpenBackupsFolder: () => ipcRenderer.invoke('updates:open-backups-folder'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status-changed', listener);
    return () => ipcRenderer.removeListener('updates:status-changed', listener);
  },
  onCloudStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('cloud:status-changed', listener);
    return () => ipcRenderer.removeListener('cloud:status-changed', listener);
  },
}));
