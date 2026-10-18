import type { PackageManifest, ProgressCallback } from '@handshack/core';
import { createContext, useContext } from 'react';

export type PlatformKind = 'web' | 'desktop';

/**
 * Opaque handle to a user-selected file.
 * Web: the `File` object itself. Desktop: an absolute path string.
 */
export interface SelectedFileRef {
  handle: unknown;
  name: string;
  size: number;
}

export interface EncryptJob {
  input: SelectedFileRef;
  password: string;
  chunkSize: number;
  outputDir?: string;
  overwrite?: boolean;
}

export interface DecryptJob {
  manifest: SelectedFileRef;
  parts: SelectedFileRef[];
  password: string;
  savePath?: string;
  overwrite?: boolean;
}

export type Delivery =
  | { kind: 'downloads'; manifestName: string; manifestBlob: Blob; parts: { name: string; blob: Blob }[] }
  | { kind: 'files'; directory: string; files: string[] };

export type RestoredDelivery =
  | { kind: 'download'; blob: Blob }
  | { kind: 'file'; path: string };

export interface EncryptResult {
  manifestName: string;
  manifestText: string;
  partNames: string[];
  partCount: number;
  packageId: string;
  originalName: string;
  originalSize: number;
  encryptedSize: number;
  chunkSize: number;
  delivery: Delivery;
}

export interface DecryptResult {
  fileName: string;
  size: number;
  sha256Hex: string;
  packageId: string;
  delivery: RestoredDelivery;
}

/** Result of inspecting user-selected package files before decryption. */
export interface PackageInspection {
  manifest: PackageManifest;
  manifestFile: SelectedFileRef;
  /** Parts found so far, in manifest order. */
  matchedParts: SelectedFileRef[];
  /** Manifest part names not yet provided. */
  missing: string[];
  /** Selected file names that are not part of this package. */
  unexpected: string[];
}

export interface PlatformCapabilities {
  /** Native directory picker (desktop) vs. downloads (web). */
  directoryOutput: boolean;
  /** File System Access API save picker (some browsers + desktop). */
  saveWithPicker: boolean;
  /** ZIP download convenience (web). */
  zipDownload: boolean;
  /** "Reveal in folder" affordance (desktop). */
  revealInFolder: boolean;
}

/** Published-release data for the landing page's download section (web only). */
export interface ReleaseInfo {
  /** Latest published version, or null when no release exists yet. */
  latestVersion: string | null;
  publishedAt?: string;
  installerUrl?: string;
  installerSha256?: string;
  portableUrl?: string;
  portableSha256?: string;
  notesUrl?: string;
  /** Public source repository URL, or null until published. */
  repoUrl: string | null;
}

export interface PlatformServices {
  readonly platform: PlatformKind;
  readonly version: string;
  readonly capabilities: PlatformCapabilities;
  readonly release?: ReleaseInfo;

  /** Open the platform file picker. `multiple` for package files. */
  selectFiles(opts: {
    multiple: boolean;
    purpose: 'input' | 'package';
  }): Promise<SelectedFileRef[] | null>;

  /**
   * Given all user-selected package files, find + validate the manifest and
   * match parts. Throws HandshackError with a user-friendly message.
   */
  inspectPackage(files: SelectedFileRef[]): Promise<PackageInspection>;

  /** Desktop: choose an output directory. Returns null on cancel. */
  chooseOutputDirectory?(): Promise<string | null>;
  /** Desktop: choose a save path. Returns null on cancel. */
  chooseSavePath?(suggestedName: string): Promise<string | null>;
  /** Desktop: list existing files in `dir` matching `${base}.part*.hsp` or the manifest name. */
  findCollisions?(dir: string, baseName: string): Promise<string[]>;
  /** Desktop: does this path already exist? */
  pathExists?(p: string): Promise<boolean>;
  /** Desktop: open the folder containing `p` in the OS file manager. */
  revealPath?(p: string): Promise<void>;

  encrypt(job: EncryptJob, onProgress: ProgressCallback, signal: AbortSignal): Promise<EncryptResult>;
  decrypt(job: DecryptJob, onProgress: ProgressCallback, signal: AbortSignal): Promise<DecryptResult>;

  /** Web: save a blob (File System Access picker when available, else download). */
  saveBlob?(name: string, blob: Blob): Promise<void>;
  /** Web: build + save a ZIP of the full package. */
  downloadZip?(manifestName: string, manifestText: string, parts: { name: string; blob: Blob }[]): Promise<void>;
  /** Web: trigger individual downloads for the manifest + all parts. */
  downloadParts?(manifestName: string, manifestBlob: Blob, parts: { name: string; blob: Blob }[]): Promise<void>;
}

const PlatformContext = createContext<PlatformServices | null>(null);

export const PlatformProvider = PlatformContext.Provider;

export function usePlatform(): PlatformServices {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('PlatformServices not provided');
  return ctx;
}
