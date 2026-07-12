'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const META_FORMAT = 'FBX-CLOUD-META-V1';
const BACKUP_FORMAT = 'FBX-CLOUD-BACKUP-V1';
const KDF_NAME = 'scrypt-N32768-r8-p1';
const AAD = Buffer.from(BACKUP_FORMAT, 'utf8');
const CHUNK_SIZE = 28000;

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Obnovitveno geslo mora imeti najmanj 12 znakov.');
  }
}

function newSalt() {
  return crypto.randomBytes(16).toString('base64');
}

function deriveKey(password, saltBase64) {
  assertPassword(password);
  const salt = Buffer.from(String(saltBase64 || ''), 'base64');
  if (salt.length < 16) throw new Error('Cloud backup nima veljavne šifrirne soli.');
  return crypto.scryptSync(password, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function encryptSnapshot(snapshot, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Šifrirni ključ ni veljaven.');
  const plaintext = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const compressed = zlib.gzipSync(plaintext, { level: 9 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    format: BACKUP_FORMAT,
    writtenAt: new Date().toISOString(),
    revision: Number(snapshot?.revision || 0),
    schemaVersion: Number(snapshot?.schemaVersion || 1),
    encoding: 'gzip+json',
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    sha256: sha256Hex(plaintext),
    payload: ciphertext.toString('base64'),
  };
}

function decryptSnapshot(record, key) {
  if (!record || record.format !== BACKUP_FORMAT) throw new Error('Oblika cloud backupa ni podprta.');
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Šifrirni ključ ni veljaven.');

  try {
    const iv = Buffer.from(record.iv, 'base64');
    const tag = Buffer.from(record.tag, 'base64');
    const ciphertext = Buffer.from(record.payload, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plaintext = zlib.gunzipSync(compressed);
    if (sha256Hex(plaintext) !== record.sha256) throw new Error('Kontrolna vsota se ne ujema.');
    const snapshot = JSON.parse(plaintext.toString('utf8'));
    if (!snapshot || !Array.isArray(snapshot.patients) || !snapshot.settings || typeof snapshot.settings !== 'object') {
      throw new Error('Dešifrirani backup nima veljavne vsebine.');
    }
    return snapshot;
  } catch (error) {
    const wrapped = new Error('Backupa ni mogoče dešifrirati. Preveri obnovitveno geslo in celovitost Google Sheeta.');
    wrapped.code = 'CLOUD_DECRYPT_FAILED';
    wrapped.cause = error;
    throw wrapped;
  }
}

function splitPayload(payload) {
  const chunks = [];
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) chunks.push(payload.slice(i, i + CHUNK_SIZE));
  return chunks.length ? chunks : [''];
}

function recordToRows(record) {
  const chunks = splitPayload(record.payload);
  const rows = [
    ['format', record.format],
    ['written_at', record.writtenAt],
    ['revision', String(record.revision)],
    ['schema_version', String(record.schemaVersion)],
    ['encoding', record.encoding],
    ['cipher', record.cipher],
    ['iv', record.iv],
    ['tag', record.tag],
    ['sha256', record.sha256],
    ['chunk_count', String(chunks.length)],
  ];
  chunks.forEach((chunk, index) => rows.push([`chunk_${String(index + 1).padStart(4, '0')}`, chunk]));
  return rows;
}

function rowsToRecord(rows) {
  if (!Array.isArray(rows)) throw new Error('Cloud backup je prazen.');
  const map = new Map(rows.filter((row) => Array.isArray(row) && row.length >= 2).map((row) => [String(row[0]), String(row[1])]));
  const count = Number(map.get('chunk_count') || 0);
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Cloud backup ima neveljavno število delov.');
  let payload = '';
  for (let i = 1; i <= count; i += 1) {
    const key = `chunk_${String(i).padStart(4, '0')}`;
    if (!map.has(key)) throw new Error(`V cloud backupu manjka del ${i}.`);
    payload += map.get(key);
  }
  return {
    format: map.get('format'),
    writtenAt: map.get('written_at'),
    revision: Number(map.get('revision') || 0),
    schemaVersion: Number(map.get('schema_version') || 1),
    encoding: map.get('encoding'),
    cipher: map.get('cipher'),
    iv: map.get('iv'),
    tag: map.get('tag'),
    sha256: map.get('sha256'),
    payload,
  };
}

function metaToRows(meta) {
  return [
    ['format', META_FORMAT],
    ['active_slot', meta.activeSlot],
    ['salt', meta.salt],
    ['kdf', KDF_NAME],
    ['created_at', meta.createdAt],
    ['updated_at', meta.updatedAt],
    ['revision', String(meta.revision || 0)],
    ['schema_version', String(meta.schemaVersion || 1)],
    ['app_version', String(meta.appVersion || '')],
  ];
}

function rowsToMeta(rows) {
  const map = new Map((rows || []).filter((row) => Array.isArray(row) && row.length >= 2).map((row) => [String(row[0]), String(row[1])]));
  if (map.get('format') !== META_FORMAT) throw new Error('Google Sheet ni veljaven backup te aplikacije.');
  const activeSlot = map.get('active_slot');
  if (!['A', 'B'].includes(activeSlot)) throw new Error('Cloud backup nima veljavnega aktivnega dela.');
  const salt = map.get('salt');
  if (!salt) throw new Error('Cloud backup nima šifrirne soli.');
  return {
    format: META_FORMAT,
    activeSlot,
    salt,
    kdf: map.get('kdf'),
    createdAt: map.get('created_at'),
    updatedAt: map.get('updated_at'),
    revision: Number(map.get('revision') || 0),
    schemaVersion: Number(map.get('schema_version') || 1),
    appVersion: map.get('app_version') || '',
  };
}

module.exports = {
  META_FORMAT,
  BACKUP_FORMAT,
  KDF_NAME,
  assertPassword,
  newSalt,
  deriveKey,
  encryptSnapshot,
  decryptSnapshot,
  recordToRows,
  rowsToRecord,
  metaToRows,
  rowsToMeta,
};
