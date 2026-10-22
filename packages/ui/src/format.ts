/** Display formatting helpers. */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
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
    pdf: 'PDF document', doc: 'Word document', docx: 'Word document', docm: 'Word document',
    dot: 'Word template', dotx: 'Word template', odt: 'OpenDocument text', pages: 'Pages document',
    xls: 'Excel spreadsheet', xlsx: 'Excel spreadsheet', xlsm: 'Excel spreadsheet', xlsb: 'Excel spreadsheet',
    ods: 'OpenDocument spreadsheet', numbers: 'Numbers spreadsheet',
    ppt: 'PowerPoint', pptx: 'PowerPoint', pptm: 'PowerPoint', odp: 'OpenDocument presentation',
    key: 'Keynote presentation', one: 'OneNote notebook', pub: 'Publisher document', vsdx: 'Visio drawing',
    accdb: 'Access database', mdb: 'Access database', epub: 'EPUB book', xps: 'XPS document',
    txt: 'Text file', md: 'Markdown file', rtf: 'Rich text',
    mp4: 'MP4 video', m4v: 'MP4 video', mov: 'QuickTime video', mkv: 'MKV video', webm: 'WebM video',
    avi: 'AVI video', wmv: 'WMV video', flv: 'Flash video', mpg: 'MPEG video', mpeg: 'MPEG video',
    '3gp': '3GP video', ts: 'MPEG transport stream', ogv: 'Ogg video',
    mp3: 'MP3 audio', wav: 'WAV audio', flac: 'FLAC audio', m4a: 'M4A audio', aac: 'AAC audio',
    ogg: 'Ogg audio', oga: 'Ogg audio', opus: 'Opus audio', wma: 'WMA audio', aiff: 'AIFF audio',
    aif: 'AIFF audio', alac: 'ALAC audio', mid: 'MIDI file', midi: 'MIDI file',
    zip: 'ZIP archive', '7z': '7-Zip archive', rar: 'RAR archive', tar: 'TAR archive', gz: 'GZip archive',
    json: 'JSON file', csv: 'CSV file', xml: 'XML file', html: 'HTML file',
    exe: 'Windows executable', dmg: 'macOS disk image', iso: 'Disk image',
  };
  return map[ext] ?? (ext ? `${ext.toUpperCase()} file` : 'File');
}

export function chunkSizeLabel(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
