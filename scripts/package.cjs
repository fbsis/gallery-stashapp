const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { zipSync } = require('fflate');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
// Stash compares release dates when checking for updates. Bump this for each release.
const RELEASE_DATE = '2026-10-23 23:11:24';
const FILES = ['LICENSE', 'gallery-core.js', 'gallery-stashapp.css',
  'gallery-stashapp.js', 'gallery-stashapp.yml'];

function buildPackage() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const plugin = YAML.parse(fs.readFileSync(path.join(ROOT, 'gallery-stashapp.yml'), 'utf8'));
  if (plugin.version !== pkg.version) throw new Error('Plugin and package.json versions must match');

  const entries = Object.fromEntries(FILES.map(filename => [filename, [
    new Uint8Array(fs.readFileSync(path.join(ROOT, filename))),
    { mtime: new Date(1980, 0, 1), os: 3, attrs: 0o100644 * 65536 },
  ]]));
  const archive = Buffer.from(zipSync(entries, { level: 9 }));
  const sha256 = createHash('sha256').update(archive).digest('hex');
  // Immutable filenames keep cached indexes consistent with their downloads.
  const archivePath = `dist/gallery-stashapp-${pkg.version}-${sha256.slice(0, 12)}.zip`;
  const index = [{
    id: 'gallery-stashapp', name: plugin.name, version: pkg.version,
    date: RELEASE_DATE, path: archivePath, sha256,
    metadata: { description: plugin.description, url: plugin.url },
  }];
  const indexText = YAML.stringify(index, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE' });
  return { archive, archivePath, index, indexText };
}

if (require.main === module) {
  const result = buildPackage();
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, result.archivePath), result.archive);
  fs.writeFileSync(path.join(ROOT, 'index.yml'), result.indexText);
  console.log(`Created ${result.archivePath}`);
  console.log('Source URL: https://raw.githubusercontent.com/fbsis/gallery-stashapp/main/index.yml');
}

module.exports = { buildPackage, FILES, RELEASE_DATE };
