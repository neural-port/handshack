import { describe, expect, it } from 'vitest';
import {
  base64UrlToBytes,
  HandshackError,
  bytesEqual,
  bytesToBase64Url,
  bytesToHex,
  concatBytes,
  hexToBytes,
  u32be,
  u64be,
  utf8ToBytes,
  readU32be,
} from '../src/index.js';
import { deterministicBytes } from './helpers.js';

describe('encoding', () => {
  it('base64url round-trips arbitrary bytes', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 16, 18, 255, 1024]) {
      const data = deterministicBytes(len, len + 1);
      const enc = bytesToBase64Url(data);
      expect(enc).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64UrlToBytes(enc)).toEqual(data);
    }
  });

  it('hex round-trips', () => {
    const data = deterministicBytes(64, 7);
    expect(hexToBytes(bytesToHex(data))).toEqual(data);
  });

  it('hex rejects invalid input', () => {
    expect(() => hexToBytes('zz')).toThrow();
    expect(() => hexToBytes('abc')).toThrow(); // odd length
  });

  it('concatBytes preserves order', () => {
    const a = Uint8Array.of(1, 2);
    const b = Uint8Array.of(3);
    const c = Uint8Array.of(4, 5, 6);
    expect(concatBytes(a, b, c)).toEqual(Uint8Array.of(1, 2, 3, 4, 5, 6));
  });

  it('u32be/u64be encode big-endian', () => {
    expect([...u32be(0x01020304)]).toEqual([1, 2, 3, 4]);
    expect(readU32be(u32be(0xdeadbeef), 0)).toBe(0xdeadbeef);
    expect([...u64be(1)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(u64be(2 ** 32 - 1)).toEqual(Uint8Array.of(0, 0, 0, 0, 255, 255, 255, 255));
    expect(u64be(2 ** 32)).toEqual(Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 0));
  });

  it('bytesEqual is strict', () => {
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(bytesEqual(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
  });

  it('utf8 handles unicode', () => {
    const s = 'héllo—世界—🔐';
    expect(utf8ToBytes(s).length).toBeGreaterThan(s.length);
  });

  it('base64url rejects non-alphabet input with a HandShack error', () => {
    expect(() => base64UrlToBytes('ab+/')).toThrowError(HandshackError);
    expect(() => base64UrlToBytes('ab+/')).toThrowError(/invalid base64url/);
  });
});
