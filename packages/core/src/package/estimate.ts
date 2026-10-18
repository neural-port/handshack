import {
  GCM_TAG_SIZE,
  PACKAGE_PREAMBLE_SIZE,
  RECORD_SIZE,
} from '../constants.js';
import { recordCountForSize } from '../crypto/records.js';

/** Approximate serialized header length — filename is the only variable field. */
export function estimateHeaderSize(fileNameLength: number): number {
  return 330 + Math.min(fileNameLength, 128);
}

/** Exact size of the encrypted record region for a plaintext size. */
export function payloadSizeEstimate(plainSize: number): number {
  return plainSize + recordCountForSize(plainSize) * GCM_TAG_SIZE;
}

/** Estimated total encrypted package size (header is approximate). */
export function estimateEncryptedSize(plainSize: number, fileName: string): number {
  return PACKAGE_PREAMBLE_SIZE + estimateHeaderSize(fileName.length) + payloadSizeEstimate(plainSize);
}

/** Estimated number of output parts at a given chunk size. */
export function estimatePartCount(plainSize: number, fileName: string, chunkSize: number): number {
  return Math.max(1, Math.ceil(estimateEncryptedSize(plainSize, fileName) / chunkSize));
}

export function recordSizeBytes(): number {
  return RECORD_SIZE;
}
