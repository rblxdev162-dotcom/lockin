/**
 * Canvas page parsing.
 *
 * Design rules, in priority order:
 *   1. URLs before markup. `/courses/:id/assignments/:id` is a documented,
 *      long-lived Canvas route; CSS structure is not. Every identifier comes
 *      from an href.
 *   2. Semantic and stable hooks only — `data-testid`, ids like
 *      `assignment_123`, `<time datetime>`, ARIA labels, visible text.
 *      Never positional selectors like `div:nth-child(4) > div`.
 *   3. Multiple fallbacks per fact, each independently plausible.
 *   4. When nothing matches, say so. `verification_unavailable` is a correct
 *      answer; a guessed "submitted" is a bug that unlocks distractions.
 *
 * These functions take a Document (or element) so they can be exercised
 * against fixture pages in a real browser without any Chrome APIs.
 */
import { LIMITS } from './types.js';
import { classifyCanvasUrl, idsFromHref } from './urls.js';
import { combineSignals, mergeStatus, signalsFromText } from './status.js';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function clean(text, max) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Query several selectors in order, returning the first element found. */
function firstMatch(root, selectors) {
  for (const selector of selectors) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch {
      /* an invalid selector must never break parsing */
    }
  }
  return null;
}

/** The main content region, so text scans never read nav/footer chrome. */
export function contentRoot(doc) {
  return (
    firstMatch(doc, [
      '#content',
      'main',
      '[role="main"]',
      '#main',
      '.ic-Layout-contentMain',
    ]) || doc.body
  );
}

/* ------------------------------------------------------------------ */
/* Due dates                                                           */
/* ------------------------------------------------------------------ */

/**
 * Due date from the most trustworthy source available:
 *   1. `<time datetime="...">` — machine readable, Canvas emits it widely.
 *   2. any element carrying an ISO-8601 date in a data attribute.
 *   3. nothing. An absent due date is a real Canvas state, not a failure.
 */
export function parseDueDate(scope) {
  if (!scope) return undefined;

  const timeEl = scope.querySelector('time[datetime]');
  if (timeEl) {
    const iso = toIso(timeEl.getAttribute('datetime'));
    if (iso) return iso;
  }

  for (const attr of ['data-due-at', 'data-date', 'data-timestamp']) {
    const el = scope.querySelector(`[${attr}]`);
    if (el) {
      const iso = toIso(el.getAttribute(attr));
      if (iso) return iso;
    }
  }
  return undefined;
}

function toIso(value) {
  if (!value || typeof value !== 'string') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  // Guard against absurd values from a malformed page.
  const year = date.getFullYear();
  if (year < 2000 || year > 2100) return undefined;
  return date.toISOString();
}

/* ------------------------------------------------------------------ */
/* Points                                                              */
/* ------------------------------------------------------------------ */

function parsePoints(scope) {
  if (!scope) return undefined;
  const el = firstMatch(scope, [
    '[data-testid="points-possible"]',
    '.points_possible',
    '.assignment-points-possible',
  ]);
  const text = el ? el.textContent : '';
  const match = /(\d+(?:\.\d+)?)\s*(?:points|pts)?/i.exec(text || '');
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value < 100000 ? value : undefined;
}

/* ------------------------------------------------------------------ */
/* Submission type — how the work is handed in at all                  */
/* ------------------------------------------------------------------ */

/**
 * Where Canvas states how an assignment is submitted. Student pages label it
 * "Submitting"; other layouts say "Submission Types".
 */
const SUBMISSION_TYPE_SELECTORS = [
  '[data-submission-types]',
  '[data-testid="submission-types"]',
  '.submission_type',
  '.submission-types',
  '.student-assignment-overview',
  '.assignment-submission-type',
];

/** Canvas' own machine value, when the markup carries one. */
function mapSubmissionTypeToken(raw) {
  const value = String(raw || '').toLowerCase();
  if (!value) return null;
  if (/\bon_paper\b/.test(value)) return 'on_paper';
  if (/\bexternal_tool\b/.test(value)) return 'external';
  if (/\bnot_graded\b/.test(value)) return 'none';
  if (/\bnone\b/.test(value)) return 'none';
  if (/\bonline_|discussion_topic|online_quiz|media_recording/.test(value)) return 'online';
  return null;
}

/**
 * How this assignment is handed in, or undefined when the page does not say.
 *
 * Undefined is a real answer and the common one on list pages. It must stay
 * distinct from `online`: "Canvas did not say" cannot be allowed to become
 * "Canvas said this is submitted online", or an on-paper assignment would go
 * back to looking like work that was never handed in.
 */
export function parseSubmissionType(scope) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return undefined;

  const attributed = firstMatch(scope, ['[data-submission-types]']);
  if (attributed) {
    const mapped = mapSubmissionTypeToken(attributed.getAttribute('data-submission-types'));
    if (mapped) return mapped;
  }

  for (const selector of SUBMISSION_TYPE_SELECTORS) {
    let nodes;
    try {
      nodes = scope.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const node of nodes) {
      /**
       * The container's own text *and* each child's, because Canvas renders
       * this as a label/value pair of sibling elements. Concatenated,
       * "Submitting" and "on paper" become "Submittingon paper" whenever the
       * markup has no whitespace between the two — and a word-boundary match
       * then misses the very phrase this function exists to find.
       */
      const texts = [clean(node.textContent, 300)];
      let children;
      try {
        children = node.querySelectorAll('*');
      } catch {
        children = [];
      }
      let seen = 0;
      for (const child of children) {
        if (seen >= 40) break;
        seen += 1;
        const text = clean(child.textContent, 120);
        if (text) texts.push(text);
      }

      for (const text of texts) {
        // Only wording that is *about* how the work is handed in.
        if (/\bon paper\b/i.test(text)) return 'on_paper';
        if (/\b(no submission|nothing to submit|not graded)\b/i.test(text)) return 'none';
        if (/\bexternal tool\b/i.test(text)) return 'external';
        if (
          /\b(a text entry box|a website url|a file upload|a media recording|a student annotation|an? online quiz)\b/i.test(
            text,
          )
        ) {
          return 'online';
        }
      }
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Submission state                                                    */
/* ------------------------------------------------------------------ */

/**
 * Reads submission state from a scope (a whole assignment page, or one row of
 * a list). Returns a status plus the signals it was built from, so callers can
 * tell "read it, it says not submitted" from "couldn't read it".
 *
 * Strategy order:
 *   1. explicit machine-readable state — `data-submission-state`, testids
 *   2. status pills / badges Canvas renders for missing, late, graded
 *   3. scoped visible text as a last resort
 */
export function parseCanvasSubmissionState(scope) {
  if (!scope) return { status: 'verification_unavailable', source: 'none' };

  // 1. Explicit machine-readable state.
  const stateEl = firstMatch(scope, [
    '[data-submission-state]',
    '[data-testid="submission-state"]',
  ]);
  if (stateEl) {
    const raw = (stateEl.getAttribute('data-submission-state') || '').toLowerCase();
    const mapped = mapExplicitState(raw);
    if (mapped) return { status: mapped, source: 'data-attribute' };
  }

  // 2. Pills / badges. Canvas marks these with testids and stable class names.
  const pillSignals = {
    submitted: !!firstMatch(scope, [
      '[data-testid="submitted-pill"]',
      '.submission-submitted-pill',
      '.submitted-pill',
    ]),
    graded: !!firstMatch(scope, [
      '[data-testid="graded-pill"]',
      '.submission-graded-pill',
      '.graded-pill',
    ]),
    missing: !!firstMatch(scope, [
      '[data-testid="missing-pill"]',
      '.submission-missing-pill',
      '.missing-pill',
    ]),
    late: !!firstMatch(scope, [
      '[data-testid="late-pill"]',
      '.submission-late-pill',
      '.late-pill',
    ]),
  };
  if (pillSignals.submitted || pillSignals.graded || pillSignals.missing) {
    return { status: combineSignals(pillSignals), source: 'pill' };
  }

  // 2b. Classic list rows (the course Assignments page) state the same fact in
  //     words rather than pills, usually inside screen-reader-only text:
  //     "This assignment was submitted on ...". Only sentences that are
  //     explicitly about this row's own submission are read — a vague
  //     "submitted" anywhere else stays unreadable, because a false pass
  //     unlocks distractions.
  const rowStatus = rowStatusFromSentences(scope);
  if (rowStatus) return { status: rowStatus, source: 'row-sentence' };

  // 3. Scoped text. Only regions that are *about* submission are read, so a
  //    stray "submitted" in an assignment description can't fake a pass.
  const statusRegion = firstMatch(scope, [
    '[data-testid="submission-status"]',
    '[data-testid="assignment-student-status"]',
    '.submission-details',
    '.submission_details',
    '.assignment-student-header-status',
    '#submission_details',
    '.student-assignment-overview',
  ]);
  if (statusRegion) {
    const signals = signalsFromText(statusRegion.textContent || '');
    const status = combineSignals(signals);
    if (status !== 'verification_unavailable') return { status, source: 'status-region' };
  }

  // 4. ARIA labels sometimes carry the state when nothing else does.
  const labelled = scope.querySelector('[aria-label]');
  if (labelled) {
    const label = labelled.getAttribute('aria-label') || '';
    if (/\b(submitted|missing|graded)\b/i.test(label)) {
      const status = combineSignals(signalsFromText(label));
      if (status !== 'verification_unavailable') return { status, source: 'aria-label' };
    }
  }

  return { status: 'verification_unavailable', source: 'none' };
}

/* ------------------------------------------------------------------ */
/* Row wording (course Assignments page)                               */
/* ------------------------------------------------------------------ */

/**
 * Where Canvas puts a row's submission wording. Narrow on purpose: these are
 * status containers, not descriptions, so their text is *about* the handing in.
 */
const ROW_STATUS_SELECTORS = [
  '.submission-status',
  '.submission_status',
  '[data-testid="submission-status-pill"]',
  '.ig-details .screenreader-only',
  '.ig-row .screenreader-only',
  '.ig-details__item',
];

/**
 * One row-status sentence to one status, or null when the wording is not one
 * this parser recognises. Order matters: "not submitted" contains "submitted".
 */
function statusFromRowSentence(text) {
  if (/\b(not submitted|no submission|nothing submitted|not yet submitted)\b/i.test(text)) {
    return 'not_submitted';
  }
  if (/\bthis (?:assignment|quiz) (?:was|is|has been) graded\b/i.test(text)) return 'graded';
  const submitted =
    /\bthis (?:assignment|quiz) was submitted\b/i.test(text) ||
    /^(submitted|turned in|handed in)\b/i.test(text) ||
    /\bsubmitted (?:on|at|late|for grading)\b/i.test(text);
  if (submitted) return /\blate\b/i.test(text) ? 'late_submitted' : 'submitted';
  if (/^missing\b/i.test(text) || /\bthis (?:assignment|quiz) is missing\b/i.test(text)) {
    return 'missing';
  }
  return null;
}

/**
 * Reads every status container in a row and keeps the strongest recognised
 * answer. `mergeStatus` does the ranking, so a row carrying both "Late" and
 * "Submitted on ..." lands on `late_submitted` exactly as the pills would.
 */
function rowStatusFromSentences(scope) {
  if (typeof scope.querySelectorAll !== 'function') return null;
  let best = 'unknown';
  for (const selector of ROW_STATUS_SELECTORS) {
    let nodes;
    try {
      nodes = scope.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const node of nodes) {
      const text = clean(node.textContent, 200);
      if (!text) continue;
      const status = statusFromRowSentence(text);
      if (status) best = mergeStatus(best, status);
    }
  }
  return best === 'unknown' ? null : best;
}

function mapExplicitState(raw) {
  switch (raw) {
    case 'submitted':
    case 'pending_review':
      return 'submitted';
    case 'graded':
      return 'graded';
    case 'missing':
      return 'missing';
    case 'late':
      return 'late_submitted';
    case 'unsubmitted':
    case 'not_submitted':
      return 'not_submitted';
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Link harvesting (the backbone of every list page)                   */
/* ------------------------------------------------------------------ */

/**
 * Finds every assignment/quiz link on a page and pairs it with the smallest
 * enclosing row, which is where the title, due date and status pills live.
 *
 * Identity always comes from the href, never from the text.
 */
function harvestAssignmentLinks(doc, baseUrl) {
  const results = new Map();
  const anchors = doc.querySelectorAll('a[href]');

  for (const anchor of anchors) {
    const ids = idsFromHref(anchor.getAttribute('href'), baseUrl);
    if (!ids) continue;

    const key = `${ids.externalCourseId}/${ids.externalAssignmentId}`;
    const title = clean(
      anchor.getAttribute('aria-label') || anchor.textContent,
      LIMITS.MAX_TITLE_LENGTH,
    );
    if (!title) continue;

    const row = enclosingRow(anchor);
    const existing = results.get(key);
    // Prefer the richest row we have seen for this assignment.
    if (existing && existing.title.length >= title.length) continue;
    results.set(key, { ...ids, title, row });

    if (results.size >= LIMITS.MAX_ASSIGNMENTS_PER_MESSAGE) break;
  }

  return [...results.values()];
}

/**
 * Walks up to the nearest container that looks like a list row.
 * Uses semantic hooks (`li`, `[role=listitem]`, Canvas' `assignment_<id>` ids)
 * rather than a fixed number of parent hops.
 */
function enclosingRow(anchor) {
  const SELECTORS = [
    'li',
    '[role="listitem"]',
    '[id^="assignment_"]',
    '[id^="assignment-"]',
    '.assignment',
    '.todo-item',
    '.planner-item',
    'tr',
    'article',
  ];
  for (const selector of SELECTORS) {
    try {
      const found = anchor.closest(selector);
      if (found) return found;
    } catch {
      /* ignore */
    }
  }
  return anchor.parentElement || anchor;
}

/** Course name from the row, the page heading, or the breadcrumb. */
function courseNameFrom(doc, row) {
  const rowEl = row
    ? firstMatch(row, ['[data-testid="course-name"]', '.course-name', '.context_name'])
    : null;
  if (rowEl) return clean(rowEl.textContent, LIMITS.MAX_COURSE_NAME_LENGTH);

  const crumb = firstMatch(doc, [
    '#breadcrumbs .course a',
    '#breadcrumbs li:nth-of-type(2) a',
    '[data-testid="course-name"]',
    '.ic-app-course-menu__title',
    '#course_name',
  ]);
  return crumb ? clean(crumb.textContent, LIMITS.MAX_COURSE_NAME_LENGTH) : '';
}

function buildDetected(entry, doc, baseUrl, statusOverride) {
  const status =
    statusOverride ?? parseCanvasSubmissionState(entry.row).status;
  return {
    submissionType: parseSubmissionType(entry.row),
    externalAssignmentId: entry.externalAssignmentId,
    externalCourseId: entry.externalCourseId,
    title: entry.title,
    dueAt: parseDueDate(entry.row),
    url: entry.url || baseUrl,
    pointsPossible: parsePoints(entry.row),
    submissionStatus: status,
    detectedAt: new Date().toISOString(),
    courseName: courseNameFrom(doc, entry.row) || undefined,
    kind: entry.kind,
  };
}

/* ------------------------------------------------------------------ */
/* Page parsers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Dashboard / To-do / course home / assignments index all share a shape:
 * a list of links to assignments, each in a row that may carry a due date and
 * a status pill. One implementation, four named entry points so callers (and
 * tests) read clearly.
 */
function parseListPage(doc, baseUrl) {
  const entries = harvestAssignmentLinks(doc, baseUrl);
  return entries.map((entry) => {
    const detected = buildDetected(entry, doc, baseUrl);
    // On list pages an absent pill means "not shown here", not "unreadable" —
    // downgrade so a later detail-page reading always wins.
    if (detected.submissionStatus === 'verification_unavailable') {
      detected.submissionStatus = 'unknown';
    }
    return detected;
  });
}

export function parseCanvasDashboard(doc, baseUrl) {
  return parseListPage(doc, baseUrl);
}

export function parseCanvasTodo(doc, baseUrl) {
  return parseListPage(doc, baseUrl);
}

export function parseCanvasAssignmentsPage(doc, baseUrl) {
  return parseListPage(doc, baseUrl);
}

export function parseCanvasCoursePage(doc, baseUrl) {
  return parseListPage(doc, baseUrl);
}

/**
 * A single assignment (or quiz) page — the only place a *reliable* submission
 * status usually exists, so this is what verification leans on.
 */
export function parseCanvasAssignmentPage(doc, baseUrl) {
  const info = classifyCanvasUrl(baseUrl);
  if (!info.courseId || !info.assignmentId) return [];

  const root = contentRoot(doc);

  const titleEl = firstMatch(doc, [
    '[data-testid="assignment-name"]',
    'h1.title',
    '#assignment_show .title',
    '.assignment-title',
    'h1',
  ]);
  const title = clean(titleEl ? titleEl.textContent : '', LIMITS.MAX_TITLE_LENGTH);
  if (!title) return [];

  const { status } = parseCanvasSubmissionState(root);

  return [
    {
      externalAssignmentId: info.assignmentId,
      externalCourseId: info.courseId,
      title,
      dueAt: parseDueDate(root),
      url: String(baseUrl).slice(0, LIMITS.MAX_URL_LENGTH),
      pointsPossible: parsePoints(root),
      submissionStatus: status,
      submissionType: parseSubmissionType(root),
      detectedAt: new Date().toISOString(),
      courseName: courseNameFrom(doc, null) || undefined,
      kind: info.kind === 'quiz' ? 'quiz' : 'assignment',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

/**
 * Privacy-safe counts for a list page, in the same shape the gradebook
 * reports: how many assignment rows were on the page, and how many produced a
 * submission state definite enough to act on. Counts only — never page text.
 */
function listPageDiagnostics(doc, assignments) {
  let rowsConsidered = 0;
  try {
    rowsConsidered = doc.querySelectorAll('.ig-row, li.assignment, [id^="assignment_"]').length;
  } catch {
    rowsConsidered = 0;
  }
  const rowsRead = assignments.filter(
    (assignment) =>
      assignment.submissionStatus !== 'unknown' &&
      assignment.submissionStatus !== 'verification_unavailable',
  ).length;
  return {
    rows: Math.max(rowsConsidered, assignments.length),
    rowsConsidered: Math.max(rowsConsidered, assignments.length),
    rowsRead,
  };
}

export function parseCanvasCourses(doc, baseUrl) {
  const courses = new Map();
  for (const anchor of doc.querySelectorAll('a[href]')) {
    let absolute;
    try {
      absolute = new URL(anchor.getAttribute('href'), baseUrl).toString();
    } catch {
      continue;
    }
    const match = new URL(absolute).pathname.match(/^\/courses\/(\d+)\/?$/);
    if (!match) continue;
    const name = clean(
      anchor.getAttribute('aria-label') || anchor.textContent,
      LIMITS.MAX_COURSE_NAME_LENGTH,
    );
    if (!name) continue;
    const id = match[1];
    if (!courses.has(id)) {
      courses.set(id, {
        externalCourseId: id,
        originalName: name,
        displayName: name,
        url: absolute.slice(0, LIMITS.MAX_URL_LENGTH),
      });
    }
    if (courses.size >= LIMITS.MAX_COURSES_PER_MESSAGE) break;
  }
  return [...courses.values()];
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parses whatever Canvas page is loaded. Returns `readable: false` when the
 * page is recognisably Canvas but yielded nothing usable, which the UI surfaces
 * as "Canvas page detected, but assignment information could not be read."
 */
export function parseCanvasPage(doc, baseUrl) {
  const info = classifyCanvasUrl(baseUrl);
  let assignments = [];
  let grades = [];
  let diagnostics;

  switch (info.kind) {
    case 'assignment':
    case 'quiz':
      assignments = parseCanvasAssignmentPage(doc, baseUrl);
      break;
    case 'dashboard':
      assignments = parseCanvasDashboard(doc, baseUrl);
      break;
    case 'todo':
      assignments = parseCanvasTodo(doc, baseUrl);
      break;
    case 'assignments_index':
      // The class Assignments page: no scores, but a submission state per row.
      assignments = parseCanvasAssignmentsPage(doc, baseUrl);
      diagnostics = listPageDiagnostics(doc, assignments);
      break;
    case 'grades': {
      // The one page that carries status AND scores for a whole class.
      const read = parseCanvasGradesPage(doc, baseUrl);
      assignments = read.assignments;
      grades = read.grades;
      diagnostics = read.diagnostics;
      // A gradebook with no readable rows is still a course page; fall back
      // rather than reporting the page unreadable.
      if (assignments.length === 0) assignments = parseCanvasCoursePage(doc, baseUrl);
      break;
    }
    case 'grades_all': {
      const read = parseCanvasAllGradesPage(doc, baseUrl);
      grades = read.grades;
      diagnostics = read.diagnostics;
      break;
    }
    case 'course':
      assignments = parseCanvasCoursePage(doc, baseUrl);
      break;
    default:
      // Unknown route: still try list harvesting, since Canvas has many pages
      // that embed assignment links (modules, syllabus, planner).
      assignments = parseListPage(doc, baseUrl);
      break;
  }

  const courses = parseCanvasCourses(doc, baseUrl);

  return {
    pageKind: info.kind,
    assignments: assignments.slice(0, LIMITS.MAX_ASSIGNMENTS_PER_MESSAGE),
    courses,
    grades: grades.slice(0, LIMITS.MAX_COURSES_PER_MESSAGE),
    diagnostics,
    readable: assignments.length > 0 || courses.length > 0 || grades.length > 0,
  };
}

export { mergeStatus };

/* ------------------------------------------------------------------ */
/* Grades pages                                                        */
/* ------------------------------------------------------------------ */

/**
 * ## Why the Grades page is the good one to read
 *
 * Every other Canvas page tells you a *little* about status: a pill here, a
 * due date there. The student Grades page is the one screen where Canvas lays
 * out, per assignment and in a table it has emitted the same way for years:
 * the name, the due date, the submission status, the score and the points
 * possible. Reading the page the student deliberately opened gives LockIn
 * everything it needs without an API call or token. The page may be one the
 * student opened or a temporary background gradebook tab created by LockIn's
 * explicitly authorized after-school schedule.
 *
 * Rule 1 of this file still holds: identity comes from the href
 * (`/courses/:id/assignments/:id`), never from the row's text.
 *
 * ## What "graded" is allowed to mean here
 *
 * Only a row with a real score cell. An empty score, a dash, "-", or Canvas's
 * "Score unavailable" screenreader text is **not** graded — those rows fall
 * back to whatever the status pills say, and to `unknown` if they say nothing.
 * A false "graded" would settle an assignment the student still has to do,
 * which is the one failure mode invariant 3 exists to prevent.
 */

/** Canvas renders "Score unavailable"/"-" for ungraded rows. Neither is a score. */
function parseScoreCell(cell) {
  if (!cell) return { score: null, text: '' };

  // The visible number, with any screenreader-only prose removed first.
  const clone = cell.cloneNode(true);
  for (const hidden of clone.querySelectorAll('.screenreader-only, .hidden, [aria-hidden="true"]')) {
    hidden.remove();
  }
  const scoped = firstMatch(clone, ['.grade', '.score_value', '.what_if_score']) || clone;
  const text = clean(scoped.textContent, 40);

  if (!text || /^[-–—]$/.test(text)) return { score: null, text: '' };
  if (/score unavailable|not yet graded|no score/i.test(text)) return { score: null, text: '' };
  if (/^ex$|^excused$/i.test(text)) return { score: null, text: 'Excused', excused: true };

  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) {
    // A letter or complete/incomplete grade is still a real mark.
    if (/^(complete|incomplete|[A-F][+-]?)$/i.test(text)) return { score: null, text };
    return { score: null, text: '' };
  }
  const score = Number(match[0]);
  return Number.isFinite(score) ? { score, text } : { score: null, text: '' };
}

function parsePointsCell(cell) {
  if (!cell) return undefined;
  const match = clean(cell.textContent, 40).match(/\d+(\.\d+)?/);
  if (!match) return undefined;
  const points = Number(match[0]);
  return Number.isFinite(points) && points >= 0 && points < 100000 ? points : undefined;
}

/** A percentage anywhere in a blob of text: "Total: 93.75%" → 93.75. */
function percentIn(text) {
  const match = clean(text, 200).match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 1000 ? value : null;
}

/** A letter grade standing on its own: A, B+, C-, F, and pass/fail wording. */
function letterIn(text) {
  const value = clean(text, 60);
  const match = value.match(/\b([A-F][+-]?|Pass|Fail|Complete|Incomplete)\b/);
  return match ? match[1] : null;
}

/**
 * `/courses/:id/grades` — the table, plus the course total in the sidebar.
 *
 * @returns {{ assignments: object[], grades: object[] }}
 */
export function parseCanvasGradesPage(doc, baseUrl) {
  const info = classifyCanvasUrl(baseUrl);
  const courseId = info.courseId;
  const assignments = [];

  const table = doc.querySelector('#grades_summary') || contentRoot(doc);

  /**
   * Rows, chosen tolerantly.
   *
   * The first version required `tr.student_assignment` or `tr[id^=submission_]`,
   * which is what Canvas's classic gradebook emits — and if an install renders
   * anything else, the whole page silently produced nothing and fell back to
   * the generic link harvester, whose statuses are all `unknown`. That is
   * indistinguishable, from the student's side, from "LockIn cannot tell what
   * is done".
   *
   * So: those rows if they exist, otherwise **any table row carrying a link to
   * an assignment**. Identity still comes from the href, and a row with no
   * score cell still cannot read as graded, so widening what counts as a row
   * cannot manufacture a false pass.
   */
  let rows = table.querySelectorAll('tr.student_assignment, tr[id^="submission_"]');
  if (rows.length === 0) {
    rows = [...table.querySelectorAll('tr, li, [role="row"]')].filter((row) =>
      row.querySelector('a[href*="/assignments/"], a[href*="/quizzes/"]'),
    );
  }

  for (const row of rows) {
    if (assignments.length >= LIMITS.MAX_ASSIGNMENTS_PER_MESSAGE) break;

    const anchor = row.querySelector('th a[href], td a[href], a[href]');
    const ids = anchor ? idsFromHref(anchor.getAttribute('href'), baseUrl) : null;
    if (!ids) continue;

    const title = clean(anchor.getAttribute('aria-label') || anchor.textContent, LIMITS.MAX_TITLE_LENGTH);
    if (!title) continue;

    const scoreCell =
      row.querySelector('.assignment_score, .score_holder, .score, td.grade, [data-testid="grade-cell"]') ||
      // Last resort: a cell that looks like "18/20" or "18 / 20".
      [...row.querySelectorAll('td, [role="cell"]')].find((cell) =>
        /\d+(\.\d+)?\s*\/\s*\d+/.test(clean(cell.textContent, 40)),
      ) ||
      null;
    const { score, text: scoreText, excused } = parseScoreCell(scoreCell);
    let pointsPossible = parsePointsCell(row.querySelector('.points_possible'));
    if (pointsPossible === undefined && scoreCell) {
      const outOf = clean(scoreCell.textContent, 60).match(/\/\s*(\d+(?:\.\d+)?)/);
      if (outOf) pointsPossible = Number(outOf[1]);
    }

    // Status: the row's own pills and status cell first, then the score.
    const statusCell = row.querySelector('td.status, .submission_status') || row;
    const pillStatus = parseCanvasSubmissionState(statusCell).status;
    const rowSignals = signalsFromText(clean(statusCell.textContent, 200));

    let submissionStatus;
    if (score !== null || scoreText) {
      // A mark is on the page. Late still matters, but it is finished work.
      submissionStatus = 'graded';
    } else if (pillStatus !== 'verification_unavailable') {
      submissionStatus = pillStatus;
    } else {
      const combined = combineSignals(rowSignals);
      // Nothing said either way on this row: silence is not evidence.
      submissionStatus = combined === 'verification_unavailable' ? 'unknown' : combined;
    }

    assignments.push({
      externalAssignmentId: ids.externalAssignmentId,
      externalCourseId: ids.externalCourseId || courseId,
      title,
      dueAt: parseDueDate(row),
      url: ids.url,
      pointsPossible,
      submissionStatus,
      score: score === null ? undefined : score,
      scoreText: scoreText || undefined,
      excused: excused === true ? true : undefined,
      detectedAt: new Date().toISOString(),
      courseName: courseNameFrom(doc, row) || undefined,
      kind: ids.kind,
    });
  }

  return {
    assignments,
    grades: parseCourseTotal(doc, baseUrl, courseId),
    // A small, privacy-safe fingerprint of why a page produced what it did.
    // Counts and selector hits only — no titles, no scores, no URLs beyond the
    // path. It exists so a page that reads as nothing can be diagnosed from
    // the student's own machine instead of guessed at.
    diagnostics: {
      hadGradesSummary: !!doc.querySelector('#grades_summary'),
      classicRows: doc.querySelectorAll('#grades_summary tr.student_assignment').length,
      assignmentLinks: doc.querySelectorAll('a[href*="/assignments/"]').length,
      scoreCells: doc.querySelectorAll('.assignment_score, .score_holder').length,
      rowsConsidered: rows.length,
      rowsRead: assignments.length,
    },
  };
}

/**
 * The course total from the Grades page sidebar.
 *
 * Canvas hides this entirely when a teacher turns totals off, and an absent
 * total is recorded as hidden rather than as a zero — a made-up grade is worse
 * than no grade (invariant 26).
 */
function parseCourseTotal(doc, baseUrl, courseId) {
  if (!courseId) return [];

  const region =
    firstMatch(doc, [
      '#student-grades-right-content',
      '.student_assignment.final_grade',
      '#submission_final-grade',
      '.final_grade',
    ]) || null;

  const text = region ? clean(region.textContent, 400) : '';
  const percent = percentIn(text);
  const letter = letterIn(text);

  return [
    {
      externalCourseId: courseId,
      courseName: courseNameFrom(doc, null) || undefined,
      currentScore: percent,
      currentGrade: letter,
      totalsHidden: percent === null && letter === null,
      readAt: new Date().toISOString(),
      url: String(baseUrl).slice(0, LIMITS.MAX_URL_LENGTH),
    },
  ];
}

/**
 * `/grades` — the all-courses screen: one row per class, with the current
 * grade Canvas is publishing for it.
 *
 * Written tolerantly on purpose. This page's markup varies more than the
 * course gradebook's, so a row counts if it contains a link to a course and a
 * percentage or letter *somewhere in that row*. Anything else is recorded as
 * "Canvas isn't publishing a total", never guessed at.
 */
export function parseCanvasAllGradesPage(doc, baseUrl) {
  const grades = new Map();

  /**
   * Driven by the course links, not by row markup.
   *
   * The first version iterated `tr, li, [role=listitem]` and read the cells
   * inside. On the user's real Canvas that produced **nothing at all** — the
   * page answered, the parser found no rows it recognised, and the whole read
   * was discarded as unreadable. Layouts change; `<div>` rows are not rows to
   * a `tr` selector.
   *
   * So the anchor is the anchor. Every link to `/courses/<id>` is a class, and
   * the grade is found by walking *up* from that link until a container holds
   * something percentage-shaped. That survives any arrangement of elements
   * around the link, which is the only part of this page Canvas cannot change
   * without breaking its own navigation.
   */
  for (const anchor of doc.querySelectorAll('a[href]')) {
    if (grades.size >= LIMITS.MAX_COURSES_PER_MESSAGE) break;

    let absolute;
    try {
      absolute = new URL(anchor.getAttribute('href'), baseUrl);
    } catch {
      continue;
    }
    /**
     * Any link into a course counts as that course.
     *
     * This demanded the path *end* at `/courses/<id>` or `/courses/<id>/grades`.
     * On the real page every link carried more — a student id, a tab, a
     * submission — so all ten were rejected and the page read as empty. The
     * course id is the only part that identifies anything; whatever follows it
     * is Canvas's business, not this parser's.
     */
    const match = absolute.pathname.match(/^\/courses\/(\d+)(?:\/|$)/);
    if (!match) continue;
    const courseId = match[1];
    if (courseId.length > LIMITS.MAX_ID_LENGTH) continue;

    const courseName = clean(
      anchor.getAttribute('aria-label') || anchor.textContent,
      LIMITS.MAX_COURSE_NAME_LENGTH,
    );

    // Climb until a container carries a grade, or we reach the page. Four
    // levels is deep enough for a card or a row, shallow enough that a
    // neighbouring class's grade cannot be picked up by accident.
    let percent = null;
    let letter = null;
    let scope = anchor.parentElement;
    for (let depth = 0; depth < 4 && scope; depth += 1) {
      /**
       * Stop the moment the container also holds another class.
       *
       * Climbing without this check reaches an ancestor holding every class on
       * the page, and the first percentage in it gets handed to whichever
       * class we happened to be walking up from — so a class showing "No
       * grades" borrows its neighbour's 93.75%. Inventing a grade is the worst
       * thing this file can do, so the walk stops rather than guesses.
       */
      if (holdsAnotherCourse(scope, courseId, baseUrl)) break;

      const text = clean(scope.textContent, 600);
      percent = percentIn(text);
      letter = letterIn(text);
      if (percent !== null || letter !== null) break;
      scope = scope.parentElement;
    }

    const existing = grades.get(courseId);
    if (existing && existing.currentScore !== null && percent === null) continue;

    grades.set(courseId, {
      externalCourseId: courseId,
      courseName: courseName || existing?.courseName,
      currentScore: percent,
      currentGrade: letter,
      totalsHidden: percent === null && letter === null,
      readAt: new Date().toISOString(),
      url: String(baseUrl).slice(0, LIMITS.MAX_URL_LENGTH),
    });
  }

  return {
    assignments: [],
    grades: [...grades.values()],
    diagnostics: gradesPageDiagnostics(doc, baseUrl, grades),
  };
}

/**
 * What this page looked like, in a form safe to write to disk.
 *
 * Counts, booleans, and **path shapes with every number replaced by `N`** —
 * so `/courses/25741/grades/10364` is recorded as `/courses/N/grades/N`. That
 * is enough to write a selector against and carries no ids, no names, and no
 * scores. Added because a page that answers and yields nothing is otherwise
 * invisible, and guessing at its markup wasted days.
 */
function gradesPageDiagnostics(doc, baseUrl, grades) {
  const shapes = new Set();
  for (const anchor of doc.querySelectorAll('a[href*="/courses/"]')) {
    try {
      const path = new URL(anchor.getAttribute('href'), baseUrl).pathname;
      shapes.add(path.replace(/\d+/g, 'N').slice(0, 60));
    } catch {
      /* not a URL we can read */
    }
    if (shapes.size >= 8) break;
  }

  const text = clean(contentRoot(doc).textContent, 8000);
  return {
    courseLinks: doc.querySelectorAll('a[href*="/courses/"]').length,
    rowsFound: grades.size,
    withGrade: [...grades.values()].filter((g) => !g.totalsHidden).length,
    tables: doc.querySelectorAll('table').length,
    rows: doc.querySelectorAll('tr').length,
    percentOnPage: percentIn(text) !== null,
    letterOnPage: letterIn(text) !== null,
    linkShapes: [...shapes].join(' '),
  };
}

/** True when `scope` links to any course other than `courseId`. */
function holdsAnotherCourse(scope, courseId, baseUrl) {
  for (const link of scope.querySelectorAll('a[href]')) {
    let path;
    try {
      path = new URL(link.getAttribute('href'), baseUrl).pathname;
    } catch {
      continue;
    }
    const other = path.match(/^\/courses\/(\d+)/);
    if (other && other[1] !== courseId) return true;
  }
  return false;
}
