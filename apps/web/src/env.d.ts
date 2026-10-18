/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_BASE_PATH?: string;
  readonly VITE_REPO_URL?: string;
  readonly VITE_RELEASE_VERSION?: string;
  readonly VITE_RELEASE_INSTALLER_URL?: string;
  readonly VITE_RELEASE_INSTALLER_SHA256?: string;
  readonly VITE_RELEASE_PORTABLE_URL?: string;
  readonly VITE_RELEASE_PORTABLE_SHA256?: string;
  readonly VITE_RELEASE_NOTES_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
