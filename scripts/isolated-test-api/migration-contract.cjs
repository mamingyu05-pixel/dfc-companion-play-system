'use strict';
// Read-only preflight. The approved manifest must describe every current SQL migration.
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const relativeRoot = 'packages/database/prisma/migrations';
const migrationName = /^(?:[0-9]{12}|[0-9]{14})_[a-z0-9_]+$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (left, right) => process.platform === 'win32'
  ? left.toLowerCase() === right.toLowerCase() : left === right;

function ordinary(file, directory) {
  const stat = fs.lstatSync(file);
  assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()),
    'Migration contract requires ordinary directories and files');
}

function migrationRoot(repo) {
  let current = path.resolve(repo);
  ordinary(current, true);
  for (const part of relativeRoot.split('/')) {
    current = path.join(current, part);
    ordinary(current, true);
  }
  return current;
}

function canonicalFile(root, name) {
  assert(typeof name === 'string' && migrationName.test(name), 'Invalid migration name');
  const directory = path.join(root, name), file = path.join(directory, 'migration.sql');
  ordinary(directory, true);
  ordinary(file, false);
  return file;
}

function readMigrationInventory(repo) {
  const root = migrationRoot(repo), names = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'migration_lock.toml') {
      ordinary(path.join(root, entry.name), false);
      continue;
    }
    assert(entry.isDirectory() && !entry.isSymbolicLink() && migrationName.test(entry.name),
      'Unexpected entry in repository migration directory');
    names.push(entry.name);
  }
  assert(names.length > 0, 'Empty repository migration inventory');
  return Object.freeze(names.sort().map(name => {
    const file = canonicalFile(root, name);
    const files = fs.readdirSync(path.dirname(file));
    assert(files.length === 1 && files[0] === 'migration.sql',
      'Unexpected files inside a migration directory');
    return Object.freeze({ name, path: file, sha256: hash(fs.readFileSync(file)) });
  }));
}

function verifyMigrationManifest(repo, listed) {
  const actual = readMigrationInventory(repo);
  assert(Array.isArray(listed) && listed.length === actual.length,
    'Manifest must cover the complete current migration inventory');
  for (let index = 0; index < actual.length; index++) {
    const entry = listed[index], expected = actual[index];
    assert(entry && entry.name === expected.name,
      'Migration names must match the complete repository set in lexical order');
    assert(typeof entry.path === 'string' && path.isAbsolute(entry.path)
      && samePath(path.resolve(entry.path), expected.path),
    'Migration path must be its repository migration.sql');
    assert(typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256)
      && entry.sha256 === expected.sha256, 'Migration content differs from approved manifest');
  }
  // Execute canonical repository paths, never caller-provided paths.
  return actual;
}

function readVerifiedMigration(repo, entry) {
  const file = canonicalFile(migrationRoot(repo), entry.name);
  assert(samePath(file, entry.path), 'Migration execution path changed');
  const bytes = fs.readFileSync(file);
  assert.equal(hash(bytes), entry.sha256, 'Migration changed after preflight');
  return bytes.toString('utf8');
}

module.exports = { readMigrationInventory, verifyMigrationManifest, readVerifiedMigration };
