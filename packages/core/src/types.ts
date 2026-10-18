/**
 * Shared types for the HandShack package format and processing pipeline.
 */

/** scrypt parameters serialized in the package header. */
export interface ScryptParams {
  n: number;
  r: number;
  p: number;
  dkLen: number;
}

/** Streaming SHA-256 — required because large files cannot be hashed in one shot. */
export interface IncrementalHash {
  update(data: Uint8Array): void;
  digest(): Promise<Uint8Array>;
}

/**
 * Environment-specific cryptographic primitives.
 * Implemented by WebCryptoProvider (browser/worker) and NodeCryptoProvider (Electron main).
 */
export interface CryptoProvider {
  readonly name: string;
  /** Cryptographically secure random bytes. */
  randomBytes(length: number): Uint8Array;
  /** scrypt KDF. Implementations must produce RFC-7914 compatible output. */
  deriveKey(password: Uint8Array, salt: Uint8Array, params: ScryptParams): Promise<Uint8Array>;
  /** AES-256-GCM seal. Returns ciphertext || 16-byte tag. */
  aesGcmEncrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array>;
  /** AES-256-GCM open. Input is ciphertext || tag. Throws on authentication failure. */
  aesGcmDecrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array>;
  sha256(data: Uint8Array): Promise<Uint8Array>;
  createSha256(): IncrementalHash;
}

/** Random-access byte source (file, blob, or memory). */
export interface ByteSource {
  readonly size: number;
  /** Read `length` bytes starting at `offset`. Must return exactly `length` bytes. */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Release any held resource (e.g. a file handle). Optional for in-memory sources. */
  close?(): Promise<void>;
}

/** Sequential byte sink (file stream, blob builder, or memory). */
export interface ByteSink {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Abandon the sink and clean up any partial output. */
  abort(): Promise<void>;
}

/** A named source used to satisfy one manifest part entry. */
export interface NamedSource {
  name: string;
  source: ByteSource;
}

/** Manifest v1 — the `.hsmanifest.json` document. Untrusted input. */
export interface PackageManifest {
  format: 'handshack-package';
  formatVersion: 1;
  packageId: string;
  createdAt: string;
  generator: string;
  originalName: string;
  originalSize: number;
  encryptedSize: number;
  chunkSize: number;
  partCount: number;
  algorithm: 'AES-256-GCM';
  kdf: 'scrypt';
  kdfParams: { n: number; r: number; p: number; dkLen: number };
  salt: string;
  parts: ManifestPart[];
}

export interface ManifestPart {
  name: string;
  size: number;
  sha256: string;
}

/**
 * Header v1 — plaintext JSON stored inside the encrypted package stream and
 * bound into every record's AES-GCM AAD via its SHA-256 digest.
 */
export interface PackageHeader {
  v: 1;
  alg: 'AES-256-GCM';
  kdf: 'scrypt';
  kdfN: number;
  kdfR: number;
  kdfP: number;
  dkLen: number;
  salt: string;
  recordSize: number;
  recordCount: number;
  chunkSize: number;
  payloadSize: number;
  origSize: number;
  origSha256: string;
  origName: string;
  pkgId: string;
  created: number;
}

export type OperationPhase =
  | 'preparing'
  | 'validating'
  | 'hashing'
  | 'deriving-key'
  | 'encrypting'
  | 'writing'
  | 'verifying'
  | 'reassembling'
  | 'decrypting'
  | 'completed';

export interface ProgressEvent {
  phase: OperationPhase;
  /** Bytes processed in the current phase. */
  done: number;
  /** Total bytes expected in the current phase (0 when indeterminate). */
  total: number;
}

export type ProgressCallback = (event: ProgressEvent) => void;
