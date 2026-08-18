/**
 * What happened to the plan, and what changed.
 *
 * The planner does not "move" work in the sense of editing yesterday's list.
 * Remaining work is recomputed from the assignment's own logged minutes, so
 * anything unfinished is still remaining and is scheduled again by the normal
 * algorithm. That is what makes "no work is ever silently lost" a property of
 * the design rather than a promise: there is no code path that can drop a
 * minute, because the minutes are derived, not carried.
 *
 * This module is the other half of that: comparing the new plan to the old one
 * so the student can be told what moved and why.
 */
import type {
  Assignment,
  CompletedSession,
  Exam,
  FocusSession,
  PlanItemStatus,
  PlannedWorkItem,
  StudyPlan,
} from '../../types';
import { sourceKey } from '../../types/planner';
import { todayISO } from '../time';
import { minutesLoggedOn } from './assignments';
import { examRemainingMinutes } from './exams';

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

/**
 * Records where each chunk used to sit.
 *
 * Chunks are matched on (source, chunk number), which is stable across a
 * rebuild because chunks are numbered in date order per task.
 */
export function annotateMovement(
  plan: StudyPlan,
  previous: StudyPlan | null,
  today: string,
): StudyPlan {
  if (!previous) return plan;

  const before = new Map<string, string>();
  for (const day of previous.days) {
    for (const item of day.items) {
      before.set(`${item.sourceType}:${item.sourceId}#${item.chunkIndex}`, item.scheduledDate);
    }
  }

  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      items: day.items.map((item) => {
        const was = before.get(`${item.sourceType}:${item.sourceId}#${item.chunkIndex}`);
        if (!was || was === item.scheduledDate) return item;
        const codes = [...item.reason.codes];
        if (was < today) codes.unshift('moved_from_missed');
        else if (item.scheduledDate < was) codes.unshift('work_ahead');
        return {
          ...item,
          originalScheduledDate: was,
          status: 'rescheduled' as PlanItemStatus,
          reason: {
            codes: [...new Set(codes)].slice(0, 8),
            facts: { ...item.reason.facts, movedFrom: was },
          },
        };
      }),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export interface StatusContext {
  now: Date;
  assignments: Assignment[];
  exams: Exam[];
  completedSessions: CompletedSession[];
  activeSession: FocusSession | null;
}

/**
 * Item status, derived rather than stored.
 *
 * Storing it would create a second source of truth that drifts the moment work
 * is logged from anywhere else — the focus timer, a Canvas detection, an
 * Edgenuity photo. Deriving it means a completed assignment is reflected
 * everywhere at once, whatever completed it.
 */
export function itemStatus(item: PlannedWorkItem, ctx: StatusContext): PlanItemStatus {
  const today = todayISO(ctx.now);

  if (item.sourceType === 'assignment') {
    const assignment = ctx.assignments.find((a) => a.id === item.sourceId);
    if (!assignment) return item.status;
    if (assignment.status === 'Completed') return 'completed';
  } else {
    const exam = ctx.exams.find((e) => e.id === item.sourceId);
    if (!exam) return item.status;
    if (examRemainingMinutes(exam) <= 0) return 'completed';
  }

  const logged = minutesLoggedOn(
    ctx.completedSessions,
    item.sourceType,
    item.sourceId,
    item.scheduledDate,
  );

  if (logged >= item.plannedMinutes && item.plannedMinutes > 0) return 'completed';

  if (item.scheduledDate < today) {
    // Work was started but not finished on the day: the remainder is already
    // back in the pool and will be scheduled again. Never call that "missed".
    return logged > 0 ? 'rescheduled' : 'missed';
  }

  if (item.scheduledDate === today) {
    const active = ctx.activeSession;
    const activeHere =
      active &&
      (item.sourceType === 'assignment'
        ? active.assignmentId === item.sourceId
        : active.examId === item.sourceId);
    if (activeHere) return 'in_progress';
    return logged > 0 ? 'in_progress' : 'planned';
  }

  return item.status === 'rescheduled' ? 'rescheduled' : 'planned';
}

/** The whole plan with live statuses, and sources that no longer exist gone. */
export function annotatePlan(plan: StudyPlan, ctx: StatusContext): StudyPlan {
  const assignmentIds = new Set(ctx.assignments.map((a) => a.id));
  const examIds = new Set(ctx.exams.map((e) => e.id));

  return {
    ...plan,
    days: plan.days.map((day) => {
      const items = day.items
        .filter((item) =>
          item.sourceType === 'assignment'
            ? assignmentIds.has(item.sourceId)
            : examIds.has(item.sourceId),
        )
        .map((item) => ({ ...item, status: itemStatus(item, ctx) }));
      return { ...day, items, plannedMinutes: items.reduce((s, i) => s + i.plannedMinutes, 0) };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export interface DayProgress {
  date: string;
  totalItems: number;
  completedItems: number;
  plannedMinutes: number;
  completedMinutes: number;
}

/** Progress for one date of an already-annotated plan. */
export function dayProgress(plan: StudyPlan, dateISO: string, ctx: StatusContext): DayProgress {
  const day = plan.days.find((d) => d.date === dateISO);
  const items = day?.items ?? [];
  let completedMinutes = 0;
  for (const item of items) {
    const logged = minutesLoggedOn(
      ctx.completedSessions,
      item.sourceType,
      item.sourceId,
      dateISO,
    );
    completedMinutes += Math.min(logged, item.plannedMinutes);
  }
  return {
    date: dateISO,
    totalItems: items.length,
    completedItems: items.filter((i) => i.status === 'completed').length,
    plannedMinutes: items.reduce((s, i) => s + i.plannedMinutes, 0),
    completedMinutes,
  };
}

/* ------------------------------------------------------------------ */
/* Diffing, for the rebuild preview                                    */
/* ------------------------------------------------------------------ */

export interface PlanChange {
  sourceType: 'assignment' | 'exam';
  sourceId: string;
  title: string;
  kind: 'moved' | 'added' | 'removed' | 'minutes_changed' | 'unchanged';
  fromDate?: string;
  toDate?: string;
  beforeMinutes: number;
  afterMinutes: number;
}

function totalsBySource(plan: StudyPlan | null) {
  const totals = new Map<
    string,
    { minutes: number; dates: string[]; title: string; sourceType: 'assignment' | 'exam'; sourceId: string }
  >();
  if (!plan) return totals;
  for (const day of plan.days) {
    for (const item of day.items) {
      const key = sourceKey(item.sourceType, item.sourceId);
      const entry = totals.get(key) ?? {
        minutes: 0,
        dates: [],
        title: item.title,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
      };
      entry.minutes += item.plannedMinutes;
      entry.dates.push(item.scheduledDate);
      totals.set(key, entry);
    }
  }
  for (const entry of totals.values()) entry.dates.sort();
  return totals;
}

/**
 * A per-task summary of what a rebuild would change.
 *
 * Deliberately coarse — "Math moved Tuesday → Monday", not a chunk-by-chunk
 * audit. The preview exists so a student can say no to a surprising change,
 * and a wall of diffs would defeat that.
 */
export function diffPlans(previous: StudyPlan | null, next: StudyPlan): PlanChange[] {
  const before = totalsBySource(previous);
  const after = totalsBySource(next);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();

  const changes: PlanChange[] = [];
  for (const key of keys) {
    const a = before.get(key);
    const b = after.get(key);
    const meta = b ?? a!;
    const base = {
      sourceType: meta.sourceType,
      sourceId: meta.sourceId,
      title: meta.title,
      beforeMinutes: a?.minutes ?? 0,
      afterMinutes: b?.minutes ?? 0,
    };
    if (!a) changes.push({ ...base, kind: 'added', toDate: b!.dates[0] });
    else if (!b) changes.push({ ...base, kind: 'removed', fromDate: a.dates[0] });
    else if (a.dates[0] !== b.dates[0]) {
      changes.push({ ...base, kind: 'moved', fromDate: a.dates[0], toDate: b.dates[0] });
    } else if (a.minutes !== b.minutes) changes.push({ ...base, kind: 'minutes_changed' });
    else changes.push({ ...base, kind: 'unchanged' });
  }

  // Anything that actually changed first; the unchanged tail is still returned
  // so the preview can say "English: unchanged" rather than staying silent.
  const rank = { moved: 0, added: 1, minutes_changed: 2, removed: 3, unchanged: 4 } as const;
  return changes.sort((x, y) => rank[x.kind] - rank[y.kind] || x.title.localeCompare(y.title));
}

/** True when a rebuild would change anything a student would notice. */
export function isMeaningfulChange(changes: PlanChange[]): boolean {
  return changes.some((c) => c.kind !== 'unchanged');
}

/* ------------------------------------------------------------------ */
/* Missed-day recovery                                                 */
/* ------------------------------------------------------------------ */

export interface MissedSummary {
  date: string;
  unfinishedMinutes: number;
  items: { title: string; plannedMinutes: number; completedMinutes: number }[];
}

/** What was left unfinished on a past date of the previous plan. */
export function missedWork(
  plan: StudyPlan | null,
  dateISO: string,
  ctx: StatusContext,
): MissedSummary {
  const day = plan?.days.find((d) => d.date === dateISO);
  const items: MissedSummary['items'] = [];
  let unfinished = 0;

  for (const item of day?.items ?? []) {
    const done = Math.min(
      item.plannedMinutes,
      minutesLoggedOn(ctx.completedSessions, item.sourceType, item.sourceId, dateISO),
    );
    const stillComplete =
      item.sourceType === 'assignment'
        ? ctx.assignments.find((a) => a.id === item.sourceId)?.status === 'Completed'
        : (() => {
            const exam = ctx.exams.find((e) => e.id === item.sourceId);
            return exam ? examRemainingMinutes(exam) <= 0 : true;
          })();
    if (stillComplete || done >= item.plannedMinutes) continue;
    unfinished += item.plannedMinutes - done;
    items.push({
      title: item.title,
      plannedMinutes: item.plannedMinutes,
      completedMinutes: done,
    });
  }

  return { date: dateISO, unfinishedMinutes: unfinished, items };
}

/**
 * Everything left unfinished on days that have already passed.
 *
 * Called at the moment of a day rollover, because a rebuilt plan contains no
 * past days at all — after the rebuild there is nothing left to measure.
 */
export function unfinishedBefore(
  plan: StudyPlan | null,
  today: string,
  ctx: StatusContext,
): { date: string; unfinishedMinutes: number; itemCount: number } | null {
  if (!plan) return null;
  let minutes = 0;
  let count = 0;
  let latest = '';
  for (const day of plan.days) {
    if (day.date >= today) continue;
    const summary = missedWork(plan, day.date, ctx);
    if (summary.unfinishedMinutes <= 0) continue;
    minutes += summary.unfinishedMinutes;
    count += summary.items.length;
    if (day.date > latest) latest = day.date;
  }
  return minutes > 0 ? { date: latest, unfinishedMinutes: minutes, itemCount: count } : null;
}
