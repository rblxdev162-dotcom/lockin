/**
 * Enhanced Proof — challenge generation, lifetime, and detection. Pure.
 *
 * These are the tests that decide whether the feature is evidence or theatre.
 * The distinction is narrow and worth restating: a challenge is only worth
 * anything if a *machine* confirms the expected code was in the frame, if the
 * code could not have been known when an old photo was taken, and if it can
 * never be spent twice. Each of those has a test below, and so does every way
 * a student might try to slip past them.
 *
 * Run: npm run test:edgenuity-challenge
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHALLENGE_ALPHABET,
  CHALLENGE_LENGTH,
  challengeExpiryFrom,
  challengeUsable,
  collectCodeTokens,
  findChallengeInWords,
  generateChallengeValue,
  hashChallengeValue,
  isChallengeExpired,
  normalizeChallengeText,
} from '../../web/src/lib/edgenuity/challenge.ts';
import {
  proofTrust,
  requiredTrustFor,
  sessionTrust,
} from '../../web/src/lib/edgenuity/verification.ts';
import { meetsEnhancedScreenBar, screenEvidenceFrom } from '../../web/src/lib/edgenuity/parser.ts';
import { meetsTrust, weakerTrust } from '../../web/src/types/edgenuity.ts';

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

test('codes use only the unambiguous alphabet', () => {
  for (let i = 0; i < 400; i += 1) {
    const value = generateChallengeValue();
    assert.equal(value.length, CHALLENGE_LENGTH);
    for (const character of value) {
      assert.ok(
        CHALLENGE_ALPHABET.includes(character),
        `${value} contains ${character}, which is not in the alphabet`,
      );
    }
  }
});

test('the alphabet excludes every character pair OCR confuses', () => {
  // This is what lets the matcher demand an exact string instead of guessing
  // through a table of OCR errors.
  for (const banned of ['0', 'O', 'D', 'Q', '1', 'I', 'L', '5', 'S', '8', 'B', '2', 'Z', 'G', 'U', 'V']) {
    assert.equal(
      CHALLENGE_ALPHABET.includes(banned),
      false,
      `${banned} is confusable and must not be in the alphabet`,
    );
  }
});

test('every code contains at least one letter and one digit', () => {
  // Not decoration: it is what stops ordinary page words like MATH or PROGRESS
  // ever being treated as code-like tokens.
  for (let i = 0; i < 200; i += 1) {
    const value = generateChallengeValue();
    assert.match(value, /[A-Z]/, `${value} has no letter`);
    assert.match(value, /[0-9]/, `${value} has no digit`);
  }
});

test('codes are not a repeating or predictable sequence', () => {
  const values = Array.from({ length: 200 }, () => generateChallengeValue());
  const unique = new Set(values);
  // 20^4 with the letter/digit constraint still leaves tens of thousands of
  // options, so 200 draws colliding heavily would mean the source is broken.
  assert.ok(unique.size > 180, `expected mostly distinct codes, got ${unique.size}/200`);
  assert.notEqual(values[0], values[1]);

  // Every position should vary across draws — a stuck index would show here.
  for (let position = 0; position < CHALLENGE_LENGTH; position += 1) {
    const seen = new Set(values.map((v) => v[position]));
    assert.ok(seen.size > 3, `position ${position} only ever produced ${seen.size} characters`);
  }
});

test('the value digest is stable and value-dependent', () => {
  assert.equal(hashChallengeValue('K7M4'), hashChallengeValue('k7m4'));
  assert.notEqual(hashChallengeValue('K7M4'), hashChallengeValue('R9C2'));
});

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

test('normalisation forgives spacing, dashes and case but nothing else', () => {
  assert.equal(normalizeChallengeText('K 7 M 4'), 'K7M4');
  assert.equal(normalizeChallengeText('k-7-m-4'), 'K7M4');
  assert.equal(normalizeChallengeText('  K7m4  '), 'K7M4');
  // A different character is a different code, not a near-enough one.
  assert.notEqual(normalizeChallengeText('K7M9'), 'K7M4');
});

/* ------------------------------------------------------------------ */
/* Lifetime                                                            */
/* ------------------------------------------------------------------ */

const NOW = Date.parse('2026-08-16T10:00:00Z');

function challenge(overrides = {}) {
  const createdAt = new Date(NOW).toISOString();
  return {
    id: 'chl_1',
    assignmentId: 'asg_1',
    sessionId: null,
    phase: 'before',
    type: 'visual_code',
    value: 'K7M4',
    valueHash: hashChallengeValue('K7M4'),
    createdAt,
    expiresAt: challengeExpiryFrom(createdAt),
    status: 'pending',
    attempts: 0,
    ...overrides,
  };
}

const context = (overrides = {}) => ({
  assignmentId: 'asg_1',
  phase: 'before',
  sessionId: null,
  now: NOW + 60_000,
  ...overrides,
});

test('a fresh code is usable, and expires five minutes later', () => {
  assert.deepEqual(challengeUsable(challenge(), context()), { ok: true });
  assert.equal(isChallengeExpired(challenge(), NOW + 4 * 60_000), false);
  assert.equal(isChallengeExpired(challenge(), NOW + 6 * 60_000), true);
  assert.deepEqual(challengeUsable(challenge(), context({ now: NOW + 6 * 60_000 })), {
    ok: false,
    reason: 'expired',
  });
});

test('a spent code can never be spent again', () => {
  const used = challenge({ status: 'verified', usedAt: new Date(NOW).toISOString() });
  assert.deepEqual(challengeUsable(used, context()), { ok: false, reason: 'already_used' });
});

test('a code cannot cross to another assignment', () => {
  assert.deepEqual(challengeUsable(challenge(), context({ assignmentId: 'asg_other' })), {
    ok: false,
    reason: 'wrong_assignment',
  });
});

test('a starting code cannot be used as a final code', () => {
  assert.deepEqual(challengeUsable(challenge(), context({ phase: 'after' })), {
    ok: false,
    reason: 'wrong_phase',
  });
});

test('a final code is bound to its session', () => {
  const forSession = challenge({ phase: 'after', sessionId: 'edg_1' });
  assert.deepEqual(
    challengeUsable(forSession, context({ phase: 'after', sessionId: 'edg_1' })),
    { ok: true },
  );
  assert.deepEqual(
    challengeUsable(forSession, context({ phase: 'after', sessionId: 'edg_2' })),
    { ok: false, reason: 'wrong_session' },
  );
  // A final code with no session attached was never properly issued.
  assert.deepEqual(
    challengeUsable(challenge({ phase: 'after' }), context({ phase: 'after', sessionId: 'edg_1' })),
    { ok: false, reason: 'wrong_session' },
  );
});

test('a missing code is a refusal, not a pass', () => {
  assert.deepEqual(challengeUsable(undefined, context()), { ok: false, reason: 'missing' });
});

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

const word = (text, x0, y0, width = 60, height = 26) => ({
  text,
  x0,
  y0,
  x1: x0 + width,
  y1: y0 + height,
});

/** A page with progress at top-left and a written code down in the corner. */
function pageWith(codeWords, progressRegion = { x0: 40, y0: 300, x1: 300, y1: 400 }) {
  return {
    words: [
      word('Edgenuity', 40, 30),
      word('Physical', 40, 140),
      word('Science', 140, 140),
      word('Course', 40, 300),
      word('Progress', 140, 300),
      word('43%', 40, 350),
      ...codeWords,
    ],
    progressRegion,
  };
}

test('a written code beside the screen is matched exactly', () => {
  const page = pageWith([word('K7M4', 900, 600)]);
  const found = findChallengeInWords(page.words, 'K7M4', {
    progressRegion: page.progressRegion,
  });
  assert.equal(found.matched, true);
  assert.equal(found.matchedText, 'K7M4');
  assert.equal(found.confidence, 1);
  assert.equal(found.separated, true);
});

test('a code OCR split into separate characters is still matched', () => {
  // Hand-written characters are spaced, and Tesseract returns them as words.
  const page = pageWith([
    word('K', 900, 600, 20),
    word('7', 930, 600, 20),
    word('M', 960, 600, 20),
    word('4', 990, 600, 20),
  ]);
  const found = findChallengeInWords(page.words, 'K7M4', {
    progressRegion: page.progressRegion,
  });
  assert.equal(found.matched, true);
});

test('spacing and dashes in the written code are forgiven', () => {
  const page = pageWith([word('K7-M4', 900, 600)]);
  assert.equal(findChallengeInWords(page.words, 'K7M4').matched, true);
});

test('a missing code fails — the Edgenuity screen alone is not enough', () => {
  const page = pageWith([]);
  const found = findChallengeInWords(page.words, 'K7M4', {
    progressRegion: page.progressRegion,
  });
  assert.equal(found.matched, false);
  assert.equal(found.problem, 'not_found');
});

test('a different code fails', () => {
  const page = pageWith([word('R9C2', 900, 600)]);
  assert.equal(findChallengeInWords(page.words, 'K7M4', page).matched, false);
});

test('a nearly-right code is refused rather than rounded up', () => {
  const page = pageWith([word('K7M9', 900, 600)]);
  const found = findChallengeInWords(page.words, 'K7M4', page);
  assert.equal(found.matched, false);
  assert.equal(found.problem, 'low_confidence');
});

test('two different near-misses are ambiguous, and nothing is picked', () => {
  const page = pageWith([word('K7M9', 900, 600), word('K7M3', 900, 660)]);
  const found = findChallengeInWords(page.words, 'K7M4', page);
  assert.equal(found.matched, false);
  assert.equal(found.ambiguous, true);
  assert.equal(found.problem, 'ambiguous');
});

test('decoy codes alongside the right one do not block it', () => {
  /* Writing extra codes gains nothing: the expected value is known before the
     photo, so this confirms one string rather than picking from a list. */
  const page = pageWith([
    word('R9C2', 880, 560),
    word('K7M4', 900, 600),
    word('T3XW', 920, 640),
  ]);
  const found = findChallengeInWords(page.words, 'K7M4', page);
  assert.equal(found.matched, true);
});

test('a code found on top of the progress reading does not count', () => {
  // A "code" recognised inside the progress area is far more likely to be
  // misread page text than a card held beside the screen.
  const page = pageWith([word('K7M4', 60, 330)], { x0: 40, y0: 300, x1: 300, y1: 400 });
  const found = findChallengeInWords(page.words, 'K7M4', {
    progressRegion: page.progressRegion,
  });
  assert.equal(found.matched, false);
  assert.equal(found.problem, 'overlaps_progress');
});

test('ordinary page words are never treated as codes', () => {
  const words = [word('PROGRESS', 40, 300), word('MATH', 140, 300), word('LESSON', 240, 300)];
  assert.deepEqual(collectCodeTokens(words), []);
});

/* ------------------------------------------------------------------ */
/* Trust                                                               */
/* ------------------------------------------------------------------ */

const strongScreen = { score: 0.85, signals: ['edgenuity', 'course_progress', 'course'], confidence: 'high' };
const weakScreen = { score: 0.55, signals: ['course', 'course_progress'], confidence: 'medium' };
const matchedChallenge = { matched: true, matchedText: 'K7M4', confidence: 1, ambiguous: false, separated: true };

test('a frame reaches enhanced only with a live camera, a code and a strong screen', () => {
  assert.equal(
    proofTrust({ source: 'live_camera', parseConfidence: 'high', capturedAt: '', challenge: matchedChallenge, screenEvidence: strongScreen }),
    'enhanced',
  );
  // No code.
  assert.equal(
    proofTrust({ source: 'live_camera', parseConfidence: 'high', capturedAt: '', screenEvidence: strongScreen }),
    'standard',
  );
  // Code, but the screen is not convincing enough for the higher bar.
  assert.equal(
    proofTrust({ source: 'live_camera', parseConfidence: 'high', capturedAt: '', challenge: matchedChallenge, screenEvidence: weakScreen }),
    'standard',
  );
  // Not a live capture at all.
  assert.equal(
    proofTrust({ source: 'fixture', parseConfidence: 'high', capturedAt: '', challenge: matchedChallenge, screenEvidence: strongScreen }),
    'manual',
  );
});

test('a session is only as strong as its weaker half', () => {
  const enhancedProof = { source: 'live_camera', parseConfidence: 'high', capturedAt: '', challenge: matchedChallenge, screenEvidence: strongScreen };
  const standardProof = { source: 'live_camera', parseConfidence: 'high', capturedAt: '', screenEvidence: strongScreen };

  assert.equal(sessionTrust({ before: enhancedProof }, enhancedProof), 'enhanced');
  // A code on the final photo only would leave the starting reading replayable.
  assert.equal(sessionTrust({ before: standardProof }, enhancedProof), 'standard');
  assert.equal(sessionTrust({ before: enhancedProof }, standardProof), 'standard');
  assert.equal(weakerTrust('enhanced', 'standard'), 'standard');
});

test('the global setting raises the floor and never lowers it', () => {
  assert.equal(requiredTrustFor({ targetType: 'progress_percent' }, 'standard'), 'standard');
  assert.equal(requiredTrustFor({ targetType: 'progress_percent' }, 'enhanced'), 'enhanced');
  // Per-assignment Enhanced survives a Standard global setting.
  assert.equal(
    requiredTrustFor({ targetType: 'progress_percent', requiredVerificationTrust: 'enhanced' }, 'standard'),
    'enhanced',
  );
  // And a Standard assignment cannot opt out of an Enhanced global setting.
  assert.equal(
    requiredTrustFor({ targetType: 'progress_percent', requiredVerificationTrust: 'standard' }, 'enhanced'),
    'enhanced',
  );
});

test('trust ordering is manual < standard < enhanced', () => {
  assert.ok(meetsTrust('enhanced', 'standard'));
  assert.ok(meetsTrust('standard', 'standard'));
  assert.equal(meetsTrust('standard', 'enhanced'), false);
  assert.equal(meetsTrust('manual', 'standard'), false);
});

/* ------------------------------------------------------------------ */
/* Screen evidence                                                     */
/* ------------------------------------------------------------------ */

test('Enhanced Proof needs a higher screen bar than Standard', () => {
  const strong = screenEvidenceFrom({
    edgenuitySignals: ['edgenuity', 'course_progress', 'course', 'activity'],
    screenScore: 0.8,
    detectedProgressPercent: 43,
    detectedCourse: 'Physical Science Semester A',
    percentCandidates: [{ value: 43, score: 0.75, reasons: [], context: '' }],
    parseConfidence: 'high',
  });
  assert.equal(strong.confidence, 'high');
  assert.ok(meetsEnhancedScreenBar(strong));

  // Enough to pass Standard recognition, not enough to carry an Enhanced claim.
  const thin = screenEvidenceFrom({
    edgenuitySignals: ['course_progress'],
    screenScore: 0.5,
    percentCandidates: [],
    parseConfidence: 'medium',
  });
  assert.equal(meetsEnhancedScreenBar(thin), false);
});

test('a rebranded deployment still clears the bar without the Edgenuity wordmark', () => {
  // Districts rebrand; the bar is signal-based so a rebrand costs a signal, not
  // the whole verification.
  const rebranded = screenEvidenceFrom({
    edgenuitySignals: ['imagine_learning', 'course_progress', 'course', 'activity', 'coursework'],
    screenScore: 0.75,
    detectedProgressPercent: 43,
    detectedCourse: 'Physical Science Semester A',
    percentCandidates: [{ value: 43, score: 0.7, reasons: [], context: '' }],
    parseConfidence: 'high',
  });
  assert.ok(meetsEnhancedScreenBar(rebranded));
});
