/**
 * Cross-platform compatibility suite — the release gate.
 *
 * These tests exercise the REAL file paths used by each platform:
 *   - FileByteSource / FileByteSink (the desktop main-process adapters)
 *   - BlobByteSource / BlobByteSink (the browser/worker adapters)
 *   - NodeCryptoProvider  (Electron main)
 *   - WebCryptoProvider   (browser)
 *
 * A package written through the "desktop" adapter chain must be readable
 * through the "web" adapter chain and vice versa, byte-for-byte.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  decryptPackage,
  encryptFile,
  BlobByteSource,
  BlobByteSink,
  MemoryByteSource,
  parseManifestBytes,
  serializeManifest,
  verifyWrittenParts,
  type CryptoProvider,
  type NamedSource,
} from '@handshack/core';
import { FileByteSink, FileByteSource, NodeCryptoProvider } from '@handshack/core/node';
import { WebCryptoProvider } from '@handshack/core';

const node_ = new NodeCryptoProvider();
const web = new WebCryptoProvider();
const PASSWORD = 'cross-platform-password-123';
const CHUNK = 1024 * 1024;

const tmpDirs: string[] = [];
async function tmpDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'handshack-xp-'));
  tmpDirs.push(d);
  return d;
}
afterAll(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true });
});

function sampleBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

/** Encrypt through the desktop chain: FileByteSource → FileByteSink parts on disk. */
async function encryptOnDisk(
  inputPath: string,
  outDir: string,
  provider: CryptoProvider,
): Promise<{ manifestPath: string; partPaths: string[]; manifestText: string }> {
  const source = await FileByteSource.open(inputPath);
  const partPaths: string[] = [];
  const result = await encryptFile({
    source,
    fileName: path.basename(inputPath),
    password: PASSWORD,
    chunkSize: CHUNK,
    provider,
    generator: 'handshack-desktop test',
    openPartSink: async (_i, name) => {
      const p = path.join(outDir, name);
      partPaths.push(p);
      return FileByteSink.create(p, false);
    },
  });
  const manifestPath = path.join(outDir, result.manifestFileName);
  await fs.writeFile(manifestPath, result.manifestText, 'utf8');
  await source.close();
  return { manifestPath, partPaths, manifestText: result.manifestText };
}

/** Decrypt via the "web" adapter chain: BlobByteSource parts → BlobByteSink. */
async function decryptViaWebAdapters(
  manifestText: string,
  partPaths: string[],
  provider: CryptoProvider,
): Promise<Uint8Array> {
  const manifest = parseManifestBytes(new TextEncoder().encode(manifestText));
  const parts: NamedSource[] = [];
  for (const p of partPaths) {
    const bytes = new Uint8Array(await fs.readFile(p));
    parts.push({ name: path.basename(p), source: new BlobByteSource(new Blob([bytes])) });
  }
  const sink = new BlobByteSink();
  await decryptPackage({
    manifest,
    parts,
    password: PASSWORD,
    provider,
    openOutput: () => Promise.resolve(sink),
  });
  return new Uint8Array(await sink.toBlob().arrayBuffer());
}

/** Decrypt via the "desktop" adapter chain: FileByteSource parts → FileByteSink. */
async function decryptViaDesktopAdapters(
  manifestPath: string,
  provider: CryptoProvider,
  outDir: string,
): Promise<{ restored: Uint8Array; outPath: string }> {
  const manifest = parseManifestBytes(new Uint8Array(await fs.readFile(manifestPath)));
  const dir = path.dirname(manifestPath);
  const parts: NamedSource[] = [];
  for (const p of manifest.parts) {
    parts.push({ name: p.name, source: await FileByteSource.open(path.join(dir, p.name)) });
  }
  let outPath = '';
  let result;
  try {
    result = await decryptPackage({
      manifest,
      parts,
      password: PASSWORD,
      provider,
      openOutput: async (name) => {
        outPath = path.join(outDir, name);
        return FileByteSink.create(outPath, false);
      },
    });
  } finally {
    for (const p of parts) await p.source.close?.();
  }
  const restored = new Uint8Array(await fs.readFile(outPath));
  expect(restored.length).toBe(result.size);
  return { restored, outPath };
}

describe('desktop → web compatibility', () => {
  it('web decrypts a package produced by the desktop chain', async () => {
    const dir = await tmpDir();
    const original = sampleBytes(2.4 * CHUNK, 42);
    const inputPath = path.join(dir, 'vacation photo.jpg');
    await fs.writeFile(inputPath, original);

    const { manifestPath, partPaths, manifestText } = await encryptOnDisk(inputPath, dir, node_);
    const restored = await decryptViaWebAdapters(manifestText, partPaths, web);
    expect(restored).toEqual(original);
    expect(manifestPath.endsWith('.hsmanifest.json')).toBe(true);
  });
});

describe('web → desktop compatibility', () => {
  it('desktop decrypts a package produced by the web chain', async () => {
    const dir = await tmpDir();
    const original = sampleBytes(1.7 * CHUNK, 43);

    // Web chain: MemoryByteSource + in-memory part sinks → write parts to disk
    // the way a browser download would land in a folder.
    const partBytes = new Map<string, Uint8Array>();
    const enc = await encryptFile({
      source: new MemoryByteSource(original, 'scan.pdf'),
      fileName: 'scan.pdf',
      password: PASSWORD,
      chunkSize: CHUNK,
      provider: web,
      generator: 'handshack-web test',
      openPartSink: async (_i, name) => {
        const buf: Uint8Array[] = [];
        let len = 0;
        return {
          write: async (d: Uint8Array) => {
            buf.push(d);
            len += d.length;
          },
          close: async () => {
            const all = new Uint8Array(len);
            let off = 0;
            for (const c of buf) {
              all.set(c, off);
              off += c.length;
            }
            partBytes.set(name, all);
            await fs.writeFile(path.join(dir, name), all);
          },
          abort: async () => undefined,
        };
      },
    });
    const manifestPath = path.join(dir, enc.manifestFileName);
    await fs.writeFile(manifestPath, enc.manifestText, 'utf8');

    const { restored } = await decryptViaDesktopAdapters(manifestPath, node_, dir);
    expect(restored).toEqual(original);
  });
});

describe('both platforms reject the same failures', () => {
  it.each([
    ['node', node_],
    ['web', web],
  ] as const)('%s rejects a wrong password', async (_label, provider) => {
    const dir = await tmpDir();
    const inputPath = path.join(dir, 'doc.bin');
    await fs.writeFile(inputPath, sampleBytes(300_000, 7));
    const { manifestPath } = await encryptOnDisk(inputPath, dir, provider);
    const manifest = parseManifestBytes(new Uint8Array(await fs.readFile(manifestPath)));
    const parts: NamedSource[] = await Promise.all(
      manifest.parts.map(async (p) => ({
        name: p.name,
        source: await FileByteSource.open(path.join(dir, p.name)),
      })),
    );
    try {
      await expect(
        decryptPackage({
          manifest,
          parts,
          password: 'not-the-right-password',
          provider,
          openOutput: () => Promise.resolve(new BlobByteSink()),
        }),
      ).rejects.toMatchObject({ code: 'authentication-failed' });
    } finally {
      for (const p of parts) await p.source.close?.();
    }
  });
});

describe('post-write verification', () => {
  it('verifyWrittenParts re-reads disk parts and matches manifest hashes', async () => {
    const dir = await tmpDir();
    const inputPath = path.join(dir, 'clip.mov');
    await fs.writeFile(inputPath, sampleBytes(500_000, 9));
    const source = await FileByteSource.open(inputPath);
    const partPaths: string[] = [];
    const result = await encryptFile({
      source,
      fileName: 'clip.mov',
      password: PASSWORD,
      chunkSize: CHUNK,
      provider: node_,
      openPartSink: async (_i, name) => {
        const p = path.join(dir, name);
        partPaths.push(p);
        return FileByteSink.create(p, false);
      },
    });
    await source.close();
    await expect(
      verifyWrittenParts(result.manifest, (i) => FileByteSource.open(partPaths[i]!), node_),
    ).resolves.toBeUndefined();
    expect(serializeManifest(result.manifest)).toContain('"formatVersion": 1');
  });
});
