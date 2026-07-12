'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const file = path.join(__dirname, '..', 'apps-script', 'Code.gs');
const code = fs.readFileSync(file, 'utf8');
new vm.Script(code, { filename: 'Code.gs' });
for (const required of [
  'function doPost',
  'computeHmacSha256Signature',
  'LockService.getScriptLock',
  'PropertiesService.getScriptProperties',
  'Backup_A',
  'Backup_B',
]) assert.ok(code.includes(required), `Manjka Apps Script element: ${required}`);
assert.ok(!/maticniIndeks|datumRojstva|priimek|pacienti/i.test(code), 'Apps Script ne sme poznati pacientskih polj.');
console.log('✓ Apps Script sintaksa in varnostna struktura sta preverjeni.');
