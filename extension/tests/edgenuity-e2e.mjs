/**
 * Phase 4 end-to-end: photograph progress, unlock the internet.
 *
 * This is the flow the whole phase exists for:
 *
 *   Edgenuity assignment requiring +3%
 *     → Strict Focus Mode started
 *     → youtube.com blocked for real
 *     → live camera shows 43%
 *     → student works
 *     → live camera shows 47%
 *     → +4% verified, assignment completed
 *     → the existing Focus Mode engine ends the session
 *     → the extension drops its rules and youtube.com loads
 *
 * Nothing here is stubbed past the point where it matters. Chrome's fake video
 * device is pointed at a generated Edgenuity screen, so `getUserMedia` is the
 * real API returning real frames, tesseract really reads them, and the real
 * reducer and real extension do the rest. Swapping the file between captures
 * is what makes "before" and "after" different pictures.
 *
 * Needs: the dev server on :5173, and Chrome for Testing.
 * Run: npm run test:edgenuity-e2e
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, killChrome, launchChrome, requirePortFree } from './chrome-harness.mjs';
import { FIXTURE_DIR, generateFixtures } from './edgenuity-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..');
const APP_ORIGIN = 'http://localhost:5173';
const SITE_PORT = 8098;
const CDP_PORT = 9334;
const HEADFUL = process.argv.includes('--headful');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- CDP ---------------- */

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
      const entry = msg.id && this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg);
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
      }, 120_000);
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

async function fetchJSON(path, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

let browser = null;
let appSession = null;

async function evalIn(sessionId, expression) {
  const { result } = await browser.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(
      `eval failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
    );
  }
  return result.result.value;
}

const app = (expression) => evalIn(appSession, expression);

/** Page console output, so a failure inside the OCR worker is visible here. */
const consoleLines = [];

function watchConsole() {
  browser.ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ');
      consoleLines.push(`[${msg.params.type}] ${text}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params.exceptionDetails;
      consoleLines.push(
        `[exception] ${details.text} ${details.exception?.description ?? ''}`.slice(0, 400),
      );
    }
  });
}

async function openTab(url) {
  const { targetId } = (await browser.send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (
    await browser.send('Target.attachToTarget', { targetId, flatten: true })
  ).result;
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(1500);
  return { targetId, sessionId };
}

/* ---------------- UI helpers ---------------- */

/**
 * Clicks the first element whose visible text matches.
 *
 * Disabled buttons count as "not there yet" rather than as a click: the shutter
 * stays disabled until the camera is producing frames, and treating that as a
 * successful click made the whole flow silently fall through.
 */
function clickByTextExpression(text, selector = 'button') {
  return `(() => {
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const hit = nodes.find(
      (n) => !n.disabled && (n.textContent || '').trim().toLowerCase().includes(wanted),
    );
    if (!hit) return false;
    hit.click();
    return true;
  })()`;
}

/** Every button on screen, for failure output. */
const BUTTONS_EXPR = `[...document.querySelectorAll('button')]
  .map((b) => (b.textContent || '').trim() + (b.disabled ? ' [disabled]' : ''))
  .filter(Boolean)
  .join(' | ')`;

async function clickText(text, selector = 'button') {
  return app(clickByTextExpression(text, selector));
}

/** Polls until `expression` is truthy, so the OCR pass can take its time. */
async function waitFor(expression, { timeout = 90_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await app(expression)) return true;
    await sleep(500);
  }
  // Without this, a UI change turns into a bare timeout and a long hunt.
  const buttons = await app(BUTTONS_EXPR).catch(() => '(unreadable)');
  const text = await app('document.body.innerText').catch(() => '');
  throw new Error(
    `Timed out waiting for ${label}\n    buttons: ${buttons}\n    page: ${summarise(text)}` +
      `\n    console: ${consoleLines.slice(-8).join('\n              ') || '(quiet)'}`,
  );
}

const readState = async () => JSON.parse((await app(`localStorage.getItem('lockin.state.v1')`)) ?? 'null');

/* ---------------- Seed ---------------- */

const ASSIGNMENT_ID = 'asg_edg_e2e';

/**
 * A Phase 3-shaped state with one Edgenuity assignment already configured.
 *
 * Seeding this rather than clicking through onboarding keeps the test about
 * Phase 4. Everything from the starting photo onwards is driven through the
 * real UI.
 */
function seedState() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 3,
    profile: { firstName: 'Sam', onboarded: true, createdAt: now },
    assignments: [
      {
        id: ASSIGNMENT_ID,
        title: 'Edgenuity Science Progress',
        subject: 'Science',
        platform: 'Edgenuity',
        dueDate: '2026-12-01',
        dueTime: '23:59',
        estimatedMinutes: 30,
        priority: 'Important',
        status: 'Not Started',
        completionMethod: 'edgenuity',
        verificationMethod: 'edgenuity',
        createdAt: now,
        updatedAt: now,
        loggedMinutes: 0,
        reminders: {
          firstReminderMinutes: 120,
          escalationMinutes: 60,
          focusWarningMinutes: 30,
          enabled: false,
        },
        remindersFired: [],
        verificationStatus: 'pending',
        verificationRecords: [],
        edgenuity: {
          config: {
            courseName: 'Physical Science Semester A',
            targetType: 'progress_percent',
            requiredProgressDelta: 3,
          },
          verifiedProgressDelta: 0,
          lastVerifiedProgress: null,
          verifiedActivities: 0,
        },
      },
    ],
    exams: [],
    settings: {
      reminderMode: 'Strict',
      defaultStudyTime: '17:00',
      defaultFocusMinutes: 25,
      blockingEnabled: true,
      blockedDomains: ['youtube.com'],
      allowedDomains: ['clever.com'],
      notificationsAsked: true,
      theme: 'light',
    },
    focusMode: {
      active: true,
      startedAt: now,
      requiredTaskIds: [ASSIGNMENT_ID],
      requiredCompletionCount: 1,
      completedCount: 0,
      temporaryUnlockUntil: null,
      overrideUsed: false,
      emergencyExitUsed: false,
      isTest: false,
      testExpiresAt: null,
    },
    activeSession: null,
    completedSessions: [],
    activity: [],
    parentPin: null,
    blockStats: [],
    canvas: {
      connection: null,
      courses: [],
      detected: [],
      ignoredKeys: [],
      lastSyncAt: null,
      lastError: null,
    },
    edgenuity: { sessions: [], developerMode: false, cameraPermission: 'unknown', ocrEverLoaded: false },
  };
}

/* ---------------- Local stand-in for youtube.com ---------------- */

const site = createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>${host}</title><h1 id="host">${host}</h1>`);
});

/* ---------------- Camera ---------------- */

let cameraFile = null;

/** Points the fake camera at a different Edgenuity screen. */
function showToCamera(fixture) {
  copyFileSync(join(FIXTURE_DIR, `${fixture}.y4m`), cameraFile);
}

/**
 * Runs one capture through the real UI: open camera, shoot, wait for OCR,
 * confirm. Returns the button label used to finish, for the caller to assert on.
 */
async function captureThroughUi(confirmLabel) {
  await trace('before opening the camera');
  await waitFor(clickByTextExpression('open camera'), { label: 'the Open camera button' });
  await sleep(1200);
  await trace('camera step');

  // The shutter only enables once the stream is producing frames.
  await waitFor(clickByTextExpression('capture'), { label: 'a live camera preview', timeout: 30_000 });
  await trace('just after capture');

  // OCR: engine start-up on the first run is the slow part.
  await waitFor(
    `!!document.body.innerText.match(/Detected|couldn.t (read|confidently)/i)`,
    { label: 'the OCR result', timeout: 120_000 },
  );

  await trace('review step');
  const text = await app('document.body.innerText');
  const clicked = await clickText(confirmLabel);
  await sleep(800);
  return { text, clicked };
}

/** `--verbose` prints what is on screen at each step of the flow. */
const VERBOSE = process.argv.includes('--verbose');

async function trace(label) {
  if (!VERBOSE) return;
  const buttons = await app(BUTTONS_EXPR).catch(() => '(unreadable)');
  const video = await app(
    `(() => { const v = document.querySelector('video'); return v ? v.videoWidth + 'x' + v.videoHeight + ' ready=' + v.readyState : 'no video'; })()`,
  ).catch(() => '(unreadable)');
  const text = await app('document.body.innerText').catch(() => '');
  const dialog = await app(
    `(() => { const d = document.querySelector('[role="dialog"]'); return d ? d.innerText : '(no dialog)'; })()`,
  ).catch(() => '(unreadable)');
  console.log(
    `    · ${label}\n      buttons: ${buttons}\n      video: ${video}\n      dialog: ${summarise(dialog, 600)}\n      page: ${summarise(text)}`,
  );
}

/**
 * Forces the camera permission for the app origin.
 *
 * `--use-fake-ui-for-media-stream` grants everything, which is what the happy
 * path needs; this overrides it so the refusal path can be tested in the same
 * browser rather than in a second launch.
 */
async function setCameraPermission(setting) {
  await browser.send('Browser.setPermission', {
    origin: APP_ORIGIN,
    // CDP takes the Permissions-API name here, not the internal one.
    permission: { name: 'camera' },
    setting,
  });
}

/* ---------------- Blocking probes ---------------- */

async function isBlocked(url) {
  const tab = await openTab(url);
  const href = await evalIn(tab.sessionId, 'location.href');
  await browser.send('Target.closeTarget', { targetId: tab.targetId });
  return href.startsWith('chrome-extension://');
}

/* ---------------- Main ---------------- */

async function main() {
  const chromeBinary = findChrome();
  if (!chromeBinary) {
    console.error('Chrome for Testing not found. Set CHROME_BIN — see HANDOFF.md.');
    process.exit(1);
  }

  try {
    const res = await fetch(APP_ORIGIN, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    console.error(`The dev server is not running. Start it first:\n  npm --prefix web run dev`);
    process.exit(1);
  }

  if (!existsSync(join(FIXTURE_DIR, 'clear-43.y4m'))) {
    console.log('Generating fixtures first…');
    await generateFixtures({ quiet: true });
  }

  const workDir = mkdtempSync(join(tmpdir(), 'lockin-edg-e2e-'));
  const profile = join(workDir, 'profile');
  cameraFile = join(workDir, 'camera.y4m');
  showToCamera('clear-43');

  await requirePortFree(CDP_PORT, 'debug port');
  site.listen(SITE_PORT, '127.0.0.1');

  const args = [
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT_DIR}`,
    `--disable-extensions-except=${EXT_DIR}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--host-resolver-rules=MAP youtube.com 127.0.0.1:${SITE_PORT},MAP www.youtube.com 127.0.0.1:${SITE_PORT}`,
    /* The camera: a real getUserMedia against a fake device whose frames come
       from a file this test rewrites between captures.
       Note the *absence* of --use-fake-ui-for-media-stream: that flag grants
       every request and would make the denial path untestable. Permission is
       instead driven explicitly over CDP, so both answers can be exercised in
       one browser. */
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${cameraFile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-search-engine-choice-screen',
    'about:blank',
  ];
  if (!HEADFUL) args.unshift('--headless=new');
  const chrome = launchChrome(chromeBinary, args);

  try {
    const version = await fetchJSON('/json/version');
    browser = new CDP(version.webSocketDebuggerUrl);

    console.log('\nPhase 4 E2E — camera, OCR, verification, unblocking\n');

    /* ---- 1. Seed a strict Focus Mode with one Edgenuity requirement ---- */
    watchConsole();
    const tab = await openTab(`${APP_ORIGIN}/`);
    appSession = tab.sessionId;
    await app(
      `localStorage.setItem('lockin.state.v1', ${JSON.stringify(JSON.stringify(seedState()))}); 1`,
    );
    await browser.send('Page.navigate', { url: `${APP_ORIGIN}/focus` }, appSession);
    await sleep(2500);

    const seeded = await readState();
    check('Focus Mode is armed with one required Edgenuity task', seeded?.focusMode.active === true);

    /* ---- 2. Blocking is real before any verification ---- */
    check('youtube.com is blocked while the work is unfinished', await isBlocked('http://youtube.com/'));

    /* ---- 3. A denied camera must explain itself, not crash ---- */
    await setCameraPermission('denied');
    await waitFor(clickByTextExpression('start work'), { label: 'the Start work button' });
    await sleep(400);
    await waitFor(clickByTextExpression('open camera'), { label: 'the Open camera button' });
    await waitFor(`/Camera access is required/i.test(document.body.innerText)`, {
      label: 'the camera-denied explanation',
      timeout: 20_000,
    });
    check('a denied camera shows a clear message', true);
    check('and offers Try again', (await app(clickByTextExpression('try again'))) === true);
    await sleep(600);
    // Close the dialog and let the rest of the run use a working camera.
    await app(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1`);
    await sleep(500);
    await setCameraPermission('granted');
    check(
      'the denial was remembered without re-prompting',
      (await readState())?.edgenuity.cameraPermission === 'denied',
    );

    /* ---- 4. Starting proof: the camera shows 43% ---- */
    check(
      'the Edgenuity panel offers to start work',
      await waitFor(clickByTextExpression('start work'), { label: 'the Start work button' }),
    );
    await sleep(600);

    const before = await captureThroughUi('confirm & start');
    check('the starting photo is read as 43%', /43\s*%/.test(before.text), summarise(before.text));
    check('the starting proof was accepted', before.clicked === true);

    await sleep(1200);
    let state = await readState();
    const session = state.edgenuity.sessions.find((s) => s.status === 'in_progress');
    check('a verification session is open', !!session);
    check('its starting proof is a live capture', session?.before.source === 'live_camera');
    check('it recorded 43%', session?.before.progressPercent === 43);
    check('nothing is completed yet', state.assignments[0].status !== 'Completed');
    check('youtube.com is still blocked', await isBlocked('http://youtube.com/'));

    /* ---- 4. The starting proof survives a reload ---- */
    await browser.send('Page.navigate', { url: `${APP_ORIGIN}/focus` }, appSession);
    await sleep(2500);
    state = await readState();
    check(
      'the open session survives a refresh',
      state.edgenuity.sessions.some((s) => s.status === 'in_progress'),
    );

    /* ---- 5. Final proof: the student worked, the camera now shows 47% ---- */
    showToCamera('clear-47');
    check(
      'the panel offers to verify progress',
      await waitFor(clickByTextExpression('verify progress'), { label: 'the Verify progress button' }),
    );
    await sleep(600);

    const after = await captureThroughUi('use this');
    check('the final photo is read as 47%', /47\s*%/.test(after.text), summarise(after.text));
    check('the final proof was accepted', after.clicked === true);

    await sleep(1500);
    state = await readState();

    /* ---- 6. The "too fast" guard, which this test always trips ---- */
    /* A whole verification inside a minute is exactly the pattern the sanity
       check exists for, so the run gets asked to confirm — and confirming is
       part of the flow a real student would follow after a genuinely quick
       activity. */
    if (VERBOSE) console.log('    · sessions:', JSON.stringify(state.edgenuity.sessions));
    const pending = state.edgenuity.sessions.find((s) => s.status === 'in_progress')
      ?.pendingConfirmation;
    check('a near-instant claim is asked to confirm, not accepted', !!pending, pending?.reason);
    check('nothing was credited on the flagged reading', state.assignments[0].edgenuity.verifiedProgressDelta === 0);
    check('youtube.com is still blocked while it is unconfirmed', await isBlocked('http://youtube.com/'));

    await waitFor(clickByTextExpression('verify progress'), {
      label: 'the Verify progress button for the confirming photo',
    });
    await sleep(600);
    const confirming = await captureThroughUi('use this');
    check('the confirming photo is accepted', confirming.clicked === true);

    await sleep(1500);
    state = await readState();
    const assignment = state.assignments[0];

    /* ---- 6. The verification chain ---- */
    check('+4% was verified', assignment.edgenuity.verifiedProgressDelta === 4,
      `got ${assignment.edgenuity.verifiedProgressDelta}`);
    check('the assignment is completed', assignment.status === 'Completed');
    check('completion is attributed to Edgenuity', assignment.completionMethod === 'edgenuity');

    const record = assignment.verificationRecords.find((r) => r.type === 'edgenuity_photo');
    check('a verification record was written', !!record);
    check('it records 43 → 47', record?.progressBefore === 43 && record?.progressAfter === 47);
    check('it carries no image data', !JSON.stringify(record ?? {}).includes('data:image'));

    /* ---- 7. The existing Focus Mode engine does the unlocking ---- */
    check('Focus Mode ended on its own', state.focusMode.active === false);
    check(
      'the requirement is recorded as met',
      state.activity.some((e) => e.type === 'focus_mode_completed'),
    );

    // The extension needs a beat to receive the new state and drop its rules.
    await sleep(2500);
    check('youtube.com now loads', (await isBlocked('http://youtube.com/')) === false);

    /* ---- 8. The camera is not left running ---- */
    const cameraOff = await app(
      `[...document.querySelectorAll('video')].every((v) => !v.srcObject || v.srcObject.getTracks().every((t) => t.readyState === 'ended'))`,
    );
    check('no camera track is left live', cameraOff === true);
  } finally {
    browser?.close();
    await killChrome(chrome, CDP_PORT, workDir);
    site.close();
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'All Phase 4 E2E checks passed' : `${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Squashes page text into one short line for failure output. */
function summarise(text, limit = 120) {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

await main();
