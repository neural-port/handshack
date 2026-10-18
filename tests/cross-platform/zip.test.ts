import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { createZip, expandZipFile } from '../../apps/web/src/worker/zip-archive.js';

describe('web ZIP worker archive logic', () => {
  it('round-trips the manifest and encrypted parts', async () => {
    const bytes = Uint8Array.from([0, 255, 3, 17, 42]);
    const archive = await createZip('photo.hsmanifest.json', '{"format":"handshack-package"}', [
      { name: 'photo.part001.hsp', blob: new Blob([bytes]) },
    ]);
    const files = await expandZipFile(new File([archive], 'package.zip'));

    expect(files.map((file) => file.name).sort()).toEqual([
      'photo.hsmanifest.json',
      'photo.part001.hsp',
    ]);
    const part = files.find((file) => file.name.endsWith('.hsp'))!;
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes);
  });

  it('rejects ZIP entries containing parent-directory traversal', async () => {
    const archive = zipSync({ '../escape.part001.hsp': Uint8Array.of(1) }, { level: 0 });
    const input = new File([archive.buffer as ArrayBuffer], 'unsafe.zip');
    await expect(expandZipFile(input)).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
