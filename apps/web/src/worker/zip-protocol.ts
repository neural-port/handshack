export type ZipWorkerRequest =
  | { kind: 'unzip'; file: File }
  | { kind: 'zip'; manifestName: string; manifestText: string; parts: { name: string; blob: Blob }[] };

export type ZipWorkerResponse =
  | { kind: 'unzip-result'; files: File[] }
  | { kind: 'zip-result'; blob: Blob }
  | { kind: 'error'; code: string; message: string };
