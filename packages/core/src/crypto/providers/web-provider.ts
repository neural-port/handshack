import { hexToBytes } from '../../encoding.js';
import { HandshackError } from '../../errors.js';
import type { CryptoProvider, IncrementalHash, ScryptParams } from '../../types.js';
import type * as HashWasm from 'hash-wasm';

// hash-wasm is loaded lazily: it is only needed on platforms without native
// scrypt/SHA-256 (browsers). Keeping it dynamic means the desktop main
// process — which uses NodeCryptoProvider — never resolves the WASM payload.
let hashWasmPromise: Promise<typeof HashWasm> | null = null;
function hashWasm(): Promise<typeof HashWasm> {
  return (hashWasmPromise ??= import('hash-wasm'));
}

/**
 * CryptoProvider backed by the Web Crypto API (AES-GCM + SHA-256) and
 * hash-wasm's audited WASM scrypt (RFC 7914). Runs in browsers, Web Workers,
 * and Node (which exposes globalThis.crypto.subtle since v20).
 *
 * Produces bit-identical results to NodeCryptoProvider — verified by the
 * cross-platform test suite.
 */
export class WebCryptoProvider implements CryptoProvider {
  readonly name = 'webcrypto';
  private readonly subtle: SubtleCrypto;

  constructor(subtle?: SubtleCrypto) {
    const s = subtle ?? globalThis.crypto?.subtle;
    if (!s) throw new HandshackError('internal-error', 'Web Crypto API unavailable in this environment');
    this.subtle = s;
  }

  randomBytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    globalThis.crypto.getRandomValues(out);
    return out;
  }

  async deriveKey(password: Uint8Array, salt: Uint8Array, params: ScryptParams): Promise<Uint8Array> {
    const { scrypt } = await hashWasm();
    const hex = await scrypt({
      password,
      salt,
      costFactor: params.n,
      blockSize: params.r,
      parallelism: params.p,
      hashLength: params.dkLen,
    });
    return hexToBytes(hex);
  }

  async aesGcmEncrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array> {
    const k = await this.subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, [
      'encrypt',
    ]);
    const ct = await this.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
      k,
      plaintext as BufferSource,
    );
    return new Uint8Array(ct); // ciphertext || tag, as Web Crypto returns
  }

  async aesGcmDecrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array> {
    const k = await this.subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);
    try {
      const pt = await this.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
        k,
        ciphertext as BufferSource,
      );
      return new Uint8Array(pt);
    } catch {
      throw new HandshackError('authentication-failed', 'AES-GCM authentication failed');
    }
  }

  async sha256(data: Uint8Array): Promise<Uint8Array> {
    const digest = await this.subtle.digest('SHA-256', data as BufferSource);
    return new Uint8Array(digest);
  }

  createSha256(): IncrementalHash {
    // hash-wasm's WASM SHA-256 streams incrementally and matches OpenSSL output.
    const hasherPromise = hashWasm().then((m) => m.createSHA256());
    const queue: Uint8Array[] = [];
    let hasher: Awaited<ReturnType<typeof HashWasm.createSHA256>> | null = null;
    void hasherPromise.then((h) => {
      hasher = h;
      for (const d of queue) h.update(d);
      queue.length = 0;
    });
    return {
      update(d: Uint8Array) {
        if (hasher) hasher.update(d);
        else queue.push(d);
      },
      async digest() {
        const h = hasher ?? (await hasherPromise);
        return hexToBytes(h.digest());
      },
    };
  }
}
