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

test('an Enhanced requirement is not satisfied by a shared window', () => {
  const required = requiredTrustFor({ ...CONFIG, requiredVerificationTrust: 'enhanced' });
  assert.equal(meetsTrust(proofTrust(proof()), required), false);
});

test('a camera photo is still the only way to reach Enhanced', () => {
  const enhanced = proof({
    source: 'live_camera',
    challenge: { matched: true, value: 'AB12' },
    screenEvidence: { confidence: 'high', score: 0.9, signals: ['a', 'b', 'c'] },
  });
  assert.equal(proofTrust(enhanced), 'enhanced');
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

test('a photo cannot be paired with a shared window', () => {
  // Otherwise a student could photograph a real screen for the starting
  // reading and share a doctored window for the final one.
  const before = proof({
    source: 'live_camera',
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
