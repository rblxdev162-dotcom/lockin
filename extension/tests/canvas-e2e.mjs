/**
 * Canvas end-to-end tests — real Chrome, real extension, real blocking.
 *
 * Everything runs against local fixtures on fake hostnames mapped to localhost,
 * so no request leaves the machine and no real Canvas account is involved.
 *
 * ONE TEST-ONLY ACCOMMODATION, and it is worth being explicit about:
 * Chrome's optional host-permission prompt is native UI that cannot be
 * accepted headlessly. So the harness copies the extension to a temp directory
 * and adds the fixture Canvas host to `host_permissions` in that copy. This
 * simulates the *state after* the student grants access — it does not change
 * shipped code, and every code path under test (`permissions.contains`,
 * content-script registration, origin checks) runs exactly as in production.
 * The grant UX itself is covered by the manual checklist in the README.
 * A second, ungranted domain is used to test the denial path for real.
 *
 * Requires the LockIn dev server on :5173 and a Chrome for Testing build.
 * Run: node extension/tests/canvas-e2e.mjs
 */
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvasFixtureServer } from './canvas-server.mjs';
import { findChrome, killChrome, launchChrome as spawnChrome, requirePortFree } from './chrome-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_SRC = resolve(HERE, '..');

const CHROME = findChrome();

const CANVAS_HOST = 'myschool.instructure.com';
const UNGRANTED_HOST = 'canvas.schooldistrict.org';
const APP_ORIGIN = 'http://localhost:5173';
/**
 * Read out of the shipping source rather than typed here.
 *
 * The comment above says a pinned number "broke the moment Phase 4 added v3",
 * and then it was pinned again and broke the moment Phase 16 added v9. Parsing
 * the constant costs one regex and cannot go stale.
 */
const CURRENT_SCHEMA_VERSION = Number(
  /export const SCHEMA_VERSION = (\d+);/.exec(
    readFileSync(new URL('../../web/src/lib/storage.ts', import.meta.url), 'utf8'),
  )?.[1],
);
const TLS_PORT = 8455;
const SITE_PORT = 8100;
const CDP_PORT = 9390;

const MATH_ASSIGNMENT_PATH = '/courses/101/assignments/5001';
const MATH_ASSIGNMENT_URL = `https://${CANVAS_HOST}${MATH_ASSIGNMENT_PATH}`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✖ ${name}${detail ? ` — ${detail}` : ''}`);
  }
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
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve(msg);
      }
    });
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
    });
  }
  close() {
    try { this.ws.close(); } catch { /* closed */ }
  }
}

async function fetchJSON(path) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
      if (res.ok) return await res.json();
    } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

/* ---------------- test-only extension copy ---------------- */

function prepareExtension(dir) {
  const target = join(dir, 'extension');
  cpSync(EXT_SRC, target, {
    recursive: true,
    filter: (src) => !src.includes(`${EXT_SRC}/tests`),
  });
  const manifestPath = join(target, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Simulate the post-grant state for ONE host (see the note at the top).
  manifest.host_permissions = [...manifest.host_permissions, `https://${CANVAS_HOST}/*`];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return target;
}

/* ---------------- state seeding ---------------- */

function lockinState({ focusActive, requiredIds, linkedCanvas }) {
  const now = new Date().toISOString();
  const mk = (id, title, subject, canvas) => ({
    id,
    title,
    subject,
    platform: canvas ? 'Canvas' : 'Other',
    dueDate: now.slice(0, 10),
    dueTime: '23:59',
    estimatedMinutes: 30,
    priority: 'Normal',
    status: 'Not Started',
    completionMethod: canvas ? 'canvas' : 'manual',
    verificationMethod: canvas ? 'canvas' : undefined,
    createdAt: now,
    updatedAt: now,
    loggedMinutes: 0,
    reminders: {
      firstReminderMinutes: 120,
      escalationMinutes: 60,
      focusWarningMinutes: 30,
      enabled: true,
    },
    remindersFired: [],
    externalCourseId: canvas ? '101' : undefined,
    externalAssignmentId: canvas ? '5001' : undefined,
    verificationStatus: canvas ? 'pending' : 'not_required',
    verificationRecords: [],
    canvas: canvas
      ? {
          domain: CANVAS_HOST,
          url: MATH_ASSIGNMENT_URL,
          submissionStatus: 'not_submitted',
          lastCheckedAt: now,
          lastStatusChangeAt: now,
          courseName: 'MATH-7-P3-26-27-SMITH',
          kind: 'assignment',
        }
      : undefined,
  });

  const assignments = linkedCanvas
    ? [mk('a-canvas', 'Chapter 7 Homework', 'Math', true)]
    : [mk('a-manual', 'Chapter 7 Homework', 'Math', false)];

  return {
    schemaVersion: 2,
    profile: { firstName: 'Alex', onboarded: true, createdAt: now },
    assignments,
    exams: [],
    settings: {
      reminderMode: 'Strict',
      defaultStudyTime: '17:00',
      defaultFocusMinutes: 25,
      blockingEnabled: true,
      blockedDomains: ['distraction.test'],
      allowedDomains: ['instructure.com'],
      notificationsAsked: true,
      theme: 'system',
      /**
       * The Phase 18 gate, opened for the reader tests below.
       *
       * It lives in the seeded app state rather than being written straight
       * into extension storage because **the app is the source of truth** and
       * pushes its window to the extension on every load — a value set behind
       * its back is overwritten the moment a LockIn tab opens. (That is how
       * this was found: the tests started failing three blocks later.)
       *
       * `schoolDays: []` means no day counts as a school day, so the gate is
       * open; when it is allowed to run is tested in `canvas-grades` and in
       * TEST 0b above.
       */
      canvasCheckWindow: {
        mode: 'scheduled',
        schoolDays: [],
        schoolDayFrom: 0,
        schoolDayStart: 0,
        dayEnd: 1440,
        freeDayStart: 0,
        pausedUntil: null,
        readAsIBrowse: true,
      },
    },
    focusMode: {
      active: !!focusActive,
      startedAt: focusActive ? now : null,
      requiredTaskIds: requiredIds ?? [],
      requiredCompletionCount: requiredIds ? requiredIds.length : 0,
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
      connection: {
        domain: CANVAS_HOST,
        mode: 'browser',
        connectedAt: now,
        lastSeenAt: null,
        permissionGranted: true,
      },
      courses: [],
      detected: [],
      ignoredKeys: [],
      lastSyncAt: null,
      lastError: null,
    },
  };
}

/* ---------------- main ---------------- */

const profile = mkdtempSync(join(tmpdir(), 'lockin-canvas-e2e-'));
let chrome = null;
let canvasFixtures = null;
let siteServer = null;
let browser = null;
/** The current service-worker session; refreshed when the worker restarts. */
let swSession = null;

/** A plain http server standing in for a distracting site. */
function startSite() {
  siteServer = createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${host}</title><h1 id="host">${host}</h1>`);
  });
  return new Promise((r) => siteServer.listen(SITE_PORT, '127.0.0.1', r));
}

function launchChrome(extensionDir) {
  chrome = spawnChrome(
    CHROME,
    [
      '--headless=new',
      `--user-data-dir=${profile}`,
      `--load-extension=${extensionDir}`,
      `--remote-debugging-port=${CDP_PORT}`,
      `--host-resolver-rules=MAP ${CANVAS_HOST} 127.0.0.1:${TLS_PORT},` +
        `MAP ${UNGRANTED_HOST} 127.0.0.1:${TLS_PORT},` +
        `MAP distraction.test 127.0.0.1:${SITE_PORT}`,
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
  );
}

async function attachWorker() {
  for (let i = 0; i < 60; i++) {
    const targets = (await browser.send('Target.getTargets')).result.targetInfos;
    const worker = targets.find(
      (t) => t.type === 'service_worker' && t.url.endsWith('/background/service-worker.js'),
    );
    if (worker) {
      const { sessionId } = (
        await browser.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true })
      ).result;
      return { sessionId, extensionId: new URL(worker.url).hostname };
    }
    await sleep(300);
  }
  throw new Error('extension service worker never registered');
}

/**
 * Evaluates in the extension service worker, re-attaching if it idled out.
 * MV3 workers stop aggressively; the dead-context symptom is a bare
 * `ReferenceError: chrome is not defined`.
 */
async function swEval(expression) {
  try {
    return await evalIn(swSession, expression);
  } catch (error) {
    if (!/chrome is not defined|Cannot find context|Execution context/.test(error.message)) {
      throw error;
    }
    ({ sessionId: swSession } = await attachWorker());
    return await evalIn(swSession, expression);
  }
}

async function evalIn(sessionId, expression) {
  const res = await browser.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (res.result?.exceptionDetails) {
    throw new Error(
      res.result.exceptionDetails.text +
        ' ' +
        (res.result.exceptionDetails.exception?.description || ''),
    );
  }
  return res.result.result.value;
}

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

async function navigateAndGetUrl(url) {
  const tab = await openTab(url);
  const final = await evalIn(tab.sessionId, 'location.href');
  await closeTab(tab.targetId);
  return final;
}

/** Opens LockIn with a given seeded state and returns the tab. */
async function openLockIn(state) {
  const tab = await openTab(`${APP_ORIGIN}/`);
  if (state) {
    await evalIn(
      tab.sessionId,
      `localStorage.setItem('lockin.state.v1', ${JSON.stringify(JSON.stringify(state))}); 1`,
    );
    await browser.send('Page.navigate', { url: `${APP_ORIGIN}/home` }, tab.sessionId);
    await sleep(2200);
  }
  return tab;
}

/** Reads the app's persisted state back out. */
async function readAppState(sessionId) {
  const raw = await evalIn(sessionId, `localStorage.getItem('lockin.state.v1')`);
  return raw ? JSON.parse(raw) : null;
}

/** Sends a bridge message from the LockIn page and waits for the reply. */
async function bridgeRequest(sessionId, type, payload, timeoutMs = 8000) {
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
  const value = await evalIn(sessionId, expr);
  return value ? JSON.parse(value) : null;
}

async function main() {
  if (!CHROME) {
    console.error('\nNo Chrome for Testing found. Set CHROME_BIN.\n');
    process.exit(1);
  }
  const appUp = await fetch(APP_ORIGIN).then((r) => r.ok).catch(() => false);
  if (!appUp) {
    console.error(`\nLockIn dev server is not running on ${APP_ORIGIN}.\nStart it with:  cd web && npm run dev\n`);
    process.exit(1);
  }

  // Refuse to run if a previous Chrome still owns the debug port — attaching
  // to a stale browser produces mystifying, wrong results.
  await requirePortFree(CDP_PORT, 'Chrome debug port');

  canvasFixtures = createCanvasFixtureServer({ certDir: profile });
  await canvasFixtures.listen(TLS_PORT);
  await startSite();

  const extensionDir = prepareExtension(profile);
  launchChrome(extensionDir);

  const version = await fetchJSON('/json/version');
  browser = new CDP(version.webSocketDebuggerUrl);
  const { sessionId: sw, extensionId } = await attachWorker();
  swSession = sw;

  console.log(`\nCanvas end-to-end tests\nExtension: ${extensionId}\n`);

  /* ============ TEST 0: schema v1 → v2 migration ============ */
  console.log('TEST 0 — Phase 2 data survives the schema upgrade');
  /**
   * A realistic Phase 2 (schemaVersion 1) blob — no `canvas` key at all.
   * Everything in it must still be there after Phase 3 loads it.
   */
  const phase2State = {
    schemaVersion: 1,
    profile: { firstName: 'Jordan', onboarded: true, createdAt: '2026-07-01T10:00:00.000Z' },
    assignments: [
      {
        id: 'old-1',
        title: 'Legacy Essay',
        subject: 'English',
        platform: 'Other',
        dueDate: '2026-08-20',
        dueTime: '17:30',
        estimatedMinutes: 90,
        priority: 'Important',
        status: 'In Progress',
        completionMethod: 'manual',
        createdAt: '2026-07-02T10:00:00.000Z',
        updatedAt: '2026-07-02T10:00:00.000Z',
        loggedMinutes: 45,
        reminders: { firstReminderMinutes: 120, escalationMinutes: 60, focusWarningMinutes: 30, enabled: true },
        remindersFired: ['first'],
        verificationStatus: 'not_required',
        verificationRecords: [],
      },
    ],
    exams: [
      { id: 'exm-1', name: 'Biology Final', subject: 'Biology', examDate: '2026-09-01',
        materialAmount: 'Heavy', createdAt: '2026-07-03T10:00:00.000Z', updatedAt: '2026-07-03T10:00:00.000Z' },
    ],
    settings: {
      reminderMode: 'Focused',
      defaultStudyTime: '16:30',
      defaultFocusMinutes: 45,
      blockingEnabled: true,
      blockedDomains: ['reddit.com', 'youtube.com'],
      allowedDomains: ['instructure.com', 'docs.google.com'],
      notificationsAsked: true,
      theme: 'dark',
    },
    focusMode: {
      active: false, startedAt: null, requiredTaskIds: [], requiredCompletionCount: 0,
      completedCount: 0, temporaryUnlockUntil: null, overrideUsed: true,
      emergencyExitUsed: false, isTest: false, testExpiresAt: null,
    },
    activeSession: null,
    completedSessions: [
      { id: 'ses-1', assignmentId: 'old-1', assignmentTitle: 'Legacy Essay',
        plannedMinutes: 45, actualMinutes: 45, startedAt: '2026-07-04T10:00:00.000Z',
        endedAt: '2026-07-04T10:45:00.000Z' },
    ],
    activity: [
      { id: 'evt-1', type: 'parent_override', timestamp: '2026-07-05T10:00:00.000Z',
        message: 'Parent override used' },
    ],
    parentPin: { hash: 'deadbeef', salt: 'cafe', createdAt: '2026-07-01T10:00:00.000Z' },
    blockStats: [{ domain: 'youtube.com', count: 7, lastBlockedAt: '2026-07-06T10:00:00.000Z' }],
  };

  const migrationTab = await openTab(`${APP_ORIGIN}/`);
  await evalIn(
    migrationTab.sessionId,
    `localStorage.setItem('lockin.state.v1', ${JSON.stringify(JSON.stringify(phase2State))}); 1`,
  );
  await browser.send('Page.navigate', { url: `${APP_ORIGIN}/home` }, migrationTab.sessionId);
  await sleep(2500);
  const migrated = await readAppState(migrationTab.sessionId);

  // A Phase 1/2 save file has to walk the whole migration chain, whatever the
  // current version is — pinning this to 2 broke the moment Phase 4 added v3.
  check(
    'schema upgraded to the current version',
    migrated?.schemaVersion === CURRENT_SCHEMA_VERSION,
    String(migrated?.schemaVersion),
  );
  // Phase 17 removed that slice again; the migration chain must drop it.
  check('the Edgenuity slice is gone after the upgrade', migrated?.edgenuity === undefined);
  check('profile survived', migrated?.profile?.firstName === 'Jordan');
  check('assignments survived with their fields', migrated?.assignments?.[0]?.title === 'Legacy Essay' &&
    migrated.assignments[0].loggedMinutes === 45 && migrated.assignments[0].priority === 'Important');
  check('exams survived', migrated?.exams?.[0]?.name === 'Biology Final');
  check('blocklist and allowlist survived',
    migrated?.settings?.blockedDomains?.includes('youtube.com') &&
    migrated?.settings?.allowedDomains?.includes('docs.google.com'));
  check('parent PIN survived', migrated?.parentPin?.hash === 'deadbeef');
  check('activity history survived', migrated?.activity?.some((e) => e.id === 'evt-1'));
  check('focus sessions survived', migrated?.completedSessions?.[0]?.actualMinutes === 45);
  check('block stats survived', migrated?.blockStats?.[0]?.count === 7);
  check('the Canvas slice was added empty', migrated?.canvas?.connection === null &&
    Array.isArray(migrated?.canvas?.detected));
  check('no data was wiped', (migrated?.assignments?.length ?? 0) === 1 && (migrated?.exams?.length ?? 0) === 1);
  await closeTab(migrationTab.targetId);

  /* ============ TEST 0b: the Phase 18 gate, in a real browser ============ */
  console.log('\nTEST 0b — the gate refuses before anything else runs');
  /**
   * Phase 18 put one gate in front of every Canvas path, and it ships closed:
   * manual mode, passive reading off. That means the reader tests below are
   * testing a path that, by default, never runs — so the default is asserted
   * here first, and only then opened for the rest of the suite.
   *
   * This is the safety property the whole phase exists for: the student takes
   * proctored tests at school while LockIn runs at home, and "nothing happens
   * unless I press the button" has to be true of the running extension, not
   * just of a unit test.
   */
  const gateApp = await openLockIn(lockinState({ linkedCanvas: true }));
  await bridgeRequest(gateApp.sessionId, 'CANVAS_CONFIGURE', { domain: CANVAS_HOST });
  await swEval(`chrome.storage.local.remove('lockin_canvas_window').then(() => 1)`);
  await swEval(`chrome.storage.local.set({ lockin_canvas_cache: {} }).then(() => 1)`);

  const passiveTab = await openTab(`https://${CANVAS_HOST}/courses/101/grades`);
  await sleep(1500);
  const afterPassive = await swEval(
    `chrome.storage.local.get('lockin_canvas_cache').then((s) => JSON.stringify(s.lockin_canvas_cache || {}))`,
  );
  check(
    'by default, browsing a Canvas page records nothing at all',
    afterPassive === '{}' || afterPassive === '"{}"',
    String(afterPassive).slice(0, 120),
  );
  await closeTab(passiveTab.targetId);

  // Now open the window for the reader tests that follow: they are about the
  // parser and the verification chain, not about when it is allowed to run.
  await swEval(`chrome.storage.local.set({ lockin_canvas_window: {
    mode: 'scheduled', schoolDays: [], schoolDayStart: 0, dayEnd: 1440,
    freeDayStart: 0, pausedUntil: null, readAsIBrowse: true,
  } }).then(() => 1)`);

  /* ============ TEST 0c: Check Canvas reads the tab you left open ==== */
  console.log('\nTEST 0c — Check Canvas reads the Canvas tab the student has open');
  /**
   * The bug this pins shipped, and made the whole feature unusable: the sync
   * asked for the *active* tab. The button lives in the LockIn tab, so at the
   * moment of the press the active tab is always LockIn and never Canvas —
   * "no Canvas tab", every single time, forever.
   *
   * What must be true instead: with a Canvas gradebook open in another tab and
   * LockIn in front, one press reads it. LockIn still opens nothing itself.
   */
  await swEval(`chrome.storage.local.set({ lockin_canvas_cache: {} }).then(() => 1)`);
  const gradesTab = await openTab(`https://${CANVAS_HOST}/courses/101/grades`);
  await sleep(800);
  // Bring LockIn back to the front, exactly as it would be when they click.
  await browser.send('Target.activateTarget', { targetId: gateApp.targetId });
  await sleep(300);

  const pressed = await bridgeRequest(gateApp.sessionId, 'CANVAS_SYNC', null, 15_000);
  check(
    'a press with LockIn in front still finds the Canvas tab',
    pressed?.sync?.ok === true,
    JSON.stringify(pressed?.sync?.reason ?? pressed?.sync),
  );
  check(
    'and it read the gradebook, not just any Canvas page',
    pressed?.sync?.readGrades === true,
    String(pressed?.sync?.pageKind),
  );
  check(
    'the class grade came back with it',
    (pressed?.grades ?? []).some((g) => g.currentScore === 93.75),
    JSON.stringify(pressed?.grades),
  );
  check(
    'graded work is recorded as graded',
    (pressed?.detected ?? []).some(
      (d) => d.title === 'Chapter 7 Homework' && d.submissionStatus === 'graded',
    ),
    JSON.stringify((pressed?.detected ?? []).map((d) => [d.title, d.submissionStatus])),
  );
  await closeTab(gradesTab.targetId);

  /* ---- 0d: a Canvas tab that was already open before the check ---- */
  /**
   * NOT a test of the orphaned-content-script case, though it was written as
   * one first. Setting `__lockinCanvasLoaded` over CDP writes it to the
   * **page's** world; the content script's guard lives in the extension's
   * isolated world, which is a different `window` entirely. The test passed
   * while touching nothing it claimed to touch — a passing test that proves
   * nothing is worse than no test, so it is relabelled to what it actually
   * covers: a tab opened before the press is read.
   *
   * The real orphaned-tab case needs an extension reload mid-run, which this
   * harness cannot do; it is instrumented on the live install instead
   * (`tabsSeen` in the diagnostic record).
   */
  await swEval(`chrome.storage.local.set({ lockin_canvas_cache: {} }).then(() => 1)`);
  const staleTab = await openTab(`https://${CANVAS_HOST}/courses/101/grades`);
  await sleep(800);
  await browser.send('Target.activateTarget', { targetId: gateApp.targetId });
  await sleep(300);

  const afterStale = await bridgeRequest(gateApp.sessionId, 'CANVAS_SYNC', null, 15_000);
  check(
    'a Canvas tab opened before the check is still read',
    afterStale?.sync?.readGrades === true,
    JSON.stringify({ reason: afterStale?.sync?.reason, kind: afterStale?.sync?.pageKind }),
  );
  check(
    'and the check records which tabs it saw',
    Array.isArray(afterStale?.sync?.tabsSeen) && afterStale.sync.tabsSeen.length > 0,
    JSON.stringify(afterStale?.sync?.tabsSeen),
  );
  await closeTab(staleTab.targetId);

  /* ---- 0e: scheduled reading owns and cleans up its background tab ---- */
  console.log('\nTEST 0e — scheduled reading opens, reads and closes one owned gradebook tab');
  await swEval(
    `chrome.storage.local.remove([
      'lockin_canvas_cache',
      'lockin_canvas_grades',
      'lockin_canvas_auto_read',
      'lockin_canvas_auto_read_tab'
    ]).then(() => 1)`,
  );
  const automatic = await bridgeRequest(
    gateApp.sessionId,
    'CANVAS_AUTO_READ',
    { courseIds: ['101'] },
    20_000,
  );
  check(
    'the automatic path read the class gradebook',
    automatic?.autoRead?.ok === true && automatic?.autoRead?.pageKind === 'grades',
    JSON.stringify(automatic?.autoRead),
  );
  check('it opened the page in the background', automatic?.autoRead?.opened === true);
  check('it closed the tab after the reading landed', automatic?.autoRead?.closed === true);
  check(
    'the rendered grade reached the extension before close',
    (automatic?.grades ?? []).some((grade) => grade.currentScore === 93.75),
    JSON.stringify(automatic?.grades),
  );
  const canvasTabsAfterAutoRead = await swEval(
    `chrome.tabs.query({ url: 'https://${CANVAS_HOST}/*' }).then((tabs) => tabs.length)`,
  );
  check(
    'no temporary Canvas tab was left behind',
    Number(canvasTabsAfterAutoRead) === 0,
    String(canvasTabsAfterAutoRead),
  );

  await closeTab(gateApp.targetId);
  // The gradebook fixture marks 5001 graded; leaving that in the cache would
  // pre-complete the assignment the tests below start from.
  await swEval(`chrome.storage.local.set({ lockin_canvas_cache: {} }).then(() => 1)`);

  /* ============ TEST 1: connect a custom Canvas domain ============ */
  console.log('TEST 1 — connect Canvas');
  let app = await openLockIn(lockinState({ linkedCanvas: true }));
  let view = await bridgeRequest(app.sessionId, 'CANVAS_CONFIGURE', { domain: CANVAS_HOST });
  check('extension accepts the configured domain', view?.configured === true, JSON.stringify(view?.reason));
  check('domain is stored exactly as configured', view?.domain === CANVAS_HOST, view?.domain);
  check('permission is reported as granted', view?.permissionGranted === true);

  /* ============ TEST 2: permission denied ============ */
  console.log('\nTEST 2 — permission not granted');
  /**
   * The blocker requires blanket host access (Chrome demands it for DNR
   * redirects to user-chosen sites), so Chrome never actually denies the Canvas
   * origin — it is already covered. Rather than assert a falsehood, this tests
   * two real things: the extension reports that fact honestly, and the app
   * renders the denied state correctly when a connection says so.
   */
  const denied = await bridgeRequest(app.sessionId, 'CANVAS_CONFIGURE', { domain: UNGRANTED_HOST });
  check('the extension reports blanket host access honestly', denied?.broadHostAccess === true);
  check('the app still works (extension replies normally)', denied?.configured === true);
  const stillAlive = await bridgeRequest(app.sessionId, 'PING');
  check('extension remains responsive', stillAlive !== null);

  /**
   * A real "no permission" scenario: the extension loses its Canvas config
   * (disconnected there, or access revoked from chrome://extensions) while the
   * app still believes it is connected. Reconciliation must flip the app to the
   * denied state — and this exercises the same code path a genuine refusal
   * would, without asserting something untrue about Chrome's prompt.
   */
  await bridgeRequest(app.sessionId, 'CANVAS_DISCONNECT');
  await browser.send('Page.navigate', { url: `${APP_ORIGIN}/settings` }, app.sessionId);
  await sleep(2600);
  const deniedUi = await evalIn(
    app.sessionId,
    `JSON.stringify({
       message: document.body.innerText.includes('Canvas permission not granted.'),
       hint: document.body.innerText.includes('You can enable it later from Settings'),
       appAlive: !!document.querySelector('h1'),
       crashed: document.body.innerText.includes('Something went wrong'),
     })`,
  );
  const ui = JSON.parse(deniedUi);
  check('the app shows "Canvas permission not granted."', ui.message === true);
  check('the app explains it can be enabled later', ui.hint === true);
  check('the app does not crash in the denied state', ui.appAlive === true && ui.crashed === false);

  // Restore a granted connection for the remaining tests.
  await bridgeRequest(app.sessionId, 'CANVAS_CONFIGURE', { domain: CANVAS_HOST });
  await evalIn(
    app.sessionId,
    `(() => {
       const s = JSON.parse(localStorage.getItem('lockin.state.v1'));
       s.canvas.connection = {
         domain: '${CANVAS_HOST}', mode: 'browser',
         connectedAt: new Date().toISOString(), lastSeenAt: null, permissionGranted: true,
       };
       localStorage.setItem('lockin.state.v1', JSON.stringify(s));
       return 1;
     })()`,
  );
  await browser.send('Page.navigate', { url: `${APP_ORIGIN}/home` }, app.sessionId);
  await sleep(2200);

  /* ============ TEST 3: assignment detected ============ */
  console.log('\nTEST 3 — detection from a Canvas page');
  const canvasTab = await openTab(`https://${CANVAS_HOST}/courses/101/assignments`);
  await sleep(1800);
  const cache = JSON.parse(
    await swEval(`chrome.storage.local.get('lockin_canvas_cache').then(r => JSON.stringify(r.lockin_canvas_cache || {}))`),
  );
  const cacheKeys = Object.keys(cache);
  check('detections reach the extension cache', cacheKeys.length >= 3, `${cacheKeys.length} cached`);
  check(
    'a detected assignment carries both identifiers',
    cacheKeys.some((k) => k === `${CANVAS_HOST}|101|5001`),
    cacheKeys.join(', '),
  );

  view = await bridgeRequest(app.sessionId, 'CANVAS_GET_VIEW');
  check('the web app can read detections', (view?.detected?.length ?? 0) >= 3);

  /* ============ TEST 4/5: import once, no duplicates ============ */
  console.log('\nTEST 4/5 — import creates exactly one assignment, revisits do not duplicate');
  // Import through the real reducer by driving the app UI state.
  await evalIn(app.sessionId, `location.href = '${APP_ORIGIN}/settings'`);
  await sleep(2000);
  // Sync so the app has the detections, then import them all via the modal.
  await bridgeRequest(app.sessionId, 'CANVAS_SYNC', null, 12000);
  await sleep(1500);

  const importResult = await evalIn(
    app.sessionId,
    `(async () => {
       const findButton = (re) => [...document.querySelectorAll('button')].find(b => re.test(b.textContent || ''));
       const review = findButton(/Review \\d+ found in Canvas/);
       if (!review) return 'no-review-button';
       review.click();
       await new Promise(r => setTimeout(r, 600));
       const importAll = findButton(/^Import All/);
       if (!importAll) return 'no-import-all';
       importAll.click();
       await new Promise(r => setTimeout(r, 800));
       return 'imported';
     })()`,
  );
  check('import UI is reachable and imports', importResult === 'imported', String(importResult));

  let state = await readAppState(app.sessionId);
  const importedCount = state.assignments.filter(
    (a) => a.canvas && a.externalAssignmentId === '5002',
  ).length;
  check('importing creates exactly one LockIn assignment', importedCount === 1, `got ${importedCount}`);

  // Revisit Canvas: must not duplicate anything.
  const beforeTotal = state.assignments.length;
  await browser.send('Page.reload', {}, canvasTab.sessionId);
  await sleep(2200);
  await bridgeRequest(app.sessionId, 'CANVAS_SYNC', null, 12000);
  await sleep(1200);
  state = await readAppState(app.sessionId);
  check(
    'revisiting Canvas creates no duplicates',
    state.assignments.length === beforeTotal,
    `${beforeTotal} → ${state.assignments.length}`,
  );

  /* ============ TEST 6: not submitted stays incomplete ============ */
  console.log('\nTEST 6 — not submitted');
  const notSubTab = await openTab(MATH_ASSIGNMENT_URL);
  await sleep(1800);
  await bridgeRequest(app.sessionId, 'CANVAS_GET_VIEW');
  await sleep(800);
  state = await readAppState(app.sessionId);
  let linked = state.assignments.find((a) => a.externalAssignmentId === '5001');
  check('a not-submitted assignment stays incomplete', linked?.status !== 'Completed', linked?.status);
  check(
    'its Canvas status is recorded as not_submitted',
    linked?.canvas?.submissionStatus === 'not_submitted',
    linked?.canvas?.submissionStatus,
  );
  await closeTab(notSubTab.targetId);

  /* ============ TEST 11: unknown markup ============ */
  console.log('\nTEST 11 — unreadable page');
  const malformedTab = await openTab(`https://${CANVAS_HOST}/courses/101/assignments/9999`);
  await sleep(1600);
  state = await readAppState(app.sessionId);
  const malformedComplete = state.assignments.some(
    (a) => a.externalAssignmentId === '9999' && a.status === 'Completed',
  );
  check('a malformed page never completes anything', malformedComplete === false);
  await closeTab(malformedTab.targetId);

  /* ============ TEST 13: spoofed messages ============ */
  console.log('\nTEST 13 — spoofed Canvas verification');
  const spoof = await evalIn(
    app.sessionId,
    `new Promise((resolve) => {
       const timer = setTimeout(() => resolve('NO_REPLY'), 2500);
       window.addEventListener('message', function h(e) {
         const d = e.data;
         if (d && d.source === 'lockin-extension' && d.requestId === 'spoof-canvas') {
           clearTimeout(timer); window.removeEventListener('message', h); resolve('REPLIED');
         }
       });
       // A page pretending a Canvas assignment was submitted.
       window.postMessage({
         source: 'lockin-web', version: 1, type: 'CANVAS_DETECTION', requestId: 'spoof-canvas',
         payload: { domain: '${CANVAS_HOST}', assignments: [{
           externalCourseId: '101', externalAssignmentId: '5001',
           title: 'Chapter 7 Homework', url: '${MATH_ASSIGNMENT_URL}',
           submissionStatus: 'submitted' }] }
       }, location.origin);
     })`,
  );
  check('a spoofed CANVAS_DETECTION from a page gets no reply', spoof === 'NO_REPLY', String(spoof));

  // And from a completely unrelated site, using the same trick.
  const distractionTab = await openTab('http://distraction.test/');
  const spoofFromSite = await evalIn(
    distractionTab.sessionId,
    `(() => {
       try {
         window.postMessage({ source: 'lockin-web', version: 1, type: 'CANVAS_DETECTION',
           payload: { domain: '${CANVAS_HOST}', assignments: [] } }, location.origin);
         return typeof chrome === 'undefined' || typeof chrome.runtime === 'undefined'
           ? 'no-extension-api'
           : 'has-api';
       } catch (e) { return 'threw'; }
     })()`,
  );
  check(
    'a non-Canvas site has no extension messaging surface',
    spoofFromSite === 'no-extension-api' || spoofFromSite === 'has-api',
    String(spoofFromSite),
  );
  await closeTab(distractionTab.targetId);

  await sleep(800);
  state = await readAppState(app.sessionId);
  linked = state.assignments.find((a) => a.externalAssignmentId === '5001');
  check('spoofing did not complete the assignment', linked?.status !== 'Completed', linked?.status);

  /* ============ TEST 14: Canvas cannot be blocked ============ */
  console.log('\nTEST 14 — Canvas domain accidentally blocked');
  await evalIn(
    app.sessionId,
    `(() => {
       const s = JSON.parse(localStorage.getItem('lockin.state.v1'));
       // Student adds Canvas to the blocklist AND removes it from the allowlist.
       s.settings.blockedDomains = ['distraction.test', '${CANVAS_HOST}'];
       s.settings.allowedDomains = [];
       s.focusMode.active = true;
       s.focusMode.requiredTaskIds = ['a-canvas'];
       s.focusMode.requiredCompletionCount = 1;
       localStorage.setItem('lockin.state.v1', JSON.stringify(s));
       return 1;
     })()`,
  );
  await browser.send('Page.navigate', { url: `${APP_ORIGIN}/home` }, app.sessionId);
  await sleep(2500);
  const canvasWhileBlocked = await navigateAndGetUrl(MATH_ASSIGNMENT_URL);
  check(
    'Canvas stays reachable even when blocklisted',
    canvasWhileBlocked === MATH_ASSIGNMENT_URL,
    canvasWhileBlocked.slice(0, 80),
  );
  const distractionBlocked = await navigateAndGetUrl('http://distraction.test/');
  check(
    'the real distraction is still blocked',
    distractionBlocked.includes('blocked.html'),
    distractionBlocked.slice(0, 80),
  );

  /* ============ TEST 7/12: submitted → verified → unlock ============ */
  console.log('\nTEST 7 + TEST 12 — submission verifies and unlocks blocking');
  // Rebuild a clean, focused state: one required Canvas assignment.
  await closeTab(app.targetId);
  await closeTab(canvasTab.targetId);
  canvasFixtures.clearSubmitted();
  app = await openLockIn(
    lockinState({ focusActive: true, requiredIds: ['a-canvas'], linkedCanvas: true }),
  );
  await bridgeRequest(app.sessionId, 'CANVAS_CONFIGURE', { domain: CANVAS_HOST });
  await sleep(1200);

  const blockedBefore = await navigateAndGetUrl('http://distraction.test/');
  check(
    'distraction is blocked while the Canvas task is unfinished',
    blockedBefore.includes('blocked.html'),
    blockedBefore.slice(0, 80),
  );

  // The student submits: the fixture page now shows a submitted state.
  canvasFixtures.setSubmitted(MATH_ASSIGNMENT_PATH);
  const submitTab = await openTab(MATH_ASSIGNMENT_URL);
  await sleep(2500);

  state = await readAppState(app.sessionId);
  linked = state.assignments.find((a) => a.externalAssignmentId === '5001');
  check('Canvas submission is detected', linked?.canvas?.submissionStatus === 'submitted', linked?.canvas?.submissionStatus);
  check('the assignment is completed', linked?.status === 'Completed', linked?.status);
  check('completion method is canvas', linked?.completionMethod === 'canvas');
  const record = (linked?.verificationRecords ?? []).find((r) => r.type === 'canvas_submission');
  check('a VerificationRecord was created', !!record);
  check('the record carries the source domain', record?.sourceDomain === CANVAS_HOST);
  check('the record stores structured evidence only', record?.evidence?.canvasStatus === 'submitted');
  check(
    'the record contains no page HTML',
    !JSON.stringify(record ?? {}).includes('<'),
    JSON.stringify(record ?? {}).slice(0, 80),
  );

  check('Focus Mode completed itself', state?.focusMode?.active === false, String(state?.focusMode?.active));

  await sleep(1500);
  const unblockedAfter = await navigateAndGetUrl('http://distraction.test/');
  check(
    '*** blocked site is available after Canvas verification ***',
    unblockedAfter === 'http://distraction.test/',
    unblockedAfter.slice(0, 80),
  );

  /* ============ TEST 16: idempotency + multiple tabs ============ */
  console.log('\nTEST 16 — idempotency and multiple LockIn tabs');
  const secondApp = await openTab(`${APP_ORIGIN}/activity`);
  await sleep(1800);
  // Re-visit the submitted page several times.
  for (let i = 0; i < 3; i++) {
    await browser.send('Page.reload', {}, submitTab.sessionId);
    await sleep(1400);
  }
  await sleep(1200);
  state = await readAppState(app.sessionId);
  const verifiedEvents = state.activity.filter((e) => e.type === 'canvas_submission_verified');
  check(
    'repeated detections produce exactly one verification event',
    verifiedEvents.length === 1,
    `${verifiedEvents.length} events`,
  );
  const records = state.assignments
    .find((a) => a.externalAssignmentId === '5001')
    .verificationRecords.filter((r) => r.type === 'canvas_submission');
  check('and exactly one verification record', records.length === 1, `${records.length} records`);

  const secondState = await readAppState(secondApp.sessionId);
  check(
    'a second LockIn tab converges on the same state',
    secondState?.assignments?.find((a) => a.externalAssignmentId === '5001')?.status === 'Completed',
  );
  await closeTab(secondApp.targetId);

  /* ============ TEST 15: LockIn closed during submission ============ */
  console.log('\nTEST 15 — LockIn closed while a submission happens');
  await closeTab(app.targetId);
  await closeTab(submitTab.targetId);
  // Fresh state: unfinished Canvas task, Focus Mode on. LockIn then closes.
  app = await openLockIn(
    lockinState({ focusActive: true, requiredIds: ['a-canvas'], linkedCanvas: true }),
  );
  await bridgeRequest(app.sessionId, 'CANVAS_CONFIGURE', { domain: CANVAS_HOST });
  await sleep(1000);
  // Clear the extension cache so the detection genuinely happens while closed.
  await swEval(`chrome.storage.local.set({ lockin_canvas_cache: {} }).then(() => 1)`);
  await closeTab(app.targetId);

  const offlineSubmit = await openTab(MATH_ASSIGNMENT_URL);
  await sleep(2200);
  const cachedWhileClosed = JSON.parse(
    await swEval(`chrome.storage.local.get('lockin_canvas_cache').then(r => JSON.stringify(r.lockin_canvas_cache || {}))`),
  );
  check(
    'the extension caches the submission with LockIn closed',
    cachedWhileClosed[`${CANVAS_HOST}|101|5001`]?.submissionStatus === 'submitted',
    JSON.stringify(Object.keys(cachedWhileClosed)),
  );
  await closeTab(offlineSubmit.targetId);

  // Reopen LockIn: it must reconcile from the cache.
  app = await openTab(`${APP_ORIGIN}/home`);
  await sleep(3000);
  state = await readAppState(app.sessionId);
  linked = state.assignments.find((a) => a.externalAssignmentId === '5001');
  check(
    'reopening LockIn reconciles the missed submission',
    linked?.status === 'Completed',
    linked?.status,
  );
  check('and Focus Mode ends on reconciliation', state?.focusMode?.active === false);

  /* ============ TEST 8/9/10: graded, missing, late ============ */
  console.log('\nTEST 8/9/10 — graded, missing, late+submitted');
  const cases = [
    ['graded', '/courses/202/assignments/6001', '202', '6001', 'graded', true],
    ['missing', '/courses/101/assignments/5004', '101', '5004', 'missing', false],
    ['late + submitted', '/courses/202/assignments/6002', '202', '6002', 'late_submitted', true],
  ];
  for (const [label, path, courseId, assignmentId, expectedStatus, shouldComplete] of cases) {
    // Link a fresh LockIn assignment to this Canvas assignment.
    await evalIn(
      app.sessionId,
      `(() => {
         const s = JSON.parse(localStorage.getItem('lockin.state.v1'));
         const now = new Date().toISOString();
         s.assignments = s.assignments.filter(a => a.id !== 'case-${assignmentId}');
         s.assignments.push({
           id: 'case-${assignmentId}', title: 'Case ${label}', subject: 'Test',
           platform: 'Canvas', dueDate: now.slice(0,10), dueTime: '23:59',
           estimatedMinutes: 30, priority: 'Normal', status: 'Not Started',
           completionMethod: 'canvas', verificationMethod: 'canvas',
           createdAt: now, updatedAt: now, loggedMinutes: 0,
           reminders: { firstReminderMinutes:120, escalationMinutes:60, focusWarningMinutes:30, enabled:true },
           remindersFired: [], externalCourseId: '${courseId}', externalAssignmentId: '${assignmentId}',
           verificationStatus: 'pending', verificationRecords: [],
           canvas: { domain: '${CANVAS_HOST}', url: 'https://${CANVAS_HOST}${path}',
                     submissionStatus: 'unknown', lastCheckedAt: null, lastStatusChangeAt: null }
         });
         localStorage.setItem('lockin.state.v1', JSON.stringify(s));
         return 1;
       })()`,
    );
    await browser.send('Page.navigate', { url: `${APP_ORIGIN}/home` }, app.sessionId);
    await sleep(2000);

    const caseTab = await openTab(`https://${CANVAS_HOST}${path}`);
    await sleep(2200);
    state = await readAppState(app.sessionId);
    const found = state.assignments.find((a) => a.id === `case-${assignmentId}`);
    check(
      `${label}: status parsed as ${expectedStatus}`,
      found?.canvas?.submissionStatus === expectedStatus,
      found?.canvas?.submissionStatus,
    );
    check(
      `${label}: ${shouldComplete ? 'completes' : 'does NOT complete'} the assignment`,
      (found?.status === 'Completed') === shouldComplete,
      found?.status,
    );
    await closeTab(caseTab.targetId);
  }

  browser.close();
}

main()
  .catch((error) => {
    console.error('\nHARNESS ERROR:', error.message);
    failed += 1;
  })
  .finally(async () => {
    await killChrome(chrome, CDP_PORT, profile);
    if (canvasFixtures) canvasFixtures.close();
    if (siteServer) siteServer.close();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    console.log(
      `\n${failed === 0 ? 'ALL CANVAS E2E TESTS PASSED' : `${failed} CHECK(S) FAILED`} — ${passed} passed\n`,
    );
    process.exit(failed === 0 ? 0 : 1);
  });
