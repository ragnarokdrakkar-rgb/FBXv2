'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const file = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);

assert.ok(match, 'V index.html manjka glavni script blok.');
new vm.Script(match[1], { filename: 'renderer-inline.js' });
assert.match(html, /window\.desktopApi\.saveState/);
assert.match(html, /Namizna podatkovna baza/);
assert.match(html, /Naroči izbrane/);
assert.match(html, /Pripravi prenos/);
assert.match(html, /window\.desktopApi\.exportsChooseAndStart/);
assert.match(html, /window\.desktopApi\.exportsPrepare/);
assert.match(html, /Priprava dneva/);
assert.match(html, /Zdravje aplikacije in dokumentov/);
assert.match(html, /window\.desktopApi\.preparationGetDay/);
assert.match(html, /window\.desktopApi\.getPatientHistory/);
assert.match(html, /window\.desktopApi\.healthDocuments/);
assert.doesNotMatch(html, /<link rel="manifest"/);

console.log('✓ Renderer sintaksa in namizna integracija sta veljavni.');
