'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveRepository } = require('./repository-config.cjs');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const repository = resolveRepository(root);
const directoryBuild = process.argv.includes('--dir');

if (!repository) {
  console.error('\nNAPAKA: GitHub repozitorij za posodobitve ni nastavljen.');
  console.error('Zaženi 4-nastavi-github-update.bat in vnesi UPORABNIK/REPO.\n');
  process.exit(1);
}

const generatedConfig = {
  ...packageJson.build,
  publish: [{
    provider: 'github',
    owner: repository.owner,
    repo: repository.repo,
    releaseType: 'release',
  }],
};

const configPath = path.join(root, '.electron-builder.generated.json');
fs.writeFileSync(configPath, `${JSON.stringify(generatedConfig, null, 2)}\n`, 'utf8');

async function main() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor !== 24) {
    console.warn(`OPOZORILO: uporabljaš Node.js ${process.versions.node}. Projekt je preverjen z Node.js 24.`);
  }

  console.log(`Gradim za GitHub posodobitve: ${repository.fullName}`);

  // Uporabimo uradni programski API electron-builderja. Tako na Windowsu
  // ne poskušamo neposredno zagnati .cmd datoteke, kar je povzročalo EINVAL.
  const { build, Platform } = require('electron-builder');
  const targetName = directoryBuild ? 'dir' : 'nsis';

  try {
    await build({
      targets: Platform.WINDOWS.createTarget(targetName),
      config: generatedConfig,
    });
  } finally {
    try { fs.rmSync(configPath, { force: true }); } catch {}
  }
}

main().catch(error => {
  try { fs.rmSync(configPath, { force: true }); } catch {}
  console.error('\nGradnja ni uspela:');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
