import {
  CHUNK_SIZE_OPTIONS,
  KDF_ID,
  KDF_MAX_MEMORY,
  KDF_MAX_N,
  KDF_MAX_P,
  KDF_MAX_R,
  KDF_MIN_N,
  MAX_FILE_NAME,
  MAX_FILE_SIZE,
  MAX_INPUT_FILE_SIZE,
  MAX_MANIFEST_SIZE,
  MAX_PART_COUNT,
  MAX_PART_NAME,
  PART_NAME_PATTERN,
  PART_SUFFIX,
  FORMAT_ID,
  FORMAT_VERSION,
  ALG_ID,
  MANIFEST_SUFFIX,
  SALT_SIZE,
} from './constants.js';
import { base64UrlToBytes, bytesToBase64Url } from './encoding.js';
import { HandshackError } from './errors.js';
import type { PackageManifest, ScryptParams } from './types.js';

/**
 * Sanitize a file name for safe use as an output file name.
 * Strips path separators, control characters and Windows-reserved constructs.
 * Throws 'unsafe-filename' when nothing usable remains.
 */
export function sanitizeFileName(name: string): string {
  if (typeof name !== 'string') throw new HandshackError('unsafe-filename', 'name is not a string');
  let cleaned = name
    // drop path structure entirely — separators AND dot-segments can never survive
    .split(/[/\\]+/)
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .join('_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/["'*:<>?|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  // strip leading dots to avoid hidden-file / traversal tricks
  cleaned = cleaned.replace(/^\.+/, '');
  if (cleaned.length > MAX_FILE_NAME) cleaned = cleaned.slice(0, MAX_FILE_NAME).trimEnd();
  if (!cleaned || cleaned === '.' || cleaned === '..' || !/[\p{L}\p{N}]/u.test(cleaned)) {
    throw new HandshackError('unsafe-filename', 'file name is empty after sanitization');
  }
  // Windows reserved device names
  const stem = cleaned.split('.')[0]!.toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
    cleaned = `file-${cleaned}`;
  }
  return cleaned;
}

/** Best-effort sanitize that never throws — used for display hints. */
export function safeFileName(name: unknown, fallback = 'restored-file'): string {
  try {
    return typeof name === 'string' ? sanitizeFileName(name) : fallback;
  } catch {
    return fallback;
  }
}

export function isManifestFileName(name: string): boolean {
  return name.toLowerCase().endsWith(MANIFEST_SUFFIX);
}

export function isPartFileName(name: string): boolean {
  return PART_NAME_PATTERN.test(name);
}

/** Extract the numeric part index (0-based) from `*.partNNN.hsp`. Returns -1 if not a part name. */
export function partIndexFromName(name: string): number {
  const m = PART_NAME_PATTERN.exec(name);
  if (!m) return -1;
  return parseInt(m[1]!, 10) - 1;
}

export function makePartName(base: string, index: number): string {
  return `${base}.part${String(index + 1).padStart(3, '0')}${PART_SUFFIX}`;
}

/** Validate scrypt parameters against hard resource bounds before allocating memory. */
export function validateKdfParams(params: ScryptParams): void {
  const { n, r, p, dkLen } = params;
  if (!Number.isInteger(n) || n < KDF_MIN_N || n > KDF_MAX_N || (n & (n - 1)) !== 0) {
    throw new HandshackError('kdf-params-out-of-range', `scrypt n=${n} out of range or not a power of two`);
  }
  if (!Number.isInteger(r) || r < 1 || r > KDF_MAX_R) {
    throw new HandshackError('kdf-params-out-of-range', `scrypt r=${r} out of range`);
  }
  if (!Number.isInteger(p) || p < 1 || p > KDF_MAX_P) {
    throw new HandshackError('kdf-params-out-of-range', `scrypt p=${p} out of range`);
  }
  if (dkLen !== 32) {
    throw new HandshackError('kdf-params-out-of-range', `unsupported derived key length ${dkLen}`);
  }
  const memory = 128 * n * r * p;
  if (memory > KDF_MAX_MEMORY) {
    throw new HandshackError(
      'kdf-params-out-of-range',
      `scrypt parameters would allocate ${memory} bytes (limit ${KDF_MAX_MEMORY})`,
    );
  }
}

export function validateChunkSize(chunkSize: number): void {
  if (!CHUNK_SIZE_OPTIONS.includes(chunkSize as (typeof CHUNK_SIZE_OPTIONS)[number])) {
    throw new HandshackError('invalid-input', `unsupported chunk size ${chunkSize}`);
  }
}

export function validateInputFileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new HandshackError('invalid-input', 'invalid file size');
  }
  if (size > MAX_INPUT_FILE_SIZE) {
    throw new HandshackError(
      'file-too-large',
      `size ${size} exceeds ${MAX_INPUT_FILE_SIZE}`,
      'The selected file is larger than the 1 GB maximum supported by this version of HandShack.',
    );
  }
}

/**
 * Structural validation of a parsed manifest object.
 * The manifest is untrusted: every field is type- and range-checked.
 */
export function validateManifest(raw: unknown): PackageManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HandshackError('invalid-manifest', 'manifest is not a JSON object');
  }
  const m = raw as Record<string, unknown>;

  if (m['format'] !== FORMAT_ID) throw new HandshackError('invalid-manifest', 'missing or bad format id');
  if (m['formatVersion'] !== FORMAT_VERSION) {
    throw new HandshackError(
      'unsupported-version',
      `formatVersion=${String(m['formatVersion'])}`,
      'This package was created by a different version of HandShack and cannot be read.',
    );
  }
  if (m['algorithm'] !== ALG_ID) {
    throw new HandshackError('unsupported-algorithm', `algorithm=${String(m['algorithm'])}`);
  }
  if (m['kdf'] !== KDF_ID) {
    throw new HandshackError('unsupported-algorithm', `kdf=${String(m['kdf'])}`);
  }

  const kdfParams = m['kdfParams'] as Record<string, unknown> | undefined;
  if (typeof kdfParams !== 'object' || kdfParams === null) {
    throw new HandshackError('invalid-manifest', 'missing kdfParams');
  }
  const params: ScryptParams = {
    n: num(kdfParams['n']),
    r: num(kdfParams['r']),
    p: num(kdfParams['p']),
    dkLen: num(kdfParams['dkLen']),
  };
  validateKdfParams(params);

  if (typeof m['salt'] !== 'string' || m['salt'].length < 8 || m['salt'].length > 64) {
    throw new HandshackError('invalid-manifest', 'bad salt');
  }
  try {
    const saltBytes = base64UrlToBytes(m['salt']);
    if (saltBytes.length !== SALT_SIZE || bytesToBase64Url(saltBytes) !== m['salt']) {
      throw new HandshackError('invalid-manifest', 'salt must be canonical base64url encoding of 16 bytes');
    }
  } catch (err) {
    if (err instanceof HandshackError && err.code === 'invalid-manifest') throw err;
    throw new HandshackError('invalid-manifest', 'bad salt encoding');
  }

  const chunkSize = num(m['chunkSize']);
  validateChunkSize(chunkSize);

  const partCount = num(m['partCount']);
  if (partCount < 1 || partCount > MAX_PART_COUNT) {
    throw new HandshackError('too-many-parts', `partCount=${partCount}`);
  }

  const encryptedSize = num(m['encryptedSize']);
  if (encryptedSize <= 0 || encryptedSize > MAX_FILE_SIZE + MAX_PART_COUNT * 64 + MAX_MANIFEST_SIZE) {
    throw new HandshackError('invalid-manifest', `bad encryptedSize ${encryptedSize}`);
  }
  const originalSize = num(m['originalSize']);
  if (originalSize < 0 || originalSize > MAX_FILE_SIZE) {
    throw new HandshackError('invalid-manifest', `bad originalSize ${originalSize}`);
  }

  if (typeof m['packageId'] !== 'string' || !/^hs_[A-Za-z0-9_-]{8,64}$/.test(m['packageId'])) {
    throw new HandshackError('invalid-manifest', 'bad packageId');
  }
  if (typeof m['originalName'] !== 'string' || m['originalName'].length > MAX_FILE_NAME + 16) {
    throw new HandshackError('invalid-manifest', 'bad originalName');
  }
  if (typeof m['createdAt'] !== 'string' || m['createdAt'].length > 40) {
    throw new HandshackError('invalid-manifest', 'bad createdAt');
  }
  if (typeof m['generator'] !== 'string' || m['generator'].length > 80) {
    throw new HandshackError('invalid-manifest', 'bad generator');
  }

  const partsRaw = m['parts'];
  if (!Array.isArray(partsRaw) || partsRaw.length !== partCount) {
    throw new HandshackError('invalid-manifest', 'parts array missing or length mismatch');
  }
  const seen = new Set<string>();
  let total = 0;
  const parts = partsRaw.map((p, i) => {
    if (typeof p !== 'object' || p === null) {
      throw new HandshackError('invalid-manifest', `part ${i} is not an object`);
    }
    const rec = p as Record<string, unknown>;
    const name = rec['name'];
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > MAX_PART_NAME ||
      !PART_NAME_PATTERN.test(name) ||
      /[/\\]/.test(name)
    ) {
      throw new HandshackError('invalid-manifest', `bad part name at index ${i}`);
    }
    if (partIndexFromName(name) !== i) {
      throw new HandshackError('invalid-manifest', `part ${i} has an out-of-order name`);
    }
    if (seen.has(name)) {
      throw new HandshackError('duplicate-parts', `duplicate part name ${name}`);
    }
    seen.add(name);
    const size = num(rec['size']);
    if (size < 1 || size > chunkSize) {
      throw new HandshackError('invalid-manifest', `bad size for part ${name}`);
    }
    // Non-final parts must be exactly chunkSize; only the last may be smaller.
    if (i < partsRaw.length - 1 && size !== chunkSize) {
      throw new HandshackError('invalid-manifest', `part ${name} is not the last part but has size ${size} (expected ${chunkSize})`);
    }
    const sha = rec['sha256'];
    if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) {
      throw new HandshackError('invalid-manifest', `bad sha256 for part ${name}`);
    }
    total += size;
    return { name, size, sha256: sha };
  });
  if (total !== encryptedSize) {
    throw new HandshackError('invalid-manifest', 'part sizes do not add up to encryptedSize');
  }

  return {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
    packageId: m['packageId'],
    createdAt: m['createdAt'],
    generator: m['generator'],
    originalName: m['originalName'],
    originalSize,
    encryptedSize,
    chunkSize,
    partCount,
    algorithm: ALG_ID,
    kdf: KDF_ID,
    kdfParams: params,
    salt: m['salt'],
    parts,
  };
}

function num(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new HandshackError('invalid-manifest', `expected integer, got ${typeof v}`);
  }
  return v;
}
