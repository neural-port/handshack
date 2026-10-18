/**
 * HandShack crypto worker — runs the shared pipeline with the WebCrypto
 * provider inside a Web Worker so large-file processing never blocks the UI.
 *
 * Secrets: the password arrives once via postMessage (unavoidable for worker
 * isolation) and key material is zeroed by the pipeline after use. Nothing is
 * logged.
 */
import {
  BlobByteSink,
  BlobByteSource,
  decryptPackage,
  encryptFile,
  parseManifestBytes,
  toHandshackError,
  WebCryptoProvider,
  type ProgressEvent,
} from '@handshack/core';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

const provider = new WebCryptoProvider();

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function progress(jobId: number) {
  return (e: ProgressEvent) => post({ kind: 'progress', jobId, phase: e.phase, done: e.done, total: e.total });
}

async function handleEncrypt(req: Extract<WorkerRequest, { kind: 'encrypt' }>) {
  const partBlobs: { name: string; blob: Blob }[] = [];

  const result = await encryptFile({
    source: new BlobByteSource(req.file, req.file.name),
    fileName: req.file.name,
    password: req.password,
    chunkSize: req.chunkSize,
    provider,
    onProgress: progress(req.jobId),
    generator: 'handshack-web',
    openPartSink: (_i, name) => {
      const sink = new BlobByteSink();
      return Promise.resolve({
        write: (d: Uint8Array) => sink.write(d),
        close: async () => {
          await sink.close();
          partBlobs.push({ name, blob: sink.toBlob() });
        },
        abort: () => sink.abort(),
      });
    },
  });

  post({
    kind: 'encrypt-result',
    jobId: req.jobId,
    manifestName: result.manifestFileName,
    manifestText: result.manifestText,
    parts: partBlobs,
    packageId: result.packageId,
    originalName: result.originalName,
    originalSize: result.originalSize,
    encryptedSize: result.encryptedSize,
    chunkSize: result.chunkSize,
  });
}

async function handleDecrypt(req: Extract<WorkerRequest, { kind: 'decrypt' }>) {
  const manifestBytes = new Uint8Array(await req.manifestFile.arrayBuffer());
  const manifest = parseManifestBytes(manifestBytes);
  const parts = req.partFiles.map((f) => ({ name: f.name, source: new BlobByteSource(f, f.name) }));

  const sink = new BlobByteSink();
  const result = await decryptPackage({
    manifest,
    parts,
    password: req.password,
    provider,
    onProgress: progress(req.jobId),
    openOutput: () => Promise.resolve(sink),
  });

  post({
    kind: 'decrypt-result',
    jobId: req.jobId,
    blob: sink.toBlob(),
    fileName: result.fileName,
    size: result.size,
    sha256Hex: result.sha256Hex,
    packageId: result.packageId,
  });
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  void (async () => {
    try {
      if (req.kind === 'encrypt') await handleEncrypt(req);
      else await handleDecrypt(req);
    } catch (err) {
      const e = toHandshackError(err);
      post({ kind: 'error', jobId: req.jobId, code: e.code, message: e.userMessage });
    }
  })();
};
