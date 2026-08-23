/**
 * Dates at the edges (Phase 8).
 *
 * Phase 7 put a lot of scheduling weight on date arithmetic, and every bug in
 * that kind of code lives at a boundary: the last minute of a day, midnight,
 * the clocks changing, the end of a month, the end of a year. A planner that
 * is one day out is worse than no planner, because it is confidently wrong.
 *
 * The rule LockIn follows, and these tests pin down: **everything is local
 * time**. A due date is the date on the student's wall, not a UTC instant, so
 * a deadline at 23:59 is 23:59 wherever they are.
 *
 * Run: npm run test:time
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const { addDaysISO, daysUntil, parseDueDate, todayISO, formatDaysRemaining } = await import(
  '../../web/src/lib/time.ts'
);
const { defaultState, load, save } = await import('../../web/src/lib/storage.ts');
const { reducer } = await import('../../web/src/store/reducer.ts');
const { createAssignment, createExam } = await import('../../web/src/store/factories.ts');
const { buildPlan } = await import('../../web/src/lib/planner/index.ts');
const { dueSoon, overdue, dueTimestamp, autoBlockEarnedUntil, blockingActive } = await import(
  '../../web/src/lib/selectors.ts'
);

/* ------------------------------------------------------------------ */
/* Parsing and arithmetic                                              */
/* ------------------------------------------------------------------ */

test('a due date is a local wall-clock time, not a UTC instant', () => {
  const due = parseDueDate('2026-09-01', '23:59');
  assert.equal(due.getFullYear(), 2026);
  assert.equal(due.getMonth(), 8);
  assert.equal(due.getDate(), 1);
  assert.equal(due.getHours(), 23, 'a 23:59 deadline must be 23:59 on the student’s clock');
  assert.equal(due.getMinutes(), 59);
});

test('a missing due time defaults to the end of the day, never the start', () => {
  const implied = parseDueDate('2026-09-01', undefined);
  assert.equal(implied.getHours(), 23);
  assert.equal(implied.getMinutes(), 59);

  // The alternative — defaulting to midnight — would mark work overdue for the
  // whole of the day it is actually due.
  const now = new Date(2026, 8, 1, 12, 0, 0);
  assert.ok(implied.getTime() > now.getTime(), 'undated-time work is not overdue at lunchtime');

  for (const junk of ['', 'noon', '25:00', '12:99', '::']) {
    const fallback = parseDueDate('2026-09-01', junk);
    assert.ok(fallback === null || fallback.getHours() === 23, `"${junk}" must not invent a time`);
  }
});

test('impossible dates are refused rather than rolled over', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2027-02-29', 'not-a-date', '']) {
    assert.equal(parseDueDate(bad, '12:00'), null, `${bad} must not parse`);
  }
  assert.ok(parseDueDate('2028-02-29', '12:00'), 'a real leap day must parse');
});

test('day counting crosses month and year boundaries correctly', () => {
  // Month boundary, including a 31-day month into a 30-day one.
  assert.equal(daysUntil('2026-09-01', new Date(2026, 7, 31, 12, 0)), 1);
  assert.equal(daysUntil('2026-08-31', new Date(2026, 8, 1, 12, 0)), -1);
  // Year boundary.
  assert.equal(daysUntil('2027-01-01', new Date(2026, 11, 31, 23, 30)), 1);
  assert.equal(daysUntil('2026-12-31', new Date(2027, 0, 1, 0, 30)), -1);
  // Leap year.
  assert.equal(daysUntil('2028-03-01', new Date(2028, 1, 29, 9, 0)), 1);
});

test('“today” is the same day at 00:00 and at 23:59', () => {
  const midnight = new Date(2026, 8, 1, 0, 0, 0);
  const lastMinute = new Date(2026, 8, 1, 23, 59, 59);
  assert.equal(todayISO(midnight), '2026-09-01');
  assert.equal(todayISO(lastMinute), '2026-09-01');
  assert.equal(daysUntil('2026-09-01', midnight), 0);
  assert.equal(
    daysUntil('2026-09-01', lastMinute),
    0,
    'work due today is still due today one minute before midnight',
  );
  assert.equal(formatDaysRemaining(0), 'Today');
});

test('adding days survives a daylight-saving change in both directions', () => {
  // US DST: spring forward 2026-03-08, fall back 2026-11-01. A naive
  // "+86,400,000 ms" implementation lands on the wrong date on exactly these
  // two days, in whichever hemisphere the machine happens to be.
  const springForward = ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'];
  const fallBack = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];

  for (const dates of [springForward, fallBack]) {
    for (let i = 0; i < dates.length - 1; i += 1) {
      assert.equal(
        addDaysISO(dates[i], 1),
        dates[i + 1],
        `${dates[i]} + 1 day must be ${dates[i + 1]}`,
      );
      assert.equal(addDaysISO(dates[i + 1], -1), dates[i]);
    }
  }
  // And the same across the European changeover dates.
  assert.equal(addDaysISO('2026-03-29', 1), '2026-03-30');
  assert.equal(addDaysISO('2026-10-25', 1), '2026-10-26');
});

test('adding days is exact over long spans, including across a year', () => {
  let date = '2026-01-01';
  for (let i = 0; i < 365; i += 1) date = addDaysISO(date, 1);
  assert.equal(date, '2027-01-01', '365 single steps from 2026-01-01 land on 2027-01-01');
  assert.equal(addDaysISO('2026-01-01', 365), '2027-01-01', 'and one big step agrees');
});

/* ------------------------------------------------------------------ */
/* Selectors at the boundary                                           */
/* ------------------------------------------------------------------ */

function withAssignment(dueDate, dueTime = '23:59') {
  let state = defaultState();
  state = reducer(state, { type: 'CREATE_PROFILE', firstName: 'Sam' });
  return reducer(state, {
    type: 'ADD_ASSIGNMENT',
    assignment: createAssignment({
      title: 'Essay',
      subject: 'English',
      platform: 'Other',
      dueDate,
      dueTime,
      estimatedMinutes: 60,
      priority: 'Normal',
    }),
  });
}

test('work due at 23:59 is not overdue at 23:58, and is at 00:00', () => {
  const state = withAssignment('2026-09-01', '23:59');
  assert.equal(overdue(state, new Date(2026, 8, 1, 23, 58, 0)).length, 0);
  assert.equal(overdue(state, new Date(2026, 8, 2, 0, 0, 1)).length, 1);
});

test('an assignment with no due date sorts last but is never hidden', () => {
  const state = withAssignment('', '23:59');
  assert.equal(dueTimestamp(state.assignments[0]), Number.MAX_SAFE_INTEGER);
  assert.equal(
    dueSoon(state, 2, new Date(2026, 8, 1)).length,
    1,
    'undated work must still appear — it is not finished, it is just unscheduled',
  );
  assert.equal(overdue(state, new Date(2030, 0, 1)).length, 0, 'and it is never “overdue”');
});

/* ------------------------------------------------------------------ */
/* The planner at the boundary                                         */
/* ------------------------------------------------------------------ */

/**
 * A configured state, ready to plan. `buildPlan` takes the whole AppState, so
 * these tests drive the same entry point the reducer does.
 */
function plannable(assignments = [], exams = []) {
  const base = defaultState();
  return {
    ...base,
    profile: { firstName: 'Sam', onboarded: true, createdAt: '2026-01-01T00:00:00.000Z' },
    assignments,
    exams,
    planner: { ...base.planner, settings: { ...base.planner.settings, configured: true } },
  };
}

function assignmentDue(dueDate, dueTime = '23:59', minutes = 60) {
  return createAssignment({
    title: `Due ${dueDate}`,
    subject: 'Math',
    platform: 'Other',
    dueDate,
    dueTime,
    estimatedMinutes: minutes,
    priority: 'Normal',
  });
}

test('a plan generated at 23:59 covers today, not yesterday', () => {
  const now = new Date(2026, 8, 1, 23, 59, 0);
  const plan = buildPlan(plannable([assignmentDue('2026-09-04')]), 'initial', now);
  assert.equal(plan.planningHorizonStart, '2026-09-01', 'the horizon starts on today’s date');
  assert.ok(plan.days.length > 0);
  assert.equal(plan.days[0].date, '2026-09-01');
});

test('a plan generated at 00:00 covers the new day', () => {
  const now = new Date(2026, 8, 2, 0, 0, 0);
  const plan = buildPlan(plannable([assignmentDue('2026-09-05')]), 'initial', now);
  assert.equal(plan.planningHorizonStart, '2026-09-02');
});

test('planning across a month and a year boundary produces contiguous days', () => {
  for (const now of [new Date(2026, 7, 28, 9, 0), new Date(2026, 11, 28, 9, 0)]) {
    const plan = buildPlan(plannable([assignmentDue(addDaysISO(todayISO(now), 10))]), 'initial', now);
    for (let i = 1; i < plan.days.length; i += 1) {
      assert.equal(
        plan.days[i].date,
        addDaysISO(plan.days[i - 1].date, 1),
        `a gap or repeat appeared at ${plan.days[i - 1].date} → ${plan.days[i].date}`,
      );
    }
  }
});

test('planning across a DST change produces contiguous days', () => {
  for (const now of [new Date(2026, 2, 6, 9, 0), new Date(2026, 9, 30, 9, 0)]) {
    const plan = buildPlan(plannable([assignmentDue(addDaysISO(todayISO(now), 7))]), 'initial', now);
    const dates = plan.days.map((d) => d.date);
    assert.equal(new Set(dates).size, dates.length, 'a day was planned twice across the change');
    for (let i = 1; i < dates.length; i += 1) {
      assert.equal(dates[i], addDaysISO(dates[i - 1], 1));
    }
  }
});

test('an exam today is still schedulable; an exam yesterday is not planned for', () => {
  const now = new Date(2026, 8, 1, 8, 0);
  const today = todayISO(now);

  const examToday = createExam({
    name: 'Bio Final',
    subject: 'Science',
    examDate: today,
    materialAmount: 'Medium',
  });
  const planToday = buildPlan(plannable([], [examToday]), 'initial', now);
  const todayItems = planToday.days
    .flatMap((d) => d.items)
    .filter((i) => i.sourceType === 'exam');
  for (const item of todayItems) {
    assert.ok(
      item.scheduledDate <= today,
      'study for an exam happening today cannot be scheduled after it',
    );
  }

  const examPast = createExam({
    name: 'Old Test',
    subject: 'Science',
    examDate: addDaysISO(today, -3),
    materialAmount: 'Medium',
  });
  const planPast = buildPlan(plannable([], [examPast]), 'initial', now);
  assert.equal(
    planPast.days.flatMap((d) => d.items).filter((i) => i.sourceType === 'exam').length,
    0,
    'a finished exam must not keep consuming study time',
  );
});

test('overdue work is scheduled rather than being dropped for having no future', () => {
  const now = new Date(2026, 8, 10, 9, 0);
  const today = todayISO(now);
  const plan = buildPlan(plannable([assignmentDue(addDaysISO(today, -5))]), 'initial', now);
  const items = plan.days.flatMap((d) => d.items);
  assert.ok(items.length > 0, 'late homework must still be planned; it is the most urgent thing');
  assert.ok(
    items.every((i) => i.scheduledDate >= today),
    'and it is planned from today onward, never into the past',
  );
});

/* ------------------------------------------------------------------ */
/* A clock that moves                                                  */
/* ------------------------------------------------------------------ */

test('a system clock jumping backwards does not corrupt the store', () => {
  store.clear();
  let state = withAssignment('2026-09-05');
  state = reducer(state, { type: 'PLANNER_UPDATE_SETTINGS', patch: { configured: true } });
  state = reducer(state, { type: 'PLANNER_REBUILD' });
  const versionBefore = state.planner.plan?.planVersion ?? 0;

  // Two years into the past, then a tick — the shape a manual clock change or
  // a dead CMOS battery produces.
  const past = new Date(2024, 0, 1, 12, 0).getTime();
  state = reducer(state, { type: 'TICK', now: past });

  assert.ok(save(state), 'the state still saves');
  const reloaded = load();
  assert.equal(reloaded.assignments.length, 1, 'no homework was lost');
  assert.equal(reloaded.assignments[0].title, 'Essay');
  assert.ok((reloaded.planner.plan?.planVersion ?? 0) >= versionBefore, 'no version went backwards');
  assert.ok(
    reloaded.planner.plan === null || reloaded.planner.plan.days.length > 0,
    'the plan is either absent or usable, never a husk',
  );
});

test('a system clock jumping forwards does not corrupt the store or lose work', () => {
  store.clear();
  let state = withAssignment('2026-09-05');
  state = reducer(state, { type: 'PLANNER_UPDATE_SETTINGS', patch: { configured: true } });
  state = reducer(state, { type: 'PLANNER_REBUILD' });

  const future = new Date(2030, 0, 1, 12, 0).getTime();
  state = reducer(state, { type: 'TICK', now: future });

  assert.ok(save(state));
  const reloaded = load();
  assert.equal(reloaded.assignments.length, 1);
  assert.equal(
    reloaded.assignments[0].loggedMinutes,
    0,
    'a clock jump must not invent or destroy logged time',
  );
  assert.equal(reloaded.assignments[0].status, 'Not Started', 'nor complete anything');
});

test('a clock jump during Focus Mode cannot silently unlock it', () => {
  let state = withAssignment('2026-09-05');
  const id = state.assignments[0].id;
  state = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  assert.equal(state.focusMode.active, true);

  state = reducer(state, { type: 'TICK', now: new Date(2030, 0, 1).getTime() });
  assert.equal(
    state.focusMode.active,
    true,
    'Focus Mode ends when the work is done, not when the clock says so',
  );
  assert.equal(state.assignments[0].status, 'Not Started');
});

test('a temporary unlock still expires when the clock jumps forward', () => {
  let state = withAssignment('2026-09-05');
  const id = state.assignments[0].id;
  state = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  state = reducer(state, { type: 'TEMPORARY_UNLOCK', minutes: 10 });
  assert.ok(state.focusMode.temporaryUnlockUntil > Date.now());

  state = reducer(state, { type: 'TICK', now: new Date(2030, 0, 1).getTime() });
  assert.ok(
    state.focusMode.temporaryUnlockUntil === null ||
      state.focusMode.temporaryUnlockUntil <= new Date(2030, 0, 1).getTime(),
    'an unlock must not outlive a forward jump — blocking has to come back',
  );
});


/* ------------------------------------------------------------------ */
/* Finishing unlocks — in the student's own timezone                   */
/* ------------------------------------------------------------------ */

/**
 * `endedAt` is a UTC ISO string. Comparing its first ten characters to the
 * local date was correct only while the two agreed — that is, until about 5pm
 * in the Americas, every single day. From then until midnight, which is
 * exactly when homework happens, finishing your work stopped unlocking
 * anything and the block page's promise was quietly false.
 */
function stateWithRun(endedAt) {
  const base = defaultState();
  return {
    ...base,
    settings: { ...base.settings, blockingEnabled: true, blockedDomains: ['youtube.com'] },
    focusRuns: [
      { id: 'run_1', startedAt: endedAt, endedAt, outcome: 'completed', requiredCount: 1, completedCount: 1 },
    ],
  };
}

test('a run finished this evening counts as today, whatever UTC calls it', () => {
  // 6:30pm local. In the Americas that is already tomorrow in UTC.
  const now = new Date();
  now.setHours(18, 30, 0, 0);
  const endedAt = new Date(now.getTime() - 5 * 60_000).toISOString();
  const earned = autoBlockEarnedUntil(stateWithRun(endedAt), now.getTime());
  assert.notEqual(earned, null, 'finishing at 6:30pm must unlock the rest of the evening');
  assert.ok(earned > now.getTime());
});

test('and it unlocks until local midnight, not UTC midnight', () => {
  const now = new Date();
  now.setHours(18, 30, 0, 0);
  const earned = autoBlockEarnedUntil(stateWithRun(now.toISOString()), now.getTime());
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  assert.equal(earned, midnight.getTime());
});

test('a run finished yesterday evening does not unlock today', () => {
  const now = new Date();
  now.setHours(18, 30, 0, 0);
  const yesterday = new Date(now.getTime() - 24 * 3600_000);
  assert.equal(autoBlockEarnedUntil(stateWithRun(yesterday.toISOString()), now.getTime()), null);
});

test('an evening finish actually stands automatic blocking down', () => {
  const now = new Date();
  now.setHours(18, 30, 0, 0);
  const state = stateWithRun(now.toISOString());
  assert.equal(
    blockingActive(state, now.getTime()),
    false,
    'the block page promises this, so it has to be true at 6:30pm too',
  );
});
