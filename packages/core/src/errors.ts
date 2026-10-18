/**
 * Structured errors. `code` is machine-stable; `userMessage` is safe to show in the UI.
 * Never include passwords, keys, or file contents in `detail` or `userMessage`.
 */

export type HandshackErrorCode =
  | 'invalid-input'
  | 'invalid-manifest'
  | 'unsupported-version'
  | 'unsupported-algorithm'
  | 'kdf-params-out-of-range'
  | 'missing-parts'
  | 'duplicate-parts'
  | 'unexpected-files'
  | 'part-mismatch'
  | 'part-corrupt'
  | 'invalid-package'
  | 'truncated-package'
  | 'authentication-failed'
  | 'integrity-failed'
  | 'file-too-large'
  | 'too-many-parts'
  | 'unsafe-filename'
  | 'password-mismatch'
  | 'invalid-password'
  | 'insufficient-space'
  | 'permission-denied'
  | 'save-failed'
  | 'io-error'
  | 'cancelled'
  | 'internal-error';

const DEFAULT_MESSAGES: Record<HandshackErrorCode, string> = {
  'invalid-input': 'The provided input is not valid.',
  'invalid-manifest': 'This does not appear to be a valid HandShack manifest.',
  'unsupported-version': 'This package was created with an unsupported format version.',
  'unsupported-algorithm': 'This package uses an algorithm this version of HandShack cannot read.',
  'kdf-params-out-of-range': 'This package requests key-derivation parameters outside safe limits.',
  'missing-parts': 'One or more required parts are missing.',
  'duplicate-parts': 'The same part was provided more than once.',
  'unexpected-files': 'One or more selected files do not belong to this package.',
  'part-mismatch': 'A selected file does not match the size recorded in the manifest.',
  'part-corrupt': 'A package part is corrupted or does not belong to this package.',
  'invalid-package': 'This does not appear to be a valid HandShack package.',
  'truncated-package': 'The selected file appears incomplete or damaged.',
  'authentication-failed':
    'Unable to decrypt this package. Check the password and verify that all parts belong to the same package and are intact.',
  'integrity-failed': 'The restored file did not pass integrity verification.',
  'file-too-large': 'The selected file is larger than the supported maximum size.',
  'too-many-parts': 'This package has more parts than supported.',
  'unsafe-filename': 'The recorded file name is not safe to use.',
  'password-mismatch': 'The passwords you entered do not match.',
  'invalid-password': 'Enter a password before continuing.',
  'insufficient-space': 'There is not enough disk space to complete this operation.',
  'permission-denied': 'Permission was denied while accessing a file or folder.',
  'save-failed': 'The output could not be saved.',
  'io-error': 'A file could not be read or written.',
  cancelled: 'The operation was cancelled.',
  'internal-error': 'Something went wrong while processing. Please try again.',
};

export class HandshackError extends Error {
  readonly code: HandshackErrorCode;
  /** User-facing message, free of secrets and stack data. */
  readonly userMessage: string;
  /** Non-sensitive diagnostic detail (never include secrets). */
  readonly detail?: string;

  constructor(code: HandshackErrorCode, detail?: string, userMessage?: string) {
    super(`${code}: ${detail ?? DEFAULT_MESSAGES[code]}`);
    this.name = 'HandshackError';
    this.code = code;
    this.detail = detail;
    this.userMessage = userMessage ?? DEFAULT_MESSAGES[code];
  }
}

export function toHandshackError(err: unknown, fallback: HandshackErrorCode = 'internal-error'): HandshackError {
  if (err instanceof HandshackError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new HandshackError('cancelled');
  }
  // Preserve a HandShack code when an error crosses a boundary as a plain
  // object (e.g. Electron IPC round-trips). Only codes from our own set are
  // honored — system codes like ENOENT deliberately map to the fallback.
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code in DEFAULT_MESSAGES) {
    return new HandshackError(
      code as HandshackErrorCode,
      err instanceof Error ? err.name : undefined,
    );
  }
  return new HandshackError(fallback, err instanceof Error ? err.name : undefined);
}

export function userMessageFor(err: unknown): string {
  return toHandshackError(err).userMessage;
}
