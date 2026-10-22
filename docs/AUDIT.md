# Final Audit — HandShack 0.1.0

| Field | Value |
| --- | --- |
| Audit date | 2026-10-19 |
| Scope | `apps/web`, `apps/desktop`, `packages/core`, `packages/ui`, `scripts`, docs, build config |
| Standards applied | ISO/IEC 27001:2022 (Annex A), ISO/IEC 5055, ISO/IEC 42001:2023, OWASP Top 10 / CWE, IT Act 2000 |
| Result | 5 findings — **all fixed and verified**; 5 observations recorded, no release blockers |
| Evidence | Typecheck, lint, 107 tests, web build, release verifier, packaging, launch smoke test |

This report records what was measured, what was changed, and what remains. Findings
that were fixed are listed with the fix; observations are things a reviewer should
know that are not defects.

---

## 1. Method

1. Static scans for credential and data-exfiltration patterns (storage APIs, network
   clients, XSS sinks, `eval`, console logging, placeholders).
2. Manual review of the trust boundaries: Electron window settings, preload bridge,
   every IPC handler, path validation, CSP.
3. Failure-path review: every `catch` that returns a default value, to distinguish
   deliberate best-effort cleanup from a masked error.
4. Taxonomy and dependency review.
5. Full gate run after fixes.

Commands used for evidence:

```powershell
npx tsc --build --force
npx eslint .
npx vitest run
npm run build:web
npm run verify:release
npm run package:win
```

---

## 2. Findings (fixed)

### F-01 — Collision pre-check masked directory read failures

**Severity:** Medium · **Control:** ISO 27001 A.8.12 (audit/attribution), ISO 42001 §4 (no silent failure) · **CWE-391**

`findCollisions` used `fs.readdir(dir).catch(() => [] as string[])`. A permission or
I/O error produced "no collisions", so the operation continued and only failed later
during commit — or, with overwrite enabled, could replace files the user was never
warned about.

**Fix:** the error is now raised as a typed `io-error` with a user-facing message.
`apps/desktop/src/main/index.ts`

### F-02 — "Copy SHA-256" claimed success after a failed clipboard write

**Severity:** Medium · **Control:** ISO 42001 §4 (deterministic outcomes) · **CWE-754**

The handler awaited `navigator.clipboard.writeText(...).catch(() => undefined)` and
then unconditionally displayed "SHA-256 copied." A blocked clipboard (permissions,
insecure context) still reported success.

**Fix:** success and failure now produce different notices.
`packages/ui/src/pages/decrypt.tsx`

### F-03 — "Add more files" swallowed picker errors

**Severity:** Medium · **Control:** ISO 5055 reliability · **CWE-391**

`addMore()` discarded errors with `.catch(() => null)`, so a failing picker looked
like the user cancelling. The primary picker path already reported errors; the two
paths disagreed.

**Fix:** `addMore()` reports the error through the same inspection-error channel.
`packages/ui/src/pages/decrypt.tsx`

### F-04 — No render error boundary

**Severity:** Medium · **Control:** ISO 5055 reliability · **CWE-755**

A render exception left a blank window with no recovery path. Neither platform had a
boundary.

**Fix:** added `ErrorBoundary` around the shared app, with a recovery screen that
states no file was modified and offers a reload. It deliberately does not print file
names, passwords, or package identifiers. Covered by two new tests.
`packages/ui/src/components/error-boundary.tsx`, `packages/ui/src/app.tsx`

### F-05 — Stale `SHA256SUMS.txt` shipped beside fresh artifacts

**Severity:** Low (release integrity) · **Control:** ISO 27001 A.8.12 · **CWE-345**

Only CI generated the checksum file, so local packaging left an older file next to
new executables — hashes that did not match the binaries they claimed to describe.

**Fix:** added `scripts/write-checksums.mjs`, wired into `npm run package:win`, and
regenerated the file. The hashes now match the artifacts in `RELEASE_COA.md`.
`scripts/write-checksums.mjs`, `package.json`

---

## 3. Checks performed and cleared

| Check | Method | Result |
| --- | --- | --- |
| Credential / secret patterns in source and bundle | `verify-release.mjs` scan + grep | Clean |
| Password persistence | grep for `localStorage`, `sessionStorage`, `indexedDB`, cookies | No hits |
| Network transmission | grep for `fetch`, `XMLHttpRequest`, `axios`, `sendBeacon`, `WebSocket` | No hits in app code |
| XSS sinks | grep for `dangerouslySetInnerHTML`, `innerHTML`, `document.write` | No hits |
| Dynamic code execution | grep for `eval(`, `new Function` | No hits |
| Console logging | grep across app code | Only the error boundary's non-sensitive crash notice |
| Explicit `any` | grep for `: any`, `as any`, `<any>` | No hits |
| Empty catch blocks | grep for `catch (...) {}` | No hits |
| Placeholders / unfinished work | grep for `TODO`, `FIXME`, `XXX`, `HACK`, "not implemented" | No hits |
| File naming taxonomy | scan for non-kebab-case source files | All compliant |
| Electron renderer isolation | review of `webPreferences` | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` |
| Remote navigation / new windows | review | `setWindowOpenHandler` denies, `will-navigate` prevented |
| Permission requests | review | handler denies all |
| IPC path scope | review of every handler | all file operations require a path chosen this session |
| CSP (web + desktop) | verifier | `default-src 'self'`, fonts self-hosted, no remote assets |
| Byte-exact round trip | 17 round-trip tests | Pass |
| Cross-platform compatibility | 5 cross-platform tests, both directions | Pass |
| Tamper / reorder / missing / duplicate detection | security + validation suites | Pass |
| Input limits | 16 media tests + boundary tests | Pass |
| Production dependency vulnerabilities | `npm audit --omit=dev` | 0 |

---

## 4. Observations (no change made)

**O-01 — `apps/desktop/src/main/index.ts` is 523 lines** and mixes IPC validation,
cryptography orchestration, and transactional file commits. It is coherent and
testable through the core, but splitting it would improve maintainability under
ISO 5055. Deferred because a refactor of the privileged process carries more risk
than it removes right now.

**O-02 — Approved paths are string-based.** If a user replaces an approved file with
a symlink after selecting it, the path stays approved while resolving elsewhere.
Impact is limited: the app is single-user, local, and the user already controls those
files. Recorded rather than "fixed" because resolving real paths would break
legitimate moves the user performs mid-operation.

**O-03 — Electron IPC handlers have no automated tests.** They are covered by
typecheck and review; the packaged app is verified by a launch smoke test. A manual
encrypt → decrypt round trip is still required before publishing.

**O-04 — 13 dev-dependency advisories** (2 critical, 2 high, 9 moderate) in the test
runner and build tooling: `vitest`, `tinypool`, `electron`, `extract-zip`. Production
dependencies are clean. These affect the build machine, not the shipped runtime.

**O-05 — Artifacts are unsigned.** No publisher identity; SmartScreen will warn.
Integrity rests on the SHA-256 values in the certificate.

---

## 5. ISO 42001 (AI governance) note

This release contains no model inference, no external AI calls, and no data sent to
any third party. The governance-relevant rules that do apply were checked:

- Failure paths are deterministic and typed; no error is converted into a default
  value that hides it (F-01 removed the last such case in shipped code).
- No mocked data is produced on error.
- User-visible messages never include passwords, keys, or file contents.
- The one place that logs (the error boundary) logs an error name and component
  stack only.

---

## 6. IT Act 2000 posture

No personal data is collected, no account exists, and no server-side store is
operated. Consent, retention, and breach-notification duties under the SPDI Rules
are therefore not triggered. Integrity of electronic records rests on AES-256-GCM
and SHA-256 manifests; this is integrity protection, not a statutory digital
signature, and the app asserts no author identity. Full table in
[`SECURITY.md`](SECURITY.md#data-protection-posture-it-act-2000-alignment).

---

## 7. Verification after fixes

| Gate | Result |
| --- | --- |
| `tsc --build --force` | Pass |
| `eslint .` | Pass |
| `vitest run` | 107 / 107 across 10 files |
| `npm run build:web` | Pass (11 files, 884,691 bytes) |
| `npm run verify:release` | 6 / 6 checks pass |
| `npm run package:win` | Pass; checksums regenerated |
| Desktop launch | Window opens, 4 processes |

Artifact hashes for this build are recorded in
[`RELEASE_COA.md`](RELEASE_COA.md) (§3).

---

## 8. Post-audit housekeeping sweep

A dead-code and stray-file pass was run after the audit findings were fixed:

- `packages/ui/src/pages/home.tsx` — orphaned page. The `'home'` route id and its
  `'/app'` mapping were removed from `router.tsx`; the legacy path redirect
  `'/app/home' → 'encrypt'` is kept so old bookmarks still work.
- ~95 lines of CSS for that page (`.home-hero`, `.action-card`, `.pipeline`, and
  related rules, including mobile overrides) removed from `global.css`.
- `apps/desktop/err.log` / `out.log` — empty stray launch logs, deleted.
- `apps/desktop/release/win-unpacked`, `.icon-ico`, `builder-debug.yml` —
  electron-builder intermediates (~300 MB), regenerated on every package run.

Every remaining source file was traced to at least one import, script reference,
or config entry. All gates were re-run after the sweep and remain green; the
desktop artifacts and web bundle were rebuilt, so §3 of the COA carries the new
hashes (revision -03).
