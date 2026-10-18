import {
  BlobByteSource,
  decryptPackage,
  encryptFile,
  MemoryByteSink,
  MemoryByteSource,
  type ByteSource,
  type CryptoProvider,
  type DecryptResult,
  type EncryptResult,
  type NamedSource,
  type PackageManifest,
} from '../src/index.js';

export const PASSWORD = 'correct-horse-battery-staple';

export interface InMemoryPackage {
  result: EncryptResult;
  manifest: PackageManifest;
  partBytes: Map<string, Uint8Array>;
  manifestBytes: Uint8Array;
}

/** Encrypt a byte buffer fully in memory; returns manifest + part contents. */
export async function encryptInMemory(
  data: Uint8Array,
  fileName: string,
  password: string,
  chunkSize: number,
  provider: CryptoProvider,
): Promise<InMemoryPackage> {
  const partBytes = new Map<string, Uint8Array>();
  const result = await encryptFile({
    source: new MemoryByteSource(data, fileName),
    fileName,
    password,
    chunkSize,
    provider,
    openPartSink: (_i, name) => {
      const sink = new MemoryByteSink();
      const proxy = {
        write: (d: Uint8Array) => sink.write(d),
        close: async () => {
          await sink.close();
          partBytes.set(name, sink.toBytes());
        },
        abort: () => sink.abort(),
      };
      return Promise.resolve(proxy);
    },
    generator: 'handshack-test',
  });
  return {
    result,
    manifest: result.manifest,
    partBytes,
    manifestBytes: new TextEncoder().encode(result.manifestText),
  };
}

export function namedSources(partBytes: Map<string, Uint8Array>, names?: string[]): NamedSource[] {
  const out: NamedSource[] = [];
  for (const [name, bytes] of partBytes) {
    if (names && !names.includes(name)) continue;
    out.push({ name, source: new MemoryByteSource(bytes, name) });
  }
  return out;
}

/** Decrypt an in-memory package; returns result + restored bytes. */
export async function decryptInMemory(
  manifest: PackageManifest,
  parts: NamedSource[],
  password: string,
  provider: CryptoProvider,
): Promise<{ result: DecryptResult; bytes: Uint8Array; aborted: () => boolean }> {
  const sink = new MemoryByteSink();
  const result = await decryptPackage({
    manifest,
    parts,
    password,
    provider,
    openOutput: () => Promise.resolve(sink),
  });
  return { result, bytes: sink.toBytes(), aborted: () => sink.aborted };
}

export function randomBytes(n: number, provider: CryptoProvider): Uint8Array {
  return provider.randomBytes(n);
}

/** Deterministic pseudo-random bytes (for reproducible fixtures). */
export function deterministicBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

export function cloneManifest(m: PackageManifest): PackageManifest {
  return structuredClone(m);
}

export function sourceFromBlob(bytes: Uint8Array): ByteSource {
  return new BlobByteSource(new Blob([bytes.slice()]));
}
