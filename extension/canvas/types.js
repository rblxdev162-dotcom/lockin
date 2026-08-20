/**
 * Canvas module constants and hard limits.
 *
 * Every cap here exists because Canvas page content is untrusted input: a
 * hostile or broken page must not be able to flood storage, the message
 * channel, or the LockIn UI.
 */

export const CANVAS_SUBMISSION_STATUSES = [
  'unknown',
  'not_submitted',
  'submitted',
  'graded',
  'missing',
  'late_submitted',
  'verification_unavailable',
];

/** Only these may complete an assignment. Mirrors web/src/lib/canvas/verification.ts. */
export const CANVAS_COMPLETE_STATUSES = ['submitted', 'graded', 'late_submitted'];

export const LIMITS = {
  /** Assignments accepted from a single content-script message. */
  MAX_ASSIGNMENTS_PER_MESSAGE: 100,
  MAX_COURSES_PER_MESSAGE: 50,
  /** Total detections retained in the extension cache. */
  MAX_CACHED_ASSIGNMENTS: 300,
  MAX_TITLE_LENGTH: 200,
  MAX_COURSE_NAME_LENGTH: 120,
  MAX_URL_LENGTH: 500,
  MAX_ID_LENGTH: 40,
  MAX_DOMAIN_LENGTH: 253,
};

/** Debounce for DOM-change driven re-parsing. */
export const PARSE_DEBOUNCE_MS = 400;
/** Never re-parse the same page more often than this, whatever the DOM does. */
export const MIN_PARSE_INTERVAL_MS = 1500;

export const CANVAS_PAGE_KINDS = [
  'dashboard',
  'todo',
  'course',
  'assignments_index',
  'assignment',
  'quiz',
  'grades',
  'grades_all',
  'unknown',
];
