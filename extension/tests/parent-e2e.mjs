/**
 * Parent Dashboard end-to-end, in a real browser with the real extension.
 *
 * The flow this exists to prove:
 *
 *   /parent → wrong PIN → rejected → correct PIN → dashboard opens
 *     → the Enhanced verification from earlier is visible
 *     → parent raises one assignment to require Enhanced Proof
 *     → Exit Parent View → the dashboard re-locks
 *     → the student's verification flow now demands a one-time code
 *     → a Standard capture does not satisfy it
 *     → an Enhanced capture does → Focus Mode ends → YouTube unblocks
 *     → reopening the dashboard shows the new Enhanced verification
 *
 * That last chain is the point: a switch in the Parent Dashboard has to change
 * what the *existing* Phase 4/5 verification engine accepts, not just what a
 * settings page displays. It also covers the second flow — a parent-approved
 * temporary unlock pausing blocking while Focus Mode stays on.
 *
 * Needs: the dev server on :5173, and Chrome for Testing.
 * Run: npm run test:parent-e2e
 */
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, killChrome, launchChrome, requirePortFree } from './chrome-harness.mjs';
import { HEIGHT, RENDERER_SOURCE, WIDTH, y4mFromI420 } from './edgenuity-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..');
const APP_ORIGIN = 'http://localhost:5173';
const SITE_PORT = 8096;
const CDP_PORT = 9337;
const HEADFUL = process.argv.includes('--headful');
const VERBOSE = process.argv.includes('--verbose');

/** The PIN the seeded state is built with. */
const PIN = '4821';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Watchdog ---------------- */

let currentStep = 'starting up';
let stepStartedAt = Date.now();
const STEP_LIMIT_MS = 4 * 60_000;

function step(name) {
  currentStep = name;
  stepStartedAt = Date.now();
  if (VERBOSE) console.log(`  → ${name}`);
}

const watchdog = setInterval(() => {
  if (Date.now() - stepStartedAt < STEP_LIMIT_MS) return;
  console.error(`\nWatchdog: "${currentStep}" stalled — giving up.`);
  process.exit(1);
}, 5000);
watchdog.unref();

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
      }, 180_000);
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
let painterSession = null;

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

const DIALOG_BUTTON = '[role="dialog"] button';
const DIALOG_EXPR = `(() => {
  const d = document.querySelector('[role="dialog"]');
  return d ? d.innerText : '(no dialog)';
})()`;

const BUTTONS_EXPR = `[...document.querySelectorAll('button')]
  .map((b) => (b.textContent || '').trim() + (b.disabled ? ' [disabled]' : ''))
  .filter(Boolean).join(' | ')`;

async function waitFor(expression, { timeout = 90_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await app(expression)) return true;
    await sleep(400);
  }
  const buttons = await app(BUTTONS_EXPR).catch(() => '(unreadable)');
  const text = await app('document.body.innerText').catch(() => '');
  throw new Error(
    `Timed out waiting for ${label}\n    buttons: ${buttons}\n    page: ${summarise(text, 300)}`,
  );
}

/** Types a PIN into whichever password field is on screen and submits. */
async function enterPin(pin) {
  await app(`(() => {
    const input = document.querySelector('input[type="password"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(pin)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  return app(`(() => {
    const form = document.querySelector('form');
    if (form) { form.requestSubmit(); return true; }
    return false;
  })()`);
}

const readState = async () =>
  JSON.parse((await app(`localStorage.getItem('lockin.state.v1')`)) ?? 'null');

const pageText = () => app('document.body.innerText');

/* ---------------- Camera frames ---------------- */

let cameraFile = null;

async function showToCamera({ percent, code, variant = 0 }) {
  const spec = `custom:${percent}:${code ?? ''}:Physical Science Semester A:${variant}`;
  const payload = await evalIn(
    painterSession,
    `JSON.stringify(window.__exportFixture(${JSON.stringify(spec)}, ${WIDTH}, ${HEIGHT}))`,
  );
  const { i420 } = JSON.parse(payload);
  const staging = `${cameraFile}.next`;
  writeFileSync(staging, y4mFromI420(i420));
  renameSync(staging, cameraFile);

  // Chrome reads the file when the stream starts, so an open camera must be
  // closed before it will pick up a new frame.
  if (appSession && (await app(`!!document.querySelector('[role="dialog"] video')`))) {
    await app(clickByTextExpression('cancel', DIALOG_BUTTON));
    await sleep(500);
  }
  await sleep(900);
}

async function currentCode(phase) {
  const state = await readState();
  return state.edgenuity.challenges.find((c) => c.status === 'pending' && c.phase === phase)?.value;
}

async function captureThroughUi(confirmLabel) {
  const onCameraStep = async () =>
    (await app(`!!document.querySelector('[role="dialog"] video')`)) === true;

  if (!(await onCameraStep())) {
    await waitFor(clickByTextExpression('open camera', DIALOG_BUTTON), {
      label: 'the Open camera button',
    });
    await sleep(1200);
  }
  await waitFor(clickByTextExpression('capture', DIALOG_BUTTON), {
    label: 'a live camera preview',
    timeout: 40_000,
  });
  // Scoped to the dialog: the panel behind it now says "Enhanced Proof
  // required", which matched an earlier, looser body-text wait and let the
  // check read the screen while OCR was still running.
  await waitFor(
    `${DIALOG_EXPR}.match(/Detected|couldn.t (read|confidently)|wasn.t detected/i) !== null`,
    { label: 'the OCR result', timeout: 150_000 },
  );
  const dialog = await app(DIALOG_EXPR);
  if (VERBOSE) console.log(`    · review: ${summarise(dialog, 200)}`);
  const clicked = await app(clickByTextExpression(confirmLabel, DIALOG_BUTTON));
  await sleep(900);
  return { dialog, clicked };
}

/** A capture that should succeed, with re-framed retakes. */
async function captureUntilAccepted({ percent, code, confirmLabel, attempts = 3 }) {
  let last = { dialog: '', clicked: false };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await showToCamera({ percent, code, variant: attempt - 1 });
    last = await captureThroughUi(confirmLabel);
    if (last.clicked && /verified\s*✓|verified ✓/i.test(last.dialog)) {
      return { ...last, attempts: attempt };
    }
    await app(clickByTextExpression('retake', DIALOG_BUTTON));
    await sleep(700);
  }
  return { ...last, attempts };
}

async function isBlocked(url) {
  const tab = await openTab(url);
  const href = await evalIn(tab.sessionId, 'location.href');
  await browser.send('Target.closeTarget', { targetId: tab.targetId });
  return href.startsWith('chrome-extension://');
}

function summarise(text, limit = 160) {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/* ---------------- Seed ---------------- */

const ASSIGNMENT_ID = 'asg_parent_e2e';

/**
 * A device mid-week: one Enhanced verification already on the books, one
 * Standard-requirement Edgenuity assignment still to do, Strict Focus Mode
 * running, and a parent PIN set.
 */
function seedState(pinRecord) {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 3 * 3600_000).toISOString();

  return {
    schemaVersion: 5,
    profile: { firstName: 'Sam', onboarded: true, createdAt: earlier },
    assignments: [
      {
        id: 'asg_done',
        title: 'Physics module',
        subject: 'Science',
        platform: 'Edgenuity',
        dueDate: '2026-12-01',
        dueTime: '23:59',
        estimatedMinutes: 30,
        priority: 'Normal',
        status: 'Completed',
        completionMethod: 'edgenuity',
        verificationMethod: 'edgenuity',
        createdAt: earlier,
        updatedAt: earlier,
        completedAt: earlier,
        loggedMinutes: 25,
        reminders: { firstReminderMinutes: 120, escalationMinutes: 60, focusWarningMinutes: 30, enabled: false },
        remindersFired: [],
        verificationStatus: 'verified',
        verificationRecords: [
          {
            id: 'ver_seed',
            type: 'edgenuity_photo',
            timestamp: earlier,
            status: 'verified',
            progressBefore: 40,
            progressAfter: 45,
            evidence: {
              trust: 'enhanced',
              verificationType: 'live_camera_ocr_enhanced',
              progressDelta: 5,
              challengeBeforeVerified: true,
              challengeAfterVerified: true,
              screenConfidence: 'high',
              courseName: 'Physical Science Semester A',
            },
          },
        ],
        edgenuity: {
          config: { courseName: 'Physical Science Semester A', targetType: 'progress_percent', requiredProgressDelta: 5, requiredVerificationTrust: 'enhanced' },
          verifiedProgressDelta: 5,
          lastVerifiedProgress: 45,
          verifiedActivities: 0,
          lastVerifiedTrust: 'enhanced',
        },
      },
      {
        id: ASSIGNMENT_ID,
        title: 'Science module',
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
        reminders: { firstReminderMinutes: 120, escalationMinutes: 60, focusWarningMinutes: 30, enabled: false },
        remindersFired: [],
        verificationStatus: 'pending',
        verificationRecords: [],
        edgenuity: {
          config: {
            courseName: 'Physical Science Semester A',
            targetType: 'progress_percent',
            requiredProgressDelta: 3,
            // Standard to begin with — the parent raises this during the test.
            requiredVerificationTrust: 'standard',
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
      edgenuityProofMode: 'standard',
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
    completedSessions: [
      { id: 'ses_1', assignmentId: 'asg_done', assignmentTitle: 'Physics module', plannedMinutes: 25, actualMinutes: 25, startedAt: earlier, endedAt: earlier },
    ],
    activity: [
      { id: 'evt_1', type: 'focus_mode_started', timestamp: now, message: 'Focus Mode started — 1 required task' },
    ],
    parentPin: pinRecord,
    blockStats: [],
    canvas: { connection: null, courses: [], detected: [], ignoredKeys: [], lastSyncAt: null, lastError: null },
    edgenuity: { sessions: [], challenges: [], developerMode: false, cameraPermission: 'unknown', ocrEverLoaded: false },
    parentControls: {
      lockVerificationSettings: false,
      protectBlocklistInStrictMode: false,
      protectAllowlistInStrictMode: false,
    },
    focusRuns: [
      {
        id: 'run_seed',
        startedAt: now,
        requiredTaskIds: [ASSIGNMENT_ID],
        requiredCount: 1,
        completedCount: 0,
        outcome: 'active',
        isTest: false,
        unlocks: [],
        blocked: [],
        blockBaseline: [],
      },
    ],
  };
}

const site = createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>${host}</title><h1 id="host">${host}</h1>`);
});

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
    console.error('The dev server is not running. Start it first:\n  npm --prefix web run dev');
    process.exit(1);
  }

  const workDir = mkdtempSync(join(tmpdir(), 'lockin-parent-e2e-'));
  const profile = join(workDir, 'profile');
  cameraFile = join(workDir, 'camera.y4m');
  writeFileSync(cameraFile, Buffer.alloc(0));

  await requirePortFree(CDP_PORT, 'debug port');
  site.listen(SITE_PORT, '127.0.0.1');

  const args = [
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT_DIR}`,
    `--disable-extensions-except=${EXT_DIR}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--host-resolver-rules=MAP youtube.com 127.0.0.1:${SITE_PORT},MAP www.youtube.com 127.0.0.1:${SITE_PORT}`,
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

    console.log('\nPhase 6 E2E — Parent Dashboard, controls, and real enforcement\n');

    const painter = await openTab('about:blank');
    painterSession = painter.sessionId;
    await evalIn(painterSession, RENDERER_SOURCE);

    const tab = await openTab(`${APP_ORIGIN}/`);
    appSession = tab.sessionId;
    await browser.send('Browser.setPermission', {
      origin: APP_ORIGIN,
      permission: { name: 'camera' },
      setting: 'granted',
    });

    /* ---- 0. Seed a device with a real PIN hash ---- */
    step('seed the device');
    // Hashed with the app's own lib/pin.ts, so the PIN is genuinely verified.
    const pinRecord = await app(`(async () => {
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      const data = new TextEncoder().encode(salt + ${JSON.stringify(PIN)});
      const digest = await crypto.subtle.digest('SHA-256', data);
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      return JSON.stringify({ hash, salt, createdAt: new Date().toISOString() });
    })()`);

    await app(
      `localStorage.setItem('lockin.state.v1', ${JSON.stringify(
        JSON.stringify(seedState(JSON.parse(pinRecord))),
      )}); 1`,
    );
    await browser.send('Page.navigate', { url: `${APP_ORIGIN}/parent` }, appSession);
    await sleep(2500);

    /* ---- 1. The gate ---- */
    step('parent gate');
    let text = await pageText();
    check('the dashboard asks for the PIN', /Enter parent PIN/i.test(text));
    check(
      'and shows nothing about the week before it is entered',
      !/Assignments completed|Verified completions|Recent work/i.test(text),
      summarise(text, 90),
    );

    await enterPin('0000');
    await sleep(900);
    text = await pageText();
    check('a wrong PIN is rejected', /Incorrect PIN/i.test(text), summarise(text, 80));
    check('and the dashboard stays locked', /Enter parent PIN/i.test(text));

    await enterPin(PIN);
    await sleep(1500);
    text = await pageText();
    check('the correct PIN opens the dashboard', /Parent View/i.test(text));
    check('the weekly summary is visible', /This week|Assignments completed/i.test(text));

    /* ---- 2. Reviewing verification ---- */
    step('review verification evidence');
    await app(clickByTextExpression('Work'));
    await sleep(900);
    text = await pageText();
    check('the earlier Enhanced verification is listed', /Edgenuity Enhanced/i.test(text));
    check('Physics module appears in recent work', /Physics module/i.test(text));

    await app(clickByTextExpression('Physics module'));
    await sleep(800);
    let dialog = await app(DIALOG_EXPR);
    check('its details open', /Verification details/i.test(dialog), summarise(dialog, 90));
    check('showing the before → after reading', /40% → 45%/.test(dialog));
    check('and both challenge halves', /Before challenge[\s\S]*Verified/i.test(dialog));
    check('with photos confirmed as not stored', /Photos stored\s*No/i.test(dialog));
    check(
      'and no raw OCR text anywhere in it',
      !/rawText|Course Progress 4/i.test(dialog),
      summarise(dialog, 90),
    );
    await app(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1`);
    await sleep(600);

    /* ---- 3. A parent-approved temporary unlock (second critical flow) ---- */
    step('parent-approved temporary unlock');
    check('youtube.com is blocked during the session', await isBlocked('http://youtube.com/'));

    await app(clickByTextExpression('Controls'));
    await sleep(900);
    check(
      'the dashboard shows Focus Mode as active',
      /Focus Mode[\s\S]*ACTIVE/i.test(await pageText()),
    );
    await app(clickByTextExpression('15 minutes'));
    await sleep(300);
    check('the unlock is approved', await app(clickByTextExpression('Approve unlock')));
    await sleep(2500);

    let state = await readState();
    check('Focus Mode stays active through the unlock', state.focusMode.active === true);
    check('blocking is paused', state.focusMode.temporaryUnlockUntil !== null);
    check('youtube.com now loads', (await isBlocked('http://youtube.com/')) === false);
    check(
      'the unlock is recorded against the run, marked as parent-approved',
      state.focusRuns.some((run) => run.unlocks.some((u) => u.byParent && u.minutes === 15)),
    );

    // Put blocking back so the rest of the run tests the real thing.
    await app(clickByTextExpression('Resume blocking now'));
    await sleep(2500);
    check('blocking resumes on demand', await isBlocked('http://youtube.com/'));
    state = await readState();
    check(
      'and the unlock is closed off in the history',
      state.focusRuns.some((run) => run.unlocks.some((u) => u.endedAt)),
    );

    /* ---- 4. Raising the requirement ---- */
    step('raise the requirement to Enhanced');
    check(
      'the Science module is listed with its current requirement',
      /Science module/i.test(await pageText()),
    );
    // The per-assignment toggle for the still-Standard assignment.
    const toggled = await app(`(() => {
      const rows = [...document.querySelectorAll('div')].filter((d) =>
        (d.textContent || '').includes('Science module') && d.querySelector('button[role="switch"], input[type="checkbox"], button'),
      );
      const row = rows[rows.length - 1];
      if (!row) return false;
      const control = row.querySelector('input[type="checkbox"]') || row.querySelector('button');
      if (!control) return false;
      control.click();
      return true;
    })()`);
    check('the parent raises it to Enhanced', toggled === true);
    await sleep(1200);

    state = await readState();
    const target = state.assignments.find((a) => a.id === ASSIGNMENT_ID);
    check(
      'the requirement is stored on the assignment',
      target.edgenuity.config.requiredVerificationTrust === 'enhanced',
      target.edgenuity.config.requiredVerificationTrust,
    );
    check(
      'and it is recorded in the activity log exactly once',
      state.activity.filter((e) => e.type === 'parent_requirement_changed').length === 1,
    );
    check(
      'the completed assignment was not re-opened',
      state.assignments.find((a) => a.id === 'asg_done').status === 'Completed',
    );

    /* ---- 5. Exit Parent View ---- */
    step('exit parent view');
    await app(clickByTextExpression('Exit Parent View'));
    await sleep(1500);
    check('the student view returns', /Focus|Home|Work/i.test(await pageText()));

    await browser.send('Page.navigate', { url: `${APP_ORIGIN}/parent` }, appSession);
    await sleep(2000);
    check(
      'and the dashboard is locked again immediately',
      /Enter parent PIN/i.test(await pageText()),
    );

    /* ---- 6. The requirement is actually enforced ---- */
    step('student verification now demands a code');
    await browser.send('Page.navigate', { url: `${APP_ORIGIN}/focus` }, appSession);
    await sleep(2500);

    await waitFor(clickByTextExpression('start work'), { label: 'the Start work button' });
    await sleep(1000);
    dialog = await app(DIALOG_EXPR);
    check(
      'the flow now asks for a one-time code',
      /verification code/i.test(dialog),
      summarise(dialog, 90),
    );

    const beforeCode = await currentCode('before');
    check('a code was issued because the parent required Enhanced', !!beforeCode, beforeCode);

    // A Standard capture — the right screen, no code — must not satisfy it.
    await showToCamera({ percent: 43, code: undefined });
    const standard = await captureThroughUi('retake');
    check(
      'a capture without the code is refused',
      /wasn’t detected|wasn't detected/i.test(standard.dialog),
      summarise(standard.dialog, 90),
    );
    state = await readState();
    check(
      'and no session opened from it',
      state.edgenuity.sessions.filter((s) => s.status === 'in_progress').length === 0,
    );
    check('youtube.com is still blocked', await isBlocked('http://youtube.com/'));

    /* ---- 7. Enhanced proof succeeds ---- */
    step('enhanced proof succeeds');
    const before = await captureUntilAccepted({
      percent: 43,
      code: beforeCode,
      confirmLabel: 'confirm & start',
    });
    check('the starting capture with the code is accepted', before.clicked === true, `attempt ${before.attempts}`);

    await waitFor(clickByTextExpression('verify progress'), { label: 'Verify progress' });
    await sleep(900);
    const afterCode = await currentCode('after');
    check('a different code is issued for the final capture', !!afterCode && afterCode !== beforeCode);

    let final = await captureUntilAccepted({
      percent: 47,
      code: afterCode,
      confirmLabel: 'use this',
    });
    check('the final capture is accepted', final.clicked === true, `attempt ${final.attempts}`);
    await sleep(1500);

    // The Phase 4 "too fast" guard fires on a run this quick; confirm it.
    state = await readState();
    let pending = state.edgenuity.sessions.find((s) => s.status === 'in_progress')?.pendingConfirmation;
    if (pending) {
      check('a near-instant claim asks to confirm', true, pending.reason);
      await waitFor(clickByTextExpression('verify progress'), { label: 'Verify progress again' });
      await sleep(900);
      const confirmCode = await currentCode('after');
      final = await captureUntilAccepted({
        percent: 47,
        code: confirmCode,
        confirmLabel: 'use this',
      });
      check('the confirming capture is accepted', final.clicked === true);
      await sleep(1500);
      state = await readState();
    }

    const verified = state.assignments.find((a) => a.id === ASSIGNMENT_ID);
    check('the assignment completes', verified.status === 'Completed');
    check('at enhanced trust', verified.edgenuity.lastVerifiedTrust === 'enhanced');
    check('Focus Mode ended through the existing engine', state.focusMode.active === false);

    await sleep(2500);
    check('youtube.com unblocks', (await isBlocked('http://youtube.com/')) === false);

    /* ---- 8. The new verification is visible to the parent ---- */
    step('reopen the dashboard');
    await browser.send('Page.navigate', { url: `${APP_ORIGIN}/parent` }, appSession);
    await sleep(2000);
    check('the dashboard requires the PIN again', /Enter parent PIN/i.test(await pageText()));
    await enterPin(PIN);
    await sleep(1500);

    await app(clickByTextExpression('Work'));
    await sleep(1000);
    text = await pageText();
    check('the new Enhanced verification is listed', /Science module/i.test(text));
    check(
      'and it is shown as Enhanced',
      (text.match(/Edgenuity Enhanced/gi) ?? []).length >= 2,
      'both the seeded and the new one',
    );

    await app(clickByTextExpression('Focus'));
    await sleep(900);
    text = await pageText();
    check('the focus history shows the completed run', /Completed normally/i.test(text));
    check('and the parent-approved unlock', /temporary unlock/i.test(text));

    /* ---- 9. Nothing sensitive leaked into the dashboard ---- */
    step('privacy check');
    await app(clickByTextExpression('Data'));
    await sleep(900);
    text = await pageText();
    check('the privacy statement is shown', /Edgenuity photos are never retained/i.test(text));
    const fullState = await readState();
    check(
      'no challenge value survives anywhere in storage',
      fullState.edgenuity.challenges.every((c) => c.value === undefined || c.status === 'pending'),
    );
    check('no image data is stored', !JSON.stringify(fullState).includes('data:image'));
  } finally {
    clearInterval(watchdog);
    browser?.close();
    await killChrome(chrome, CDP_PORT, workDir);
    site.close();
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(
    `\n${failures === 0 ? 'All Phase 6 E2E checks passed' : `${failures} check(s) failed`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
