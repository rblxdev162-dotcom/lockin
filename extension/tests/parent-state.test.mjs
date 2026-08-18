/**
 * Parent controls, sessions, focus-run recording and the v4 → v5 migration —
 * through the real reducer and the real PIN implementation.
 *
 * The tests that matter most here are the negative ones: that a locked setting
 * really refuses to change without approval, that a parent raising a
 * requirement does not retroactively un-complete finished work, and that
 * clearing one kind of history leaves the others alone. Those are the places
 * where a plausible-looking implementation quietly does the wrong thing.
 *
 * Run: npm run test:parent-state
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
// `lib/pin.ts` uses WebCrypto's subtle digest, which Node exposes off `webcrypto`.
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const { reducer } = await import('../../web/src/store/reducer.ts');
const { createAssignment } = await import('../../web/src/store/factories.ts');
const { defaultState, load, save, SCHEMA_VERSION, STORAGE_KEY } = await import(
  '../../web/src/lib/storage.ts'
);
const { createPin, verifyPin } = await import('../../web/src/lib/pin.ts');
const {
  createParentSession,
  isParentSessionValid,
  touchParentSession,
  PARENT_SESSION_TTL_MS,
} = await import('../../web/src/types/parent.ts');
const { selectFocusHistory, selectWeeklySummary } = await import(
  '../../web/src/lib/parent/selectors.ts'
);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function withAssignment(state, { enhanced = false } = {}) {
  const assignment = createAssignment({
    title: 'Science module',
    subject: 'Science',
    platform: 'Edgenuity',
    dueDate: '2026-12-01',
    dueTime: '23:59',
    estimatedMinutes: 30,
    priority: 'Normal',
  });
  let next = reducer(state, { type: 'ADD_ASSIGNMENT', assignment });
  next = reducer(next, {
    type: 'EDGENUITY_CONFIGURE',
    assignmentId: assignment.id,
    config: {
      targetType: 'progress_percent',
      requiredProgressDelta: 3,
      requiredVerificationTrust: enhanced ? 'enhanced' : 'standard',
    },
  });
  return { state: next, id: assignment.id };
}

const find = (state, id) => state.assignments.find((a) => a.id === id);

/* ------------------------------------------------------------------ */
/* PIN and parent session                                              */
/* ------------------------------------------------------------------ */

test('the dashboard reuses the existing PIN: wrong rejected, correct accepted', async () => {
  const pin = await createPin('4821');
  assert.equal(await verifyPin('0000', pin), false);
  assert.equal(await verifyPin('482', pin), false);
  assert.equal(await verifyPin('4821', pin), true);
  // The digits themselves are never stored.
  assert.equal(JSON.stringify(pin).includes('4821'), false);
});

test('a parent session opens, keeps alive, and expires on idle', () => {
  const start = Date.UTC(2026, 7, 16, 18, 0, 0);
  const session = createParentSession(start);

  assert.equal(isParentSessionValid(session, start + 60_000), true);
  assert.equal(
    isParentSessionValid(session, start + PARENT_SESSION_TTL_MS + 1),
    false,
    'an idle dashboard locks itself',
  );

  // Interaction pushes the expiry out, but only from the moment of use.
  const touched = touchParentSession(session, start + 60_000);
  assert.equal(isParentSessionValid(touched, start + PARENT_SESSION_TTL_MS + 1), true);
  assert.equal(isParentSessionValid(touched, start + 60_000 + PARENT_SESSION_TTL_MS + 1), false);
});

test('no parent session is ever persisted, so a restart re-locks', () => {
  const state = defaultState();
  save(state);
  const raw = store.get(STORAGE_KEY);
  // The saved blob has no notion of an unlocked dashboard at all.
  assert.equal(raw.includes('parentSession'), false);
  assert.equal(raw.includes('authenticatedAt'), false);
  assert.equal(load().parentControls.lockVerificationSettings, false);
});

/* ------------------------------------------------------------------ */
/* Parent controls                                                     */
/* ------------------------------------------------------------------ */

test('setting a control logs exactly one event, and a no-op logs none', () => {
  const before = defaultState();
  const after = reducer(before, {
    type: 'PARENT_SET_CONTROLS',
    patch: { lockVerificationSettings: true },
  });

  assert.equal(after.parentControls.lockVerificationSettings, true);
  assert.equal(after.activity.filter((e) => e.type === 'parent_controls_changed').length, 1);

  const again = reducer(after, {
    type: 'PARENT_SET_CONTROLS',
    patch: { lockVerificationSettings: true },
  });
  assert.equal(again, after, 'setting the same value changes nothing and logs nothing');
});

test('a locked proof setting refuses to change without approval', () => {
  let state = reducer(defaultState(), {
    type: 'PARENT_SET_CONTROLS',
    patch: { lockVerificationSettings: true },
  });

  // The student's path: no approval flag.
  const attempted = reducer(state, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'enhanced' },
  });
  assert.equal(attempted.settings.edgenuityProofMode, 'standard', 'the reducer refuses it');

  // Unrelated settings in the same patch still go through.
  const mixed = reducer(state, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'enhanced', defaultFocusMinutes: 45 },
  });
  assert.equal(mixed.settings.edgenuityProofMode, 'standard');
  assert.equal(mixed.settings.defaultFocusMinutes, 45, 'ordinary settings are not collateral');

  // The parent's path: approved.
  const approved = reducer(state, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'enhanced' },
    parentApproved: true,
  });
  assert.equal(approved.settings.edgenuityProofMode, 'enhanced');
});

test('an unlocked device leaves the student in charge of everything', () => {
  const state = defaultState();
  const changed = reducer(state, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'enhanced' },
  });
  assert.equal(changed.settings.edgenuityProofMode, 'enhanced');
});

test('normal student actions never need approval, even when locked', () => {
  let state = reducer(defaultState(), {
    type: 'PARENT_SET_CONTROLS',
    patch: { lockVerificationSettings: true, protectBlocklistInStrictMode: true },
  });

  // Adding work, planning study time, and *adding* a blocked site all work.
  const assignment = createAssignment({
    title: 'New homework',
    subject: 'Math',
    platform: 'Other',
    dueDate: '2026-12-01',
    dueTime: '23:59',
    estimatedMinutes: 30,
    priority: 'Normal',
  });
  state = reducer(state, { type: 'ADD_ASSIGNMENT', assignment });
  state = reducer(state, { type: 'UPDATE_SETTINGS', patch: { defaultStudyTime: '19:00' } });
  state = reducer(state, {
    type: 'UPDATE_SETTINGS',
    patch: { blockedDomains: ['youtube.com'] },
  });

  assert.equal(state.assignments.length, 1);
  assert.equal(state.settings.defaultStudyTime, '19:00');
  assert.deepEqual(state.settings.blockedDomains, ['youtube.com']);
});

/* ------------------------------------------------------------------ */
/* Per-assignment requirements                                         */
/* ------------------------------------------------------------------ */

test('a parent can raise one assignment’s requirement, and it is logged once', () => {
  const { state, id } = withAssignment(defaultState());
  const raised = reducer(state, {
    type: 'PARENT_SET_ASSIGNMENT_TRUST',
    assignmentId: id,
    trust: 'enhanced',
  });

  assert.equal(find(raised, id).edgenuity.config.requiredVerificationTrust, 'enhanced');
  assert.equal(raised.activity.filter((e) => e.type === 'parent_requirement_changed').length, 1);

  const again = reducer(raised, {
    type: 'PARENT_SET_ASSIGNMENT_TRUST',
    assignmentId: id,
    trust: 'enhanced',
  });
  assert.equal(again, raised, 'setting the same requirement is a no-op');
});

test('raising the requirement does not re-open already completed work', () => {
  const { state, id } = withAssignment(defaultState());
  const completed = reducer(state, {
    type: 'COMPLETE_ASSIGNMENT',
    id,
    method: 'manual',
  });
  assert.equal(find(completed, id).status, 'Completed');

  const raised = reducer(completed, {
    type: 'PARENT_SET_ASSIGNMENT_TRUST',
    assignmentId: id,
    trust: 'enhanced',
  });
  assert.equal(find(raised, id).status, 'Completed', 'the new rule applies to future proof only');
  assert.equal(
    find(raised, id).verificationRecords.length,
    1,
    'and the old record is left exactly as it was',
  );
});

test('raising the global floor does not re-open completed work either', () => {
  const { state, id } = withAssignment(defaultState());
  const completed = reducer(state, { type: 'COMPLETE_ASSIGNMENT', id, method: 'manual' });
  const strict = reducer(completed, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'enhanced' },
    parentApproved: true,
  });
  assert.equal(find(strict, id).status, 'Completed');
});

/* ------------------------------------------------------------------ */
/* Focus run recording                                                 */
/* ------------------------------------------------------------------ */

test('a Focus Mode run is recorded from start to finish', () => {
  let state = defaultState();
  const { state: withWork, id } = withAssignment(state);
  state = withWork;

  state = { ...state, blockStats: [{ domain: 'youtube.com', count: 5, lastBlockedAt: 'x' }] };
  state = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });

  const open = state.focusRuns[0];
  assert.equal(open.outcome, 'active');
  assert.equal(open.requiredCount, 1);
  assert.deepEqual(open.blockBaseline, [{ domain: 'youtube.com', count: 5 }]);

  // Blocking happens during the run: totals climb from the baseline.
  state = reducer(state, {
    type: 'SET_BLOCK_STATS',
    stats: [
      { domain: 'youtube.com', count: 8, lastBlockedAt: 'x' },
      { domain: 'reddit.com', count: 1, lastBlockedAt: 'x' },
    ],
  });
  state = reducer(state, { type: 'COMPLETE_ASSIGNMENT', id, method: 'manual' });

  const run = state.focusRuns[0];
  assert.equal(run.outcome, 'completed');
  assert.ok(run.endedAt);
  assert.equal(run.completedCount, 1);
  assert.deepEqual(
    run.blocked,
    [
      { domain: 'youtube.com', count: 3 },
      { domain: 'reddit.com', count: 1 },
    ],
    'only attempts during this run are counted, not the running total',
  );
});

test('each way a session ends is recorded as its own outcome', () => {
  const cases = [
    { reason: 'normal', outcome: 'ended' },
    { reason: 'override', outcome: 'override' },
    { reason: 'emergency', outcome: 'emergency' },
  ];

  for (const { reason, outcome } of cases) {
    const { state, id } = withAssignment(defaultState());
    let next = reducer(state, {
      type: 'START_FOCUS_MODE',
      requiredTaskIds: [id],
      requiredCompletionCount: 1,
    });
    next = reducer(next, { type: 'END_FOCUS_MODE', reason, note: 'School site blocked' });

    assert.equal(next.focusRuns[0].outcome, outcome);
    assert.equal(next.focusRuns.filter((r) => r.outcome === 'active').length, 0);
  }
});

test('an emergency exit keeps the student’s own words', () => {
  const { state, id } = withAssignment(defaultState());
  let next = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  next = reducer(next, {
    type: 'END_FOCUS_MODE',
    reason: 'emergency',
    note: 'School site blocked',
  });
  assert.equal(next.focusRuns[0].note, 'School site blocked');
});

test('a temporary unlock is attached to the run and paired when it ends', () => {
  const { state, id } = withAssignment(defaultState());
  let next = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  next = reducer(next, { type: 'TEMPORARY_UNLOCK', minutes: 15, byParent: true });

  const unlock = next.focusRuns[0].unlocks[0];
  assert.equal(unlock.minutes, 15);
  assert.equal(unlock.byParent, true, 'a parent-approved unlock is marked as such');
  assert.equal(unlock.endedAt, undefined);
  assert.equal(next.focusMode.active, true, 'Focus Mode stays on through an unlock');

  next = reducer(next, { type: 'CANCEL_TEMPORARY_UNLOCK' });
  assert.ok(next.focusRuns[0].unlocks[0].endedAt, 'blocking resuming is recorded');
  assert.equal(next.focusMode.active, true);
});

test('an expiring unlock is closed by the clock, not by anyone pressing anything', () => {
  const { state, id } = withAssignment(defaultState());
  let next = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  next = reducer(next, { type: 'TEMPORARY_UNLOCK', minutes: 15 });
  next = reducer(next, { type: 'TICK', now: Date.now() + 16 * 60_000 });

  assert.equal(next.focusMode.temporaryUnlockUntil, null, 'blocking resumed');
  assert.ok(next.focusRuns[0].unlocks[0].endedAt);
  assert.equal(next.focusMode.active, true, 'and the session is still running');
});

test('starting a new session never leaves two runs open', () => {
  const { state, id } = withAssignment(defaultState());
  let next = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  next = reducer(next, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  assert.equal(next.focusRuns.filter((r) => r.outcome === 'active').length, 1);
});

test('viewing the dashboard adds nothing to the log', () => {
  const { state } = withAssignment(defaultState());
  const before = JSON.stringify(state.activity);

  // Everything the dashboard renders, in one go.
  selectWeeklySummary(state, new Date());
  selectFocusHistory(state);

  assert.equal(JSON.stringify(state.activity), before, 'reading history is read-only');
});

/* ------------------------------------------------------------------ */
/* Clearing history                                                    */
/* ------------------------------------------------------------------ */

test('clearing verification history keeps the schoolwork', () => {
  const { state, id } = withAssignment(defaultState());
  const completed = reducer(state, { type: 'COMPLETE_ASSIGNMENT', id, method: 'manual' });
  assert.equal(find(completed, id).verificationRecords.length, 1);

  const cleared = reducer(completed, { type: 'PARENT_CLEAR_HISTORY', scope: 'verification' });
  assert.equal(find(cleared, id).status, 'Completed', 'the assignment is untouched');
  assert.equal(find(cleared, id).verificationRecords.length, 0);
  assert.deepEqual(cleared.edgenuity.sessions, []);
  assert.deepEqual(cleared.edgenuity.challenges, []);
  assert.equal(cleared.assignments.length, 1);
});

test('clearing activity history keeps assignments and verification records', () => {
  const { state, id } = withAssignment(defaultState());
  const completed = reducer(state, { type: 'COMPLETE_ASSIGNMENT', id, method: 'manual' });
  const cleared = reducer(completed, { type: 'PARENT_CLEAR_HISTORY', scope: 'activity' });

  assert.equal(cleared.assignments.length, 1);
  assert.equal(find(cleared, id).verificationRecords.length, 1);
  // One event survives: the record of the clearing itself.
  assert.equal(cleared.activity.length, 1);
  assert.equal(cleared.activity[0].type, 'parent_controls_changed');
});

test('clearing focus history keeps the parent PIN and the blocklists', () => {
  let state = defaultState();
  state.parentPin = { hash: 'abc', salt: 'def', createdAt: 'x' };
  state.settings.blockedDomains = ['youtube.com'];
  const { state: withWork, id } = withAssignment(state);
  state = reducer(withWork, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });

  const cleared = reducer(state, { type: 'PARENT_CLEAR_HISTORY', scope: 'focus' });
  assert.deepEqual(cleared.focusRuns, []);
  assert.deepEqual(cleared.completedSessions, []);
  assert.equal(cleared.parentPin.hash, 'abc');
  assert.deepEqual(cleared.settings.blockedDomains, ['youtube.com']);
  assert.equal(cleared.assignments.length, 1);
});

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

test('a realistic v4 (Phase 5) save file upgrades to v5 with everything intact', () => {
  const v4 = {
    schemaVersion: 4,
    profile: { firstName: 'Sam', onboarded: true, createdAt: '2026-01-01T00:00:00.000Z' },
    assignments: [
      {
        id: 'asg_canvas',
        title: 'Argument Essay',
        subject: 'English',
        platform: 'Canvas',
        dueDate: '2026-08-20',
        dueTime: '23:59',
        estimatedMinutes: 45,
        priority: 'Important',
        status: 'Completed',
        completionMethod: 'canvas',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
        completedAt: '2026-08-10T00:00:00.000Z',
        loggedMinutes: 30,
        remindersFired: [],
        verificationStatus: 'verified',
        verificationRecords: [
          { id: 'ver_1', type: 'canvas_submission', timestamp: 'x', status: 'verified', evidence: { canvasStatus: 'graded' } },
        ],
        externalCourseId: '101',
        externalAssignmentId: '5001',
        canvas: {
          domain: 'myschool.instructure.com',
          url: 'https://myschool.instructure.com/courses/101/assignments/5001',
          submissionStatus: 'graded',
          lastCheckedAt: 'x',
          lastStatusChangeAt: 'x',
        },
      },
      {
        id: 'asg_edg',
        title: 'Science module',
        subject: 'Science',
        platform: 'Edgenuity',
        dueDate: '2026-08-21',
        dueTime: '23:59',
        estimatedMinutes: 30,
        priority: 'Normal',
        status: 'Completed',
        completionMethod: 'edgenuity',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
        completedAt: '2026-08-12T00:00:00.000Z',
        loggedMinutes: 25,
        remindersFired: [],
        verificationStatus: 'verified',
        verificationRecords: [
          {
            id: 'ver_2',
            type: 'edgenuity_photo',
            timestamp: 'x',
            status: 'verified',
            progressBefore: 43,
            progressAfter: 47,
            evidence: {
              trust: 'enhanced',
              verificationType: 'live_camera_ocr_enhanced',
              challengeBeforeVerified: true,
              challengeAfterVerified: true,
              screenConfidence: 'high',
            },
          },
        ],
        edgenuity: {
          config: { targetType: 'progress_percent', requiredProgressDelta: 3, requiredVerificationTrust: 'enhanced' },
          verifiedProgressDelta: 4,
          lastVerifiedProgress: 47,
          verifiedActivities: 0,
          lastVerifiedTrust: 'enhanced',
        },
      },
    ],
    exams: [{ id: 'exm_1', name: 'Biology Final', subject: 'Science', examDate: '2026-09-01' }],
    settings: {
      reminderMode: 'Strict',
      blockedDomains: ['youtube.com'],
      allowedDomains: ['clever.com'],
      edgenuityProofMode: 'enhanced',
    },
    parentPin: { hash: 'deadbeef', salt: 'cafe', createdAt: 'x' },
    activity: [{ id: 'evt_1', type: 'parent_override', timestamp: 'x', message: 'Parent override used' }],
    completedSessions: [{ id: 'ses_1', assignmentId: 'asg_edg', actualMinutes: 25, endedAt: 'x' }],
    blockStats: [{ domain: 'youtube.com', count: 7, lastBlockedAt: 'x' }],
    canvas: {
      connection: {
        domain: 'myschool.instructure.com',
        mode: 'browser',
        connectedAt: 'x',
        lastSeenAt: 'x',
        permissionGranted: true,
      },
      courses: [],
      detected: [],
      ignoredKeys: [],
      lastSyncAt: null,
      lastError: null,
    },
    edgenuity: {
      sessions: [],
      challenges: [
        {
          id: 'chl_old',
          assignmentId: 'asg_edg',
          sessionId: 'edg_1',
          phase: 'after',
          type: 'visual_code',
          valueHash: 'abc123',
          createdAt: 'x',
          expiresAt: 'x',
          status: 'verified',
          usedAt: 'x',
          attempts: 1,
        },
      ],
      developerMode: false,
      cameraPermission: 'granted',
      ocrEverLoaded: true,
    },
  };

  store.set(STORAGE_KEY, JSON.stringify(v4));
  const loaded = load();

  assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
  // Deliberately not pinned to a literal: `loaded.schemaVersion === SCHEMA_VERSION`
  // above already proves the chain ran to completion, and a hard-coded number
  // here only ever produces a chore on the next migration.

  // Nothing from Phases 1–5 is lost.
  assert.equal(loaded.profile.firstName, 'Sam');
  assert.equal(loaded.assignments.length, 2);
  assert.equal(loaded.assignments[0].canvas.submissionStatus, 'graded');
  assert.equal(loaded.assignments[1].edgenuity.verifiedProgressDelta, 4);
  assert.equal(loaded.assignments[1].edgenuity.lastVerifiedTrust, 'enhanced');
  assert.equal(loaded.assignments[1].verificationRecords[0].evidence.trust, 'enhanced');
  assert.equal(loaded.exams.length, 1);
  assert.equal(loaded.parentPin.hash, 'deadbeef');
  assert.deepEqual(loaded.settings.blockedDomains, ['youtube.com']);
  assert.equal(loaded.settings.edgenuityProofMode, 'enhanced');
  assert.equal(loaded.activity.length, 1);
  assert.equal(loaded.completedSessions.length, 1);
  assert.equal(loaded.blockStats[0].count, 7);
  assert.equal(loaded.canvas.connection.domain, 'myschool.instructure.com');
  assert.equal(loaded.edgenuity.challenges.length, 1);

  // And the Phase 6 slices arrive, permissive and empty.
  assert.deepEqual(loaded.focusRuns, []);
  assert.equal(loaded.parentControls.lockVerificationSettings, false);
  assert.equal(loaded.parentControls.protectBlocklistInStrictMode, false);
  assert.equal(loaded.parentControls.protectAllowlistInStrictMode, false);
});

test('an upgrade never silently starts demanding a PIN', () => {
  // A v4 file has no parentControls at all; the defaults must be permissive,
  // or updating the app would lock a student out of settings they owned.
  store.set(STORAGE_KEY, JSON.stringify({ schemaVersion: 4, profile: null }));
  const loaded = load();
  assert.equal(loaded.parentControls.lockVerificationSettings, false);

  const changed = reducer(loaded, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'enhanced' },
  });
  assert.equal(changed.settings.edgenuityProofMode, 'enhanced');
});

test('a hand-edited controls blob degrades to the permissive default', () => {
  store.set(
    STORAGE_KEY,
    JSON.stringify({ schemaVersion: 5, parentControls: 'nonsense', focusRuns: 'nonsense' }),
  );
  const loaded = load();
  assert.equal(loaded.parentControls.lockVerificationSettings, false);
  assert.deepEqual(loaded.focusRuns, []);
});
