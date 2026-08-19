/**
 * Phase 16 state and presentation logic.
 *
 * The reducer paths the new screens depend on, the storage migration that gets
 * an existing user there, the feedback rationing, and the states every screen
 * has to be able to render — empty, stale, offline, error.
 *
 * Run: npm run test:phase16
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { reducer } = await import('../../web/src/store/reducer.ts');
const storage = await import('../../web/src/lib/storage.ts');
const { chooseFeedback, daysWithoutOverdue, FEEDBACK_COOLDOWN_MS } = await import(
  '../../web/src/lib/feedback.ts'
);
const { computePace } = await import('../../web/src/lib/pace/engine.ts');
const { classify } = await import('../../web/src/lib/sources/freshness.ts');
const { sanitizeCalendarView } = await import('../../web/src/lib/canvas/calendarClient.ts');

const NOW = Date.parse('2026-03-10T18:00:00Z');
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

function assignment(patch = {}) {
  const due = new Date(NOW + (patch.dueIn ?? DAY));
  delete patch.dueIn;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    id: 'a1',
    title: 'Cell Respiration Worksheet',
    subject: 'Biology',
    platform: 'Canvas',
    dueDate: `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`,
    dueTime: `${pad(due.getHours())}:${pad(due.getMinutes())}`,
    estimatedMinutes: 35,
    loggedMinutes: 0,
    priority: 'Normal',
    status: 'Not Started',
    completionMethod: 'manual',
    createdAt: iso(NOW - DAY),
    updatedAt: iso(NOW - DAY),
    reminders: { firstReminderMinutes: 120, escalationMinutes: 60, focusWarningMinutes: 30, enabled: true },
    remindersFired: [],
    verificationStatus: 'not_required',
    verificationRecords: [],
    ...patch,
  };
}

/* ------------------------------------------------------------------ */
/* The migration                                                       */
/* ------------------------------------------------------------------ */

test('an existing v8 save file migrates without losing anything', () => {
  const legacy = {
    schemaVersion: 8,
    profile: { firstName: 'Sam', onboarded: true, createdAt: iso(NOW - 30 * DAY) },
    assignments: [
      { ...assignment({ id: 'kept', loggedMinutes: 40, status: 'In Progress' }) },
      {
        ...assignment({ id: 'canvas-linked' }),
        canvas: {
          domain: 'example.instructure.com',
          url: 'https://example.instructure.com/x',
          submissionStatus: 'not_submitted',
          lastCheckedAt: null,
          lastStatusChangeAt: null,
        },
      },
    ],
    settings: { reminderMode: 'Focused', edgenuityBridgeEnabled: true, blockedDomains: ['youtube.com'] },
    exams: [],
    activity: [],
    completedSessions: [],
    blockStats: [],
    focusRuns: [],
  };

  const migrated = storage.migrate
    ? storage.migrate(legacy)
    : JSON.parse(JSON.stringify(legacy));
  void migrated;

  // Migration runs inside load(); exercise it the way the app does.
  localStorageShim(legacy);
  const state = storage.load();

  assert.equal(state.schemaVersion, storage.SCHEMA_VERSION);
  assert.equal(state.assignments.length, 2, 'no assignment is dropped');

  const kept = state.assignments.find((a) => a.id === 'kept');
  assert.equal(kept.loggedMinutes, 40, 'logged work survives');
  assert.equal(kept.status, 'In Progress');
  assert.equal(kept.source.kind, 'MANUAL', 'hand-made work is stamped as its own');

  const linked = state.assignments.find((a) => a.id === 'canvas-linked');
  assert.equal(linked.source.kind, 'CANVAS_CALENDAR');
  assert.equal(
    classify(linked.source, NOW).state,
    'UNAVAILABLE',
    'a legacy stamp with no sync time must not read as fresh data',
  );

  assert.equal(state.settings.reminderMode, 'Focused', 'settings survive');
  assert.equal(state.settings.edgenuityBridgeEnabled, undefined, 'the dead flag is gone');
  assert.ok(Array.isArray(state.integrations.records), 'integrations exist');
  assert.deepEqual(state.integrations.courses, []);
});

test('the two authorization-blocked integrations can never claim to be connected', () => {
  localStorageShim({
    schemaVersion: storage.SCHEMA_VERSION,
    integrations: {
      records: [
        { id: 'canvas_oauth', status: 'connected' },
        { id: 'edgenuity_api', status: 'connected' },
      ],
      courses: [],
    },
  });
  const state = storage.load();
  for (const id of ['canvas_oauth', 'edgenuity_api']) {
    const record = state.integrations.records.find((r) => r.id === id);
    assert.equal(record.status, 'unavailable', `${id} must stay unavailable`);
  }
});

test('a hand-edited save file cannot forge a live source', () => {
  localStorageShim({
    schemaVersion: storage.SCHEMA_VERSION,
    assignments: [
      {
        ...assignment(),
        source: {
          kind: 'CANVAS_CALENDAR',
          sourceId: 'x',
          confidence: 'high',
          isLive: true,
          rawDataRetained: false,
          lastSyncedAt: iso(NOW),
        },
      },
    ],
  });
  const state = storage.load();
  assert.equal(
    state.assignments[0].source.isLive,
    false,
    'only a live handshake may assert liveness, never a file',
  );
});

/** Replaces `localStorage` with a one-entry stub holding the given state. */
function localStorageShim(state) {
  const store = new Map([[storage.STORAGE_KEY, JSON.stringify(state)]]);
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

/* ------------------------------------------------------------------ */
/* Screens have to be able to render every state                       */
/* ------------------------------------------------------------------ */

test('a brand-new install produces a renderable, honest dashboard state', () => {
  const state = storage.defaultState();
  const report = computePace({ state, now: NOW });

  assert.equal(report.status, 'UNKNOWN');
  assert.ok(report.reasons.length > 0, 'never an empty explanation');
  assert.ok(report.suggestedAction.text.length > 0, 'never an empty button');
  assert.equal(report.suggestedAction.assignmentId, undefined);
});

test('an offline sync failure leaves the assignments intact and says so', () => {
  const withWork = {
    ...storage.defaultState(),
    assignments: [assignment()],
  };
  const failed = reducer(withWork, {
    type: 'INTEGRATION_STATUS',
    id: 'canvas_calendar',
    status: 'error',
    error: 'Could not reach example.instructure.com.',
  });

  assert.equal(failed.assignments.length, 1, 'existing work is never dropped by a failed sync');
  const record = failed.integrations.records.find((r) => r.id === 'canvas_calendar');
  assert.equal(record.status, 'error');
  assert.match(record.lastError, /Could not reach/);
});

test('a stale integration is described as stale, not as connected', () => {
  const source = {
    kind: 'EDGENUITY_PROGRESS_EMAIL',
    sourceId: 'e',
    confidence: 'high',
    isLive: false,
    rawDataRetained: false,
    lastSyncedAt: iso(NOW - 20 * DAY),
  };
  const freshness = classify(source, NOW);
  assert.equal(freshness.state, 'STALE');
  assert.match(freshness.label, /days ago/);
});

test('a calendar view from the extension is rebuilt and cannot carry a URL', () => {
  const view = sanitizeCalendarView({
    configured: true,
    host: 'example.instructure.com',
    url: 'https://example.instructure.com/feeds/calendars/user_SECRET.ics',
    lastFetchedAt: NOW,
    evil: 'dropped',
  });
  assert.equal(view.host, 'example.instructure.com');
  assert.equal(view.url, undefined, 'there is no field for the secret');
  assert.equal(view.evil, undefined);
  assert.ok(!JSON.stringify(view).includes('SECRET'));
});

/* ------------------------------------------------------------------ */
/* Positive feedback                                                   */
/* ------------------------------------------------------------------ */

const aheadReport = {
  status: 'AHEAD',
  confidence: 'high',
  official: false,
  reasons: [{ code: 'course_ahead', tone: 'good', text: 'Algebra I is 4.5% ahead of target.' }],
  staleSources: [],
  suggestedAction: { kind: 'none', text: '' },
};

test('feedback is only given when it is true', () => {
  const clear = { ...storage.defaultState(), assignments: [assignment({ dueIn: 10 * DAY })] };
  const chosen = chooseFeedback({ state: clear, report: aheadReport, now: NOW, history: {} });
  assert.ok(chosen);
  assert.match(chosen.text, /ahead/i);

  // With something overdue, the "ahead for the week" line must not appear.
  const behind = {
    ...storage.defaultState(),
    assignments: [assignment({ dueIn: -2 * DAY })],
  };
  const chosenBehind = chooseFeedback({
    state: behind,
    report: { ...aheadReport, status: 'BEHIND', reasons: [] },
    now: NOW,
    history: {},
  });
  assert.ok(!chosenBehind || !/ahead for the week/i.test(chosenBehind.text));
});

test('the same encouragement does not repeat inside its cooldown', () => {
  const state = { ...storage.defaultState(), assignments: [assignment({ dueIn: 10 * DAY })] };
  const first = chooseFeedback({ state, report: aheadReport, now: NOW, history: {} });
  assert.ok(first);

  const history = { [first.kind]: NOW };
  const again = chooseFeedback({ state, report: aheadReport, now: NOW + 3600_000, history });
  assert.ok(!again || again.kind !== first.kind);

  const later = chooseFeedback({
    state,
    report: aheadReport,
    now: NOW + FEEDBACK_COOLDOWN_MS[first.kind] + 1000,
    history,
  });
  assert.equal(later?.kind, first.kind, 'it comes back once the window has passed');
});

test('only one thing is ever said at a time', () => {
  const state = { ...storage.defaultState(), assignments: [assignment({ dueIn: 10 * DAY })] };
  const chosen = chooseFeedback({ state, report: aheadReport, now: NOW, history: {}, working: true });
  assert.ok(chosen);
  assert.equal(typeof chosen.text, 'string');
});

test('the feedback copy never scolds and never invents a score', () => {
  const state = { ...storage.defaultState(), assignments: [assignment({ dueIn: 10 * DAY })] };
  const seen = new Set();
  let history = {};
  for (let i = 0; i < 6; i += 1) {
    const chosen = chooseFeedback({
      state,
      report: aheadReport,
      now: NOW + i * 7 * DAY,
      history,
    });
    if (!chosen) break;
    seen.add(chosen.text);
    history = { ...history, [chosen.kind]: NOW + i * 7 * DAY };
  }
  const prose = [...seen].join(' ').toLowerCase();
  for (const banned of ['points', 'streak', 'level', 'score', 'failing', 'lazy', 'should have']) {
    assert.ok(!prose.includes(banned), `feedback must not say "${banned}"`);
  }
});

test('the overdue-free count is capped rather than becoming a streak to protect', () => {
  const clean = { ...storage.defaultState(), assignments: [assignment({ dueIn: 10 * DAY })] };
  assert.ok(daysWithoutOverdue(clean, NOW) <= 7);
});

/* ------------------------------------------------------------------ */
/* Course state                                                        */
/* ------------------------------------------------------------------ */

test('removing a course leaves everything else alone', () => {
  const base = storage.defaultState();
  const withCourses = reducer(base, {
    type: 'COURSES_MERGE',
    summary: 'two courses',
    courses: [
      { id: 'c1', provider: 'edgenuity', product: 'EDGENUITY', name: 'Algebra I', activities: [], createdAt: iso(NOW), updatedAt: iso(NOW) },
      { id: 'c2', provider: 'edgenuity', product: 'EDGEEX', name: 'Biology', activities: [], createdAt: iso(NOW), updatedAt: iso(NOW) },
    ],
  });
  assert.equal(withCourses.integrations.courses.length, 2);

  const after = reducer(withCourses, { type: 'COURSE_REMOVE', courseId: 'c1' });
  assert.equal(after.integrations.courses.length, 1);
  assert.equal(after.integrations.courses[0].id, 'c2');
  assert.equal(after.assignments.length, withCourses.assignments.length);
});

test('merging an empty course list changes nothing', () => {
  const base = storage.defaultState();
  const after = reducer(base, { type: 'COURSES_MERGE', courses: [], summary: 'nothing' });
  assert.equal(after, base, 'no state churn, and no activity entry for a no-op');
});
