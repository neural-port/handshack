/** Display formatting helpers. */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log2(n) / 10));
  const v = n / 2 ** (10 * i);
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function formatBytesExact(n: number): string {
  return `${n.toLocaleString('en-US')} B`;
}

export function fileTypeLabel(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const map: Record<string, string> = {
    jpg: 'JPEG image', jpeg: 'JPEG image', png: 'PNG image', gif: 'GIF image',
    webp: 'WebP image', svg: 'SVG image', heic: 'HEIC image', bmp: 'Bitmap image',
    pdf: 'PDF document', doc: 'Word document', docx: 'Word document',
    txt: 'Text file', md: 'Markdown file', rtf: 'Rich text',
    mp4: 'MP4 video', mov: 'QuickTime video', mkv: 'MKV video', webm: 'WebM video', avi: 'AVI video',
    mp3: 'MP3 audio', wav: 'WAV audio', flac: 'FLAC audio', m4a: 'M4A audio', ogg: 'Ogg audio',
    zip: 'ZIP archive', '7z': '7-Zip archive', rar: 'RAR archive', tar: 'TAR archive', gz: 'GZip archive',
    json: 'JSON file', csv: 'CSV file', xlsx: 'Excel spreadsheet', pptx: 'PowerPoint',
    exe: 'Windows executable', dmg: 'macOS disk image', iso: 'Disk image',
  };
  return map[ext] ?? (ext ? `${ext.toUpperCase()} file` : 'File');
}

export function chunkSizeLabel(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}
