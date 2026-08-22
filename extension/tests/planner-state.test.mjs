/**
 * The planner as it lives in the store: settings persistence, generated plans,
 * versioning, manual ordering, skips, completion, replan triggers and the
 * v5 → v6 migration — all through the real reducer and the real storage layer.
 *
 * The tests that matter most are the ones a plausible implementation gets
 * wrong: that a migration keeps every Phase 1–6 record, that finishing work
 * removes its future chunks whatever finished it, that unfinished minutes
 * survive a missed day, and that a plan does not rebuild itself forever.
 *
 * Run: npm run test:planner-state
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

const { reducer } = await import('../../web/src/store/reducer.ts');
const { createAssignment, createExam } = await import('../../web/src/store/factories.ts');
const { defaultState, load, save, SCHEMA_VERSION, STORAGE_KEY } = await import(
  '../../web/src/lib/storage.ts'
);
const { defaultPlannerSettings } = await import('../../web/src/types/planner.ts');
const { livePlan, selectTodayPlan, selectExamProgress, selectWeekLoad } = await import(
  '../../web/src/lib/planner/index.ts'
);
const { addDaysISO, todayISO } = await import('../../web/src/lib/time.ts');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const D = (offset) => addDaysISO(todayISO(), offset);

/** A configured planner with generous, predictable availability. */
function configured(base = defaultState()) {
  let next = reducer(base, {
    type: 'PLANNER_UPDATE_SETTINGS',
    patch: {
      availability: defaultPlannerSettings().availability.map((row) => ({
        ...row,
        available: true,
        restDay: false,
        startTime: '00:00',
        endTime: '23:59',
        maxMinutes: 240,
      })),
      weekdayMaxMinutes: 240,
      weekendMaxMinutes: 240,
      bufferPercent: 0,
      workloadPreference: 'Intensive',
    },
  });
  next = reducer(next, { type: 'PLANNER_REBUILD' });
  return next;
}

function withAssignment(state, over = {}) {
  const assignment = createAssignment({
    title: over.title ?? 'Math Worksheet',
    subject: over.subject ?? 'Math',
    platform: over.platform ?? 'Other',
    dueDate: over.dueDate ?? D(1),
    dueTime: '23:59',
    estimatedMinutes: over.estimatedMinutes ?? 60,
    priority: over.priority ?? 'Normal',
  });
  return { state: reducer(state, { type: 'ADD_ASSIGNMENT', assignment }), id: assignment.id };
}

function withExam(state, over = {}) {
  const exam = createExam({
    name: over.name ?? 'Biology Exam',
    subject: over.subject ?? 'Biology',
    examDate: over.examDate ?? D(4),
    materialAmount: over.materialAmount ?? 'Medium',
    studyEstimateMinutes: over.studyEstimateMinutes,
  });
  return { state: reducer(state, { type: 'ADD_EXAM', exam }), id: exam.id };
}

const itemsFor = (state, sourceId) =>
  (state.planner.plan?.days ?? []).flatMap((d) => d.items).filter((i) => i.sourceId === sourceId);
const minutesFor = (state, sourceId) =>
  itemsFor(state, sourceId).reduce((sum, i) => sum + i.plannedMinutes, 0);

/* ------------------------------------------------------------------ */
/* Settings and plan creation                                          */
/* ------------------------------------------------------------------ */

test('no plan exists until the student asks for one', () => {
  const { state } = withAssignment(defaultState());
  assert.equal(state.planner.plan, null, 'defaults nobody saw must not become a schedule');
  assert.equal(state.planner.settings.configured, false);

  const built = reducer(state, { type: 'PLANNER_REBUILD' });
  assert.ok(built.planner.plan);
  assert.equal(built.planner.settings.configured, true);
  assert.equal(built.planner.plan.reason, 'initial');
});

test('planner settings persist and are repaired on the way back in', () => {
  const state = reducer(defaultState(), {
    type: 'PLANNER_UPDATE_SETTINGS',
    patch: { weekdayMaxMinutes: 90, bufferPercent: 25, minChunkMinutes: 40, maxChunkMinutes: 20 },
  });
  // Crossed chunk sizes are fixed rather than trusted.
  assert.equal(state.planner.settings.maxChunkMinutes, 40);

  save(state);
  const loaded = load();
  assert.equal(loaded.planner.settings.weekdayMaxMinutes, 90);
  assert.equal(loaded.planner.settings.bufferPercent, 25);
  assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
  store.clear();
});

test('a nonsense availability row falls back instead of producing negative capacity', () => {
  const broken = {
    ...defaultState(),
    planner: {
      ...defaultState().planner,
      settings: {
        ...defaultPlannerSettings(),
        availability: defaultPlannerSettings().availability.map((row) =>
          row.weekday === 1 ? { ...row, startTime: '20:00', endTime: '08:00' } : row,
        ),
      },
    },
  };
  save(broken);
  const loaded = load();
  const monday = loaded.planner.settings.availability.find((r) => r.weekday === 1);
  assert.ok(monday.endTime > monday.startTime);
  store.clear();
});

test('changing availability rebuilds the plan and records the reason', () => {
  const { state } = withAssignment(configured(), { estimatedMinutes: 90, dueDate: D(3) });
  const before = state.planner.plan.planVersion;
  const after = reducer(state, {
    type: 'PLANNER_UPDATE_SETTINGS',
    patch: {
      availability: state.planner.settings.availability.map((row) => ({
        ...row,
        maxMinutes: 30,
      })),
    },
  });
  assert.ok(after.planner.plan.planVersion > before);
  assert.equal(after.planner.plan.reason, 'availability_changed');
});

/* ------------------------------------------------------------------ */
/* Replan triggers                                                     */
/* ------------------------------------------------------------------ */

test('adding an assignment replans; the version and history advance', () => {
  const base = configured();
  const { state } = withAssignment(base, { estimatedMinutes: 45 });
  assert.ok(state.planner.plan.planVersion > base.planner.plan.planVersion);
  assert.equal(state.planner.plan.reason, 'assignment_added');
  assert.equal(state.planner.history[0].planVersion, state.planner.plan.planVersion);
  assert.ok(minutesFor(state, 'x') === 0);
});

test('an unrelated action does not rebuild the plan', () => {
  const { state } = withAssignment(configured(), { estimatedMinutes: 45 });
  const version = state.planner.plan.planVersion;

  const ticked = reducer(state, { type: 'TICK', now: Date.now() });
  assert.equal(ticked.planner.plan.planVersion, version, 'a tick is not a reason to replan');

  const themed = reducer(state, { type: 'UPDATE_SETTINGS', patch: { theme: 'dark' } });
  assert.equal(themed.planner.plan.planVersion, version);
});

test('a no-op change keeps the identical plan object — no rebuild loop', () => {
  const { state, id } = withAssignment(configured(), { estimatedMinutes: 45 });
  const version = state.planner.plan.planVersion;
  // Touching a field the planner does not read must not produce a new plan.
  const renamed = reducer(state, {
    type: 'UPDATE_ASSIGNMENT',
    id,
    patch: { title: 'Math Worksheet' },
  });
  assert.equal(renamed.planner.plan.planVersion, version);
  assert.equal(renamed.planner.plan, state.planner.plan, 'same object identity');
  assert.equal(renamed.planner.history.length, state.planner.history.length);
});

test('history is capped and never stores whole old plans', () => {
  let state = configured();
  for (let i = 0; i < 30; i += 1) {
    state = withAssignment(state, { title: `Task ${i}`, estimatedMinutes: 30 + i, dueDate: D(3) }).state;
  }
  assert.ok(state.planner.history.length <= 20);
  for (const entry of state.planner.history) {
    assert.deepEqual(Object.keys(entry).sort(), [
      'generatedAt',
      'itemCount',
      'plannedMinutes',
      'planVersion',
      'reason',
      'warningCount',
    ].sort());
  }
});

/* ------------------------------------------------------------------ */
/* Completion                                                          */
/* ------------------------------------------------------------------ */

test('completing an assignment removes its remaining chunks', () => {
  const { state, id } = withAssignment(configured(), { estimatedMinutes: 150, dueDate: D(4) });
  assert.ok(itemsFor(state, id).length > 1);

  const done = reducer(state, { type: 'COMPLETE_ASSIGNMENT', id, method: 'manual' });
  assert.equal(itemsFor(done, id).length, 0);
  assert.equal(done.planner.plan.reason, 'assignment_completed');
});

test('Canvas verification removes chunks through the same path', () => {
  let state = configured();
  state = reducer(state, {
    type: 'CANVAS_CONNECT',
    domain: 'school.instructure.com',
    permissionGranted: true,
  });
  const detected = {
    externalCourseId: '1',
    externalAssignmentId: '99',
    title: 'Canvas Essay',
    courseName: 'English',
    dueAt: new Date(`${D(3)}T23:59:00`).toISOString(),
    submissionStatus: 'not_submitted',
    url: 'https://school.instructure.com/courses/1/assignments/99',
    detectedAt: new Date().toISOString(),
  };
  state = reducer(state, { type: 'CANVAS_IMPORT', items: [detected] });
  const assignment = state.assignments.find((a) => a.title === 'Canvas Essay');
  assert.ok(assignment);
  assert.ok(itemsFor(state, assignment.id).length > 0, 'Canvas work is planned');

  const submitted = reducer(state, {
    type: 'CANVAS_DETECTED',
    detected: [{ ...detected, submissionStatus: 'submitted' }],
    seenAt: new Date().toISOString(),
  });
  assert.equal(submitted.assignments.find((a) => a.id === assignment.id).status, 'Completed');
  assert.equal(itemsFor(submitted, assignment.id).length, 0, 'future chunks disappear');
});

test('deleting an assignment removes its chunks and its skips', () => {
  const { state, id } = withAssignment(configured(), { estimatedMinutes: 90, dueDate: D(4) });
  const skipped = reducer(state, {
    type: 'PLANNER_SKIP_ITEM',
    sourceType: 'assignment',
    sourceId: id,
    date: D(0),
  });
  assert.equal(skipped.planner.skips.length, 1);

  const deleted = reducer(skipped, { type: 'DELETE_ASSIGNMENT', id });
  assert.equal(itemsFor(deleted, id).length, 0);
  assert.equal(deleted.planner.skips.length, 0);
});

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

test('a focus session logs minutes and shrinks the remaining plan', () => {
  const { state, id } = withAssignment(configured(), { estimatedMinutes: 120, dueDate: D(4) });
  const planned = minutesFor(state, id);
  assert.equal(planned, 120);

  let running = reducer(state, { type: 'START_SESSION', assignmentId: id, minutes: 45 });
  assert.equal(running.assignments.find((a) => a.id === id).status, 'In Progress');
  // Rewind the clock so the session records real elapsed minutes.
  running = {
    ...running,
    activeSession: {
      ...running.activeSession,
      runningSince: new Date(Date.now() - 30 * 60_000).toISOString(),
    },
  };
  const ended = reducer(running, { type: 'END_SESSION' });
  assert.equal(ended.assignments.find((a) => a.id === id).loggedMinutes, 30);
  assert.equal(minutesFor(ended, id), 90, 'exactly the remainder stays planned');
  assert.equal(ended.planner.plan.reason, 'session_logged');
});

test('an exam session credits the exam, not an assignment', () => {
  const { state, id } = withExam(configured(), { materialAmount: 'Medium', examDate: D(6) });
  let running = reducer(state, {
    type: 'START_SESSION',
    assignmentId: null,
    examId: id,
    minutes: 30,
  });
  assert.equal(running.activeSession.examId, id);
  running = {
    ...running,
    activeSession: {
      ...running.activeSession,
      runningSince: new Date(Date.now() - 30 * 60_000).toISOString(),
    },
  };
  const ended = reducer(running, { type: 'END_SESSION' });
  assert.equal(ended.exams.find((e) => e.id === id).loggedMinutes, 30);
  assert.equal(ended.completedSessions[0].examId, id);
  assert.equal(minutesFor(ended, id), 150, '180 recommended minus 30 done');

  const progress = selectExamProgress(ended).find((e) => e.examId === id);
  assert.equal(progress.completedMinutes, 30);
  assert.equal(progress.remainingMinutes, 150);
});

/* ------------------------------------------------------------------ */
/* Skips, ordering and locking                                         */
/* ------------------------------------------------------------------ */

test('"can\'t do this today" needs no PIN and loses no minutes', () => {
  const { state, id } = withAssignment(configured(), { estimatedMinutes: 60, dueDate: D(4) });
  const before = minutesFor(state, id);
  const today = selectTodayPlan(state);
  assert.ok(today.items.length > 0);

  const skipped = reducer(state, {
    type: 'PLANNER_SKIP_ITEM',
    sourceType: 'assignment',
    sourceId: id,
    date: todayISO(),
  });
  assert.equal(selectTodayPlan(skipped).items.length, 0);
  assert.equal(minutesFor(skipped, id), before, 'the work moved, it did not vanish');
  assert.equal(skipped.parentPin, null, 'no PIN was involved');
});

test('manual ordering is applied immediately and survives until a rebuild', () => {
  let state = configured();
  state = withAssignment(state, { title: 'Math', estimatedMinutes: 30, dueDate: D(1) }).state;
  state = withAssignment(state, {
    title: 'English',
    subject: 'English',
    estimatedMinutes: 30,
    dueDate: D(1),
  }).state;

  const today = selectTodayPlan(state);
  assert.equal(today.items.length, 2);
  const reversed = [...today.items].reverse().map((i) => `assignment:${i.sourceId}`);

  const ordered = reducer(state, {
    type: 'PLANNER_SET_ORDER',
    date: todayISO(),
    order: reversed,
  });
  assert.deepEqual(
    selectTodayPlan(ordered).items.map((i) => `assignment:${i.sourceId}`),
    reversed,
  );
  assert.equal(ordered.planner.manualOrders[0].date, todayISO());

  // A later rebuild keeps the student's ordering rather than undoing it.
  const rebuilt = reducer(ordered, { type: 'PLANNER_REBUILD' });
  assert.deepEqual(
    selectTodayPlan(rebuilt).items.map((i) => `assignment:${i.sourceId}`),
    reversed,
  );
});

test('dragging a study block moves it between days without losing minutes', () => {
  const { state, id } = withAssignment(configured(), { estimatedMinutes: 90, dueDate: D(4) });
  const plan = state.planner.plan;
  const from = plan.days.find((day) => day.items.some((item) => item.sourceId === id));
  const item = from.items.find((entry) => entry.sourceId === id);
  const to = plan.days.find((day) => day.date !== from.date);
  const before = minutesFor(state, id);

  const moved = reducer(state, {
    type: 'PLANNER_MOVE_ITEM',
    itemId: item.id,
    fromDate: from.date,
    toDate: to.date,
  });

  assert.equal(moved.planner.plan.days.find((day) => day.date === from.date).items.some((entry) => entry.id === item.id), false);
  assert.equal(moved.planner.plan.days.find((day) => day.date === to.date).items.some((entry) => entry.id === item.id), true);
  assert.equal(minutesFor(moved, id), before, 'a drag never creates or loses study time');
  assert.equal(moved.activity[0].type, 'plan_item_moved');
});

test('locking a day is recorded and can be released', () => {
  const state = reducer(configured(), { type: 'PLANNER_SET_LOCK', date: todayISO(), locked: true });
  assert.deepEqual(state.planner.lockedDates, [todayISO()]);
  const unlocked = reducer(state, {
    type: 'PLANNER_SET_LOCK',
    date: todayISO(),
    locked: false,
  });
  assert.deepEqual(unlocked.planner.lockedDates, []);
});

test('accepting a subject factor changes planning; rejecting it changes it back', () => {
  let state = configured();
  // Three finished Math assignments that each ran 25% long.
  for (let i = 0; i < 3; i += 1) {
    const added = withAssignment(state, { title: `Old ${i}`, estimatedMinutes: 40 });
    state = added.state;
    let running = reducer(state, { type: 'START_SESSION', assignmentId: added.id, minutes: 50 });
    running = {
      ...running,
      activeSession: {
        ...running.activeSession,
        runningSince: new Date(Date.now() - 50 * 60_000).toISOString(),
      },
    };
    state = reducer(running, { type: 'END_SESSION' });
    state = reducer(state, { type: 'COMPLETE_ASSIGNMENT', id: added.id, method: 'timer' });
  }

  const live = withAssignment(state, { title: 'New Math', estimatedMinutes: 40, dueDate: D(4) });
  state = live.state;
  assert.equal(minutesFor(state, live.id), 40, 'nothing is adjusted without consent');

  const accepted = reducer(state, { type: 'PLANNER_ACCEPT_FACTOR', subject: 'Math' });
  assert.equal(minutesFor(accepted, live.id), 50, '40 × 1.25');

  const rejected = reducer(accepted, { type: 'PLANNER_REJECT_FACTOR', subject: 'Math' });
  assert.equal(minutesFor(rejected, live.id), 40);
});

/* ------------------------------------------------------------------ */
/* Day rollover                                                        */
/* ------------------------------------------------------------------ */

test('a day rollover carries unfinished work forward and loses nothing', () => {
  const { state, id } = withAssignment(configured(), { estimatedMinutes: 120, dueDate: D(5) });
  // Pretend the plan was built yesterday and nothing was done.
  const stale = {
    ...state,
    planner: {
      ...state.planner,
      plan: {
        ...state.planner.plan,
        planningHorizonStart: D(-1),
        days: [
          {
            date: D(-1),
            availableMinutes: 240,
            capacityMinutes: 240,
            plannedMinutes: 45,
            restDay: false,
            items: state.planner.plan.days[0].items.map((i) => ({ ...i, scheduledDate: D(-1) })),
          },
          ...state.planner.plan.days,
        ],
      },
    },
  };

  const rolled = reducer(stale, { type: 'TICK', now: Date.now() });
  assert.equal(rolled.planner.plan.planningHorizonStart, todayISO());
  // Measured at the rollover, because the rebuilt plan has no past days left.
  assert.ok(rolled.planner.lastRecovery, 'the carried-forward work was recorded');
  assert.equal(rolled.planner.lastRecovery.date, D(-1));
  assert.ok(rolled.planner.lastRecovery.unfinishedMinutes > 0);
  assert.equal(rolled.planner.plan.reason, 'day_rollover');
  assert.equal(minutesFor(rolled, id), 120, 'every minute is still planned');
  for (const day of rolled.planner.plan.days) {
    assert.ok(day.date >= todayISO(), 'nothing is left on a day that has passed');
    assert.ok(day.plannedMinutes <= day.capacityMinutes, `${day.date} respects capacity`);
  }
});

test('stale skips are pruned on rollover so they cannot pile up', () => {
  const { state, id } = withAssignment(configured(), { estimatedMinutes: 60, dueDate: D(5) });
  const withSkip = {
    ...state,
    planner: {
      ...state.planner,
      skips: [
        { sourceType: 'assignment', sourceId: id, date: D(-3), createdAt: new Date().toISOString() },
      ],
      plan: { ...state.planner.plan, planningHorizonStart: D(-1) },
    },
  };
  const rolled = reducer(withSkip, { type: 'TICK', now: Date.now() });
  assert.equal(rolled.planner.skips.length, 0);
});

/* ------------------------------------------------------------------ */
/* Focus Mode relationship                                             */
/* ------------------------------------------------------------------ */

test('Focus Mode started from the plan requires assignments, never exam timers', () => {
  let state = configured();
  const assignment = withAssignment(state, { estimatedMinutes: 45, dueDate: D(1) });
  state = assignment.state;
  state = withExam(state, { examDate: D(3) }).state;

  /**
   * Read from the whole plan, not from today.
   *
   * Capacity for *today* is whatever is left of today's availability window,
   * so a suite run late in the evening legitimately has no room for a chunk —
   * this test used to pass in the afternoon and fail after 21:00. What it is
   * actually about is which ids `START_FOCUS_MODE` accepts, which has nothing
   * to do with the time of day.
   */
  const plan = livePlan(state);
  const allItems = plan.days.flatMap((d) => d.items);
  assert.ok(allItems.some((i) => i.sourceType === 'exam'), 'exam study is planned');

  const ids = [
    ...new Set(
      allItems.filter((i) => i.sourceType === 'assignment').map((i) => i.sourceId),
    ),
  ];
  const focused = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: ids,
    requiredCompletionCount: ids.length,
  });
  assert.deepEqual(focused.focusMode.requiredTaskIds, [assignment.id]);

  // The existing completion engine still ends Focus Mode, unchanged.
  const done = reducer(focused, {
    type: 'COMPLETE_ASSIGNMENT',
    id: assignment.id,
    method: 'manual',
  });
  assert.equal(done.focusMode.active, false, 'recompute() still owns unlocking');
});

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

test('v5 → v6 adds the planner and keeps every Phase 1–6 record', () => {
  const v5 = {
    schemaVersion: 5,
    profile: { firstName: 'Alex', onboarded: true, createdAt: '2026-01-01T00:00:00.000Z' },
    assignments: [
      {
        id: 'asg_1',
        title: 'Edgenuity module',
        subject: 'Science',
        platform: 'Edgenuity',
        dueDate: D(2),
        dueTime: '23:59',
        estimatedMinutes: 45,
        priority: 'Important',
        status: 'Not Started',
        completionMethod: 'edgenuity',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        loggedMinutes: 10,
        reminders: {
          firstReminderMinutes: 120,
          escalationMinutes: 60,
          focusWarningMinutes: 30,
          enabled: true,
        },
        remindersFired: ['first'],
        verificationStatus: 'pending',
        verificationRecords: [
          { id: 'ver_1', type: 'edgenuity_photo', timestamp: '2026-01-02T00:00:00.000Z', status: 'verified' },
        ],
        canvas: {
          domain: 'school.instructure.com',
          url: 'https://school.instructure.com/x',
          submissionStatus: 'not_submitted',
          lastCheckedAt: null,
          lastStatusChangeAt: null,
        },
        edgenuity: {
          config: { targetType: 'progress_percent', requiredProgressDelta: 5 },
          verifiedProgressDelta: 2,
          lastVerifiedProgress: 42,
          verifiedActivities: 1,
        },
      },
    ],
    exams: [
      {
        id: 'exm_1',
        name: 'Chemistry Final',
        subject: 'Chemistry',
        examDate: D(6),
        materialAmount: 'Heavy',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    settings: {
      reminderMode: 'Strict',
      defaultStudyTime: '17:00',
      defaultFocusMinutes: 25,
      blockingEnabled: true,
      blockedDomains: ['youtube.com', 'tiktok.com'],
      allowedDomains: ['school.instructure.com'],
      notificationsAsked: true,
      theme: 'dark',
      edgenuityProofMode: 'enhanced',
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
    activeSession: null,
    completedSessions: [
      {
        id: 'ses_1',
        assignmentId: 'asg_1',
        assignmentTitle: 'Edgenuity module',
        plannedMinutes: 25,
        actualMinutes: 10,
        startedAt: '2026-01-02T00:00:00.000Z',
        endedAt: '2026-01-02T00:10:00.000Z',
      },
    ],
    activity: [
      { id: 'evt_1', type: 'focus_mode_started', timestamp: '2026-01-02T00:00:00.000Z', message: 'Focus Mode started' },
    ],
    parentPin: { hash: 'abc123', salt: 'def456', createdAt: '2026-01-01T00:00:00.000Z' },
    blockStats: [{ domain: 'youtube.com', count: 12, lastBlockedAt: '2026-01-02T00:00:00.000Z' }],
    canvas: {
      connection: {
        domain: 'school.instructure.com',
        mode: 'browser',
        connectedAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-02T00:00:00.000Z',
        permissionGranted: true,
      },
      courses: [{ externalCourseId: '1', originalName: 'Science', displayName: 'Science' }],
      detected: [],
      ignoredKeys: ['school.instructure.com|1|5'],
      lastSyncAt: null,
      lastError: null,
    },
    edgenuity: {
      sessions: [],
      challenges: [
        {
          id: 'chl_1',
          assignmentId: 'asg_1',
          sessionId: null,
          phase: 'before',
          type: 'visual_code',
          valueHash: 'hash',
          createdAt: '2026-01-02T00:00:00.000Z',
          expiresAt: '2026-01-02T00:05:00.000Z',
          status: 'verified',
          attempts: 1,
        },
      ],
      developerMode: false,
      cameraPermission: 'granted',
      ocrEverLoaded: true,
    },
    parentControls: {
      lockVerificationSettings: true,
      protectBlocklistInStrictMode: true,
      protectAllowlistInStrictMode: false,
    },
    focusRuns: [
      {
        id: 'run_1',
        startedAt: '2026-01-02T00:00:00.000Z',
        endedAt: '2026-01-02T01:00:00.000Z',
        requiredTaskIds: ['asg_1'],
        requiredCount: 1,
        completedCount: 1,
        outcome: 'completed',
        isTest: false,
        unlocks: [{ minutes: 15, startedAt: '2026-01-02T00:30:00.000Z', byParent: true }],
        blocked: [{ domain: 'youtube.com', count: 3 }],
        blockBaseline: [{ domain: 'youtube.com', count: 9 }],
      },
    ],
  };

  store.set(STORAGE_KEY, JSON.stringify(v5));
  const loaded = load();

  assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
  // Deliberately not pinned to a literal: `loaded.schemaVersion === SCHEMA_VERSION`
  // above already proves the chain ran to completion, and a hard-coded number
  // here only ever produces a chore on the next migration.

  // Nothing from Phase 1–6 is lost.
  assert.equal(loaded.profile.firstName, 'Alex');
  assert.equal(loaded.assignments.length, 1);
  assert.equal(loaded.assignments[0].loggedMinutes, 10);
  assert.equal(loaded.assignments[0].verificationRecords.length, 1);
  assert.equal(loaded.assignments[0].canvas.domain, 'school.instructure.com');
  assert.equal(loaded.assignments[0].edgenuity, undefined, 'the link went with Phase 17');
  assert.deepEqual(loaded.settings.blockedDomains, ['youtube.com', 'tiktok.com']);
  assert.deepEqual(loaded.settings.allowedDomains, ['school.instructure.com']);
  assert.equal(loaded.settings.reminderMode, 'Strict');
  assert.equal(loaded.parentPin.hash, 'abc123');
  assert.equal(loaded.parentControls.lockVerificationSettings, true);
  assert.equal(loaded.focusRuns.length, 1);
  assert.equal(loaded.focusRuns[0].unlocks[0].byParent, true);
  assert.equal(loaded.canvas.connection.domain, 'school.instructure.com');
  assert.equal(loaded.canvas.ignoredKeys.length, 1);
  assert.equal(loaded.completedSessions.length, 1);
  assert.equal(loaded.activity.length, 1);
  assert.equal(loaded.blockStats[0].count, 12);

  // And the new slice arrives switched off.
  assert.equal(loaded.planner.plan, null);
  assert.equal(loaded.planner.settings.configured, false);
  assert.equal(loaded.exams[0].loggedMinutes, 0);
  assert.equal(loaded.exams[0].studyEstimateMinutes, undefined);
  assert.equal(loaded.exams[0].name, 'Chemistry Final');
  store.clear();
});

test('a corrupted plan is dropped while the student’s own edits survive', () => {
  const state = configured();
  const damaged = {
    ...state,
    planner: {
      ...state.planner,
      plan: { id: 5, days: 'nonsense' },
      manualOrders: [{ date: todayISO(), order: ['assignment:a1'], updatedAt: '' }],
      lockedDates: [todayISO()],
    },
  };
  save(damaged);
  const loaded = load();
  assert.equal(loaded.planner.plan, null, 'a derived cache is rebuilt, not repaired');
  assert.equal(loaded.planner.manualOrders.length, 1);
  assert.deepEqual(loaded.planner.lockedDates, [todayISO()]);

  const rebuilt = reducer(loaded, { type: 'PLANNER_REBUILD' });
  assert.ok(rebuilt.planner.plan);
  store.clear();
});

test('a plan round-trips through storage unchanged', () => {
  const { state } = withAssignment(configured(), { estimatedMinutes: 90, dueDate: D(3) });
  save(state);
  const loaded = load();
  assert.equal(loaded.planner.plan.planVersion, state.planner.plan.planVersion);
  assert.deepEqual(
    loaded.planner.plan.days.map((d) => d.items.map((i) => [i.id, i.plannedMinutes])),
    state.planner.plan.days.map((d) => d.items.map((i) => [i.id, i.plannedMinutes])),
  );
  store.clear();
});

/* ------------------------------------------------------------------ */
/* Derived views                                                       */
/* ------------------------------------------------------------------ */

test('the week view never reports a day above its capacity', () => {
  let state = configured();
  for (let i = 0; i < 12; i += 1) {
    state = withAssignment(state, { title: `Task ${i}`, estimatedMinutes: 120, dueDate: D(5) }).state;
  }
  for (const day of selectWeekLoad(state, 7)) {
    assert.ok(day.utilisation <= 1.0001, `${day.date} at ${day.utilisation}`);
    assert.ok(day.plannedMinutes <= day.capacityMinutes);
  }
});

test('livePlan reflects completion without the stored plan being rewritten', () => {
  const { state, id } = withAssignment(configured(), { estimatedMinutes: 45, dueDate: D(2) });
  const stored = state.planner.plan;
  const live = livePlan(state);
  assert.equal(live.days[0].items[0].status, 'planned');
  assert.equal(state.planner.plan, stored, 'reading a plan never mutates it');
  assert.ok(itemsFor(state, id).length > 0);
});
