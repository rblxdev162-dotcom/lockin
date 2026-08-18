/**
 * The priority model.
 *
 * Every number in this file is a named constant with a reason next to it, and
 * the score is a plain sum of those constants. That is the whole point: a
 * student can be shown exactly why one task outranked another, and the same
 * inputs always produce the same ranking. There is no randomness, no model, no
 * "AI" — and nothing in here should ever gain any.
 */
import type { PlanningReasonCode } from '../../types/planner';
import type { WorkTask } from './types';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Work whose deadline has already passed. */
export const OVERDUE_BASE = 110;
/** Added per day overdue, so a three-week-old task doesn't outrank everything. */
export const OVERDUE_PER_DAY = 5;
export const OVERDUE_MAX_BONUS = 30;

/** Due on the day being scheduled. */
export const DUE_TODAY = 100;
export const DUE_TOMORROW = 70;
/** Two days out and beyond, falling off gently. */
export const DUE_SOON_BASE = 60;
export const DUE_SOON_DECAY = 6;
export const DUE_FLOOR = 5;

/** The student's own priority field. */
export const PRIORITY_BONUS: Record<WorkTask['priority'], number> = {
  Urgent: 25,
  Important: 12,
  Normal: 0,
};

/**
 * Workload pressure: how much of the capacity left before the deadline this
 * task needs. A four-hour essay due Friday is more urgent on Monday than a
 * twenty-minute worksheet due Friday, and this is the term that says so.
 */
export const PRESSURE_WEIGHT = 40;
/** Pressure at or above this counts as "this has to start now". */
export const PRESSURE_CRITICAL = 0.75;

/** Exams get a small standing bump inside their study window. */
export const EXAM_WINDOW_BONUS = 8;

/**
 * A task that can only be worked on a handful of days before its deadline
 * outranks an equally urgent task with a whole week of opportunities.
 */
export const SCARCITY_BONUS = 12;
export const SCARCITY_DAYS = 2;

/** Scores within this distance count as "equally urgent" for tie-breaking. */
export const SCORE_EPSILON = 0.5;

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/** Urgency from the number of days between a scheduling day and the deadline. */
export function urgencyScore(daysLeft: number): number {
  if (daysLeft < 0) {
    return OVERDUE_BASE + Math.min(OVERDUE_MAX_BONUS, Math.abs(daysLeft) * OVERDUE_PER_DAY);
  }
  if (daysLeft === 0) return DUE_TODAY;
  if (daysLeft === 1) return DUE_TOMORROW;
  return Math.max(DUE_FLOOR, DUE_SOON_BASE - (daysLeft - 2) * DUE_SOON_DECAY);
}

export interface ScoreContext {
  /** Days from the day being scheduled to the task's last usable date. */
  daysLeft: number;
  /** Days the task has actually been overdue, 0 when it is not. */
  daysOverdue: number;
  /** Minutes of capacity still free between this day and the deadline. */
  capacityBeforeDeadline: number;
  /** Days with any capacity between this day and the deadline, inclusive. */
  opportunities: number;
  remainingMinutes: number;
}

export interface ScoreResult {
  score: number;
  codes: PlanningReasonCode[];
  /** The pieces, so the UI can show the arithmetic if it wants to. */
  parts: Record<string, number>;
}

/**
 * The score for one task on one day. Pure arithmetic over the context above.
 *
 * Note what is deliberately *absent*: how the task will be verified. A Canvas
 * or Edgenuity assignment gets no bonus for having stronger proof attached —
 * school urgency decides the schedule, and verification decides what counts as
 * finished. Mixing the two would quietly teach students to do the
 * easiest-to-prove work first.
 */
export function scoreTask(task: WorkTask, ctx: ScoreContext): ScoreResult {
  const codes: PlanningReasonCode[] = [];
  const parts: Record<string, number> = {};

  const urgency = urgencyScore(ctx.daysLeft);
  parts.urgency = urgency;
  if (task.overdue) codes.push('overdue');
  else if (ctx.daysLeft === 0) codes.push('due_today');
  else if (ctx.daysLeft === 1) codes.push('due_tomorrow');
  else codes.push('due_in_days');

  const priority = PRIORITY_BONUS[task.priority];
  parts.priority = priority;
  if (task.priority === 'Urgent') codes.push('priority_urgent');
  else if (task.priority === 'Important') codes.push('priority_important');

  const ratio =
    ctx.capacityBeforeDeadline > 0
      ? ctx.remainingMinutes / ctx.capacityBeforeDeadline
      : ctx.remainingMinutes > 0
        ? 1
        : 0;
  const pressure = Math.min(1, ratio) * PRESSURE_WEIGHT;
  parts.pressure = pressure;
  if (ratio >= PRESSURE_CRITICAL) codes.push('large_task_needs_early_start');

  const scarcity = ctx.opportunities <= SCARCITY_DAYS ? SCARCITY_BONUS : 0;
  parts.scarcity = scarcity;
  if (scarcity > 0) codes.push('few_opportunities');

  const exam = task.sourceType === 'exam' ? EXAM_WINDOW_BONUS : 0;
  parts.exam = exam;
  if (exam > 0) codes.push(ctx.daysLeft <= 1 ? 'exam_tomorrow' : 'exam_approaching');

  const score = urgency + priority + pressure + scarcity + exam;
  return { score: Math.round(score * 100) / 100, codes, parts };
}

/**
 * Deterministic ordering for two scored tasks.
 *
 * Array order must never decide a schedule, so every comparison ends in the
 * task id. The scarcity rule sits above raw score equality: given two tasks
 * that are equally urgent, the one with fewer chances to be done goes first.
 */
export function compareScored(
  a: { score: number; task: WorkTask; opportunities: number },
  b: { score: number; task: WorkTask; opportunities: number },
): number {
  if (Math.abs(a.score - b.score) > SCORE_EPSILON) return b.score - a.score;
  if (a.opportunities !== b.opportunities) return a.opportunities - b.opportunities;
  if (a.task.lastUsableDate !== b.task.lastUsableDate) {
    return a.task.lastUsableDate < b.task.lastUsableDate ? -1 : 1;
  }
  const weight = { Urgent: 0, Important: 1, Normal: 2 } as const;
  if (weight[a.task.priority] !== weight[b.task.priority]) {
    return weight[a.task.priority] - weight[b.task.priority];
  }
  if (a.task.createdAt !== b.task.createdAt) return a.task.createdAt < b.task.createdAt ? -1 : 1;
  return a.task.key < b.task.key ? -1 : a.task.key > b.task.key ? 1 : 0;
}
