import { vi } from 'vitest';
import type { PackageManifest, ProgressCallback } from '@handshack/core';
import type { PlatformServices, SelectedFileRef } from '../src/platform.js';

export function fileRef(name: string, size = 1024): SelectedFileRef {
  return { handle: { name }, name, size };
}

export function sampleManifest(partCount = 3): PackageManifest {
  return {
    format: 'handshack-package',
    formatVersion: 1,
    packageId: 'hs_testpackageid1234567',
    createdAt: '2026-01-01T00:00:00.000Z',
    generator: 'handshack-test',
    originalName: 'photo.jpg',
    originalSize: 3_000_000,
    encryptedSize: 3_200_000,
    chunkSize: 1024 * 1024,
    partCount,
    algorithm: 'AES-256-GCM',
    kdf: 'scrypt',
    kdfParams: { n: 32768, r: 8, p: 1, dkLen: 32 },
    salt: 'AAAAAAAAAAAAAAAAAAAAAA',
    parts: Array.from({ length: partCount }, (_, i) => ({
      name: `photo.jpg.part${String(i + 1).padStart(3, '0')}.hsp`,
      size: i === partCount - 1 ? 800_000 : 1024 * 1024,
      sha256: 'a'.repeat(64),
    })),
  };
}

export function makePlatform(overrides: Partial<PlatformServices> = {}): PlatformServices {
  return {
    platform: 'web',
    version: '0.1.0-test',
    capabilities: {
      directoryOutput: false,
      saveWithPicker: false,
      zipDownload: true,
      revealInFolder: false,
    },
    release: { latestVersion: null, repoUrl: null },
    selectFiles: vi.fn(async () => [fileRef('photo.jpg')]),
    inspectPackage: vi.fn(async (files: SelectedFileRef[]) => ({
      manifest: sampleManifest(files.length),
      manifestFile: fileRef('photo.jpg.hsmanifest.json', 800),
      matchedParts: files.filter((f) => f.name.endsWith('.hsp')),
      missing: [] as string[],
      unexpected: [] as string[],
    })),
    encrypt: vi.fn(async (_j, onProgress: ProgressCallback) => {
      onProgress({ phase: 'encrypting', done: 5, total: 10 });
      onProgress({ phase: 'completed', done: 10, total: 10 });
      return {
        manifestName: 'photo.jpg.hsmanifest.json',
        manifestText: '{}',
        partNames: ['photo.jpg.part001.hsp'],
        partCount: 1,
        packageId: 'hs_abc',
        originalName: 'photo.jpg',
        originalSize: 1024,
        encryptedSize: 1500,
        chunkSize: 4194304,
        delivery: {
          kind: 'downloads' as const,
          manifestName: 'photo.jpg.hsmanifest.json',
          manifestBlob: new Blob(['{}']),
          parts: [{ name: 'photo.jpg.part001.hsp', blob: new Blob([new Uint8Array(10)]) }],
        },
      };
    }),
    decrypt: vi.fn(async () => ({
      fileName: 'photo.jpg',
      size: 1024,
      sha256Hex: 'b'.repeat(64),
      packageId: 'hs_abc',
      delivery: { kind: 'download' as const, blob: new Blob([new Uint8Array(10)]) },
    })),
    saveBlob: vi.fn(async () => undefined),
    downloadZip: vi.fn(async () => undefined),
    downloadParts: vi.fn(async () => undefined),
    ...overrides,
  };
}
