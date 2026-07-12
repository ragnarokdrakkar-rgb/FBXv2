'use strict';

/**
 * Fuzijska biopsija – sifrirani backup prek Google Apps Script.
 *
 * Ta skripta NE prejme sifrirnega gesla ali sifrirnega kljuca.
 * V Google Sheet se zapisujejo samo metapodatki backupa in sifrirani bloki.
 */

const FBX = Object.freeze({
  protocolVersion: 1,
  scriptVersion: '1.0.0',
  propertySheetId: 'FBX_SPREADSHEET_ID',
  propertyAuthSecret: 'FBX_AUTH_SECRET',
  sheets: Object.freeze({
    instructions: 'Navodila',
    meta: 'Meta',
    A: 'Backup_A',
    B: 'Backup_B',
  }),
  maxClockSkewMs: 5 * 60 * 1000,
  nonceLifetimeSeconds: 10 * 60,
  maxRequestChars: 8 * 1024 * 1024,
  maxRows: 5000,
  maxCellChars: 32000,
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Fuzijska backup')
    .addItem('Nastavi backup', 'setupFbxBackup')
    .addItem('Prikazi podatke za povezavo', 'showFbxConnectionInfo')
    .addSeparator()
    .addItem('Ponastavi dostopni kljuc', 'resetFbxAuthSecret')
    .addToUi();
}

function setupFbxBackup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Skripta mora biti vezana na Google Sheet.');

  const props = PropertiesService.getScriptProperties();
  props.setProperty(FBX.propertySheetId, spreadsheet.getId());
  if (!props.getProperty(FBX.propertyAuthSecret)) {
    props.setProperty(FBX.propertyAuthSecret, generateSecret_());
  }

  ensureSheets_(spreadsheet);
  showFbxConnectionInfo();
}

function showFbxConnectionInfo() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty(FBX.propertyAuthSecret);
  const spreadsheetId = props.getProperty(FBX.propertySheetId);
  if (!secret || !spreadsheetId) {
    throw new Error('Najprej zazeni funkcijo setupFbxBackup.');
  }

  const endpoint = ScriptApp.getService().getUrl() || '';
  const endpointText = endpoint || 'Web app se ni objavljen. Najprej izberi Deploy > New deployment > Web app.';
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px Segoe UI,Arial,sans-serif;padding:12px;line-height:1.5">' +
      '<p><b>Apps Script Web App URL</b></p>' +
      '<textarea readonly style="width:100%;height:70px;box-sizing:border-box">' + escapeHtml_(endpointText) + '</textarea>' +
      '<p><b>Dostopni kljuc</b></p>' +
      '<textarea readonly style="width:100%;height:70px;box-sizing:border-box">' + escapeHtml_(secret) + '</textarea>' +
      '<p>Obe vrednosti kopiraj v nastavitve EXE aplikacije. Dostopnega kljuca ne posiljaj po e-posti in ga ne zapisuj v Google Sheet.</p>' +
      '<button onclick="google.script.host.close()" style="padding:8px 14px">Zapri</button>' +
    '</div>'
  ).setWidth(620).setHeight(430);
  SpreadsheetApp.getUi().showModalDialog(html, 'Fuzijska biopsija – povezava');
}

function resetFbxAuthSecret() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    'Ponastavitev dostopnega kljuca',
    'Stari EXE se po tem ne bo mogel vec povezati, dokler vanj ne vneses novega kljuca. Nadaljujem?',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty(FBX.propertyAuthSecret, generateSecret_());
  showFbxConnectionInfo();
}

function doGet() {
  return jsonOutput_({
    ok: true,
    service: 'Fuzijska biopsija encrypted backup endpoint',
    version: FBX.scriptVersion,
  });
}

function doPost(e) {
  try {
    const raw = e && e.postData ? String(e.postData.contents || '') : '';
    if (!raw || raw.length > FBX.maxRequestChars) throw apiError_('BAD_REQUEST', 'Zahteva je prazna ali prevelika.');
    const request = JSON.parse(raw);
    verifyRequest_(request);
    const body = JSON.parse(String(request.body || '{}'));
    const result = dispatch_(String(request.action || ''), body);
    return jsonOutput_({ ok: true, result: result });
  } catch (error) {
    return jsonOutput_({
      ok: false,
      error: {
        code: error && error.code ? String(error.code) : 'APPS_SCRIPT_ERROR',
        message: error && error.message ? String(error.message) : 'Neznana Apps Script napaka.',
      },
    });
  }
}

function dispatch_(action, body) {
  switch (action) {
    case 'ping': return ping_();
    case 'readMeta': return readMeta_();
    case 'writeMeta': return writeMeta_(body);
    case 'readSlot': return readSlot_(body);
    case 'writeSlot': return writeSlot_(body);
    default: throw apiError_('UNKNOWN_ACTION', 'Neznano dejanje.');
  }
}

function ping_() {
  const spreadsheet = openSpreadsheet_();
  ensureSheets_(spreadsheet);
  const metaRows = readRows_(spreadsheet.getSheetByName(FBX.sheets.meta));
  const meta = rowsToMap_(metaRows);
  return {
    serviceVersion: FBX.scriptVersion,
    spreadsheetName: spreadsheet.getName(),
    spreadsheetUrl: spreadsheet.getUrl(),
    initialized: meta.format === 'FBX-CLOUD-META-V1',
    updatedAt: meta.updated_at || '',
    revision: Number(meta.revision || 0),
  };
}

function readMeta_() {
  const spreadsheet = openSpreadsheet_();
  const rows = readRows_(spreadsheet.getSheetByName(FBX.sheets.meta));
  const map = rowsToMap_(rows);
  return {
    initialized: map.format === 'FBX-CLOUD-META-V1',
    rows: rows,
  };
}

function writeMeta_(body) {
  const rows = validateRows_(body && body.rows);
  const initializeOnly = !!(body && body.initializeOnly);
  const spreadsheet = openSpreadsheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = spreadsheet.getSheetByName(FBX.sheets.meta);
    const existing = rowsToMap_(readRows_(sheet));
    if (initializeOnly && existing.format === 'FBX-CLOUD-META-V1') {
      throw apiError_('ALREADY_INITIALIZED', 'Backup je ze inicializiran.');
    }
    writeRows_(sheet, rows);
    return { written: true };
  } finally {
    lock.releaseLock();
  }
}

function readSlot_(body) {
  const slot = validateSlot_(body && body.slot);
  const spreadsheet = openSpreadsheet_();
  return { slot: slot, rows: readRows_(spreadsheet.getSheetByName(FBX.sheets[slot])) };
}

function writeSlot_(body) {
  const slot = validateSlot_(body && body.slot);
  const rows = validateRows_(body && body.rows);
  const spreadsheet = openSpreadsheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    writeRows_(spreadsheet.getSheetByName(FBX.sheets[slot]), rows);
    return { written: true, slot: slot, rowCount: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function verifyRequest_(request) {
  if (!request || Number(request.version) !== FBX.protocolVersion) {
    throw apiError_('BAD_PROTOCOL', 'Razlicica protokola ni podprta.');
  }
  const action = String(request.action || '');
  const ts = Number(request.ts);
  const nonce = String(request.nonce || '');
  const body = String(request.body || '');
  const signature = String(request.signature || '');
  if (!action || !Number.isFinite(ts) || nonce.length < 16 || !signature) {
    throw apiError_('BAD_REQUEST', 'Zahteva nima vseh varnostnih polj.');
  }
  if (Math.abs(Date.now() - ts) > FBX.maxClockSkewMs) {
    throw apiError_('STALE_REQUEST', 'Cas zahteve ni veljaven. Preveri uro racunalnika.');
  }

  const cache = CacheService.getScriptCache();
  const nonceKey = 'nonce_' + digestHex_(nonce);
  if (cache.get(nonceKey)) throw apiError_('REPLAY', 'Zahteva je bila ze uporabljena.');

  const secret = PropertiesService.getScriptProperties().getProperty(FBX.propertyAuthSecret);
  if (!secret) throw apiError_('NOT_CONFIGURED', 'Apps Script dostopni kljuc ni nastavljen.');
  const canonical = String(request.ts) + '\n' + nonce + '\n' + action + '\n' + digestHex_(body);
  const expected = base64Url_(Utilities.computeHmacSha256Signature(canonical, secret, Utilities.Charset.UTF_8));
  if (!constantTimeEqual_(expected, signature)) throw apiError_('UNAUTHORIZED', 'Podpis zahteve ni veljaven.');

  cache.put(nonceKey, '1', FBX.nonceLifetimeSeconds);
}

function openSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(FBX.propertySheetId);
  if (!id) throw apiError_('NOT_CONFIGURED', 'Google Sheet ni povezan s skripto. Zazeni setupFbxBackup.');
  return SpreadsheetApp.openById(id);
}

function ensureSheets_(spreadsheet) {
  let instructions = spreadsheet.getSheetByName(FBX.sheets.instructions);
  if (!instructions) instructions = spreadsheet.insertSheet(FBX.sheets.instructions, 0);
  instructions.clear();
  instructions.getRange('A1').setValue('Fuzijska biopsija – sifrirani backup');
  instructions.getRange('A3').setValue('Ta dokument je tehnicna shramba. Pacientov ne vpisuj rocno. Backup_A in Backup_B vsebujeta samo lokalno sifrirane bloke.');
  instructions.setColumnWidth(1, 850);

  [FBX.sheets.meta, FBX.sheets.A, FBX.sheets.B].forEach(function(name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    sheet.getRange('A:B').setNumberFormat('@');
    if (!sheet.isSheetHidden()) sheet.hideSheet();
  });
}

function readRows_(sheet) {
  if (!sheet) throw apiError_('MISSING_SHEET', 'Manjka tehnicni zavihek backupa.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];
  return sheet.getRange(1, 1, lastRow, 2).getDisplayValues().map(function(row) {
    return [String(row[0] || ''), String(row[1] || '')];
  });
}

function writeRows_(sheet, rows) {
  if (!sheet) throw apiError_('MISSING_SHEET', 'Manjka tehnicni zavihek backupa.');
  sheet.clearContents();
  if (rows.length) {
    sheet.getRange(1, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
  }
  SpreadsheetApp.flush();
}

function validateRows_(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > FBX.maxRows) {
    throw apiError_('BAD_ROWS', 'Stevilo vrstic backupa ni veljavno.');
  }
  return rows.map(function(row) {
    if (!Array.isArray(row) || row.length < 2) throw apiError_('BAD_ROWS', 'Vrstica backupa ni veljavna.');
    const a = String(row[0] == null ? '' : row[0]);
    const b = String(row[1] == null ? '' : row[1]);
    if (a.length > 200 || b.length > FBX.maxCellChars) throw apiError_('CELL_TOO_LARGE', 'Del backupa je prevelik.');
    return [a, b];
  });
}

function validateSlot_(slot) {
  const value = String(slot || '').toUpperCase();
  if (value !== 'A' && value !== 'B') throw apiError_('BAD_SLOT', 'Backup slot ni veljaven.');
  return value;
}

function rowsToMap_(rows) {
  const out = {};
  (rows || []).forEach(function(row) {
    if (row && row.length >= 2) out[String(row[0])] = String(row[1]);
  });
  return out;
}

function digestHex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); })
    .join('');
}

function base64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  }
  return diff === 0;
}

function generateSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function apiError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
