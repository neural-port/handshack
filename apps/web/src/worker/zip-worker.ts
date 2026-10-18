import { HandshackError } from '@handshack/core';
import type { ZipWorkerRequest, ZipWorkerResponse } from './zip-protocol.js';
import { createZip, expandZipFile } from './zip-archive.js';

function post(message: ZipWorkerResponse): void {
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = (event: MessageEvent<ZipWorkerRequest>) => {
  void (async () => {
    try {
      const request = event.data;
      if (request.kind === 'unzip') {
        post({ kind: 'unzip-result', files: await expandZipFile(request.file) });
      } else {
        post({
          kind: 'zip-result',
          blob: await createZip(request.manifestName, request.manifestText, request.parts),
        });
      }
    } catch (error) {
      const handshackError =
        error instanceof HandshackError
          ? error
          : new HandshackError('invalid-input', error instanceof Error ? error.message : undefined);
      post({ kind: 'error', code: handshackError.code, message: handshackError.userMessage });
    }
  })();
};
