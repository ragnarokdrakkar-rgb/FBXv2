'use strict';

const assert = require('node:assert/strict');
const { normalizeRepository, resolveRepository } = require('./repository-config.cjs');

assert.deepEqual(normalizeRepository('https://github.com/Test-User/my-app.git'), {
  owner: 'Test-User', repo: 'my-app', fullName: 'Test-User/my-app',
});
assert.deepEqual(normalizeRepository('git@github.com:owner/repo.git'), {
  owner: 'owner', repo: 'repo', fullName: 'owner/repo',
});
assert.equal(normalizeRepository('napačno'), null);
assert.equal(resolveRepository(process.cwd(), { GITHUB_REPOSITORY: 'ci-owner/ci-repo' }).fullName, 'ci-owner/ci-repo');
console.log('build-config-test: OK');
