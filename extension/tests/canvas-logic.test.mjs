/**
 * Pure Canvas logic tests — no DOM, no Chrome. Runs with `node --test`.
 *
 * Covers URL/identifier handling, status normalisation and the message schema
 * validation that guards the trust boundary. DOM parsing is tested separately
 * in canvas-parser.test.mjs against real fixture pages in a real browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assignmentUrl,
  classifyCanvasUrl,
  idsFromHref,
  isConfiguredCanvasUrl,
  normalizeCanvasDomain,
  originPattern,
} from '../canvas/urls.js';
import {
  coerceStatus,
  combineSignals,
  isVerifiedComplete,
  mergeStatus,
  signalsFromText,
} from '../canvas/status.js';
import {
  validateDetectedAssignment,
  validateDetectionMessage,
  CANVAS_MSG,
} from '../canvas/messaging.js';
import { LIMITS } from '../canvas/types.js';

/* ------------------------------------------------------------------ */
/* Domains — schools do not all live on instructure.com                */
/* ------------------------------------------------------------------ */

test('normalizes Canvas domains from whatever the student pastes', () => {
  assert.equal(normalizeCanvasDomain('https://myschool.instructure.com'), 'myschool.instructure.com');
  assert.equal(normalizeCanvasDomain('myschool.instructure.com'), 'myschool.instructure.com');
  assert.equal(normalizeCanvasDomain('https://canvas.schooldistrict.org/login'), 'canvas.schooldistrict.org');
  assert.equal(normalizeCanvasDomain('  HTTPS://District.Instructure.COM:443/  '), 'district.instructure.com');
});

test('rejects domains that are not usable Canvas hosts', () => {
  for (const bad of ['', '   ', 'localhost', 'notadomain', '10.0.0.5', 'bad-.com', 'a..b.com']) {
    assert.equal(normalizeCanvasDomain(bad), null, `expected ${JSON.stringify(bad)} rejected`);
  }
});

test('builds a single-origin permission pattern, never a wildcard', () => {
  assert.equal(originPattern('myschool.instructure.com'), 'https://myschool.instructure.com/*');
  assert.equal(originPattern('nonsense'), null);
});

test('only https on the configured host counts as Canvas', () => {
  const domain = 'myschool.instructure.com';
  assert.ok(isConfiguredCanvasUrl('https://myschool.instructure.com/courses/1', domain));
  // Subdomains of the configured host are still that school's Canvas.
  assert.ok(isConfiguredCanvasUrl('https://sub.myschool.instructure.com/courses/1', domain));
  // Plain http must never be trusted as Canvas.
  assert.equal(isConfiguredCanvasUrl('http://myschool.instructure.com/courses/1', domain), false);
  // A lookalike host must not pass.
  assert.equal(isConfiguredCanvasUrl('https://evil-myschool.instructure.com/', domain), false);
  assert.equal(isConfiguredCanvasUrl('https://myschool.instructure.com.evil.net/', domain), false);
  assert.equal(isConfiguredCanvasUrl('https://other.instructure.com/', domain), false);
});

/* ------------------------------------------------------------------ */
/* Identifiers come from URLs, never titles                            */
/* ------------------------------------------------------------------ */

test('classifies Canvas routes and extracts ids', () => {
  assert.deepEqual(classifyCanvasUrl('https://c.edu/courses/101/assignments/5001'), {
    kind: 'assignment',
    courseId: '101',
    assignmentId: '5001',
  });
  assert.deepEqual(classifyCanvasUrl('https://c.edu/courses/101/quizzes/7001'), {
    kind: 'quiz',
    courseId: '101',
    assignmentId: 'quiz_7001',
  });
  assert.equal(classifyCanvasUrl('https://c.edu/courses/101/assignments').kind, 'assignments_index');
  assert.equal(classifyCanvasUrl('https://c.edu/courses/101').kind, 'course');
  assert.equal(classifyCanvasUrl('https://c.edu/').kind, 'dashboard');
  assert.equal(classifyCanvasUrl('https://c.edu/dashboard').kind, 'dashboard');
  assert.equal(classifyCanvasUrl('https://c.edu/random/page').kind, 'unknown');
  assert.equal(classifyCanvasUrl('not a url').kind, 'unknown');
});

test('reads ids out of relative hrefs on list pages', () => {
  const base = 'https://myschool.instructure.com/courses/101/assignments';
  const ids = idsFromHref('/courses/101/assignments/5001', base);
  assert.deepEqual(
    { c: ids.externalCourseId, a: ids.externalAssignmentId, k: ids.kind },
    { c: '101', a: '5001', k: 'assignment' },
  );
  // Links that are not assignments yield nothing.
  assert.equal(idsFromHref('/courses/101/pages/syllabus', base), null);
  assert.equal(idsFromHref('', base), null);
  assert.equal(idsFromHref('javascript:alert(1)', base), null);
});

test('rebuilds a canonical assignment URL for Open in Canvas', () => {
  assert.equal(
    assignmentUrl('myschool.instructure.com', '101', '5001'),
    'https://myschool.instructure.com/courses/101/assignments/5001',
  );
  assert.equal(
    assignmentUrl('myschool.instructure.com', '101', 'quiz_7001'),
    'https://myschool.instructure.com/courses/101/quizzes/7001',
  );
});

/* ------------------------------------------------------------------ */
/* Status policy — the safety-critical part                            */
/* ------------------------------------------------------------------ */

test('only submitted, graded and late_submitted count as complete', () => {
  assert.ok(isVerifiedComplete('submitted'));
  assert.ok(isVerifiedComplete('graded'));
  assert.ok(isVerifiedComplete('late_submitted'));
  for (const status of ['unknown', 'not_submitted', 'missing', 'verification_unavailable']) {
    assert.equal(isVerifiedComplete(status), false, `${status} must not complete work`);
  }
});

test('late plus submitted normalises to late_submitted and still counts', () => {
  const status = combineSignals({ submitted: true, late: true });
  assert.equal(status, 'late_submitted');
  assert.ok(isVerifiedComplete(status));
});

test('missing never becomes complete, even alongside a late flag', () => {
  assert.equal(combineSignals({ missing: true, late: true }), 'missing');
  assert.equal(isVerifiedComplete(combineSignals({ missing: true })), false);
});

test('graded implies completion without needing a score', () => {
  assert.equal(combineSignals({ graded: true }), 'graded');
});

test('no recognisable signal degrades to verification_unavailable', () => {
  assert.equal(combineSignals({}), 'verification_unavailable');
  assert.equal(coerceStatus('totally-made-up'), 'verification_unavailable');
  assert.equal(coerceStatus(undefined), 'verification_unavailable');
  assert.equal(isVerifiedComplete(coerceStatus('submitted-ish')), false);
});

test('"not submitted" is not read as "submitted"', () => {
  const signals = signalsFromText('Submission: Not Submitted');
  assert.equal(signals.submitted, false);
  assert.equal(signals.explicitlyNotSubmitted, true);
  assert.equal(combineSignals(signals), 'not_submitted');
});

test('text signals pick up the real states', () => {
  assert.equal(combineSignals(signalsFromText('Submitted!')), 'submitted');
  assert.equal(combineSignals(signalsFromText('Graded')), 'graded');
  assert.equal(combineSignals(signalsFromText('Missing')), 'missing');
  assert.equal(combineSignals(signalsFromText('Late Submitted')), 'late_submitted');
});

test('a weaker later reading never downgrades a verified one', () => {
  assert.equal(mergeStatus('graded', 'unknown'), 'graded');
  assert.equal(mergeStatus('submitted', 'verification_unavailable'), 'submitted');
  assert.equal(mergeStatus('submitted', 'not_submitted'), 'submitted');
  // But a stronger reading does win.
  assert.equal(mergeStatus('not_submitted', 'submitted'), 'submitted');
  assert.equal(mergeStatus('submitted', 'graded'), 'graded');
  assert.equal(mergeStatus('unknown', 'missing'), 'missing');
});

/* ------------------------------------------------------------------ */
/* Message validation — untrusted page data                            */
/* ------------------------------------------------------------------ */

const DOMAIN = 'myschool.instructure.com';

function validDetection(overrides = {}) {
  return {
    externalCourseId: '101',
    externalAssignmentId: '5001',
    title: 'Chapter 7 Homework',
    url: `https://${DOMAIN}/courses/101/assignments/5001`,
    submissionStatus: 'submitted',
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('accepts a well-formed detection', () => {
  const clean = validateDetectedAssignment(validDetection(), DOMAIN);
  assert.equal(clean.externalAssignmentId, '5001');
  assert.equal(clean.submissionStatus, 'submitted');
});

test('rejects detections without both identifiers', () => {
  assert.equal(validateDetectedAssignment(validDetection({ externalCourseId: '' }), DOMAIN), null);
  assert.equal(
    validateDetectedAssignment(validDetection({ externalAssignmentId: 'abc' }), DOMAIN),
    null,
  );
  assert.equal(validateDetectedAssignment(validDetection({ title: '' }), DOMAIN), null);
});

test('rejects URLs that are not https on the configured host', () => {
  for (const url of [
    'http://myschool.instructure.com/courses/101/assignments/5001',
    'https://evil.example/courses/101/assignments/5001',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ]) {
    assert.equal(validateDetectedAssignment(validDetection({ url }), DOMAIN), null, url);
  }
});

test('caps oversized text instead of trusting it', () => {
  const clean = validateDetectedAssignment(
    validDetection({ title: 'x'.repeat(5000), courseName: 'y'.repeat(5000) }),
    DOMAIN,
  );
  assert.equal(clean.title.length, LIMITS.MAX_TITLE_LENGTH);
  assert.equal(clean.courseName.length, LIMITS.MAX_COURSE_NAME_LENGTH);
});

test('unknown fields from a page are dropped, not copied through', () => {
  const clean = validateDetectedAssignment(
    validDetection({ evil: 'payload', __proto__: { polluted: true } }),
    DOMAIN,
  );
  assert.equal('evil' in clean, false);
  assert.equal(clean.polluted, undefined);
});

test('an unrecognised status can never arrive as complete', () => {
  const clean = validateDetectedAssignment(
    validDetection({ submissionStatus: 'definitely_submitted_trust_me' }),
    DOMAIN,
  );
  assert.equal(clean.submissionStatus, 'verification_unavailable');
  assert.equal(isVerifiedComplete(clean.submissionStatus), false);
});

test('detection messages from the wrong domain are rejected', () => {
  const message = {
    type: CANVAS_MSG.DETECTION,
    domain: 'evil.example.com',
    assignments: [validDetection()],
    readable: true,
  };
  assert.equal(validateDetectionMessage(message, DOMAIN), null);
});

test('messages of the wrong type are rejected', () => {
  assert.equal(
    validateDetectionMessage({ type: 'CANVAS_SUBMITTED', domain: DOMAIN }, DOMAIN),
    null,
  );
  assert.equal(validateDetectionMessage(null, DOMAIN), null);
  assert.equal(validateDetectionMessage('CANVAS_DETECTION', DOMAIN), null);
});

test('a flood of assignments is capped', () => {
  const many = Array.from({ length: 5000 }, (_, i) =>
    validDetection({ externalAssignmentId: String(9000 + i) }),
  );
  const clean = validateDetectionMessage(
    { type: CANVAS_MSG.DETECTION, domain: DOMAIN, assignments: many, readable: true },
    DOMAIN,
  );
  assert.equal(clean.assignments.length <= LIMITS.MAX_ASSIGNMENTS_PER_MESSAGE, true);
});

test('individually invalid rows are dropped, valid ones survive', () => {
  const clean = validateDetectionMessage(
    {
      type: CANVAS_MSG.DETECTION,
      domain: DOMAIN,
      readable: true,
      assignments: [
        validDetection(),
        { garbage: true },
        validDetection({ url: 'http://insecure.example/x' }),
        validDetection({ externalAssignmentId: '5002', title: 'Chapter 8' }),
      ],
    },
    DOMAIN,
  );
  assert.equal(clean.assignments.length, 2);
  assert.deepEqual(
    clean.assignments.map((a) => a.externalAssignmentId),
    ['5001', '5002'],
  );
});
