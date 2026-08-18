/**
 * Screen-capture proofs — the trust and gate rules, no browser.
 *
 * Phase 12 widened two rules that had been written as "camera" when what they
 * meant was "a live stream this tab opened". These checks pin down what did
 * *not* change with them:
 *
 *   - a shared window verifies, but never at Enhanced — no hand holding paper
 *     appears inside a screen capture, so an Enhanced requirement must keep
 *     demanding the camera rather than accepting something that cannot carry
 *     the code;
 *   - fixtures and hand-edited save files are still refused;
 *   - the two halves of a session must come from the same kind of capture.
 *
 * Run: npm run test:edgenuity-screen
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { proofTrust, checkProgress, sessionExpiryFrom, requiredTrustFor, emptyLedger } =
  await import('../../web/src/lib/edgenuity/verification.ts');
const { meetsTrust } = await import('../../web/src/types/edgenuity.ts');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function proof(overrides = {}) {
  return {
    capturedAt: new Date().toISOString(),
    progressPercent: 43,
    courseName: 'Physical Science Semester A',
    parseConfidence: 'high',
    source: 'live_screen',
    ...overrides,
  };
}

const CONFIG = { targetType: 'progress_percent', requiredProgressDelta: 3 };

function session(before, overrides = {}) {
  const startedAt = new Date(Date.now() - 40 * 60_000).toISOString();
  return {
    id: 'sess-1',
    assignmentId: 'a-1',
    status: 'in_progress',
    startedAt,
    expiresAt: sessionExpiryFrom(startedAt),
    target: CONFIG,
    requiredTrust: 'standard',
    before,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Trust                                                               */
/* ------------------------------------------------------------------ */

test('a shared window is worth Standard', () => {
  assert.equal(proofTrust(proof()), 'standard');
});

test('a shared window never reaches Enhanced, even carrying a matched code', () => {
  // The only way this input arises is a doctored save file — but the policy
  // must not depend on that being impossible.
  const withCode = proof({
    challenge: { matched: true, value: 'AB12' },
    screenEvidence: { confidence: 'high', score: 0.9, signals: ['a', 'b', 'c'] },
  });
  assert.equal(proofTrust(withCode), 'standard');
});

test('a stored Enhanced requirement is ignored rather than stranding the student', () => {
  /**
   * Enhanced was a handwritten code photographed beside the screen. The camera
   * is gone, so nothing on this device can produce it — and a save file
   * written before that change can still say `enhanced`.
   *
   * Honouring it would set a bar that can never be cleared: an assignment
   * permanently stuck at "not verified", with nothing in the UI able to
   * explain why. So the requirement is dropped to standard and a shared
   * window satisfies it.
   */
  const required = requiredTrustFor({ ...CONFIG, requiredVerificationTrust: 'enhanced' });
  assert.equal(required, 'standard');
  assert.equal(meetsTrust(proofTrust(proof()), required), true);
});

test('nothing can reach Enhanced any more', () => {
  // Even a proof carrying every Phase 5 field, which only a hand-edited save
  // file could produce now.
  const dressed = proof({
    challenge: { matched: true, value: 'AB12' },
    screenEvidence: { confidence: 'high', score: 0.9, signals: ['a', 'b', 'c'] },
  });
  assert.equal(proofTrust(dressed), 'standard');
});

test('anything that is not a live stream is still Manual', () => {
  assert.equal(proofTrust(proof({ source: 'fixture' })), 'manual');
});

/* ------------------------------------------------------------------ */
/* The live gate                                                       */
/* ------------------------------------------------------------------ */

test('two shared windows verify real progress', () => {
  const before = proof({ progressPercent: 40, capturedAt: new Date(Date.now() - 35 * 60_000).toISOString() });
  const result = checkProgress({
    session: session(before),
    link: emptyLedger(CONFIG),
    after: proof({ progressPercent: 44 }),
    focusMinutesNow: 30,
  });
  assert.equal(result.outcome, 'verified');
  assert.equal(result.requirementMet, true);
  assert.equal(result.trust, 'standard');
});

test('a fixture paired with a shared window is refused as not live', () => {
  const before = proof({ source: 'fixture', progressPercent: 40 });
  const result = checkProgress({
    session: session(before),
    link: emptyLedger(CONFIG),
    after: proof({ progressPercent: 44 }),
    focusMinutesNow: 30,
  });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'not_live');
});

test('a source that is not a shared window cannot be paired with one', () => {
  // The mixed-source rule outlived the camera: anything claiming a different
  // source is either a fixture or a hand-edited save file.
  const before = proof({
    source: 'fixture',
    progressPercent: 40,
    capturedAt: new Date(Date.now() - 35 * 60_000).toISOString(),
  });
  const result = checkProgress({
    session: session(before),
    link: emptyLedger(CONFIG),
    after: proof({ progressPercent: 44 }),
    focusMinutesNow: 30,
  });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'not_live');
});
