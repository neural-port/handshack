/**
 * Sandboxed preload — the ONLY bridge between the isolated renderer and the
 * privileged main process. Exposes narrow, named operations; no arbitrary IPC.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DecryptParams, EncryptParams, HandshackBridge } from '../shared/api.js';
import type { ProgressEvent } from '@handshack/core';

const bridge: HandshackBridge = {
  pickInputFile: () => ipcRenderer.invoke('file:pick-input'),
  pickPackageFiles: () => ipcRenderer.invoke('file:pick-package'),
  pickOutputDirectory: () => ipcRenderer.invoke('dialog:output-dir'),
  pickSavePath: (defaultName: string) => ipcRenderer.invoke('dialog:save-path', defaultName),
  inspectPackage: (paths: string[]) => ipcRenderer.invoke('package:inspect', paths),
  findCollisions: (dir: string, baseName: string) =>
    ipcRenderer.invoke('fs:find-collisions', dir, baseName),
  pathExists: (path: string) => ipcRenderer.invoke('fs:exists', path),
  revealPath: (path: string) => ipcRenderer.invoke('fs:reveal', path),
  encrypt: (params: EncryptParams) => ipcRenderer.invoke('op:encrypt', params),
  decrypt: (params: DecryptParams) => ipcRenderer.invoke('op:decrypt', params),
  cancel: () => ipcRenderer.invoke('op:cancel'),
  onProgress: (cb: (e: ProgressEvent) => void) => {
    const listener = (_ev: IpcRendererEvent, e: ProgressEvent) => cb(e);
    ipcRenderer.on('op:progress', listener);
    return () => ipcRenderer.removeListener('op:progress', listener);
  },
};

contextBridge.exposeInMainWorld('handshack', bridge);
