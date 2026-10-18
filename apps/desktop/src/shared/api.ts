/**
 * Narrow, allow-listed IPC surface exposed to the renderer through the preload
 * contextBridge. Every method maps to exactly one validated main-process
 * handler — there is no generic invoke/channel escape hatch.
 */
import type { PackageManifest, ProgressEvent } from '@handshack/core';

export interface PickedFile {
  path: string;
  name: string;
  size: number;
}

export interface InspectResult {
  manifestPath: string;
  manifest: PackageManifest;
  matchedPartPaths: string[];
  missing: string[];
  unexpected: string[];
}

export interface EncryptParams {
  inputPath: string;
  outputDir: string;
  password: string;
  chunkSize: number;
  overwrite: boolean;
}

export interface EncryptOutcome {
  manifestPath: string;
  partPaths: string[];
  outputDir: string;
  packageId: string;
  originalName: string;
  originalSize: number;
  encryptedSize: number;
  chunkSize: number;
  manifestName: string;
}

export interface DecryptParams {
  manifestPath: string;
  partPaths: string[];
  savePath: string;
  password: string;
  overwrite: boolean;
}

export interface DecryptOutcome {
  outPath: string;
  fileName: string;
  size: number;
  sha256Hex: string;
  packageId: string;
}

export interface HandshackBridge {
  pickInputFile(): Promise<PickedFile | null>;
  pickPackageFiles(): Promise<PickedFile[]>;
  pickOutputDirectory(): Promise<string | null>;
  pickSavePath(defaultName: string): Promise<string | null>;
  inspectPackage(paths: string[]): Promise<InspectResult>;
  findCollisions(dir: string, baseName: string): Promise<string[]>;
  pathExists(path: string): Promise<boolean>;
  revealPath(path: string): Promise<void>;
  encrypt(params: EncryptParams): Promise<EncryptOutcome>;
  decrypt(params: DecryptParams): Promise<DecryptOutcome>;
  cancel(): Promise<void>;
  onProgress(cb: (e: ProgressEvent) => void): () => void;
}

declare global {
  interface Window {
    handshack: HandshackBridge;
  }
}
