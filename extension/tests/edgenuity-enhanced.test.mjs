/**
 * Enhanced Proof through the real reducer — including every replay attempt.
 *
 * The challenge suite proves the pieces behave. This proves the assembled
 * machine refuses the things it exists to refuse, using the actual state
 * transitions a student's device would run. Each `attack N` test below is one
 * of the ways a prepared photograph could be pushed back into the flow.
 *
 * Run: npm run test:edgenuity-enhanced
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { reducer } = await import('../../web/src/store/reducer.ts');
const { createAssignment, createChallenge } = await import('../../web/src/store/factories.ts');
const { defaultState } = await import('../../web/src/lib/storage.ts');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const STRONG_SCREEN = {
  score: 0.85,
  signals: ['edgenuity', 'course_progress', 'course', 'activity'],
  confidence: 'high',
};

/** A live capture. `code` is what OCR matched in the frame, if anything. */
function proof({ code, ...overrides } = {}) {
  return {
    capturedAt: new Date().toISOString(),
    progressPercent: 43,
    courseName: 'Physical Science Semester A',
    parseConfidence: 'high',
    source: 'live_camera',
    screenEvidence: STRONG_SCREEN,
    challenge: code
      ? { matched: true, matchedText: code, confidence: 1, ambiguous: false, separated: true }
      : undefined,
    ...overrides,
  };
}

/** An Edgenuity assignment that demands Enhanced Proof. */
function setup({ enhanced = true, requiredProgressDelta = 3 } = {}) {
  let state = defaultState();
  const assignment = createAssignment({
    title: 'Edgenuity Science Progress',
    subject: 'Science',
    platform: 'Edgenuity',
    dueDate: '2026-12-01',
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
      targetType: 'progress_percent',
      requiredProgressDelta,
      requiredVerificationTrust: enhanced ? 'enhanced' : 'standard',
    },
  });
  return { state, id: assignment.id };
}

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();

const find = (state, id) => state.assignments.find((a) => a.id === id);
const openSession = (state) => state.edgenuity.sessions.find((s) => s.status === 'in_progress');
const challengeById = (state, id) => state.edgenuity.challenges.find((c) => c.id === id);

/** Issues a code and returns [state, challenge]. */
function issue(state, assignmentId, phase, sessionId = null) {
  const challenge = createChallenge(assignmentId, phase, sessionId);
  return [reducer(state, { type: 'EDGENUITY_ISSUE_CHALLENGE', challenge }), challenge];
}

/**
 * The full Enhanced happy path: issue, start, issue, submit.
 *
 * The starting photo is dated an hour back so the run clears the Phase 4
 * "that was suspiciously fast" guard, which is about elapsed time and has
 * nothing to do with challenges.
 */
function runEnhancedSession(state, id, { beforePercent = 43, afterPercent = 47 } = {}) {
  let [next, beforeChallenge] = issue(state, id, 'before');
  next = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({
      progressPercent: beforePercent,
      code: beforeChallenge.value,
      capturedAt: hoursAgo(1),
    }),
    challengeId: beforeChallenge.id,
  });

  const session = openSession(next);
  assert.ok(session, 'the starting proof should have opened a session');

  let afterChallenge;
  [next, afterChallenge] = issue(next, id, 'after', session.id);
  next = reducer(next, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: session.id,
    after: proof({ progressPercent: afterPercent, code: afterChallenge.value }),
    challengeId: afterChallenge.id,
  });
  return { state: next, session, beforeChallenge, afterChallenge };
}

/* ------------------------------------------------------------------ */
/* The happy path                                                      */
/* ------------------------------------------------------------------ */

test('Enhanced Proof completes the assignment and records enhanced trust', () => {
  const { state, id } = setup();
  const { state: done, beforeChallenge, afterChallenge } = runEnhancedSession(state, id);

  const assignment = find(done, id);
  assert.equal(assignment.status, 'Completed');
  assert.equal(assignment.edgenuity.verifiedProgressDelta, 4);
  assert.equal(assignment.edgenuity.lastVerifiedTrust, 'enhanced');

  const record = assignment.verificationRecords.at(-1);
  assert.equal(record.evidence.trust, 'enhanced');
  assert.equal(record.evidence.verificationType, 'live_camera_ocr_enhanced');
  assert.equal(record.evidence.challengeBeforeVerified, true);
  assert.equal(record.evidence.challengeAfterVerified, true);

  // Both codes are spent, and neither value survives in storage.
  for (const issued of [beforeChallenge, afterChallenge]) {
    const spent = challengeById(done, issued.id);
    assert.equal(spent.status, 'verified');
    assert.ok(spent.usedAt);
    assert.equal(spent.value, undefined, 'a spent code is not kept around');
    assert.ok(spent.valueHash, 'but it stays identifiable by digest');
  }
});

test('the two halves of a session use different codes', () => {
  const { state, id } = setup();
  const { beforeChallenge, afterChallenge } = runEnhancedSession(state, id);
  assert.notEqual(beforeChallenge.value, afterChallenge.value);
  assert.notEqual(beforeChallenge.id, afterChallenge.id);
});

test('Enhanced Proof satisfies Focus Mode through the existing engine', () => {
  const { state, id } = setup();
  const focused = reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [id],
    requiredCompletionCount: 1,
  });
  assert.equal(focused.focusMode.active, true);

  const { state: done } = runEnhancedSession(focused, id);
  assert.equal(done.focusMode.active, false, 'the Phase 2 engine ends Focus Mode');
  assert.ok(done.activity.some((e) => e.type === 'focus_mode_completed'));
});

/* ------------------------------------------------------------------ */
/* Attack 1 — an old BEFORE image with its old code                     */
/* ------------------------------------------------------------------ */

test('attack 1: a spent starting code cannot open a second session', () => {
  const { state, id } = setup();
  const { state: done, beforeChallenge } = runEnhancedSession(state, id);

  const replayed = reducer(done, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ code: beforeChallenge.value }),
    challengeId: beforeChallenge.id,
  });
  assert.equal(openSession(replayed), undefined, 'no session opens on a used code');
  assert.ok(
    replayed.activity.some((e) => e.type === 'edgenuity_verification_failed'),
    'and the refusal is logged',
  );
});

test('attack 1b: an expired starting code is refused', () => {
  const { state, id } = setup();
  let [next, challenge] = issue(state, id, 'before');

  // Age the code past its five minutes, the way the clock tick would.
  next = {
    ...next,
    edgenuity: {
      ...next.edgenuity,
      challenges: next.edgenuity.challenges.map((c) => ({
        ...c,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })),
    },
  };

  const refused = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ code: challenge.value }),
    challengeId: challenge.id,
  });
  assert.equal(openSession(refused), undefined);
});

/* ------------------------------------------------------------------ */
/* Attack 2 — an old AFTER image reused in a later session              */
/* ------------------------------------------------------------------ */

test('attack 2: last session’s final photo fails in a new session', () => {
  const { state, id } = setup({ requiredProgressDelta: 3 });
  const first = runEnhancedSession(state, id);

  // A second run of the same assignment, and the student offers the previous
  // session's photo — which carries the previous session's code.
  let [next, beforeChallenge] = issue(first.state, id, 'before');
  next = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ progressPercent: 47, code: beforeChallenge.value, capturedAt: hoursAgo(1) }),
    challengeId: beforeChallenge.id,
  });
  const session = openSession(next);

  let afterChallenge;
  [next, afterChallenge] = issue(next, id, 'after', session.id);

  const replayed = reducer(next, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: session.id,
    // The old frame: it shows the *old* code, not the one just issued.
    after: proof({ progressPercent: 51, code: first.afterChallenge.value }),
    challengeId: afterChallenge.id,
  });

  const assignment = find(replayed, id);
  assert.equal(
    assignment.edgenuity.lastVerifiedProgress,
    47,
    'the stale frame credited nothing beyond the first session',
  );
  assert.ok(openSession(replayed), 'the session stays open for a real photo');
});

/* ------------------------------------------------------------------ */
/* Attack 3 — the right screen, no code                                 */
/* ------------------------------------------------------------------ */

test('attack 3: a correct Edgenuity screen with no code fails Enhanced Proof', () => {
  const { state, id } = setup();
  const [next, challenge] = issue(state, id, 'before');

  const refused = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof(), // reads fine, but no code was detected
    challengeId: challenge.id,
  });
  assert.equal(openSession(refused), undefined);
  assert.equal(challengeById(refused, challenge.id).status, 'pending', 'the code is not burned');
});

/* ------------------------------------------------------------------ */
/* Attack 4 — the code, but not an Edgenuity screen                     */
/* ------------------------------------------------------------------ */

test('attack 4: the code on a screen that is not convincingly Edgenuity fails', () => {
  const { state, id } = setup();
  const [next, challenge] = issue(state, id, 'before');

  const refused = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({
      code: challenge.value,
      // Read as a page, but nothing like enough signal for an Enhanced claim.
      screenEvidence: { score: 0.5, signals: ['course_progress'], confidence: 'medium' },
    }),
    challengeId: challenge.id,
  });
  assert.equal(openSession(refused), undefined, 'a code alone does not carry a weak screen');
});

/* ------------------------------------------------------------------ */
/* Attack 5 — a valid code from a different session                     */
/* ------------------------------------------------------------------ */

test('attack 5: a live code issued for another session is refused', () => {
  const { state, id } = setup();

  // Session A, running normally.
  let [next, challengeA] = issue(state, id, 'before');
  next = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ code: challengeA.value, capturedAt: hoursAgo(1) }),
    challengeId: challengeA.id,
  });
  const sessionA = openSession(next);

  // A final code cut for session A.
  let afterA;
  [next, afterA] = issue(next, id, 'after', sessionA.id);

  // A different session's id is claimed while presenting session A's code.
  const foreign = reducer(next, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: sessionA.id,
    after: proof({ progressPercent: 47, code: afterA.value }),
    // Pointing at a challenge bound to a session that isn't this one.
    challengeId: issue(next, 'asg_other', 'after', 'edg_other')[1].id,
  });
  assert.equal(find(foreign, id).status, 'In Progress', 'nothing completed');
});

test('attack 5b: a code issued for another assignment is refused', () => {
  const { state, id } = setup();
  const other = setup();
  const [withForeign, foreignChallenge] = issue(state, other.id, 'before');

  const refused = reducer(withForeign, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ code: foreignChallenge.value }),
    challengeId: foreignChallenge.id,
  });
  assert.equal(openSession(refused), undefined);
});

/* ------------------------------------------------------------------ */
/* Attack 6 — typing the code instead of photographing it               */
/* ------------------------------------------------------------------ */

test('attack 6: a detection that does not match the issued code is refused', () => {
  const { state, id } = setup();
  const [next, challenge] = issue(state, id, 'before');

  // A hand-supplied detection claiming success for the wrong value: the
  // reducer compares against the code it actually issued.
  const refused = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ code: 'ZZZZ' }),
    challengeId: challenge.id,
  });
  assert.equal(openSession(refused), undefined);
});

test('attack 6b: a manual note still cannot satisfy an Enhanced assignment', () => {
  const { state, id } = setup();
  const noted = reducer(state, {
    type: 'EDGENUITY_MANUAL_NOTE',
    assignmentId: id,
    progressPercent: 100,
    note: 'I did it',
  });
  const assignment = find(noted, id);
  assert.equal(assignment.status, 'Not Started');
  assert.equal(assignment.verificationRecords.at(-1).status, 'failed');
});

/* ------------------------------------------------------------------ */
/* Standard mode must keep working                                     */
/* ------------------------------------------------------------------ */

test('Standard Proof still verifies with no challenge at all', () => {
  const { state, id } = setup({ enhanced: false });
  let next = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ progressPercent: 43, capturedAt: new Date(Date.now() - 3600_000).toISOString() }),
  });
  const session = openSession(next);
  assert.ok(session, 'Standard mode opens a session without a code');
  assert.equal(session.requiredTrust, 'standard');

  next = reducer(next, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: session.id,
    after: proof({ progressPercent: 47 }),
  });
  const assignment = find(next, id);
  assert.equal(assignment.status, 'Completed');
  assert.equal(assignment.edgenuity.lastVerifiedTrust, 'standard');
  assert.equal(assignment.verificationRecords.at(-1).evidence.verificationType, 'live_camera_ocr');
});

test('a Standard capture cannot satisfy an assignment that requires Enhanced', () => {
  const { state, id } = setup();
  // Start properly, with a code.
  let [next, beforeChallenge] = issue(state, id, 'before');
  next = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ code: beforeChallenge.value, capturedAt: hoursAgo(1) }),
    challengeId: beforeChallenge.id,
  });
  const session = openSession(next);

  // Then finish without one: progress reads fine, trust does not.
  const refused = reducer(next, {
    type: 'EDGENUITY_SUBMIT_PROOF',
    sessionId: session.id,
    after: proof({ progressPercent: 47 }),
  });
  const assignment = find(refused, id);
  assert.equal(assignment.status, 'In Progress');
  assert.equal(
    assignment.edgenuity.verifiedProgressDelta,
    0,
    'nothing is banked, so Standard captures cannot be topped off with one Enhanced one',
  );
});

test('the global setting alone can require Enhanced Proof', () => {
  const { state, id } = setup({ enhanced: false });
  const strict = reducer(state, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'enhanced' },
  });
  const refused = reducer(strict, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof(),
  });
  assert.equal(openSession(refused), undefined, 'no code, no session');
});

/* ------------------------------------------------------------------ */
/* Challenge housekeeping                                              */
/* ------------------------------------------------------------------ */

test('issuing a new code retires the previous one for that phase', () => {
  const { state, id } = setup();
  const [first, challengeOne] = issue(state, id, 'before');
  const [second] = issue(first, id, 'before');

  assert.equal(challengeById(second, challengeOne.id).status, 'expired');
  assert.equal(
    second.edgenuity.challenges.filter((c) => c.status === 'pending' && c.phase === 'before').length,
    1,
    'exactly one live starting code at a time',
  );
});

test('the clock tick expires stale codes without touching spent ones', () => {
  const { state, id } = setup();
  const [issued] = issue(state, id, 'before');
  const later = reducer(issued, { type: 'TICK', now: Date.now() + 6 * 60_000 });
  assert.equal(later.edgenuity.challenges[0].status, 'expired');
  assert.equal(later.edgenuity.challenges[0].value, undefined, 'the code is dropped on expiry');
});

test('failed captures count attempts but never lock anyone out', () => {
  const { state, id } = setup();
  let [next, challenge] = issue(state, id, 'before');

  for (let i = 0; i < 5; i += 1) {
    next = reducer(next, {
      type: 'EDGENUITY_START_SESSION',
      assignmentId: id,
      before: proof(), // no code detected
      challengeId: challenge.id,
    });
  }
  assert.equal(challengeById(next, challenge.id).attempts, 5, 'attempts are counted');
  assert.equal(challengeById(next, challenge.id).status, 'pending', 'and the code still works');

  // The sixth try, with the code visible, succeeds.
  const success = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId: id,
    before: proof({ code: challenge.value }),
    challengeId: challenge.id,
  });
  assert.ok(openSession(success), 'OCR trouble is not punished');
});
