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
 * Phase 16 removed the Edgenuity reading endpoints this originally guarded;
 * the fence itself is kept, unchanged, because the School Companion bridge
 * (see HANDOFF, Phase 16 Part 8) mounts behind exactly these rules:
 *
 *   - loopback only (the listener below binds 127.0.0.1);
 *   - the request must carry `x-lockin-bridge`, which is not a CORS-simple
 *     header. That forces any cross-origin caller through a preflight this
 *     server never answers, so a random web page cannot reach these routes
 *     even though the port is guessable;
 *   - `Origin`, when present, must be this server's own;
 *   - no CORS headers ever come back, so nothing off-origin can read a reply
 *     even if it manages to send a request.
 *
 * `BRIDGE_ROUTES` is empty until a route is deliberately added to it. An empty
 * set is the correct default: a route that has to be named to exist cannot be
 * created by accident.
 */
const BRIDGE_ROUTES = new Set();

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
    res.writeHead(404, { 'cache-control': 'no-store' }).end('not found');
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
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`LockIn is live at http://localhost:${PORT}`);
  });
}
