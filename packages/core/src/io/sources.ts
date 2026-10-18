import { HandshackError } from '../errors.js';
import type { ByteSource, NamedSource } from '../types.js';

/** In-memory byte source (tests, small buffers). */
export class MemoryByteSource implements ByteSource {
  constructor(
    readonly data: Uint8Array,
    readonly name = 'memory',
  ) {}
  get size(): number {
    return this.data.length;
  }
  read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.data.length) {
      throw new HandshackError('io-error', `read out of bounds (${offset}+${length} of ${this.data.length})`);
    }
    // Return a copy — callers may zero buffers after use (plaintext hygiene).
    return Promise.resolve(this.data.slice(offset, offset + length));
  }
}

/** Browser File/Blob-backed source — reads are disk-backed, never whole-file loads. */
export class BlobByteSource implements ByteSource {
  constructor(
    readonly blob: Blob,
    readonly name = 'blob',
  ) {}
  get size(): number {
    return this.blob.size;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.blob.size) {
      throw new HandshackError('io-error', `read out of bounds on ${this.name}`);
    }
    const buf = await this.blob.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(buf);
  }
}

/**
 * Sequential reader that presents an ordered list of sources as one contiguous
 * byte stream. Reads exactly across part boundaries; never buffers whole parts.
 */
export class SequentialReader {
  private readonly sources: ByteSource[];
  private readonly offsets: number[] = [];
  private pos = 0;
  private srcIdx = 0;
  readonly size: number;

  constructor(sources: ByteSource[]) {
    this.sources = sources;
    let off = 0;
    for (const s of sources) {
      this.offsets.push(off);
      off += s.size;
    }
    this.size = off;
  }

  static fromNamed(named: NamedSource[]): { reader: SequentialReader; order: string[] } {
    return {
      reader: new SequentialReader(named.map((n) => n.source)),
      order: named.map((n) => n.name),
    };
  }

  get position(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.size - this.pos;
  }

  /** Read exactly `n` bytes; throws 'truncated-package' when the stream is short. */
  async read(n: number): Promise<Uint8Array> {
    if (n < 0) throw new HandshackError('internal-error', 'negative read');
    if (this.pos + n > this.size) {
      throw new HandshackError(
        'truncated-package',
        `needed ${n} bytes at ${this.pos}, only ${this.remaining} remain`,
      );
    }
    const out = new Uint8Array(n);
    let written = 0;
    while (written < n) {
      // advance to the source containing the cursor
      while (
        this.srcIdx < this.sources.length - 1 &&
        this.pos >= this.offsets[this.srcIdx]! + this.sources[this.srcIdx]!.size
      ) {
        this.srcIdx++;
      }
      const src = this.sources[this.srcIdx]!;
      const srcStart = this.offsets[this.srcIdx]!;
      const local = this.pos - srcStart;
      const want = Math.min(n - written, src.size - local);
      const chunk = await src.read(local, want);
      if (chunk.length !== want) {
        throw new HandshackError('truncated-package', `short read from ${src.constructor.name}`);
      }
      out.set(chunk, written);
      written += want;
      this.pos += want;
    }
    return out;
  }
}
