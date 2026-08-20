#!/usr/bin/env node
/**
 * Serves the built LockIn website, forever.
 *
 * This is what `npm run serve` and the always-on login service both run. It
 * deliberately serves `web/dist` — the production build — rather than starting
 * Vite:
 *
 *  - Vite's dev server watches the filesystem and holds a compiler in memory.
 *    It is built for an editing session, not for running for weeks in the
 *    background, and it is the thing that kept dying.
 *  - The production build is a folder of static files. Serving it is boring,
 *    which is exactly the property wanted here.
 *
 * The cost is that source changes need `npm run build` before they appear.
 * That is the right trade for something whose job is to always be up.
 *
 * Port 5173 is not a preference. The extension's committed configuration names
 * `http://localhost:5173` in three places (see scripts/gen-extension-config.mjs),
 * so serving anywhere else silently breaks blocking and Canvas.
 */
import { createServer } from 'node:http';
import * as canvasFeed from './canvas-feed.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'web', 'dist');
const PORT = Number(process.env.LOCKIN_PORT ?? 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.traineddata': 'application/octet-stream',
  '.gz': 'application/octet-stream',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(
    'web/dist is not built. Run `npm run build` first.\n' +
      '(The always-on service runs `npm run build` for you on login.)',
  );
  process.exit(1);
}

/**
 * The local bridge fence.
 *
 * Phase 17 removed the routes this guarded, along with the School Companion
 * that used them. The fence itself is kept — loopback binding, a non-CORS-simple
 * header, an origin check, no CORS headers on the way out — because it is the
 * correct shape for any future local endpoint, and because an empty route set
 * is a safe default: a route has to be named to exist.
 */
const BRIDGE_ROUTES = new Set([
  /** page → here: current state of the feed, minus the URL */
  '/api/canvas/status',
  /** page → here: store a feed URL (it crosses once, inbound, and never back) */
  '/api/canvas/connect',
  /** page → here: the raw ICS text, for the page's parser */
  '/api/canvas/feed',
  /** page → here: forget the URL entirely */
  '/api/canvas/disconnect',
]);

export function bridgeCallerAllowed(headers, port = PORT) {
  if (headers['x-lockin-bridge'] !== '1') return false;
  const origin = headers.origin;
  if (origin && origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) {
    return false;
  }
  return true;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/**
 * The Canvas feed routes.
 *
 * `/connect` is the only one that reads a body, and it reads at most 4KB — a
 * local endpoint that will buffer an unbounded upload is a denial of service
 * waiting to happen, even on loopback.
 *
 * None of these ever returns the feed URL. `/feed` returns the calendar text,
 * which is the student's own data and the whole point; `/status` returns the
 * host and some timestamps.
 */
async function handleCanvas(pathname, req, res) {
  if (pathname === '/api/canvas/status' && req.method === 'GET') {
    sendJson(res, 200, canvasFeed.toView());
    return;
  }

  if (pathname === '/api/canvas/feed' && req.method === 'GET') {
    const force = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('force') === '1';
    const result = await canvasFeed.fetchFeed({ force });
    sendJson(res, 200, { ...result, view: canvasFeed.toView() });
    return;
  }

  if (pathname === '/api/canvas/disconnect' && req.method === 'POST') {
    canvasFeed.disconnect();
    sendJson(res, 200, { ok: true, view: canvasFeed.toView() });
    return;
  }

  if (pathname === '/api/canvas/connect' && req.method === 'POST') {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 4096) {
        tooLarge = true;
        body = '';
      }
    });
    req.on('end', async () => {
      if (tooLarge) {
        sendJson(res, 413, { ok: false, reason: 'too-large' });
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendJson(res, 400, { ok: false, reason: 'not-a-url' });
        return;
      }
      const result = canvasFeed.connect(parsed?.url);
      if (!result.ok) {
        sendJson(res, 200, { ...result, view: canvasFeed.toView() });
        return;
      }
      // Fetch straight away, so "Connect" either works or says why — rather
      // than reporting success and failing quietly half an hour later.
      const fetched = await canvasFeed.fetchFeed({ force: true });
      if (!fetched.ok) canvasFeed.disconnect();
      sendJson(res, 200, {
        ok: fetched.ok,
        reason: fetched.ok ? undefined : fetched.reason,
        view: canvasFeed.toView(),
      });
    });
    return;
  }

  sendJson(res, 405, { ok: false, reason: 'method' });
}

const server = createServer((req, res) => {
  let file;
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    file = join(DIST, normalize(decodeURIComponent(url.pathname)));
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  // Path traversal is refused even here: this is bound to loopback, but a
  // server that can read outside its root is a bad habit at any scope.
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (BRIDGE_ROUTES.has(pathname)) {
    if (!bridgeCallerAllowed(req.headers)) {
      res.writeHead(403, { 'cache-control': 'no-store' }).end('forbidden');
      return;
    }
    void handleCanvas(pathname, req, res);
    return;
  }

  // SPA fallback — every unknown path is a client route, not a 404.
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');

  const isHtml = extname(file) === '.html';
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    // The HTML shell must never be cached, or a rebuild is invisible until a
    // hard refresh. Hashed assets underneath it can be cached hard.
    'cache-control': isHtml ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  res.end(readFileSync(file));
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use — something else is serving LockIn.\n` +
        `Find it with:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN`,
    );
    process.exit(1);
  }
  throw error;
});

/**
 * Only listen when run directly.
 *
 * The bridge tests import this file for `bridgeCallerAllowed`, and a module
 * that binds a port as an import side effect cannot be tested while the real
 * service is running — which, for an always-on LaunchAgent, is always.
 *
 * Loopback only. LockIn is local-first; there is no reason for this to be
 * reachable from the network, and screen capture needs a secure context anyway
 * (localhost qualifies, a LAN address does not).
 */
const runDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  // Keeps the feed warm while the service runs — including with Chrome shut.
  canvasFeed.startAutoRefresh();

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`LockIn is live at http://localhost:${PORT}`);
  });
}
