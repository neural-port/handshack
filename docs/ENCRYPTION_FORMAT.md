# HandShack Package Format — Specification v1

This document specifies the `handshack-package` format version `1`. It is the
contract between the HandShack Web demo and the HandShack Desktop app: any
conforming implementation must be able to decrypt packages produced by any
other conforming implementation.

---

## 1. Overview

A HandShack transfer consists of:

1. **N encrypted part files** — `BASENAME.partNNN.hsp` (`NNN` = 1-based index,
   zero-padded to ≥3 digits).
2. **One manifest** — `BASENAME.hsmanifest.json`, a JSON document describing
   the package (untrusted; cross-checked against authenticated data).

`BASENAME` is derived from the original file name after sanitization
(`sanitizeFileName` in `packages/core/src/validation.ts`): path structure and
dot-segments are removed, unsafe characters become `_`, control characters
become spaces, and the result is truncated to 96 code units.

There is **no compression, no encoding layer, no obfuscation**. Parts contain
only the encrypted package bytes described below. The manifest contains
metadata only — never the password, keys, or plaintext.

---

## 2. Cryptographic primitives

| Purpose            | Algorithm      | Parameters                                      |
| ------------------ | -------------- | ----------------------------------------------- |
| Key derivation     | scrypt         | N=32768, r=8, p=1, dkLen=32 (RFC 7914 defaults) |
| Salt               | CSPRNG         | 16 bytes, fresh per package                     |
| Bulk encryption    | AES-256-GCM    | 96-bit nonces, 128-bit tags                     |
| Integrity          | SHA-256        | original file + every part                      |
| Randomness         | `crypto.getRandomValues` / `node:crypto` CSPRNG |                    |

### Key derivation

```
key = scrypt(passwordUTF8, salt, N=32768, r=8, p=1, dkLen=32)
```

The manifest records the KDF parameters. Implementations MUST validate them
against safe limits (see `KDF_LIMITS`): N ∈ [4096, 2^20] power of two,
r ∈ [1, 32], p ∈ [1, 8], dkLen = 32, and the scrypt memory estimate
(`128·N·r`) must not exceed 512 MiB. Invalid combinations are rejected with
`kdf-params-out-of-range`.

### Record nonces

Each record `i` (0-based) uses a deterministic 96-bit nonce:

```
nonce_i = 0x00000000 || 0x00000000 || uint32be(i) || uint32be(i >> 32)
```

i.e. the last 8 bytes are the big-endian 64-bit record index; the first 4
bytes are zero. Nonces are unique per key because a fresh key is derived per
package (fresh salt) and indices never repeat within a stream.

### Additional authenticated data (AAD)

Each record's AAD binds it to the package and its position:

```
AAD_i = "HSP1" || uint32be(headerLen) || headerJSON || uint64be(i) || flags

flags = 1 (record is final) | 2 (header is first record's prefix — always set,
        since the header precedes record 0 in the stream)
```

This prevents reordering, duplication, truncation-by-record-removal, and
cross-package record transplant.

---

## 3. Encrypted package layout (the part stream)

```
┌──────────────────────┬───────────┬────────────────────────────────────────┐
│ Field                │ Size      │ Notes                                  │
├──────────────────────┼───────────┼────────────────────────────────────────┤
│ Magic                │ 4         │ ASCII "HSP1"                           │
│ Version              │ 4         │ uint32be = 1                           │
│ Header length        │ 4         │ uint32be, bytes of header JSON         │
│ Header JSON          │ headerLen │ UTF-8, see §4                          │
│ Record 0             │ 17+16     │ uint8 flags || ciphertext || 16B tag   │
│ Record 1             │ ...       │                                        │
│ ...                  │ ...       │                                        │
└──────────────────────┴───────────┴────────────────────────────────────────┘
```

Total package size = `8 + headerLen + Σ(recordSizes)`.

### Records

The plaintext is encrypted in fixed-size **records** of `RECORD_SIZE = 1 MiB`
(2^20 bytes) — the last record may be shorter (or even 0 bytes).

On the wire each record is:

```
flags (1 byte) || ciphertext (≤1 MiB) || GCM tag (16 bytes)
```

`flags` bit 0 (`HSF_LAST`) marks the final record; bit 1 (`HSF_HAS_HEADER`)
is always set (the header is part of the authenticated context, included via
AAD rather than inside record 0's ciphertext).

An empty file produces exactly one record: `{flags=3, ciphertext=∅, tag}`.

### Chunked into parts

The package byte stream is cut into parts of `chunkSize` bytes
(`1–4 MiB`, default 4 MiB): every part except the last is exactly `chunkSize`
long; the last holds the remainder. `partCount = ceil(packageSize/chunkSize)`
(minimum 1). Part boundaries are opaque to decryption — parts are reassembled
by simple concatenation in manifest order before interpretation.

---

## 4. The authenticated header (inside the package)

UTF-8 JSON, length prefixed:

```json
{
  "magic": "HSH1",
  "fileName": "photo.jpg",
  "origSize": 3245678,
  "origSha256": "<64-hex>",
  "salt": "<16 bytes base64url>",
  "kdfParams": { "n": 32768, "r": 8, "p": 1, "dkLen": 32 },
  "noncePrefix": "<4 bytes base64url>",
  "recordSize": 1048576,
  "flags": "header+records",
  "packageId": "hs_<30 base64url chars>"
}
```

Everything security-critical is **duplicated here under authentication**: the
header's integrity is enforced by GCM (its bytes are hashed into every record's
AAD). The manifest's copy of these fields is convenience metadata and is
cross-checked against the header during decryption.

`packageId` is 24 random bytes, base64url-encoded with the `hs_` prefix —
it lets both implementations detect mixed-up parts belonging to different
packages.

---

## 5. The manifest (`*.hsmanifest.json`)

```json
{
  "format": "handshack-package",
  "formatVersion": 1,
  "packageId": "hs_…",
  "createdAt": "2026-10-18T12:00:00.000Z",
  "generator": "handshack-web@0.1.0",
  "originalName": "photo.jpg",
  "originalSize": 3245678,
  "encryptedSize": 3248100,
  "chunkSize": 4194304,
  "partCount": 1,
  "algorithm": "AES-256-GCM",
  "kdf": "scrypt",
  "kdfParams": { "n": 32768, "r": 8, "p": 1, "dkLen": 32 },
  "salt": "<16 bytes base64url>",
  "parts": [
    { "name": "photo.jpg.part001.hsp", "size": 3248100, "sha256": "<64-hex>" }
  ]
}
```

Validation rules (fail-closed, `validateManifest`):

- `format` must equal `handshack-package`; `formatVersion` must be `1`
  (else `unsupported-version`).
- `algorithm` = `AES-256-GCM`, `kdf` = `scrypt` (else `unsupported-algorithm`).
- `kdfParams` within limits (`kdf-params-out-of-range`).
- `partCount` = `parts.length`, 1 ≤ partCount ≤ 4096 (`too-many-parts`).
- Every part `name` must parse to index `i` at position `i` (strict sequential
  naming, no gaps/dupes); `size` ≤ `chunkSize`; `sha256` = 64 lowercase hex.
- `Σ parts.size` must equal `encryptedSize` (`invalid-manifest`).
- `originalSize`, `encryptedSize` ≤ 4 GiB; manifest JSON ≤ 1 MiB.
- `salt` must decode to ≥8 bytes.

**The manifest is untrusted.** `packageId`, `originalName`, `originalSize`,
`salt`, `kdfParams`, and `encryptedSize` are re-verified against the
authenticated header during decryption (`invalid-package` on mismatch). A
manipulated manifest therefore cannot redirect, relabel, or resize the output.

---

## 6. Decryption pipeline (order of checks)

1. `validateManifest` (structural).
2. **Part matching** — every declared part present exactly once by name;
   foreign files rejected (`missing-parts` / `unexpected-files` /
   `duplicate-parts` / `part-mismatch` on size).
3. **Per-part SHA-256** vs manifest (`part-corrupt` — identifies the broken
   part by name before any crypto runs).
4. **Preamble + header parse** — magic/version (`invalid-package`),
   header size bounds, JSON shape.
5. **Cross-checks** — `packageId`, `originalSize`, `salt`, `kdfParams` must
   match the manifest; `originalName` is sanitized; the recomputed total
   stream size must equal the parts' combined size (`truncated-package`).
6. **Key derivation** — scrypt over header salt + validated params
   (`kdf-params-out-of-range` if outside limits).
7. **Per-record AEAD open** with positional AAD — wrong password or any
   corruption surfaces as `authentication-failed`.
8. **Final integrity** — SHA-256 of the decrypted stream must equal
   `origSha256` from the header (`integrity-failed`).
9. Only after all of the above succeed may the output be committed
   (`FileByteSink` buffers staged bytes and deletes them on `abort()`;
   in-memory sinks are discarded by GC).

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
are proven byte-identical by fixed-vector tests and reciprocal decryption
tests (`tests/cross-platform`, `packages/core/tests/roundtrip.test.ts`).

---

## 8. Explicit non-goals and limits

- **No key escrow / recovery.** Lost password = unrecoverable file.
- **No anonymity.** File name and size are visible in the manifest and the
  (readable) package header.
- **No protection of existence/size** — an observer sees ~`originalSize + ε`.
- **Splitting is packaging, not security.** Security rests solely on the
  AES-256-GCM confidentiality + integrity and the strength of the password.
- **Manifest edits are detectable**, but the manifest is not itself signed;
  authentication comes from the AEAD layer, not a signature scheme.
