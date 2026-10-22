#!/usr/bin/env node
/**
 * Write apps/desktop/release/SHA256SUMS.txt from the artifacts actually on disk.
 *
 * CI generates this file after packaging; local builds used to leave a stale one
 * behind. Running this after `package:win` keeps published hashes tied to the
 * binaries sitting next to them.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'apps', 'desktop', 'release');

const entries = (await readdir(releaseDir, { withFileTypes: true }))
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
  .map((e) => e.name)
  .sort();

if (entries.length === 0) {
  console.error(`write-checksums: no .exe artifacts in ${releaseDir}`);
  process.exit(1);
}

const lines = [];
for (const name of entries) {
  const bytes = await readFile(path.join(releaseDir, name));
  lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}

const target = path.join(releaseDir, 'SHA256SUMS.txt');
await writeFile(target, `${lines.join('\n')}\n`, 'utf8');
console.log(lines.join('\n'));
console.log(`\nwrote ${target}`);
