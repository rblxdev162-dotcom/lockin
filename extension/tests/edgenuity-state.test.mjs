/**
 * Edgenuity state transitions — the real reducer, no React, no browser.
 *
 * The logic suite proves the *policy* is right. This proves the reducer applies
 * it correctly: that a verified result completes the assignment through the
 * existing completion path, that Focus Mode therefore ends on its own, that a
 * v2 (Phase 3) save file upgrades without losing anything, and that the paths
 * which must never verify still don't once they are routed through real state.
 *
 * Run: npm run test:edgenuity-state
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * `load()` reads localStorage, which Node has no notion of. A three-line
 * in-memory stand-in is installed *before* the module is imported so the
 * migration test exercises the real load path rather than a re-implementation.
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { reducer } = await import('../../web/src/store/reducer.ts');
const { createAssignment } = await import('../../web/src/store/factories.ts');
const { defaultState, load, save, SCHEMA_VERSION, STORAGE_KEY } = await import(
  '../../web/src/lib/storage.ts'
);
const { sessionExpiryFrom } = await import('../../web/src/lib/edgenuity/verification.ts');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function proof(overrides = {}) {
  return {
    capturedAt: new Date().toISOString(),
    progressPercent: 43,
    courseName: 'Physical Science Semester A',
    parseConfidence: 'high',
    source: 'live_camera',
    ...overrides,
  };
}

/** A state with one Edgenuity assignment configured for +3%. */
function setup({ requiredProgressDelta = 3, targetType = 'progress_percent' } = {}) {
  let state = defaultState();
  const assignment = createAssignment({
    title: 'Edgenuity Science Progress',
    subject: 'Science',
    platform: 'Edgenuity',
    dueDate: '2026-08-20',
    dueTime: '23:59',
    estimatedMinutes: 30,
    priority: 'Normal',
  });
  state = reducer(state, { type: 'ADD_ASSIGNMENT', assignment });
  state = reducer(state, {
    type: 'EDGENUITY_CONFIGURE',
    assignmentId: assignment.id,
    config: {
      courseName: 'Physical Science Semester A',
      targetType,
      requiredProgressDelta,
      requiredFocusMinutes: 25,
    },
  });
  return { state, id: assignment.id };
}

const find = (state, id) => state.assignments.find((a) => a.id === id);
const openSession = (state) => state.edgenuity.sessions.find((s) => s.status === 'in_progress');

/** Starts a session and submits a final proof in one step. */
function verify(state, id, afterPercent, beforePercent = 43) {
  let next = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ progressPercent: beforePercent, capturedAt: hoursAgo(1) }),
  });
  const session = openSession(next);
  next = reducer(next, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: session.id,
    after: proof({ progressPercent: afterPercent }),
  });
  return next;
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

test('configuring an assignment routes its completion through Edgenuity', () => {
  const { state, id } = setup();
  const assignment = find(state, id);
  assert.equal(assignment.completionMethod, 'edgenuity');
  assert.equal(assignment.verificationMethod, 'edgenuity');
  assert.equal(assignment.verificationStatus, 'pending');
  assert.equal(assignment.edgenuity.verifiedProgressDelta, 0);
  assert.equal(assignment.edgenuity.lastVerifiedProgress, null);
});

test('changing the target keeps progress already verified', () => {
  const { state, id } = setup({ requiredProgressDelta: 10 });
  const afterOne = verify(state, id, 46);
  assert.equal(find(afterOne, id).edgenuity.verifiedProgressDelta, 3);

  const retargeted = reducer(afterOne, {
    type: 'EDGENUITY_CONFIGURE',
    assignmentId: id,
    config: { targetType: 'progress_percent', requiredProgressDelta: 3 },
  });
  assert.equal(find(retargeted, id).edgenuity.verifiedProgressDelta, 3, 'ledger survives');
});

/* ------------------------------------------------------------------ */
/* The verification chain                                              */
/* ------------------------------------------------------------------ */

test('a verified proof completes the assignment and writes one record', () => {
  const { state, id } = setup();
  const next = verify(state, id, 47);
  const assignment = find(next, id);

  assert.equal(assignment.status, 'Completed');
  assert.equal(assignment.completionMethod, 'edgenuity');
  assert.equal(assignment.verificationStatus, 'verified');

  const records = assignment.verificationRecords.filter((r) => r.type === 'edgenuity_photo');
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'verified');
  assert.equal(records[0].progressBefore, 43);
  assert.equal(records[0].progressAfter, 47);
  assert.equal(records[0].evidence.verificationType, 'live_camera_ocr');
  assert.equal(records[0].evidence.strength, 'course_progress');
});

test('no photo, image or OCR text is ever stored on the record', () => {
  const { state, id } = setup();
  const next = verify(state, id, 47);
  const blob = JSON.stringify(find(next, id));
  for (const forbidden of ['data:image', 'base64', 'rawText']) {
    assert.equal(blob.includes(forbidden), false, `record must not contain ${forbidden}`);
  }
  // The activity log is a second place data could leak into.
  assert.equal(JSON.stringify(next.activity).includes('data:image'), false);
});

test('partial progress is banked and the assignment stays open', () => {
  const { state, id } = setup({ requiredProgressDelta: 5 });
  const next = verify(state, id, 46);
  const assignment = find(next, id);
  assert.equal(assignment.status, 'In Progress');
  assert.equal(assignment.edgenuity.verifiedProgressDelta, 3);
  assert.equal(assignment.edgenuity.lastVerifiedProgress, 46);
  assert.ok(openSession(next), 'the session stays open so they can finish it');
});

test('a second check credits only new progress, and then completes', () => {
  const { state, id } = setup({ requiredProgressDelta: 5 });
  const afterFirst = verify(state, id, 46);

  const session = openSession(afterFirst);
  const afterSecond = reducer(afterFirst, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: session.id,
    after: proof({ progressPercent: 48 }),
  });

  const assignment = find(afterSecond, id);
  assert.equal(assignment.edgenuity.verifiedProgressDelta, 5, '+3 then +2, never +5 twice');
  assert.equal(assignment.status, 'Completed');
});

test('a lower reading never rolls the ledger back', () => {
  const { state, id } = setup({ requiredProgressDelta: 10 });
  const afterFirst = verify(state, id, 48);
  const session = openSession(afterFirst);
  const afterDrop = reducer(afterFirst, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: session.id,
    after: proof({ progressPercent: 46 }),
  });
  const link = find(afterDrop, id).edgenuity;
  assert.equal(link.verifiedProgressDelta, 5);
  assert.equal(link.lastVerifiedProgress, 48);
});

/* ------------------------------------------------------------------ */
/* Focus Mode — the whole point                                        */
/* ------------------------------------------------------------------ */

test('Edgenuity verification satisfies Focus Mode and ends it', () => {
  const { state, id } = setup();
  const focused = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  assert.equal(focused.focusMode.active, true);

  const verified = verify(focused, id, 47);
  assert.equal(verified.focusMode.active, false, 'the existing engine ends Focus Mode');
  assert.equal(verified.focusMode.completedCount, 1);
  assert.ok(verified.activity.some((e) => e.type === 'focus_mode_completed'));
});

test('partial Edgenuity progress does not unlock anything', () => {
  const { state, id } = setup({ requiredProgressDelta: 5 });
  const focused = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  const partial = verify(focused, id, 46);
  assert.equal(partial.focusMode.active, true, 'still blocking');
  assert.equal(partial.focusMode.completedCount, 0);
});

test('two required tasks need both — Edgenuity counts as exactly one', () => {
  const { state, id } = setup();
  const other = createAssignment({
    title: 'Canvas Essay',
    subject: 'English',
    platform: 'Canvas',
    dueDate: '2026-08-20',
    dueTime: '23:59',
    estimatedMinutes: 45,
    priority: 'Normal',
  });
  let next = reducer(state, { type: 'ADD_ASSIGNMENT', assignment: other });
  next = reducer(next, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id, other.id],
    requiredCompletionCount: 2,
  });

  next = verify(next, id, 47);
  assert.equal(next.focusMode.active, true, '1 / 2 verified');
  assert.equal(next.focusMode.completedCount, 1);

  next = reducer(next, { type: 'COMPLETE_ASSIGNMENT', id: other.id, method: 'manual' });
  assert.equal(next.focusMode.active, false, '2 / 2 verified');
});

/* ------------------------------------------------------------------ */
/* Things that must never verify                                       */
/* ------------------------------------------------------------------ */

test('a fixture capture cannot even open a session, let alone complete one', () => {
  // Phase 5 refuses a non-live starting frame up front. Phase 4 allowed the
  // session to open and failed at the final proof; failing at the point the
  // evidence is offered is both stricter and a clearer message.
  const { state, id } = setup();
  const next = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ capturedAt: hoursAgo(1), source: 'fixture' }),
  });
  assert.equal(openSession(next), undefined, 'no session is opened from a fixture frame');
  assert.equal(find(next, id).status, 'Not Started');
  assert.equal(find(next, id).edgenuity.verifiedProgressDelta, 0);
  assert.ok(next.activity.some((e) => e.type === 'edgenuity_verification_failed'));
});

test('a typed correction is recorded as unverified and completes nothing', () => {
  const { state, id } = setup();
  const next = reducer(state, {
    type: 'EDGENUITY_MANUAL_NOTE',
    assignmentId: id,
    progressPercent: 100,
    note: 'OCR could not read it',
  });
  const assignment = find(next, id);
  assert.equal(assignment.status, 'Not Started');
  assert.equal(assignment.verificationStatus, 'pending');
  const record = assignment.verificationRecords.at(-1);
  assert.equal(record.status, 'failed');
  assert.match(record.note, /Manual \/ unverified/);
});

test('a proof cannot be applied to a different assignment', () => {
  const { state, id } = setup();
  const second = createAssignment({
    title: 'Other Edgenuity work',
    subject: 'Science',
    platform: 'Edgenuity',
    dueDate: '2026-08-21',
    dueTime: '23:59',
    estimatedMinutes: 30,
    priority: 'Normal',
  });
  let next = reducer(state, { type: 'ADD_ASSIGNMENT', assignment: second });
  next = reducer(next, {
    type: 'EDGENUITY_CONFIGURE',
    assignmentId: second.id,
    config: { targetType: 'progress_percent', requiredProgressDelta: 3 },
  });
  next = verify(next, id, 47);

  // The session belongs to the first assignment; the second is untouched.
  assert.equal(find(next, id).status, 'Completed');
  assert.equal(find(next, second.id).status, 'Not Started');
});

test('a session id cannot be replayed once it has been used', () => {
  const { state, id } = setup();
  const verified = verify(state, id, 47);
  const usedSession = verified.edgenuity.sessions.find((s) => s.status === 'verified');

  const replayed = reducer(verified, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: usedSession.id,
    after: proof({ progressPercent: 90 }),
  });
  assert.equal(replayed, verified, 'a closed session is inert');
});

test('an expired starting photo is refused, and expires on its own', () => {
  const { state, id } = setup();
  let next = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ capturedAt: hoursAgo(20) }),
  });
  const session = openSession(next);
  assert.ok(Date.parse(session.expiresAt) < Date.now(), 'a 20-hour-old proof is stale');

  next = reducer(next, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: session.id,
    after: proof({ progressPercent: 47 }),
  });
  assert.equal(find(next, id).status, 'In Progress');
  assert.equal(next.edgenuity.sessions.find((s) => s.id === session.id).status, 'expired');

  // The clock tick alone also retires it, without waiting for a photo.
  const ticked = reducer(
    reducer(state, {
      type: 'EDGENUITY_START_SESSION',
      assignmentId: id,
      before: proof({ capturedAt: hoursAgo(20) }),
    }),
    { type: 'TICK', now: Date.now() },
  );
  assert.equal(ticked.edgenuity.sessions[0].status, 'expired');
});

test('starting a new session retires the previous one', () => {
  const { state, id } = setup();
  const first = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ progressPercent: 43 }),
  });
  const second = reducer(first, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ progressPercent: 20 }),
  });
  const live = second.edgenuity.sessions.filter((s) => s.status === 'in_progress');
  assert.equal(live.length, 1, 'only one starting photo can be live at a time');
  assert.equal(live[0].before.progressPercent, 20);
});

test('deleting an assignment removes its verification sessions', () => {
  const { state, id } = setup();
  const started = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof(),
  });
  const deleted = reducer(started, { type: 'DELETE_ASSIGNMENT', id });
  assert.equal(deleted.edgenuity.sessions.length, 0);
});

/* ------------------------------------------------------------------ */
/* Migration: a Phase 3 save file must survive intact                  */
/* ------------------------------------------------------------------ */

test('a v2 (Phase 3) save file upgrades to the current schema without losing anything', () => {
  const v2 = {
    schemaVersion: 2,
    profile: { firstName: 'Sam', onboarded: true, createdAt: '2026-01-01T00:00:00.000Z' },
    assignments: [
      {
        id: 'asg_old',
        title: 'Canvas Essay',
        subject: 'English',
        platform: 'Canvas',
        dueDate: '2026-08-20',
        dueTime: '23:59',
        estimatedMinutes: 45,
        priority: 'Important',
        status: 'Completed',
        completionMethod: 'canvas',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        loggedMinutes: 20,
        remindersFired: ['first'],
        verificationStatus: 'verified',
        verificationRecords: [{ id: 'ver_1', type: 'canvas_submission', timestamp: 'x', status: 'verified' }],
        externalCourseId: '101',
        externalAssignmentId: '5001',
        canvas: {
          domain: 'myschool.instructure.com',
          url: 'https://myschool.instructure.com/courses/101/assignments/5001',
          submissionStatus: 'graded',
          lastCheckedAt: '2026-01-01T00:00:00.000Z',
          lastStatusChangeAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ],
    exams: [{ id: 'exm_1', name: 'Biology Final', subject: 'Science', examDate: '2026-09-01' }],
    settings: { blockedDomains: ['youtube.com'], allowedDomains: ['clever.com'], reminderMode: 'Strict' },
    parentPin: { hash: 'abc', salt: 'def', createdAt: '2026-01-01T00:00:00.000Z' },
    activity: [{ id: 'evt_1', type: 'focus_mode_started', timestamp: 'x', message: 'started' }],
    completedSessions: [{ id: 'ses_1', assignmentId: 'asg_old', actualMinutes: 20 }],
    blockStats: [{ domain: 'youtube.com', count: 7, lastBlockedAt: 'x' }],
    canvas: {
      connection: {
        domain: 'myschool.instructure.com',
        mode: 'browser',
        connectedAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        permissionGranted: true,
      },
      courses: [{ externalCourseId: '101', originalName: 'ENG-7', displayName: 'English' }],
      detected: [],
      ignoredKeys: ['a|b|c'],
      lastSyncAt: null,
      lastError: null,
    },
  };

  store.set(STORAGE_KEY, JSON.stringify(v2));
  const loaded = load();

  assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
  // Deliberately not pinned to a literal: `loaded.schemaVersion === SCHEMA_VERSION`
  // above already proves the chain ran to completion, and a hard-coded number
  // here only ever produces a chore on the next migration.

  // Nothing from Phase 1-3 may be dropped.
  assert.equal(loaded.profile.firstName, 'Sam');
  assert.equal(loaded.assignments.length, 1);
  assert.equal(loaded.assignments[0].status, 'Completed');
  assert.equal(loaded.assignments[0].canvas.submissionStatus, 'graded');
  assert.equal(loaded.assignments[0].verificationRecords.length, 1);
  assert.equal(loaded.assignments[0].loggedMinutes, 20);
  assert.equal(loaded.exams.length, 1);
  assert.deepEqual(loaded.settings.blockedDomains, ['youtube.com']);
  assert.ok(loaded.settings.allowedDomains.includes('clever.com'));
  assert.equal(loaded.settings.reminderMode, 'Strict');
  assert.equal(loaded.parentPin.hash, 'abc');
  assert.equal(loaded.activity.length, 1);
  assert.equal(loaded.completedSessions.length, 1);
  assert.equal(loaded.blockStats[0].count, 7);
  assert.equal(loaded.canvas.connection.domain, 'myschool.instructure.com');
  assert.deepEqual(loaded.canvas.ignoredKeys, ['a|b|c']);

  // And both new slices exist, empty.
  assert.deepEqual(loaded.edgenuity.sessions, []);
  assert.deepEqual(loaded.edgenuity.challenges, []);
  assert.equal(loaded.edgenuity.developerMode, false);
  assert.equal(loaded.settings.edgenuityProofMode, 'standard');
  // Phase 6 slices arrive empty and permissive.
  assert.deepEqual(loaded.focusRuns, []);
  assert.equal(loaded.parentControls.lockVerificationSettings, false);
  assert.equal(loaded.assignments[0].edgenuity, undefined);
});

test('"never verified" survives a save/load round trip as null, not 0', () => {
  // `Number(null)` is 0, so a loose coercion here would turn an untouched
  // ledger into "already verified at 0%" and measure new progress from zero.
  const { state, id } = setup();
  save(state);
  const link = load().assignments.find((a) => a.id === id).edgenuity;
  assert.equal(link.lastVerifiedProgress, null);

  const proofWithoutPercent = {
    capturedAt: new Date().toISOString(),
    parseConfidence: 'low',
    source: 'live_camera',
  };
  const withSession = {
    ...state,
    edgenuity: {
      ...state.edgenuity,
      sessions: [
        {
          id: 'edg_np',
          assignmentId: id,
          status: 'in_progress',
          startedAt: proofWithoutPercent.capturedAt,
          expiresAt: sessionExpiryFrom(proofWithoutPercent.capturedAt),
          before: proofWithoutPercent,
          target: { targetType: 'session_progress', requiredFocusMinutes: 25 },
          focusMinutesAtStart: 0,
        },
      ],
    },
  };
  save(withSession);
  assert.equal(load().edgenuity.sessions[0].before.progressPercent, undefined);
});

test('a stored proof claiming to be a live capture is read back as a fixture', () => {
  // Hand-editing localStorage must not be a way to manufacture live evidence.
  const state = defaultState();
  state.edgenuity.sessions = [
    {
      id: 'edg_x',
      assignmentId: 'asg_x',
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      expiresAt: sessionExpiryFrom(new Date().toISOString()),
      before: { capturedAt: new Date().toISOString(), progressPercent: 43, parseConfidence: 'high', source: 'live_camera' },
      target: { targetType: 'progress_percent', requiredProgressDelta: 3 },
      focusMinutesAtStart: 0,
    },
  ];
  save(state);

  // Tamper: claim an impossible percentage and a bogus source.
  const raw = JSON.parse(store.get(STORAGE_KEY));
  raw.edgenuity.sessions[0].before.progressPercent = 999;
  raw.edgenuity.sessions[0].before.source = 'definitely_live';
  store.set(STORAGE_KEY, JSON.stringify(raw));

  const before = load().edgenuity.sessions[0].before;
  assert.equal(before.source, 'fixture', 'anything but live_camera reads back as fixture');
  assert.equal(before.progressPercent, undefined, 'an impossible percentage is dropped');
});

/* ------------------------------------------------------------------ */
/* Focus + Screen Proof                                                */
/* ------------------------------------------------------------------ */

test('focus + screen proof needs the logged minutes as well', () => {
  const { state, id } = setup({ targetType: 'session_progress' });
  let next = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ capturedAt: hoursAgo(1) }),
  });

  const tooSoon = reducer(next, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: openSession(next).id,
    after: proof({ progressPercent: undefined }),
  });
  assert.equal(find(tooSoon, id).status, 'In Progress');

  // Log 30 minutes of real focus time against it.
  next = reducer(next, { type: 'START_SESSION', assignmentId: id, minutes: 30 });
  next = {
    ...next,
    activeSession: { ...next.activeSession, accumulatedMs: 30 * 60_000, runningSince: null },
  };
  next = reducer(next, { type: 'END_SESSION' });
  assert.equal(find(next, id).loggedMinutes, 30);

  const done = reducer(next, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: openSession(next).id,
    after: proof({ progressPercent: undefined }),
  });
  const assignment = find(done, id);
  assert.equal(assignment.status, 'Completed');
  assert.equal(
    assignment.verificationRecords.at(-1).evidence.strength,
    'focus_plus_proof',
    'labelled honestly, not as verified course progress',
  );
});
