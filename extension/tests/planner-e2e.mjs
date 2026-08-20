/**
 * The Smart Study Planner end to end, in a real browser with the real
 * extension and the real Canvas fixture host.
 *
 * The flows this exists to prove:
 *
 *   availability → build a plan → today shows assignment + exam study
 *     → Start hands the item to the *existing* focus timer
 *     → 30 of 45 planned minutes are logged
 *     → the remaining work is recalculated, not forgotten
 *   a whole missed day → unfinished minutes reappear on later days, and no
 *     day is ever planned past its capacity
 *   Canvas reports Submitted → the assignment completes through the existing
 *     verification chain → its future chunks disappear from the plan
 *   300 minutes of work with 100 minutes of capacity → 100 scheduled and the
 *     shortfall stated on screen, never silently overbooked
 *
 * Needs: the dev server on :5173, and Chrome for Testing.
 * Run: npm run test:planner-e2e
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, killChrome, launchChrome, requirePortFree } from './chrome-harness.mjs';
import { createCanvasFixtureServer } from './canvas-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..');
const APP_ORIGIN = 'http://localhost:5173';
const CANVAS_HOST = 'planner.instructure.test';
const TLS_PORT = 8443;
const CDP_PORT = 9341;
const HEADFUL = process.argv.includes('--headful');
const VERBOSE = process.argv.includes('--verbose');

const CHROME = findChrome();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/* ---------------- watchdog ---------------- */

let currentStep = 'starting up';
let stepStartedAt = Date.now();
const STEP_LIMIT_MS = 3 * 60_000;

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
let appTarget = null;

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
  await sleep(1400);
  return { targetId, sessionId };
}

async function closeTab(targetId) {
  await browser.send('Target.closeTarget', { targetId });
}

/* ---------------- UI helpers ---------------- */

function clickByText(text, selector = 'button') {
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

const BUTTONS = `[...document.querySelectorAll('button, a')]
  .map((b) => (b.textContent || '').trim() + (b.disabled ? ' [disabled]' : ''))
  .filter(Boolean).join(' | ')`;

const summarise = (text, max = 300) =>
  (text || '').replace(/\s+/g, ' ').slice(0, max);

async function waitFor(expression, { timeout = 25_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await app(expression)) return true;
    await sleep(300);
  }
  const buttons = await app(BUTTONS).catch(() => '(unreadable)');
  const text = await app('document.body.innerText').catch(() => '');
  throw new Error(
    `Timed out waiting for ${label}\n    buttons: ${summarise(buttons, 400)}\n    page: ${summarise(text, 400)}`,
  );
}

async function clickAndWait(text, selector = 'button') {
  const clicked = await app(clickByText(text, selector));
  if (!clicked) {
    const buttons = await app(BUTTONS);
    throw new Error(`No clickable "${text}". Available: ${summarise(buttons, 400)}`);
  }
  await sleep(700);
  return true;
}

/** Sends a bridge message from the LockIn page and waits for the reply. */
async function bridgeRequest(type, payload, timeoutMs = 10_000) {
  const expr = `new Promise((resolve) => {
    const id = 'e2e-' + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => resolve(null), ${timeoutMs});
    window.addEventListener('message', function handler(e) {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data;
      if (d && d.source === 'lockin-extension' && d.requestId === id) {
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(JSON.stringify(d.payload));
      }
    });
    window.postMessage({
      source: 'lockin-web', version: 1, type: ${JSON.stringify(type)},
      requestId: id, payload: ${JSON.stringify(payload ?? null)}
    }, location.origin);
  })`;
  const value = await app(expr);
  return value ? JSON.parse(value) : null;
}

const pageText = () => app('document.body.innerText');
const readState = async () =>
  JSON.parse((await app(`localStorage.getItem('lockin.state.v1')`)) ?? 'null');

async function writeState(state) {
  await app(
    `localStorage.setItem('lockin.state.v1', ${JSON.stringify(JSON.stringify(state))}); 1`,
  );
}

async function navigate(path) {
  await browser.send('Page.navigate', { url: `${APP_ORIGIN}${path}` }, appSession);
  await sleep(1800);
}

/* ---------------- dates ---------------- */

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const D = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return iso(d);
};

/* ---------------- seed ---------------- */

/** Availability wide enough that the planner's own limits do the constraining. */
function availability(patch = {}) {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    available: true,
    startTime: '00:00',
    endTime: '23:59',
    maxMinutes: 240,
    restDay: false,
    ...patch,
  }));
}

function plannerSettings(patch = {}) {
  return {
    configured: true,
    availability: availability(),
    fixedBlocks: [],
    weekdayMaxMinutes: 240,
    weekendMaxMinutes: 240,
    bufferPercent: 0,
    focusBlockMinutes: 25,
    breakMinutes: 5,
    minChunkMinutes: 15,
    maxChunkMinutes: 45,
    deadlineBufferHours: 0,
    workloadPreference: 'Intensive',
    horizonDays: 14,
    useAdjustedEstimates: false,
    ...patch,
  };
}

function assignment(over = {}) {
  const now = new Date().toISOString();
  return {
    id: over.id ?? 'asg_math',
    title: over.title ?? 'Math Worksheet',
    subject: over.subject ?? 'Math',
    platform: over.platform ?? 'Other',
    dueDate: over.dueDate ?? D(1),
    dueTime: over.dueTime ?? '23:59',
    estimatedMinutes: over.estimatedMinutes ?? 60,
    priority: over.priority ?? 'Normal',
    status: over.status ?? 'Not Started',
    completionMethod: over.completionMethod ?? 'manual',
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: now,
    loggedMinutes: over.loggedMinutes ?? 0,
    reminders: {
      firstReminderMinutes: 120,
      escalationMinutes: 60,
      focusWarningMinutes: 30,
      enabled: false,
    },
    remindersFired: [],
    verificationStatus: over.verificationStatus ?? 'not_required',
    verificationRecords: [],
    ...(over.canvas
      ? {
          canvas: over.canvas,
          externalCourseId: over.externalCourseId,
          externalAssignmentId: over.externalAssignmentId,
          verificationMethod: 'canvas',
        }
      : {}),
  };
}

function exam(over = {}) {
  return {
    id: over.id ?? 'exm_bio',
    name: over.name ?? 'Biology Exam',
    subject: over.subject ?? 'Biology',
    examDate: over.examDate ?? D(4),
    materialAmount: over.materialAmount ?? 'Medium',
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: new Date().toISOString(),
    studyEstimateMinutes: over.studyEstimateMinutes,
    loggedMinutes: over.loggedMinutes ?? 0,
  };
}

function seedState(over = {}) {
  return {
    schemaVersion: 6,
    profile: { firstName: 'Alex', onboarded: true, createdAt: '2026-01-01T09:00:00.000Z' },
    assignments: over.assignments ?? [],
    exams: over.exams ?? [],
    settings: {
      reminderMode: 'Normal',
      defaultStudyTime: '17:00',
      defaultFocusMinutes: 25,
      blockingEnabled: true,
      blockedDomains: ['distraction.test'],
      allowedDomains: ['google.com'],
      notificationsAsked: true,
      theme: 'light',
      edgenuityProofMode: 'standard',
    },
    focusMode: {
      active: false,
      startedAt: null,
      requiredTaskIds: [],
      requiredCompletionCount: 0,
      completedCount: 0,
      temporaryUnlockUntil: null,
      overrideUsed: false,
      emergencyExitUsed: false,
      isTest: false,
      testExpiresAt: null,
    },
    activeSession: over.activeSession ?? null,
    completedSessions: over.completedSessions ?? [],
    activity: [],
    parentPin: null,
    blockStats: [],
    canvas: over.canvas ?? {
      connection: null,
      courses: [],
      detected: [],
      ignoredKeys: [],
      lastSyncAt: null,
      lastError: null,
    },
    edgenuity: {
      sessions: [],
      challenges: [],
      developerMode: false,
      cameraPermission: 'unknown',
      ocrEverLoaded: false,
    },
    parentControls: {
      lockVerificationSettings: false,
      protectBlocklistInStrictMode: false,
      protectAllowlistInStrictMode: false,
    },
    focusRuns: [],
    planner: {
      settings: over.plannerSettings ?? plannerSettings(),
      plan: null,
      history: [],
      skips: [],
      manualOrders: [],
      lockedDates: [],
      acceptedSubjectFactors: [],
      ...(over.planner ?? {}),
    },
  };
}

/** Seeds a state, reloads onto a page, and returns once the app has settled. */
async function load(state, path = '/home') {
  await navigate('/');
  await writeState(state);
  await navigate(path);
}

/* ---------------- plan helpers ---------------- */

const planOf = (state) => state?.planner?.plan ?? null;
const itemsOn = (state, date) =>
  planOf(state)?.days.find((d) => d.date === date)?.items ?? [];
const allItems = (state) => (planOf(state)?.days ?? []).flatMap((d) => d.items);
const minutesFor = (state, sourceId) =>
  allItems(state)
    .filter((i) => i.sourceId === sourceId)
    .reduce((sum, i) => sum + i.plannedMinutes, 0);

/* ---------------- extension ---------------- */

let profileDir = null;
let chrome = null;
let canvasFixtures = null;

/**
 * A throwaway copy of the extension with the fixture Canvas host allowed, so
 * the content script runs there. The shipped manifest deliberately does not
 * list a test hostname.
 */
function prepareExtension(dir) {
  const copy = join(dir, 'extension');
  cpSync(EXT_DIR, copy, {
    recursive: true,
    filter: (src) => !src.includes('/tests') && !src.includes('/node_modules'),
  });
  return copy;
}

async function attachWorker() {
  for (let i = 0; i < 60; i += 1) {
    const targets = (await browser.send('Target.getTargets')).result.targetInfos;
    const worker = targets.find(
      (t) => t.type === 'service_worker' && t.url.endsWith('/background/service-worker.js'),
    );
    if (worker) return new URL(worker.url).hostname;
    await sleep(300);
  }
  return null;
}

/* ================================================================== */
/* Main                                                               */
/* ================================================================== */

async function main() {
  if (!CHROME) {
    console.error('\nNo Chrome for Testing found. Set CHROME_BIN.\n');
    process.exit(1);
  }
  const appUp = await fetch(APP_ORIGIN)
    .then((r) => r.ok)
    .catch(() => false);
  if (!appUp) {
    console.error(
      `\nLockIn dev server is not running on ${APP_ORIGIN}.\nStart it with:  cd web && npm run dev\n`,
    );
    process.exit(1);
  }
  await requirePortFree(CDP_PORT, 'Chrome debug port');

  profileDir = mkdtempSync(join(tmpdir(), 'lockin-planner-e2e-'));
  canvasFixtures = createCanvasFixtureServer({ certDir: profileDir });
  await canvasFixtures.listen(TLS_PORT);

  const extensionDir = prepareExtension(profileDir);
  chrome = launchChrome(CHROME, [
    ...(HEADFUL ? [] : ['--headless=new']),
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--host-resolver-rules=MAP ${CANVAS_HOST} 127.0.0.1:${TLS_PORT}`,
    '--ignore-certificate-errors',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  const version = await fetchJSON('/json/version');
  browser = new CDP(version.webSocketDebuggerUrl);
  const extensionId = await attachWorker();

  console.log(`\nSmart Study Planner end-to-end tests\nExtension: ${extensionId ?? '(none)'}\n`);

  const tab = await openTab(`${APP_ORIGIN}/`);
  appSession = tab.sessionId;
  appTarget = tab.targetId;

  /* ============================================================== */
  console.log('TEST 1 — empty state: the planner offers to build a plan');
  step('empty state');
  await load(seedState({ plannerSettings: plannerSettings({ configured: false }) }));
  {
    const text = await pageText();
    check('dashboard invites the student to build a plan', /No study plan yet/i.test(text), summarise(text, 120));
    await navigate('/planner');
    check('the planner page loads', /Planner/i.test(await pageText()));
  }

  /* ============================================================== */
  console.log('\nTEST 2 — the critical flow: plan → start → partial session → recalculate');
  step('seed the critical flow');
  await load(
    seedState({
      assignments: [assignment({ estimatedMinutes: 60, dueDate: D(1) })],
      exams: [exam({ examDate: D(4), materialAmount: 'Medium' })],
      plannerSettings: plannerSettings({
        configured: false,
        weekdayMaxMinutes: 90,
        weekendMaxMinutes: 90,
        availability: availability({ maxMinutes: 90 }),
      }),
    }),
    '/planner',
  );

  step('build the plan from the UI');
  await clickAndWait('Build my plan');
  await waitFor(`document.body.innerText.includes('Today’s plan')`, {
    label: "today's plan",
  });

  {
    const state = await readState();
    const today = itemsOn(state, D(0));
    check('a plan was generated', !!planOf(state), `version ${planOf(state)?.planVersion}`);
    check(
      'today holds both the assignment and exam study',
      today.some((i) => i.sourceType === 'assignment') &&
        today.some((i) => i.sourceType === 'exam'),
      today.map((i) => `${i.title} ${i.plannedMinutes}m`).join(', '),
    );
    const planned = today.reduce((s, i) => s + i.plannedMinutes, 0);
    check('today respects the 90-minute limit', planned <= 90, `${planned} min planned`);

    const text = await pageText();
    check('the plan is visible with times and minutes', /min/.test(text) && /Math Worksheet/.test(text));
    check(
      'nothing claims an AI made the decision',
      !/(AI (thinks|suggests|recommends|decided|picked))|powered by AI|smart AI/i.test(text),
      summarise(text, 120),
    );
  }

  step('why this?');
  await clickAndWait('Why this?');
  {
    const text = await pageText();
    check(
      'the explanation is stated as a calculation, not an opinion',
      /LockIn scheduled this because/i.test(text),
      summarise(text, 160),
    );
    check('it cites the deadline', /Due (today|tomorrow|in \d+ day)/i.test(text));
  }

  step('start the planned Math session');
  const beforeStart = await readState();
  const mathItem = itemsOn(beforeStart, D(0)).find((i) => i.sourceType === 'assignment');
  await clickAndWait('Start', 'button');
  await sleep(1200);
  {
    const state = await readState();
    check(
      'the existing focus timer is running, pre-filled from the plan',
      state.activeSession?.assignmentId === 'asg_math' &&
        state.activeSession.plannedMinutes === mathItem.plannedMinutes,
      JSON.stringify(state.activeSession && {
        assignmentId: state.activeSession.assignmentId,
        minutes: state.activeSession.plannedMinutes,
      }),
    );
    check(
      'no second timer was created',
      state.planner.plan.days.every((d) => d.items.every((i) => !('timer' in i))),
    );
  }

  step('log 30 of the planned minutes');
  {
    // The timer is stored as timestamps, so rewinding the start and reloading
    // is exactly how it recovers from a refresh — no simulated clock needed.
    const state = await readState();
    state.activeSession.runningSince = new Date(Date.now() - 30 * 60_000).toISOString();
    state.activeSession.startedAt = state.activeSession.runningSince;
    await writeState(state);
    await navigate('/focus');
    await clickAndWait('End session');
    await clickAndWait('End and log');
    await sleep(1200);
  }
  {
    const state = await readState();
    const math = state.assignments.find((a) => a.id === 'asg_math');
    check('30 minutes were logged against the assignment', math.loggedMinutes === 30, `${math.loggedMinutes}`);
    check(
      'exactly the remainder stays planned',
      minutesFor(state, 'asg_math') === 30,
      `${minutesFor(state, 'asg_math')} min still planned`,
    );
    check('the plan was recalculated', state.planner.plan.reason === 'session_logged');
    check(
      'no day exceeds its capacity after the recalculation',
      state.planner.plan.days.every((d) => d.plannedMinutes <= d.capacityMinutes),
    );
  }

  /* ============================================================== */
  console.log('\nTEST 3 — a missed day: work is redistributed, never dropped');
  step('seed a plan built yesterday');
  await load(
    seedState({
      assignments: [
        assignment({ id: 'asg_math', title: 'Math', estimatedMinutes: 30, dueDate: D(4) }),
        assignment({ id: 'asg_sci', title: 'Science', subject: 'Science', estimatedMinutes: 30, dueDate: D(4) }),
      ],
      plannerSettings: plannerSettings({ weekdayMaxMinutes: 60, weekendMaxMinutes: 60 }),
    }),
    '/planner',
  );
  await clickAndWait('Rebuild plan');
  await clickAndWait('Apply');
  await sleep(800);

  {
    // Move the whole plan back a day, as if it had been built yesterday and
    // the student had done none of it.
    const state = await readState();
    const plan = state.planner.plan;
    const shift = (date) => {
      const d = new Date(`${date}T12:00:00`);
      d.setDate(d.getDate() - 1);
      return iso(d);
    };
    plan.planningHorizonStart = shift(plan.planningHorizonStart);
    plan.days = plan.days.map((day) => ({
      ...day,
      date: shift(day.date),
      items: day.items.map((i) => ({ ...i, scheduledDate: shift(i.scheduledDate) })),
    }));
    await writeState(state);
    await navigate('/home');
    await sleep(2500);
  }

  {
    const state = await readState();
    const plan = planOf(state);
    check('the plan rolled over to today', plan.planningHorizonStart === D(0), plan.planningHorizonStart);
    check('the rollover is recorded as the reason', plan.reason === 'day_rollover', plan.reason);
    check(
      'nothing is left scheduled on a day that has passed',
      plan.days.every((d) => d.date >= D(0)),
    );
    check(
      'every unfinished minute is still planned',
      minutesFor(state, 'asg_math') + minutesFor(state, 'asg_sci') === 60,
      `${minutesFor(state, 'asg_math')} + ${minutesFor(state, 'asg_sci')}`,
    );
    check(
      'capacity is still respected after redistribution',
      plan.days.every((d) => d.plannedMinutes <= d.capacityMinutes),
    );
    check(
      'the carried-forward work was measured at the rollover',
      (state.planner.lastRecovery?.unfinishedMinutes ?? 0) > 0,
      JSON.stringify(state.planner.lastRecovery),
    );
    const text = await pageText();
    check(
      'the student is told what moved, without being lectured',
      /Plan updated/i.test(text) && /Nothing was dropped/i.test(text),
      summarise(text, 200),
    );
  }

  /* ============================================================== */
  console.log('\nTEST 4 — overload is reported, never silently overbooked');
  step('300 minutes of work, 100 minutes of capacity, due tomorrow');
  await load(
    seedState({
      assignments: [
        assignment({ id: 'asg_big', title: 'Huge Project', estimatedMinutes: 300, dueDate: D(1) }),
      ],
      plannerSettings: plannerSettings({
        weekdayMaxMinutes: 100,
        weekendMaxMinutes: 100,
        // Two 50-minute sessions fill the day exactly; the planner allows at
        // most two sessions of one task per day, which is the realistic limit.
        maxChunkMinutes: 50,
        availability: availability({ maxMinutes: 100 }),
      }),
    }),
    '/planner',
  );
  await clickAndWait('Rebuild plan');
  await clickAndWait('Apply');
  await sleep(1000);

  {
    const state = await readState();
    const plan = planOf(state);
    const today = itemsOn(state, D(0)).reduce((s, i) => s + i.plannedMinutes, 0);
    check('today is filled to capacity but no further', today === 100, `${today} min`);
    check(
      'the shortfall is reported',
      plan.unscheduledMinutes >= 100,
      `${plan.unscheduledMinutes} min unscheduled`,
    );
    check(
      'a cannot-fit warning exists',
      plan.warnings.some((w) => w.kind === 'assignment_cannot_fit'),
      plan.warnings.map((w) => w.kind).join(', '),
    );
    const text = await pageText();
    check(
      'the shortfall is stated on screen with numbers',
      /may not fit before its deadline/i.test(text) && /nowhere to go/i.test(text),
      summarise(text, 200),
    );
    check(
      'no day is overbooked despite the impossible workload',
      plan.days.every((d) => d.plannedMinutes <= d.capacityMinutes),
    );
  }

  /* ============================================================== */
  console.log('\nTEST 5 — "I can’t do this today" reschedules without a PIN');
  step('skip today');
  {
    const before = await readState();
    const accountedBefore = minutesFor(before, 'asg_big') + planOf(before).unscheduledMinutes;
    await clickAndWait('Can’t do this today');
    await sleep(1200);
    const state = await readState();
    check('today is now clear of that work', itemsOn(state, D(0)).length === 0);
    // The strong invariant: every remaining minute is either scheduled
    // somewhere or reported as not fitting. Nothing is ever just gone.
    const accountedAfter = minutesFor(state, 'asg_big') + planOf(state).unscheduledMinutes;
    check(
      'every minute is still accounted for — moved or reported',
      accountedAfter === accountedBefore && accountedAfter === 300,
      `${minutesFor(state, 'asg_big')} planned + ${planOf(state).unscheduledMinutes} unscheduled`,
    );
    check(
      'the newly impossible work is flagged',
      planOf(state).warnings.some((w) => w.kind === 'assignment_cannot_fit'),
    );
    check('no parent PIN was required', state.parentPin === null);
  }

  /* ============================================================== */
  console.log('\nTEST 6 — Canvas verification removes future chunks');
  step('seed a Canvas-linked assignment inside the plan');
  const canvasUrl = `https://${CANVAS_HOST}/courses/101/assignments/5001`;
  await load(
    seedState({
      assignments: [
        assignment({
          id: 'asg_canvas',
          title: 'Chapter 4 Review Problems',
          subject: 'Math',
          platform: 'Canvas',
          estimatedMinutes: 120,
          dueDate: D(3),
          completionMethod: 'canvas',
          verificationStatus: 'pending',
          externalCourseId: '101',
          externalAssignmentId: '5001',
          canvas: {
            domain: CANVAS_HOST,
            url: canvasUrl,
            submissionStatus: 'not_submitted',
            lastCheckedAt: null,
            lastStatusChangeAt: null,
          },
        }),
      ],
      canvas: {
        connection: {
          domain: CANVAS_HOST,
          mode: 'browser',
          connectedAt: new Date().toISOString(),
          lastSeenAt: null,
          permissionGranted: true,
        },
        courses: [],
        detected: [],
        ignoredKeys: [],
        lastSyncAt: null,
        lastError: null,
      },
    }),
    '/planner',
  );
  await clickAndWait('Rebuild plan');
  await clickAndWait('Apply');
  await sleep(1000);

  {
    const state = await readState();
    check(
      'Canvas work is planned like any other work',
      minutesFor(state, 'asg_canvas') === 120,
      `${minutesFor(state, 'asg_canvas')} min`,
    );
    check(
      'it is split into several sessions',
      allItems(state).filter((i) => i.sourceId === 'asg_canvas').length > 1,
    );
  }

  step('the student submits it in Canvas');
  // The extension holds its own Canvas configuration; the web state alone does
  // not make the content script run on a host.
  await bridgeRequest('CANVAS_CONFIGURE', { domain: CANVAS_HOST });
  /**
   * Phase 18 put a gate in front of every Canvas read, and it ships closed —
   * manual mode, passive reading off. This suite is about the planner
   * reacting to a completion, not about when a read is permitted (that is
   * `canvas-grades` and TEST 0b of `canvas-e2e`), so the window is opened
   * explicitly here rather than left to a default that would make the whole
   * step silently do nothing.
   */
  await bridgeRequest('CANVAS_SET_WINDOW', {
    window: {
      mode: 'scheduled',
      schoolDays: [],
      schoolDayFrom: 0,
      schoolDayStart: 0,
      dayEnd: 1440,
      freeDayStart: 0,
      pausedUntil: null,
      readAsIBrowse: true,
    },
  });
  canvasFixtures.setSubmitted('/courses/101/assignments/5001');
  const canvasTab = await openTab(canvasUrl);
  await sleep(3000);
  await closeTab(canvasTab.targetId);
  await bridgeRequest('CANVAS_SYNC', null, 15_000);
  await sleep(2000);
  await navigate('/planner');
  await sleep(1500);

  {
    const state = await readState();
    const target = state.assignments.find((a) => a.id === 'asg_canvas');
    const completed = target.status === 'Completed';
    check('Canvas verification completed the assignment', completed, target.status);
    if (completed) {
      check(
        'its remaining chunks disappeared from the plan',
        minutesFor(state, 'asg_canvas') === 0,
        `${minutesFor(state, 'asg_canvas')} min still planned`,
      );
      check(
        'the planner reacted to the assignment status, not to Canvas',
        state.planner.plan.reason === 'assignment_completed',
        state.planner.plan.reason,
      );
    } else {
      check('its remaining chunks disappeared from the plan', false, 'assignment never completed');
      check('the planner reacted to the assignment status', false, 'skipped');
    }
  }

  /* ============================================================== */
  console.log('\nTEST 7 — Focus Mode integration: the planner requires, the blocker blocks');
  step('start today’s plan');
  await load(
    seedState({
      assignments: [
        assignment({ id: 'asg_math', estimatedMinutes: 45, dueDate: D(1) }),
        assignment({ id: 'asg_eng', title: 'Essay', subject: 'English', estimatedMinutes: 45, dueDate: D(2) }),
      ],
      exams: [exam({ examDate: D(3) })],
      plannerSettings: plannerSettings({ weekdayMaxMinutes: 180, weekendMaxMinutes: 180 }),
    }),
    '/home',
  );
  await clickAndWait('Start today’s plan');
  await sleep(1200);
  {
    const state = await readState();
    check('Focus Mode is on', state.focusMode.active === true);
    check(
      'only assignments are required — an exam timer cannot unlock the browser',
      state.focusMode.requiredTaskIds.every((id) => state.assignments.some((a) => a.id === id)) &&
        state.focusMode.requiredTaskIds.length === 2,
      state.focusMode.requiredTaskIds.join(', '),
    );
    check('the existing Focus Mode engine owns the requirement count', state.focusMode.requiredCompletionCount === 2);
    check('no second blocker was created', state.focusRuns.length === 1);
  }

  /* ============================================================== */
  console.log('\nTEST 8 — the planner page: week view, capacity and exam study');
  step('week view');
  await navigate('/planner');
  await clickAndWait('This Week');
  {
    const text = await pageText();
    check('the week view shows per-day load', /MON|TUE|WED|THU|FRI|SAT|SUN/.test(text));
    check('it shows planned against available minutes', /Minutes planned|planned/i.test(text));
  }
  step('exam tab');
  await clickAndWait('Exams');
  {
    const text = await pageText();
    check('exam study distinguishes planned, completed and recommended', /planned/.test(text) && /recommended/.test(text));
  }
  step('availability tab');
  await clickAndWait('Availability');
  {
    const text = await pageText();
    check('availability can be edited per weekday', /Monday/.test(text) && /Rest day/.test(text));
    check('fixed commitments are supported', /Fixed commitments/i.test(text));
  }
  step('settings tab');
  await clickAndWait('Settings');
  {
    const text = await pageText();
    check('daily limits are editable', /Maximum planned homework per weekday/i.test(text));
    check('the buffer is explained honestly', /deliberately left unplanned/i.test(text));
    check(
      'the limitations are stated plainly',
      /What the planner can’t know/i.test(text) && /surprise|not set yet|have not set yet/i.test(text),
      summarise(text, 150),
    );
  }

  /* ============================================================== */
  console.log('\nTEST 9 — responsive: mobile and desktop');
  step('mobile viewport');
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
    appSession,
  );
  await navigate('/planner');
  {
    const overflow = await app(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    check('no horizontal overflow on a phone', overflow <= 2, `${overflow}px`);
    const navVisible = await app(
      `!![...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === '/planner')`,
    );
    check('the planner is reachable from the mobile nav', navVisible === true);
  }
  step('desktop viewport');
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
    appSession,
  );
  await navigate('/home');
  {
    const overflow = await app(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    check('no horizontal overflow on desktop', overflow <= 2, `${overflow}px`);
    check("the dashboard shows today's plan", /Today’s plan/.test(await pageText()));
  }

  /* ============================================================== */
  console.log('\nTEST 10 — determinism: rebuilding changes nothing on its own');
  step('rebuild twice');
  {
    const before = await readState();
    await navigate('/planner');
    await clickAndWait('Rebuild plan');
    const text = await pageText();
    check(
      'the preview says nothing would change',
      /Nothing would change/i.test(text),
      summarise(text, 160),
    );
    await clickAndWait('Cancel');
    const after = await readState();
    check(
      'cancelling leaves the plan untouched',
      planOf(after).planVersion === planOf(before).planVersion,
    );
  }

  await closeTab(appTarget);
}

main()
  .then(async () => {
    console.log(`\n${failures === 0 ? 'All planner E2E checks passed.' : `${failures} check(s) failed.`}\n`);
    await cleanup();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error(`\nPlanner E2E failed during "${currentStep}":\n${error.stack ?? error}\n`);
    await cleanup();
    process.exit(1);
  });

async function cleanup() {
  clearInterval(watchdog);
  try {
    browser?.close();
  } catch {
    /* already closed */
  }
  try {
    canvasFixtures?.close();
  } catch {
    /* already closed */
  }
  await killChrome(chrome, CDP_PORT, profileDir);
  if (profileDir) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
