/** Message protocol between the page and the crypto worker. */

export type WorkerRequest =
  | {
      kind: 'encrypt';
      jobId: number;
      file: File;
      password: string;
      chunkSize: number;
    }
  | {
      kind: 'decrypt';
      jobId: number;
      manifestFile: File;
      partFiles: File[];
      password: string;
    };

export type WorkerResponse =
  | { kind: 'progress'; jobId: number; phase: string; done: number; total: number }
  | {
      kind: 'encrypt-result';
      jobId: number;
      manifestName: string;
      manifestText: string;
      parts: { name: string; blob: Blob }[];
      packageId: string;
      originalName: string;
      originalSize: number;
      encryptedSize: number;
      chunkSize: number;
    }
  | {
      kind: 'decrypt-result';
      jobId: number;
      blob: Blob;
      fileName: string;
      size: number;
      sha256Hex: string;
      packageId: string;
    }
  | { kind: 'error'; jobId: number; code: string; message: string };
