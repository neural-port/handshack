import { describe, expect, it } from 'vitest';
import {
  HandshackError,
  isManifestFileName,
  isPartFileName,
  makePartName,
  partIndexFromName,
  sanitizeFileName,
  safeFileName,
  validateChunkSize,
  validateInputFileSize,
  validateKdfParams,
  validateManifest,
  type ScryptParams,
  KDF_DEFAULTS,
  MAX_FILE_SIZE,
  DEFAULT_CHUNK_SIZE,
} from '../src/index.js';
import { cloneManifest, deterministicBytes, encryptInMemory, PASSWORD } from './helpers.js';
import { NodeCryptoProvider } from '../src/node.js';

const provider = new NodeCryptoProvider();

describe('sanitizeFileName', () => {
  it('keeps ordinary names', () => {
    expect(sanitizeFileName('photo.jpg')).toBe('photo.jpg');
    expect(sanitizeFileName('my file (2).pdf')).toBe('my file (2).pdf');
    expect(sanitizeFileName('résumé-éè.pdf')).toBe('résumé-éè.pdf');
  });

  it('strips path separators and traversal', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizeFileName('..\\..\\win\\sys.dll')).toBe('win_sys.dll');
    expect(sanitizeFileName('a/b/c.txt')).toBe('a_b_c.txt');
    expect(sanitizeFileName('C:\\Users\\x\\secret.txt')).toBe('C__Users_x_secret.txt');
  });

  it('strips leading dots and control chars', () => {
    expect(sanitizeFileName('...hidden')).toBe('hidden');
    expect(sanitizeFileName('a\tb\nc.txt')).toBe('a b c.txt');
  });

  it('rejects unusable names', () => {
    expect(() => sanitizeFileName('')).toThrow(HandshackError);
    expect(() => sanitizeFileName('...')).toThrow(HandshackError);
    expect(() => sanitizeFileName('///')).toThrow(HandshackError);
  });

  it('renames Windows reserved device names', () => {
    expect(sanitizeFileName('CON.txt')).toBe('file-CON.txt');
    expect(sanitizeFileName('nul')).toBe('file-nul');
    expect(sanitizeFileName('LPT3.png')).toBe('file-LPT3.png');
  });

  it('truncates over-long names', () => {
    const long = `${'x'.repeat(200)}.jpg`;
    const out = sanitizeFileName(long);
    expect(out.length).toBeLessThanOrEqual(128);
  });

  it('safeFileName falls back instead of throwing', () => {
    expect(safeFileName('???')).toBe('restored-file');
    expect(safeFileName(42)).toBe('restored-file');
    expect(safeFileName('ok.txt')).toBe('ok.txt');
  });
});

describe('part names', () => {
  it('round-trips index through names', () => {
    expect(makePartName('photo.jpg', 0)).toBe('photo.jpg.part001.hsp');
    expect(makePartName('photo.jpg', 1042)).toBe('photo.jpg.part1043.hsp');
    expect(partIndexFromName('photo.jpg.part001.hsp')).toBe(0);
    expect(partIndexFromName('photo.jpg.part1043.hsp')).toBe(1042);
  });

  it('detects part and manifest filenames', () => {
    expect(isPartFileName('a.part001.hsp')).toBe(true);
    expect(isPartFileName('a.part1.hsp')).toBe(false);
    expect(isPartFileName('a.hsp')).toBe(false);
    expect(isPartFileName('x.hsp')).toBe(false);
    expect(isManifestFileName('photo.jpg.hsmanifest.json')).toBe(true);
    expect(isManifestFileName('x.json')).toBe(false);
    expect(isManifestFileName('x.hsp')).toBe(false);
  });
});

describe('validateChunkSize / file size', () => {
  it('accepts the four documented sizes', () => {
    for (const c of [1, 2, 3, 4].map((n) => n * 1024 * 1024)) {
      expect(() => validateChunkSize(c)).not.toThrow();
    }
  });
  it('rejects other sizes', () => {
    for (const c of [0, 1024, 5 * 1024 * 1024, -1]) {
      expect(() => validateChunkSize(c)).toThrow(HandshackError);
    }
  });
  it('enforces max file size', () => {
    expect(() => validateInputFileSize(0)).not.toThrow();
    expect(() => validateInputFileSize(MAX_FILE_SIZE)).not.toThrow();
    expect(() => validateInputFileSize(MAX_FILE_SIZE + 1)).toThrow(HandshackError);
    expect(() => validateInputFileSize(-5)).toThrow(HandshackError);
  });
});

describe('validateKdfParams', () => {
  it('accepts defaults', () => {
    expect(() => validateKdfParams({ ...KDF_DEFAULTS })).not.toThrow();
  });
  it('rejects out-of-range values', () => {
    const bad: Partial<ScryptParams>[] = [
      { n: 1024 },
      { n: 2 ** 24 },
      { n: 30000 }, // not a power of two
      { r: 0 },
      { r: 64 },
      { p: 0 },
      { p: 16 },
      { dkLen: 16 },
    ];
    for (const over of bad) {
      expect(() => validateKdfParams({ ...KDF_DEFAULTS, ...over } as ScryptParams)).toThrow(HandshackError);
    }
  });
  it('rejects parameter combos exceeding the memory cap', () => {
    expect(() => validateKdfParams({ n: 2 ** 20, r: 8, p: 4, dkLen: 32 })).toThrow(HandshackError);
  });
});

describe('validateManifest', () => {
  async function goodManifest() {
    const pkg = await encryptInMemory(deterministicBytes(1024), 'a.txt', PASSWORD, DEFAULT_CHUNK_SIZE, provider);
    return pkg.manifest;
  }

  it('accepts a real manifest', async () => {
    const m = await goodManifest();
    expect(validateManifest(structuredClone(m))).toEqual(m);
  });

  it('rejects non-objects and wrong format', async () => {
    expect(() => validateManifest(null)).toThrow(HandshackError);
    expect(() => validateManifest([])).toThrow(HandshackError);
    const m = await goodManifest();
    const bad = cloneManifest(m) as unknown as Record<string, unknown>;
    bad['format'] = 'other';
    expect(() => validateManifest(bad)).toThrow(HandshackError);
  });

  it('rejects unsupported version', async () => {
    const bad = cloneManifest(await goodManifest()) as unknown as Record<string, unknown>;
    bad['formatVersion'] = 2;
    expect(() => validateManifest(bad)).toThrowError(/unsupported-version/);
  });

  it('rejects out-of-order or malformed part names', async () => {
    const bad = cloneManifest(await goodManifest());
    bad.parts[0]!.name = 'evil.part999.hsp';
    expect(() => validateManifest(bad)).toThrow(HandshackError);
    bad.parts[0]!.name = '../escape.part001.hsp';
    expect(() => validateManifest(bad)).toThrow(HandshackError);
  });

  it('rejects parts whose sizes do not sum to encryptedSize', async () => {
    const bad = cloneManifest(await goodManifest());
    bad.parts[0]!.size -= 1;
    expect(() => validateManifest(bad)).toThrow(HandshackError);
  });

  it('rejects absurd part counts', async () => {
    const bad = cloneManifest(await goodManifest()) as unknown as Record<string, unknown>;
    bad['partCount'] = 999999;
    expect(() => validateManifest(bad)).toThrow(HandshackError);
  });
});
