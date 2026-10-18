# Web Privacy Notes

What the HandShack web demo does with your data — in plain terms.

## The short version

**Your files and passwords stay in your browser.** The web demo is a static
site: there is no HandShack server that receives, stores, or processes your
file contents or your password. Encryption, splitting, reassembly, and
decryption all run inside a Web Worker on your own device.

## What is processed locally

- The file you select (read into browser memory or streamed as Blob slices).
- Your password (used once to derive the encryption key; not saved anywhere).
- The generated encrypted parts and manifest (held in memory until you
  download them).

## What is NOT collected

- No accounts, no sign-up, no cookies for tracking.
- No analytics, telemetry, crash reporting, or fingerprinting code — check
  `scripts/verify-release.mjs`, which fails the build if tracker patterns
  appear in the output.
- No remote fonts, scripts, images, or iframes. The production CSP
  (`default-src 'self'`) prevents the page from loading remote code at all.

## What still leaves your device (indirectly)

- **Normal HTTPS hosting traffic.** When you load the site, the static host
  (e.g. GitHub Pages) sees your IP address, browser user-agent, and which files
  were fetched — standard web server logs. This does not include file contents
  or passwords.
- **Downloads of the app itself** — the JS/WASM assets are cached by your
  browser/CDN.

## Limits of browser-based privacy

Browser-based processing has limits the installed desktop app does not:

- **Malicious extensions** with page access could read what you type or select.
  Consider a clean profile, or use the desktop app.
- **A compromised browser or device** can capture input before encryption.
- **A compromised site deployment** could serve modified JavaScript. Verify
  you're on the correct URL; prefer the desktop app for high-sensitivity work.
- **Tab/disc memory** — browsers may page memory to disk; HandShack zeroes the
  buffers it controls, but cannot guarantee every transient copy is erased.
- **Download history** — browser download history retains file names of the
  parts you save. The operating system's file indexing may also surface names.

## Practical advice

- Use the **desktop app** for sensitive files — it runs offline with no
  browser attack surface.
- Share the **password separately** from the package, through a private
  channel.
- Treat the encrypted package as sensitive *metadata*: it reveals the file
  name and size even though contents stay confidential.

## Verifying these claims yourself

1. Open browser DevTools → Network tab before selecting a file.
2. Run an encrypt/decrypt operation.
3. Observe: **zero network requests** carrying your file bytes or password
   (the only traffic is static asset fetches you already saw at page load).
4. `scripts/verify-release.mjs` programmatically checks the shipped build for
   remote asset references, trackers, and secret patterns.

## Contact

Questions about these notes: open a GitHub Discussion on the project
repository. Security issues: see `docs/SECURITY.md` for private reporting.
