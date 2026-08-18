/**
 * Performance with a realistically heavy dataset (Phase 8).
 *
 * The numbers matter less than the shape: these are budgets, not benchmarks,
 * and they exist to catch the change that turns a linear pass into a quadratic
 * one. They are set well above the measured times so an ordinary laptop under
 * load does not fail a release for being busy.
 *
 * The dataset is the one from the Phase 8 brief: 100 assignments, 20 exams,
 * 300 activity events, 100 verification records, a 30-day plan.
 *
 * Run: npm run test:perf
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
// `toBridgeState` reads `window.location.origin` for the "Open LockIn" URL.
globalThis.window = { location: { origin: 'http://localhost:5173' } };

const { defaultState, load, save } = await import('../../web/src/lib/storage.ts');
const { reducer } = await import('../../web/src/store/reducer.ts');
const { createAssignment, createExam } = await import('../../web/src/store/factories.ts');
const { buildPlan, livePlan, selectTodayPlan, selectWeekLoad } = await import(
  '../../web/src/lib/planner/index.ts'
);
const {
  selectWeeklySummary,
  selectOverrideHistory,
  selectFocusHistory,
  selectRecentVerifications,
  selectDailySeries,
} = await import('../../web/src/lib/parent/selectors.ts');
const { dueSoon, overdue, toBridgeState } = await import('../../web/src/lib/selectors.ts');
const { addDaysISO, todayISO } = await import('../../web/src/lib/time.ts');

/** Median of `runs` timings, so one scheduling hiccup cannot fail a release. */
function timeIt(label, runs, fn) {
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`      ${label}: ${median.toFixed(1)}ms (median of ${runs})`);
  return median;
}

/* ------------------------------------------------------------------ */
/* The heavy dataset                                                   */
/* ------------------------------------------------------------------ */

const SUBJECTS = ['Math', 'English', 'Science', 'History', 'Spanish', 'Art'];
const today = todayISO();

function heavyState() {
  let state = defaultState();
  state = reducer(state, { type: 'CREATE_PROFILE', firstName: 'Sam' });

  const assignments = Array.from({ length: 100 }, (_, i) =>
    createAssignment({
      title: `Assignment ${i + 1} — a fairly long realistic homework title`,
      subject: SUBJECTS[i % SUBJECTS.length],
      platform: i % 3 === 0 ? 'Canvas' : i % 3 === 1 ? 'Edgenuity' : 'Other',
      // Spread across the past week and the next month, so some are overdue.
      dueDate: addDaysISO(today, (i % 40) - 7),
      dueTime: '23:59',
      estimatedMinutes: 20 + (i % 5) * 15,
      priority: i % 7 === 0 ? 'Urgent' : i % 3 === 0 ? 'Important' : 'Normal',
    }),
  ).map((a, i) => ({
    ...a,
    loggedMinutes: i % 4 === 0 ? 15 : 0,
    status: i % 9 === 0 ? 'Completed' : a.status,
    // 100 verification records, spread over the assignments that have them.
    verificationRecords:
      i % 10 === 0
        ? Array.from({ length: 10 }, (_, r) => ({
            id: `ver_${i}_${r}`,
            type: 'canvas_submission',
            timestamp: new Date(Date.now() - r * 3600_000).toISOString(),
            status: 'verified',
            sourceDomain: 'myschool.instructure.com',
          }))
        : [],
  }));

  const exams = Array.from({ length: 20 }, (_, i) =>
    createExam({
      name: `Exam ${i + 1}`,
      subject: SUBJECTS[i % SUBJECTS.length],
      examDate: addDaysISO(today, 3 + i * 2),
      materialAmount: ['Light', 'Medium', 'Heavy'][i % 3],
    }),
  );

  const activity = Array.from({ length: 300 }, (_, i) => ({
    id: `evt_${i}`,
    type: i % 5 === 0 ? 'focus_mode_ended' : 'plan_generated',
    timestamp: new Date(Date.now() - i * 60_000).toISOString(),
    message: `Event ${i}`,
  }));

  const focusRuns = Array.from({ length: 100 }, (_, i) => ({
    id: `run_${i}`,
    startedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    endedAt: new Date(Date.now() - i * 86_400_000 + 3600_000).toISOString(),
    requiredTaskIds: [],
    requiredCount: 2,
    completedCount: i % 3 === 0 ? 1 : 2,
    outcome: i % 7 === 0 ? 'override' : 'completed',
    isTest: false,
    unlocks: [],
    blocked: [{ domain: 'youtube.com', count: i }],
    blockBaseline: [],
  }));

  return {
    ...state,
    assignments,
    exams,
    activity,
    focusRuns,
    completedSessions: Array.from({ length: 200 }, (_, i) => ({
      id: `ses_${i}`,
      assignmentId: assignments[i % assignments.length].id,
      examId: null,
      assignmentTitle: assignments[i % assignments.length].title,
      plannedMinutes: 25,
      actualMinutes: 25,
      startedAt: new Date(Date.now() - i * 3600_000).toISOString(),
      endedAt: new Date(Date.now() - i * 3600_000 + 1500_000).toISOString(),
    })),
    planner: {
      ...state.planner,
      settings: { ...state.planner.settings, configured: true, horizonDays: 30 },
    },
  };
}

const heavy = heavyState();

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

test('the planner builds a 30-day plan for 100 assignments and 20 exams quickly', () => {
  const median = timeIt('planner buildPlan', 20, () => buildPlan(heavy, 'initial'));
  assert.ok(median < 400, `planning took ${median.toFixed(1)}ms; the budget is 400ms`);
});

test('planner rebuilds are not quadratic in the number of assignments', () => {
  const measure = (count) => {
    const subset = { ...heavy, assignments: heavy.assignments.slice(0, count) };
    return timeIt(`buildPlan with ${count} assignments`, 15, () => buildPlan(subset, 'initial'));
  };
  const small = Math.max(measure(25), 0.5);
  const large = measure(100);

  // 4× the input. Quadratic would be ~16×; a generous 10× still catches it
  // while tolerating fixed per-run overhead dominating the small case.
  assert.ok(
    large / small < 10,
    `4× the assignments cost ${(large / small).toFixed(1)}× the time — that looks super-linear`,
  );
});

test('reading a plan for the UI is cheap enough to do on every render', () => {
  const state = { ...heavy, planner: { ...heavy.planner, plan: buildPlan(heavy, 'initial') } };

  const live = timeIt('livePlan', 50, () => livePlan(state));
  const todayPlan = timeIt('selectTodayPlan', 50, () => selectTodayPlan(state));
  const week = timeIt('selectWeekLoad', 50, () => selectWeekLoad(state));

  // These run inside components that re-render on the 1Hz clock, so they have
  // to stay far below a frame.
  assert.ok(live < 16, `livePlan took ${live.toFixed(1)}ms; the budget is one frame (16ms)`);
  assert.ok(todayPlan < 16, `selectTodayPlan took ${todayPlan.toFixed(1)}ms`);
  assert.ok(week < 16, `selectWeekLoad took ${week.toFixed(1)}ms`);
});

test('the dashboard and assignment-list selectors stay well inside a frame', () => {
  const soon = timeIt('dueSoon', 100, () => dueSoon(heavy, 2));
  const late = timeIt('overdue', 100, () => overdue(heavy));
  const bridge = timeIt('toBridgeState', 100, () => toBridgeState(heavy));

  assert.ok(soon < 16, `dueSoon took ${soon.toFixed(1)}ms`);
  assert.ok(late < 16, `overdue took ${late.toFixed(1)}ms`);
  // `toBridgeState` is stringified on every state change to decide whether to
  // push to the extension, so it is on the hottest path in the app.
  assert.ok(bridge < 16, `toBridgeState took ${bridge.toFixed(1)}ms`);
});

test('the parent dashboard renders a long history without stalling', () => {
  const weekly = timeIt('selectWeeklySummary', 30, () => selectWeeklySummary(heavy));
  const overrides = timeIt('selectOverrideHistory', 30, () => selectOverrideHistory(heavy));
  const focus = timeIt('selectFocusHistory', 30, () => selectFocusHistory(heavy));
  const verifications = timeIt('selectRecentVerifications', 30, () => selectRecentVerifications(heavy));
  const series = timeIt('selectDailySeries', 30, () => selectDailySeries(heavy));

  // The dashboard runs all five on one screen, so the sum is what a parent
  // actually waits for.
  const total = weekly + overrides + focus + verifications + series;
  assert.ok(total < 100, `the parent dashboard's selectors total ${total.toFixed(1)}ms`);
});

test('a heavy state saves and reloads in well under a second', () => {
  const state = { ...heavy, planner: { ...heavy.planner, plan: buildPlan(heavy, 'initial') } };

  const write = timeIt('save', 10, () => save(state));
  const read = timeIt('load (parse + migrate + coerce)', 10, () => load());

  assert.ok(write < 200, `save took ${write.toFixed(1)}ms`);
  assert.ok(read < 300, `load took ${read.toFixed(1)}ms — this runs before first paint`);
});

test('a heavy state stays far inside the localStorage budget', () => {
  const state = { ...heavy, planner: { ...heavy.planner, plan: buildPlan(heavy, 'initial') } };
  const bytes = JSON.stringify(state).length;
  console.log(`      stored size: ${(bytes / 1024).toFixed(0)} KB`);
  // Browsers give a page roughly 5 MB. The retention caps exist to keep this
  // from growing without bound; 2 MB leaves room for a much heavier year.
  assert.ok(bytes < 2_000_000, `the heavy state is ${(bytes / 1024).toFixed(0)} KB`);
});
