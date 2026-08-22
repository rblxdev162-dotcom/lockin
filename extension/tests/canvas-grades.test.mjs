/**
 * Phase 18 — the gate, its mirrors, and what a grade is allowed to be.
 *
 * The parsers themselves are exercised against real fixture pages in a real
 * browser (`npm run test:parser`), because they work on documents. What is
 * tested here is everything that must hold with no DOM at all:
 *
 *  1. **The gate**, which is the whole safety story. The student takes
 *     proctored tests at school while LockIn runs at home, so "nothing happens
 *     during school hours" has to be a property of the code rather than a
 *     promise in the copy.
 *  2. **Its three copies agreeing.** The rule lives in the web app, is
 *     mirrored into the extension (no build step) and again into the local
 *     service (a LaunchAgent with no bundler). Three copies of a safety rule
 *     is two chances to drift, so they are run over the same matrix here and
 *     compared.
 *  3. **The trust boundary**, which must never let a page's number become a
 *     submission status.
 *
 * Run: npm run test:canvas-grades
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const web = await import('../../web/src/lib/canvas/checkWindow.ts');
const ext = await import('../canvas/checkWindow.js');
const service = await import('../../scripts/canvas-feed.mjs');
const { validateCourseGrade, validateDetectionMessage } = await import('../canvas/messaging.js');
const grades = await import('../../web/src/types/grades.ts');
const autoRead = await import('../../web/src/lib/canvas/autoRead.ts');
const readCoverage = await import('../../web/src/lib/canvas/readCoverage.ts');

const DOMAIN = 'myschool.instructure.com';

/** A weekday and a weekend day, so day-of-week logic is actually exercised. */
const WEDNESDAY = (h, m = 0) => new Date(2026, 7, 19, h, m).getTime();
const SATURDAY = (h, m = 0) => new Date(2026, 7, 22, h, m).getTime();

test('a responding but unreadable gradebook is never reported as a fresh read', () => {
  const assessment = readCoverage.assessCanvasRead({
    ok: false,
    reason: 'page-unreadable',
    pageKind: 'grades',
    gradebookAnswered: true,
    readableTabs: 0,
    rowsSeen: 18,
    rowsRead: 0,
  });
  assert.equal(assessment.coverage, 'unreadable');
});

test('candidate rows without trustworthy records degrade to unreadable', () => {
  const assessment = readCoverage.assessCanvasRead({
    ok: true,
    pageKind: 'grades',
    readGrades: true,
    gradebookAnswered: true,
    readableTabs: 1,
    rowsSeen: 12,
    rowsRead: 0,
  });
  assert.equal(assessment.coverage, 'unreadable');
  assert.match(assessment.detail, /12 candidate rows/);
});

test('current structured gradebook rows produce gradebook coverage', () => {
  const assessment = readCoverage.assessCanvasRead({
    ok: true,
    pageKind: 'grades',
    readGrades: true,
    gradebookAnswered: true,
    readableTabs: 1,
    rowsSeen: 14,
    rowsRead: 13,
  });
  assert.equal(assessment.coverage, 'gradebook');
  assert.match(assessment.detail, /13 assignment rows/);
});

test('the class Assignments page is reported as turned-in states, not a gradebook', () => {
  const assessment = readCoverage.assessCanvasRead({
    ok: true,
    pageKind: 'assignments_index',
    readSubmissions: true,
    readGrades: true,
    gradebookAnswered: true,
    readableTabs: 1,
    rowsSeen: 9,
    rowsRead: 9,
  });
  assert.equal(assessment.coverage, 'submissions');
  assert.match(assessment.detail, /9 assignment rows/);
  assert.match(assessment.detail, /submitted, missing or late/);
});

test('an Assignments page whose rows said nothing is not counted as submissions', () => {
  const assessment = readCoverage.assessCanvasRead({
    ok: true,
    pageKind: 'assignments_index',
    readSubmissions: false,
    readableTabs: 1,
    rowsSeen: 9,
    rowsRead: 0,
  });
  assert.notEqual(assessment.coverage, 'submissions');
});

test('a stored submissions receipt still describes itself later', () => {
  const stored = readCoverage.describeStoredCoverage('submissions', 4);
  assert.equal(stored?.coverage, 'submissions');
  assert.match(stored.detail, /4 assignment rows/);
});

test('the all-classes grades page is labelled totals only', () => {
  const assessment = readCoverage.assessCanvasRead({
    ok: true,
    pageKind: 'grades_all',
    readGrades: true,
    readableTabs: 1,
    rowsSeen: 10,
    rowsRead: 10,
  });
  assert.equal(assessment.coverage, 'totals_only');
});

/* ------------------------------------------------------------------ */
/* 1. The gate                                                         */
/* ------------------------------------------------------------------ */

test('nothing automatic happens by default, at any hour', () => {
  const window = web.defaultCheckWindow();
  assert.equal(window.mode, 'manual');

  for (const hour of [0, 6, 9, 11, 14, 16, 20, 23]) {
    const decision = web.evaluateCheckWindow(window, 'automatic', WEDNESDAY(hour));
    assert.equal(decision.allowed, false, `automatic must never run at ${hour}:00`);
    assert.equal(decision.verdict, 'automatic_disabled');
  }
});

test('a press during school hours is refused, and says which rule refused it', () => {
  const window = web.defaultCheckWindow();
  const decision = web.evaluateCheckWindow(window, 'manual', WEDNESDAY(11));
  assert.equal(decision.allowed, false);
  assert.equal(decision.verdict, 'school_hours');
  // Refused, but not trapped: an explicit second press is the way past.
  assert.equal(decision.overridable, true);
});

test('the override is honoured, because LockIn cannot know the timetable', () => {
  const window = web.defaultCheckWindow();
  const decision = web.evaluateCheckWindow(window, 'override', WEDNESDAY(11));
  assert.equal(decision.allowed, true);
});

test('after school on a school day, a press is allowed', () => {
  const window = web.defaultCheckWindow();
  assert.equal(web.evaluateCheckWindow(window, 'manual', WEDNESDAY(16)).allowed, true);
});

test('the evening cutoff bounds the timer, never a press', () => {
  // Shipped wrong once: `dayEnd` refused a *button press* at 10pm, telling a
  // student doing homework at their own desk that they could not look at their
  // own Canvas. That protects nobody — the concern is the school day.
  const window = { ...web.defaultCheckWindow(), mode: 'scheduled' };
  assert.equal(web.evaluateCheckWindow(window, 'manual', WEDNESDAY(22, 30)).allowed, true);
  assert.equal(web.evaluateCheckWindow(window, 'manual', WEDNESDAY(1)).allowed, true);
  // The timer still stops at the cutoff.
  assert.equal(web.evaluateCheckWindow(window, 'automatic', WEDNESDAY(22, 30)).allowed, false);
  assert.equal(web.evaluateCheckWindow(window, 'automatic', WEDNESDAY(20)).allowed, true);
});

test('school hours are still refused, which is the whole point', () => {
  const window = { ...web.defaultCheckWindow(), mode: 'scheduled', readAsIBrowse: true };
  for (const reason of ['manual', 'passive', 'automatic']) {
    assert.equal(
      web.evaluateCheckWindow(window, reason, WEDNESDAY(10)).allowed,
      false,
      `${reason} must be refused during school`,
    );
  }
});

test('a weekend never refuses a press, and the timer uses the weekend start', () => {
  const window = { ...web.defaultCheckWindow(), mode: 'scheduled' };
  // There is no school on Saturday, so there is nothing for a press to clash
  // with — at 8am or at any other hour.
  assert.equal(web.evaluateCheckWindow(window, 'manual', SATURDAY(8)).allowed, true);
  assert.equal(web.evaluateCheckWindow(window, 'manual', SATURDAY(10)).allowed, true);
  // The timer still waits for the weekend start rather than fetching at 3am.
  assert.equal(web.evaluateCheckWindow(window, 'automatic', SATURDAY(8)).allowed, false);
  assert.equal(web.evaluateCheckWindow(window, 'automatic', SATURDAY(10)).allowed, true);
});

test('school hours are an interval, so the small hours are not "school"', () => {
  // The bug this pins: "before 3:30pm" treated 1am as school hours and refused
  // a student who was up late doing homework.
  const window = web.defaultCheckWindow();
  assert.equal(web.evaluateCheckWindow(window, 'manual', WEDNESDAY(1)).allowed, true);
  assert.equal(web.evaluateCheckWindow(window, 'manual', WEDNESDAY(6, 30)).allowed, true);
  assert.equal(web.evaluateCheckWindow(window, 'manual', WEDNESDAY(8)).allowed, false);
  assert.equal(web.evaluateCheckWindow(window, 'manual', WEDNESDAY(14)).allowed, false);
});

test('a paused window still reports when it comes back', () => {
  const window = { ...web.defaultCheckWindow(), pausedUntil: WEDNESDAY(20) };
  const decision = web.evaluateCheckWindow(window, 'manual', WEDNESDAY(17));
  assert.equal(decision.nextAllowedAt, WEDNESDAY(20));
});

test('paused beats everything, including an override', () => {
  const window = { ...web.defaultCheckWindow(), mode: 'scheduled', pausedUntil: WEDNESDAY(20) };
  for (const reason of ['manual', 'override', 'passive', 'automatic']) {
    const decision = web.evaluateCheckWindow(window, reason, WEDNESDAY(17));
    assert.equal(decision.allowed, false, `${reason} must be refused while paused`);
    assert.equal(decision.verdict, 'paused');
    assert.equal(decision.overridable, false, 'a pause is not something to click past');
  }
});

test('passive page reading is off until it is switched on', () => {
  const window = { ...web.defaultCheckWindow(), mode: 'scheduled' };
  assert.equal(web.evaluateCheckWindow(window, 'passive', WEDNESDAY(17)).verdict, 'passive_disabled');
  assert.equal(
    web.evaluateCheckWindow({ ...window, readAsIBrowse: true }, 'passive', WEDNESDAY(17)).allowed,
    true,
  );
  // …and switching it on does not exempt it from the clock.
  assert.equal(
    web.evaluateCheckWindow({ ...window, readAsIBrowse: true }, 'passive', WEDNESDAY(11)).allowed,
    false,
  );
});

test('an unconfigured Canvas refuses before any other rule is consulted', () => {
  const decision = web.evaluateCheckWindow(web.defaultCheckWindow(), 'manual', WEDNESDAY(17), {
    connected: false,
  });
  assert.equal(decision.verdict, 'not_connected');
});

test('a hand-edited window cannot widen itself into nonsense', () => {
  const window = web.normalizeCheckWindow({
    mode: 'anything-else',
    schoolDays: [1, 2, 99, -4, 'x'],
    schoolDayStart: 99999,
    dayEnd: -1,
    pausedUntil: 'soon',
    readAsIBrowse: 'yes',
  });
  assert.equal(window.mode, 'manual', 'an unknown mode is the conservative one');
  assert.deepEqual(window.schoolDays, [1, 2]);
  assert.equal(window.schoolDayStart, web.defaultCheckWindow().schoolDayStart);
  assert.equal(window.dayEnd, web.defaultCheckWindow().dayEnd);
  assert.equal(window.pausedUntil, null);
  assert.equal(window.readAsIBrowse, false, 'only a real boolean turns reading on');
});

test('the next open time is a real future moment', () => {
  const window = web.defaultCheckWindow();
  const next = web.nextAllowedAfter(window, WEDNESDAY(11));
  assert.ok(next !== null && next > WEDNESDAY(11));
  assert.equal(new Date(next).getHours(), 15);
  assert.equal(new Date(next).getMinutes(), 30);
});

/* ------------------------------------------------------------------ */
/* 2. The three copies agree                                           */
/* ------------------------------------------------------------------ */

test('the web app and the extension decide identically, everywhere', () => {
  const windows = [
    web.defaultCheckWindow(),
    { ...web.defaultCheckWindow(), mode: 'scheduled' },
    { ...web.defaultCheckWindow(), mode: 'scheduled', readAsIBrowse: true },
    { ...web.defaultCheckWindow(), schoolDays: [0, 6] },
    { ...web.defaultCheckWindow(), mode: 'scheduled', pausedUntil: WEDNESDAY(23) },
  ];
  const reasons = ['manual', 'override', 'passive', 'automatic'];
  const days = [WEDNESDAY, SATURDAY];

  let compared = 0;
  for (const window of windows) {
    for (const reason of reasons) {
      for (const day of days) {
        for (let hour = 0; hour < 24; hour += 1) {
          const now = day(hour, 15);
          const a = web.evaluateCheckWindow(window, reason, now);
          const b = ext.evaluateCheckWindow(window, reason, now);
          assert.deepEqual(
            { allowed: a.allowed, verdict: a.verdict, overridable: a.overridable },
            { allowed: b.allowed, verdict: b.verdict, overridable: b.overridable },
            `mirror drift: ${reason} at ${hour}:00 with mode ${window.mode}`,
          );
          compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 900, 'the matrix should actually be large');
});

test('the local service agrees about when its timer may fetch', () => {
  const windows = [
    web.defaultCheckWindow(),
    { ...web.defaultCheckWindow(), mode: 'scheduled' },
    { ...web.defaultCheckWindow(), mode: 'scheduled', schoolDays: [0, 6] },
    { ...web.defaultCheckWindow(), mode: 'scheduled', pausedUntil: WEDNESDAY(23) },
  ];
  for (const window of windows) {
    for (const day of [WEDNESDAY, SATURDAY]) {
      for (let hour = 0; hour < 24; hour += 1) {
        const now = day(hour, 15);
        const expected = web.evaluateCheckWindow(window, 'automatic', now);
        const actual = service.autoFetchAllowed(now, { checkWindow: window });
        assert.equal(
          actual.allowed,
          expected.allowed,
          `service drift at ${hour}:00 with mode ${window.mode}`,
        );
      }
    }
  }
});

test('a service that was never told the window does not fetch at all', () => {
  // Silence is not permission. The app pushes the window on every load; until
  // it does, the LaunchAgent stays quiet rather than assuming "always".
  assert.equal(service.autoFetchAllowed(WEDNESDAY(17), { checkWindow: null }).allowed, false);
  assert.equal(
    service.autoFetchAllowed(WEDNESDAY(17), { checkWindow: undefined }).verdict,
    'unknown_window',
  );
});

test('automatic page reading keeps unfinished classes and drops completed ones', () => {
  const now = WEDNESDAY(17);
  const assignments = [
    { status: 'Not Started', externalCourseId: '101', canvas: { lastCheckedAt: null } },
    {
      status: 'Not Started',
      externalCourseId: '202',
      canvas: { lastCheckedAt: new Date(now - 60_000).toISOString() },
    },
    { status: 'Completed', externalCourseId: '303', canvas: { lastCheckedAt: null } },
  ];
  assert.deepEqual(autoRead.canvasCourseIdsNeedingRead(assignments, [], DOMAIN), ['101', '202']);
});

test('a new calendar item can identify its class before its first page reading', () => {
  const items = [
    {
      kind: 'assignment',
      cancelled: false,
      externalAssignmentId: '5001',
      url: `https://${DOMAIN}/courses/101/assignments/5001`,
    },
  ];
  assert.deepEqual(autoRead.canvasCourseIdsNeedingRead([], items, DOMAIN), ['101']);
});

test('a calendar link from another host cannot choose an automatic Canvas page', () => {
  const items = [
    {
      kind: 'assignment',
      cancelled: false,
      externalAssignmentId: '5001',
      url: 'https://evil.example/courses/999/assignments/5001',
    },
  ];
  assert.deepEqual(autoRead.canvasCourseIdsNeedingRead([], items, DOMAIN), []);
});

/* ------------------------------------------------------------------ */
/* 3. The trust boundary                                               */
/* ------------------------------------------------------------------ */

test('a score never becomes a submission status', () => {
  const message = validateDetectionMessage(
    {
      type: 'CANVAS_DETECTION',
      domain: DOMAIN,
      readable: true,
      assignments: [
        {
          externalCourseId: '101',
          externalAssignmentId: '5001',
          title: 'Homework',
          url: `https://${DOMAIN}/courses/101/assignments/5001`,
          // A page claiming a perfect score and an unknown status must stay
          // unknown: only the status signals decide, and they said nothing.
          score: 100,
          submissionStatus: 'not-a-real-status',
        },
      ],
    },
    DOMAIN,
  );
  assert.equal(message.assignments[0].score, 100);
  assert.equal(message.assignments[0].submissionStatus, 'verification_unavailable');
});

test('a grade with no course id is dropped, not guessed at', () => {
  assert.equal(validateCourseGrade({ currentScore: 90 }, DOMAIN), null);
  assert.equal(validateCourseGrade({ externalCourseId: 'nope', currentScore: 90 }, DOMAIN), null);
});

test('an impossible percentage is recorded as no grade rather than clamped', () => {
  const grade = validateCourseGrade(
    { externalCourseId: '101', currentScore: 99999, currentGrade: null },
    DOMAIN,
  );
  assert.equal(grade.currentScore, null);
  assert.equal(grade.totalsHidden, true, 'no number and no letter is exactly "hidden"');
});

test('a grade cannot carry a URL from another host', () => {
  const grade = validateCourseGrade(
    {
      externalCourseId: '101',
      currentScore: 90,
      url: 'https://evil.example/courses/101/grades',
    },
    DOMAIN,
  );
  assert.equal(grade.url, undefined);
});

test('grades are capped, so one page cannot flood storage', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    externalCourseId: String(i + 1),
    currentScore: 90,
  }));
  const message = validateDetectionMessage(
    { type: 'CANVAS_DETECTION', domain: DOMAIN, readable: true, grades: many },
    DOMAIN,
  );
  assert.ok(message.grades.length <= 50, `capped, got ${message.grades.length}`);
});

/* ------------------------------------------------------------------ */
/* 4. What the UI is allowed to say                                    */
/* ------------------------------------------------------------------ */

test('a percentage is never rounded up across a boundary', () => {
  // 89.95% shown as "90%" would be LockIn telling a student something Canvas
  // does not say, in exactly the place it matters most.
  assert.equal(grades.formatScore(89.95), '89.9%');
  assert.equal(grades.formatScore(93.75), '93.7%');
  assert.equal(grades.formatScore(100), '100%');
  assert.equal(grades.formatScore(null), '—');
});

test('the class needing attention sorts first, and hidden totals sort last', () => {
  const sorted = grades.sortGrades([
    { externalCourseId: '1', currentScore: 95, currentGrade: 'A', totalsHidden: false, readAt: '' },
    { externalCourseId: '2', currentScore: null, currentGrade: null, totalsHidden: true, readAt: '' },
    { externalCourseId: '3', currentScore: 71, currentGrade: 'C-', totalsHidden: false, readAt: '' },
  ]);
  assert.deepEqual(
    sorted.map((g) => g.externalCourseId),
    ['3', '1', '2'],
  );
});

test('"published" means Canvas said something, not that LockIn worked it out', () => {
  assert.equal(
    grades.hasPublishedTotal({
      externalCourseId: '1',
      currentScore: null,
      currentGrade: null,
      totalsHidden: true,
      readAt: '',
    }),
    false,
  );
  assert.equal(
    grades.hasPublishedTotal({
      externalCourseId: '1',
      currentScore: null,
      currentGrade: 'Pass',
      totalsHidden: false,
      readAt: '',
    }),
    true,
  );
});

/* ------------------------------------------------------------------ */
/* 5. The reading has to reach the assignment it belongs to            */
/* ------------------------------------------------------------------ */

const { reducer } = await import('../../web/src/store/reducer.ts');
const storage = await import('../../web/src/lib/storage.ts');

/**
 * An assignment exactly as the calendar feed creates one.
 *
 * This is the shape that broke it: the feed gives an `externalAssignmentId`
 * (from the `event-assignment-<id>` UID) and **nothing else** — no course id,
 * no `canvas` link. Almost every assignment in a real install looks like this.
 */
function feedAssignment(patch = {}) {
  const now = new Date().toISOString();
  return {
    id: 'a-museum',
    title: 'Museum Project',
    subject: 'History',
    platform: 'Canvas',
    dueDate: '2026-08-18',
    dueTime: '23:59',
    estimatedMinutes: 60,
    loggedMinutes: 0,
    priority: 'Normal',
    status: 'Not Started',
    completionMethod: 'manual',
    createdAt: now,
    updatedAt: now,
    reminders: { firstReminderMinutes: 120, escalationMinutes: 60, focusWarningMinutes: 30, enabled: true },
    remindersFired: [],
    verificationStatus: 'not_required',
    verificationRecords: [],
    externalAssignmentId: '77001',
    // Deliberately absent, because the feed cannot supply them:
    externalCourseId: undefined,
    canvas: undefined,
    ...patch,
  };
}

function stateWithFeedAssignment() {
  const base = storage.defaultState();
  return {
    ...base,
    profile: { firstName: 'Alex', onboarded: true, createdAt: new Date().toISOString() },
    assignments: [feedAssignment()],
    canvas: {
      ...base.canvas,
      connection: {
        domain: DOMAIN,
        mode: 'browser',
        connectedAt: new Date().toISOString(),
        lastSeenAt: null,
        permissionGranted: true,
      },
    },
  };
}

const gradedDetection = {
  externalCourseId: '404',
  externalAssignmentId: '77001',
  title: 'Museum Project',
  url: `https://${DOMAIN}/courses/404/assignments/77001`,
  submissionStatus: 'graded',
  score: 100,
  pointsPossible: 100,
  detectedAt: new Date().toISOString(),
};

test('a graded reading completes the feed assignment it belongs to', () => {
  // The reported bug, exactly: full score and graded on Canvas, "Not Started"
  // in LockIn. The exact-key lookup could never match a feed assignment,
  // because that key needs a course id and a link the feed never supplies.
  const next = reducer(stateWithFeedAssignment(), {
    type: 'CANVAS_DETECTED',
    detected: [gradedDetection],
    seenAt: new Date().toISOString(),
  });

  const assignment = next.assignments[0];
  assert.equal(assignment.canvas?.submissionStatus, 'graded');
  assert.equal(assignment.status, 'Completed');
  assert.equal(assignment.canvas?.score, 100);
});

test('and it adopts the identity it was missing, so later reads take the fast path', () => {
  const next = reducer(stateWithFeedAssignment(), {
    type: 'CANVAS_DETECTED',
    detected: [gradedDetection],
    seenAt: new Date().toISOString(),
  });
  assert.equal(next.assignments[0].externalCourseId, '404');
  assert.equal(next.assignments[0].canvas?.domain, DOMAIN);
});

test('it is not filed as a separate import candidate as well', () => {
  // The old behaviour: the reading fell through to the "not linked to
  // anything" pile, so the student was offered an import of work they already
  // had, while the real assignment stayed unfinished.
  const next = reducer(stateWithFeedAssignment(), {
    type: 'CANVAS_DETECTED',
    detected: [gradedDetection],
    seenAt: new Date().toISOString(),
  });
  assert.equal(next.canvas.detected.length, 0);
});

test('an id that belongs to a different Canvas install is not adopted', () => {
  const state = stateWithFeedAssignment();
  state.assignments[0].canvas = {
    domain: 'other-school.instructure.com',
    url: 'https://other-school.instructure.com/courses/1/assignments/77001',
    submissionStatus: 'not_submitted',
    lastCheckedAt: null,
    lastStatusChangeAt: null,
  };
  const next = reducer(state, {
    type: 'CANVAS_DETECTED',
    detected: [gradedDetection],
    seenAt: new Date().toISOString(),
  });
  assert.equal(next.assignments[0].status, 'Not Started');
});

test('a matching id with a conflicting course id is left alone', () => {
  const state = stateWithFeedAssignment();
  state.assignments[0].externalCourseId = '999';
  const next = reducer(state, {
    type: 'CANVAS_DETECTED',
    detected: [gradedDetection],
    seenAt: new Date().toISOString(),
  });
  assert.equal(next.assignments[0].status, 'Not Started');
});

/* ------------------------------------------------------------------ */
/* 6. Blocking rules must survive two refreshes at once                */
/* ------------------------------------------------------------------ */

/**
 * The failure this reproduces was visible in the service-worker console as:
 *
 *   [LockIn] failed to apply blocking rules
 *   Error: Rule with id 1 does not have a unique ID.
 *
 * `refresh()` is called from cold start, two lifecycle hooks, two alarms,
 * `storage.onChanged` and every SYNC_STATE — several of which fire together
 * when Chrome starts. `applyRules` read the existing rules and then wrote, and
 * two overlapping runs both read an empty set, both numbered from 1, and the
 * second write was rejected. The error was caught upstream, so nothing
 * crashed: blocking simply did not get applied, which is the one thing this
 * extension exists to do.
 *
 * Chrome is stubbed exactly as far as the rule bookkeeping goes — enough to
 * reject a duplicate id the way the real API does.
 */
function stubChromeDNR() {
  let stored = [];
  return {
    api: {
      declarativeNetRequest: {
        async getDynamicRules() {
          // A real async boundary, which is where the interleaving happens.
          await new Promise((resolve) => setTimeout(resolve, 0));
          return stored.map((r) => ({ ...r }));
        },
        async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          const remove = new Set(removeRuleIds);
          const kept = stored.filter((r) => !remove.has(r.id));
          for (const rule of addRules) {
            if (kept.some((r) => r.id === rule.id)) {
              throw new Error(`Rule with id ${rule.id} does not have a unique ID.`);
            }
            kept.push(rule);
          }
          stored = kept;
        },
      },
    },
    rules: () => stored,
  };
}

test('two refreshes at once do not collide over rule ids', async () => {
  const stub = stubChromeDNR();
  globalThis.chrome = stub.api;

  const { applyRules } = await import('../background/rules.js');

  const state = {
    focusModeActive: true,
    blockingEnabled: true,
    blockedDomains: ['distraction.test', 'another.test'],
    allowedDomains: ['instructure.com'],
    requiredRemaining: 1,
    temporaryUnlockUntil: null,
    isTest: false,
    appUrl: 'http://localhost:5173',
  };

  // Six at once, which is what Chrome starting actually produces.
  const results = await Promise.all(Array.from({ length: 6 }, () => applyRules(state)));

  assert.ok(
    results.every((count) => count > 0),
    `every write should have applied rules, got ${JSON.stringify(results)}`,
  );

  const ids = stub.rules().map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate rule ids may be left behind');
  assert.equal(ids.length, results[0], 'the final rule set is one clean copy, not six');
});

test('a duplicate-id rejection heals itself instead of dropping blocking', async () => {
  // Belt and braces for the error the user saw three times on their own
  // install. Even if some path escapes the queue, the outcome must be applied
  // rules — not a caught error and an unblocked browser.
  let stored = [{ id: 1, priority: 1, action: { type: 'block' }, condition: {} }];
  let rejectedOnce = false;

  globalThis.chrome = {
    declarativeNetRequest: {
      async getDynamicRules() {
        return stored.map((r) => ({ ...r }));
      },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        // Simulate the racy state: the first write is told to remove ids that
        // are not the ones actually present, so id 1 collides.
        if (!rejectedOnce && addRules.length > 0) {
          rejectedOnce = true;
          throw new Error('Rule with id 1 does not have a unique ID.');
        }
        const remove = new Set(removeRuleIds);
        stored = stored.filter((r) => !remove.has(r.id)).concat(addRules);
      },
    },
  };

  const { applyRules } = await import(`../background/rules.js?heal=${Date.now()}`);
  const count = await applyRules({
    focusModeActive: true,
    blockingEnabled: true,
    blockedDomains: ['distraction.test'],
    allowedDomains: [],
    requiredRemaining: 1,
    temporaryUnlockUntil: null,
    isTest: false,
    appUrl: 'http://localhost:5173',
  });

  assert.ok(rejectedOnce, 'the collision should actually have been exercised');
  assert.ok(count > 0, 'rules were applied on the retry');
  assert.ok(stored.length > 0, 'and they are really in place');
  const ids = stored.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'with no duplicates left behind');
});
