/**
 * Canvas Calendar Feed fixtures.
 *
 * Hand-written to match the *shape* Canvas publishes — `event-assignment-<id>`
 * UIDs, `Title [Course]` summaries, a `TZID` on every timed event — without
 * being a copy of anyone's real calendar. No real course, teacher, student or
 * school appears here, and no real feed URL exists anywhere in the repo.
 *
 * The nastier fixtures at the bottom are the point of the file: a parser is
 * only as good as the malformed input it survives.
 */

const HEAD = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Instructure//Canvas//EN',
  'X-WR-CALNAME:Example Student',
  'CALSCALE:GREGORIAN',
].join('\r\n');

const TAIL = 'END:VCALENDAR';

export function feed(...events) {
  return [HEAD, ...events, TAIL].join('\r\n') + '\r\n';
}

/** One ordinary assignment, due at 11:59pm Pacific. */
export const ASSIGNMENT_A = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-8811@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260312T235900',
  'DTEND;TZID=America/Los_Angeles:20260312T235900',
  'SUMMARY:Cell Respiration Worksheet [Biology 1 - P3]',
  'DESCRIPTION:Complete the worksheet and upload a PDF.',
  'URL:https://example.instructure.com/courses/501/assignments/8811',
  'CLASS:PUBLIC',
  'END:VEVENT',
].join('\r\n');

/** The same assignment, moved two days later. */
export const ASSIGNMENT_A_MOVED = ASSIGNMENT_A.replace(/20260312T235900/g, '20260314T235900').replace(
  'DTSTAMP:20260309T170000Z',
  'DTSTAMP:20260310T090000Z',
);

/** The same assignment, renamed. */
export const ASSIGNMENT_A_RENAMED = ASSIGNMENT_A.replace(
  'Cell Respiration Worksheet',
  'Cell Respiration Worksheet (revised)',
);

/** The same assignment, withdrawn. */
export const ASSIGNMENT_A_CANCELLED = ASSIGNMENT_A.replace(
  'CLASS:PUBLIC',
  'STATUS:CANCELLED\r\nCLASS:PUBLIC',
);

/** A second assignment in another course. */
export const ASSIGNMENT_B = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-8812@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260313T080000',
  'SUMMARY:Chapter 4 Problem Set [Algebra I]',
  'URL:https://example.instructure.com/courses/502/assignments/8812',
  'END:VEVENT',
].join('\r\n');

/** An all-day assignment: `VALUE=DATE`, no clock time anywhere. */
export const ALL_DAY = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-8813@example.instructure.com',
  'DTSTART;VALUE=DATE:20260315',
  'DTEND;VALUE=DATE:20260316',
  'SUMMARY:Reading Log [English 2]',
  'END:VEVENT',
].join('\r\n');

/** A UTC timestamp rather than a zoned one. */
export const UTC_EVENT = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-8814@example.instructure.com',
  'DTSTART:20260313T065900Z',
  'SUMMARY:Lab Safety Quiz [Chemistry]',
  'END:VEVENT',
].join('\r\n');

/** A calendar event, not an assignment. */
export const CALENDAR_EVENT = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-calendar-event-4410@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260311T091500',
  'DTEND;TZID=America/Los_Angeles:20260311T101500',
  'SUMMARY:Office Hours [Biology 1 - P3]',
  'LOCATION:Room 214',
  'END:VEVENT',
].join('\r\n');

/**
 * A folded line, which is how a long URL really arrives, plus escaped commas
 * and semicolons in the summary.
 */
export const FOLDED = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-8815@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260316T235900',
  'SUMMARY:Essay: causes\\, effects\\; and outcomes [History]',
  'URL:https://example.instructure.com/courses/503/assignm',
  ' ents/8815',
  'END:VEVENT',
].join('\r\n');

/** An event carrying an alarm, whose own DTSTART must not win. */
export const WITH_ALARM = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-8816@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260317T235900',
  'SUMMARY:Vocabulary Set 9 [Spanish 2]',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT1H',
  'DTSTART:20250101T000000Z',
  'SUMMARY:Reminder',
  'END:VALARM',
  'END:VEVENT',
].join('\r\n');

/** A weekly recurrence with an end date. */
export const RECURRING_BOUNDED = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-calendar-event-4411@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260310T140000',
  'RRULE:FREQ=WEEKLY;UNTIL=20260331T235900Z',
  'SUMMARY:Study Group [Biology 1 - P3]',
  'END:VEVENT',
].join('\r\n');

/** A recurrence with no end at all — must never be expanded. */
export const RECURRING_UNBOUNDED = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-calendar-event-4412@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260310T150000',
  'RRULE:FREQ=DAILY',
  'SUMMARY:Advisory [Homeroom]',
  'END:VEVENT',
].join('\r\n');

/**
 * A title trying to be something else: a javascript: URL, HTML, and a bidi
 * override. All three must come out inert.
 */
export const HOSTILE = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-9001@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260313T235900',
  'SUMMARY:<img src=x onerror=alert(1)>\\nSecond line‮gnihtemos‬ [Biology 1 - P3]',
  'URL:javascript:alert(document.domain)',
  'END:VEVENT',
].join('\r\n');

/** The DST spring-forward boundary in America/Los_Angeles (2026-03-08). */
export const DST_BEFORE = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260301T170000Z',
  'UID:event-assignment-9100@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260307T235900',
  'SUMMARY:Before DST [Physics]',
  'END:VEVENT',
].join('\r\n');

export const DST_AFTER = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260301T170000Z',
  'UID:event-assignment-9101@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260309T235900',
  'SUMMARY:After DST [Physics]',
  'END:VEVENT',
].join('\r\n');

/** An event with no UID — unidentifiable, so unusable. */
export const NO_UID = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'DTSTART;TZID=America/Los_Angeles:20260313T235900',
  'SUMMARY:Mystery Task [Nowhere]',
  'END:VEVENT',
].join('\r\n');

/** An event whose DTSTART is nonsense. */
export const BAD_DATE = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-9200@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:not-a-date',
  'SUMMARY:Broken Date [Art]',
  'END:VEVENT',
].join('\r\n');

/** An event whose zone name does not exist. */
export const BAD_ZONE = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-9201@example.instructure.com',
  'DTSTART;TZID=Mars/Olympus_Mons:20260313T235900',
  'SUMMARY:Unknown Zone [Astronomy]',
  'END:VEVENT',
].join('\r\n');

/** A prototype-pollution attempt through a property name and a parameter. */
export const POLLUTION = [
  'BEGIN:VEVENT',
  'DTSTAMP:20260309T170000Z',
  'UID:event-assignment-9300@example.instructure.com',
  'DTSTART;TZID=America/Los_Angeles:20260313T235900',
  '__proto__:polluted',
  'SUMMARY;__proto__=polluted:Proto Test [Computer Science]',
  'END:VEVENT',
].join('\r\n');

/** What a login page looks like when it is served instead of a feed. */
export const LOGIN_PAGE = '<!doctype html><html><head><title>Log in</title></head><body>Sign in</body></html>';

/** A feed cut off mid-event, as a dropped connection produces. */
export const TRUNCATED = [HEAD, 'BEGIN:VEVENT', 'UID:event-assignment-9400@example.instructure.com'].join(
  '\r\n',
);
