import {
  KDF_DEFAULTS,
  MAX_PART_COUNT,
  MAX_PASSWORD_LENGTH,
  PACKAGE_ID_BYTES,
  PACKAGE_ID_PREFIX,
  PACKAGE_PREAMBLE_SIZE,
  RECORD_SIZE,
  SALT_SIZE,
} from '../constants.js';
import { serializeHeader } from '../crypto/header.js';
import { encryptRecord, payloadSizeFor, recordCountForSize } from '../crypto/records.js';
import { bytesToBase64Url, bytesToHex, concatBytes, u32be, utf8ToBytes } from '../encoding.js';
import { HandshackError } from '../errors.js';
import { PACKAGE_MAGIC } from '../constants.js';
import type {
  ByteSink,
  ByteSource,
  CryptoProvider,
  PackageManifest,
  ProgressCallback,
} from '../types.js';
import {
  sanitizeFileName,
  validateChunkSize,
  validateInputFileSize,
  validateKdfParams,
} from '../validation.js';
import { createManifest, serializeManifest } from './manifest.js';
import { PartRouter, planParts } from './split.js';

export const MIN_PASSWORD_LENGTH = 8;

export interface EncryptRequest {
  source: ByteSource;
  fileName: string;
  password: string;
  chunkSize: number;
  provider: CryptoProvider;
  /**
   * Called once per output part, in order, with the part's index, file name and
   * exact byte size. Must return a sink that accepts exactly `size` bytes.
   */
  openPartSink: (index: number, name: string, size: number) => Promise<ByteSink>;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  /** Generator string recorded in the manifest, e.g. "handshack-web 0.1.0". */
  generator?: string;
}

export interface EncryptResult {
  manifest: PackageManifest;
  manifestText: string;
  manifestFileName: string;
  partNames: string[];
  packageId: string;
  originalName: string;
  originalSize: number;
  encryptedSize: number;
  chunkSize: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HandshackError('cancelled');
}

/**
 * Encrypt a file and write the encrypted package as fixed-size parts.
 * Two passes over the input: (1) SHA-256 of the plaintext for the header,
 * (2) per-record AES-256-GCM encryption routed through the part writer.
 * Peak memory stays bounded by RECORD_SIZE regardless of file size.
 */
export async function encryptFile(req: EncryptRequest): Promise<EncryptResult> {
  const { source, provider, signal, onProgress } = req;
  const report = onProgress ?? (() => undefined);

  if (
    typeof req.password !== 'string' ||
    req.password.length < MIN_PASSWORD_LENGTH ||
    req.password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new HandshackError(
      'invalid-password',
      'password length outside supported range',
      `Use a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  validateInputFileSize(source.size);
  validateChunkSize(req.chunkSize);
  const origName = sanitizeFileName(req.fileName);
  const kdfParams = { ...KDF_DEFAULTS };
  validateKdfParams(kdfParams);
  const minimumPackageSize =
    PACKAGE_PREAMBLE_SIZE + 1 + payloadSizeFor(source.size);
  if (Math.ceil(minimumPackageSize / req.chunkSize) > MAX_PART_COUNT) {
    throw new HandshackError(
      'too-many-parts',
      `file cannot fit within ${MAX_PART_COUNT} parts at chunk size ${req.chunkSize}`,
      `This file would require more than ${MAX_PART_COUNT} parts. Choose a larger part size.`,
    );
  }

  report({ phase: 'validating', done: 0, total: 0 });
  throwIfAborted(signal);

  // Pass 1 — hash the plaintext for the authenticated header.
  report({ phase: 'hashing', done: 0, total: source.size });
  const hasher = provider.createSha256();
  for (let off = 0; off < source.size; off += RECORD_SIZE) {
    throwIfAborted(signal);
    const n = Math.min(RECORD_SIZE, source.size - off);
    hasher.update(await source.read(off, n));
    report({ phase: 'hashing', done: off + n, total: source.size });
  }
  const origSha256 = bytesToHex(await hasher.digest());
  throwIfAborted(signal);

  // Build the package. The header is emitted first, then the records.
  const salt = provider.randomBytes(SALT_SIZE);
  const packageId = PACKAGE_ID_PREFIX + bytesToBase64Url(provider.randomBytes(PACKAGE_ID_BYTES));
  const recordCount = recordCountForSize(source.size);
  const payloadSize = payloadSizeFor(source.size);
  const header = {
    v: 1 as const,
    alg: 'AES-256-GCM' as const,
    kdf: 'scrypt' as const,
    kdfN: kdfParams.n,
    kdfR: kdfParams.r,
    kdfP: kdfParams.p,
    dkLen: kdfParams.dkLen,
    salt: bytesToBase64Url(salt),
    recordSize: RECORD_SIZE,
    recordCount,
    chunkSize: req.chunkSize,
    payloadSize,
    origSize: source.size,
    origSha256,
    origName,
    pkgId: packageId,
    created: Math.floor(Date.now() / 1000),
  };
  const headerBytes = serializeHeader(header);
  const encryptedSize = PACKAGE_PREAMBLE_SIZE + headerBytes.length + payloadSize;
  const headerHash = await provider.sha256(headerBytes);

  const plans = planParts(origName, encryptedSize, req.chunkSize);
  const router = new PartRouter(
    plans,
    (i, plan) => req.openPartSink(i, plan.name, plan.size),
    () => provider.createSha256(),
  );

  const passwordBytes = utf8ToBytes(req.password);
  let key: Uint8Array | null = null;
  try {
    report({ phase: 'deriving-key', done: 0, total: 1 });
    key = await provider.deriveKey(passwordBytes, salt, kdfParams);
    passwordBytes.fill(0);
    report({ phase: 'deriving-key', done: 1, total: 1 });
    throwIfAborted(signal);

    report({ phase: 'encrypting', done: 0, total: encryptedSize });
    let written = 0;
    await router.write(concatBytes(PACKAGE_MAGIC, u32be(headerBytes.length), headerBytes));
    written += PACKAGE_PREAMBLE_SIZE + headerBytes.length;

    for (let i = 0; i < recordCount; i++) {
      throwIfAborted(signal);
      const off = i * RECORD_SIZE;
      const n = Math.min(RECORD_SIZE, source.size - off);
      const plain = await source.read(off, n);
      const ct = await encryptRecord(provider, key, headerHash, i, plain, i === recordCount - 1);
      plain.fill(0);
      await router.write(ct);
      written += ct.length;
      report({ phase: 'encrypting', done: written, total: encryptedSize });
    }

    report({ phase: 'writing', done: 0, total: 0 });
    const parts = await router.finish();

    const manifest = createManifest({
      packageId,
      generator: req.generator ?? 'handshack',
      originalName: origName,
      originalSize: source.size,
      encryptedSize,
      chunkSize: req.chunkSize,
      kdfParams,
      salt: bytesToBase64Url(salt),
      parts,
    });
    salt.fill(0);

    report({ phase: 'completed', done: encryptedSize, total: encryptedSize });
    return {
      manifest,
      manifestText: serializeManifest(manifest),
      manifestFileName: `${origName}.hsmanifest.json`,
      partNames: parts.map((p) => p.name),
      packageId,
      originalName: origName,
      originalSize: source.size,
      encryptedSize,
      chunkSize: req.chunkSize,
    };
  } catch (err) {
    await router.abort().catch(() => undefined);
    throw err;
  } finally {
    passwordBytes.fill(0);
    if (key) key.fill(0);
  }
}

/** Re-verify a written package part set: sizes + per-part SHA-256 vs manifest. */
export async function verifyWrittenParts(
  manifest: PackageManifest,
  openPartSource: (index: number) => Promise<ByteSource>,
  provider: CryptoProvider,
  signal?: AbortSignal,
  onProgress?: ProgressCallback,
): Promise<void> {
  const report = onProgress ?? (() => undefined);
  report({ phase: 'verifying', done: 0, total: manifest.encryptedSize });
  let done = 0;
  for (let i = 0; i < manifest.parts.length; i++) {
    throwIfAborted(signal);
    const part = manifest.parts[i]!;
    const src = await openPartSource(i);
    try {
      if (src.size !== part.size) {
        throw new HandshackError('part-mismatch', `written part ${part.name} has size ${src.size}, expected ${part.size}`);
      }
      const hasher = provider.createSha256();
      for (let off = 0; off < src.size; off += RECORD_SIZE) {
        throwIfAborted(signal);
        const n = Math.min(RECORD_SIZE, src.size - off);
        hasher.update(await src.read(off, n));
      }
      const hex = bytesToHex(await hasher.digest());
      if (hex !== part.sha256) {
        throw new HandshackError('part-corrupt', `written part ${part.name} failed checksum`);
      }
      done += src.size;
      report({ phase: 'verifying', done, total: manifest.encryptedSize });
    } finally {
      await src.close?.();
    }
  }
}
