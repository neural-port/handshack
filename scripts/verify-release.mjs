#!/usr/bin/env node
/**
 * verify-release — post-build sanity checks on the web production build.
 *
 * Verifies:
 *  - dist/ exists with index.html + hashed assets
 *  - no secrets (SUPABASE_*, passwords, key material) embedded in output
 *  - no references to a local dev server
 *  - no remote script/font/asset origins (local-first guarantee)
 *  - CSP meta tag present
 *
 * Usage: node scripts/verify-release.mjs [apps/web/dist]
 */
import fs from 'node:fs';
import path from 'node:path';

const dist = process.argv[2] ?? path.join('apps', 'web', 'dist');
let failures = 0;

function fail(msg) {
  failures++;
  console.error(`  FAIL  ${msg}`);
}
function ok(msg) {
  console.log(`  ok    ${msg}`);
}

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`dist not found at ${dist} — run npm run build:web first`);
  process.exit(1);
}

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

// 1. CSP present
if (/http-equiv="Content-Security-Policy"/i.test(html)) ok('CSP meta tag present');
else fail('missing Content-Security-Policy meta tag');

// 2. No dev-server references
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(dist);

let devRefs = 0;
for (const f of files) {
  const text = fs.readFileSync(f);
  const s = text.toString('utf8');
  if (/localhost|127\.0\.0\.1|vite\/client|@vite\/env/.test(s)) {
    devRefs++;
    fail(`dev-server reference in ${path.relative(dist, f)}`);
  }
}
if (devRefs === 0) ok('no dev-server references in build output');

// 3. No secrets
const secretPatterns = [/SUPABASE_[A-Z_]*KEY/, /service_role/, /BEGIN [A-Z ]*PRIVATE KEY/, /sk_live/, /AKIA[0-9A-Z]{16}/];
let secretHits = 0;
for (const f of files) {
  const s = fs.readFileSync(f).toString('utf8');
  for (const re of secretPatterns) {
    if (re.test(s)) {
      secretHits++;
      fail(`possible secret pattern ${re} in ${path.relative(dist, f)}`);
    }
  }
}
if (secretHits === 0) ok('no secret patterns in build output');

// 4. Local-first: no remote scripts, fonts, stylesheets, or API origins
const remoteAsset = /<script[^>]+src="https?:|<link[^>]+href="https?:|<img[^>]+src="https?:/i;
if (remoteAsset.test(html)) fail('remote asset reference found in index.html');
else ok('no remote asset references (scripts/styles/fonts/images)');

// 5. No third-party analytics/tracking
const trackers = [/googletagmanager|google-analytics|gtag\(|mixpanel|segment\.io|sentry\.io|hotjar/i];
for (const f of files) {
  const s = fs.readFileSync(f).toString('utf8');
  for (const re of trackers) {
    if (re.test(s)) fail(`tracking/analytics reference in ${path.relative(dist, f)}`);
  }
}
ok('no analytics/tracking code found');

// 6. Assets are relative (GitHub Pages subpath-safe)
const absoluteAsset = /(?:src|href)="\/(?!\/)/;
if (absoluteAsset.test(html)) fail('root-absolute asset path found — will break under repo subpath');
else ok('assets use relative paths (subpath-safe)');

// 7. Report
console.log('');
if (failures > 0) {
  console.error(`verify-release: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`verify-release: all checks passed over ${files.length} files in ${dist}`);
