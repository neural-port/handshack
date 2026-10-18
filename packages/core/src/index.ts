export * from './constants.js';
export * from './errors.js';
export * from './types.js';
export * from './encoding.js';
export * from './validation.js';

export { serializeHeader, parseHeader, validateHeader } from './crypto/header.js';
export {
  recordNonce,
  recordAad,
  recordCountForSize,
  recordPlainLength,
  payloadSizeFor,
  encryptRecord,
  decryptRecord,
} from './crypto/records.js';
export { WebCryptoProvider } from './crypto/providers/web-provider.js';

export { MemoryByteSource, BlobByteSource, SequentialReader } from './io/sources.js';
export { MemoryByteSink, BlobByteSink } from './io/sinks.js';

export { PartRouter, planParts, type PartPlan, type PartSinkFactory } from './package/split.js';
export {
  createManifest,
  serializeManifest,
  parseManifestBytes,
  manifestToBytes,
  type ManifestInput,
} from './package/manifest.js';
export {
  encryptFile,
  verifyWrittenParts,
  MIN_PASSWORD_LENGTH,
  type EncryptRequest,
  type EncryptResult,
} from './package/encrypt.js';
export {
  decryptPackage,
  matchParts,
  verifyPartHashes,
  type DecryptRequest,
  type DecryptResult,
} from './package/decrypt.js';
export {
  estimateHeaderSize,
  estimateEncryptedSize,
  estimatePartCount,
  payloadSizeEstimate,
  recordSizeBytes,
} from './package/estimate.js';
