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

const DOMAIN = 'myschool.instructure.com';

/** A weekday and a weekend day, so day-of-week logic is actually exercised. */
const WEDNESDAY = (h, m = 0) => new Date(2026, 7, 19, h, m).getTime();
const SATURDAY = (h, m = 0) => new Date(2026, 7, 22, h, m).getTime();

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
