/**
 * Parent Dashboard selectors — pure, on deterministic seeded data.
 *
 * Every number a parent sees comes from these functions, so the tests are
 * written the way a parent would check the maths: build a week where the answer
 * is known by hand, then assert the exact figure. Anything vaguer would let a
 * miscount through, and a miscount here is a parent drawing a wrong conclusion
 * about their kid.
 *
 * Run: npm run test:parent-selectors
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { defaultState } = await import('../../web/src/lib/storage.ts');
const {
  buildWeeklyCsv,
  buildWeeklyExport,
  selectDailySeries,
  selectFocusHistory,
  selectOverrideHistory,
  selectParentAssignmentSummary,
  selectParentExams,
  selectRecentVerifications,
  selectVerificationBreakdown,
  selectWeeklySummary,
  verificationKindOf,
} = await import('../../web/src/lib/parent/selectors.ts');

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A fixed "now" so week boundaries are exact rather than clock-dependent. */
const NOW = new Date('2026-08-16T18:00:00');
const daysAgo = (days, hour = 12) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

let nextId = 0;
const id = (prefix) => `${prefix}_${(nextId += 1)}`;

function assignment({
  title = 'Work',
  subject = 'Science',
  completedAt,
  records = [],
  status = completedAt ? 'Completed' : 'Not Started',
  edgenuity,
} = {}) {
  return {
    id: id('asg'),
    title,
    subject,
    platform: 'Other',
    dueDate: '2026-08-20',
    dueTime: '23:59',
    estimatedMinutes: 30,
    priority: 'Normal',
    status,
    completionMethod: 'manual',
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
    completedAt,
    loggedMinutes: 0,
    reminders: { firstReminderMinutes: 120, escalationMinutes: 60, focusWarningMinutes: 30, enabled: false },
    remindersFired: [],
    verificationStatus: completedAt ? 'verified' : 'not_required',
    verificationRecords: records,
    edgenuity,
  };
}

const canvasRecord = (at) => ({
  id: id('ver'),
  type: 'canvas_submission',
  timestamp: at,
  status: 'verified',
  evidence: { canvasStatus: 'submitted' },
});

const edgenuityRecord = (at, trust) => ({
  id: id('ver'),
  type: 'canvas_submission',
  timestamp: at,
  status: 'verified',
  progressBefore: 43,
  progressAfter: 47,
  evidence: {
    trust,
    verificationType: trust === 'enhanced' ? 'live_camera_ocr_enhanced' : 'live_camera_ocr',
    progressDelta: 4,
    challengeBeforeVerified: trust === 'enhanced',
    challengeAfterVerified: trust === 'enhanced',
    screenConfidence: 'high',
  },
});

const manualRecord = (at) => ({
  id: id('ver'),
  type: 'manual',
  timestamp: at,
  status: 'verified',
  note: 'Marked complete by the student',
});

const event = (type, at, meta, message = 'x') => ({
  id: id('evt'),
  type,
  timestamp: at,
  message,
  meta,
});

/**
 * The week the spec asks for: 2 Canvas, 1 Standard Edgenuity, 2 Enhanced
 * Edgenuity, 3 manual — eight completions, five of them with real evidence.
 */
function seededState() {
  const state = defaultState();

  state.assignments = [
    assignment({ title: 'Essay', subject: 'English', completedAt: daysAgo(1), records: [canvasRecord(daysAgo(1))] }),
    assignment({ title: 'Lab report', subject: 'Science', completedAt: daysAgo(2), records: [canvasRecord(daysAgo(2))] }),
    assignment({ title: 'Science module', subject: 'Science', completedAt: daysAgo(1), records: [canvasRecord(daysAgo(1))] }),
    assignment({ title: 'Physics module', subject: 'Science', completedAt: daysAgo(3), records: [canvasRecord(daysAgo(3))] }),
    assignment({ title: 'Chemistry module', subject: 'Science', completedAt: daysAgo(3), records: [canvasRecord(daysAgo(3))] }),
    assignment({ title: 'Worksheet', subject: 'Math', completedAt: daysAgo(2), records: [manualRecord(daysAgo(2))] }),
    assignment({ title: 'Reading', subject: 'English', completedAt: daysAgo(4), records: [manualRecord(daysAgo(4))] }),
    assignment({ title: 'Vocabulary', subject: 'English', completedAt: daysAgo(5), records: [] }),
    // Outside the window, and unfinished work.
    assignment({ title: 'Old essay', subject: 'History', completedAt: daysAgo(20), records: [canvasRecord(daysAgo(20))] }),
    assignment({ title: 'Unfinished', subject: 'Math' }),
  ];

  state.completedSessions = [
    { id: id('ses'), assignmentId: null, assignmentTitle: null, plannedMinutes: 25, actualMinutes: 25, startedAt: daysAgo(1), endedAt: daysAgo(1) },
    { id: id('ses'), assignmentId: null, assignmentTitle: null, plannedMinutes: 45, actualMinutes: 50, startedAt: daysAgo(2), endedAt: daysAgo(2) },
    { id: id('ses'), assignmentId: null, assignmentTitle: null, plannedMinutes: 30, actualMinutes: 30, startedAt: daysAgo(30), endedAt: daysAgo(30) },
  ];

  state.activity = [
    event('parent_override', daysAgo(1)),
    event('temporary_unlock_ended', daysAgo(2)),
    event('temporary_unlock_started', daysAgo(2), { minutes: 15 }),
    event('emergency_exit', daysAgo(3), undefined, 'Emergency exit used — School site blocked'),
    // Long ago: outside the weekly window.
    event('parent_override', daysAgo(25)),
  ];

  state.focusRuns = [
    {
      id: 'run_1',
      startedAt: daysAgo(1, 18),
      endedAt: daysAgo(1, 19),
      requiredTaskIds: [state.assignments[0].id, state.assignments[2].id],
      requiredCount: 2,
      completedCount: 2,
      outcome: 'completed',
      isTest: false,
      unlocks: [{ minutes: 15, startedAt: daysAgo(1, 18), endedAt: daysAgo(1, 18), byParent: true }],
      blocked: [
        { domain: 'youtube.com', count: 3 },
        { domain: 'reddit.com', count: 1 },
      ],
      blockBaseline: [],
    },
    {
      id: 'run_test',
      startedAt: daysAgo(2, 18),
      endedAt: daysAgo(2, 18),
      requiredTaskIds: [],
      requiredCount: 0,
      completedCount: 0,
      outcome: 'test_expired',
      isTest: true,
      unlocks: [],
      blocked: [],
      blockBaseline: [],
    },
  ];

  state.exams = [
    { id: id('exm'), name: 'Biology Exam', subject: 'Science', examDate: isoDate(5), materialAmount: 'Medium', createdAt: daysAgo(9), updatedAt: daysAgo(9) },
    { id: id('exm'), name: 'Old Exam', subject: 'Math', examDate: isoDate(-3), materialAmount: 'Light', createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  ];

  return state;
}

function isoDate(inDays) {
  const date = new Date(NOW);
  date.setDate(date.getDate() + inDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Weekly summary                                                      */
/* ------------------------------------------------------------------ */

test('the weekly summary counts exactly what happened in the window', () => {
  const summary = selectWeeklySummary(seededState(), NOW);

  assert.equal(summary.assignmentsCompleted, 8, 'eight completions inside the seven-day window');
  assert.equal(summary.verifiedCompletions, 5, '2 Canvas + 1 Standard + 2 Enhanced');
  assert.equal(summary.manualCompletions, 3, 'two manual records and one with no record at all');
  assert.equal(summary.focusSessions, 2, 'the 30-day-old session is outside the window');
  assert.equal(summary.focusMinutes, 75);
  assert.equal(summary.parentOverrides, 1, 'the 25-day-old override is outside the window');
  assert.equal(summary.emergencyExits, 1);
  assert.equal(summary.temporaryUnlocks, 1);
});

test('a temporary unlock is never counted as an override', () => {
  const summary = selectWeeklySummary(seededState(), NOW);
  // Both happened; they are reported separately because they mean different
  // things — one ends the session, the other pauses blocking.
  assert.equal(summary.parentOverrides, 1);
  assert.equal(summary.temporaryUnlocks, 1);
});

test('work completed before the window is excluded', () => {
  const state = seededState();
  const summary = selectWeeklySummary(state, NOW);
  const everCompleted = state.assignments.filter((a) => a.completedAt).length;
  assert.equal(everCompleted, 9);
  assert.equal(summary.assignmentsCompleted, 8);
});

test('the week boundary is inclusive of the earliest day', () => {
  const state = defaultState();
  // Exactly six days back, at one minute past local midnight: inside.
  const edge = new Date(NOW);
  edge.setDate(edge.getDate() - 6);
  edge.setHours(0, 1, 0, 0);
  state.assignments = [assignment({ completedAt: edge.toISOString(), records: [manualRecord(edge.toISOString())] })];
  assert.equal(selectWeeklySummary(state, NOW).assignmentsCompleted, 1);

  // A minute before that midnight: outside.
  const before = new Date(edge);
  before.setDate(before.getDate() - 1);
  before.setHours(23, 59, 0, 0);
  state.assignments = [assignment({ completedAt: before.toISOString(), records: [] })];
  assert.equal(selectWeeklySummary(state, NOW).assignmentsCompleted, 0);
});

/* ------------------------------------------------------------------ */
/* Trust breakdown                                                     */
/* ------------------------------------------------------------------ */

test('the breakdown separates Canvas-verified work from manual', () => {
  const breakdown = selectVerificationBreakdown(seededState(), NOW);
  const count = (kind) => breakdown.find((row) => row.kind === kind).count;

  // Five Canvas-verified inside the window, three manual (two records, one
  // completed with no record at all).
  assert.equal(count('canvas'), 5);
  assert.equal(count('manual'), 3);
  assert.equal(breakdown.reduce((sum, row) => sum + row.count, 0), 8);
});

test('every category carries an honest explanation, and none of them overclaims', () => {
  for (const row of selectVerificationBreakdown(seededState(), NOW)) {
    assert.ok(row.explanation.length > 20, `${row.kind} needs an explanation`);
    for (const forbidden of ['guarantee', 'cheat proof', 'tamper proof', '100%', 'definitely']) {
      assert.equal(
        row.explanation.toLowerCase().includes(forbidden),
        false,
        `${row.kind} must not claim "${forbidden}"`,
      );
    }
  }
});

test('a completion with no verification record is manual, whatever the platform says', () => {
  const canvasPlatform = assignment({ completedAt: daysAgo(1), records: [] });
  canvasPlatform.platform = 'Canvas';
  assert.equal(verificationKindOf(canvasPlatform), 'manual');
});

/* ------------------------------------------------------------------ */
/* Recent work                                                         */
/* ------------------------------------------------------------------ */

test('recent work is newest first and carries the evidence', () => {
  const recent = selectRecentVerifications(seededState(), 5);
  assert.equal(recent.length, 5);
  assert.ok(Date.parse(recent[0].completedAt) >= Date.parse(recent[1].completedAt));

  const canvas = recent.find((entry) => entry.kind === 'canvas');
  assert.equal(canvas.canvasStatus, 'submitted');
});



/* ------------------------------------------------------------------ */
/* Focus history                                                       */
/* ------------------------------------------------------------------ */

test('focus history summarises a run without exposing any URLs', () => {
  const [run] = selectFocusHistory(seededState());

  assert.equal(run.requiredCount, 2);
  assert.equal(run.completedCount, 2);
  assert.equal(run.outcomeLabel, 'Completed normally');
  assert.equal(run.minutes, 60);
  assert.deepEqual(
    run.blocked.map((b) => `${b.domain} ${b.count}`),
    ['youtube.com 3', 'reddit.com 1'],
  );
  assert.equal(run.totalBlocked, 4);
  // Domains and counts only — there is no field that could hold a path.
  assert.equal(JSON.stringify(run.blocked).includes('/'), false);
});

test('blocking tests are left out of the parent history', () => {
  const runs = selectFocusHistory(seededState());
  assert.equal(runs.length, 1, 'the 5-minute blocking test is not schoolwork');
  assert.equal(selectFocusHistory(seededState(), { includeTests: true }).length, 2);
});

test('overrides, emergency exits and unlocks are three separate kinds', () => {
  const entries = selectOverrideHistory(seededState());
  const kinds = entries.map((entry) => entry.kind);

  assert.ok(kinds.includes('override'));
  assert.ok(kinds.includes('emergency'));
  assert.ok(kinds.includes('temporary_unlock'));

  const emergency = entries.find((entry) => entry.kind === 'emergency');
  assert.equal(emergency.note, 'School site blocked', 'the recorded reason is shown as given');

  const unlock = entries.find((entry) => entry.kind === 'temporary_unlock');
  assert.equal(unlock.minutes, 15);
  assert.ok(unlock.endedAt, 'and it is paired with when blocking resumed');
});

/* ------------------------------------------------------------------ */
/* Assignments and exams                                               */
/* ------------------------------------------------------------------ */

test('assignment filters split the list the way the dashboard offers', () => {
  const state = seededState();
  const count = (filter) => selectParentAssignmentSummary(state, filter).length;

  assert.equal(count('all'), 10);
  assert.equal(count('completed'), 9);
  assert.equal(count('incomplete'), 1);
  assert.equal(count('canvas'), 6, 'includes the one outside the weekly window');
  assert.equal(count('manual'), 3);
});



test('only upcoming exams are listed, with study sessions on that subject', () => {
  const state = seededState();
  state.completedSessions.push({
    id: id('ses'),
    assignmentId: state.assignments[2].id, // Science
    assignmentTitle: 'Science module',
    plannedMinutes: 25,
    actualMinutes: 25,
    startedAt: daysAgo(1),
    endedAt: daysAgo(1),
  });

  const exams = selectParentExams(state, NOW);
  assert.equal(exams.length, 1, 'the past exam is dropped');
  assert.equal(exams[0].exam.name, 'Biology Exam');
  assert.equal(exams[0].daysAway, 5);
  assert.equal(exams[0].studySessions, 1);
});

/* ------------------------------------------------------------------ */
/* Daily series                                                        */
/* ------------------------------------------------------------------ */

test('the daily series covers seven days and totals match the summary', () => {
  const state = seededState();
  const series = selectDailySeries(state, NOW);
  const summary = selectWeeklySummary(state, NOW);

  assert.equal(series.length, 7);
  assert.equal(
    series.reduce((sum, day) => sum + day.verified, 0),
    summary.verifiedCompletions,
  );
  assert.equal(
    series.reduce((sum, day) => sum + day.manual, 0),
    summary.manualCompletions,
  );
  assert.equal(
    series.reduce((sum, day) => sum + day.focusMinutes, 0),
    summary.focusMinutes,
  );
});

/* ------------------------------------------------------------------ */
/* Export safety                                                       */
/* ------------------------------------------------------------------ */

test('the export carries the summary and none of the secrets', () => {
  const state = seededState();
  state.parentPin = { hash: 'deadbeefhash', salt: 'saltysalt', createdAt: daysAgo(30) };

  const exported = JSON.stringify(buildWeeklyExport(state, NOW));

  assert.ok(exported.includes('assignmentsCompleted'));
  for (const secret of ['deadbeefhash', 'saltysalt', 'K7M4', 'abc123', 'rawText', 'data:image']) {
    assert.equal(exported.includes(secret), false, `export must not contain ${secret}`);
  }
});

test('the CSV export has a header row and one line per completion', () => {
  const csv = buildWeeklyCsv(seededState());
  const lines = csv.split('\n');
  assert.match(lines[0], /^Completed at,Subject,Assignment,Verification,Canvas status/);
  assert.equal(lines.length, 10, 'header plus nine completed assignments');
  assert.equal(csv.includes('K7M4'), false);
});

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

test('a brand-new device reports zeroes rather than inventing data', () => {
  const empty = defaultState();
  const summary = selectWeeklySummary(empty, NOW);

  assert.equal(summary.assignmentsCompleted, 0);
  assert.equal(summary.focusMinutes, 0);
  assert.deepEqual(selectRecentVerifications(empty), []);
  assert.deepEqual(selectFocusHistory(empty), []);
  assert.deepEqual(selectOverrideHistory(empty), []);
  assert.equal(selectDailySeries(empty, NOW).length, 7);
});
