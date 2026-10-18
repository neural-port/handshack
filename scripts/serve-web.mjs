#!/usr/bin/env node
/**
 * serve-web — tiny static server for checking the production web build locally,
 * optionally under a subpath (simulating GitHub Pages project sites).
 *
 *   node scripts/serve-web.mjs [port] [subpath]
 *
 * Default: http://localhost:4789/handshack/
 */
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/dist');
const port = Number(process.argv[2] ?? 4789);
const base = '/' + (process.argv[3] ?? 'handshack').replace(/^\/+|\/+$/g, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

if (!fs.existsSync(root)) {
  console.error(`No build at ${root} — run npm run build:web first.`);
  process.exit(1);
}

createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') return res.writeHead(302, { location: `${base}/` }).end();
  if (!url.startsWith(base)) {
    res.writeHead(404).end(`try ${base}/`);
    return;
  }
  url = url.slice(base.length) || '/';
  let p = path.normalize(path.join(root, url));
  if (!p.startsWith(root)) return res.writeHead(403).end();
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) p = path.join(root, 'index.html'); // SPA fallback
  const ext = path.extname(p);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => {
  console.log(`serving ${root}`);
  console.log(`  → http://localhost:${port}${base}/`);
});
