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
      detectedAt: new Date().toISOString(),
      courseName: courseNameFrom(doc, null) || undefined,
      kind: info.kind === 'quiz' ? 'quiz' : 'assignment',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

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
      assignments = parseCanvasAssignmentsPage(doc, baseUrl);
      break;
    case 'course':
    case 'grades':
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
    readable: assignments.length > 0 || courses.length > 0,
  };
}

export { mergeStatus };
