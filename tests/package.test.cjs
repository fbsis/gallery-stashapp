const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { unzipSync } = require('fflate');
const YAML = require('yaml');
const { buildPackage, FILES, RELEASE_DATE } = require('../scripts/package.cjs');
const ROOT = path.resolve(__dirname, '..');

test('source index is a list of remote packages, not a plugin configuration', () => {
  const index = YAML.parse(fs.readFileSync(path.join(ROOT, 'index.yml'), 'utf8'));
  assert.ok(Array.isArray(index));
  assert.equal(index.length, 1);
  const [entry] = index;
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(entry.id, 'gallery-stashapp');
  assert.equal(entry.version, pkg.version);
  assert.equal(entry.date, RELEASE_DATE);
  assert.match(entry.date, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  const url = new URL(entry.path, 'https://raw.githubusercontent.com/fbsis/gallery-stashapp/main/index.yml');
  assert.equal(url.origin, 'https://raw.githubusercontent.com');
  assert.ok(url.pathname.startsWith('/fbsis/gallery-stashapp/main/dist/gallery-stashapp-'));
});

test('README documents the YAML source and an up-to-date manual installation manifest', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes('https://raw.githubusercontent.com/fbsis/gallery-stashapp/main/index.yml'));
  const example = /```yaml\n([\s\S]*?)\n```/.exec(readme);
  assert.ok(example, 'expected a YAML manifest example');
  const manifest = YAML.parse(fs.readFileSync(path.join(ROOT, 'gallery-stashapp.yml'), 'utf8'));
  assert.deepEqual(YAML.parse(example[1]), manifest);
  assert.equal(manifest.name, 'Gallery Stashapp - Photos and videos');
  for (const filename of ['gallery-stashapp.yml', ...manifest.ui.javascript, ...manifest.ui.css]) {
    assert.ok(readme.includes(filename), `installation instructions must include ${filename}`);
    assert.ok(fs.existsSync(path.join(ROOT, filename)), `missing installation file: ${filename}`);
  }
});

test('committed ZIP matches its SHA-256 and contains the current runtime files', () => {
  const [entry] = YAML.parse(fs.readFileSync(path.join(ROOT, 'index.yml'), 'utf8'));
  const archive = fs.readFileSync(path.join(ROOT, entry.path));
  assert.equal(createHash('sha256').update(archive).digest('hex'), entry.sha256);
  const entries = unzipSync(archive);
  assert.deepEqual(Object.keys(entries).sort(), [...FILES].sort());
  for (const filename of FILES) {
    assert.deepEqual(Buffer.from(entries[filename]), fs.readFileSync(path.join(ROOT, filename)), filename);
    assert.equal(filename.includes('/'), false, 'files must be at the ZIP root');
  }
  const manifest = YAML.parse(Buffer.from(entries['gallery-stashapp.yml']).toString('utf8'));
  assert.equal(manifest.version, entry.version);
  assert.deepEqual(manifest.ui.javascript, ['gallery-core.js', 'gallery-stashapp.js']);
  for (const filename of [...manifest.ui.javascript, ...manifest.ui.css]) assert.ok(entries[filename]);
});

test('package generation is reproducible and the published index is current', () => {
  const first = buildPackage();
  const second = buildPackage();
  assert.deepEqual(first.archive, second.archive);
  assert.equal(first.indexText, second.indexText);
  assert.equal(first.indexText, fs.readFileSync(path.join(ROOT, 'index.yml'), 'utf8'));
  assert.deepEqual(first.archive, fs.readFileSync(path.join(ROOT, first.archivePath)));
});
