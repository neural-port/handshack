# HandShack

**Encrypt. Split. Share. Rebuild.**
Private files. Protected before they leave your device.

HandShack encrypts a local file with authenticated encryption (AES-256-GCM +
scrypt), splits the encrypted package into shareable parts, and rebuilds the
exact original bytes when all parts and the password come together — in the
browser or on Windows, fully offline, with no accounts and no server-side file
handling.

- **`apps/web`** — HandShack Web demo (static site, GitHub Pages)
- **`apps/desktop`** — HandShack Desktop (Electron, Windows installer + portable)
- **`packages/core`** — shared cryptographic engine & package format
- **`packages/ui`** — shared React design system & workflows

Packages are cross-compatible: a file encrypted in the browser decrypts in the
desktop app and vice versa — verified by automated tests.

---

## Quick start

```powershell
npm install          # installs all workspace deps (Node ≥ 20.19; 22.x recommended)

npm run dev:web      # web demo → http://localhost:5173
npm run dev:desktop  # Electron dev mode (hot reload)

npm test             # all unit + security + round-trip + UI + compat tests
npm run lint         # eslint
npm run typecheck    # strict TypeScript project build
```

## Input limits

| Input | Limit |
|---|---|
| Any file | 1 GB |
| Video | 1080p or smaller (the shorter side may not exceed 1080 px) |

The 1080p rule is checked by reading container headers only — HandShack never
decodes or re-encodes media. MP4, M4V, MOV, 3GP, MKV, and WebM can be verified;
other video containers are rejected rather than accepted without a check.
Packages created by earlier builds that recorded files up to 4 GB can still be
decrypted.

## Using the web demo

1. `npm run dev:web` → open `http://localhost:5173` (or open the deployed site).
2. **Encrypt & Split**: pick a file, choose part size (1–4 MiB), set a password
   (≥8 chars) → get `name.hsmanifest.json` + `name.partNNN.hsp` files —
   download individually or as one ZIP.
3. **Reassemble & Decrypt**: select the manifest + all parts (or the ZIP),
   enter the password → the restored file verifies integrity and downloads.

Production build + local preview under a Pages-style subpath:

```powershell
npm run build:web        # → apps/web/dist
npm run verify:release   # CSP / secrets / remote-assets / subpath checks
npm run serve:web        # → http://localhost:4789/handshack/
```

## Building the Windows desktop app

```powershell
cd apps/desktop
npm run build            # renderer + main + preload → out/
npm run package:win      # electron-builder → release/*.exe
```

Produces in `apps/desktop/release/`:

- `HandShack-Setup-<version>.exe` — NSIS installer
- `HandShack-Portable-<version>.exe` — portable single file

Unsigned binaries: verify hashes and expect a SmartScreen prompt until
signing is configured — see `docs/RELEASE_PROCESS.md`.

## Documentation

| Doc | Contents |
| --- | --- |
| [`docs/ENCRYPTION_FORMAT.md`](docs/ENCRYPTION_FORMAT.md) | Byte-level package format v1, KDF params, record/AAD scheme, validation rules |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, honest limitations, vuln reporting |
| [`docs/WEB_PRIVACY.md`](docs/WEB_PRIVACY.md) | What the web demo does/doesn't send + browser limits |
| [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md) | Pages deployment, desktop release workflow, signing |
| [`docs/RELEASE_COA.md`](docs/RELEASE_COA.md) | Certificate of Analysis for 0.1.0: artifact hashes, measured gates, open items |
| [`docs/AUDIT.md`](docs/AUDIT.md) | Final audit: findings and fixes, cleared checks, observations, residual risk |

## Repository layout

```
├── .github/workflows/      # test · deploy-web · release-desktop
├── apps/
│   ├── web/                # Vite static app (landing + demo)
│   └── desktop/            # Electron (main/preload/renderer) + electron-builder
├── packages/
│   ├── core/               # @handshack/core — crypto, format, pipelines
│   │   ├── src/crypto/     # providers (web+node), records, header
│   │   ├── src/package/    # manifest, split router, encrypt/decrypt
│   │   ├── src/io/         # byte sources/sinks (Blob, memory, fs, router)
│   │   └── tests/          # unit, security, round-trip, cross-provider
│   └── ui/                 # @handshack/ui — design system + pages + tests
├── scripts/                # verify-release.mjs · serve-web.mjs
└── tests/cross-platform/   # end-to-end web↔desktop compatibility suite
```

## Honest security notes

- **Splitting is packaging, not encryption.** Safety comes from AES-256-GCM
  + your password — never from splitting alone.
- **Anyone holding all parts + manifest + password can recover the file.**
  Share the password through a separate private channel.
- **A lost password is unrecoverable.** There is no backdoor.
- File name and size remain visible in the manifest — treat the package as
  sensitive metadata even though contents are confidential.
- Browser processing is local by design but inherits browser/extension/device
  trust; the desktop app gives stronger isolation. Full details:
  `docs/SECURITY.md`, `docs/WEB_PRIVACY.md`.

## License

MIT — see [LICENSE](LICENSE). HandShack is an independent project, not
affiliated with or endorsed by any existing company.
