/**
 * Browser-read Edgenuity verification — policy and state, no React, no browser.
 *
 * The extension suite (`edgenuity-browser.test.mjs`) proves the *reading* is
 * safe: right origin, not during a test, refuse anything ambiguous. This one
 * proves what happens to a reading once it is believed — the crediting rules,
 * and that a met target completes the assignment through the one existing
 * completion path rather than a second unblock route.
 *
 * The three rules that matter here, in order of how expensive they are to get
 * wrong:
 *
 *   1. The first reading credits nothing. Connecting 30 activities into a
 *      course must not instantly satisfy the target.
 *   2. New work is measured from the high-water mark, never the baseline, so
 *      the same activities cannot be counted twice.
 *   3. A reading for another course is refused outright.
 *
 * Run: npm run test:edgenuity-browser-state
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
const { createAssignment } = await import('../../web/src/store/factories.ts');
const { defaultState } = await import('../../web/src/lib/storage.ts');
const { checkBrowserProgress } = await import(
  '../../web/src/lib/edgenuity/browserVerification.ts'
);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const COURSE = '12345';

function config(overrides = {}) {
  return {
    source: 'browser',
    targetType: 'activities',
    requiredActivities: 2,
    externalCourseId: COURSE,
    courseName: 'Algebra I',
    ...overrides,
  };
}

function link({ config: configOverrides, ...overrides } = {}) {
  return {
    verifiedProgressDelta: 0,
    lastVerifiedProgress: null,
    verifiedActivities: 0,
    ...overrides,
    // After the spread on purpose: a `config` override refines the default
    // config rather than replacing it, which is what the callers below assume.
    config: config(configOverrides),
  };
}

function reading(overrides = {}) {
  return {
    externalCourseId: COURSE,
    courseName: 'Algebra I',
    activitiesCompleted: 30,
    activitiesTotal: 40,
    readAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A state with one Edgenuity-tracked assignment, already baselined at 30. */
function stateWithAssignment(linkOverrides = {}) {
  const assignment = {
    ...createAssignment({ title: 'Algebra I module', subject: 'Math', platform: 'Edgenuity' }),
    edgenuity: link(linkOverrides),
  };
  return { ...defaultState(), assignments: [assignment] };
}

const baselined = {
  browserBaseline: { activitiesCompleted: 30, progressPercent: 60, at: '2026-08-17T09:00:00.000Z' },
  lastVerifiedActivityCount: 30,
};

/* ------------------------------------------------------------------ */
/* The crediting policy                                                */
/* ------------------------------------------------------------------ */

test('the first reading is a baseline and credits nothing', () => {
  const result = checkBrowserProgress({ config: config(), link: link(), reading: reading() });
  assert.equal(result.outcome, 'baseline');
  assert.equal(result.totalActivities, 0);
  assert.equal(result.requirementMet, false);
  // …but it remembers where the student was, so the next reading has a floor.
  assert.equal(result.lastVerifiedActivityCount, 30);
});

test('work done after the baseline is credited', () => {
  const result = checkBrowserProgress({
    config: config(),
    link: link(baselined),
    reading: reading({ activitiesCompleted: 32 }),
  });
  assert.equal(result.outcome, 'accepted');
  assert.equal(result.newActivities, 2);
  assert.equal(result.totalActivities, 2);
  assert.equal(result.requirementMet, true);
});

test('re-reading the same page does not credit the work twice', () => {
  const after = checkBrowserProgress({
    config: config(),
    link: link({ ...baselined, lastVerifiedActivityCount: 32, verifiedActivities: 2 }),
    reading: reading({ activitiesCompleted: 32 }),
  });
  assert.equal(after.outcome, 'no_change');
  assert.equal(after.newActivities, 0);
  assert.equal(after.totalActivities, 2);
});

test('a course that reset credits nothing and leaves the high-water mark alone', () => {
  const result = checkBrowserProgress({
    config: config(),
    link: link({ ...baselined, lastVerifiedActivityCount: 32, verifiedActivities: 2 }),
    reading: reading({ activitiesCompleted: 4 }),
  });
  assert.equal(result.newActivities, 0);
  assert.equal(result.lastVerifiedActivityCount, 32);
});

test('a reading from a different course is refused', () => {
  const result = checkBrowserProgress({
    config: config(),
    link: link(baselined),
    reading: reading({ externalCourseId: '99999', activitiesCompleted: 40 }),
  });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'wrong_course');
  assert.equal(result.requirementMet, false);
});

test('a page missing the metric this target needs is refused, not treated as zero', () => {
  const result = checkBrowserProgress({
    config: config(),
    link: link(baselined),
    reading: reading({ activitiesCompleted: undefined, activitiesTotal: undefined, progressPercent: 80 }),
  });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'no_target_metric');
});

test('percentage targets are credited from the last verified percentage', () => {
  const result = checkBrowserProgress({
    config: config({ targetType: 'progress_percent', requiredProgressDelta: 3 }),
    link: link({
      browserBaseline: { progressPercent: 60, at: '2026-08-17T09:00:00.000Z' },
      lastVerifiedProgress: 62,
      verifiedProgressDelta: 2,
    }),
    reading: reading({ progressPercent: 65 }),
  });
  assert.equal(result.newProgress, 3);
  assert.equal(result.totalVerified, 5);
  assert.equal(result.requirementMet, true);
});

/* ------------------------------------------------------------------ */
/* Through the real reducer                                            */
/* ------------------------------------------------------------------ */

test('the first reading through the reducer records a baseline, not a completion', () => {
  const state = stateWithAssignment();
  const next = reducer(state, { type: 'EDGENUITY_BROWSER_READING', reading: reading() });
  const assignment = next.assignments[0];

  assert.notEqual(assignment.status, 'Completed');
  assert.equal(assignment.edgenuity.browserBaseline.activitiesCompleted, 30);
  assert.equal(assignment.edgenuity.verifiedActivities, 0);
});

test('a met target completes the assignment through the normal path', () => {
  const state = stateWithAssignment(baselined);
  const next = reducer(state, {
    type: 'EDGENUITY_BROWSER_READING',
    reading: reading({ activitiesCompleted: 32 }),
  });
  const assignment = next.assignments[0];

  assert.equal(assignment.status, 'Completed');
  assert.equal(assignment.completionMethod, 'edgenuity');
  assert.equal(assignment.verificationStatus, 'verified');
  assert.equal(assignment.edgenuity.lastVerifiedTrust, 'browser');

  // The evidence is a handful of numbers — never page text, never scores.
  const record = assignment.verificationRecords.at(-1);
  assert.equal(record.type, 'edgenuity_browser');
  assert.equal(record.status, 'verified');
  assert.equal(record.evidence.trust, 'browser');
  assert.equal(record.evidence.activities, 2);
});

test('a completed assignment is not credited again by a page left open', () => {
  const state = stateWithAssignment(baselined);
  const done = reducer(state, {
    type: 'EDGENUITY_BROWSER_READING',
    reading: reading({ activitiesCompleted: 32 }),
  });
  const again = reducer(done, {
    type: 'EDGENUITY_BROWSER_READING',
    reading: reading({ activitiesCompleted: 40 }),
  });
  assert.deepEqual(again.assignments[0].edgenuity, done.assignments[0].edgenuity);
});

test('a camera-configured assignment ignores browser readings entirely', () => {
  const state = stateWithAssignment({ config: { source: undefined } });
  const next = reducer(state, {
    type: 'EDGENUITY_BROWSER_READING',
    reading: reading({ activitiesCompleted: 40 }),
  });
  assert.equal(next, state);
});

test('an unconfigured course claims the first reading it sees, then holds to it', () => {
  const state = stateWithAssignment({ config: { externalCourseId: undefined } });
  const claimed = reducer(state, { type: 'EDGENUITY_BROWSER_READING', reading: reading() });
  assert.equal(claimed.assignments[0].edgenuity.config.externalCourseId, COURSE);

  const other = reducer(claimed, {
    type: 'EDGENUITY_BROWSER_READING',
    reading: reading({ externalCourseId: '99999', activitiesCompleted: 40 }),
  });
  assert.equal(other.assignments[0].edgenuity.verifiedActivities, 0);
  assert.notEqual(other.assignments[0].status, 'Completed');
});
