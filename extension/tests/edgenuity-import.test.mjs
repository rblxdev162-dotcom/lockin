/**
 * The Edgenuity legitimate-import path: progress emails, course reports, and
 * the merge that keeps one course from becoming two.
 *
 * Everything is fixture-driven and local. Nothing here logs into anything,
 * fetches anything, or touches a real account.
 *
 * Run: npm run test:edgenuity-import
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from './fixtures/edgenuity/reports.mjs';

const { parseProgressEmail, htmlToText, normaliseDate, detectProduct, MATCHERS } = await import(
  '../../web/src/lib/edgenuity/progressEmail.ts'
);
const { parseCourseReport, parseDelimited, readCompletion, mapHeader } = await import(
  '../../web/src/lib/edgenuity/courseReport.ts'
);
const { mergeProgressEmail, mergeCourseReport, courseKey, fieldProvenance } = await import(
  '../../web/src/lib/edgenuity/merge.ts'
);
const { coursePace } = await import('../../web/src/lib/pace/courses.ts');
const { GmailProgressAdapter, QUERY, SCOPES } = await import(
  '../../web/src/lib/edgenuity/gmailAdapter.ts'
);
const { reducer } = await import('../../web/src/store/reducer.ts');
const { defaultState } = await import('../../web/src/lib/storage.ts');

const NOW = Date.parse('2026-03-10T18:00:00Z');
const DAY = 86_400_000;

const emailSource = (at = NOW) => ({
  kind: 'EDGENUITY_PROGRESS_EMAIL',
  sourceId: 'edgenuity-email',
  confidence: 'high',
  isLive: false,
  rawDataRetained: false,
  lastSyncedAt: new Date(at).toISOString(),
});

const reportSource = (at = NOW) => ({
  kind: 'EDGENUITY_COURSE_REPORT',
  sourceId: 'edgenuity-report',
  confidence: 'high',
  isLive: false,
  rawDataRetained: false,
  lastSyncedAt: new Date(at).toISOString(),
});

/* ------------------------------------------------------------------ */
/* Progress emails                                                     */
/* ------------------------------------------------------------------ */

test('a table-shaped report yields one course per row with its own numbers', () => {
  const result = parseProgressEmail(F.EMAIL_TABLE);
  assert.equal(result.ok, true);
  assert.equal(result.courses.length, 2);

  const algebra = result.courses.find((c) => c.courseName === 'Algebra I');
  assert.equal(algebra.actualProgressPercent, 61.7);
  assert.equal(algebra.targetProgressPercent, 57.2);
  assert.equal(algebra.overallGrade, 88);
  assert.equal(algebra.relativeGrade, 91);

  const science = result.courses.find((c) => c.courseName.startsWith('Physical Science'));
  assert.equal(science.actualProgressPercent, 40);
  assert.equal(science.targetProgressPercent, 57);
});

test('a block-shaped report parses the same way', () => {
  const result = parseProgressEmail(F.EMAIL_BLOCKS);
  assert.equal(result.courses.length, 2);
  const algebra = result.courses[0];
  assert.equal(algebra.actualProgressPercent, 61.7);
  assert.equal(algebra.startDate, '2025-08-18');
  assert.equal(algebra.targetEndDate, '2026-05-29');
});

test('the report’s own timestamp is read, not the moment of import', () => {
  assert.equal(parseProgressEmail(F.EMAIL_TABLE).reportedAt, '2026-03-10T00:00:00.000Z');
  assert.equal(parseProgressEmail(F.EMAIL_BLOCKS).reportedAt, '2026-03-10T00:00:00.000Z');
});

test('missing metrics stay missing — nothing is invented', () => {
  const result = parseProgressEmail(F.EMAIL_PARTIAL);
  const course = result.courses[0];
  assert.equal(course.actualProgressPercent, 22);
  assert.equal(course.targetProgressPercent, undefined);
  assert.equal(course.overallGrade, undefined);
  assert.equal(course.relativeGrade, undefined);
});

test('a course with no numbers at all is not imported as an empty card', () => {
  const result = parseProgressEmail(F.EMAIL_EMPTY);
  assert.equal(result.ok, false);
  assert.equal(result.courses.length, 0);
  assert.match(result.error, /No course progress/i);
});

test('impossible percentages are refused rather than clamped into a lie', () => {
  // 999% is not 100%, and -20% is not 0%. Both are dropped, which leaves the
  // course with no readable metric — so it is not imported at all rather than
  // appearing as a card with nothing on it.
  const result = parseProgressEmail(F.EMAIL_ABSURD);
  assert.equal(result.ok, false);
  assert.equal(result.courses.length, 0);
});

test('the product is read from the report, never guessed', () => {
  assert.equal(detectProduct('Imagine Edgenuity progress'), 'EDGENUITY');
  assert.equal(detectProduct('EdgeEX Progress Summary'), 'EDGEEX');
  assert.equal(detectProduct('Progress Summary'), 'UNKNOWN');
  assert.equal(parseProgressEmail(F.EMAIL_EDGEEX).courses[0].product, 'EDGEEX');
  assert.equal(parseProgressEmail(F.EMAIL_UNBRANDED).courses[0].product, 'UNKNOWN');
});

test('an unknown product warns that pacing is LockIn’s estimate', () => {
  const result = parseProgressEmail(F.EMAIL_UNBRANDED);
  assert.ok(result.warnings.some((w) => /estimate/i.test(w)));
});

test('a published status is kept verbatim; nothing else is called official', () => {
  assert.equal(parseProgressEmail(F.EMAIL_WITH_STATUS).courses[0].officialStatus, 'AHEAD');
  assert.equal(parseProgressEmail(F.EMAIL_TABLE).courses[0].officialStatus, undefined);
});

test('HTML is turned into text without ever building a node', () => {
  const before = globalThis.stolen;
  const text = htmlToText(F.EMAIL_HOSTILE);
  assert.equal(globalThis.stolen, before, 'no script ran');
  assert.ok(!/<script/i.test(text));
  assert.ok(!/onerror/i.test(text));
  assert.ok(!/display: none/i.test(text), 'style bodies go too');

  const result = parseProgressEmail(F.EMAIL_HOSTILE);
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].actualProgressPercent, 61.7);
});

test('dates normalise, and an impossible one is dropped', () => {
  assert.equal(normaliseDate('3/12/2026'), '2026-03-12');
  assert.equal(normaliseDate('2026-03-12'), '2026-03-12');
  assert.equal(normaliseDate('25/03/2026'), '2026-03-25', 'read the other way round rather than lost');
  assert.equal(normaliseDate('13/13/2026'), undefined);
  assert.equal(normaliseDate('not a date'), undefined);
});

test('every field LockIn claims to read has exactly one matcher', () => {
  for (const field of ['actualProgressPercent', 'targetProgressPercent', 'overallGrade', 'actualGrade', 'relativeGrade']) {
    assert.ok(MATCHERS[field] instanceof RegExp, `${field} has no matcher`);
  }
});

/* ------------------------------------------------------------------ */
/* Course reports                                                      */
/* ------------------------------------------------------------------ */

test('a quoted comma inside an activity name does not shift every column', () => {
  const rows = parseDelimited('a,"b,c",d\n', ',');
  assert.deepEqual(rows[0], ['a', 'b,c', 'd']);
  const report = parseCourseReport(F.REPORT_CSV);
  assert.ok(report.activities.some((a) => a.name === 'Graphing Systems, Part 2'));
});

test('a CSV report yields activities, dates and tri-state completion', () => {
  const report = parseCourseReport(F.REPORT_CSV);
  assert.equal(report.ok, true);
  assert.equal(report.courseName, 'Algebra I');
  assert.equal(report.activities.length, 4);

  const byName = Object.fromEntries(report.activities.map((a) => [a.name, a]));
  assert.equal(byName['Quadratic Functions'].completed, true);
  assert.equal(byName['Quadratic Functions'].scheduledDate, '2026-03-11');
  assert.equal(byName['Systems Review'].completed, false);
  // The blank cell is the important one: it must not read as "not completed".
  assert.equal(byName['Unit 4 Quiz'].completed, undefined);
});

test('percentages in the report header are read too', () => {
  const report = parseCourseReport(F.REPORT_CSV);
  assert.equal(report.actualProgressPercent, 61.7);
  assert.equal(report.targetProgressPercent, 57.2);
});

test('a blank status is never read as a state', () => {
  assert.equal(readCompletion(''), undefined);
  assert.equal(readCompletion(undefined), undefined);
  assert.equal(readCompletion('0%'), undefined, 'a score is not a status');
  assert.equal(readCompletion('Completed'), true);
  assert.equal(readCompletion('Not Started'), false);
});

test('tabs, HTML and repeated headers all parse', () => {
  assert.equal(parseCourseReport(F.REPORT_TSV).activities.length, 2);
  assert.equal(parseCourseReport(F.REPORT_HTML).activities.length, 2);
  const repeated = parseCourseReport(F.REPORT_REPEATED_HEADER);
  assert.equal(repeated.activities.length, 2, 'the repeated header row is not an activity');
});

test('a multi-course report warns rather than mixing two courses’ pacing', () => {
  const report = parseCourseReport(F.REPORT_MULTI_COURSE);
  assert.ok(report.warnings.some((w) => /one at a time/i.test(w)));
});

test('a file with no activity column is refused with a reason', () => {
  const report = parseCourseReport(F.REPORT_UNRECOGNISED);
  assert.equal(report.ok, false);
  assert.match(report.error, /activity column/i);
});

test('the header row is found even when a title block sits above it', () => {
  const columns = mapHeader(['Activity', 'Type', 'Scheduled Date', 'Status', 'Score']);
  assert.equal(columns.activity, 0);
  assert.equal(columns.scheduledDate, 2);
  assert.equal(columns.status, 3);
});

/* ------------------------------------------------------------------ */
/* The merge                                                           */
/* ------------------------------------------------------------------ */

test('a report and an email describing one course produce one course', () => {
  const report = parseCourseReport(F.REPORT_CSV);
  const afterReport = mergeCourseReport([], report, 'Algebra I', reportSource(NOW - 3 * DAY), NOW);
  assert.equal(afterReport.courses.length, 1);

  const email = parseProgressEmail(F.EMAIL_TABLE);
  const afterEmail = mergeProgressEmail(
    afterReport.courses,
    email.courses,
    emailSource(NOW),
    NOW,
    email.reportedAt,
  );

  assert.equal(
    afterEmail.courses.filter((c) => courseKey(c.name) === courseKey('Algebra I')).length,
    1,
    'two Edgenuity sources must not create two Algebra courses',
  );
});

test('each field keeps the provenance of the source that actually knows it', () => {
  const report = parseCourseReport(F.REPORT_CSV);
  const withReport = mergeCourseReport([], report, 'Algebra I', reportSource(NOW - 3 * DAY), NOW);
  const email = parseProgressEmail(F.EMAIL_TABLE);
  const merged = mergeProgressEmail(withReport.courses, email.courses, emailSource(NOW), NOW);

  const algebra = merged.courses.find((c) => courseKey(c.name) === courseKey('Algebra I'));
  assert.equal(algebra.actualProgressPercent.source.kind, 'EDGENUITY_PROGRESS_EMAIL');
  assert.equal(algebra.activitySource.kind, 'EDGENUITY_COURSE_REPORT');
  assert.ok(algebra.activities.length > 0, 'the schedule survives the email merge');

  const rows = fieldProvenance(algebra);
  assert.ok(rows.some((r) => r.label === 'Current progress'));
  assert.ok(rows.some((r) => r.label === 'Activity schedule'));
});

test('a stale re-import cannot overwrite this morning’s numbers', () => {
  const email = parseProgressEmail(F.EMAIL_TABLE);
  const fresh = mergeProgressEmail([], email.courses, emailSource(NOW), NOW);

  const old = parseCourseReport(F.REPORT_CSV);
  const after = mergeCourseReport(
    fresh.courses,
    { ...old, actualProgressPercent: 12 },
    'Algebra I',
    reportSource(NOW - 20 * DAY),
    NOW,
  );

  const algebra = after.courses.find((c) => courseKey(c.name) === courseKey('Algebra I'));
  assert.equal(algebra.actualProgressPercent.value, 61.7, 'the fresher source still owns it');
});

test('importing the same email twice changes nothing the second time', () => {
  const email = parseProgressEmail(F.EMAIL_TABLE);
  const first = mergeProgressEmail([], email.courses, emailSource(NOW), NOW);
  const second = mergeProgressEmail(first.courses, email.courses, emailSource(NOW), NOW);

  assert.equal(second.courses.length, first.courses.length);
  assert.equal(second.changes.length, 0);
  assert.equal(second.created.length, 0);
});

test('a course name spelled differently is still the same course', () => {
  assert.equal(courseKey('Algebra I'), courseKey('algebra  i'));
  assert.equal(courseKey('Algebra I - Semester A'), courseKey('algebra i semester a'));
  assert.notEqual(courseKey('Algebra I'), courseKey('Algebra II'));
});

test('a merged course feeds the Pace Engine, which reads it as ahead', () => {
  const email = parseProgressEmail(F.EMAIL_TABLE);
  const merged = mergeProgressEmail([], email.courses, emailSource(NOW), NOW);

  const algebra = merged.courses.find((c) => courseKey(c.name) === courseKey('Algebra I'));
  const pace = coursePace(algebra, NOW);
  assert.equal(pace.status, 'AHEAD');
  assert.equal(pace.deltaPercent, 4.5);
  assert.equal(pace.official, false, 'the report did not publish a status');

  const science = merged.courses.find((c) => c.name.startsWith('Physical Science'));
  assert.equal(coursePace(science, NOW).status, 'BEHIND');
});

test('merged courses reach the store through the reducer', () => {
  const email = parseProgressEmail(F.EMAIL_TABLE);
  const merged = mergeProgressEmail([], email.courses, emailSource(NOW), NOW);
  const after = reducer(defaultState(), {
    type: 'COURSES_MERGE',
    courses: merged.courses,
    summary: 'Edgenuity progress updated for 2 courses',
  });
  assert.equal(after.integrations.courses.length, 2);
  assert.ok(after.activity.some((e) => e.type === 'course_progress_updated'));

  const removed = reducer(after, { type: 'COURSE_REMOVE', courseId: after.integrations.courses[0].id });
  assert.equal(removed.integrations.courses.length, 1);
});

/* ------------------------------------------------------------------ */
/* The Gmail adapter boundary                                          */
/* ------------------------------------------------------------------ */

test('the Gmail adapter refuses honestly instead of returning fake courses', async () => {
  const adapter = new GmailProgressAdapter();
  assert.equal(adapter.unavailable(), 'needs_authorization');

  const result = await adapter.sync(NOW);
  assert.equal(result.ok, false);
  assert.equal(result.courses.length, 0);
  assert.match(result.error, /client id/i);
});

test('the Gmail scope is read-only and the query is narrow', () => {
  assert.deepEqual(SCOPES, ['https://www.googleapis.com/auth/gmail.readonly']);
  assert.ok(!SCOPES.some((s) => /modify|compose|send|full/.test(s)));
  // Sender, subject and recency — three independent narrowings, so a
  // misconfigured account still cannot become a general mailbox reader.
  assert.match(QUERY, /from:/);
  assert.match(QUERY, /subject:/);
  assert.match(QUERY, /newer_than:/);
});
