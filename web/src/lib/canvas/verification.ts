/**
 * The Canvas verification policy — pure, no DOM, no React.
 *
 * This file answers exactly one question: *does Canvas give strong enough
 * evidence to call this assignment done?* The bias is deliberate and
 * asymmetric — a false negative just means the student marks it another way,
 * while a false positive unlocks distractions on work that was never handed in.
 */
import type { CanvasSubmissionStatus } from '../../types/canvas';
import { CANVAS_COMPLETE_STATUSES, CANVAS_SUBMISSION_STATUSES } from '../../types/canvas';

/** Only these statuses may complete an assignment. */
export function isVerifiedComplete(status: CanvasSubmissionStatus): boolean {
  return CANVAS_COMPLETE_STATUSES.includes(status);
}

/** Anything we could not read confidently. */
export function isUnreadable(status: CanvasSubmissionStatus): boolean {
  return status === 'unknown' || status === 'verification_unavailable';
}

export function isCanvasStatus(value: unknown): value is CanvasSubmissionStatus {
  return (
    typeof value === 'string' &&
    (CANVAS_SUBMISSION_STATUSES as readonly string[]).includes(value)
  );
}

/** Anything not recognised degrades to `verification_unavailable`, never to a pass. */
export function coerceStatus(value: unknown): CanvasSubmissionStatus {
  return isCanvasStatus(value) ? value : 'verification_unavailable';
}

/**
 * Combines the separate signals Canvas shows.
 *
 * Canvas routinely displays "Late" *and* "Submitted" together — that is still
 * finished work, so it normalises to `late_submitted` and counts. "Missing"
 * wins over a bare submitted hint because Canvas only labels work missing when
 * nothing was handed in by the deadline.
 */
export function combineSignals(signals: {
  submitted?: boolean;
  graded?: boolean;
  missing?: boolean;
  late?: boolean;
  explicitlyNotSubmitted?: boolean;
}): CanvasSubmissionStatus {
  const { submitted, graded, missing, late, explicitlyNotSubmitted } = signals;

  if (graded) return 'graded';
  if (missing && !submitted) return 'missing';
  if (submitted && late) return 'late_submitted';
  if (submitted) return 'submitted';
  if (explicitlyNotSubmitted) return 'not_submitted';
  return 'verification_unavailable';
}

/**
 * Status precedence when the same assignment is seen on two pages (e.g. the
 * dashboard says nothing useful but the assignment page says graded).
 * Higher wins. Unreadable results never overwrite a readable one.
 */
const RANK: Record<CanvasSubmissionStatus, number> = {
  unknown: 0,
  verification_unavailable: 1,
  not_submitted: 2,
  missing: 3,
  submitted: 4,
  late_submitted: 4,
  graded: 5,
};

export function mergeStatus(
  previous: CanvasSubmissionStatus,
  incoming: CanvasSubmissionStatus,
): CanvasSubmissionStatus {
  return RANK[incoming] >= RANK[previous] ? incoming : previous;
}

export const STATUS_LABEL: Record<CanvasSubmissionStatus, string> = {
  unknown: 'Not checked',
  not_submitted: 'Not submitted',
  submitted: 'Submitted ✓',
  graded: 'Graded ✓',
  missing: 'Missing',
  late_submitted: 'Submitted late ✓',
  verification_unavailable: 'Verification unavailable',
};

/** e.g. `Canvas · Submitted ✓` */
export function canvasStatusLabel(status: CanvasSubmissionStatus): string {
  return `Canvas · ${STATUS_LABEL[status]}`;
}

export type StatusTone = 'mint' | 'flame' | 'amber' | 'neutral';

export function canvasStatusTone(status: CanvasSubmissionStatus): StatusTone {
  if (isVerifiedComplete(status)) return 'mint';
  if (status === 'missing') return 'flame';
  if (status === 'not_submitted') return 'amber';
  return 'neutral';
}
