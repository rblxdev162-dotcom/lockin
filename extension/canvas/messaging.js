/**
 * Schema validation for everything crossing a trust boundary in the Canvas
 * feature.
 *
 * Canvas page content is untrusted: it is authored by a school, rendered by a
 * third party, and could be manipulated by anything else running on the page.
 * Nothing reaches storage or the LockIn UI without passing through here, where
 * it is rebuilt field by field — unknown keys are dropped rather than copied.
 */
import { LIMITS } from './types.js';
import { coerceStatus } from './status.js';
import { normalizeCanvasDomain } from './urls.js';

export const CANVAS_MSG = {
  /** content script → background: "here is what I just read" */
  DETECTION: 'CANVAS_DETECTION',
  /** content script → background: "this page is Canvas but unreadable" */
  UNREADABLE: 'CANVAS_UNREADABLE',
  /** background → content script: "re-parse now" */
  REPARSE: 'CANVAS_REPARSE',
};

function str(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Ids must look like ids: digits, or our `quiz_<digits>` form. */
function validId(value) {
  const text = str(value, LIMITS.MAX_ID_LENGTH);
  return /^(quiz_)?\d+$/.test(text) ? text : null;
}

/** URLs must be https and on the expected host. */
function validUrl(value, expectedDomain) {
  const text = str(value, LIMITS.MAX_URL_LENGTH);
  if (!text) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (expectedDomain) {
    const host = parsed.hostname.toLowerCase();
    if (host !== expectedDomain && !host.endsWith('.' + expectedDomain)) return null;
  }
  return parsed.toString().slice(0, LIMITS.MAX_URL_LENGTH);
}

function validIso(value) {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getFullYear();
  if (year < 2000 || year > 2100) return undefined;
  return date.toISOString();
}

/**
 * Rebuilds one detected assignment, or returns null.
 * A record without both identifiers is worthless — identity is never inferred
 * from a title.
 */
export function validateDetectedAssignment(raw, expectedDomain) {
  if (!raw || typeof raw !== 'object') return null;

  const externalCourseId = validId(raw.externalCourseId);
  const externalAssignmentId = validId(raw.externalAssignmentId);
  if (!externalCourseId || !externalAssignmentId) return null;

  const title = str(raw.title, LIMITS.MAX_TITLE_LENGTH);
  if (!title) return null;

  const url = validUrl(raw.url, expectedDomain);
  if (!url) return null;

  const points = Number(raw.pointsPossible);
  const score = Number(raw.score);

  return {
    externalCourseId,
    externalAssignmentId,
    title,
    url,
    dueAt: validIso(raw.dueAt),
    pointsPossible: Number.isFinite(points) && points >= 0 && points < 100000 ? points : undefined,
    // Scores come from the Grades page. A score is display data only — it can
    // never change a submission status, which is decided above and by
    // `status.js`, so a hostile page cannot promote itself by shouting "100".
    score: Number.isFinite(score) && score > -100000 && score < 100000 ? score : undefined,
    scoreText: str(raw.scoreText, 40) || undefined,
    excused: raw.excused === true ? true : undefined,
    submissionStatus: coerceStatus(raw.submissionStatus),
    detectedAt: validIso(raw.detectedAt) || new Date().toISOString(),
    courseName: str(raw.courseName, LIMITS.MAX_COURSE_NAME_LENGTH) || undefined,
    kind: ['assignment', 'quiz', 'external_tool', 'discussion'].includes(raw.kind)
      ? raw.kind
      : undefined,
  };
}

export function validateCourse(raw, expectedDomain) {
  if (!raw || typeof raw !== 'object') return null;
  const externalCourseId = validId(raw.externalCourseId);
  if (!externalCourseId) return null;
  const originalName = str(raw.originalName, LIMITS.MAX_COURSE_NAME_LENGTH);
  if (!originalName) return null;
  return {
    externalCourseId,
    originalName,
    displayName: str(raw.displayName, LIMITS.MAX_COURSE_NAME_LENGTH) || originalName,
    url: validUrl(raw.url, expectedDomain) || undefined,
  };
}

/**
 * One class's current grade, as printed on the page the student opened.
 *
 * `currentScore` is a percentage or null; null with `totalsHidden` is the
 * honest record of Canvas not publishing a total, and is never turned into a
 * zero anywhere downstream.
 */
export function validateCourseGrade(raw, expectedDomain) {
  if (!raw || typeof raw !== 'object') return null;
  const externalCourseId = validId(raw.externalCourseId);
  if (!externalCourseId) return null;

  const score = Number(raw.currentScore);
  const currentScore = Number.isFinite(score) && score >= 0 && score <= 1000 ? score : null;
  const currentGrade = str(raw.currentGrade, 20) || null;

  return {
    externalCourseId,
    courseName: str(raw.courseName, LIMITS.MAX_COURSE_NAME_LENGTH) || undefined,
    currentScore,
    currentGrade,
    totalsHidden: currentScore === null && currentGrade === null,
    readAt: validIso(raw.readAt) || new Date().toISOString(),
    url: validUrl(raw.url, expectedDomain) || undefined,
  };
}

/**
 * Validates a whole detection message from a content script.
 * Caps list sizes so one page cannot flood the extension.
 */
export function validateDetectionMessage(raw, expectedDomain) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type !== CANVAS_MSG.DETECTION) return null;

  const domain = normalizeCanvasDomain(raw.domain);
  if (!domain || (expectedDomain && domain !== expectedDomain)) return null;

  const assignments = Array.isArray(raw.assignments)
    ? raw.assignments
        .slice(0, LIMITS.MAX_ASSIGNMENTS_PER_MESSAGE)
        .map((a) => validateDetectedAssignment(a, domain))
        .filter(Boolean)
    : [];

  const courses = Array.isArray(raw.courses)
    ? raw.courses
        .slice(0, LIMITS.MAX_COURSES_PER_MESSAGE)
        .map((c) => validateCourse(c, domain))
        .filter(Boolean)
    : [];

  const grades = Array.isArray(raw.grades)
    ? raw.grades
        .slice(0, LIMITS.MAX_COURSES_PER_MESSAGE)
        .map((g) => validateCourseGrade(g, domain))
        .filter(Boolean)
    : [];

  /**
   * Counts and booleans only. A diagnostic that could carry a title or a score
   * would be a second, unaudited path for page content to reach storage.
   */
  let diagnostics;
  if (raw.diagnostics && typeof raw.diagnostics === 'object') {
    diagnostics = {};
    for (const [key, value] of Object.entries(raw.diagnostics)) {
      if (typeof value === 'boolean') diagnostics[key.slice(0, 30)] = value;
      else if (Number.isFinite(value)) diagnostics[key.slice(0, 30)] = Math.min(99999, Number(value));
      else if (typeof value === 'string') {
        // Only `linkShapes`: paths with every number already replaced by `N`.
        // The alphabet is the guarantee — no page text can ride through here.
        const text = value.slice(0, 200);
        if (/^[/A-Za-z0-9_ .-]*$/.test(text)) diagnostics[key.slice(0, 30)] = text;
      }
    }
  }

  return {
    type: CANVAS_MSG.DETECTION,
    domain,
    pageKind: str(raw.pageKind, 40) || 'unknown',
    diagnostics,
    readable: raw.readable === true,
    assignments,
    courses,
    grades,
    detectedAt: validIso(raw.detectedAt) || new Date().toISOString(),
  };
}
