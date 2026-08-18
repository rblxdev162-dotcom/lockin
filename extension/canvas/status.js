/**
 * Submission-status normalisation — pure, no DOM.
 *
 * Extension-side mirror of `web/src/lib/canvas/verification.ts`. The two must
 * agree: the extension decides what it reports, the web app decides what it
 * accepts, and both use the same asymmetric rule — never turn an ambiguous
 * signal into a pass.
 */
import { CANVAS_COMPLETE_STATUSES, CANVAS_SUBMISSION_STATUSES } from './types.js';

export function isCanvasStatus(value) {
  return typeof value === 'string' && CANVAS_SUBMISSION_STATUSES.includes(value);
}

export function coerceStatus(value) {
  return isCanvasStatus(value) ? value : 'verification_unavailable';
}

export function isVerifiedComplete(status) {
  return CANVAS_COMPLETE_STATUSES.includes(status);
}

/**
 * Turns the independent hints found on a page into one status.
 * "Late" plus "Submitted" is finished work → `late_submitted`.
 * "Missing" beats a vague submitted hint, because Canvas only marks work
 * missing when nothing arrived by the deadline.
 */
export function combineSignals({
  submitted = false,
  graded = false,
  missing = false,
  late = false,
  explicitlyNotSubmitted = false,
} = {}) {
  if (graded) return 'graded';
  if (missing && !submitted) return 'missing';
  if (submitted && late) return 'late_submitted';
  if (submitted) return 'submitted';
  if (explicitlyNotSubmitted) return 'not_submitted';
  return 'verification_unavailable';
}

const RANK = {
  unknown: 0,
  verification_unavailable: 1,
  not_submitted: 2,
  missing: 3,
  submitted: 4,
  late_submitted: 4,
  graded: 5,
};

/** A weaker reading never overwrites a stronger one for the same assignment. */
export function mergeStatus(previous, incoming) {
  const p = isCanvasStatus(previous) ? previous : 'unknown';
  const i = isCanvasStatus(incoming) ? incoming : 'verification_unavailable';
  return RANK[i] >= RANK[p] ? i : p;
}

/* ------------------------------------------------------------------ */
/* Text signals                                                        */
/* ------------------------------------------------------------------ */

/**
 * Canvas states submission status in prose in several places
 * ("Submitted!", "Turned in", "Not Submitted", "Missing"). These matchers are
 * intentionally narrow — anything unrecognised stays unreadable.
 */
const SUBMITTED_RE = /\b(submitted|turned in|handed in)\b/i;
const NOT_SUBMITTED_RE = /\b(not submitted|no submission|nothing submitted|not yet submitted)\b/i;
const GRADED_RE = /\b(graded|score:|grade:)\b/i;
const MISSING_RE = /\bmissing\b/i;
const LATE_RE = /\blate\b/i;

/**
 * Reads status hints out of a blob of page text.
 * Order matters: "not submitted" must be tested before "submitted", since the
 * former contains the latter.
 */
export function signalsFromText(text) {
  const value = typeof text === 'string' ? text : '';
  const notSubmitted = NOT_SUBMITTED_RE.test(value);
  return {
    explicitlyNotSubmitted: notSubmitted,
    submitted: !notSubmitted && SUBMITTED_RE.test(value),
    graded: GRADED_RE.test(value),
    missing: MISSING_RE.test(value),
    late: LATE_RE.test(value),
  };
}
