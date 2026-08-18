/**
 * Local HTTPS server that impersonates a school Canvas host for tests.
 *
 * Serves the sanitized fixture pages, and (for parser tests) the extension's
 * own Canvas modules so they can be imported into the page and run against a
 * real DOM. Nothing leaves the machine: Chrome is started with
 * --host-resolver-rules pointing the fake Canvas hostname here.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS_FIXTURES, SUBMITTED_VARIANTS } from './fixtures/canvas/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS_MODULE_DIR = resolve(HERE, '../canvas');

export function makeTlsOptions(dir) {
  const key = join(dir, 'canvas-key.pem');
  const cert = join(dir, 'canvas-cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
     '-days', '1', '-nodes', '-subj', '/CN=lockin-canvas-fixture'],
    { stdio: 'ignore' },
  );
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

/**
 * @param {object} options
 * @param {string} options.certDir  where to write the throwaway self-signed cert
 * @returns a server plus `setSubmitted()` to simulate the student submitting
 */
export function createCanvasFixtureServer({ certDir }) {
  /** Paths currently switched to their "submitted" variant. */
  const submitted = new Set();

  const server = createServer(makeTlsOptions(certDir), (req, res) => {
    const url = new URL(req.url, 'https://fixture.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Extension Canvas modules, for importing into the page in parser tests.
    if (path.startsWith('/module/')) {
      const name = path.slice('/module/'.length);
      if (!/^[a-z]+\.js$/.test(name)) {
        res.writeHead(404).end('no');
        return;
      }
      try {
        const body = readFileSync(join(CANVAS_MODULE_DIR, name), 'utf8');
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(body);
      } catch {
        res.writeHead(404).end('no module');
      }
      return;
    }

    const html = submitted.has(path) ? SUBMITTED_VARIANTS[path] : CANVAS_FIXTURES[path];
    if (!html) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Not found</title><h1>404</h1>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  return {
    server,
    listen: (port) => new Promise((r) => server.listen(port, '127.0.0.1', r)),
    close: () => server.close(),
    /** Flip an assignment page to its submitted variant, as if the student handed it in. */
    setSubmitted: (path) => submitted.add(path),
    clearSubmitted: () => submitted.clear(),
  };
}
