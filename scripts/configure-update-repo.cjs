'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { normalizeRepository } = require('./repository-config.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'update-repository.json');
const argument = process.argv.slice(2).join(' ').trim();

function save(value) {
  const repo = normalizeRepository(value);
  if (!repo) {
    console.error('NAPAKA: uporabi obliko UPORABNIK/REPO, npr. ragnarokdrakkar-rgb/fuzijska-biopsija-desktop');
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(output, `${JSON.stringify({ owner: repo.owner, repo: repo.repo }, null, 2)}\n`, 'utf8');
  console.log(`GitHub posodobitve bodo uporabljale: ${repo.fullName}`);
  console.log(`Nastavitev je shranjena v: ${output}`);
}

if (argument) {
  save(argument);
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Vnesi GitHub repozitorij (UPORABNIK/REPO): ', (answer) => {
    rl.close();
    save(answer);
  });
}
