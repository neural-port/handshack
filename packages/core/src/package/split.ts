import { bytesToHex } from '../encoding.js';
import { HandshackError } from '../errors.js';
import { MAX_PART_COUNT } from '../constants.js';
import type { ByteSink, IncrementalHash, ManifestPart } from '../types.js';

export interface PartPlan {
  /** Part file name, e.g. `photo.jpg.part001.hsp`. */
  name: string;
  /** Exact byte size this part must receive. */
  size: number;
}

export type PartSinkFactory = (index: number, plan: PartPlan) => Promise<ByteSink>;
export type HasherFactory = () => IncrementalHash;

/**
 * Routes one contiguous encrypted-package byte stream into fixed-size part
 * sinks, hashing each part on the fly. The caller writes bytes in any chunking;
 * the router splits them at the planned part boundaries so every byte lands in
 * exactly one part and parts are emitted in deterministic order.
 */
export class PartRouter {
  private current: ByteSink | null = null;
  private currentHasher: IncrementalHash | null = null;
  private idx = -1;
  private writtenInPart = 0;
  private done: ManifestPart[] = [];
  private closed = false;

  constructor(
    private readonly plans: PartPlan[],
    private readonly openSink: PartSinkFactory,
    private readonly createHasher: HasherFactory,
  ) {}

  private async beginPart(i: number): Promise<void> {
    const plan = this.plans[i]!;
    this.current = await this.openSink(i, plan);
    this.currentHasher = this.createHasher();
    this.idx = i;
    this.writtenInPart = 0;
  }

  private async endPart(): Promise<void> {
    const plan = this.plans[this.idx]!;
    if (this.writtenInPart !== plan.size) {
      throw new HandshackError(
        'internal-error',
        `part ${plan.name} received ${this.writtenInPart} bytes, expected ${plan.size}`,
      );
    }
    await this.current!.close();
    const digest = bytesToHex(await this.currentHasher!.digest());
    this.done.push({ name: plan.name, size: plan.size, sha256: digest });
    this.current = null;
    this.currentHasher = null;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw new HandshackError('internal-error', 'write after finish');
    let off = 0;
    while (off < data.length) {
      if (this.current === null) {
        if (this.idx + 1 >= this.plans.length) {
          throw new HandshackError('internal-error', 'more bytes than planned parts can hold');
        }
        await this.beginPart(this.idx + 1);
      }
      const remaining = this.plans[this.idx]!.size - this.writtenInPart;
      const n = Math.min(remaining, data.length - off);
      const slice = data.subarray(off, off + n);
      const sink = this.current;
      const hasher = this.currentHasher;
      if (!sink || !hasher) throw new HandshackError('internal-error', 'part router lost sink');
      await sink.write(slice);
      hasher.update(slice);
      this.writtenInPart += n;
      off += n;
      if (this.writtenInPart === this.plans[this.idx]!.size) {
        await this.endPart();
      }
    }
  }

  /** Close the final part and return completed manifest entries. */
  async finish(): Promise<ManifestPart[]> {
    if (this.current !== null) await this.endPart();
    this.closed = true;
    if (this.done.length !== this.plans.length) {
      throw new HandshackError(
        'internal-error',
        `wrote ${this.done.length} of ${this.plans.length} planned parts`,
      );
    }
    return this.done;
  }

  /** Abort all in-flight output (cancellation/failure cleanup). */
  async abort(): Promise<void> {
    this.closed = true;
    if (this.current) await this.current.abort().catch(() => undefined);
    this.current = null;
  }
}

/** Compute the deterministic part plan for a given package byte length. */
export function planParts(baseName: string, totalSize: number, chunkSize: number): PartPlan[] {
  const count = Math.max(1, Math.ceil(totalSize / chunkSize));
  if (count > MAX_PART_COUNT) {
    throw new HandshackError(
      'too-many-parts',
      `package requires ${count} parts (limit ${MAX_PART_COUNT})`,
      `This package would require more than ${MAX_PART_COUNT} parts. Choose a larger part size.`,
    );
  }
  const plans: PartPlan[] = [];
  for (let i = 0; i < count; i++) {
    const size = Math.min(chunkSize, totalSize - i * chunkSize);
    plans.push({ name: `${baseName}.part${String(i + 1).padStart(3, '0')}.hsp`, size });
  }
  return plans;
}
