/**
 * Storage under abuse (Phase 8).
 *
 * Everything here feeds the real `load()` a save file that should not exist:
 * invalid JSON, missing fields, wrong enums, an old schema, half-written
 * objects, NaN, negative times, and a file far larger than the retention caps.
 *
 * The bar is the same in every case:
 *   1. it must not throw,
 *   2. it must keep every record it could read,
 *   3. it must not invent a stronger claim than the file made, and
 *   4. it must say what it had to repair.
 *
 * Run: npm run test:storage
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

const {
  CORRUPT_KEY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  defaultState,
  isSignificantRecovery,
  load,
  loadWithRecovery,
  save,
} = await import('../../web/src/lib/storage.ts');
const { MAX_ACTIVITY, MAX_KEY_ACTIVITY, trimActivity } = await import(
  '../../web/src/lib/retention.ts'
);
const { reducer } = await import('../../web/src/store/reducer.ts');

function put(value) {
  store.clear();
  store.set(STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

/** A minimally valid stored state at the current schema. */
function valid(extra = {}) {
  return {
    ...defaultState(),
    profile: { firstName: 'Sam', onboarded: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ...extra,
  };
}

const ASSIGNMENT = {
  id: 'asg_1',
  title: 'Essay',
  subject: 'English',
  platform: 'Other',
  dueDate: '2026-09-01',
  dueTime: '23:59',
  estimatedMinutes: 60,
  priority: 'Normal',
  status: 'Not Started',
  completionMethod: 'manual',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  loggedMinutes: 10,
  remindersFired: [],
  verificationStatus: 'not_required',
  verificationRecords: [],
};

/* ------------------------------------------------------------------ */
/* Unreadable files                                                    */
/* ------------------------------------------------------------------ */

test('invalid JSON is preserved, not destroyed, and reported as a reset', () => {
  put('{"assignments": [ this is not json');
  const { state, recovery } = loadWithRecovery();

  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(state.assignments, []);
  assert.equal(recovery.kind, 'reset');
  assert.ok(isSignificantRecovery(recovery), 'a reset is always worth telling the student about');
  assert.ok(store.get(CORRUPT_KEY), 'the damaged blob must be kept for recovery');
  assert.ok(!store.has(STORAGE_KEY), 'the damaged blob must not be left where it will fail again');
});

test('a stored array, string or null is not mistaken for a state', () => {
  for (const junk of ['[]', '"hello"', 'null', '42', 'true']) {
    put(junk);
    const { state, recovery } = loadWithRecovery();
    assert.equal(state.schemaVersion, SCHEMA_VERSION, `${junk} should fall back cleanly`);
    assert.equal(recovery.kind, 'reset');
  }
});

test('an empty store is a first run, not a recovery', () => {
  store.clear();
  const { state, recovery } = loadWithRecovery();
  assert.equal(state.profile, null);
  assert.equal(recovery.kind, 'none');
  assert.equal(isSignificantRecovery(recovery), false);
});

test('storage being unavailable entirely leaves the app usable in memory', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      throw new Error('SecurityError: storage is disabled');
    },
    setItem() {
      throw new Error('SecurityError: storage is disabled');
    },
    removeItem() {},
  };
  try {
    const { state, recovery } = loadWithRecovery();
    assert.equal(state.schemaVersion, SCHEMA_VERSION);
    assert.equal(recovery.kind, 'none');
    assert.equal(save(state), false, 'save reports failure rather than throwing');
  } finally {
    globalThis.localStorage = real;
  }
});

/* ------------------------------------------------------------------ */
/* Partly broken files — repair, do not wipe                           */
/* ------------------------------------------------------------------ */

test('one broken assignment is dropped and the rest survive', () => {
  put(
    valid({
      assignments: [
        ASSIGNMENT,
        null,
        'not an object',
        { id: 'asg_2' /* no title */ },
        { ...ASSIGNMENT, id: 'asg_3', title: 'Lab report' },
      ],
    }),
  );
  const { state, recovery } = loadWithRecovery();

  assert.deepEqual(
    state.assignments.map((a) => a.title),
    ['Essay', 'Lab report'],
  );
  assert.equal(recovery.dropped.assignments, 3);
  assert.ok(isSignificantRecovery(recovery), 'losing homework must be announced');
});

test('nonsense numbers never become schoolwork facts', () => {
  put(
    valid({
      assignments: [
        {
          ...ASSIGNMENT,
          estimatedMinutes: Number.NaN,
          loggedMinutes: -500,
        },
      ],
      completedSessions: [
        { id: 'ses_1', assignmentId: 'asg_1', actualMinutes: -30, plannedMinutes: Number.NaN },
        { id: 'ses_2', assignmentId: 'asg_1', actualMinutes: 9e99 },
      ],
      blockStats: [{ domain: 'youtube.com', count: -4 }, { domain: 5, count: 1 }],
    }),
  );
  const { state } = loadWithRecovery();

  const a = state.assignments[0];
  assert.equal(a.estimatedMinutes, 30, 'NaN falls back to the default, not to NaN');
  // Remaining work is `estimate - logged`; a negative `logged` would invent
  // work that does not exist, and NaN would poison every downstream sum.
  assert.ok(Number.isFinite(a.loggedMinutes) && a.loggedMinutes >= 0);

  for (const s of state.completedSessions) {
    assert.ok(Number.isFinite(s.actualMinutes) && s.actualMinutes >= 0, 'minutes are clamped');
    assert.ok(Number.isFinite(s.plannedMinutes) && s.plannedMinutes >= 0);
  }

  assert.deepEqual(
    state.blockStats.map((b) => [b.domain, b.count]),
    [['youtube.com', 0]],
    'a negative count becomes zero and a non-string domain is dropped',
  );
});

test('an unknown enum degrades to the safe value, never to something stricter', () => {
  put(
    valid({
      settings: { ...defaultState().settings, edgenuityProofMode: 'nuclear', reminderMode: 'Extreme' },
      parentControls: { lockVerificationSettings: 'yes please' },
      planner: { settings: { workloadPreference: 'Maximum', horizonDays: 9999 } },
    }),
  );
  const { state } = loadWithRecovery();

  assert.equal(state.settings.edgenuityProofMode, 'standard', 'never silently strand a student');
  // Parent controls are permissions: an unreadable one is off, because an
  // upgrade must not start demanding a PIN the student never set.
  assert.equal(state.parentControls.lockVerificationSettings, false);
  assert.equal(state.planner.settings.workloadPreference, 'Balanced');
  assert.equal(state.planner.settings.horizonDays, 60, 'clamped to the maximum, not accepted raw');
});

test('a malformed activity or focus record cannot reach the UI', () => {
  put(
    valid({
      activity: [
        { id: 'evt_1', type: 'focus_mode_started', timestamp: 'x', message: 'ok' },
        { id: 'evt_2', type: 'not_a_real_type', timestamp: 'x', message: 'spoofed' },
        { id: 'evt_3', type: 'focus_mode_ended' /* no message */ },
        null,
        'string',
      ],
      focusRuns: [
        { id: 'run_1', startedAt: 'x', outcome: 'completed' },
        { id: 'run_2' /* no startedAt */ },
        { startedAt: 'x' /* no id */ },
      ],
    }),
  );
  const { state, recovery } = loadWithRecovery();

  assert.deepEqual(state.activity.map((e) => e.id), ['evt_1']);
  assert.deepEqual(state.focusRuns.map((r) => r.id), ['run_1']);
  assert.equal(recovery.dropped.focusRuns, 2);
});

test('a corrupted plan is dropped while the student’s own edits survive', () => {
  put(
    valid({
      planner: {
        settings: { configured: true },
        plan: { id: 'plan_1' /* no horizon dates */ },
        skips: [{ sourceType: 'assignment', sourceId: 'asg_1', date: '2026-09-01', createdAt: 'x' }],
        lockedDates: ['2026-09-02', 'not-a-date'],
      },
    }),
  );
  const { state, recovery } = loadWithRecovery();

  assert.equal(state.planner.plan, null, 'an unreadable plan is a cache miss, nothing more');
  assert.equal(state.planner.skips.length, 1, 'the skip is the student’s decision and survives');
  assert.deepEqual(state.planner.lockedDates, ['2026-09-02']);
  assert.equal(recovery.dropped.plan, true);
  assert.equal(
    isSignificantRecovery(recovery),
    false,
    'a rebuildable plan is not worth alarming anyone about',
  );
});

test('a save file cannot promote a fixture photo into a live capture', () => {
  put(
    valid({
      edgenuity: {
        sessions: [
          {
            id: 'ses_1',
            assignmentId: 'asg_1',
            status: 'awaiting_final',
            startedAt: 'x',
            expiresAt: 'y',
            target: { targetType: 'progress_percent', requiredProgressDelta: 5 },
            before: {
              capturedAt: 'x',
              progressPercent: 40,
              source: 'live_camera_totally_real',
              trust: 'enhanced',
              challenge: { matched: true, confidence: 1 },
            },
          },
        ],
      },
    }),
  );
  const { state } = loadWithRecovery();
  const before = state.edgenuity.sessions[0].before;
  assert.equal(before.source, 'fixture', 'anything but exactly "live_camera" reads back as fixture');
});

/* ------------------------------------------------------------------ */
/* Migration from every earlier schema                                 */
/* ------------------------------------------------------------------ */

test('a save file from every earlier schema loads without losing its assignment', () => {
  for (let version = 0; version < SCHEMA_VERSION; version += 1) {
    put({
      schemaVersion: version === 0 ? undefined : version,
      profile: { firstName: 'Sam', onboarded: true, createdAt: 'x' },
      assignments: [ASSIGNMENT],
      exams: [{ id: 'exm_1', name: 'Final', subject: 'Science', examDate: '2026-09-10' }],
      settings: { blockedDomains: ['youtube.com'] },
      parentPin: { hash: 'h', salt: 's', createdAt: 'x' },
    });
    const state = load();
    assert.equal(state.schemaVersion, SCHEMA_VERSION, `v${version} did not reach the current schema`);
    assert.equal(state.assignments.length, 1, `v${version} lost an assignment`);
    assert.equal(state.assignments[0].loggedMinutes, 10, `v${version} lost logged minutes`);
    assert.equal(state.exams.length, 1, `v${version} lost an exam`);
    assert.equal(state.parentPin.hash, 'h', `v${version} lost the parent PIN`);
    assert.deepEqual(state.settings.blockedDomains, ['youtube.com'], `v${version} lost the blocklist`);
    // Every slice added since must exist, whatever the file knew about.
    assert.ok(state.canvas && state.edgenuity && state.parentControls && state.planner);
    assert.equal(typeof state.settings.extensionSeen, 'boolean');
  }
});

test('the v7 flag is inferred from evidence, not assumed either way', () => {
  put({ schemaVersion: 6, blockStats: [{ domain: 'youtube.com', count: 3, lastBlockedAt: 'x' }] });
  assert.equal(load().settings.extensionSeen, true, 'block counts prove the extension ran here');

  put({ schemaVersion: 6, blockStats: [] });
  assert.equal(load().settings.extensionSeen, false, 'no evidence means no claim');
});

/* ------------------------------------------------------------------ */
/* Retention                                                           */
/* ------------------------------------------------------------------ */

test('the activity log is capped', () => {
  const many = Array.from({ length: MAX_ACTIVITY + 250 }, (_, i) => ({
    id: `evt_${i}`,
    type: 'plan_generated',
    timestamp: 'x',
    message: `entry ${i}`,
  }));
  put(valid({ activity: many }));
  const { state, recovery } = loadWithRecovery();

  assert.equal(state.activity.length, MAX_ACTIVITY);
  assert.equal(state.activity[0].id, 'evt_0', 'the newest entries are the ones kept');
  assert.ok(recovery.trimmed.activity > 0);
  assert.equal(isSignificantRecovery(recovery), false, 'trimming history is routine, not an alarm');
});

test('noise cannot push accountability events out of the log', () => {
  // Newest first, as the reducer writes them: one override, then a flood.
  const list = [
    { id: 'key_0', type: 'parent_override', timestamp: 'x', message: 'override' },
    ...Array.from({ length: MAX_ACTIVITY * 2 }, (_, i) => ({
      id: `noise_${i}`,
      type: 'plan_generated',
      timestamp: 'x',
      message: 'plan',
    })),
    { id: 'key_1', type: 'emergency_exit', timestamp: 'x', message: 'exit' },
    { id: 'key_2', type: 'focus_mode_ended', timestamp: 'x', message: 'ended' },
  ];

  const trimmed = trimActivity(list);
  assert.equal(trimmed.length, MAX_ACTIVITY);
  const ids = trimmed.map((e) => e.id);
  // A plain ring buffer would have dropped all three: they are older than 600
  // entries of noise.
  for (const id of ['key_0', 'key_1', 'key_2']) {
    assert.ok(ids.includes(id), `${id} was evicted by ordinary events`);
  }
  assert.ok(
    ids.indexOf('key_0') < ids.indexOf('key_1'),
    'the timeline keeps its order; only entries are missing, never reordered',
  );
});

test('the reservation cannot starve the log of ordinary entries', () => {
  const keyOnly = Array.from({ length: MAX_ACTIVITY * 2 }, (_, i) => ({
    id: `key_${i}`,
    type: 'assignment_completed',
    timestamp: 'x',
    message: 'done',
  }));
  assert.equal(trimActivity(keyOnly).length, MAX_ACTIVITY, 'the overall cap still holds');
  assert.ok(MAX_KEY_ACTIVITY < MAX_ACTIVITY, 'the reservation must leave room for ordinary events');
});

test('verification records are capped per assignment, and completion is untouched', () => {
  put(
    valid({
      assignments: [
        {
          ...ASSIGNMENT,
          status: 'Completed',
          verificationRecords: Array.from({ length: 200 }, (_, i) => ({
            id: `ver_${i}`,
            type: 'manual',
            timestamp: 'x',
            status: 'verified',
          })),
        },
      ],
    }),
  );
  const { state } = loadWithRecovery();
  assert.ok(state.assignments[0].verificationRecords.length <= 40);
  assert.equal(state.assignments[0].status, 'Completed', 'trimming evidence never un-completes work');
});

/* ------------------------------------------------------------------ */
/* Quota                                                               */
/* ------------------------------------------------------------------ */

test('a full disk sheds history rather than losing homework', () => {
  const real = globalThis.localStorage;
  const writes = [];
  globalThis.localStorage = {
    getItem: () => null,
    removeItem: () => {},
    setItem(key, value) {
      writes.push(value);
      // Refuse anything with an activity log, the way a quota error would bite
      // the largest payload first.
      if (JSON.parse(value).activity.length > 0) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
    },
  };
  try {
    let state = defaultState();
    state = reducer(state, { type: 'CREATE_PROFILE', firstName: 'Sam' });
    state = {
      ...state,
      assignments: [ASSIGNMENT],
      activity: Array.from({ length: 300 }, (_, i) => ({
        id: `evt_${i}`,
        type: 'plan_generated',
        timestamp: 'x',
        message: 'x',
      })),
    };

    assert.equal(save(state), true, 'save must succeed by shedding history');
    const written = JSON.parse(writes[writes.length - 1]);
    assert.equal(written.activity.length, 0, 'the log was given up');
    assert.equal(written.assignments.length, 1, 'the homework was not');
    assert.equal(written.profile.firstName, 'Sam');
  } finally {
    globalThis.localStorage = real;
  }
});

test('a state that survives a save round-trips unchanged', () => {
  store.clear();
  let state = defaultState();
  state = reducer(state, { type: 'CREATE_PROFILE', firstName: 'Sam' });
  state = { ...state, assignments: [ASSIGNMENT] };

  assert.equal(save(state), true);
  const reloaded = load();
  assert.equal(reloaded.profile.firstName, 'Sam');
  assert.equal(reloaded.assignments[0].title, 'Essay');
  assert.equal(reloaded.assignments[0].loggedMinutes, 10);
});
