/** Byte/encoding helpers shared by both platforms. */
import { HandshackError } from './errors.js';

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_REVERSE = new Map([...B64_ALPHABET].map((c, i) => [c, i]));

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET[(n >> 18) & 63]! + B64_ALPHABET[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += B64_ALPHABET[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += B64_ALPHABET[n & 63]!;
  }
  return out;
}

export function base64UrlToBytes(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new HandshackError('invalid-package', 'invalid base64url input');
  const len = text.length;
  if (len % 4 === 1) throw new HandshackError('invalid-package', 'invalid base64url length');
  const byteLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(byteLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64_REVERSE.get(text[i]!) ?? 0;
    const c1 = B64_REVERSE.get(text[i + 1] ?? 'A') ?? 0;
    const c2 = B64_REVERSE.get(text[i + 2] ?? 'A') ?? 0;
    const c3 = B64_REVERSE.get(text[i + 3] ?? 'A') ?? 0;
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < byteLen) out[o++] = (n >> 16) & 0xff;
    if (o < byteLen) out[o++] = (n >> 8) & 0xff;
    if (o < byteLen) out[o++] = n & 0xff;
  }
  if (bytesToBase64Url(out) !== text) {
    throw new HandshackError('invalid-package', 'non-canonical base64url input');
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) throw new Error('invalid hex input');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8ToBytes(text: string): Uint8Array {
  return textEncoder.encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

export function u64be(value: number): Uint8Array {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, Math.floor(value / 2 ** 32));
  dv.setUint32(4, value >>> 0);
  return out;
}

export function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

export function readU32be(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

/** Constant-time equality for short byte strings. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
