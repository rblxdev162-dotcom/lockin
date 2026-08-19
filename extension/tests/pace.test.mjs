/**
 * The Pace Engine and the freshness model.
 *
 * These are the two files that decide what LockIn is *allowed to claim*, so
 * the tests are mostly about refusals: not calling something overdue on stale
 * data, not calling a student behind because a sync failed, not presenting an
 * import as live.
 *
 * Pure logic only — no browser, no clock. Every case pins `now`.
 *
 * Run: npm run test:pace
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { classify, effectiveConfidence, preferSource, trustworthyForJudgment, relativeAge } =
  await import('../../web/src/lib/sources/freshness.ts');
const { computePace, trustedOverdue, staleSources, PACE_LABEL } = await import(
  '../../web/src/lib/pace/engine.ts'
);
const { coursePace, ON_PACE_BAND } = await import('../../web/src/lib/pace/courses.ts');
const { defaultState } = await import('../../web/src/lib/storage.ts');

const NOW = Date.parse('2026-03-10T18:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const iso = (ms) => new Date(ms).toISOString();

function source(patch = {}) {
  return {
    kind: 'CANVAS_CALENDAR',
    sourceId: 'feed-1',
    confidence: 'high',
    isLive: true,
    rawDataRetained: false,
    lastSyncedAt: iso(NOW - 5 * 60_000),
    ...patch,
  };
}

function assignment(patch = {}) {
  const due = patch.dueIn ?? DAY;
  delete patch.dueIn;
  // Due dates are stored as local `YYYY-MM-DD` + `HH:MM` and parsed as local
  // time, so the fixture has to build them locally too. Using ISO/UTC here
  // shifts every deadline by the machine's offset and quietly breaks the
  // overdue cases — which is exactly the class of bug the time suite exists
  // for.
  const dueDate = new Date(NOW + due);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    id: patch.id ?? 'a1',
    title: 'Cell Respiration Worksheet',
    subject: 'Biology',
    platform: 'Canvas',
    dueDate: `${dueDate.getFullYear()}-${pad(dueDate.getMonth() + 1)}-${pad(dueDate.getDate())}`,
    dueTime: `${pad(dueDate.getHours())}:${pad(dueDate.getMinutes())}`,
    estimatedMinutes: 35,
    loggedMinutes: 0,
    priority: 'Normal',
    status: 'Not Started',
    completionMethod: 'manual',
    createdAt: iso(NOW - DAY),
    updatedAt: iso(NOW - DAY),
    reminders: {
      firstReminderMinutes: 120,
      escalationMinutes: 60,
      focusWarningMinutes: 30,
      enabled: true,
    },
    remindersFired: [],
    verificationStatus: 'not_required',
    verificationRecords: [],
    source: source(),
    ...patch,
  };
}

function course(patch = {}) {
  const stamp = patch.stamp ?? source({ kind: 'EDGENUITY_PROGRESS_EMAIL', isLive: false });
  delete patch.stamp;
  return {
    id: 'c1',
    provider: 'edgenuity',
    product: 'EDGENUITY',
    name: 'Algebra I',
    activities: [],
    createdAt: iso(NOW - 30 * DAY),
    updatedAt: iso(NOW),
    actualProgressPercent: { value: 61.7, source: stamp },
    targetProgressPercent: { value: 57.2, source: stamp },
    ...patch,
  };
}

function stateWith({ assignments = [], courses = [] } = {}) {
  const base = defaultState();
  return {
    ...base,
    assignments,
    integrations: { ...base.integrations, courses },
  };
}

/* ------------------------------------------------------------------ */
/* Freshness                                                           */
/* ------------------------------------------------------------------ */

test('a live connection inside its window is LIVE; the same record later is not', () => {
  const record = source();
  assert.equal(classify(record, NOW).state, 'LIVE');
  // Same stored record, seven hours later: past the calendar feed's fresh
  // window, so it degrades on its own. Nothing had to write a flag.
  assert.equal(classify(record, NOW + 7 * HOUR).state, 'SYNCED');
  assert.equal(classify(record, NOW + 30 * HOUR).state, 'STALE');
});

test('an import is never LIVE, however recent', () => {
  const record = source({ kind: 'EDGENUITY_COURSE_REPORT', isLive: true });
  assert.equal(classify(record, NOW).state, 'IMPORTED');
});

test('an erroring source is UNAVAILABLE even when it synced a minute ago', () => {
  const record = source({ syncError: 'Feed did not respond' });
  const result = classify(record, NOW);
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.stale, true);
});

test('a source that never synced is UNAVAILABLE, not STALE', () => {
  assert.equal(classify(source({ lastSyncedAt: undefined }), NOW).state, 'UNAVAILABLE');
  assert.equal(classify(undefined, NOW).state, 'UNAVAILABLE');
});

test('manual data is MANUAL forever and never ages into staleness', () => {
  const record = source({ kind: 'MANUAL' });
  assert.equal(classify(record, NOW).state, 'MANUAL');
  assert.equal(classify(record, NOW + 400 * DAY).state, 'MANUAL');
});

test('age lowers confidence and never raises it', () => {
  const record = source({ confidence: 'high' });
  assert.equal(effectiveConfidence(record, NOW), 'high');
  assert.equal(effectiveConfidence(record, NOW + 40 * HOUR), 'low');
});

test('only believable states are trusted for a judgment', () => {
  assert.equal(trustworthyForJudgment(source(), NOW), true);
  assert.equal(trustworthyForJudgment(source(), NOW + 40 * HOUR), false);
  assert.equal(trustworthyForJudgment(source({ syncError: 'nope' }), NOW), false);
});

test('conflicting sources resolve live over imported, then newer, then confidence', () => {
  const live = source();
  const imported = source({
    kind: 'EDGENUITY_COURSE_REPORT',
    isLive: false,
    lastSyncedAt: iso(NOW - 60_000),
  });
  assert.equal(preferSource(live, imported, NOW), live);

  const older = source({ lastSyncedAt: iso(NOW - 3 * HOUR) });
  const newer = source({ lastSyncedAt: iso(NOW - HOUR) });
  assert.equal(preferSource(older, newer, NOW), newer);

  const low = source({ confidence: 'low' });
  const high = source({ confidence: 'high' });
  assert.equal(preferSource(low, high, NOW), high);
});

test('ages read as sentences, not as numbers', () => {
  assert.equal(relativeAge(30_000), 'just now');
  assert.equal(relativeAge(7 * 60_000), '7 minutes ago');
  assert.equal(relativeAge(3 * HOUR), '3 hours ago');
  assert.equal(relativeAge(28 * HOUR), 'yesterday');
  assert.equal(relativeAge(4 * DAY), '4 days ago');
});

/* ------------------------------------------------------------------ */
/* Course pacing                                                       */
/* ------------------------------------------------------------------ */

test('classic Edgenuity ahead of target reads AHEAD', () => {
  const pace = coursePace(course(), NOW);
  assert.equal(pace.status, 'AHEAD');
  assert.equal(pace.deltaPercent, 4.5);
  // Never claimed as Edgenuity's own verdict unless a report published one.
  assert.equal(pace.official, false);
});

test('a difference inside the band is ON_TRACK, not behind', () => {
  const stamp = source({ kind: 'EDGENUITY_PROGRESS_EMAIL', isLive: false });
  const pace = coursePace(
    course({
      actualProgressPercent: { value: 56, source: stamp },
      targetProgressPercent: { value: 57, source: stamp },
    }),
    NOW,
  );
  assert.equal(pace.status, 'ON_TRACK');
  assert.ok(ON_PACE_BAND > 0);
});

test('EdgeEX is never given classic Edgenuity’s verdict as official', () => {
  const pace = coursePace(course({ product: 'EDGEEX' }), NOW);
  assert.equal(pace.official, false);
  assert.equal(pace.product, 'EDGEEX');
});

test('a missing target produces UNKNOWN rather than a guess', () => {
  const pace = coursePace(course({ targetProgressPercent: undefined }), NOW);
  assert.equal(pace.status, 'UNKNOWN');
  assert.equal(pace.deltaPercent, undefined);
});

test('stale course data produces UNKNOWN, not a pace', () => {
  const old = source({
    kind: 'EDGENUITY_PROGRESS_EMAIL',
    isLive: false,
    lastSyncedAt: iso(NOW - 20 * DAY),
  });
  const pace = coursePace(course({ stamp: old }), NOW);
  assert.equal(pace.status, 'UNKNOWN');
  assert.equal(pace.stale, true);
});

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

test('no data at all is UNKNOWN with an invitation, never a verdict', () => {
  const report = computePace({ state: stateWith(), now: NOW });
  assert.equal(report.status, 'UNKNOWN');
  assert.equal(report.suggestedAction.kind, 'connect');
});

test('overdue work with a trustworthy due date is BEHIND', () => {
  const report = computePace({
    state: stateWith({ assignments: [assignment({ dueIn: -2 * HOUR })] }),
    now: NOW,
  });
  assert.equal(report.status, 'BEHIND');
  assert.equal(report.suggestedAction.kind, 'start_focus');
  assert.ok(report.reasons.some((r) => r.code === 'overdue_work'));
});

test('overdue work from a stale feed is NOT called overdue', () => {
  const stale = source({ lastSyncedAt: iso(NOW - 5 * DAY) });
  const state = stateWith({ assignments: [assignment({ dueIn: -2 * HOUR, source: stale })] });

  assert.deepEqual(trustedOverdue(state, NOW), []);
  const report = computePace({ state, now: NOW });
  assert.equal(report.status, 'UNKNOWN');
  assert.equal(report.suggestedAction.kind, 'sync');
  assert.equal(report.staleSources.length, 1);
});

test('a failed sync never produces BEHIND', () => {
  const broken = source({ syncError: 'Feed did not respond' });
  const report = computePace({
    state: stateWith({ assignments: [assignment({ dueIn: -DAY, source: broken })] }),
    now: NOW,
  });
  assert.notEqual(report.status, 'BEHIND');
  assert.equal(report.status, 'UNKNOWN');
});

test('a hand-typed due date is trusted, because the student set it themselves', () => {
  const manual = { kind: 'MANUAL', sourceId: 'manual', confidence: 'low', isLive: false, rawDataRetained: false };
  const report = computePace({
    state: stateWith({ assignments: [assignment({ dueIn: -HOUR, source: manual })] }),
    now: NOW,
  });
  assert.equal(report.status, 'BEHIND');
  assert.equal(report.confidence, 'low');
});

test('one stale feed alongside fresh data still answers the question', () => {
  const stale = source({ kind: 'EDGENUITY_PROGRESS_EMAIL', lastSyncedAt: iso(NOW - 20 * DAY) });
  const report = computePace({
    state: stateWith({
      assignments: [assignment({ dueIn: -HOUR })],
      courses: [course({ stamp: stale })],
    }),
    now: NOW,
  });
  assert.equal(report.status, 'BEHIND');
  assert.equal(report.staleSources.length, 1, 'and it names the stale one');
});

test('a course behind pace is BEHIND with a way back, not a scolding', () => {
  const stamp = source({ kind: 'EDGENUITY_PROGRESS_EMAIL', isLive: false });
  const report = computePace({
    state: stateWith({
      courses: [
        course({
          actualProgressPercent: { value: 40, source: stamp },
          targetProgressPercent: { value: 57, source: stamp },
        }),
      ],
    }),
    now: NOW,
  });
  assert.equal(report.status, 'BEHIND');
  const prose = report.reasons.map((r) => r.text).join(' ');
  for (const word of ['failing', 'lazy', 'should have', 'disappointing']) {
    assert.ok(!prose.toLowerCase().includes(word), `pace copy must not say "${word}"`);
  }
});

test('everything due soon finished, and a course ahead, is AHEAD', () => {
  const report = computePace({
    state: stateWith({
      assignments: [assignment({ dueIn: 3 * HOUR, status: 'Completed', completedAt: iso(NOW) })],
      courses: [course()],
    }),
    now: NOW,
  });
  assert.equal(report.status, 'AHEAD');
  assert.equal(report.confidence, 'high');
});

test('more work than hours before the deadline is AT_RISK, not BEHIND', () => {
  const report = computePace({
    state: stateWith({
      assignments: [
        assignment({ id: 'a1', dueIn: 2 * HOUR, estimatedMinutes: 120 }),
        assignment({ id: 'a2', dueIn: 3 * HOUR, estimatedMinutes: 120 }),
      ],
    }),
    now: NOW,
  });
  assert.equal(report.status, 'AT_RISK');
  assert.equal(report.suggestedAction.assignmentId, 'a1', 'the soonest one is the suggestion');
});

test('an ordinary week with room to work is ON_TRACK', () => {
  const report = computePace({
    state: stateWith({ assignments: [assignment({ dueIn: 30 * HOUR, estimatedMinutes: 35 })] }),
    now: NOW,
  });
  assert.equal(report.status, 'ON_TRACK');
});

test('stale sources are listed once per source, not once per record', () => {
  const stale = source({ lastSyncedAt: iso(NOW - 5 * DAY) });
  const state = stateWith({
    assignments: [
      assignment({ id: 'a1', source: stale }),
      assignment({ id: 'a2', source: stale }),
      assignment({ id: 'a3', source: stale }),
    ],
  });
  assert.equal(staleSources(state, NOW).length, 1);
});

test('every status has a label the UI can render', () => {
  for (const status of ['AHEAD', 'ON_TRACK', 'AT_RISK', 'BEHIND', 'UNKNOWN']) {
    assert.equal(typeof PACE_LABEL[status], 'string');
    assert.ok(PACE_LABEL[status].length > 0);
  }
});

test('the engine is pure — the same inputs give the same report', () => {
  const state = stateWith({ assignments: [assignment()], courses: [course()] });
  const a = computePace({ state, now: NOW });
  const b = computePace({ state, now: NOW });
  assert.deepEqual(a, b);
});
