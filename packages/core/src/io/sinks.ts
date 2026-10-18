import type { ByteSink } from '../types.js';

/** Collects output into memory. Use for tests and bounded-size outputs. */
export class MemoryByteSink implements ByteSink {
  private chunks: Uint8Array[] = [];
  private len = 0;
  aborted = false;

  write(data: Uint8Array): Promise<void> {
    this.chunks.push(data.slice()); // copy — callers may wipe plaintext buffers
    this.len += data.length;
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  abort(): Promise<void> {
    this.aborted = true;
    this.chunks = [];
    this.len = 0;
    return Promise.resolve();
  }
  get size(): number {
    return this.len;
  }
  toBytes(): Uint8Array {
    const out = new Uint8Array(this.len);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

/**
 * Collects output into a browser Blob without holding the whole file in one
 * contiguous ArrayBuffer — parts are Blob-backed (often disk-paged).
 */
export class BlobByteSink implements ByteSink {
  private parts: BlobPart[] = [];
  private len = 0;
  aborted = false;

  write(data: Uint8Array): Promise<void> {
    this.parts.push(data.slice()); // defensive copy — data may be a reused view
    this.len += data.length;
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  abort(): Promise<void> {
    this.aborted = true;
    this.parts = [];
    this.len = 0;
    return Promise.resolve();
  }
  get size(): number {
    return this.len;
  }
  toBlob(type = 'application/octet-stream'): Blob {
    return new Blob(this.parts, { type });
  }
}
