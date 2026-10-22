import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHUNK_SIZE,
  HandshackError,
  MAX_INPUT_FILE_SIZE,
  MemoryByteSource,
  isVideoFileName,
  readVideoDimensions,
  validateInputFileSize,
  validateVideoInput,
} from '../src/index.js';
import { NodeCryptoProvider } from '../src/node.js';
import { encryptInMemory, PASSWORD } from './helpers.js';

/* ---------- synthetic containers ---------- */

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function beBytes(value: number, width: number): Uint8Array {
  const out = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) {
    out[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return out;
}

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)));
}

/** ISO base media box: u32 size + 4-byte type + payload. */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([beBytes(8 + body.length, 4), ascii(type), body]);
}

/** Minimal MP4 with a single video track at the given display size. */
function mp4(width: number, height: number): Uint8Array {
  const ftyp = box('ftyp', ascii('isom'), beBytes(512, 4), ascii('isom'));
  const mdat = box('mdat', new Uint8Array(16));

  // tkhd v0: version+flags, 5 x u32, reserved 8, layer/alt/vol/res 8, matrix 36, w/h 16.16
  const tkhd = concat([
    new Uint8Array(4),
    new Uint8Array(20),
    new Uint8Array(8),
    new Uint8Array(8),
    new Uint8Array(36),
    beBytes(width * 65536, 4),
    beBytes(height * 65536, 4),
  ]);
  const trak = box('trak', box('tkhd', tkhd));
  const moov = box('moov', trak);

  return concat([ftyp, mdat, moov]);
}

/** EBML element ID (already includes its length marker bits). */
function ebmlElement(id: number[], payload: Uint8Array): Uint8Array {
  const idBytes = new Uint8Array(id);
  const size = payload.length;
  let sizeBytes: Uint8Array;
  if (size < 0x7f) sizeBytes = new Uint8Array([0x80 | size]);
  else if (size < 0x3fff) sizeBytes = beBytes(0x4000 | size, 2);
  else sizeBytes = beBytes(0x200000 | size, 3);
  return concat([idBytes, sizeBytes, payload]);
}

const EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT = [0x18, 0x53, 0x80, 0x67];
const TRACKS = [0x16, 0x54, 0xae, 0x6b];
const TRACK_ENTRY = [0xae];
const TRACK_TYPE = [0x83];
const VIDEO = [0xe0];
const PIXEL_WIDTH = [0xb0];
const PIXEL_HEIGHT = [0xba];

/** Minimal Matroska file with one video track at the given size. */
function mkv(width: number, height: number): Uint8Array {
  const header = ebmlElement(EBML_HEADER, new Uint8Array(0));
  const video = ebmlElement(
    VIDEO,
    concat([ebmlElement(PIXEL_WIDTH, beBytes(width, 2)), ebmlElement(PIXEL_HEIGHT, beBytes(height, 2))]),
  );
  const entry = ebmlElement(TRACK_ENTRY, concat([ebmlElement(TRACK_TYPE, new Uint8Array([1])), video]));
  const tracks = ebmlElement(TRACKS, entry);
  return concat([header, ebmlElement(SEGMENT, tracks)]);
}

function source(bytes: Uint8Array, name: string): MemoryByteSource {
  return new MemoryByteSource(bytes, name);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(HandshackError);
  await promise.catch((err: HandshackError) => expect(err.code).toBe(code));
}

/* ---------- tests ---------- */

describe('video file detection', () => {
  it('recognises common video extensions case-insensitively', () => {
    expect(isVideoFileName('clip.MP4')).toBe(true);
    expect(isVideoFileName('a/b/movie.mkv')).toBe(true);
    expect(isVideoFileName('photo.jpg')).toBe(false);
    expect(isVideoFileName('report')).toBe(false);
  });
});

describe('video dimensions', () => {
  it('reads MP4 dimensions', async () => {
    await expect(readVideoDimensions(source(mp4(1280, 720), 'a.mp4'))).resolves.toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('reads Matroska dimensions', async () => {
    await expect(readVideoDimensions(source(mkv(640, 480), 'a.mkv'))).resolves.toEqual({
      width: 640,
      height: 480,
    });
  });

  it('returns null for an unsupported container', async () => {
    await expect(readVideoDimensions(source(new Uint8Array(64), 'a.avi'))).resolves.toBeNull();
  });
});

describe('1080p rule', () => {
  it('accepts a 720p landscape video', async () => {
    await expect(validateVideoInput('a.mp4', source(mp4(1280, 720), 'a.mp4'))).resolves.toBeUndefined();
  });

  it('accepts a 1080p landscape video', async () => {
    await expect(validateVideoInput('a.mp4', source(mp4(1920, 1080), 'a.mp4'))).resolves.toBeUndefined();
  });

  it('accepts a 720p portrait video', async () => {
    await expect(validateVideoInput('a.mp4', source(mp4(720, 1280), 'a.mp4'))).resolves.toBeUndefined();
  });

  it('accepts a 1080p portrait video', async () => {
    await expect(validateVideoInput('a.mp4', source(mp4(1080, 1920), 'a.mp4'))).resolves.toBeUndefined();
  });

  it('rejects 1440p', async () => {
    await expectCode(validateVideoInput('a.mp4', source(mp4(2560, 1440), 'a.mp4')), 'video-resolution-too-high');
  });

  it('rejects 4K Matroska', async () => {
    await expectCode(validateVideoInput('a.mkv', source(mkv(3840, 2160), 'a.mkv')), 'video-resolution-too-high');
  });

  it('rejects a video container it cannot parse', async () => {
    await expectCode(validateVideoInput('a.avi', source(new Uint8Array(64), 'a.avi')), 'video-unreadable');
  });

  it('leaves non-video files alone', async () => {
    await expect(validateVideoInput('a.pdf', source(new Uint8Array(8), 'a.pdf'))).resolves.toBeUndefined();
  });

  it('is enforced by the encryption pipeline', async () => {
    const provider = new NodeCryptoProvider();
    await expectCode(
      encryptInMemory(mp4(2560, 1440), 'movie.mp4', PASSWORD, DEFAULT_CHUNK_SIZE, provider),
      'video-resolution-too-high',
    );
  });

  it('encrypts a 1080p video end to end', async () => {
    const provider = new NodeCryptoProvider();
    const pkg = await encryptInMemory(mp4(1920, 1080), 'movie.mp4', PASSWORD, DEFAULT_CHUNK_SIZE, provider);
    expect(pkg.manifest.originalSize).toBe(mp4(1920, 1080).length);
  });
});

describe('input size ceiling', () => {
  it('accepts a file exactly at the cap', () => {
    expect(() => validateInputFileSize(MAX_INPUT_FILE_SIZE)).not.toThrow();
  });

  it('rejects a file one byte over the cap', () => {
    expect(() => validateInputFileSize(MAX_INPUT_FILE_SIZE + 1)).toThrowError(HandshackError);
  });
});
