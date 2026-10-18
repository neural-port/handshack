import { GCM_TAG_SIZE, RECORD_NONCE_PREFIX, RECORD_SIZE } from '../constants.js';
import { concatBytes, u64be } from '../encoding.js';
import type { CryptoProvider } from '../types.js';

/**
 * Record-layer construction for format v1.
 *
 * The 256-bit AES-GCM key is unique per package (fresh random salt → unique
 * derived key), so a deterministic per-record counter nonce is safe and removes
 * any possibility of nonce collision:
 *
 *   nonce_i = "HSP1" (4 bytes) || uint64be(recordIndex) (8 bytes) = 12 bytes
 *
 * Each record's AAD binds:
 *   aad_i   = "HSP1" || uint64be(i) || u8(isFinal) || sha256(headerBytes)
 *
 * which authenticates the record's position, its role as the final record
 * (preventing undetected truncation), and the complete package header.
 */

export function recordNonce(index: number): Uint8Array {
  return concatBytes(RECORD_NONCE_PREFIX, u64be(index));
}

export function recordAad(headerHash: Uint8Array, index: number, isFinal: boolean): Uint8Array {
  return concatBytes(RECORD_NONCE_PREFIX, u64be(index), Uint8Array.of(isFinal ? 1 : 0), headerHash);
}

export function recordCountForSize(plainSize: number): number {
  return Math.max(1, Math.ceil(plainSize / RECORD_SIZE));
}

export function recordPlainLength(index: number, plainSize: number): number {
  const total = recordCountForSize(plainSize);
  if (index === total - 1) return plainSize - (total - 1) * RECORD_SIZE;
  return RECORD_SIZE;
}

export function payloadSizeFor(plainSize: number): number {
  return plainSize + recordCountForSize(plainSize) * GCM_TAG_SIZE;
}

export async function encryptRecord(
  provider: CryptoProvider,
  key: Uint8Array,
  headerHash: Uint8Array,
  index: number,
  plaintext: Uint8Array,
  isFinal: boolean,
): Promise<Uint8Array> {
  return provider.aesGcmEncrypt(key, recordNonce(index), plaintext, recordAad(headerHash, index, isFinal));
}

export async function decryptRecord(
  provider: CryptoProvider,
  key: Uint8Array,
  headerHash: Uint8Array,
  index: number,
  ciphertext: Uint8Array,
  isFinal: boolean,
): Promise<Uint8Array> {
  return provider.aesGcmDecrypt(key, recordNonce(index), ciphertext, recordAad(headerHash, index, isFinal));
}
