/**
 * The scheduler.
 *
 * Deterministic by construction: `now` is an input, no random values are used,
 * no ids are generated from a clock, and every ordering decision ends in a
 * comparison of task keys. Given the same state and settings this function
 * returns the same plan, which is the property the whole feature rests on.
 *
 * Shape of the algorithm — greedy, day by day:
 *
 *   1. Build capacity for each day in the horizon (availability − fixed blocks
 *      − buffer, capped by the daily maximum).
 *   2. Turn assignments and exams into tasks with remaining minutes and a last
 *      usable date.
 *   3. Reserve the pre-exam review sessions, so they cannot be eaten by
 *      earlier greedy choices.
 *   4. Walk the days in order. On each day, repeatedly pick the highest-scoring
 *      eligible task and give it one chunk, until the day's capacity or the
 *      eligible work runs out.
 *   5. Whatever is left over is reported, never silently dropped.
 *
 * Complexity: O(D² · T) worst case, where D is the horizon in days (14 by
 * default) and T the number of tasks — the inner D comes from measuring the
 * capacity still free before each task's deadline. With 100 assignments and 20
 * exams over 30 days that is a few hundred thousand integer operations, which
 * is why no search or backtracking is needed. There is deliberately no attempt
 * at an optimal packing: an explainable greedy schedule beats an optimal one
 * nobody can argue with.
 */
import type {
  PlanWarning,
  PlannedDay,
  PlannedWorkItem,
  PlanningReasonCode,
  StudyPlan,
} from '../../types/planner';
import { sourceKey } from '../../types/planner';
import { daysBetween, todayISO } from '../time';
import { buildCapacity } from './capacity';
import { buildAssignmentTasks, taskCapacityOnDay } from './assignments';
import type { Deadline } from './assignments';
import { buildExamTasks } from './exams';
import { subjectFactors } from './estimation';
import { compareScored, scoreTask } from './priorities';
import { layOutDay } from './schedule';
import { annotateMovement } from './reschedule';
import type { DayCapacity, PlannerInputs, TaskProgressState, WorkTask } from './types';

/** A hard stop on chunks per day; also the loop's termination guarantee. */
export const MAX_ITEMS_PER_DAY = 12;
/** Two sessions of one subject in an evening is realistic; three is not. */
export const MAX_CHUNKS_PER_TASK_PER_DAY = 2;

interface Placement {
  task: WorkTask;
  date: string;
  minutes: number;
  score: number;
  codes: PlanningReasonCode[];
  facts: Record<string, number | string | boolean>;
  finalReview: boolean;
}

/**
 * How big a chunk to give a task right now.
 *
 * Returns 0 rather than creating a fragment: three minutes of Math on a
 * Tuesday is not a plan, it is noise. The one exception is work that is
 * genuinely shorter than the minimum, which is scheduled at its real size.
 */
export function computeChunk(
  remaining: number,
  capacityLeft: number,
  perTaskCeiling: number,
  settings: { minChunkMinutes: number; maxChunkMinutes: number },
): number {
  const ceiling = Math.min(settings.maxChunkMinutes, perTaskCeiling, capacityLeft);
  if (ceiling <= 0) return 0;

  let chunk = Math.min(remaining, ceiling);

  // Absorb a tail that would otherwise be left stranded below the minimum.
  const tail = remaining - chunk;
  if (tail > 0 && tail < settings.minChunkMinutes) {
    const grown = Math.min(remaining, ceiling + settings.minChunkMinutes);
    if (grown <= capacityLeft && grown <= perTaskCeiling) chunk = grown;
  }

  if (chunk < settings.minChunkMinutes && chunk < remaining) return 0;
  return chunk;
}

export function generatePlan(inputs: PlannerInputs): StudyPlan {
  const { settings, now } = inputs;
  const today = todayISO(now);
  const days = buildCapacity(settings, now);
  const horizonEnd = days.length ? days[days.length - 1].date : today;
  const indexOfDate = new Map(days.map((d, i) => [d.date, i]));

  const factors = subjectFactors(inputs.assignments);
  const { tasks: assignmentTasks, deadlines } = buildAssignmentTasks(inputs.assignments, {
    now,
    settings,
    factors,
    accepted: inputs.acceptedSubjectFactors,
    days,
  });
  const examTasks = buildExamTasks(inputs.exams, { now, settings, days });

  // One deterministic base order before anything is scored, so that even a
  // completely tied field cannot depend on how the arrays arrived.
  const tasks = [...assignmentTasks, ...examTasks].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );

  const states = new Map<string, TaskProgressState>(
    tasks.map((task) => [
      task.key,
      {
        task,
        remaining: task.remainingMinutes,
        chunkIndex: 0,
        perDate: new Map(),
        perDateCount: new Map(),
      },
    ]),
  );

  const dayRemaining = days.map((d) => d.capacityMinutes);
  const placements: Placement[] = [];

  const skipped = new Set(
    inputs.skips.map((s) => `${sourceKey(s.sourceType, s.sourceId)}@${s.date}`),
  );

  const deadlineOf = (task: WorkTask): Deadline | null =>
    task.sourceType === 'assignment' ? (deadlines.get(task.sourceId) ?? null) : null;

  /** Index of the last day this task may use. */
  const lastIndexOf = (task: WorkTask): number => {
    const index = indexOfDate.get(task.lastUsableDate);
    if (index !== undefined) return index;
    // Beyond the horizon: usable everywhere we can see.
    return task.lastUsableDate > horizonEnd ? days.length - 1 : -1;
  };

  const ceilingOn = (task: WorkTask, dayIndex: number): number => {
    const day = days[dayIndex];
    const base = taskCapacityOnDay(day, deadlineOf(task), settings);
    return task.maxMinutesPerDay !== undefined
      ? Math.min(base, task.maxMinutesPerDay)
      : base;
  };

  const place = (
    state: TaskProgressState,
    dayIndex: number,
    minutes: number,
    extra: { finalReview?: boolean; codes?: PlanningReasonCode[]; score?: number } = {},
  ) => {
    const day = days[dayIndex];
    const lastIndex = lastIndexOf(state.task);
    const opportunities = countOpportunities(days, dayRemaining, dayIndex, lastIndex);
    const capacityBefore = capacityBeforeDeadline(
      days,
      dayRemaining,
      dayIndex,
      lastIndex,
      state.task,
      ceilingOn,
    );
    const scored = scoreTask(state.task, {
      daysLeft: daysBetween(day.date, state.task.deadlineDate) ?? 0,
      daysOverdue: state.task.overdue
        ? Math.abs(daysBetween(state.task.deadlineDate, day.date) ?? 0)
        : 0,
      capacityBeforeDeadline: capacityBefore,
      opportunities,
      remainingMinutes: state.remaining,
    });

    placements.push({
      task: state.task,
      date: day.date,
      minutes,
      score: extra.score ?? scored.score,
      codes: [...(extra.codes ?? []), ...scored.codes],
      facts: {
        remainingMinutes: state.remaining,
        daysUntilDue: daysBetween(day.date, state.task.deadlineDate) ?? 0,
        opportunities,
        capacityBeforeDeadline: capacityBefore,
      },
      finalReview: extra.finalReview === true,
    });

    state.remaining -= minutes;
    state.perDate.set(day.date, (state.perDate.get(day.date) ?? 0) + minutes);
    state.perDateCount.set(day.date, (state.perDateCount.get(day.date) ?? 0) + 1);
    dayRemaining[dayIndex] -= minutes;
  };

  /* ---- 3. Reserve pre-exam review sessions ---------------------------- */

  const examOrder = tasks
    .filter((t) => t.sourceType === 'exam' && (t.finalReviewMinutes ?? 0) > 0)
    .sort((a, b) =>
      a.deadlineDate !== b.deadlineDate
        ? a.deadlineDate < b.deadlineDate
          ? -1
          : 1
        : a.key < b.key
          ? -1
          : 1,
    );

  for (const task of examOrder) {
    const state = states.get(task.key)!;
    const index = lastIndexOf(task);
    if (index < 0) continue;
    if (skipped.has(`${task.key}@${days[index].date}`)) continue;
    const ceiling = Math.min(ceilingOn(task, index), dayRemaining[index]);
    const minutes = Math.min(task.finalReviewMinutes ?? 0, state.remaining, ceiling);
    if (minutes <= 0) continue;
    if (minutes < settings.minChunkMinutes && minutes < state.remaining) continue;
    place(state, index, minutes, {
      finalReview: true,
      codes: ['exam_final_review'],
    });
  }

  /* ---- 4. Day-major greedy fill --------------------------------------- */

  /**
   * One day, one pass.
   *
   * The first pass gives every task at most one session, which is what spreads
   * an evening across subjects instead of handing it all to whatever scored
   * highest. The second pass then tops up: a student can do two sessions of
   * Biology in one evening, and refusing to plan that would leave work
   * stranded and reported as impossible when it plainly is not.
   */
  const fillDay = (i: number, pass: 1 | 2) => {
    const day = days[i];
    if (day.restDay || dayRemaining[i] <= 0) return;

    const blocked = new Set<string>();
    let guard = 0;

    while (dayRemaining[i] > 0 && guard < MAX_ITEMS_PER_DAY) {
      guard += 1;

      const candidates: { score: number; task: WorkTask; opportunities: number }[] = [];
      for (const task of tasks) {
        const state = states.get(task.key)!;
        if (state.remaining <= 0) continue;
        if (blocked.has(task.key)) continue;
        const usedToday = state.perDate.get(day.date) ?? 0;
        const sessionsToday = state.perDateCount.get(day.date) ?? 0;
        if (pass === 1 && sessionsToday > 0) continue;
        if (sessionsToday >= MAX_CHUNKS_PER_TASK_PER_DAY) continue;
        if (usedToday >= ceilingOn(task, i)) continue;
        if (skipped.has(`${task.key}@${day.date}`)) continue;
        const lastIndex = lastIndexOf(task);
        if (lastIndex < i) continue;

        const opportunities = countOpportunities(days, dayRemaining, i, lastIndex);
        const scored = scoreTask(task, {
          daysLeft: daysBetween(day.date, task.deadlineDate) ?? 0,
          daysOverdue: task.overdue
            ? Math.abs(daysBetween(task.deadlineDate, day.date) ?? 0)
            : 0,
          capacityBeforeDeadline: capacityBeforeDeadline(
            days,
            dayRemaining,
            i,
            lastIndex,
            task,
            ceilingOn,
          ),
          opportunities,
          remainingMinutes: state.remaining,
        });
        candidates.push({ score: scored.score, task, opportunities });
      }

      if (candidates.length === 0) break;
      candidates.sort(compareScored);
      const chosen = candidates[0];
      const state = states.get(chosen.task.key)!;

      const minutes = computeChunk(
        state.remaining,
        dayRemaining[i],
        ceilingOn(chosen.task, i) - (state.perDate.get(day.date) ?? 0),
        settings,
      );
      if (minutes <= 0) {
        // Not enough room for a sensible chunk of *this* task today; another
        // task may still fit, so block only this one.
        blocked.add(chosen.task.key);
        guard -= 1;
        if (blocked.size >= tasks.length) break;
        continue;
      }

      place(state, i, minutes);
    }
  };

  for (let i = 0; i < days.length; i += 1) fillDay(i, 1);
  for (let i = 0; i < days.length; i += 1) fillDay(i, 2);

  /* ---- 5. Assemble, number the chunks, lay out the clock -------------- */

  const perTask = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = perTask.get(p.task.key) ?? [];
    list.push(p);
    perTask.set(p.task.key, list);
  }

  const itemsByDate = new Map<string, PlannedWorkItem[]>();
  for (const list of perTask.values()) {
    // Date order, with a reserved review always the last session of its day —
    // otherwise "final review" could be numbered before the work it reviews.
    list.sort(
      (a, b) =>
        (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
        Number(a.finalReview) - Number(b.finalReview),
    );
    const total = list.length;
    list.forEach((p, index) => {
      const item: PlannedWorkItem = {
        id: `plan_${p.task.sourceType}_${p.task.sourceId}_${index + 1}`,
        sourceType: p.task.sourceType,
        sourceId: p.task.sourceId,
        subject: p.task.subject,
        title: p.task.title,
        chunkIndex: index + 1,
        chunkCount: total,
        plannedMinutes: p.minutes,
        reason: {
          codes: dedupe([
            ...p.codes,
            ...(total > 1 && p.task.sourceType === 'exam' ? (['exam_spaced_study'] as const) : []),
          ]),
          facts: { ...p.facts, chunkIndex: index + 1, chunkCount: total },
        },
        status: 'planned',
        scheduledDate: p.date,
        priorityScore: p.score,
        finalReview: p.finalReview || undefined,
      };
      const bucket = itemsByDate.get(p.date) ?? [];
      bucket.push(item);
      itemsByDate.set(p.date, bucket);
    });
  }

  const manualOrder = new Map(inputs.manualOrders.map((m) => [m.date, m.order]));
  const previousOrder = previousOrderByDate(inputs.previousPlan, inputs.lockedDates);

  const plannedDays: PlannedDay[] = days.map((day) => {
    const items = itemsByDate.get(day.date) ?? [];
    const ordered = orderItems(items, manualOrder.get(day.date) ?? previousOrder.get(day.date));
    const laidOut = layOutDay(ordered, day, settings);
    return {
      date: day.date,
      availableMinutes: day.availableMinutes,
      capacityMinutes: day.capacityMinutes,
      plannedMinutes: laidOut.reduce((sum, i) => sum + i.plannedMinutes, 0),
      restDay: day.restDay,
      items: laidOut,
    };
  });

  /* ---- Warnings -------------------------------------------------------- */

  const warnings = buildWarnings({
    days,
    dayRemaining,
    plannedDays,
    states,
    settings,
    horizonEnd,
    today,
  });

  const unscheduledMinutes = [...states.values()].reduce(
    (sum, s) => sum + Math.max(0, s.remaining),
    0,
  );

  const plan: StudyPlan = {
    id: `plan_${inputs.planVersion}`,
    planVersion: inputs.planVersion,
    generatedAt: now.toISOString(),
    reason: inputs.reason,
    planningHorizonStart: today,
    planningHorizonEnd: horizonEnd,
    days: plannedDays,
    warnings,
    unscheduledMinutes,
  };

  return annotateMovement(plan, inputs.previousPlan, today);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function dedupe(codes: readonly PlanningReasonCode[]): PlanningReasonCode[] {
  return [...new Set(codes)].slice(0, 8);
}

/** Days with any capacity left between `from` and `to`, inclusive. */
function countOpportunities(
  days: DayCapacity[],
  dayRemaining: number[],
  from: number,
  to: number,
): number {
  let count = 0;
  for (let i = from; i <= to && i < days.length; i += 1) {
    if (!days[i].restDay && dayRemaining[i] > 0) count += 1;
  }
  return count;
}

/** Minutes this task could still use before its deadline. */
function capacityBeforeDeadline(
  days: DayCapacity[],
  dayRemaining: number[],
  from: number,
  to: number,
  task: WorkTask,
  ceilingOn: (task: WorkTask, dayIndex: number) => number,
): number {
  let total = 0;
  for (let i = from; i <= to && i < days.length; i += 1) {
    if (days[i].restDay) continue;
    total += Math.min(dayRemaining[i], ceilingOn(task, i));
  }
  return total;
}

/** Applies a manual (or locked) ordering; unknown items keep their place. */
export function orderItems(
  items: PlannedWorkItem[],
  order: string[] | undefined,
): PlannedWorkItem[] {
  const base = [...items].sort(
    (a, b) =>
      // A reserved review is the *last* thing done before the exam, so it ends
      // the day whatever it scored.
      Number(a.finalReview) - Number(b.finalReview) ||
      b.priorityScore - a.priorityScore ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  if (!order || order.length === 0) return base;
  const rank = new Map(order.map((key, index) => [key, index]));
  return base
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ra = rank.get(sourceKey(a.item.sourceType, a.item.sourceId)) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(sourceKey(b.item.sourceType, b.item.sourceId)) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.index - b.index;
    })
    .map((entry) => entry.item);
}

/** Locked dates keep the order the previous plan had for them. */
function previousOrderByDate(
  previous: StudyPlan | null,
  lockedDates: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!previous) return result;
  for (const date of lockedDates) {
    const day = previous.days.find((d) => d.date === date);
    if (!day) continue;
    result.set(
      date,
      day.items.map((i) => sourceKey(i.sourceType, i.sourceId)),
    );
  }
  return result;
}

function buildWarnings(ctx: {
  days: DayCapacity[];
  dayRemaining: number[];
  plannedDays: PlannedDay[];
  states: Map<string, TaskProgressState>;
  settings: PlannerInputs['settings'];
  horizonEnd: string;
  today: string;
}): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const shortfallByDate = new Map<string, number>();
  const impossibleSources = new Set<string>();

  for (const state of ctx.states.values()) {
    if (state.remaining <= 0) continue;
    const task = state.task;
    // Work whose deadline is past the horizon is simply not planned yet; that
    // is not a problem, it is the horizon doing its job.
    if (task.lastUsableDate > ctx.horizonEnd) continue;

    impossibleSources.add(task.key);
    shortfallByDate.set(
      task.lastUsableDate,
      (shortfallByDate.get(task.lastUsableDate) ?? 0) + state.remaining,
    );

    const planned = task.remainingMinutes - state.remaining;
    warnings.push({
      id: `warn_fit_${task.key}`,
      kind: task.sourceType === 'exam' ? 'exam_impossible' : 'assignment_cannot_fit',
      severity: task.overdue || task.lastUsableDate === ctx.today ? 'critical' : 'warning',
      sourceType: task.sourceType,
      sourceId: task.sourceId,
      title: task.title,
      date: task.lastUsableDate,
      facts: {
        neededMinutes: task.remainingMinutes,
        plannedMinutes: planned,
        shortfallMinutes: state.remaining,
        deadline: task.deadlineDate,
      },
    });
  }

  /* Exams that are schedulable but under-served: everything fits inside the
     horizon, yet the recommended study time is not fully placed. */
  for (const state of ctx.states.values()) {
    const task = state.task;
    if (task.sourceType !== 'exam' || impossibleSources.has(task.key)) continue;
    if (state.remaining <= 0) continue;
    warnings.push({
      id: `warn_exam_${task.key}`,
      kind: 'exam_under_scheduled',
      severity: 'info',
      sourceType: 'exam',
      sourceId: task.sourceId,
      title: task.title,
      date: task.deadlineDate,
      facts: {
        plannedMinutes: task.remainingMinutes - state.remaining,
        recommendedMinutes: task.rawEstimateMinutes,
        shortfallMinutes: state.remaining,
      },
    });
  }

  /* A day is overloaded when the work that must happen by then exceeds what
     the day can hold. The planner never overbooks, so this reports the
     pressure rather than a schedule that lies about it. */
  for (const day of ctx.plannedDays) {
    const shortfall = shortfallByDate.get(day.date) ?? 0;
    if (shortfall <= 0) continue;
    warnings.push({
      id: `warn_day_${day.date}`,
      kind: 'day_overloaded',
      severity: 'warning',
      title: day.date,
      date: day.date,
      facts: {
        requiredMinutes: day.plannedMinutes + shortfall,
        availableMinutes: day.capacityMinutes,
        shortfallMinutes: shortfall,
      },
    });
  }

  /* Rest days are never used silently. If something could not fit and a rest
     day sits inside the window, say so instead of quietly filling it. */
  if (shortfallByDate.size > 0) {
    const restDay = ctx.days.find((d) => d.restDay && d.restDayCapacityMinutes > 0);
    if (restDay) {
      warnings.push({
        id: 'warn_rest_day',
        kind: 'rest_day_used',
        severity: 'info',
        title: restDay.date,
        date: restDay.date,
        facts: { restDayMinutes: restDay.restDayCapacityMinutes },
      });
    }
  }

  const totalCapacity = ctx.days.reduce((sum, d) => sum + d.capacityMinutes, 0);
  if (totalCapacity === 0 && ctx.states.size > 0) {
    warnings.push({
      id: 'warn_no_availability',
      kind: 'no_availability',
      severity: 'critical',
      title: 'No study time set',
      facts: { horizonDays: ctx.days.length },
    });
  }

  return warnings.sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return rank[a.severity] - rank[b.severity] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
