/**
 * Pure Edgenuity logic tests — no camera, no OCR engine, no DOM.
 *
 * These import the *shipping* modules from `web/src/lib/edgenuity/` (see
 * ts-resolve.mjs), so the parser and verification policy under test are exactly
 * the ones the app runs. Real OCR is covered separately in
 * edgenuity-ocr.test.mjs, and the whole flow in edgenuity-e2e.mjs.
 *
 * Run: npm run test:edgenuity-logic
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseProgressPercent,
  detectScreenSignals,
  extractActivityName,
  extractCourseName,
  extractPercentCandidates,
  extractPercentCandidatesFromWords,
  looksLikeEdgenuity,
  parseEdgenuityText,
  redactOcrResult,
  repairDigits,
} from '../../web/src/lib/edgenuity/parser.ts';
import {
  activeSessionFor,
  checkProgress,
  emptyLedger,
  isSessionExpired,
  sessionExpiryFrom,
} from '../../web/src/lib/edgenuity/verification.ts';
import { isSameCourse, similarity } from '../../web/src/lib/edgenuity/similarity.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const HEADER = 'Edgenuity\nPhysical Science Semester A\n';

function proof(overrides = {}) {
  return {
    capturedAt: new Date('2026-08-15T10:00:00Z').toISOString(),
    progressPercent: 43,
    courseName: 'Physical Science Semester A',
    parseConfidence: 'high',
    source: 'live_camera',
    ...overrides,
  };
}

function session(overrides = {}) {
  const startedAt = new Date('2026-08-15T10:00:00Z').toISOString();
  return {
    id: 'edg_1',
    assignmentId: 'asg_1',
    status: 'in_progress',
    startedAt,
    expiresAt: sessionExpiryFrom(startedAt),
    before: proof(),
    target: { targetType: 'progress_percent', requiredProgressDelta: 3 },
    focusMinutesAtStart: 0,
    ...overrides,
  };
}

/** An hour after the starting proof — past every "too fast" guard. */
const LATER = Date.parse('2026-08-15T11:00:00Z');

function check(overrides = {}) {
  const {
    link = emptyLedger({ targetType: 'progress_percent', requiredProgressDelta: 3 }),
    after = proof({ progressPercent: 47, capturedAt: new Date(LATER).toISOString() }),
    focusMinutesNow = 0,
    now = LATER,
    ...sessionOverrides
  } = overrides;
  return checkProgress({
    session: session(sessionOverrides),
    link,
    after,
    focusMinutesNow,
    now,
  });
}

/* ------------------------------------------------------------------ */
/* 1-4. Percentage parsing shapes                                      */
/* ------------------------------------------------------------------ */

test('reads `Course Progress: 43%`', () => {
  const result = parseEdgenuityText(`${HEADER}Course Progress: 43%`);
  assert.equal(result.detectedProgressPercent, 43);
  assert.equal(result.problem, undefined);
});

test('reads a spaced percentage', () => {
  assert.equal(parseEdgenuityText(`${HEADER}Course Progress 43 %`).detectedProgressPercent, 43);
});

test('reads a progress keyword before the value, with no percent sign', () => {
  assert.equal(parseEdgenuityText(`${HEADER}Progress 43`).detectedProgressPercent, 43);
});

test('reads a value on the line under its label', () => {
  assert.equal(parseEdgenuityText(`${HEADER}Course Progress\n43%`).detectedProgressPercent, 43);
});

/* ------------------------------------------------------------------ */
/* 5. Several percentages on one page — the important one              */
/* ------------------------------------------------------------------ */

test('picks course progress out of a page full of percentages', () => {
  const result = parseEdgenuityText(
    `${HEADER}Overall Grade: 92%\nCourse Progress: 43%\nRelative Grade: 87%`,
  );
  assert.equal(result.detectedProgressPercent, 43);
});

test('the explicitly labelled Course Progress beats a bare unit progress', () => {
  const result = parseEdgenuityText(
    `${HEADER}Course Progress: 43%\nUnit Progress: 61%\nLesson Progress: 12%`,
  );
  assert.equal(result.detectedProgressPercent, 43);
});

test('refuses to guess when two values carry equally strong labels', () => {
  const result = parseEdgenuityText(`${HEADER}Progress: 43%\nProgress: 61%`);
  assert.equal(result.problem, 'ambiguous_percentage');
  assert.equal(result.detectedProgressPercent, undefined);
});

test('a bare percentage with no progress context is not progress', () => {
  const result = parseEdgenuityText(`${HEADER}Course\nLesson 4\n47%`);
  assert.equal(result.detectedProgressPercent, undefined);
  assert.equal(result.problem, 'no_percentage');
});

/* ------------------------------------------------------------------ */
/* Column layouts — resolved by word position, not by line order       */
/* ------------------------------------------------------------------ */

/** Word boxes shaped like the ones Tesseract returns for a two-column page. */
const COLUMN_WORDS = [
  { text: 'Course', x0: 49, y0: 301, x1: 150, y1: 323 },
  { text: 'Progress', x0: 162, y0: 301, x1: 288, y1: 329 },
  { text: 'Overall', x0: 821, y0: 301, x1: 920, y1: 323 },
  { text: 'Grade', x0: 931, y0: 301, x1: 1016, y1: 323 },
  { text: '43%', x0: 49, y0: 349, x1: 197, y1: 407 },
  { text: '92%', x0: 822, y0: 349, x1: 938, y1: 395 },
];

test('a percentage is paired with the label above it, not the one beside it', () => {
  const candidates = extractPercentCandidatesFromWords(COLUMN_WORDS);
  const best = candidates[0];
  assert.equal(best.value, 43);
  assert.ok(best.score > candidates.find((c) => c.value === 92).score);
});

test('word positions beat the flattened text when both are available', () => {
  // This is exactly what OCR returns for a two-column page: the labels collapse
  // onto one line and the values onto the next, losing the pairing.
  const flattened = 'Edgenuity\nCourse Progress Overall Grade\n43% 92%';
  const result = parseEdgenuityText(flattened, { words: COLUMN_WORDS });
  assert.equal(result.detectedProgressPercent, 43);
});

test('the label may sit a line above with OCR junk in between', () => {
  // The rendered progress *bar* is regularly recognised as something like `[v)`.
  const text = 'Edgenuity\nPhysical Science Semester A\nCourse Progress\n[v)\n43%';
  assert.equal(parseEdgenuityText(text).detectedProgressPercent, 43);
});

/* ------------------------------------------------------------------ */
/* 6-9. Value validation                                               */
/* ------------------------------------------------------------------ */

test('rejects impossible percentages', () => {
  const candidates = extractPercentCandidates('Course Progress: 143%');
  assert.equal(candidates.length, 0);
});

test('accepts 0 and 100', () => {
  assert.equal(parseEdgenuityText(`${HEADER}Course Progress: 0%`).detectedProgressPercent, 0);
  assert.equal(parseEdgenuityText(`${HEADER}Course Progress: 100%`).detectedProgressPercent, 100);
});

test('repairs OCR digit confusion only inside a percentage token', () => {
  assert.equal(repairDigits('4B'), '48');
  assert.equal(repairDigits('S3'), '53');
  assert.equal(repairDigits('1OO'), '100');
  // Not a number-shaped token at all — never coerced.
  assert.equal(repairDigits('progress'), null);
  assert.equal(parseEdgenuityText(`${HEADER}Course Progress: 4B%`).detectedProgressPercent, 48);
});

test('does not turn arbitrary words into progress', () => {
  const result = parseEdgenuityText(`${HEADER}Course Progress: SO GOOD`);
  assert.equal(result.detectedProgressPercent, undefined);
});

/* ------------------------------------------------------------------ */
/* 10. Wrong site                                                      */
/* ------------------------------------------------------------------ */

test('a random website showing 47% is not Edgenuity proof', () => {
  const result = parseEdgenuityText(
    'Battery Health\nYour battery is at 47%\nSettings\nAbout this device',
  );
  assert.equal(result.problem, 'not_edgenuity');
  assert.equal(result.detectedProgressPercent, undefined);
});

test('brand alone is enough, and so is course+progress structure without a brand', () => {
  const branded = detectScreenSignals('Edgenuity home page');
  assert.ok(looksLikeEdgenuity(branded.signals, branded.score));

  const rebranded = detectScreenSignals(
    'My Courses\nPhysical Science Semester A\nCourse Progress 43%\nLesson 4',
  );
  assert.ok(looksLikeEdgenuity(rebranded.signals, rebranded.score));

  const neither = detectScreenSignals('Shopping cart\nSubtotal\nCheckout');
  assert.equal(looksLikeEdgenuity(neither.signals, neither.score), false);
});

test('survives a mangled brand name', () => {
  const result = parseEdgenuityText('Edgenulty\nCourse Progress: 43%\nLesson 4');
  assert.equal(result.problem, undefined);
  assert.ok(result.edgenuitySignals.includes('edgenuity'));
});

/* ------------------------------------------------------------------ */
/* 11-12. Course matching                                              */
/* ------------------------------------------------------------------ */

test('reads the course and activity names', () => {
  const text = `${HEADER}Course Progress: 43%\nActivity: Cell Structure`;
  assert.equal(extractCourseName(text), 'Physical Science Semester A');
  assert.match(extractActivityName(text) ?? '', /Cell Structure/);
});

test('course matching tolerates OCR slips but not a different course', () => {
  assert.ok(isSameCourse('Physical Science Semester A', 'Physical Scienee Semester A'));
  assert.ok(isSameCourse('Physical Science Semester A', 'Physical Science'));
  assert.equal(isSameCourse('Science', 'Math'), false);
  assert.ok(similarity('Science', 'Scienee') > 0.8);
});

test('a final photo of a different course is refused', () => {
  const result = check({ after: proof({ progressPercent: 65, courseName: 'Math Semester B' }) });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'different_course');
});

/* ------------------------------------------------------------------ */
/* 13-17. Before/after comparison                                      */
/* ------------------------------------------------------------------ */

test('before < after with enough gain verifies', () => {
  const result = check();
  assert.equal(result.outcome, 'verified');
  assert.equal(result.newProgress, 4);
  assert.equal(result.totalVerified, 4);
  assert.equal(result.requirementMet, true);
  assert.equal(result.strength, 'course_progress');
});

test('before == after credits nothing', () => {
  const result = check({ after: proof({ progressPercent: 43 }) });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'no_new_progress');
  assert.equal(result.newProgress, 0);
});

test('after < before never subtracts already-verified progress', () => {
  const link = { ...emptyLedger({ targetType: 'progress_percent', requiredProgressDelta: 5 }),
    verifiedProgressDelta: 5,
    lastVerifiedProgress: 48 };
  const result = check({ link, after: proof({ progressPercent: 46 }) });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'progress_reversed');
  assert.equal(result.totalVerified, 5, 'earned progress is kept');
  assert.equal(result.lastVerifiedProgress, 48, 'ledger is not rolled back');
});

test('required delta met vs not met', () => {
  const met = check({ target: { targetType: 'progress_percent', requiredProgressDelta: 3 } });
  assert.equal(met.requirementMet, true);

  const notMet = check({
    target: { targetType: 'progress_percent', requiredProgressDelta: 10 },
  });
  assert.equal(notMet.outcome, 'partial');
  assert.equal(notMet.requirementMet, false);
  assert.equal(notMet.newProgress, 4);
});

test('partial progress is kept, not thrown away', () => {
  const target = { targetType: 'progress_percent', requiredProgressDelta: 5 };
  const first = check({ target, after: proof({ progressPercent: 46 }) });
  assert.equal(first.outcome, 'partial');
  assert.equal(first.totalVerified, 3);
  assert.equal(first.lastVerifiedProgress, 46);
});

/* ------------------------------------------------------------------ */
/* 19. Double counting                                                 */
/* ------------------------------------------------------------------ */

test('a second check credits only progress above the last verified reading', () => {
  const target = { targetType: 'progress_percent', requiredProgressDelta: 5 };
  const first = check({ target, after: proof({ progressPercent: 46 }) });

  const link = {
    ...emptyLedger(target),
    verifiedProgressDelta: first.totalVerified,
    lastVerifiedProgress: first.lastVerifiedProgress,
  };
  // Starting proof still says 43, but 43 -> 46 has already been counted.
  const second = check({ target, link, after: proof({ progressPercent: 48 }) });
  assert.equal(second.newProgress, 2, 'credits +2, not +5 again');
  assert.equal(second.totalVerified, 5);
  assert.equal(second.requirementMet, true);
});

/* ------------------------------------------------------------------ */
/* Sanity checks — flag, never accuse                                  */
/* ------------------------------------------------------------------ */

test('an implausibly large jump asks for another photo instead of failing', () => {
  const result = check({ after: proof({ progressPercent: 97 }) });
  assert.equal(result.outcome, 'needs_confirmation');
  assert.equal(result.confirmReason, 'large_jump');
  assert.equal(result.newProgress, 0, 'nothing is credited until it is confirmed');
});

test('a second photo agreeing with the flagged reading is accepted', () => {
  const result = check({
    after: proof({ progressPercent: 97 }),
    pendingConfirmation: { reason: 'large_jump', progressPercent: 97, at: new Date(LATER).toISOString() },
  });
  assert.equal(result.outcome, 'verified');
  assert.equal(result.newProgress, 54);
});

test('a big claim seconds after the starting photo needs confirming', () => {
  const result = check({
    after: proof({ progressPercent: 47 }),
    now: Date.parse('2026-08-15T10:00:10Z'),
  });
  assert.equal(result.outcome, 'needs_confirmation');
  assert.equal(result.confirmReason, 'too_fast');
});

/* ------------------------------------------------------------------ */
/* 20. Session identity and expiry                                     */
/* ------------------------------------------------------------------ */

test('a starting proof expires and is never silently compared against', () => {
  const stale = session();
  assert.equal(isSessionExpired(stale, LATER), false);
  const nextDay = Date.parse('2026-08-16T12:00:00Z');
  assert.equal(isSessionExpired(stale, nextDay), true);

  const result = check({ now: nextDay });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'expired');
});

test('an expired session is not offered as the active one', () => {
  const sessions = [session()];
  assert.ok(activeSessionFor(sessions, 'asg_1', LATER));
  assert.equal(activeSessionFor(sessions, 'asg_1', Date.parse('2026-08-17T00:00:00Z')), undefined);
  assert.equal(activeSessionFor(sessions, 'asg_other', LATER), undefined);
});

/* ------------------------------------------------------------------ */
/* 21. Manual and fixture values can never be verified                 */
/* ------------------------------------------------------------------ */

test('a fixture capture cannot produce a verified result', () => {
  const fromFixture = check({ after: proof({ progressPercent: 47, source: 'fixture' }) });
  assert.equal(fromFixture.outcome, 'rejected');
  assert.equal(fromFixture.reason, 'not_live');

  const startedFromFixture = check({ before: proof({ source: 'fixture' }) });
  assert.equal(startedFromFixture.outcome, 'rejected');
  assert.equal(startedFromFixture.reason, 'not_live');
});

/* ------------------------------------------------------------------ */
/* Focus + Screen Proof                                                */
/* ------------------------------------------------------------------ */

test('focus + screen proof needs the focus time as well as the photos', () => {
  const target = { targetType: 'session_progress', requiredFocusMinutes: 25 };
  const link = emptyLedger(target);

  const tooSoon = check({ target, link, focusMinutesNow: 10, after: proof({ progressPercent: undefined }) });
  assert.equal(tooSoon.outcome, 'rejected');
  assert.equal(tooSoon.reason, 'not_enough_focus_time');

  const done = check({ target, link, focusMinutesNow: 26, after: proof({ progressPercent: undefined }) });
  assert.equal(done.outcome, 'verified');
  assert.equal(done.strength, 'focus_plus_proof', 'labelled honestly, not as course progress');
});

test('an unreadable percentage on a percentage target is refused, not assumed', () => {
  const result = check({ after: proof({ progressPercent: undefined }) });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'unreadable');
});

/* ------------------------------------------------------------------ */
/* Activity counting (experimental)                                    */
/* ------------------------------------------------------------------ */

test('activity counting needs a confident, changed activity name', () => {
  const target = { targetType: 'activities', requiredActivities: 2 };
  const link = emptyLedger(target);
  const before = proof({ activityName: 'Lesson 4' });

  const unreadable = check({ target, link, before, after: proof({ activityName: undefined }) });
  assert.equal(unreadable.reason, 'unreadable');

  const unchanged = check({ target, link, before, after: proof({ activityName: 'Lesson 4' }) });
  assert.equal(unchanged.reason, 'no_activity_change');

  const changed = check({ target, link, before, after: proof({ activityName: 'Lesson 5' }) });
  assert.equal(changed.outcome, 'partial');
  assert.equal(changed.totalActivities, 1);
});

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

test('raw OCR text is dropped before anything is stored', () => {
  const parsed = parseEdgenuityText(`${HEADER}Course Progress: 43%\nJane Doe · Period 3`, {
    keepRawText: true,
  });
  assert.ok(parsed.rawText, 'kept during processing when explicitly asked');

  const stored = redactOcrResult(parsed);
  assert.equal(stored.rawText, undefined);
  assert.deepEqual(stored.percentCandidates, []);
  assert.equal(stored.detectedProgressPercent, 43, 'the useful fields survive');
});

test('raw text is not kept by default', () => {
  assert.equal(parseEdgenuityText(`${HEADER}Course Progress: 43%`).rawText, undefined);
});
