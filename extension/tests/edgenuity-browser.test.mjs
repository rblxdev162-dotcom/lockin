/**
 * Edgenuity Browser Connection — logic tests.
 *
 * Pure Node, no browser. `urls.js` and `messaging.js` are pure functions;
 * `detector.js` and `parser.js` touch only a handful of DOM methods, so they
 * are exercised against a small document stub rather than a real browser.
 *
 * There are deliberately NO markup fixtures here. Edgenuity's real markup is
 * unpublished and behind a login (see the research brief), so a fixture would
 * be an invention testing the parser against itself. What is tested instead is
 * the behaviour that has to hold whatever the markup turns out to be: the
 * origin gate, the assessment refusal, the conflict refusal, and the caps.
 *
 * Run: node --test extension/tests/edgenuity-browser.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isEdgenuityUrl, looksLikeAssessmentUrl, courseIdFromUrl, originPatterns } from '../edgenuity/urls.js';
import { detectEdgenuityPage } from '../edgenuity/detector.js';
import { parseEdgenuityPage, readActivityCounts, readLabelledPercent, readProgressBar } from '../edgenuity/parser.js';
import { validateCourseProgress, validateEdgenuityMessage, EDGENUITY_MSG } from '../edgenuity/messaging.js';
import { LIMITS } from '../edgenuity/types.js';

/* ------------------------------------------------------------------ */
/* A document stub — only what the detector and parser actually touch. */
/* ------------------------------------------------------------------ */

function element({ attrs = {}, text = '', parentText = null } = {}) {
  return {
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    textContent: text,
    parentElement: parentText === null ? null : { textContent: parentText },
  };
}

function doc({ title = '', text = '', matches = {} } = {}) {
  return {
    title,
    body: { innerText: text, textContent: text },
    querySelector: (selector) => {
      const hit = Object.entries(matches).find(([key]) => selector.includes(key));
      const value = hit?.[1];
      return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
    },
    querySelectorAll: (selector) => {
      const hit = Object.entries(matches).find(([key]) => selector.includes(key));
      const value = hit?.[1];
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    },
  };
}

/** A page that passes the detector, so parser tests can vary one thing. */
const EDGENUITY_URL = 'https://learn.edgenuity.com/student/course/12345';
function coursePage({ text, title = 'Algebra I | Imagine Edgenuity', bars } = {}) {
  return doc({
    title,
    text,
    matches: {
      'script[src*="edgenuity"]': element({}),
      'link[href*="edgenuity"]': element({}),
      'role="progressbar"': bars,
      h1: element({ text: 'Algebra I' }),
    },
  });
}

/* ------------------------------------------------------------------ */
/* Origin gate                                                         */
/* ------------------------------------------------------------------ */

test('only https Edgenuity hosts are accepted', () => {
  assert.equal(isEdgenuityUrl('https://learn.edgenuity.com/student'), true);
  assert.equal(isEdgenuityUrl('https://r99.core.learn.edgenuity.com/x'), true);
  assert.equal(isEdgenuityUrl('https://help.imagineedgenuity.com/x'), true);
  // http, and hosts that merely end in the same letters, are not Edgenuity.
  assert.equal(isEdgenuityUrl('http://learn.edgenuity.com/'), false);
  assert.equal(isEdgenuityUrl('https://notedgenuity.com/'), false);
  assert.equal(isEdgenuityUrl('https://edgenuity.com.evil.example/'), false);
  assert.equal(isEdgenuityUrl('https://canvas.instructure.com/'), false);
});

test('the host permission is scoped to Edgenuity, never to all sites', () => {
  const patterns = originPatterns();
  assert.ok(patterns.length > 0);
  for (const pattern of patterns) {
    assert.ok(pattern.startsWith('https://'), pattern);
    assert.ok(/edgenuity\.com\/\*$/.test(pattern), pattern);
  }
  assert.ok(!patterns.includes('https://*/*'));
});

test('a non-Edgenuity page is refused before anything is read', () => {
  const result = detectEdgenuityPage(coursePage({ text: 'Progress 40%' }), 'https://example.com/x');
  assert.equal(result.isEdgenuity, false);
  assert.equal(result.reason, 'origin-mismatch');
});

/* ------------------------------------------------------------------ */
/* Assessment refusal — checked twice, either hit disqualifies         */
/* ------------------------------------------------------------------ */

test('assessment URLs are refused', () => {
  for (const url of [
    'https://learn.edgenuity.com/Player/Quiz?id=3',
    'https://learn.edgenuity.com/student/unit-test/9',
    'https://learn.edgenuity.com/x?activity=cumulative_exam',
  ]) {
    assert.equal(looksLikeAssessmentUrl(url), true, url);
    assert.equal(detectEdgenuityPage(coursePage({ text: '' }), url).safeToRead, false, url);
  }
});

test('a course-shaped URL is not mistaken for an assessment', () => {
  assert.equal(looksLikeAssessmentUrl(EDGENUITY_URL), false);
});

test('assessment content is refused even when the URL looks innocent', () => {
  const page = coursePage({ text: 'Unit Test  Begin the test when you are ready. Progress 40% complete' });
  const result = detectEdgenuityPage(page, EDGENUITY_URL);
  assert.equal(result.isEdgenuity, true);
  assert.equal(result.safeToRead, false);
  assert.equal(result.reason, 'assessment-content');
});

test('a proctored page is refused', () => {
  const page = coursePage({ text: 'Proctorio Lockdown Browser is required for this exam.' });
  assert.equal(detectEdgenuityPage(page, EDGENUITY_URL).safeToRead, false);
});

/* ------------------------------------------------------------------ */
/* Reading progress                                                    */
/* ------------------------------------------------------------------ */

test('activity counts are read from rendered text', () => {
  assert.deepEqual(readActivityCounts('You have completed 12 of 40 activities'), {
    completed: 12,
    total: 40,
  });
  assert.deepEqual(readActivityCounts('7/21 lessons complete'), { completed: 7, total: 21 });
});

test('impossible or conflicting counts are refused', () => {
  // More completed than exist.
  assert.equal(readActivityCounts('41 of 40 activities'), null);
  // Two different pairs on one page: no way to tell which is this course.
  assert.equal(readActivityCounts('12 of 40 activities … 3 of 9 activities'), null);
  // Beyond any real course.
  assert.equal(readActivityCounts(`5 of ${LIMITS.MAX_ACTIVITIES + 1} activities`), null);
});

test('a percentage is only believed when the page labels it as progress', () => {
  assert.equal(readLabelledPercent('Course progress: 43%'), 43);
  assert.equal(readLabelledPercent('43% complete'), 43);
  // A bare percentage on a course page is at least as likely to be a grade.
  assert.equal(readLabelledPercent('Your score: 43%'), null);
});

test('a progress bar is read through ARIA, not through class names', () => {
  const bar = element({
    attrs: { 'aria-valuenow': '43', 'aria-valuemax': '100', 'aria-label': 'Course progress' },
  });
  assert.equal(readProgressBar(doc({ matches: { 'role="progressbar"': bar } })), 43);
});

test('progress bars that are not course progress are ignored', () => {
  const upload = element({ attrs: { 'aria-valuenow': '90', 'aria-label': 'Upload' } });
  assert.equal(readProgressBar(doc({ matches: { 'role="progressbar"': upload } })), null);
});

test('a readable course page yields an id, a name and the numbers', () => {
  const bar = element({
    attrs: { 'aria-valuenow': '43', 'aria-valuemax': '100', 'aria-label': 'Course progress' },
  });
  const page = coursePage({ text: 'Course progress 43% — 12 of 40 activities complete', bars: bar });
  const result = parseEdgenuityPage(page, EDGENUITY_URL);

  assert.equal(result.readable, true);
  assert.equal(result.course.externalCourseId, '12345');
  assert.equal(result.course.courseName, 'Algebra I');
  assert.equal(result.course.progressPercent, 43);
  assert.equal(result.course.activitiesCompleted, 12);
  assert.equal(result.course.activitiesTotal, 40);
});

test('two readings that disagree are refused, not averaged', () => {
  const bar = element({
    attrs: { 'aria-valuenow': '90', 'aria-valuemax': '100', 'aria-label': 'Course progress' },
  });
  const page = coursePage({ text: 'Course progress 43% complete', bars: bar });
  const result = parseEdgenuityPage(page, EDGENUITY_URL);
  assert.equal(result.readable, false);
  assert.equal(result.reason, 'percent-conflict');
});

test('a page with no progress on it is unreadable, not zero', () => {
  const result = parseEdgenuityPage(coursePage({ text: 'Welcome back!' }), EDGENUITY_URL);
  assert.equal(result.readable, false);
  assert.notEqual(result.reason, undefined);
});

/* ------------------------------------------------------------------ */
/* Trust boundary                                                      */
/* ------------------------------------------------------------------ */

test('unknown fields are dropped rather than copied through', () => {
  const clean = validateCourseProgress({
    externalCourseId: '12345',
    courseName: 'Algebra I',
    progressPercent: 43,
    activitiesCompleted: 12,
    activitiesTotal: 40,
    // None of these exist in the schema; none may survive.
    activityTitles: ['Lesson 1: Slope'],
    answers: 'B, C, A',
    html: '<script>alert(1)</script>',
  });
  assert.deepEqual(Object.keys(clean).sort(), [
    'activitiesCompleted',
    'activitiesTotal',
    'courseName',
    'externalCourseId',
    'progressPercent',
    'readAt',
  ]);
});

test('out-of-range numbers are dropped, and a reading with nothing left is refused', () => {
  assert.equal(validateCourseProgress({ externalCourseId: 'a', progressPercent: 900 }), null);
  assert.equal(validateCourseProgress({ externalCourseId: 'a', progressPercent: -5 }), null);
  // A half-pair is not a pair.
  assert.equal(validateCourseProgress({ externalCourseId: 'a', activitiesCompleted: 5 }), null);
  // Completed cannot exceed total.
  assert.equal(
    validateCourseProgress({ externalCourseId: 'a', activitiesCompleted: 9, activitiesTotal: 4 }),
    null,
  );
});

test('a course reading with no identity is refused', () => {
  assert.equal(validateCourseProgress({ progressPercent: 40 }), null);
});

test('strings are capped and whitespace-normalised', () => {
  const clean = validateCourseProgress({
    externalCourseId: 'x'.repeat(500),
    courseName: '  Algebra\n\n   I  ' + 'y'.repeat(500),
    progressPercent: 10,
  });
  assert.equal(clean.externalCourseId.length, LIMITS.MAX_ID_LENGTH);
  assert.equal(clean.courseName.length, LIMITS.MAX_COURSE_NAME_LENGTH);
  assert.ok(clean.courseName.startsWith('Algebra I'));
});

test('one page cannot flood the extension with courses', () => {
  const courses = Array.from({ length: 500 }, (_, i) => ({
    externalCourseId: String(i),
    progressPercent: 10,
  }));
  const clean = validateEdgenuityMessage({ type: EDGENUITY_MSG.DETECTION, courses });
  assert.equal(clean.courses.length, LIMITS.MAX_COURSES_PER_MESSAGE);
});

test('a message that is not a detection, or carries nothing valid, is rejected', () => {
  assert.equal(validateEdgenuityMessage({ type: 'SOMETHING_ELSE', courses: [] }), null);
  assert.equal(validateEdgenuityMessage({ type: EDGENUITY_MSG.DETECTION, courses: [] }), null);
  assert.equal(validateEdgenuityMessage(null), null);
  assert.equal(
    validateEdgenuityMessage({ type: EDGENUITY_MSG.DETECTION, courses: [{ junk: true }] }),
    null,
  );
});
