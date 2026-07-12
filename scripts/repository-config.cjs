'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function normalizeRepository(value) {
  const input = String(value || '').trim();
  if (!input) return null;

  let clean = input
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^ssh:\/\/git@github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  const parts = clean.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function readJsonConfig(rootDirectory) {
  const configPath = path.join(rootDirectory, 'build', 'update-repository.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return normalizeRepository(`${parsed.owner || ''}/${parsed.repo || ''}`);
  } catch {
    return null;
  }
}

function readGitRemote(rootDirectory) {
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: rootDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return normalizeRepository(remote);
  } catch {
    return null;
  }
}

function resolveRepository(rootDirectory, env = process.env) {
  return normalizeRepository(env.GITHUB_REPOSITORY)
    || readJsonConfig(rootDirectory)
    || readGitRemote(rootDirectory)
    || null;
}

module.exports = { normalizeRepository, resolveRepository };
