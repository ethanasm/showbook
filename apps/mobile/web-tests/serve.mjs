#!/usr/bin/env node
// Tiny static server for the Expo web export.
//
// Playwright's webServer launches this between `pnpm mobile:web:build`
// (which produces `dist-web/`) and the test run. Kept dependency-free
// so the mobile workspace doesn't pull in a server library just for
// the headless verification loop.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(__dirname, '..', process.argv[2] || 'dist-web');
const port = Number(process.argv[3] || 4319);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

if (!fs.existsSync(root)) {
  console.error(`[mobile-web-serve] missing build dir: ${root}`);
  console.error(`[mobile-web-serve] run \`pnpm mobile:web:build\` first.`);
  process.exit(1);
}

function safeResolve(urlPath) {
  // Strip query string before joining the path so a request like
  // `/_expo/static/js/foo.js?platform=web` doesn't end up looking for
  // a file literally named `foo.js?platform=web`.
  const cleanPath = urlPath.split('?')[0];
  const decoded = decodeURIComponent(cleanPath);
  const resolved = path.resolve(root, '.' + decoded);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url || '/';
  let filePath = safeResolve(urlPath);
  if (!filePath) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  // SPA fallback: any unknown route serves index.html so client-side
  // routing (expo-router) takes over.
  if (!fs.existsSync(filePath)) {
    filePath = path.join(root, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, body) => {
    if (err) {
      res.writeHead(500);
      res.end('read error');
      return;
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mobile-web-serve] serving ${root} at http://127.0.0.1:${port}`);
});
