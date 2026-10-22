# Security Model

HandShack's job: encrypt a local file, split the encrypted package into
shareable parts, and restore the original file byte-for-byte when all parts
and the password come together. This document describes what it protects, what
it deliberately does not, and how to report vulnerabilities.

---

## What HandShack does

- **Authenticated encryption** — AES-256-GCM over 1 MiB records. Confidentiality
  comes from AES; integrity comes from GCM authentication tags + a SHA-256
  digest of the original file verified after decryption.
- **Memory-hard password KDF** — scrypt (N=32768, r=8, p=1) with a fresh
  16-byte random salt per package, making offline password guessing expensive
  and precomputed attacks useless.
- **Cryptographic randomness** — OS/Web Crypto CSPRNG for salt, package ID,
  and any future key material. `Math.random()` is never used.
- **Package integrity checks before decrypting** — per-part SHA-256
  fingerprints, sequential part numbering, size consistency, header
  cross-validation, positional record authentication (anti-reorder,
  anti-truncate, anti-transplant), and a final whole-file SHA-256.
- **Fail-closed errors** — every check throws a typed `HandshackError`; output
  is only committed after all authentication succeeds. Partial plaintext is
  deleted/discarded on failure or cancel.
- **Input policy enforced before cryptography** — files up to 1 GB; videos
  must be 1080p or smaller, verified from container headers (MP4/MOV/3GP/MKV/WebM).
  Unverifiable video containers are rejected rather than accepted unchecked.
- **No remote storage** — file contents and passwords are never intentionally
  transmitted. The web demo has no backend at all; the desktop app works fully
  offline.

## Trust boundaries

| Boundary | Protection |
| --- | --- |
| Web renderer ↔ crypto | All crypto runs in a dedicated Web Worker; the page holds the password only as long as needed and the pipeline zeroes key buffers it controls |
| Electron renderer ↔ main | Renderer is sandboxed with context isolation and no Node access; it can only call a narrow allow-listed IPC bridge (pick files, run encrypt/decrypt, reveal path) implemented in `src/preload` + `src/main` |
| Package ↔ attacker | Contents require the password-derived key; tampering, missing parts, foreign files, or a manipulated manifest are rejected before output is produced |

## Honest limitations — please read

1. **Splitting is not a security feature.** It exists for transfer convenience.
   Security comes solely from encryption + password strength. Anyone who
   obtains all parts, the manifest, and the password can recover the file.
2. **A compromised device defeats everything.** Malware, keyloggers, a
   compromised OS/browser/extension, or an attacker with physical access can
   capture your password or plaintext before encryption.
3. **A compromised delivery channel can deliver malicious code.** If the web
   origin serving the app is compromised, the served JS could be malicious.
   Prefer the signed desktop build for high-sensitivity use; verify you are on
   the real HandShack URL.
4. **Password quality bounds security.** scrypt raises the cost of guessing;
   a weak or reused password remains the weakest link.
5. **Metadata is not hidden.** File name and size are recorded in the manifest
   and package header (readable without a password). Existence and approximate
   size of the file are visible to anyone holding the parts.
6. **No forward secrecy / deniability** — the format is symmetric password
   cryptography, not a signature or ratchet scheme.
7. **Memory erasure is best-effort.** JS gives no guarantee that every copy of
   a key or plaintext is gone after buffers are zeroed.
8. **Unsigned binaries** — until code signing is configured, Windows may warn
   on install; verify the SHA-256 in `SHA256SUMS.txt` from the release page.
9. **Quantum caveat** — Grover's algorithm halves symmetric key strength
   (~128 bits effective for AES-256): still adequate today, not infinite.

## Threat model checklist (what this is FOR)

- Sending a sensitive file through channels you don't fully trust.
- Keeping a file confidential while it transits email/cloud/USB.
- Splitting a large encrypted payload across size-limited channels.
- Recovering a file exactly — photographs and binaries restore byte-for-byte.

## What it is NOT for

- Anonymity or deniable communication.
- Protecting against an attacker who controls your device or browser.
- Password recovery, key escrow, or multi-party access.
- Long-term archival guarantees (format is versioned, not eternal).

## Reporting vulnerabilities

Please report security issues **privately**: open a private security advisory
on the GitHub repository (Security → Advisories) or contact the maintainers
listed in the README. Do not file a public issue for a security problem.

Include: format version, implementation (web/desktop), reproduction steps, and
whether you can demonstrate recovery of plaintext, authentication bypass, or
password extraction. We acknowledge reports within a reasonable timeframe and
will credit reporters in release notes if desired.

## Hardening notes for reviewers

- `packages/core/src/crypto/` — providers, records, header construction.
- `packages/core/src/package/` — manifest validation, encrypt/decrypt pipelines.
- `apps/desktop/src/main/index.ts` — IPC validation, window security settings.
- `apps/desktop/src/preload/index.ts` — the entire renderer attack surface.
- `apps/web/vite.config.ts` — production CSP injection.
- `scripts/verify-release.mjs` — build-time checks (secrets, remote assets,
  CSP presence, subpath-safe paths).

Dependencies are kept minimal and standard: `hash-wasm` (scrypt/SHA-256 WASM
for browsers — the platform APIs lack scrypt), `fflate` (ZIP container I/O),
React/Vite/Electron toolchain. No telemetry, no analytics, no remote fonts.

## Data protection posture (IT Act 2000 alignment)

HandShack is a local processing tool, not a data controller service. This section
records what that means for the Information Technology Act, 2000 and the SPDI
Rules, 2011, so reviewers do not have to infer it.

| Obligation | Position |
| --- | --- |
| Collection of sensitive personal data | None. No account, no profile, no telemetry, no analytics, no cookies. The app never asks for identity data. |
| Consent and retention policy | Not triggered — nothing is collected or retained server-side. |
| Data at rest on a server | None. The web build is static; packages are written to the user's own disk. |
| Intermediary obligations (s.79) | Not applicable. There is no service, no hosted content, and no user-generated content stored by the project. |
| Breach notification | No server-side store exists to breach. If a deployment host keeps access logs, those logs belong to that host and are outside this codebase. |
| Electronic records integrity (s.65A/65B) | Records are protected by AES-256-GCM and SHA-256 manifests. This provides integrity, not statutory digital signatures. |
| Non-repudiation | Not provided. HandShack does not sign packages or assert author identity; anyone holding all parts and the password can open a package. |

If a deployment adds accounts, uploads, or analytics, this table no longer
applies and a privacy notice with consent and retention terms becomes mandatory.
