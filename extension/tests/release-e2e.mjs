/**
 * The release rehearsal (Phase 8).
 *
 * Every other E2E suite drives the dev server and the working-tree extension.
 * This one drives what actually ships:
 *
 *   1. the **production web build** (`web/dist`), served as a static site
 *   2. the **packaged extension**, built for that origin and unzipped into a
 *      clean temporary directory — not `extension/`, which is the source
 *
 * That combination is the one nobody tests until something is broken in the
 * store: a file the packaging script forgot, an origin that was only ever
 * configured for `localhost:5173`, a bundle that behaves differently minified.
 *
 * The "production" origin here is `http://localhost:4173`. Loopback is a
 * secure context, so the camera still works, and it keeps the whole run
 * offline — the point is to prove the *pipeline*, not to reach the internet.
 *
 * Run:  node extension/tests/release-e2e.mjs        (add --headful to watch)
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findChrome,
  killChrome,
  launchChrome as spawnChrome,
  requirePortFree,
} from './chrome-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DIST = join(ROOT, 'web/dist');
const CHROME = findChrome();
const APP_PORT = 4173;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const SITE_PORT = 8098;
const TLS_PORT = 8444;
const CDP_PORT = 9335;
const HEADFUL = process.argv.includes('--headful');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Minimal CDP client (same shape as the other suites)                 */
/* ------------------------------------------------------------------ */

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res);
      this.ws.addEventListener('error', rej);
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: r, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : r(msg.result);
      }
    });
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

async function fetchJSON(path, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Chrome DevTools endpoint never came up (${path})`);
}

async function evalIn(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

/* ------------------------------------------------------------------ */
/* Static server for the production build                              */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.traineddata': 'application/octet-stream',
  '.gz': 'application/octet-stream',
};

/**
 * Serves `web/dist` with SPA fallback, exactly as any static host would.
 * Path traversal is refused — a test server that can read outside its root is
 * a bad habit even in a test.
 */
const app = createServer((req, res) => {
  const url = new URL(req.url, APP_ORIGIN);
  let file = join(DIST, normalize(url.pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('no');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const body = readFileSync(file);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
});

/* ------------------------------------------------------------------ */
/* Stub sites, so nothing leaves the machine                           */
/* ------------------------------------------------------------------ */

function respond(req, res) {
  const host = (req.headers.host || '').split(':')[0];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>${host}</title><h1 id="host">${host}</h1>`);
}
const site = createServer(respond);

function makeTlsOptions(dir) {
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes', '-subj', '/CN=lockin-release'],
    { stdio: 'ignore' },
  );
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

const profile = mkdtempSync(join(tmpdir(), 'lockin-release-'));
const unpacked = mkdtempSync(join(tmpdir(), 'lockin-unpacked-'));
let chrome = null;
let tls = null;
let swSession = null;

function launchChrome(extensionDir) {
  const args = [
    `--user-data-dir=${profile}`,
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--host-resolver-rules=MAP *.test 127.0.0.1:${SITE_PORT},` +
      `MAP youtube.com 127.0.0.1:${SITE_PORT},MAP www.youtube.com 127.0.0.1:${SITE_PORT},` +
      `MAP www.google.com 127.0.0.1:${TLS_PORT},MAP docs.google.com 127.0.0.1:${TLS_PORT}`,
    '--ignore-certificate-errors',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-search-engine-choice-screen',
    'about:blank',
  ];
  if (!HEADFUL) args.unshift('--headless=new');
  chrome = spawnChrome(CHROME, args);
}

async function attachWorker(browser) {
  for (let i = 0; i < 40; i += 1) {
    const targets = (await browser.send('Target.getTargets')).targetInfos;
    const worker = targets.find(
      (t) =>
        t.type === 'service_worker' &&
        t.url.startsWith('chrome-extension://') &&
        t.url.endsWith('/background/service-worker.js'),
    );
    if (worker) {
      const { sessionId } = await browser.send('Target.attachToTarget', {
        targetId: worker.targetId,
        flatten: true,
      });
      for (let ready = 0; ready < 20; ready += 1) {
        const has = await evalIn(browser, sessionId, `typeof chrome !== 'undefined'`).catch(
          () => false,
        );
        if (has) return { sessionId, extensionId: new URL(worker.url).hostname };
        await sleep(250);
      }
    }
    await sleep(250);
  }
  throw new Error('the packaged extension never registered a service worker');
}

async function swEval(cdp, expression) {
  try {
    return await evalIn(cdp, swSession, expression);
  } catch (error) {
    if (!/chrome is not defined|Cannot find context|Execution context/.test(error.message)) throw error;
    ({ sessionId: swSession } = await attachWorker(cdp));
    return await evalIn(cdp, swSession, expression);
  }
}

async function openTab(browser, url) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(1500);
  return { targetId, sessionId };
}

async function navigateAndGetUrl(browser, url) {
  const { targetId, sessionId } = await openTab(browser, url);
  const final = await evalIn(browser, sessionId, 'location.href');
  await browser.send('Target.closeTarget', { targetId });
  return final;
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

async function main() {
  console.log(`\nLockIn release rehearsal${HEADFUL ? ' (headful)' : ''}\n`);

  if (!CHROME) {
    console.log('  ! Chrome for Testing not found — set CHROME_BIN. Skipping.');
    return;
  }

  /* --- 1. Build the production website ------------------------------ */
  console.log('Production website build');
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
  check('`npm run build` produced web/dist', existsSync(join(DIST, 'index.html')));
  check('no test fixtures were copied into it', !existsSync(join(DIST, 'fixtures')));
  check('the OCR engine is bundled with it', existsSync(join(DIST, 'ocr')));

  /* --- 2. Package the extension for that origin ---------------------- */
  console.log('\nExtension packaging');
  execFileSync('node', [join(ROOT, 'scripts/build-extension.mjs'), '--zip'], {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, LOCKIN_ENV: 'production', LOCKIN_APP_ORIGIN: APP_ORIGIN },
  });

  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const zip = join(ROOT, `dist/lockin-extension-v${version}.zip`);
  check('the release zip was produced', existsSync(zip), zip.replace(`${ROOT}/`, ''));

  // Unzip into a clean directory: this is what a reviewer would load, and it
  // is the only way a missing file shows up rather than being silently read
  // from the working tree.
  execFileSync('unzip', ['-q', '-o', zip, '-d', unpacked]);
  check('the zip unpacks with manifest.json at its root', existsSync(join(unpacked, 'manifest.json')));

  const manifest = JSON.parse(readFileSync(join(unpacked, 'manifest.json'), 'utf8'));
  const relay = manifest.content_scripts.find((c) => c.js.includes('content/bridge.js'));
  check(
    'the packaged extension is configured for the production origin',
    relay.matches.includes(`${APP_ORIGIN}/*`),
    relay.matches.join(', '),
  );
  check(
    'and carries no development origin',
    !JSON.stringify(relay.matches).includes('5173'),
  );
  check('no test directory travelled with it', !existsSync(join(unpacked, 'tests')));

  /* --- 3. Serve and launch ------------------------------------------ */
  await requirePortFree(CDP_PORT, 'Chrome debug port');
  await requirePortFree(APP_PORT, 'production preview port');
  await new Promise((r) => app.listen(APP_PORT, '127.0.0.1', r));
  await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));
  tls = createTlsServer(makeTlsOptions(profile), respond);
  await new Promise((r) => tls.listen(TLS_PORT, '127.0.0.1', r));

  launchChrome(unpacked);
  const { webSocketDebuggerUrl } = await fetchJSON('/json/version');
  const browser = new CDP(webSocketDebuggerUrl);
  ({ sessionId: swSession } = await attachWorker(browser));

  /* --- 4. The production site loads and talks to the package -------- */
  console.log('\nProduction site ↔ packaged extension');
  const { targetId: appTab, sessionId: appSession } = await openTab(browser, `${APP_ORIGIN}/`);

  const consoleErrors = [];
  browser.ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
    }
  });

  const rendered = await evalIn(browser, appSession, 'document.body.innerText.length > 0');
  check('the production bundle renders', rendered === true);

  // The handshake, driven exactly as the app drives it.
  const pong = await evalIn(
    browser,
    appSession,
    `new Promise((resolve) => {
      const id = 'release-' + Math.random().toString(36).slice(2);
      const onMessage = (event) => {
        const d = event.data;
        if (d && d.source === 'lockin-extension' && d.requestId === id) {
          window.removeEventListener('message', onMessage);
          resolve(JSON.stringify(d.payload));
        }
      };
      window.addEventListener('message', onMessage);
      window.postMessage({ source: 'lockin-web', version: 1, type: 'PING', requestId: id }, window.location.origin);
      setTimeout(() => resolve('NO_REPLY'), 4000);
    })`,
  );
  check('the packaged extension answers the production origin', pong !== 'NO_REPLY', pong);
  if (pong !== 'NO_REPLY') {
    const info = JSON.parse(pong);
    check('it reports its version', info.version === version, info.version);
    check('and a protocol version the site understands', info.protocolVersion === 1);
  }

  /* --- 5. Focus Mode → blocked site → block page → unlock ----------- */
  console.log('\nFocus Mode through the packaged extension');
  const state = {
    focusModeActive: true,
    requiredTaskCount: 1,
    completedTaskCount: 0,
    currentTaskTitle: 'Math Worksheet',
    blockedDomains: ['distraction.test', 'youtube.com'],
    allowedDomains: ['school.test'],
    focusStartedAt: new Date().toISOString(),
    temporaryUnlockUntil: null,
    blockingEnabled: true,
    reminderMode: 'Strict',
    isTest: false,
    testExpiresAt: null,
    appUrl: `${APP_ORIGIN}/home`,
    canvasDomain: null,
  };
  await swEval(
    browser,
    `chrome.storage.local.set({ lockin_state: ${JSON.stringify(state)} }).then(() => 'ok')`,
  );
  await sleep(800);

  const blocked = await navigateAndGetUrl(browser, 'http://distraction.test/');
  check('a blocked site lands on the block page', blocked.includes('/blocked/blocked.html'), blocked);

  const allowed = await navigateAndGetUrl(browser, 'http://school.test/');
  check('an allowlisted school site still opens', allowed.startsWith('http://school.test'), allowed);

  const google = await navigateAndGetUrl(browser, 'https://docs.google.com/');
  check('Google Docs is never blocked', google.startsWith('https://docs.google.com'), google);

  // The block page has to be usable: it names the site and offers a way back.
  const { targetId: blockTab, sessionId: blockSession } = await openTab(
    browser,
    'http://distraction.test/',
  );
  const blockText = await evalIn(browser, blockSession, 'document.body.innerText');
  check('the block page names the site that was blocked', /distraction\.test/.test(blockText));
  check('and shows the work that is required', /Math Worksheet/.test(blockText));
  check(
    'and offers a way into LockIn',
    /Open LockIn/i.test(blockText),
    blockText.split('\n').filter(Boolean)[0],
  );
  check(
    'and does not shame the student',
    !/(lazy|shame|failure|pathetic|disappoint)/i.test(blockText),
  );
  await browser.send('Target.closeTarget', { targetId: blockTab });

  /* --- 6. Unlock ---------------------------------------------------- */
  await swEval(
    browser,
    `chrome.storage.local.set({ lockin_state: ${JSON.stringify({
      ...state,
      focusModeActive: false,
    })} }).then(() => 'ok')`,
  );
  await sleep(800);
  const unlocked = await navigateAndGetUrl(browser, 'http://distraction.test/');
  check('ending Focus Mode unblocks the site', unlocked.startsWith('http://distraction.test'), unlocked);

  const rules = await swEval(
    browser,
    `chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length)`,
  );
  check('and every blocking rule is withdrawn', rules === 0, `${rules} rules left`);

  /* --- 7. Console hygiene ------------------------------------------ */
  console.log('\nConsole');
  for (const path of ['/home', '/planner', '/assignments', '/exams', '/focus', '/settings', '/activity', '/help', '/privacy']) {
    const { targetId } = await openTab(browser, `${APP_ORIGIN}${path}`);
    await browser.send('Target.closeTarget', { targetId });
  }
  await sleep(500);
  const unexpected = consoleErrors.filter(
    (e) => e && !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/i.test(e),
  );
  check(
    'no unexpected console errors across the main screens',
    unexpected.length === 0,
    unexpected.slice(0, 3).join(' | ') || '0 errors',
  );

  await browser.send('Target.closeTarget', { targetId: appTab });
  browser.close();
}

async function cleanup() {
  if (chrome) await killChrome(chrome, CDP_PORT, profile);
  for (const server of [app, site, tls]) {
    try {
      server?.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(profile, { recursive: true, force: true });
  rmSync(unpacked, { recursive: true, force: true });
}

main()
  .catch((error) => {
    console.error('\n  ✖ release rehearsal crashed:', error.message);
    failures += 1;
  })
  .finally(async () => {
    await cleanup();
    console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
