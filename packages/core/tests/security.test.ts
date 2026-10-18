import { describe, expect, it, vi } from 'vitest';
import {
  decryptPackage,
  HandshackError,
  MemoryByteSink,
  MemoryByteSource,
  PACKAGE_PREAMBLE_SIZE,
  RECORD_SIZE,
} from '../src/index.js';
import { NodeCryptoProvider } from '../src/node.js';
import {
  decryptInMemory,
  deterministicBytes,
  encryptInMemory,
  namedSources,
  PASSWORD,
} from './helpers.js';

const provider = new NodeCryptoProvider();
const CHUNK = 1024 * 1024;

async function expectCode(p: Promise<unknown>, code: string): Promise<HandshackError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(HandshackError);
    expect((err as HandshackError).code).toBe(code);
    return err as HandshackError;
  }
  throw new Error(`expected HandshackError(${code}) but operation succeeded`);
}

describe('password handling', () => {
  it('rejects wrong password (authentication-failed, not a different error)', async () => {
    const data = deterministicBytes(50_000, 4);
    const pkg = await encryptInMemory(data, 'a.bin', PASSWORD, CHUNK, provider);
    await expectCode(
      decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), 'wrong-password', provider).then(
        (r) => r.bytes,
      ),
      'authentication-failed',
    );
  });

  it('rejects a short password at encrypt time', async () => {
    await expectCode(
      encryptInMemory(deterministicBytes(10), 'a', 'short', CHUNK, provider).then(() => undefined),
      'invalid-password',
    );
  });

  it('does not leak the password into the manifest or part bytes', async () => {
    const password = 'sup3r-secret-passphrase!';
    const pkg = await encryptInMemory(deterministicBytes(4096), 's.bin', password, CHUNK, provider);
    expect(pkg.result.manifestText).not.toContain(password);
    for (const bytes of pkg.partBytes.values()) {
      expect(new TextDecoder('latin1').decode(bytes)).not.toContain(password);
    }
  });
});

describe('tamper detection', () => {
  async function pkg2() {
    return encryptInMemory(deterministicBytes(2.2 * CHUNK, 8), 'victim.bin', PASSWORD, CHUNK, provider);
  }

  it('rejects flipped ciphertext bytes', async () => {
    const pkg = await pkg2();
    const first = pkg.manifest.parts[0]!.name;
    const bytes = pkg.partBytes.get(first)!;
    bytes[PACKAGE_PREAMBLE_SIZE + 200]! ^= 0x01; // flip a bit inside header/ct region
    await expectCode(
      decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, provider).then((r) => r.bytes),
      'part-corrupt', // caught by per-part sha256 first
    );
  });

  it('rejects a flipped ciphertext byte when the attacker also updates the part hash', async () => {
    const pkg = await pkg2();
    // Flip the last byte of the LAST part — guaranteed inside the final record's
    // ciphertext/tag region — then give the attacker a matching manifest hash.
    const last = pkg.manifest.parts[pkg.manifest.parts.length - 1]!;
    const bytes = pkg.partBytes.get(last.name)!;
    bytes[bytes.length - 1]! ^= 0x01;
    pkg.manifest.parts[pkg.manifest.parts.length - 1]!.sha256 = bytesToHexOf(
      await provider.sha256(bytes),
    );
    await expectCode(
      decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, provider).then((r) => r.bytes),
      'authentication-failed', // GCM catches what the attacker-controlled hash cannot
    );
  });

  it('rejects swapped middle parts even when manifest hashes are updated', async () => {
    const pkg = await pkg2(); // 3 parts — swapping parts 2 & 3 keeps the header intact
    const p1 = pkg.manifest.parts[1]!;
    const p2 = pkg.manifest.parts[2]!;
    const b1 = pkg.partBytes.get(p1.name)!;
    const b2 = pkg.partBytes.get(p2.name)!;
    pkg.partBytes.set(p1.name, b2);
    pkg.partBytes.set(p2.name, b1);
    // Attacker keeps names sequential and fixes up the (untrusted) hashes.
    pkg.manifest.parts[1]!.sha256 = bytesToHexOf(await provider.sha256(b2));
    pkg.manifest.parts[1]!.size = b2.length;
    pkg.manifest.parts[2]!.sha256 = bytesToHexOf(await provider.sha256(b1));
    pkg.manifest.parts[2]!.size = b1.length;
    await expectCode(
      decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, provider).then((r) => r.bytes),
      'authentication-failed',
    );
  });

  it('rejects a swap of the first two parts (header region damaged)', async () => {
    const pkg = await pkg2();
    const p0 = pkg.manifest.parts[0]!;
    const p1 = pkg.manifest.parts[1]!;
    const b0 = pkg.partBytes.get(p0.name)!;
    const b1 = pkg.partBytes.get(p1.name)!;
    pkg.partBytes.set(p0.name, b1);
    pkg.partBytes.set(p1.name, b0);
    pkg.manifest.parts[0]!.sha256 = bytesToHexOf(await provider.sha256(b1));
    pkg.manifest.parts[1]!.sha256 = bytesToHexOf(await provider.sha256(b0));
    await expectCode(
      decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, provider).then((r) => r.bytes),
      'invalid-package',
    );
  });

  it('rejects truncation of the package', async () => {
    const pkg = await pkg2();
    const last = pkg.manifest.parts[pkg.manifest.parts.length - 1]!;
    const trimmed = pkg.partBytes.get(last.name)!.slice(0, last.size - 32);
    pkg.partBytes.set(last.name, trimmed);
    pkg.manifest.parts[pkg.manifest.parts.length - 1] = {
      ...last,
      size: trimmed.length,
      sha256: bytesToHexOf(await provider.sha256(trimmed)),
    };
    pkg.manifest.encryptedSize -= 32;
    await expectCode(
      decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, provider).then((r) => r.bytes),
      'truncated-package',
    );
  });

  it('rejects a tampered packageId in the manifest', async () => {
    const pkg = await pkg2();
    pkg.manifest.packageId = 'hs_aaaaaaaaaaaaaaaaaaaaaa';
    await expectCode(
      decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, provider).then((r) => r.bytes),
      'invalid-package',
    );
  });

  it('rejects a manifest whose origSize was edited', async () => {
    const pkg = await pkg2();
    pkg.manifest.originalSize += 1;
    await expectCode(
      decryptInMemory(pkg.manifest, namedSources(pkg.partBytes), PASSWORD, provider).then((r) => r.bytes),
      'invalid-package',
    );
  });
});

describe('package assembly validation', () => {
  async function pkg3() {
    return encryptInMemory(deterministicBytes(2.5 * CHUNK, 8), 'set.bin', PASSWORD, CHUNK, provider);
  }

  it('detects a missing part by name', async () => {
    const pkg = await pkg3();
    const parts = namedSources(pkg.partBytes);
    parts.splice(1, 1); // drop part002
    const err = await expectCode(
      decryptInMemory(pkg.manifest, parts, PASSWORD, provider).then((r) => r.bytes),
      'missing-parts',
    );
    expect(err.userMessage).toContain('part002');
  });

  it('detects a duplicate part', async () => {
    const pkg = await pkg3();
    const parts = namedSources(pkg.partBytes);
    parts.push(parts[0]!);
    await expectCode(
      decryptInMemory(pkg.manifest, parts, PASSWORD, provider).then((r) => r.bytes),
      'duplicate-parts',
    );
  });

  it('rejects unrelated files', async () => {
    const pkg = await pkg3();
    const parts = namedSources(pkg.partBytes);
    parts.push({ name: 'unrelated.pdf', source: new MemoryByteSource(deterministicBytes(100, 2)) });
    const err = await expectCode(
      decryptInMemory(pkg.manifest, parts, PASSWORD, provider).then((r) => r.bytes),
      'unexpected-files',
    );
    expect(err.userMessage).toContain('unrelated.pdf');
  });

  it('rejects a part with the wrong size', async () => {
    const pkg = await pkg3();
    const parts = namedSources(pkg.partBytes);
    parts[0] = { name: parts[0]!.name, source: new MemoryByteSource(deterministicBytes(7, 1)) };
    await expectCode(
      decryptInMemory(pkg.manifest, parts, PASSWORD, provider).then((r) => r.bytes),
      'part-mismatch',
    );
  });

  it('leaves no output file when decryption fails', async () => {
    const pkg = await pkg3();
    const sink = new MemoryByteSink();
    await expectCode(
      decryptPackage({
        manifest: pkg.manifest,
        parts: namedSources(pkg.partBytes),
        password: 'definitely-wrong-password',
        provider,
        openOutput: () => Promise.resolve(sink),
      }),
      'authentication-failed',
    );
    expect(sink.aborted).toBe(true);
    expect(sink.size).toBe(0);
  });
});

describe('cryptographic hygiene', () => {
  it('wipes encoded password bytes when key derivation fails during encryption', async () => {
    const testProvider = new NodeCryptoProvider();
    let captured: Uint8Array | undefined;
    vi.spyOn(testProvider, 'deriveKey').mockImplementation(async (passwordBytes) => {
      captured = passwordBytes;
      throw new Error('simulated KDF failure');
    });
    await expect(
      encryptInMemory(deterministicBytes(100), 'kdf-failure.bin', PASSWORD, CHUNK, testProvider),
    ).rejects.toThrow('simulated KDF failure');
    expect(captured).toBeDefined();
    expect(captured!.every((byte) => byte === 0)).toBe(true);
  });

  it('wipes encoded password bytes and aborts output when key derivation fails during decryption', async () => {
    const testProvider = new NodeCryptoProvider();
    const pkg = await encryptInMemory(deterministicBytes(100), 'decrypt-kdf.bin', PASSWORD, CHUNK, testProvider);
    let captured: Uint8Array | undefined;
    vi.spyOn(testProvider, 'deriveKey').mockImplementation(async (passwordBytes) => {
      captured = passwordBytes;
      throw new Error('simulated KDF failure');
    });
    const sink = new MemoryByteSink();
    await expect(
      decryptPackage({
        manifest: pkg.manifest,
        parts: namedSources(pkg.partBytes),
        password: PASSWORD,
        provider: testProvider,
        openOutput: () => Promise.resolve(sink),
      }),
    ).rejects.toThrow('simulated KDF failure');
    expect(captured).toBeDefined();
    expect(captured!.every((byte) => byte === 0)).toBe(true);
    expect(sink.aborted).toBe(true);
  });

  it('produces different salts/keys for identical input + password', async () => {
    const data = deterministicBytes(4096, 3);
    const a = await encryptInMemory(data, 'same.bin', PASSWORD, CHUNK, provider);
    const b = await encryptInMemory(data, 'same.bin', PASSWORD, CHUNK, provider);
    expect(a.manifest.salt).not.toBe(b.manifest.salt);
    expect(a.manifest.packageId).not.toBe(b.manifest.packageId);
    const aPart = a.partBytes.get(a.manifest.parts[0]!.name)!;
    const bPart = b.partBytes.get(b.manifest.parts[0]!.name)!;
    expect(aPart).not.toEqual(bPart);
  });

  it('never writes plaintext into part files', async () => {
    // Fill the file with a recognizable repeating pattern.
    const marker = new TextEncoder().encode('HANDSHACK-PLAINTEXT-MARKER-');
    const data = new Uint8Array(200_000);
    for (let i = 0; i < data.length; i++) data[i] = marker[i % marker.length]!;
    const pkg = await encryptInMemory(data, 'm.bin', PASSWORD, CHUNK, provider);
    const needle = 'HANDSHACK-PLAINTEXT-MARKER-';
    for (const [name, bytes] of pkg.partBytes) {
      const text = new TextDecoder('latin1').decode(bytes);
      expect(text, `part ${name} leaked plaintext`).not.toContain(needle);
    }
  });

  it('generates unique nonces per record within a package', async () => {
    // Indirect check: two records with identical plaintext encrypt differently.
    const uniform = new Uint8Array(2 * RECORD_SIZE).fill(0xab);
    const pkg = await encryptInMemory(uniform, 'u.bin', PASSWORD, CHUNK, provider);
    // Reassemble package and compare the two record ciphertexts.
    const all = [...pkg.partBytes.values()].reduce<Uint8Array>((acc, b) => {
      const out = new Uint8Array(acc.length + b.length);
      out.set(acc, 0);
      out.set(b, acc.length);
      return out;
    }, new Uint8Array(0));
    const headerLen = new DataView(all.buffer, 4).getUint32(0, false);
    const rec0 = all.subarray(PACKAGE_PREAMBLE_SIZE + headerLen, PACKAGE_PREAMBLE_SIZE + headerLen + RECORD_SIZE + 16);
    const rec1 = all.subarray(
      PACKAGE_PREAMBLE_SIZE + headerLen + RECORD_SIZE + 16,
      PACKAGE_PREAMBLE_SIZE + headerLen + 2 * (RECORD_SIZE + 16),
    );
    expect(rec0).not.toEqual(rec1); // distinct nonces → distinct ciphertexts
  });
});

function bytesToHexOf(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
