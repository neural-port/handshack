import {
  HandshackError,
  MAX_MANIFEST_SIZE,
  ZIP_DOWNLOAD_LIMIT,
  ZIP_MAX_ARCHIVE_SIZE,
  ZIP_MAX_ENTRIES,
  ZIP_MAX_ENTRY_SIZE,
  ZIP_MAX_TOTAL_SIZE,
} from '@handshack/core';
import { Unzip, UnzipInflate, zipSync, type Zippable } from 'fflate';

function reject(code: string, message: string): never {
  throw new HandshackError(code as never, message);
}

function safeArchiveName(name: string): boolean {
  const segments = name.split(/[\\/]/);
  return (
    name.length > 0 &&
    name.length < 512 &&
    !name.startsWith('/') &&
    !name.startsWith('\\') &&
    !/^[A-Za-z]:/.test(name) &&
    segments.every((segment) => segment !== '..')
  );
}

/** Stream ZIP decompression and enforce limits against actual output bytes. */
export async function expandZipFile(file: File): Promise<File[]> {
  if (file.size > ZIP_MAX_ARCHIVE_SIZE) {
    reject('invalid-input', `ZIP size ${file.size} exceeds the supported archive limit`);
  }

  const unzipper = new Unzip();
  unzipper.register(UnzipInflate);
  let count = 0;
  let activeStreams = 0;
  let totalSize = 0;
  let failure: string | null = null;
  const names = new Set<string>();
  const entries: { name: string; chunks: Uint8Array[]; size: number }[] = [];
  unzipper.onfile = (stream) => {
    count++;
    const declaredSize = stream.originalSize;
    if (count > ZIP_MAX_ENTRIES) failure = 'The archive contains too many entries.';
    else if (!safeArchiveName(stream.name)) failure = 'The archive contains an unsafe file name.';
    else if (names.has(stream.name)) failure = 'The archive contains duplicate file names.';
    else if (
      declaredSize !== undefined &&
      (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > ZIP_MAX_ENTRY_SIZE)
    ) {
      failure = 'An archive entry exceeds the supported size.';
    } else if (stream.compression !== 0 && stream.compression !== 8) {
      failure = 'An archive entry uses an unsupported compression method.';
    }
    if (failure) return;

    names.add(stream.name);
    const entry = { name: stream.name, chunks: [] as Uint8Array[], size: 0 };
    activeStreams++;
    stream.ondata = (error, data, final) => {
      if (failure) return;
      if (error) {
        failure = `Cannot decompress ZIP entry "${stream.name}".`;
        return;
      }
      if (data?.length) {
        entry.size += data.length;
        totalSize += data.length;
        if (entry.size > ZIP_MAX_ENTRY_SIZE) {
          failure = 'An archive entry exceeds the supported size.';
          return;
        }
        if (totalSize > ZIP_MAX_TOTAL_SIZE) {
          failure = 'The archive expands beyond the supported total size.';
          return;
        }
        entry.chunks.push(data.slice());
      }
      if (final) {
        activeStreams--;
        if (declaredSize !== undefined && entry.size !== declaredSize) {
          failure = `ZIP entry "${stream.name}" differs from its declared size.`;
          return;
        }
        entries.push(entry);
      }
    };
    try {
      stream.start();
    } catch {
      activeStreams--;
      failure = `Cannot start ZIP entry "${stream.name}".`;
    }
  };

  try {
    const inputChunkSize = 1024 * 1024;
    for (let offset = 0; offset < file.size; offset += inputChunkSize) {
      const end = Math.min(file.size, offset + inputChunkSize);
      const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      unzipper.push(chunk, end === file.size);
      if (failure) break;
    }
  } catch {
    reject('invalid-input', `Cannot read "${file.name}" as a ZIP archive.`);
  }
  if (failure) reject('invalid-input', failure);
  if (activeStreams !== 0) reject('invalid-input', 'ZIP archive ended before all entries were complete.');

  const files: File[] = [];
  const outputNames = new Set<string>();
  for (const entry of entries) {
    const base = entry.name.split(/[\\/]/).pop() ?? '';
    if (!base || base.startsWith('.') || base.includes('..')) continue;
    if (outputNames.has(base)) {
      reject('invalid-input', `ZIP contains duplicate basename "${base}".`);
    }
    outputNames.add(base);
    const data = new Uint8Array(entry.size);
    let offset = 0;
    for (const chunk of entry.chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    files.push(new File([data.buffer], base));
  }
  return files;
}

export async function createZip(
  manifestName: string,
  manifestText: string,
  parts: { name: string; blob: Blob }[],
): Promise<Blob> {
  const manifestBytes = new TextEncoder().encode(manifestText);
  const totalInputSize = manifestBytes.length + parts.reduce((sum, part) => sum + part.blob.size, 0);
  if (manifestBytes.length > MAX_MANIFEST_SIZE || totalInputSize > ZIP_DOWNLOAD_LIMIT) {
    reject('file-too-large', 'The package exceeds the ZIP download limit.');
  }
  if (!safeArchiveName(manifestName) || parts.some((part) => !safeArchiveName(part.name))) {
    reject('invalid-input', 'The package contains an unsafe archive file name.');
  }
  const names = new Set([manifestName]);
  const files: Zippable = { [manifestName]: manifestBytes };
  for (const part of parts) {
    if (names.has(part.name)) reject('invalid-input', 'The package contains duplicate file names.');
    names.add(part.name);
    files[part.name] = new Uint8Array(await part.blob.arrayBuffer());
  }
  const output = zipSync(files, { level: 0 });
  if (output.length > ZIP_MAX_ARCHIVE_SIZE) {
    reject('file-too-large', 'The ZIP archive exceeds the supported limit.');
  }
  return new Blob([output], { type: 'application/zip' });
}
