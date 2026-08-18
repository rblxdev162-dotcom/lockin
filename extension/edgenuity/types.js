/**
 * Edgenuity module constants and hard limits.
 *
 * Same reasoning as `canvas/types.js`: Edgenuity page content is untrusted
 * input, so every value read from it is capped before it can reach storage,
 * the message channel, or the LockIn UI.
 *
 * Deliberately small. A Canvas detection carries assignments, courses, due
 * dates and submission states; an Edgenuity detection carries a course
 * identity and two integers. Everything else the page shows — activity names,
 * questions, scores, essays — is Imagine Learning's copyrighted content and is
 * never read, never stored, never exported.
 */

/**
 * Hosts Edgenuity actually serves the student experience from.
 *
 * Unlike Canvas — which schools self-host at arbitrary domains, hence the
 * configurable `canvasDomain` — Edgenuity is a single vendor at known hosts.
 * The student never types a domain, so there is no user-supplied origin to
 * validate and no way to point this feature at a look-alike site.
 */
export const EDGENUITY_DOMAINS = ['edgenuity.com', 'imagineedgenuity.com'];

/** What a page has to be before the parser is allowed to look at it. */
export const EDGENUITY_PAGE_KINDS = ['course', 'dashboard', 'report', 'assessment', 'unknown'];

/**
 * Words that mean "this is an assessment" in a URL.
 *
 * Assessment pages are refused outright — see `detector.js`. Progress does not
 * change during a test, so refusing costs nothing, and it keeps LockIn from
 * ever running alongside a proctored assessment.
 */
export const ASSESSMENT_URL_HINTS = [
  'quiz',
  'test',
  'exam',
  'assessment',
  'proctor',
  'lockdown',
  'benchmark',
  'diagnostic',
];

export const LIMITS = {
  /** Courses accepted from one content-script message. */
  MAX_COURSES_PER_MESSAGE: 40,
  /** Course records retained in the extension cache. */
  MAX_CACHED_COURSES: 100,
  MAX_COURSE_NAME_LENGTH: 120,
  MAX_URL_LENGTH: 500,
  MAX_ID_LENGTH: 64,
  /**
   * No real course has more activities than this. A page claiming otherwise is
   * either broken or lying, and either way its numbers are worthless.
   */
  MAX_ACTIVITIES: 2000,
};

/** Shared with the Canvas observer, which this module reuses rather than copies. */
export const PARSE_DEBOUNCE_MS = 400;
export const MIN_PARSE_INTERVAL_MS = 1500;
