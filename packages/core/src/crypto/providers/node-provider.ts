import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes as nodeRandomBytes,
  scrypt as nodeScrypt,
} from 'node:crypto';
import { concatBytes } from '../../encoding.js';
import { HandshackError } from '../../errors.js';
import type { CryptoProvider, IncrementalHash, ScryptParams } from '../../types.js';

/**
 * CryptoProvider backed by Node.js `node:crypto` (Electron main process, CLI,
 * tests). Uses OpenSSL's AES-256-GCM and RFC-7914 scrypt implementation.
 * Produces bit-identical results to WebCryptoProvider — verified by the
 * cross-platform test suite.
 */
export class NodeCryptoProvider implements CryptoProvider {
  readonly name = 'node-crypto';

  randomBytes(length: number): Uint8Array {
    return new Uint8Array(nodeRandomBytes(length));
  }

  deriveKey(password: Uint8Array, salt: Uint8Array, params: ScryptParams): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      // 128*N*r*p is capped upstream by validateKdfParams; give scrypt enough room.
      const maxmem = Math.max(64 * 1024 * 1024, 128 * params.n * params.r * params.p * 2);
      nodeScrypt(
        password,
        salt,
        params.dkLen,
        { N: params.n, r: params.r, p: params.p, maxmem },
        (err, key) => {
          if (err) reject(new HandshackError('internal-error', `scrypt failed: ${err.name}`));
          else resolve(new Uint8Array(key));
        },
      );
    });
  }

  aesGcmEncrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array> {
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad, { plaintextLength: plaintext.length });
    const ct = concatBytes(cipher.update(plaintext), cipher.final(), cipher.getAuthTag());
    return Promise.resolve(ct);
  }

  aesGcmDecrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array> {
    if (ciphertext.length < 16) {
      return Promise.reject(new HandshackError('truncated-package', 'record shorter than GCM tag'));
    }
    const ct = ciphertext.subarray(0, ciphertext.length - 16);
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(aad, { plaintextLength: ct.length });
    decipher.setAuthTag(tag);
    try {
      const pt = concatBytes(decipher.update(ct), decipher.final());
      return Promise.resolve(pt);
    } catch {
      return Promise.reject(new HandshackError('authentication-failed', 'AES-GCM authentication failed'));
    }
  }

  sha256(data: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(createHash('sha256').update(data).digest()));
  }

  createSha256(): IncrementalHash {
    const hash = createHash('sha256');
    return {
      update(d: Uint8Array) {
        hash.update(d);
      },
      digest() {
        return Promise.resolve(new Uint8Array(hash.digest()));
      },
    };
  }
}
