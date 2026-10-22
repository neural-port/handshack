/**
 * HandShack package format v1 — shared constants.
 * All values here are part of the documented wire format; see docs/ENCRYPTION_FORMAT.md.
 */

/** Magic bytes at offset 0 of every encrypted package stream: "HSP1". */
export const PACKAGE_MAGIC = new Uint8Array([0x48, 0x53, 0x50, 0x31]);
export const PACKAGE_MAGIC_LEN = PACKAGE_MAGIC.length; // 4
/** u32 big-endian header length follows the magic. */
export const HEADER_LEN_SIZE = 4;
export const PACKAGE_PREAMBLE_SIZE = PACKAGE_MAGIC_LEN + HEADER_LEN_SIZE;

export const FORMAT_ID = 'handshack-package';
export const FORMAT_VERSION = 1;

export const MANIFEST_SUFFIX = '.hsmanifest.json';
export const PART_SUFFIX = '.hsp';
/** Part names look like `<base>.part001.hsp`. */
export const PART_NAME_PATTERN = /\.part(\d{3,})\.hsp$/;

/** Plaintext bytes per authenticated record. */
export const RECORD_SIZE = 1024 * 1024; // 1 MiB
/** AES-GCM tag length appended to every record. */
export const GCM_TAG_SIZE = 16;
export const GCM_NONCE_SIZE = 12;
export const AES_KEY_SIZE = 32;

export const SALT_SIZE = 16;
export const PACKAGE_ID_BYTES = 18;
export const PACKAGE_ID_PREFIX = 'hs_';

/** scrypt parameters emitted by this implementation for format v1. */
export const KDF_ID = 'scrypt';
export const KDF_DEFAULTS = { n: 32768, r: 8, p: 1, dkLen: AES_KEY_SIZE } as const;
export const MAX_PASSWORD_LENGTH = 1024;
/** Hard acceptance bounds for KDF parameters coming from untrusted packages. */
export const KDF_MIN_N = 1 << 14;
export const KDF_MAX_N = 1 << 20;
export const KDF_MAX_R = 8;
export const KDF_MAX_P = 4;
/** Absolute cap on scrypt memory usage: 128 * n * r * p bytes. */
export const KDF_MAX_MEMORY = 256 * 1024 * 1024;

export const ALG_ID = 'AES-256-GCM';

/** Chunk sizes offered to the user. 1 MiB = 1,048,576 bytes. */
export const CHUNK_SIZE_OPTIONS = [
  1 * 1024 * 1024,
  2 * 1024 * 1024,
  3 * 1024 * 1024,
  4 * 1024 * 1024,
] as const;
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

/** Resource limits. */
/** Format ceiling — the largest file a package may describe, so old packages stay readable. */
export const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4 GiB
/** Input ceiling — the largest file this build will encrypt. */
export const MAX_INPUT_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB
/** Videos are accepted up to 1080p: the shorter side may not exceed 1080 pixels. */
export const MAX_VIDEO_SHORT_SIDE = 1080;
export const MAX_PART_COUNT = 4096;
export const MAX_MANIFEST_SIZE = 1024 * 1024; // 1 MiB
export const MAX_HEADER_SIZE = 64 * 1024; // 64 KiB
export const MAX_FILE_NAME = 128;
export const MAX_PART_NAME = 160;
/** Above this package size the web UI does not offer the ZIP convenience download. */
export const ZIP_DOWNLOAD_LIMIT = 512 * 1024 * 1024;
/** ZIP resource limits; these are checked before decompression in the ZIP worker. */
export const ZIP_MAX_ENTRY_SIZE = 256 * 1024 * 1024;
export const ZIP_MAX_TOTAL_SIZE = ZIP_DOWNLOAD_LIMIT;
export const ZIP_MAX_ENTRIES = 4096;
export const ZIP_MAX_ARCHIVE_SIZE =
  ZIP_MAX_TOTAL_SIZE + MAX_MANIFEST_SIZE + ZIP_MAX_ENTRIES * 128;

/** Fixed nonce prefix for record nonces: nonce_i = "HSP1" || u64be(i). */
export const RECORD_NONCE_PREFIX = PACKAGE_MAGIC;
