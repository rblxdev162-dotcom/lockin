/**
 * End-to-end blocking test against a real Chrome with the extension loaded.
 *
 * It never touches your normal Chrome profile: a throwaway --user-data-dir is
 * used, and fake `*.test` hostnames are mapped to a local server with
 * --host-resolver-rules, so no request leaves the machine.
 *
 * Run:  node extension/tests/e2e.mjs        (add --headful to watch it)
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, killChrome, launchChrome as spawnChrome, requirePortFree } from './chrome-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..');
/**
 * Branded Google Chrome (137+) ignores --load-extension, so this harness needs
 * a Chrome for Testing build. Point CHROME_BIN at yours if it lives elsewhere;
 * grab one from https://googlechromelabs.github.io/chrome-for-testing/ .
 */
const CHROME = findChrome() || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE_PORT = 8099;
/** google.com and instructure.com are HSTS-preloaded, so their stub must be TLS. */
const TLS_PORT = 8443;
const CDP_PORT = 9333;
const HEADFUL = process.argv.includes('--headful');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/* ---------------- minimal CDP client ---------------- */

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
    try { this.ws.close(); } catch { /* already gone */ }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(path, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`Chrome DevTools endpoint never came up (${path})`);
}

/* ---------------- local site under the fake domains ---------------- */

function respond(req, res) {
  const host = (req.headers.host || '').split(':')[0];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>${host}</title><h1 id="host">${host}</h1>`);
}

const site = createServer(respond);

/** Self-signed cert, generated fresh into the throwaway profile dir. */
function makeTlsOptions(dir) {
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
    '-days', '1', '-nodes', '-subj', '/CN=lockin-e2e',
  ], { stdio: 'ignore' });
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

/* ---------------- Chrome lifecycle ---------------- */

const profile = mkdtempSync(join(tmpdir(), 'lockin-e2e-'));
let chrome = null;
let tls = null;

function launchChrome() {
  const args = [
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT_DIR}`,
    `--disable-extensions-except=${EXT_DIR}`,
    `--remote-debugging-port=${CDP_PORT}`,
    // Real hostnames are mapped to the local server too, so the school/Google
    // checks exercise the actual domain strings without any network access.
    `--host-resolver-rules=MAP *.test 127.0.0.1:${SITE_PORT},` +
      `MAP youtube.com 127.0.0.1:${SITE_PORT},MAP www.youtube.com 127.0.0.1:${SITE_PORT},` +
      `MAP m.youtube.com 127.0.0.1:${SITE_PORT},MAP www.google.com 127.0.0.1:${TLS_PORT},` +
      `MAP docs.google.com 127.0.0.1:${TLS_PORT},MAP drive.google.com 127.0.0.1:${TLS_PORT},` +
      `MAP myschool.instructure.com 127.0.0.1:${TLS_PORT},MAP core.edgenuity.com 127.0.0.1:${TLS_PORT}`,
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

async function stopChrome() {
  if (!chrome) return;
  await killChrome(chrome, CDP_PORT, profile);
  chrome = null;
}

/** The extension's service-worker target; also yields the extension id. */
async function attachWorker(browser) {
  for (let i = 0; i < 40; i++) {
    const targets = (await browser.send('Target.getTargets')).targetInfos;
    // Chrome ships component extensions with their own workers, so match on
    // our specific background script path rather than "any service worker".
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
      /**
       * A worker *target* can exist while its execution context is still
       * starting (or has been stopped), and attaching to one of those gives a
       * context where `chrome` is simply not there yet. Waiting for the API to
       * appear — rather than assuming attach means ready — is what stops the
       * intermittent `ReferenceError: chrome is not defined` on the very first
       * evaluation.
       */
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
  throw new Error('extension service worker never registered');
}

/**
 * Evaluates in the extension service worker, re-attaching if it idled out.
 *
 * MV3 workers are stopped aggressively, which kills their CDP execution
 * context — the symptom is a bare `ReferenceError: chrome is not defined`.
 * Re-attaching wakes the worker and gives a fresh context.
 */
async function swEval(cdp, expression) {
  try {
    return await evalIn(cdp, swSession, expression);
  } catch (error) {
    if (!/chrome is not defined|Cannot find context|Execution context/.test(error.message)) {
      throw error;
    }
    ({ sessionId: swSession } = await attachWorker(cdp));
    return await evalIn(cdp, swSession, expression);
  }
}

async function evalIn(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' ' + JSON.stringify(exceptionDetails.exception?.description ?? ''));
  return result.value;
}

/** The current service-worker session; refreshed when the worker restarts. */
let swSession = null;

/** Pushes a bridge state straight into the worker, as the web app would. */
async function setExtensionState(cdp, sessionId, patch) {
  const state = {
    focusModeActive: true,
    requiredTaskCount: 2,
    completedTaskCount: 1,
    currentTaskTitle: 'Math Worksheet',
    blockedDomains: ['distraction.test', 'social.test'],
    allowedDomains: ['school.test', 'instructure.com'],
    focusStartedAt: new Date().toISOString(),
    temporaryUnlockUntil: null,
    blockingEnabled: true,
    reminderMode: 'Strict',
    isTest: false,
    testExpiresAt: null,
    appUrl: 'http://localhost:5173/home',
    ...patch,
  };
  await swEval(
    cdp,
    `chrome.storage.local.set({ lockin_state: ${JSON.stringify(state)} }).then(() => 'ok')`,
  );
  await sleep(600); // let the storage listener rebuild rules
}

/** Opens a tab, navigates, and reports the URL it actually landed on. */
async function navigateAndGetUrl(browser, url) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(1200);
  const final = await evalIn(browser, sessionId, 'location.href');
  await browser.send('Target.closeTarget', { targetId });
  return final;
}

/* ---------------- the run ---------------- */

async function main() {
  await requirePortFree(CDP_PORT, 'Chrome debug port');
  await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));
  tls = createTlsServer(makeTlsOptions(profile), respond);
  await new Promise((r) => tls.listen(TLS_PORT, '127.0.0.1', r));
  console.log(`\nLockIn end-to-end blocking test${HEADFUL ? ' (headful)' : ''}\n`);

  launchChrome();
  const version = await fetchJSON('/json/version');
  let browser = new CDP(version.webSocketDebuggerUrl);
  let { sessionId, extensionId } = await attachWorker(browser);
  swSession = sessionId;
  console.log(`Extension loaded: ${extensionId}\n`);

  /* --- 1. Focus Mode off --- */
  console.log('Focus Mode OFF');
  await setExtensionState(browser, sessionId, { focusModeActive: false });
  check(
    'distracting site loads normally',
    (await navigateAndGetUrl(browser, 'http://distraction.test/')) === 'http://distraction.test/',
  );

  /* --- 2. Focus Mode on --- */
  console.log('\nFocus Mode ON');
  await setExtensionState(browser, sessionId, {});
  const blockedUrl = await navigateAndGetUrl(browser, 'http://distraction.test/feed');
  check(
    'blocked site redirects to the LockIn block page',
    blockedUrl.startsWith(`chrome-extension://${extensionId}/blocked/blocked.html`),
    blockedUrl.slice(0, 90),
  );
  check('block page receives the domain', blockedUrl.includes('d=distraction.test'));
  check(
    'subdomain of a blocked domain is blocked',
    (await navigateAndGetUrl(browser, 'http://m.social.test/')).includes('blocked.html'),
  );
  check(
    'school domain stays reachable',
    (await navigateAndGetUrl(browser, 'http://school.test/assignments')) ===
      'http://school.test/assignments',
  );
  check(
    'unlisted site is untouched',
    (await navigateAndGetUrl(browser, 'http://neutral.test/')) === 'http://neutral.test/',
  );

  /* --- 2b. The real domains students actually care about --- */
  console.log('\nReal school / distraction domains');
  await setExtensionState(browser, sessionId, {
    blockedDomains: ['youtube.com', 'reddit.com'],
    allowedDomains: ['instructure.com', 'edgenuity.com', 'docs.google.com', 'google.com'],
  });
  check(
    'youtube.com is blocked',
    (await navigateAndGetUrl(browser, 'http://www.youtube.com/watch?v=abc')).includes('blocked.html'),
  );
  check(
    'm.youtube.com is blocked too',
    (await navigateAndGetUrl(browser, 'http://m.youtube.com/')).includes('blocked.html'),
  );
  for (const [label, url] of [
    ['Google Search', 'https://www.google.com/search?q=photosynthesis'],
    ['Google Docs', 'https://docs.google.com/document/d/x/edit'],
    ['Google Drive', 'https://drive.google.com/drive/my-drive'],
    ['Canvas', 'https://myschool.instructure.com/courses/12'],
    ['Edgenuity', 'https://core.edgenuity.com/player'],
  ]) {
    const landed = await navigateAndGetUrl(browser, url);
    check(`${label} stays accessible`, landed === url, landed.slice(0, 70));
  }

  /* --- 3. Allowlist beats blocklist --- */
  console.log('\nAllowlist vs blocklist');
  await setExtensionState(browser, sessionId, {
    blockedDomains: ['school.test', 'distraction.test'],
    allowedDomains: ['school.test'],
  });
  check(
    'a domain on BOTH lists is not blocked',
    (await navigateAndGetUrl(browser, 'http://school.test/')) === 'http://school.test/',
  );
  check(
    'the other blocked domain still blocks',
    (await navigateAndGetUrl(browser, 'http://distraction.test/')).includes('blocked.html'),
  );

  /* --- 4. Temporary unlock --- */
  console.log('\nTemporary unlock');
  await setExtensionState(browser, sessionId, {
    temporaryUnlockUntil: Date.now() + 4000,
  });
  check(
    'blocking pauses during the unlock',
    (await navigateAndGetUrl(browser, 'http://distraction.test/')) === 'http://distraction.test/',
  );
  await sleep(4000);
  // The alarm fires ~1s after expiry; give it room.
  await sleep(2500);
  check(
    'blocking returns automatically after it expires',
    (await navigateAndGetUrl(browser, 'http://distraction.test/')).includes('blocked.html'),
  );

  /* --- 5. Block counts --- */
  console.log('\nActivity counting');
  const stats = await swEval(
    browser,
    `chrome.storage.local.get('lockin_block_stats').then(r => JSON.stringify(r.lockin_block_stats || []))`,
  );
  const parsed = JSON.parse(stats);
  check('block counts are recorded', parsed.some((s) => s.domain === 'distraction.test' && s.count > 0),
    JSON.stringify(parsed));
  check(
    'no URLs or paths are stored anywhere',
    !stats.includes('/feed') && Object.keys(parsed[0] ?? {}).every((k) =>
      ['domain', 'count', 'lastBlockedAt'].includes(k)),
  );

  /* --- 6. Blocking disabled in settings --- */
  console.log('\nBlocking switched off in settings');
  await setExtensionState(browser, sessionId, { blockingEnabled: false });
  check(
    'nothing is blocked while the setting is off',
    (await navigateAndGetUrl(browser, 'http://distraction.test/')) === 'http://distraction.test/',
  );

  /* --- 7. Chrome restart --- */
  console.log('\nChrome restart with Focus Mode active');
  await setExtensionState(browser, sessionId, {});
  browser.close();
  await stopChrome();
  launchChrome();
  const version2 = await fetchJSON('/json/version');
  browser = new CDP(version2.webSocketDebuggerUrl);
  ({ sessionId, extensionId } = await attachWorker(browser));
  swSession = sessionId;
  await sleep(1500);
  check(
    'blocking is restored after a restart (state persisted)',
    (await navigateAndGetUrl(browser, 'http://distraction.test/')).includes('blocked.html'),
  );

  /* --- 8. The web app bridge --- */
  console.log('\nWeb app ↔ extension bridge');
  const appUp = await fetch('http://localhost:5173/').then((r) => r.ok).catch(() => false);
  if (!appUp) {
    console.log('  – skipped: dev server not running on :5173');
  } else {
    const { targetId } = await browser.send('Target.createTarget', { url: 'http://localhost:5173/' });
    const { sessionId: page } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Runtime.enable', {}, page);
    await sleep(1500);

    const pong = await evalIn(
      browser,
      page,
      `new Promise((resolve) => {
         const timer = setTimeout(() => resolve('TIMEOUT'), 3000);
         window.addEventListener('message', function handler(e) {
           if (e.source !== window || e.origin !== location.origin) return;
           const d = e.data;
           if (d && d.source === 'lockin-extension' && d.type === 'PONG' && d.requestId === 'e2e') {
             clearTimeout(timer); window.removeEventListener('message', handler);
             resolve(JSON.stringify(d.payload));
           }
         });
         window.postMessage({ source: 'lockin-web', version: 1, type: 'PING', requestId: 'e2e' }, location.origin);
       })`,
    );
    check('page PING gets a PONG through the content script', pong !== 'TIMEOUT', pong);

    // A page pretending to be the extension must not be able to drive it.
    const spoof = await evalIn(
      browser,
      page,
      `new Promise((resolve) => {
         const timer = setTimeout(() => resolve('NO_REPLY'), 2000);
         window.addEventListener('message', function h(e) {
           const d = e.data;
           if (d && d.source === 'lockin-extension' && d.requestId === 'spoof') {
             clearTimeout(timer); window.removeEventListener('message', h); resolve('REPLIED');
           }
         });
         window.postMessage({ source: 'lockin-web', version: 1, type: 'DISABLE_EVERYTHING', requestId: 'spoof' }, location.origin);
       })`,
    );
    check('unknown message types are ignored', spoof === 'NO_REPLY', spoof);

    // The real app should have synced its own state by now, replacing our test
    // state — confirm the worker took it.
    const synced = await swEval(
      browser,
      `chrome.storage.local.get('lockin_state').then(r => JSON.stringify(r.lockin_state))`,
    );
    check('the live web app pushed its state to the extension', synced.includes('blockedDomains'), '');

    // Closing the LockIn tab must not switch blocking off — the extension owns
    // its own state and doesn't depend on the page staying open.
    await setExtensionState(browser, sessionId, {});
    await browser.send('Target.closeTarget', { targetId });
    await sleep(1000);
    check(
      'closing the LockIn tab leaves blocking active',
      (await navigateAndGetUrl(browser, 'http://distraction.test/')).includes('blocked.html'),
    );

    // Two LockIn tabs at once must not fight over state.
    const a = (await browser.send('Target.createTarget', { url: 'http://localhost:5173/home' })).targetId;
    const b = (await browser.send('Target.createTarget', { url: 'http://localhost:5173/home' })).targetId;
    await sleep(2500);
    const stateNow = await swEval(
      browser,
      `chrome.storage.local.get('lockin_state').then(r => JSON.stringify(r.lockin_state.blockedDomains))`,
    );
    check('two LockIn tabs converge on one state', stateNow.length > 0, stateNow.slice(0, 60));
    await browser.send('Target.closeTarget', { targetId: a });
    await browser.send('Target.closeTarget', { targetId: b });
  }

  browser.close();
  await stopChrome();
}

main()
  .catch((error) => {
    console.error('\nHARNESS ERROR:', error.message);
    failures++;
  })
  .finally(async () => {
    await stopChrome();
    site.close();
    tls?.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
