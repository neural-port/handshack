import { MAX_MANIFEST_SIZE } from '../constants.js';
import { bytesToUtf8, utf8ToBytes } from '../encoding.js';
import { HandshackError } from '../errors.js';
import type { ManifestPart, PackageManifest, ScryptParams } from '../types.js';
import { validateManifest } from '../validation.js';

export interface ManifestInput {
  packageId: string;
  generator: string;
  originalName: string;
  originalSize: number;
  encryptedSize: number;
  chunkSize: number;
  kdfParams: ScryptParams;
  salt: string;
  parts: ManifestPart[];
  createdAt?: Date;
}

/** Build the manifest object (fields are already validated upstream). */
export function createManifest(input: ManifestInput): PackageManifest {
  return {
    format: 'handshack-package',
    formatVersion: 1,
    packageId: input.packageId,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    generator: input.generator,
    originalName: input.originalName,
    originalSize: input.originalSize,
    encryptedSize: input.encryptedSize,
    chunkSize: input.chunkSize,
    partCount: input.parts.length,
    algorithm: 'AES-256-GCM',
    kdf: 'scrypt',
    kdfParams: { ...input.kdfParams },
    salt: input.salt,
    parts: input.parts.map((p) => ({ ...p })),
  };
}

export function serializeManifest(manifest: PackageManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/** Parse + validate raw manifest bytes/text. Enforces the manifest size cap. */
export function parseManifestBytes(raw: Uint8Array): PackageManifest {
  if (raw.length > MAX_MANIFEST_SIZE) {
    throw new HandshackError('invalid-manifest', `manifest size ${raw.length} exceeds ${MAX_MANIFEST_SIZE}`);
  }
  let obj: unknown;
  try {
    obj = JSON.parse(bytesToUtf8(raw));
  } catch {
    throw new HandshackError('invalid-manifest', 'manifest is not valid JSON');
  }
  return validateManifest(obj);
}

export function manifestToBytes(manifest: PackageManifest): Uint8Array {
  return utf8ToBytes(serializeManifest(manifest));
}
