import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testsDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = dirname(testsDir);
const releaseTag = 'ulib-v0.2.0';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const manifest = readJson(join(extensionDir, 'package.json'));
const releaseDir = join(extensionDir, 'release', releaseTag);
const releaseManifest = readJson(join(releaseDir, 'release-manifest.json'));
const checksumLines = readFileSync(join(releaseDir, 'SHA256SUMS'), 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean);
const checksums = new Map(
  checksumLines.map((line) => {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    assert.ok(match, `Invalid SHA256SUMS line: ${line}`);
    return [match[2].replace(/^\*/, ''), match[1]];
  }),
);

await test('extension declares the exact published managed catalog assets', () => {
  assert.equal(releaseManifest.schemaVersion, 1);
  assert.equal(manifest.version, '0.8.0');
  assert.equal(manifest.permissions.includes('shell'), true);
  assert.equal(manifest.permissions.includes('fs.write'), false);
  assert.equal(manifest.binaries.length, 1);

  const binary = manifest.binaries[0];
  assert.equal(binary.id, 'universal-library-catalog');
  assert.equal(binary.name, 'Universal Library Catalog');
  assert.equal(binary.version, '0.2.0');
  assert.equal(binary.executable, 'ulib');
  assert.deepEqual(binary.platforms, ['linux', 'windows']);
  assert.equal(binary.assets.length, 2);

  const publishedAssets = new Map(
    releaseManifest.assets.map(asset => [`${asset.platform}:${asset.arch}`, asset]),
  );
  assert.deepEqual([...publishedAssets.keys()].sort(), ['linux:x64', 'windows:x64']);

  for (const asset of binary.assets) {
    assert.deepEqual(asset.arch, ['x64']);
    assert.equal(asset.archive, true);
    const published = publishedAssets.get(`${asset.platform}:x64`);
    assert.ok(published, `Missing published metadata for ${asset.platform}:x64`);
    assert.equal(published.version, binary.version);
    assert.equal(asset.executable, published.executable);
    assert.equal(asset.integrity, `sha256:${published.sha256}`);
    assert.equal(checksums.get(published.archive), published.sha256);
    assert.equal(
      asset.downloadUrl,
      `https://github.com/Reneromero08/sigma-file-manager/releases/download/${releaseTag}/${published.archive}`,
    );
  }
});
