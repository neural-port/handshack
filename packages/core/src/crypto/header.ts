import {
  ALG_ID,
  KDF_ID,
  MAX_FILE_NAME,
  MAX_FILE_SIZE,
  MAX_HEADER_SIZE,
  RECORD_SIZE,
} from '../constants.js';
import { base64UrlToBytes, bytesToUtf8, utf8ToBytes } from '../encoding.js';
import { HandshackError } from '../errors.js';
import type { PackageHeader, ScryptParams } from '../types.js';
import { validateKdfParams } from '../validation.js';

/**
 * Serialize a header to its canonical byte form. Serialization happens once at
 * encryption time; the raw bytes are stored in the package and hashed verbatim,
 * so key order is stable-by-construction rather than normalized at parse time.
 */
export function serializeHeader(header: PackageHeader): Uint8Array {
  return utf8ToBytes(JSON.stringify(header));
}

/** Parse + validate the package header bytes. `raw` must be ≤ MAX_HEADER_SIZE. */
export function parseHeader(raw: Uint8Array): PackageHeader {
  if (raw.length === 0 || raw.length > MAX_HEADER_SIZE) {
    throw new HandshackError('invalid-package', `header length ${raw.length} out of bounds`);
  }
  let obj: unknown;
  try {
    obj = JSON.parse(bytesToUtf8(raw));
  } catch {
    throw new HandshackError('invalid-package', 'header is not valid JSON');
  }
  return validateHeader(obj);
}

export function validateHeader(obj: unknown): PackageHeader {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new HandshackError('invalid-package', 'header is not an object');
  }
  const h = obj as Record<string, unknown>;
  if (h['v'] !== 1) {
    throw new HandshackError(
      'unsupported-version',
      `header v=${String(h['v'])}`,
      'This package was created by a different version of HandShack and cannot be read.',
    );
  }
  if (h['alg'] !== ALG_ID) throw new HandshackError('unsupported-algorithm', `alg=${String(h['alg'])}`);
  if (h['kdf'] !== KDF_ID) throw new HandshackError('unsupported-algorithm', `kdf=${String(h['kdf'])}`);

  const params: ScryptParams = {
    n: reqInt(h, 'kdfN'),
    r: reqInt(h, 'kdfR'),
    p: reqInt(h, 'kdfP'),
    dkLen: reqInt(h, 'dkLen'),
  };
  validateKdfParams(params);

  const salt = h['salt'];
  if (typeof salt !== 'string' || salt.length < 8 || salt.length > 64) {
    throw new HandshackError('invalid-package', 'bad salt');
  }
  const saltBytes = base64UrlToBytes(salt);
  if (saltBytes.length < 8 || saltBytes.length > 32) {
    throw new HandshackError('invalid-package', 'salt length out of bounds');
  }

  const recordSize = reqInt(h, 'recordSize');
  if (recordSize < 1 || recordSize > RECORD_SIZE) {
    throw new HandshackError('invalid-package', `recordSize=${recordSize}`);
  }
  const recordCount = reqInt(h, 'recordCount');
  if (recordCount < 1 || recordCount > Math.ceil(MAX_FILE_SIZE / RECORD_SIZE)) {
    throw new HandshackError('invalid-package', `recordCount=${recordCount}`);
  }
  const origSize = reqInt(h, 'origSize');
  if (origSize < 0 || origSize > MAX_FILE_SIZE) {
    throw new HandshackError('invalid-package', `origSize=${origSize}`);
  }
  const expectedRecords = Math.max(1, Math.ceil(origSize / recordSize));
  if (recordCount !== expectedRecords) {
    throw new HandshackError('invalid-package', 'recordCount does not match origSize');
  }
  const payloadSize = reqInt(h, 'payloadSize');
  if (payloadSize !== origSize + recordCount * 16) {
    throw new HandshackError('invalid-package', 'payloadSize inconsistent with origSize/recordCount');
  }
  const chunkSize = reqInt(h, 'chunkSize');
  if (chunkSize < 1024 * 1024 || chunkSize > 64 * 1024 * 1024) {
    throw new HandshackError('invalid-package', `chunkSize=${chunkSize}`);
  }
  const origSha256 = h['origSha256'];
  if (typeof origSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(origSha256)) {
    throw new HandshackError('invalid-package', 'bad origSha256');
  }
  const origName = h['origName'];
  if (typeof origName !== 'string' || origName.length === 0 || origName.length > MAX_FILE_NAME + 16) {
    throw new HandshackError('invalid-package', 'bad origName');
  }
  const pkgId = h['pkgId'];
  if (typeof pkgId !== 'string' || !/^hs_[A-Za-z0-9_-]{8,64}$/.test(pkgId)) {
    throw new HandshackError('invalid-package', 'bad pkgId');
  }
  const created = reqInt(h, 'created');

  return {
    v: 1,
    alg: ALG_ID,
    kdf: KDF_ID,
    kdfN: params.n,
    kdfR: params.r,
    kdfP: params.p,
    dkLen: params.dkLen,
    salt,
    recordSize,
    recordCount,
    chunkSize,
    payloadSize,
    origSize,
    origSha256,
    origName,
    pkgId,
    created,
  };
}

function reqInt(h: Record<string, unknown>, key: string): number {
  const v = h[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new HandshackError('invalid-package', `header field ${key} missing or non-integer`);
  }
  return v;
}
