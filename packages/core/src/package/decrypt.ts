import { MAX_HEADER_SIZE, PACKAGE_MAGIC, PACKAGE_PREAMBLE_SIZE, RECORD_SIZE } from '../constants.js';
import { parseHeader } from '../crypto/header.js';
import { decryptRecord, recordPlainLength } from '../crypto/records.js';
import { base64UrlToBytes, bytesEqual, bytesToHex, readU32be, utf8ToBytes } from '../encoding.js';
import { HandshackError } from '../errors.js';
import { SequentialReader } from '../io/sources.js';
import type {
  ByteSink,
  ByteSource,
  CryptoProvider,
  NamedSource,
  PackageManifest,
  ProgressCallback,
} from '../types.js';
import { safeFileName } from '../validation.js';

export interface DecryptRequest {
  manifest: PackageManifest;
  /** All selected part files (names matched against the manifest). */
  parts: NamedSource[];
  password: string;
  provider: CryptoProvider;
  /**
   * Called once — after the package header is parsed and validated — with the
   * authenticated original file name and size. Return the sink that receives
   * the restored bytes. On any subsequent failure `sink.abort()` is called and
   * no apparently-valid output is left behind.
   */
  openOutput: (fileName: string, size: number) => Promise<ByteSink>;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export interface DecryptResult {
  fileName: string;
  size: number;
  sha256Hex: string;
  packageId: string;
  partCount: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HandshackError('cancelled');
}

/**
 * Match provided files against the manifest part list.
 * Returns sources in manifest order. Rejects missing, duplicated, unexpected
 * and size-mismatched files before any cryptographic work happens.
 */
export function matchParts(manifest: PackageManifest, provided: NamedSource[]): ByteSource[] {
  const byName = new Map<string, ByteSource>();
  const dupes: string[] = [];
  for (const p of provided) {
    if (byName.has(p.name)) dupes.push(p.name);
    byName.set(p.name, p.source);
  }
  if (dupes.length > 0) {
    throw new HandshackError('duplicate-parts', dupes.join(', '));
  }
  const manifestNames = new Set(manifest.parts.map((p) => p.name));
  const unexpected = provided.filter((p) => !manifestNames.has(p.name)).map((p) => p.name);
  if (unexpected.length > 0) {
    throw new HandshackError(
      'unexpected-files',
      unexpected.join(', '),
      `These files do not belong to this package: ${unexpected.slice(0, 5).join(', ')}${unexpected.length > 5 ? '…' : ''}`,
    );
  }
  const missing = manifest.parts.filter((p) => !byName.has(p.name)).map((p) => p.name);
  if (missing.length > 0) {
    throw new HandshackError(
      'missing-parts',
      missing.join(', '),
      `Missing ${missing.length} part(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`,
    );
  }
  return manifest.parts.map((p) => {
    const src = byName.get(p.name)!;
    if (src.size !== p.size) {
      throw new HandshackError(
        'part-mismatch',
        `${p.name}: size ${src.size} != ${p.size}`,
        `The file "${p.name}" does not match the size recorded in the manifest.`,
      );
    }
    return src;
  });
}

/**
 * Verify every part's SHA-256 against the manifest before decryption so a
 * corrupt or foreign part is identified by name. The authoritative integrity
 * check is still AES-GCM authentication — these hashes are a UX convenience.
 */
export async function verifyPartHashes(
  manifest: PackageManifest,
  ordered: ByteSource[],
  provider: CryptoProvider,
  signal?: AbortSignal,
  onProgress?: ProgressCallback,
): Promise<void> {
  const report = onProgress ?? (() => undefined);
  report({ phase: 'validating', done: 0, total: manifest.encryptedSize });
  let done = 0;
  for (let i = 0; i < ordered.length; i++) {
    throwIfAborted(signal);
    const src = ordered[i]!;
    const part = manifest.parts[i]!;
    const hasher = provider.createSha256();
    for (let off = 0; off < src.size; off += RECORD_SIZE) {
      throwIfAborted(signal);
      const n = Math.min(RECORD_SIZE, src.size - off);
      hasher.update(await src.read(off, n));
      done += n;
    }
    const hex = bytesToHex(await hasher.digest());
    if (hex !== part.sha256) {
      throw new HandshackError(
        'part-corrupt',
        `${part.name} sha256 mismatch`,
        `The file "${part.name}" is corrupted or does not belong to this package.`,
      );
    }
    report({ phase: 'validating', done, total: manifest.encryptedSize });
  }
}

/**
 * Reassemble + decrypt a complete package. Writes plaintext only to the sink
 * returned by `openOutput`; on any failure the sink is aborted so no partial
 * plaintext masquerades as a completed file.
 */
export async function decryptPackage(req: DecryptRequest): Promise<DecryptResult> {
  const { manifest, provider, signal, onProgress } = req;
  const report = onProgress ?? (() => undefined);

  if (typeof req.password !== 'string' || req.password.length === 0) {
    throw new HandshackError('invalid-password', 'empty password');
  }
  throwIfAborted(signal);

  const ordered = matchParts(manifest, req.parts);
  await verifyPartHashes(manifest, ordered, provider, signal, onProgress);

  report({ phase: 'reassembling', done: 0, total: 0 });
  const reader = new SequentialReader(ordered);
  if (reader.size !== manifest.encryptedSize) {
    throw new HandshackError('invalid-package', 'reassembled size does not match manifest');
  }

  // --- preamble + header ---
  const preamble = await reader.read(PACKAGE_PREAMBLE_SIZE);
  if (!bytesEqual(preamble.subarray(0, 4), PACKAGE_MAGIC)) {
    throw new HandshackError('invalid-package', 'bad magic bytes');
  }
  const headerLen = readU32be(preamble, 4);
  if (headerLen <= 0 || headerLen > MAX_HEADER_SIZE) {
    throw new HandshackError('invalid-package', `header length ${headerLen} out of bounds`);
  }
  const headerBytes = await reader.read(headerLen);
  const header = parseHeader(headerBytes);
  const headerHash = await provider.sha256(headerBytes);

  // Cross-check the untrusted manifest against the (soon-authenticated) header.
  if (
    header.pkgId !== manifest.packageId ||
    header.chunkSize !== manifest.chunkSize ||
    header.origSize !== manifest.originalSize ||
    header.salt !== manifest.salt ||
    header.kdfN !== manifest.kdfParams.n ||
    header.kdfR !== manifest.kdfParams.r ||
    header.kdfP !== manifest.kdfParams.p ||
    header.dkLen !== manifest.kdfParams.dkLen
  ) {
    throw new HandshackError(
      'invalid-package',
      'manifest/header mismatch',
      'The manifest does not match the encrypted package contents. The files may not belong together.',
    );
  }
  const expectedSize = PACKAGE_PREAMBLE_SIZE + headerLen + header.payloadSize;
  if (expectedSize !== reader.size) {
    throw new HandshackError('truncated-package', 'package size does not match header');
  }

  const fileName = safeFileName(header.origName, 'handshack-restored');
  const sink = await req.openOutput(fileName, header.origSize);
  throwIfAborted(signal);

  const passwordBytes = utf8ToBytes(req.password);
  let key: Uint8Array | null = null;
  try {
    report({ phase: 'deriving-key', done: 0, total: 1 });
    key = await provider.deriveKey(passwordBytes, base64UrlToBytes(header.salt), {
      n: header.kdfN,
      r: header.kdfR,
      p: header.kdfP,
      dkLen: header.dkLen,
    });
    passwordBytes.fill(0);
    report({ phase: 'deriving-key', done: 1, total: 1 });
    throwIfAborted(signal);

    report({ phase: 'decrypting', done: 0, total: header.payloadSize });
    const plainHasher = provider.createSha256();
    let done = 0;
    for (let i = 0; i < header.recordCount; i++) {
      throwIfAborted(signal);
      const isFinal = i === header.recordCount - 1;
      const ctLen = recordPlainLength(i, header.origSize) + 16;
      const ct = await reader.read(ctLen);
      const pt = await decryptRecord(provider, key, headerHash, i, ct, isFinal);
      plainHasher.update(pt);
      await sink.write(pt);
      pt.fill(0);
      done += ctLen;
      report({ phase: 'decrypting', done, total: header.payloadSize });
    }

    if (reader.remaining !== 0) {
      throw new HandshackError('invalid-package', 'trailing bytes after final record');
    }
    const digest = bytesToHex(await plainHasher.digest());
    if (digest !== header.origSha256) {
      throw new HandshackError('integrity-failed', 'sha256 mismatch after decrypt');
    }

    await sink.close();
    report({ phase: 'completed', done: header.payloadSize, total: header.payloadSize });
    return {
      fileName,
      size: header.origSize,
      sha256Hex: digest,
      packageId: header.pkgId,
      partCount: manifest.partCount,
    };
  } catch (err) {
    await sink.abort().catch(() => undefined);
    throw err;
  } finally {
    if (key) key.fill(0);
  }
}
