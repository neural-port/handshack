/**
 * Video resolution detection for the 1080p input rule.
 *
 * HandShack never decodes, transcodes, or re-encodes media. This module reads
 * only the container headers needed to report a video's pixel dimensions, so the
 * limit can be enforced before any encryption work begins.
 *
 * Supported containers:
 *  - ISO base media: MP4, M4V, MOV, 3GP, 3G2
 *  - Matroska: MKV, WebM
 *
 * Every other video container returns `null`; callers treat that as unverifiable
 * and reject the file rather than silently skipping the limit.
 */
import type { ByteSource } from '../types.js';

export interface VideoDimensions {
  width: number;
  height: number;
}

/** Extensions treated as video for limit purposes. */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4', 'm4v', 'mov', '3gp', '3g2',
  'mkv', 'webm',
  'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', 'mts', 'ogv', 'vob', 'divx',
]);

export function isVideoFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Upper bound on a single container header read (moov / Tracks). */
const MAX_HEADER_READ = 8 * 1024 * 1024;

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function u64(b: Uint8Array, o: number): number {
  return u32(b, o) * 0x100000000 + u32(b, o + 4);
}

function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
}

function readUint(b: Uint8Array): number {
  let v = 0;
  for (const byte of b) v = v * 256 + byte;
  return v;
}

/* ---------- ISO base media (MP4 / MOV / 3GP) ---------- */

interface Box {
  type: string;
  start: number;
  end: number;
}

/** Iterate sibling boxes inside an in-memory buffer. */
function* boxes(buf: Uint8Array, start: number, end: number): Generator<Box> {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(buf, o);
    const type = fourcc(buf, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) return;
      size = u64(buf, o + 8);
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) return;
    yield { type, start: o + header, end: o + size };
    o += size;
  }
}

function findBox(buf: Uint8Array, start: number, end: number, type: string): Box | null {
  for (const box of boxes(buf, start, end)) if (box.type === type) return box;
  return null;
}

/** tkhd payload → display width/height (16.16 fixed point at the end of the box). */
function tkhdDimensions(payload: Uint8Array): VideoDimensions | null {
  if (payload.length < 4) return null;
  const version = payload[0]!;
  const base = version === 1 ? 88 : 76;
  if (payload.length < base + 8) return null;
  const width = Math.round(u32(payload, base) / 65536);
  const height = Math.round(u32(payload, base + 4) / 65536);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** Locate `moov` by walking top-level boxes, reading only their 16-byte headers. */
async function findMoov(src: ByteSource): Promise<Box | null> {
  let o = 0;
  while (o + 8 <= src.size) {
    const head = await src.read(o, Math.min(16, src.size - o));
    let size = u32(head, 0);
    const type = fourcc(head, 4);
    let header = 8;
    if (size === 1) {
      if (head.length < 16) return null;
      size = u64(head, 8);
      header = 16;
    } else if (size === 0) {
      size = src.size - o;
    }
    if (size < header || o + size > src.size) return null;
    if (type === 'moov') {
      if (size - header > MAX_HEADER_READ) return null;
      return { type, start: o + header, end: o + size };
    }
    o += size;
  }
  return null;
}

async function isoBmffDimensions(src: ByteSource): Promise<VideoDimensions | null> {
  const moov = await findMoov(src);
  if (!moov) return null;
  const buf = await src.read(moov.start, moov.end - moov.start);
  for (const trak of boxes(buf, 0, buf.length)) {
    if (trak.type !== 'trak') continue;
    const tkhd = findBox(buf, trak.start, trak.end, 'tkhd');
    if (!tkhd) continue;
    const dims = tkhdDimensions(buf.subarray(tkhd.start, tkhd.end));
    if (dims) return dims;
  }
  return null;
}

/* ---------- Matroska / WebM ---------- */

const EBML_HEADER_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const TRACKS_ID = 0x1654ae6b;
const TRACK_ENTRY_ID = 0xae;
const TRACK_TYPE_ID = 0x83;
const VIDEO_ID = 0xe0;
const PIXEL_WIDTH_ID = 0xb0;
const PIXEL_HEIGHT_ID = 0xba;

interface EbmlElement {
  id: number;
  /** null when the element declares an unknown size (live/streamed segments). */
  size: number | null;
  dataStart: number;
}

/** Read one EBML element header (variable-length ID + variable-length size). */
async function readEbmlHeader(src: ByteSource, offset: number, end: number): Promise<EbmlElement | null> {
  const available = Math.min(12, end - offset);
  if (available < 2) return null;
  const buf = await src.read(offset, available);

  let i = 0;
  let idLen = 1;
  while (idLen <= 4 && (buf[i]! & (0x80 >> (idLen - 1))) === 0) idLen++;
  if (idLen > 4 || i + idLen > buf.length) return null;
  let id = 0;
  for (let k = 0; k < idLen; k++) id = id * 256 + buf[i + k]!;
  i += idLen;

  if (i >= buf.length) return null;
  const first = buf[i]!;
  let sizeLen = 1;
  while (sizeLen <= 8 && (first & (0x80 >> (sizeLen - 1))) === 0) sizeLen++;
  if (sizeLen > 8 || i + sizeLen > buf.length) return null;

  const markerMask = 0xff >> sizeLen;
  let size = first & markerMask;
  let unknown = size === markerMask;
  for (let k = 1; k < sizeLen; k++) {
    const byte = buf[i + k]!;
    size = size * 256 + byte;
    if (byte !== 0xff) unknown = false;
  }

  return { id, size: unknown ? null : size, dataStart: offset + i + sizeLen };
}

async function readEbmlUint(src: ByteSource, el: EbmlElement): Promise<number> {
  if (el.size === null || el.size === 0 || el.size > 8) return 0;
  return readUint(await src.read(el.dataStart, el.size));
}

async function videoElementDimensions(src: ByteSource, start: number, end: number): Promise<VideoDimensions | null> {
  let cursor = start;
  let width = 0;
  let height = 0;
  while (cursor < end) {
    const el = await readEbmlHeader(src, cursor, end);
    if (!el || el.size === null) return null;
    const dataEnd = Math.min(end, el.dataStart + el.size);
    if (el.id === PIXEL_WIDTH_ID) width = await readEbmlUint(src, el);
    else if (el.id === PIXEL_HEIGHT_ID) height = await readEbmlUint(src, el);
    cursor = dataEnd;
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

async function trackEntryDimensions(src: ByteSource, start: number, end: number): Promise<VideoDimensions | null> {
  let cursor = start;
  let trackType = 0;
  let dims: VideoDimensions | null = null;
  while (cursor < end) {
    const el = await readEbmlHeader(src, cursor, end);
    if (!el || el.size === null) return null;
    const dataEnd = Math.min(end, el.dataStart + el.size);
    if (el.id === TRACK_TYPE_ID) trackType = await readEbmlUint(src, el);
    else if (el.id === VIDEO_ID) dims = await videoElementDimensions(src, el.dataStart, dataEnd);
    cursor = dataEnd;
  }
  // TrackType 1 is video; when absent, rely on the Video element being present.
  if (trackType !== 0 && trackType !== 1) return null;
  return dims;
}

async function tracksDimensions(src: ByteSource, start: number, end: number): Promise<VideoDimensions | null> {
  let cursor = start;
  while (cursor < end) {
    const el = await readEbmlHeader(src, cursor, end);
    if (!el || el.size === null) return null;
    const dataEnd = Math.min(end, el.dataStart + el.size);
    if (el.id === TRACK_ENTRY_ID) {
      const dims = await trackEntryDimensions(src, el.dataStart, dataEnd);
      if (dims) return dims;
    }
    cursor = dataEnd;
  }
  return null;
}

async function matroskaDimensions(src: ByteSource): Promise<VideoDimensions | null> {
  const header = await readEbmlHeader(src, 0, src.size);
  if (!header || header.id !== EBML_HEADER_ID || header.size === null) return null;

  let cursor = header.dataStart + header.size;
  let segmentEnd = src.size;
  let inSegment = false;

  while (cursor < segmentEnd) {
    const el = await readEbmlHeader(src, cursor, segmentEnd);
    if (!el) return null;
    const dataEnd = el.size === null ? segmentEnd : Math.min(segmentEnd, el.dataStart + el.size);

    if (!inSegment) {
      if (el.id === SEGMENT_ID) {
        inSegment = true;
        segmentEnd = dataEnd;
        cursor = el.dataStart;
        continue;
      }
      if (el.size === null) return null;
      cursor = dataEnd;
      continue;
    }

    if (el.id === TRACKS_ID) return tracksDimensions(src, el.dataStart, dataEnd);
    // Clusters may declare unknown sizes; without a size there is no way to skip one.
    if (el.size === null) return null;
    cursor = dataEnd;
  }
  return null;
}

/* ---------- public API ---------- */

/**
 * Read a video's pixel dimensions from its container headers.
 * Returns `null` for unsupported or unparsable containers — callers must treat
 * that as "cannot verify", never as "allowed".
 */
export async function readVideoDimensions(src: ByteSource): Promise<VideoDimensions | null> {
  if (src.size < 12) return null;
  const sniff = await src.read(0, Math.min(12, src.size));

  if (fourcc(sniff, 4) === 'ftyp') return isoBmffDimensions(src);
  if (u32(sniff, 0) === EBML_HEADER_ID) return matroskaDimensions(src);
  return null;
}
