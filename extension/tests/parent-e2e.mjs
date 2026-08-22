/**
 * Parent Dashboard end-to-end, in a real browser with the real extension.
 *
 * The flow this exists to prove:
 *
 *   no PIN → the dashboard refuses to open at all
 *     → the student sets a PIN in Settings → only a salted hash is stored
 *     → /parent → wrong PIN → rejected → five wrong → locked out for 30s
 *     → the correct PIN opens the dashboard, and a reload re-locks it
 *     → the parent reviews work, approves a temporary unlock, and blocking
 *       really does pause and really does come back
 *     → parent controls change the settings the *reducer* enforces, not just
 *       what a settings page displays
 *     → nothing the parent changed re-opens work already completed
 *     → Exit Parent View re-locks by construction
 *     → the student finishes the required work → recompute() ends Focus Mode
 *       → the DNR rules go → YouTube unblocks
 *     → the dashboard, reopened behind the PIN, shows what actually happened
 *
 * The point is the last few links of that chain: a switch in the Parent
 * Dashboard has to change what the *existing* engines do. A dashboard that
 * only redraws itself is a settings page with a lock icon.
 *
 * Invariants pinned here (HANDOFF.md): 14 (accountability, not surveillance),
 * 15 (requirement changes are prospective), 16 (the parent session is never
 * persisted), 17 (protected settings are refused by the reducer), plus 1 and 2
 * — one completion engine, one unblock path.
 *
 * Rewritten in Phase 19. The camera proof flow, Enhanced trust and the
 * `edgenuity` slice this suite used to drive were deleted in Phases 15–17;
 * those sections went with them rather than being kept on life support.
 *
 * Needs: the dev server on :5173, and Chrome for Testing.
 * Run: npm run test:parent-e2e
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, killChrome, launchChrome, requirePortFree } from './chrome-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..');
const APP_ORIGIN = 'http://localhost:5173';
const SITE_PORT = 8096;
const CDP_PORT = 9337;
const HEADFUL = process.argv.includes('--headful');
const VERBOSE = process.argv.includes('--verbose');

/** The PIN the student sets through the real Settings dialog. */
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

/** Navigates the app tab and waits for React to settle. */
async function goto(path, settleMs = 2000) {
  await browser.send('Page.navigate', { url: `${APP_ORIGIN}${path}` }, appSession);
  await sleep(settleMs);
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

/** Clicks by exact accessible name — for icon-only controls and checkboxes. */
function clickByLabelExpression(label) {
  return `(() => {
    const hit = document.querySelector('[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']');
    if (!hit || hit.disabled) return false;
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

async function waitFor(expression, { timeout = 60_000, label = 'condition' } = {}) {
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

/**
 * Fills every password field inside `scope`, in order.
 *
 * React controls these inputs, so the value has to go through the native
 * setter and be announced with a real input event — assigning `.value`
 * directly is silently discarded on the next render.
 */
async function fillPasswords(values, scope = 'document') {
  return app(`(() => {
    const root = ${scope};
    if (!root) return false;
    const inputs = [...root.querySelectorAll('input[type="password"]')];
    if (inputs.length < ${values.length}) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    ${JSON.stringify(values)}.forEach((value, i) => {
      setter.call(inputs[i], value);
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
    return true;
  })()`);
}

async function submitForm(scope = 'document') {
  return app(`(() => {
    const root = ${scope};
    const form = root && root.querySelector('form');
    if (!form) return false;
    form.requestSubmit();
    return true;
  })()`);
}

/** Types a PIN into the parent gate and submits it. */
async function enterPin(pin) {
  await fillPasswords([pin]);
  await sleep(250);
  await submitForm();
  await sleep(700);
}

const DIALOG_SCOPE = `document.querySelector('[role="dialog"]')`;

const readState = async () =>
  JSON.parse((await app(`localStorage.getItem('lockin.state.v1')`)) ?? 'null');

const pageText = () => app('document.body.innerText');

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

const REQUIRED_A = 'asg_required_a';
const REQUIRED_B = 'asg_required_b';
const CANVAS_DONE = 'asg_canvas_done';
const CANVAS_URL = 'https://school.instructure.com/courses/77/assignments/912';

const REMINDERS = {
  firstReminderMinutes: 120,
  escalationMinutes: 60,
  focusWarningMinutes: 30,
  enabled: false,
};

/**
 * A device mid-week, at the current schema (v11).
 *
 * One Canvas-verified completion already on the books, two required
 * assignments still to do, a Strict Focus Mode run in progress, and — the one
 * thing that cannot be reached from any UI — `lockVerificationSettings` on, so
 * the reducer's protected-settings refusal has something to refuse.
 *
 * No parent PIN: the suite sets one through the real Settings dialog, which is
 * the only way to prove the hashing rather than assume it.
 */
function seedState() {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 3 * 3600_000).toISOString();

  return {
    schemaVersion: 11,
    profile: { firstName: 'Sam', onboarded: true, createdAt: earlier },
    assignments: [
      {
        id: CANVAS_DONE,
        title: 'Biology lab report',
        subject: 'Science',
        platform: 'Canvas',
        dueDate: '2026-12-01',
        dueTime: '23:59',
        estimatedMinutes: 45,
        priority: 'Normal',
        status: 'Completed',
        completionMethod: 'canvas',
        verificationMethod: 'canvas',
        createdAt: earlier,
        updatedAt: earlier,
        completedAt: earlier,
        loggedMinutes: 40,
        reminders: REMINDERS,
        remindersFired: [],
        verificationStatus: 'verified',
        verificationRecords: [
          {
            id: 'ver_seed_canvas',
            type: 'canvas_submission',
            timestamp: earlier,
            status: 'verified',
            sourceDomain: 'school.instructure.com',
            externalCourseId: '77',
            externalAssignmentId: '912',
            evidence: { canvasStatus: 'submitted' },
          },
        ],
        canvas: {
          domain: 'school.instructure.com',
          url: CANVAS_URL,
          submissionStatus: 'submitted',
          courseId: '77',
          assignmentId: '912',
        },
      },
      {
        id: REQUIRED_A,
        title: 'Algebra problem set',
        subject: 'Math',
        platform: 'Other',
        dueDate: '2026-12-01',
        dueTime: '23:59',
        estimatedMinutes: 30,
        priority: 'Important',
        status: 'Not Started',
        completionMethod: 'manual',
        createdAt: now,
        updatedAt: now,
        loggedMinutes: 0,
        reminders: REMINDERS,
        remindersFired: [],
        verificationStatus: 'not_required',
        verificationRecords: [],
      },
      {
        id: REQUIRED_B,
        title: 'History reading',
        subject: 'History',
        platform: 'Other',
        dueDate: '2026-12-01',
        dueTime: '23:59',
        estimatedMinutes: 25,
        priority: 'Normal',
        status: 'Not Started',
        completionMethod: 'manual',
        createdAt: now,
        updatedAt: now,
        loggedMinutes: 0,
        reminders: REMINDERS,
        remindersFired: [],
        verificationStatus: 'not_required',
        verificationRecords: [],
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
      extensionSeen: true,
      focusGuard: false,
      // Otherwise Settings offers the consent card instead of the blocking
      // controls this suite drives.
      blockingAsked: true,
      canvasCheckWindow: {
        mode: 'manual',
        schoolDays: [1, 2, 3, 4, 5],
        schoolDayStart: 15 * 60 + 30,
        dayEnd: 21 * 60 + 30,
        freeDayStart: 9 * 60,
        pausedUntil: null,
        readAsIBrowse: false,
      },
    },
    focusMode: {
      active: true,
      startedAt: now,
      requiredTaskIds: [REQUIRED_A, REQUIRED_B],
      requiredCompletionCount: 2,
      completedCount: 0,
      temporaryUnlockUntil: null,
      overrideUsed: false,
      emergencyExitUsed: false,
      isTest: false,
      testExpiresAt: null,
    },
    activeSession: null,
    completedSessions: [
      {
        id: 'ses_1',
        assignmentId: CANVAS_DONE,
        assignmentTitle: 'Biology lab report',
        plannedMinutes: 40,
        actualMinutes: 40,
        startedAt: earlier,
        endedAt: earlier,
      },
    ],
    activity: [
      {
        id: 'evt_1',
        type: 'focus_mode_started',
        timestamp: now,
        message: 'Focus Mode started — 2 required tasks',
      },
    ],
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
    grades: { courses: [], lastReadAt: null },
    parentControls: {
      // No UI writes this one; the reducer reads it to refuse a protected
      // setting, which is invariant 17 and is checked below.
      lockVerificationSettings: true,
      protectBlocklistInStrictMode: false,
      protectAllowlistInStrictMode: false,
    },
    focusRuns: [
      {
        id: 'run_seed',
        startedAt: now,
        requiredTaskIds: [REQUIRED_A, REQUIRED_B],
        requiredCount: 2,
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

  await requirePortFree(CDP_PORT, 'debug port');
  site.listen(SITE_PORT, '127.0.0.1');

  const args = [
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT_DIR}`,
    `--disable-extensions-except=${EXT_DIR}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--host-resolver-rules=MAP youtube.com 127.0.0.1:${SITE_PORT},MAP www.youtube.com 127.0.0.1:${SITE_PORT}`,
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

    console.log('\nParent Dashboard E2E — PIN, controls, and real enforcement\n');

    const tab = await openTab(`${APP_ORIGIN}/`);
    appSession = tab.sessionId;

    /* ---- 0. Seed a device with no PIN yet ---- */
    step('seed the device');
    await app(
      `localStorage.setItem('lockin.state.v1', ${JSON.stringify(
        JSON.stringify(seedState()),
      )}); 1`,
    );
    await goto('/parent', 2500);

    /* ---- 1. No PIN, no dashboard ---- */
    step('the dashboard with no PIN set');
    let text = await pageText();
    check('a device with no PIN cannot open the dashboard at all', /No parent PIN is set/i.test(text));
    check(
      'and it explains where to set one rather than offering a way in',
      /Settings/i.test(text) && !/This week|Assignments completed/i.test(text),
      summarise(text, 90),
    );

    /* ---- 2. Setting the PIN, hashed ---- */
    step('set the parent PIN through Settings');
    await goto('/settings', 2500);
    await waitFor(clickByTextExpression('set parent pin'), { label: 'the Set parent PIN button' });
    await sleep(900);
    check('the PIN dialog asks for it twice', await fillPasswords([PIN, PIN], DIALOG_SCOPE));
    await sleep(300);
    await submitForm(DIALOG_SCOPE);
    await sleep(1200);

    let state = await readState();
    const pinRecord = state.parentPin;
    check('a PIN record is stored', !!pinRecord && typeof pinRecord.hash === 'string');
    check(
      'as a SHA-256 hash with a random salt',
      /^[0-9a-f]{64}$/.test(pinRecord?.hash ?? '') && /^[0-9a-f]{32}$/.test(pinRecord?.salt ?? ''),
      `hash ${pinRecord?.hash?.length ?? 0} chars, salt ${pinRecord?.salt?.length ?? 0} chars`,
    );
    check(
      'and the digits themselves are never stored',
      !Object.values(pinRecord ?? {}).includes(PIN),
    );

    /* ---- 3. The gate ---- */
    step('the parent gate');
    await goto('/parent', 2500);
    text = await pageText();
    check('the dashboard asks for the PIN', /Enter parent PIN/i.test(text));
    check(
      'and shows nothing about the week before it is entered',
      !/This week|Assignments completed|Verified completions|Recent work/i.test(text),
      summarise(text, 90),
    );

    await enterPin('0000');
    text = await pageText();
    check('a wrong PIN is rejected', /Incorrect PIN/i.test(text), summarise(text, 80));
    check('it says how many attempts are left', /4 attempts left/i.test(text));
    check('and the dashboard stays locked', /Enter parent PIN/i.test(text));

    step('the lockout');
    for (let i = 0; i < 4; i += 1) await enterPin('0000');
    text = await pageText();
    check('five wrong attempts trigger a lockout', /Too many wrong attempts/i.test(text), summarise(text, 80));
    check(
      'and the field itself is disabled while it lasts',
      (await app(`document.querySelector('input[type="password"]').disabled`)) === true,
    );

    // The lockout lives in component state, like the session itself — a reload
    // offers a fresh prompt rather than persisting a penalty. That is the
    // honest reading of invariant 16, and worth pinning so nobody "fixes" it
    // by writing an attempt counter to storage.
    await goto('/parent', 2500);
    check(
      'a reload offers a fresh prompt — nothing about the attempt is persisted',
      (await app(`document.querySelector('input[type="password"]').disabled`)) === false,
    );

    await enterPin(PIN);
    await sleep(900);
    text = await pageText();
    check('the correct PIN opens the dashboard', /Parent View/i.test(text));
    check('the weekly summary is visible', /This week|Assignments completed/i.test(text));

    /* ---- 4. The session is in memory only ---- */
    step('the parent session is never persisted');
    const keys = JSON.parse(
      await app(`JSON.stringify({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      })`),
    );
    check('sessionStorage holds nothing at all', keys.session.length === 0, keys.session.join(', '));
    check(
      'and no stored key belongs to the parent session',
      !keys.local.some((key) => /parent|session|unlock/i.test(key)),
      keys.local.join(', '),
    );
    state = await readState();
    check('and the stored state has no session field of its own', state.parentSession === undefined);

    await goto('/parent', 2500);
    check('a reload re-locks the dashboard', /Enter parent PIN/i.test(await pageText()));
    await enterPin(PIN);
    await sleep(900);
    check('and the PIN opens it again', /Parent View/i.test(await pageText()));

    /* ---- 5. Reviewing work ---- */
    step('review the work');
    await app(clickByTextExpression('Work'));
    await sleep(900);
    text = await pageText();
    check('the Canvas-verified completion is listed', /Biology lab report/i.test(text));
    check('labelled as Canvas verified', /Canvas verified/i.test(text));

    await app(clickByTextExpression('Biology lab report'));
    await sleep(800);
    let dialog = await app(DIALOG_EXPR);
    check('its details open', /Verification details/i.test(dialog), summarise(dialog, 90));
    check('showing the status Canvas itself reported', /Status detected[\s\S]*submitted/i.test(dialog));
    check('and stating plainly that browsing history is not stored', /Browsing history stored\s*No/i.test(dialog));
    check(
      'the dashboard never shows the assignment URL — invariant 14',
      !(await pageText()).includes(CANVAS_URL),
    );
    await app(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1`);
    await sleep(600);

    /* ---- 6. Blocking is real while the session runs ---- */
    step('real enforcement');
    check('youtube.com is blocked during the session', await isBlocked('http://youtube.com/'));

    await app(clickByTextExpression('Controls'));
    await sleep(900);
    check(
      'the dashboard shows Focus Mode as active',
      /Focus Mode[\s\S]*ACTIVE/i.test(await pageText()),
    );

    /* ---- 7. A parent-approved temporary unlock ---- */
    step('parent-approved temporary unlock');
    await app(clickByTextExpression('15 minutes'));
    await sleep(300);
    check('the unlock is approved', await app(clickByTextExpression('Approve unlock')));
    await sleep(2500);

    state = await readState();
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

    /* ---- 8. Parent controls ---- */
    step('parent controls');
    const beforeControls = (await readState()).activity.filter(
      (e) => e.type === 'parent_controls_changed',
    ).length;

    check(
      'the parent protects the blocklist during Strict sessions',
      await app(clickByLabelExpression('Protect blocked sites during Strict Mode')),
    );
    await sleep(1200);
    state = await readState();
    check(
      'and it is stored on the real controls object',
      state.parentControls.protectBlocklistInStrictMode === true,
    );
    check(
      'the change is logged exactly once',
      state.activity.filter((e) => e.type === 'parent_controls_changed').length ===
        beforeControls + 1,
    );

    /* ---- 9. Prospective only (invariant 15) ---- */
    step('nothing retroactive');
    const done = state.assignments.find((a) => a.id === CANVAS_DONE);
    check('tightening the rules did not re-open completed work', done.status === 'Completed');
    check(
      'and left its evidence exactly as it was',
      done.verificationRecords.length === 1 &&
        done.verificationRecords[0].id === 'ver_seed_canvas' &&
        done.verificationRecords[0].status === 'verified',
    );
    check(
      'the required count the student is working to is unchanged',
      state.focusMode.requiredCompletionCount === 2 && state.focusMode.completedCount === 0,
    );

    /* ---- 10. Exit Parent View ---- */
    step('exit parent view');
    await app(clickByTextExpression('Exit Parent View'));
    await sleep(1500);
    check('the student view returns', /Focus|Home|Work/i.test(await pageText()));

    await goto('/parent', 2000);
    check('and the dashboard is locked again immediately', /Enter parent PIN/i.test(await pageText()));

    /* ---- 11. Protected settings are refused by the reducer ---- */
    step('protected settings');
    await goto('/settings', 2500);
    check(
      'Settings offers the blocking master switch',
      /Enable blocking/i.test(await pageText()),
    );
    check('the student can reach it', await app(clickByLabelExpression('Enable blocking')));
    await sleep(1500);
    state = await readState();
    check(
      'turning blocking off is refused while the parent lock is on — invariant 17',
      state.settings.blockingEnabled === true,
    );
    check('so youtube.com is still blocked', await isBlocked('http://youtube.com/'));

    /* ---- 12. The blocklist is protected during a Strict session ---- */
    step('the protected blocklist');
    await goto('/settings', 2500);
    check(
      'Settings says the blocklist is managed by Parent Controls',
      /Managed by Parent Controls/i.test(await pageText()),
    );
    check('removing a blocked site is offered', await app(clickByLabelExpression('Remove youtube.com')));
    await sleep(900);
    dialog = await app(DIALOG_EXPR);
    check('but it asks for the parent PIN first', /Parent PIN required/i.test(dialog), summarise(dialog, 90));
    await app(clickByTextExpression('cancel', DIALOG_BUTTON));
    await sleep(700);
    state = await readState();
    check(
      'and cancelling leaves the site blocked',
      state.settings.blockedDomains.includes('youtube.com'),
    );

    // Tightening your own restrictions is always allowed, PIN or no PIN.
    await app(`(() => {
      const input = document.querySelector('input[aria-label*="youtube.com or"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'reddit.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.form.requestSubmit();
      return true;
    })()`);
    await sleep(1200);
    state = await readState();
    check(
      'adding a site never needs the PIN',
      state.settings.blockedDomains.includes('reddit.com'),
      state.settings.blockedDomains.join(', '),
    );

    /* ---- 13. Focus Mode ends through the one engine ---- */
    step('finish the required work');
    await goto('/focus', 2500);
    check(
      'the focus screen lists the required work',
      /Required work: 0 \/ 2/i.test(await pageText()),
      summarise(await pageText(), 120),
    );

    check(
      'the first required task is ticked off',
      await app(clickByLabelExpression('Mark Algebra problem set complete')),
    );
    await sleep(1500);
    state = await readState();
    check('one of two done does not end Focus Mode', state.focusMode.active === true);
    check('and youtube.com is still blocked with work outstanding', await isBlocked('http://youtube.com/'));

    check(
      'the last required task is ticked off',
      await app(clickByLabelExpression('Mark History reading complete')),
    );
    await sleep(2000);
    state = await readState();
    check('Focus Mode ends through the existing engine', state.focusMode.active === false);
    check(
      'the run is closed as completed, not overridden',
      state.focusRuns.some((run) => run.id === 'run_seed' && run.outcome === 'completed'),
      state.focusRuns.map((r) => r.outcome).join(', '),
    );
    await sleep(2500);
    check('and youtube.com unblocks', (await isBlocked('http://youtube.com/')) === false);

    /* ---- 14. The dashboard shows what actually happened ---- */
    step('reopen the dashboard');
    await goto('/parent', 2000);
    check('the dashboard requires the PIN again', /Enter parent PIN/i.test(await pageText()));
    await enterPin(PIN);
    await sleep(1200);

    await app(clickByTextExpression('Work'));
    await sleep(1000);
    text = await pageText();
    check('the new completions are listed', /Algebra problem set/i.test(text) && /History reading/i.test(text));
    check(
      'and honestly labelled Manual rather than verified',
      /Manual/i.test(text),
      summarise(text, 120),
    );

    await app(clickByTextExpression('Focus'));
    await sleep(900);
    text = await pageText();
    check('the focus history shows the completed run', /Completed normally/i.test(text));
    check('and the parent-approved unlock, counted separately', /temporary unlock/i.test(text));
    check(
      'blocked attempts are per-domain counts, never pages',
      !text.includes('http://youtube.com/'),
    );

    /* ---- 15. Data, privacy, and clearing history ---- */
    step('the data panel');
    await app(clickByTextExpression('Data'));
    await sleep(900);
    text = await pageText();
    check('the privacy statement is shown', /Everything is stored locally on this device/i.test(text));
    check(
      'and it is honest about what the PIN is not',
      /not a security boundary/i.test(text),
      summarise(text, 90),
    );

    check(
      'clearing verification history is offered',
      await app(clickByTextExpression('Clear verification history')),
    );
    await sleep(700);
    await app(clickByTextExpression('delete', DIALOG_BUTTON));
    await sleep(1500);
    state = await readState();
    check(
      'the evidence records go',
      state.assignments.every((a) => a.verificationRecords.length === 0),
    );
    check(
      'but the schoolwork stays completed — invariant 38',
      state.assignments.filter((a) => a.status === 'Completed').length === 3,
    );
    check('and the parent PIN is untouched', !!state.parentPin?.hash);
  } finally {
    clearInterval(watchdog);
    browser?.close();
    await killChrome(chrome, CDP_PORT, workDir);
    site.close();
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(
    `\n${failures === 0 ? 'All Parent Dashboard E2E checks passed' : `${failures} check(s) failed`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
