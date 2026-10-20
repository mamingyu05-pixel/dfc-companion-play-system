'use strict';
// No database, listener, credentials, child processes, network, or filesystem writes.
// Adversarial cases use an in-memory filesystem. Optional root + inventory are read-only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm'), { createHash } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, 'migration-contract.cjs'), 'utf8');
const root = path.resolve(__dirname, 'SYNTHETIC_NOT_CREATED');
const migrationRoot = path.join(root, 'packages/database/prisma/migrations');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const migrationName = index => `202610${String(index).padStart(6, '0')}_fixture`;

function fixture(count = 31) {
  const files = new Map(), directories = new Set([root]), links = new Set();
  let current = root;
  for (const part of ['packages', 'database', 'prisma', 'migrations']) {
    current = path.join(current, part); directories.add(current);
  }
  files.set(path.join(migrationRoot, 'migration_lock.toml'), Buffer.from('provider = "postgresql"'));
  const entries = [];
  function add(index) {
    const name = migrationName(index), directory = path.join(migrationRoot, name);
    const file = path.join(directory, 'migration.sql'), bytes = Buffer.from(`-- 测试 ${index}\r\nSELECT ${index};\n`);
    directories.add(directory); files.set(file, bytes);
    const entry = { name, path: file, sha256: digest(bytes) };
    entries.push(entry); return entry;
  }
  for (let index = 1; index <= count; index++) add(index);
  const stats = name => {
    assert(files.has(name) || directories.has(name), 'Fixture path not found');
    return { isSymbolicLink: () => links.has(name), isDirectory: () => directories.has(name), isFile: () => files.has(name) };
  };
  const fakeFs = {
    lstatSync: stats,
    readFileSync: file => { assert(files.has(file), 'Fixture file not found'); return Buffer.from(files.get(file)); },
    readdirSync(directory, options) {
      assert(directories.has(directory), 'Fixture directory not found');
      const children = [...directories, ...files.keys()].filter(name => name !== directory && path.dirname(name) === directory);
      // Reverse enumeration so the implementation must choose deterministic order.
      return children.reverse().map(file => options?.withFileTypes
        ? { name: path.basename(file), ...stats(file) } : path.basename(file));
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, process: { platform: process.platform },
    require(name) {
      if (name === 'node:fs') return fakeFs;
      if (['node:path', 'node:crypto', 'node:assert/strict'].includes(name)) return require(name);
      throw Error('Unexpected module in read-only contract');
    }
  }, { filename: 'migration-contract.cjs' });
  return { ...module.exports, entries, files, directories, links, add };
}

let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
test('Exact 31-entry inventory is accepted and SQL bytes retain Unicode and line endings', () => {
  const f = fixture(), plan = f.verifyMigrationManifest(root, f.entries);
  assert.equal(plan.length, 31); assert(Object.isFrozen(plan) && Object.isFrozen(plan[0]));
  assert.equal(f.readVerifiedMigration(root, plan[0]), f.files.get(f.entries[0].path).toString('utf8'));
});
test('Old 30-entry manifest cannot omit the current final migration', () => {
  const f = fixture(); assert.throws(() => f.verifyMigrationManifest(root, f.entries.slice(0, 30)));
});
test('Duplicate replacing one entry fails even with the same count', () => {
  const f = fixture(), entries = f.entries.slice(); entries[30] = entries[29];
  assert.throws(() => f.verifyMigrationManifest(root, entries));
});
test('A reordered manifest cannot change execution order', () => {
  const f = fixture(); assert.throws(() => f.verifyMigrationManifest(root, f.entries.slice().reverse()));
});
test('An extra listed migration is rejected', () => {
  const f = fixture(); assert.throws(() => f.verifyMigrationManifest(root, [...f.entries, f.entries[0]]));
});
test('A repository rename with unchanged count and SQL bytes invalidates the old manifest', () => {
  const f = fixture(), old = f.entries[30], name = old.name + '_renamed';
  f.directories.delete(path.dirname(old.path)); f.directories.add(path.join(migrationRoot, name));
  f.files.set(path.join(migrationRoot, name, 'migration.sql'), f.files.get(old.path)); f.files.delete(old.path);
  assert.throws(() => f.verifyMigrationManifest(root, f.entries));
});
test('Absolute outside, other-migration and relative paths are rejected before any such read', () => {
  const f = fixture();
  for (const wrong of [path.resolve(root, '../outside.sql'), f.entries[1].path, 'migration.sql']) {
    const entries = f.entries.map(entry => ({ ...entry })); entries[0].path = wrong;
    assert.throws(() => f.verifyMigrationManifest(root, entries));
  }
});
test('Missing, malformed and changed approved hashes fail closed', () => {
  const f = fixture();
  for (const wrong of [undefined, '', '0'.repeat(64), 'G'.repeat(64)]) {
    const entries = f.entries.map(entry => ({ ...entry })); entries[0].sha256 = wrong;
    assert.throws(() => f.verifyMigrationManifest(root, entries));
  }
});
test('SQL content drift invalidates an otherwise identical manifest', () => {
  const f = fixture(); f.files.set(f.entries[0].path, Buffer.from('SELECT 999;'));
  assert.throws(() => f.verifyMigrationManifest(root, f.entries));
});
test('An added 32nd migration requires a newly reviewed complete manifest', () => {
  const f = fixture(), old = f.entries.slice(); f.add(32);
  assert.throws(() => f.verifyMigrationManifest(root, old));
  assert.equal(f.verifyMigrationManifest(root, f.entries).length, 32);
});
test('An unexpected loose SQL file is not silently omitted', () => {
  const f = fixture(); f.files.set(path.join(migrationRoot, 'unlisted.sql'), Buffer.from('SELECT 1;'));
  assert.throws(() => f.verifyMigrationManifest(root, f.entries));
});
test('An unexpected nested SQL file is not silently omitted', () => {
  const f = fixture(); f.files.set(path.join(path.dirname(f.entries[0].path), 'other.sql'), Buffer.from('SELECT 1;'));
  assert.throws(() => f.verifyMigrationManifest(root, f.entries));
});
test('Invalid migration directory names are rejected', () => {
  const f = fixture(); f.directories.add(path.join(migrationRoot, 'unreviewed'));
  assert.throws(() => f.verifyMigrationManifest(root, f.entries));
});
test('Repository-relative directory, migration directory and SQL links are rejected', () => {
  for (const pick of [f => path.join(root, 'packages'), f => path.dirname(f.entries[0].path), f => f.entries[0].path]) {
    const f = fixture(); f.links.add(pick(f)); assert.throws(() => f.verifyMigrationManifest(root, f.entries));
  }
});
test('Missing SQL and empty migration inventory are rejected', () => {
  const f = fixture(); f.files.delete(f.entries[0].path); assert.throws(() => f.verifyMigrationManifest(root, f.entries));
  const empty = fixture(0); assert.throws(() => empty.verifyMigrationManifest(root, []));
});
test('Changes between preflight and SQL read cannot reach the hypothetical SQL consumer', () => {
  const f = fixture(), plan = f.verifyMigrationManifest(root, f.entries); let consumers = 0;
  f.files.set(plan[0].path, Buffer.from('SELECT 999;'));
  assert.throws(() => { f.readVerifiedMigration(root, plan[0]); consumers++; });
  assert.equal(consumers, 0);
});
test('Null and non-array manifest lists are rejected', () => {
  const f = fixture(); for (const list of [null, {}, undefined]) assert.throws(() => f.verifyMigrationManifest(root, list));
});
if (process.argv[2]) {
  test('Read-only supplied repository agrees with the separately reviewed inventory', () => {
    const contract = require('./migration-contract.cjs'), repo = path.resolve(process.argv[2]);
    assert(process.argv[3], 'Supply the reviewed inventory JSON as well as the repository root');
    const inventory = JSON.parse(fs.readFileSync(path.resolve(process.argv[3]), 'utf8'));
    const plan = contract.verifyMigrationManifest(repo, inventory.migrations);
    assert.equal(plan.length, inventory.count);
    for (const entry of plan) assert.equal(digest(Buffer.from(contract.readVerifiedMigration(repo, entry))), entry.sha256);
    console.log('READ_ONLY_REPOSITORY_MIGRATIONS ' + plan.length);
  });
}
console.log(JSON.stringify({ passed, failed: 0, databaseStarted: false, servicesStarted: false, filesystemWrites: 0 }));
