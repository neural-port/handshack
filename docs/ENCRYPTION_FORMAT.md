# HandShack Package Format — Specification v1

This document specifies the `handshack-package` format version `1` as
implemented by this repository (`packages/core`). It is the contract between
the HandShack Web demo and the HandShack Desktop app: any conforming
implementation must be able to decrypt packages produced by any other
conforming implementation.

Where this document and the code disagree, the code is authoritative and this
document must be corrected — report discrepancies as defects.

---

## 1. Overview

A HandShack transfer consists of:

1. **N encrypted part files** — `BASENAME.partNNN.hsp` (`NNN` = 1-based index,
   zero-padded to a minimum of 3 digits; larger counts use more digits).
2. **One manifest** — `BASENAME.hsmanifest.json`, a JSON document describing
   the package (untrusted; cross-checked against authenticated data).

`BASENAME` is the original file name after sanitization (`sanitizeFileName` in
`packages/core/src/validation.ts`): path segments and `.`/`..` components are
removed, `"'*:<>?|` become `_`, control characters become spaces, whitespace
is collapsed, leading dots are stripped, Windows reserved device names are
prefixed `file-`, and the result is truncated to 128 code units. A name with
no remaining letter or digit is rejected.

There is **no compression, no encoding layer, no obfuscation**. Parts contain
only the encrypted package bytes described below. The manifest contains
metadata only — never the password, keys, or plaintext.

---

## 2. Cryptographic primitives

| Purpose            | Algorithm      | Parameters                                      |
| ------------------ | -------------- | ----------------------------------------------- |
| Key derivation     | scrypt         | N=32768, r=8, p=1, dkLen=32 (RFC 7914)          |
| Salt               | CSPRNG         | 16 bytes, fresh per package                     |
| Bulk encryption    | AES-256-GCM    | 96-bit nonces, 128-bit tags                     |
| Integrity          | SHA-256        | original file + every part                      |
| Randomness         | `crypto.getRandomValues` / `node:crypto` CSPRNG |                    |

### Key derivation

```
key = scrypt(passwordUTF8, salt, N=32768, r=8, p=1, dkLen=32)
```

The header and manifest record the KDF parameters. Implementations MUST
validate them against the read-side acceptance bounds before allocating memory
(`validateKdfParams`): N ∈ [2^14, 2^20] and a power of two, r ∈ [1, 8],
p ∈ [1, 4], dkLen = 32, and the scrypt memory estimate `128·N·r·p` must not
exceed 256 MiB. Out-of-bounds combinations are rejected with
`kdf-params-out-of-range`. (This build emits only the defaults above; the
bounds exist so hostile packages cannot trigger excessive memory use.)

Passwords are UTF-8 encoded. Encryption requires 8–1024 characters; decryption
accepts any non-empty password up to 1024 characters — a wrong password
surfaces as `authentication-failed`, not a format error.

### Record nonces

The derived key is unique per package (fresh random salt), so deterministic
per-record counter nonces are safe — nonce reuse under one key is impossible
by construction:

```
nonce_i = "HSP1" || uint64be(i)          (12 bytes total)
```

### Additional authenticated data (AAD)

Each record's AAD binds it to the package and its position:

```
AAD_i = "HSP1" || uint64be(i) || uint8(isFinal) || sha256(headerBytes)
```

`isFinal` is 1 only for the last record (index `recordCount − 1`). The 32-byte
header digest authenticates the complete header on every record. This
construction prevents reordering, duplication, truncation-by-record-removal,
and cross-package record transplant without a per-record flags byte on the
wire.

---

## 3. Encrypted package layout (the part stream)

```
┌───────────────┬───────────────┬───────────────────────────────────────────┐
│ Field         │ Size          │ Notes                                     │
├───────────────┼───────────────┼───────────────────────────────────────────┤
│ Magic         │ 4             │ ASCII "HSP1"                              │
│ Header length │ 4             │ uint32be, byte length of header JSON      │
│ Header JSON   │ headerLen     │ UTF-8, see §4                             │
│ Records       │ payloadSize   │ recordCount records of ciphertext ‖ tag   │
└───────────────┴───────────────┴───────────────────────────────────────────┘
```

Total package size = `8 + headerLen + payloadSize`. The manifest's
`encryptedSize` must equal this exactly.

### Records

The plaintext is encrypted in fixed-size **records** of `recordSize = 1 MiB`
(1,048,576 bytes). `recordCount = max(1, ceil(origSize / recordSize))`. Every
record except the last holds exactly `recordSize` plaintext bytes; the last
holds the remainder. An empty file produces exactly one record with zero
plaintext bytes.

On the wire each record is:

```
ciphertext (plaintext length) || GCM tag (16 bytes)
```

There is no per-record length or flags field — record boundaries are derived
from `origSize`, and finality is bound through AAD. Hence:

```
payloadSize = origSize + recordCount * 16
```

### Chunked into parts

The package byte stream is cut into parts of `chunkSize` bytes: every part
except the last is exactly `chunkSize` long; the last holds the remainder.
`partCount = max(1, ceil(packageSize / chunkSize))`, capped at 4096. Part
boundaries are opaque to decryption — parts are reassembled by simple
concatenation in manifest order before interpretation.

This build offers `chunkSize` ∈ {1, 2, 3, 4 MiB} (default 4 MiB). The header
reader accepts 1–64 MiB for forward compatibility, but the manifest validator
accepts only the four emitted values, so packages from this implementation
always use 1–4 MiB.

---

## 4. The authenticated header (inside the package)

UTF-8 JSON, length-prefixed as in §3. Maximum accepted size: 64 KiB.

```json
{
  "v": 1,
  "alg": "AES-256-GCM",
  "kdf": "scrypt",
  "kdfN": 32768,
  "kdfR": 8,
  "kdfP": 1,
  "dkLen": 32,
  "salt": "<16 bytes, canonical base64url>",
  "recordSize": 1048576,
  "recordCount": 3,
  "chunkSize": 4194304,
  "payloadSize": 3245714,
  "origSize": 3245666,
  "origSha256": "<64 lowercase hex>",
  "origName": "photo.jpg",
  "pkgId": "hs_<24 base64url chars>",
  "created": 1729267200
}
```

Field rules enforced by `validateHeader` (fail-closed):

- `v` must be `1` (else `unsupported-version`); `alg` = `AES-256-GCM` and
  `kdf` = `scrypt` (else `unsupported-algorithm`).
- `kdfN`/`kdfR`/`kdfP`/`dkLen` are integers within the §2 bounds.
- `salt` is a canonical base64url encoding of exactly 16 bytes.
- `recordSize` ∈ [1, 1 MiB]; `recordCount` ∈ [1, 4096].
- `recordCount` must equal `max(1, ceil(origSize / recordSize))`.
- `origSize` ∈ [0, 4 GiB]; `payloadSize` must equal `origSize + recordCount·16`.
- `chunkSize` ∈ [1 MiB, 64 MiB] (see §3 note on emitted values).
- `origSha256` is 64 lowercase hex characters.
- `origName` is 1–144 characters (sanitized again before use as a file name).
- `pkgId` matches `^hs_[A-Za-z0-9_-]{8,64}$`. This build emits
  `hs_` + base64url(18 random bytes) = 24 characters.
- `created` is an integer (Unix seconds, writer's local clock — informational,
  not security-critical).

Everything security-critical is **duplicated here under authentication**: the
header's SHA-256 is bound into every record's AAD, so undetected header edits
are impossible once the key is correct. The manifest's copy of these fields is
convenience metadata, cross-checked during decryption.

---

## 5. The manifest (`*.hsmanifest.json`)

```json
{
  "format": "handshack-package",
  "formatVersion": 1,
  "packageId": "hs_…",
  "createdAt": "2026-10-18T12:00:00.000Z",
  "generator": "handshack-web",
  "originalName": "photo.jpg",
  "originalSize": 3245666,
  "encryptedSize": 3246102,
  "chunkSize": 4194304,
  "partCount": 1,
  "algorithm": "AES-256-GCM",
  "kdf": "scrypt",
  "kdfParams": { "n": 32768, "r": 8, "p": 1, "dkLen": 32 },
  "salt": "<16 bytes, canonical base64url>",
  "parts": [
    { "name": "photo.jpg.part001.hsp", "size": 3246102, "sha256": "<64-hex>" }
  ]
}
```

`generator` is `handshack-web` or `handshack-desktop` in this build
(`handshack` when unspecified); it is informational only.

Validation rules (fail-closed, `validateManifest`):

- `format` = `handshack-package`; `formatVersion` = `1` (else
  `unsupported-version`); `algorithm` = `AES-256-GCM`, `kdf` = `scrypt` (else
  `unsupported-algorithm`).
- `kdfParams` within the §2 bounds (`kdf-params-out-of-range`).
- `salt` decodes canonically to exactly 16 bytes.
- `chunkSize` ∈ {1, 2, 3, 4 MiB}.
- `partCount` ∈ [1, 4096] and `parts.length` = `partCount` (`too-many-parts`).
- `encryptedSize` ∈ (0, 4 GiB + 262,144 + 1 MiB] — a coarse cap; the precise
  size relation is enforced via the header and stream length.
- `originalSize` ∈ [0, 4 GiB].
- `packageId` matches `^hs_[A-Za-z0-9_-]{8,64}$`.
- `originalName` ≤ 144 chars; `createdAt` ≤ 40 chars; `generator` ≤ 80 chars.
- Every part `name` matches `*.partNNN.hsp`, is ≤ 160 chars, contains no
  `/` or `\`, is unique, and its embedded index equals its position `i`
  (strict sequential naming, no gaps or reordering).
- Every part `size` ∈ [1, `chunkSize`]; all parts except the last must be
  exactly `chunkSize`; `Σ parts.size` must equal `encryptedSize`
  (`invalid-manifest`).
- Every part `sha256` is 64 lowercase hex.
- The manifest document itself is ≤ 1 MiB.

**The manifest is untrusted.** During decryption these manifest fields are
re-verified against the authenticated header (`invalid-package` on mismatch):

- `packageId` ↔ `pkgId`
- `chunkSize` ↔ `chunkSize`
- `originalSize` ↔ `origSize`
- `salt` ↔ `salt`
- `kdfParams.n/r/p/dkLen` ↔ `kdfN/kdfR/kdfP/dkLen`

Fields **not** cross-checked: `originalName` (the header's `origName` is
authoritative and re-sanitized before use), `createdAt`, `generator`, and
`origSha256` (verified by decrypting — the final SHA-256 check covers it). A
manipulated manifest therefore cannot redirect, relabel, or resize the output.

---

## 6. Pipelines

### 6.1 Encryption

1. Password 8–1024 chars; input size ≤ 1 GiB; video inputs must satisfy the
   1080p rule (container-verified — unverifiable containers rejected).
2. Pass 1: SHA-256 over the plaintext (`origSha256`).
3. Fresh 16-byte salt and 18-byte package ID from the CSPRNG; header built
   with the §4 fields; `headerHash = sha256(headerBytes)`.
4. `key = scrypt(password, salt, N=32768, r=8, p=1, dkLen=32)`.
5. Write preamble + header, then each record's `ciphertext ‖ tag` using the
   §2 nonce/AAD construction. The byte stream is routed through the part
   splitter at `chunkSize` boundaries; each part is SHA-256'd on the fly.
6. Emit the manifest with per-part names, sizes, and hashes. Peak memory is
   bounded by `recordSize` regardless of file size.

### 6.2 Decryption (order of checks)

1. `validateManifest` (structural).
2. **Part matching** — every declared part present exactly once by name;
   foreign files rejected (`missing-parts` / `unexpected-files` /
   `duplicate-parts` / `part-mismatch` on size).
3. **Per-part SHA-256** vs manifest (`part-corrupt` — identifies the broken
   part by name before any crypto runs). A UX convenience; the authoritative
   check is AEAD.
4. **Preamble + header** — magic `HSP1`, `headerLen` ∈ (0, 64 KiB], then
   `validateHeader` (`invalid-package`).
5. **Cross-checks** — the §5 field set must match the manifest; the total
   reassembled stream size must equal `8 + headerLen + payloadSize`
   (`truncated-package`).
6. **Key derivation** — scrypt over the header salt with the validated params.
7. **Per-record AEAD open** with positional AAD — wrong password or any
   corruption surfaces as `authentication-failed`.
8. **Trailing bytes** — nothing may follow the final record
   (`invalid-package`).
9. **Final integrity** — SHA-256 of the decrypted stream must equal
   `origSha256` (`integrity-failed`).
10. Only after all of the above succeed may the output be committed
    (`FileByteSink` writes to a staged partial file and deletes it on
    `abort()`; in-memory sinks are discarded). No partial plaintext
    masquerades as a completed file.

---

## 7. Implementation profiles

| Component        | Web demo                        | Desktop app                    |
| ---------------- | ------------------------------- | ------------------------------ |
| AES-GCM          | `crypto.subtle`                 | `node:crypto` AES-GCM          |
| scrypt / SHA-256 | `hash-wasm` (embedded WASM)     | `node:crypto`                  |
| Secure random    | `crypto.getRandomValues`        | `randomBytes`                  |
| File IO          | `Blob` slices + worker          | `fs` handles (streaming)       |
| Cross-provider   | verified both directions in CI  | verified both directions in CI |

Both providers implement `CryptoProvider` (`packages/core/src/types.ts`) and
are proven byte-identical by reciprocal decryption tests
(`tests/cross-platform`, `packages/core/tests/roundtrip.test.ts`).

---

## 8. Explicit non-goals and limits

- **No key escrow / recovery.** Lost password = unrecoverable file.
- **No anonymity.** File name and size are visible in the manifest and the
  (readable, unencrypted) package header.
- **No protection of existence/size** — an observer sees ~`originalSize + ε`.
- **Splitting is packaging, not security.** Security rests solely on the
  AES-256-GCM confidentiality + integrity and the strength of the password.
- **Manifest edits are detectable**, but the manifest is not itself signed;
  authentication comes from the AEAD layer, not a signature scheme.
- **`created`/`createdAt` are writer-clock values** — informational metadata
  for traceability, never a security input.
