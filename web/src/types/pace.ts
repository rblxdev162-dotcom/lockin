/**
 * Ahead, on track, or behind — and the reasoning behind the word.
 *
 * The engine that produces these lives in `lib/pace/`. The types are here
 * because the reminder builder, the dashboard, the progress page and the
 * companion all consume them, and none of them should import an engine to
 * read a status.
 */
import type { Confidence, SourceKind } from './source';
import type { CourseProduct } from './integrations';

/**
 * `AHEAD`    — genuinely ahead of where the student needs to be.
 * `ON_TRACK` — nothing is wrong. The most common answer, and it should be.
 * `AT_RISK`  — nothing is late yet, but the next day or two does not fit.
 * `BEHIND`   — something is actually late, or a course is behind its own pace.
 * `UNKNOWN`  — the data is not good enough to say. **Not a failure state.**
 *
 * `UNKNOWN` exists because the alternative is worse: a student told they are
 * behind because a sync failed learns to distrust the whole app, and one told
 * they are on track because nothing synced learns something more dangerous.
 */
export const PACE_STATUSES = ['AHEAD', 'ON_TRACK', 'AT_RISK', 'BEHIND', 'UNKNOWN'] as const;
export type PaceStatus = (typeof PACE_STATUSES)[number];

/**
 * Why the engine said what it said.
 *
 * Codes are stable so the UI can style or suppress a specific reason; `text`
 * is the sentence a student reads. Both are produced together so no consumer
 * has to invent wording — which is how two screens end up disagreeing.
 */
export const PACE_REASON_CODES = [
  'overdue_work',
  'due_soon_complete',
  'due_soon_remaining',
  'course_ahead',
  'course_behind',
  'course_on_pace',
  'no_data',
  'stale_data',
  'capacity_tight',
  'nothing_due',
] as const;
export type PaceReasonCode = (typeof PACE_REASON_CODES)[number];

export interface PaceReason {
  code: PaceReasonCode;
  text: string;
  /** Nudges the reason's prominence; never changes the status by itself. */
  tone: 'good' | 'neutral' | 'warn';
}

/** A source that could not be believed, and how old it is. */
export interface StaleSource {
  kind: SourceKind;
  label: string;
  /** e.g. "5 days ago". Already humanised — no consumer formats a duration. */
  age: string;
}

/**
 * The single thing worth doing next, when there is one.
 *
 * `kind` tells the UI which control to render; `assignmentId` is set only for
 * `start_focus`. Never more than one — the dashboard's whole job is to have
 * one obvious next action.
 */
export interface PaceAction {
  kind: 'start_focus' | 'sync' | 'connect' | 'review' | 'none';
  text: string;
  assignmentId?: string;
}

export interface PaceReport {
  status: PaceStatus;
  confidence: Confidence;
  /**
   * True only when the *source itself* published this status — an Edgenuity
   * progress report that says "Behind", for example. False means LockIn worked
   * it out, and the UI must say so rather than putting words in the vendor's
   * mouth.
   */
  official: boolean;
  reasons: PaceReason[];
  staleSources: StaleSource[];
  suggestedAction: PaceAction;
}

/** One course's pace, which the overall report folds in. */
export interface CoursePace {
  courseId: string;
  name: string;
  product: CourseProduct;
  status: PaceStatus;
  official: boolean;
  /** actual − target, in percentage points. Absent when either is unknown. */
  deltaPercent?: number;
  actualPercent?: number;
  targetPercent?: number;
  /** Already humanised, e.g. "Updated this morning". */
  freshness: string;
  stale: boolean;
}
