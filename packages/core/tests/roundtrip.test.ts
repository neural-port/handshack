import { describe, expect, it } from 'vitest';
import { bytesToHex, estimatePartCount, RECORD_SIZE } from '../src/index.js';
import { NodeCryptoProvider } from '../src/node.js';
import { WebCryptoProvider } from '../src/index.js';
import {
  decryptInMemory,
  deterministicBytes,
  encryptInMemory,
  namedSources,
  PASSWORD,
} from './helpers.js';

const nodeProvider = new NodeCryptoProvider();
const webProvider = new WebCryptoProvider();

const CHUNK = 1024 * 1024; // 1 MiB for compact tests

function pngLike(len: number): Uint8Array {
  const d = deterministicBytes(len, 99);
  d.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return d;
}

describe('round-trip: every supported boundary and file shape', () => {
  const cases: Array<{ label: string; size: number; data?: Uint8Array }> = [
    { label: 'empty file', size: 0 },
    { label: 'one byte', size: 1 },
    { label: 'small text', size: 512 },
    { label: 'one record minus 1', size: RECORD_SIZE - 1 },
    { label: 'exactly one record', size: RECORD_SIZE },
    { label: 'one record plus 1', size: RECORD_SIZE + 1 },
    { label: 'multiple records + partial', size: 2 * RECORD_SIZE + 12345 },
    { label: 'package just below chunk', size: CHUNK - 1000 },
    { label: 'package near chunk boundary', size: CHUNK - 350 },
  ];

  for (const c of cases) {
    it(`restores ${c.label} byte-for-byte (node)`, async () => {
      const data = c.data ?? deterministicBytes(c.size, c.size);
      const pkg = await encryptInMemory(data, 'file.bin', PASSWORD, CHUNK, nodeProvider);
      const parts = namedSources(pkg.partBytes);
      const { result, bytes } = await decryptInMemory(pkg.manifest, parts, PASSWORD, nodeProvider);
      expect(bytes).toEqual(data);
      expect(result.size).toBe(data.length);
      expect(result.fileName).toBe('file.bin');
      expect(result.sha256Hex).toBe(bytesToHex(await nodeProvider.sha256(data)));
    });
  }

  it('restores a PNG-shaped binary with magic intact', async () => {
    const data = pngLike(100_000);
    const pkg = await encryptInMemory(data, 'img.png', PASSWORD, CHUNK, nodeProvider);
    const { bytes } = await decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, nodeProvider);
    expect(bytes).toEqual(data);
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('produces ceil(packageSize/chunk) parts with correct sizes', async () => {
    const size = 2.5 * CHUNK;
    const data = deterministicBytes(size, 5);
    const pkg = await encryptInMemory(data, 'big.bin', PASSWORD, CHUNK, nodeProvider);
    const total = pkg.manifest.encryptedSize;
    expect(pkg.manifest.partCount).toBe(Math.ceil(total / CHUNK));
    expect(pkg.manifest.parts.length).toBe(pkg.manifest.partCount);
    pkg.manifest.parts.forEach((p, i) => {
      const expected = i === pkg.manifest.parts.length - 1 ? total - i * CHUNK : CHUNK;
      expect(p.size).toBe(expected);
      expect(pkg.partBytes.get(p.name)!.length).toBe(expected);
    });
  });

  it('estimatePartCount is close to actual part count', async () => {
    const data = deterministicBytes(3 * CHUNK + 7, 3);
    const pkg = await encryptInMemory(data, 'f.bin', PASSWORD, CHUNK, nodeProvider);
    const est = estimatePartCount(data.length, 'f.bin', CHUNK);
    expect(Math.abs(est - pkg.manifest.partCount)).toBeLessThanOrEqual(1);
  });
});

describe('cross-provider compatibility (the release requirement)', () => {
  const data = deterministicBytes(RECORD_SIZE + 999, 77);

  it('node-encrypted package decrypts with webcrypto', async () => {
    const pkg = await encryptInMemory(data, 'cross.bin', PASSWORD, CHUNK, nodeProvider);
    const { bytes } = await decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, webProvider);
    expect(bytes).toEqual(data);
  });

  it('web-encrypted package decrypts with node provider', async () => {
    const pkg = await encryptInMemory(data, 'cross.bin', PASSWORD, CHUNK, webProvider);
    const { bytes } = await decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, nodeProvider);
    expect(bytes).toEqual(data);
  });

  it('both providers derive identical keys for identical params', async () => {
    const salt = deterministicBytes(16, 1);
    const params = { n: 2 ** 14, r: 8, p: 1, dkLen: 32 };
    const pw = new TextEncoder().encode('same-password');
    const a = await nodeProvider.deriveKey(pw, salt, params);
    const b = await webProvider.deriveKey(pw, salt, params);
    expect(a).toEqual(b);
  });

  it('both providers produce identical records for fixed key/nonce/aad', async () => {
    const key = deterministicBytes(32, 9);
    const nonce = deterministicBytes(12, 10);
    const aad = deterministicBytes(45, 11);
    const pt = deterministicBytes(700, 12);
    const a = await nodeProvider.aesGcmEncrypt(key, nonce, pt, aad);
    const b = await webProvider.aesGcmEncrypt(key, nonce, pt, aad);
    expect(a).toEqual(b);
    // and each opens the other's output
    expect(await webProvider.aesGcmDecrypt(key, nonce, a, aad)).toEqual(pt);
    expect(await nodeProvider.aesGcmDecrypt(key, nonce, b, aad)).toEqual(pt);
  });
});

describe('part independence', () => {
  it('works when parts are provided out of order', async () => {
    const data = deterministicBytes(2.6 * CHUNK, 21);
    const pkg = await encryptInMemory(data, 'o.bin', PASSWORD, CHUNK, nodeProvider);
    const parts = namedSources(pkg.partBytes).reverse(); // order in array shouldn't matter
    const { bytes } = await decryptInMemory(pkg.manifest, parts, PASSWORD, nodeProvider);
    expect(bytes).toEqual(data);
  });
});
