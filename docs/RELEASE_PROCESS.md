# Release Process

How a HandShack release goes from commit to published artifacts. **Honesty
rule: never describe an installer or portable build as available until the
workflow below has actually produced it.**

---

## 1. What ships where

| Artifact                        | Produced by                       | Published to      |
| ------------------------------- | --------------------------------- | ----------------- |
| Web demo (static site)          | `deploy-web.yml` on `main`        | GitHub Pages      |
| `HandShack-Setup-<v>.exe`       | `release-desktop.yml` on `v*` tag | GitHub Releases   |
| `HandShack-Portable-<v>.exe`    | `release-desktop.yml` on `v*` tag | GitHub Releases   |
| `SHA256SUMS.txt`                | `release-desktop.yml`             | GitHub Releases   |

---

## 2. Pre-flight (every release)

```powershell
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm test                    # unit + security + round-trip + UI
npm run test:integration    # cross-provider compatibility suite
npm run build:web           # static build → apps/web/dist
npm run verify:release      # CSP / secrets / remote-asset / subpath checks
npm run build:desktop       # renderer + main + preload → apps/desktop/out
```

All green → proceed. Any failure is release-blocking.

## 3. One-time repository setup

### 3.1 GitHub Pages (web demo)

1. Push the repository to GitHub.
2. **Settings → Pages → Source: "GitHub Actions"** (not "Deploy from branch").
3. The `deploy-web.yml` workflow deploys `apps/web/dist` on every push to
   `main`. The build uses relative asset paths, so it works under both
   `https://<user>.github.io/` and `https://<user>.github.io/<repo>/`.
4. Optional repository **Variables** (Settings → Secrets and variables →
   Actions → Variables) feed the landing page's real release links:

   | Variable                   | Purpose                                   |
   | -------------------------- | ----------------------------------------- |
   | `HANDSHACK_REPO_URL`       | Public repo URL shown in nav/footer        |
   | `HANDSHACK_RELEASE_VERSION`| Latest desktop version, e.g. `0.1.0`       |
   | `HANDSHACK_INSTALLER_URL`  | Direct installer `.exe` URL                |
   | `HANDSHACK_PORTABLE_URL`   | Direct portable `.exe` URL                 |
   | `HANDSHACK_NOTES_URL`      | Release-notes page URL                     |

   Until these are set, the landing page renders an honest "release pending"
   state — never a fake download button.

### 3.2 Pages environment

`deploy-web.yml` uses the `github-pages` environment automatically created by
GitHub on first deploy. Nothing else to configure.

---

## 4. Publishing a desktop release

```powershell
# 1. bump version consistently (root + workspace packages share the version)
npm version 0.1.0 --workspaces --include-workspace-root --no-git-tag-version

# 2. commit, tag, push
git add -A
git commit -m "release: v0.1.0"
git tag v0.1.0
git push origin main --tags
```

The tag push triggers `release-desktop.yml` on `windows-latest`, which:

1. `npm ci` → lint + typecheck + all tests (a red gate blocks publishing).
2. `npm run package:win` in `apps/desktop` — `electron-vite build` then
   `electron-builder` producing **both** targets in `apps/desktop/release/`:
   - `HandShack-Setup-<v>.exe` — NSIS installer (per-user, custom dir allowed)
   - `HandShack-Portable-<v>.exe` — single-file portable build
3. Generates `SHA256SUMS.txt` with `Get-FileHash` for every `.exe`.
4. Uploads artifacts to the workflow run (retained regardless of outcome).
5. **Creates the GitHub Release** (on tag pushes only) and attaches all three
   files with auto-generated notes.

### Manual dispatch

`workflow_dispatch` on `release-desktop.yml` runs the full build + artifact
upload without creating a release — useful for RC validation.

## 5. Verifying a release locally

```powershell
# After downloading HandShack-Setup-0.1.0.exe and SHA256SUMS.txt:
Get-FileHash .\HandShack-Setup-0.1.0.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt   # compare
```

The landing page can publish the installer hash once `HANDSHACK_*` variables
are populated — see §3.1.

## 6. Code signing (not yet configured)

The binaries are currently **unsigned**. Windows SmartScreen may warn until
reputation is established. To add signing:

1. Obtain a code-signing certificate (EV for instant SmartScreen trust).
2. Add secrets: `WIN_CSC_LINK` (base64 PFX) + `WIN_CSC_KEY_PASSWORD`.
3. `electron-builder` picks these up automatically from the environment.
4. Update `docs/SECURITY.md` (remove the unsigned-binaries limitation) and the
   README download notes.

Until then, the download section documents how to verify SHA-256 manually.

## 7. Versioning policy

- `formatVersion` (package format) only bumps on **breaking** format changes;
  older packages must remain decryptable or be rejected with a clear
  `unsupported-version` error.
- App versions are semver; patch releases never change the format.

## 8. Rollback

- **Web:** redeploy an earlier `main` commit via `workflow_dispatch`/revert.
  Static site — instant rollback.
- **Desktop:** mark the GitHub Release as pre-release/draft, or publish a
  superseding patch version. Never delete a tag whose release is public.
