/**
 * Assignments → schedulable work.
 *
 * Two things decide whether an assignment appears in a plan at all: whether it
 * is finished, and how much of its estimate is left. Completion is read from
 * the assignment's own status, which is what makes verification sources
 * irrelevant here — Canvas, Edgenuity, the timer and a plain checkbox all end
 * up as `status: 'Completed'`, and the planner reacts to that one fact rather
 * than knowing about any of them.
 */
import type { Assignment, PlannerSettings } from '../../types';
import { addDaysISO, minutesOfDay, parseDueDate, todayISO } from '../time';
import { capacityFor, windowMinutes } from './capacity';
import { effectiveFactor } from './estimation';
import type { SubjectFactor } from './estimation';
import type { DayCapacity, TimeWindow, WorkTask } from './types';

/** Minutes of work left on an assignment, before any speed adjustment. */
export function rawRemainingMinutes(a: Assignment): number {
  if (a.status === 'Completed') return 0;
  return Math.max(0, Math.round(a.estimatedMinutes - a.loggedMinutes));
}

/**
 * Minutes of work left, with the subject speed factor applied.
 *
 * The factor scales the *estimate*, not the remainder: logged minutes are
 * measured facts and must never be stretched by a correction term.
 */
export function remainingMinutes(
  a: Assignment,
  factors: Map<string, SubjectFactor>,
  options: { useAdjustedEstimates: boolean; accepted: string[] },
): number {
  if (a.status === 'Completed') return 0;
  const factor = effectiveFactor(a.subject, factors, options);
  const adjusted = Math.round(a.estimatedMinutes * factor);
  return Math.max(0, adjusted - Math.round(a.loggedMinutes));
}

/** Clips a day's windows to end at `limit` minutes past midnight. */
export function clipWindows(windows: TimeWindow[], limit: number): TimeWindow[] {
  return windows
    .map((w) => ({ start: w.start, end: Math.min(w.end, limit) }))
    .filter((w) => w.end > w.start);
}

export interface Deadline {
  /** Local date the work must be finished by, after the safety buffer. */
  dateISO: string;
  /** Minutes past midnight on that date. */
  minutes: number;
  overdue: boolean;
}

/**
 * The date and time work has to be finished by.
 *
 * The buffer is a *duration* before the due instant, so it is subtracted in
 * milliseconds — three hours before 11:59 PM is 8:59 PM on any calendar. Day
 * arithmetic elsewhere in the planner goes through `addDaysISO`, which walks
 * the local calendar instead, because a day is not always 24 hours long.
 */
export function assignmentDeadline(a: Assignment, settings: PlannerSettings, now: Date): Deadline | null {
  const due = parseDueDate(a.dueDate, a.dueTime);
  if (!due) return null;
  const effective = new Date(due.getTime() - settings.deadlineBufferHours * 3_600_000);
  return {
    dateISO: todayISO(effective),
    minutes: effective.getHours() * 60 + effective.getMinutes(),
    overdue: effective.getTime() < now.getTime(),
  };
}

/**
 * The last day in the horizon this work may actually be placed on.
 *
 * Walks backwards from the deadline day until it finds a day with usable time,
 * because "due at 8 AM Friday" means Thursday evening in practice. When
 * nothing is usable the deadline day is returned anyway — the engine then
 * reports it as unschedulable rather than pretending it fitted.
 */
export function lastUsableDate(deadline: Deadline, days: DayCapacity[]): string {
  const horizonEnd = days.length ? days[days.length - 1].date : deadline.dateISO;
  const capped = deadline.dateISO > horizonEnd ? horizonEnd : deadline.dateISO;
  const today = days[0]?.date ?? capped;
  if (capped < today) return today;

  for (let date = capped; date >= today; date = addDaysISO(date, -1)) {
    const day = days.find((d) => d.date === date);
    if (!day) continue;
    const windows =
      date === deadline.dateISO ? clipWindows(day.windows, deadline.minutes) : day.windows;
    if (windowMinutes(windows) > 0 && !day.restDay) return date;
  }
  return capped;
}

/**
 * The capacity one task may use on one day.
 *
 * Identical to the day's own capacity except on the deadline day, where the
 * hours after the deadline are no use to this particular task even though they
 * are still available to everything else.
 */
export function taskCapacityOnDay(
  day: DayCapacity,
  deadline: Deadline | null,
  settings: PlannerSettings,
): number {
  if (!deadline || day.date !== deadline.dateISO) return day.capacityMinutes;
  const clipped = clipWindows(day.windows, deadline.minutes);
  return Math.min(day.capacityMinutes, capacityFor(windowMinutes(clipped), day.weekday, settings));
}

export interface AssignmentTaskOptions {
  now: Date;
  settings: PlannerSettings;
  factors: Map<string, SubjectFactor>;
  accepted: string[];
  days: DayCapacity[];
}

/** Every unfinished assignment with work left, as a schedulable task. */
export function buildAssignmentTasks(
  assignments: Assignment[],
  options: AssignmentTaskOptions,
): { tasks: WorkTask[]; deadlines: Map<string, Deadline | null> } {
  const tasks: WorkTask[] = [];
  const deadlines = new Map<string, Deadline | null>();
  const horizonEnd =
    options.days.length > 0
      ? options.days[options.days.length - 1].date
      : todayISO(options.now);

  for (const a of assignments) {
    const remaining = remainingMinutes(a, options.factors, {
      useAdjustedEstimates: options.settings.useAdjustedEstimates,
      accepted: options.accepted,
    });
    if (remaining <= 0) continue;

    const deadline = assignmentDeadline(a, options.settings, options.now);
    deadlines.set(a.id, deadline);

    /**
     * The window this work may be placed in.
     *
     * Overdue work is the case worth being careful about: its deadline is in
     * the past, so capping the window at the deadline would leave it
     * schedulable only today — and if today is already full or already over,
     * it would be reported as impossible and quietly stop being planned at
     * all. Late homework is still homework, so an overdue task stays
     * schedulable across the whole horizon and relies on its (very high)
     * urgency score to be pulled to the earliest day that has room.
     *
     * Undated work is real too (Canvas uses it for ongoing tasks): it is
     * planned against the end of the horizon rather than dropped, and carries
     * no urgency of its own.
     */
    const usable =
      !deadline || deadline.overdue ? horizonEnd : lastUsableDate(deadline, options.days);

    tasks.push({
      key: `assignment:${a.id}`,
      sourceType: 'assignment',
      sourceId: a.id,
      title: a.title,
      subject: a.subject,
      remainingMinutes: remaining,
      rawEstimateMinutes: a.estimatedMinutes,
      loggedMinutes: Math.round(a.loggedMinutes),
      lastUsableDate: usable,
      deadlineDate: a.dueDate,
      deadlineTime: a.dueTime,
      overdue: deadline?.overdue === true,
      priority: a.priority,
      createdAt: a.createdAt,
    });
  }

  return { tasks, deadlines };
}

/** Minutes logged against a source on a given local date. */
export function minutesLoggedOn(
  sessions: { assignmentId: string | null; examId?: string | null; actualMinutes: number; endedAt: string }[],
  sourceType: 'assignment' | 'exam',
  sourceId: string,
  dateISO: string,
): number {
  let total = 0;
  for (const s of sessions) {
    const id = sourceType === 'exam' ? (s.examId ?? null) : s.assignmentId;
    if (id !== sourceId) continue;
    const ended = new Date(s.endedAt);
    if (Number.isNaN(ended.getTime())) continue;
    if (todayISO(ended) !== dateISO) continue;
    total += Math.max(0, Math.round(s.actualMinutes));
  }
  return total;
}

/** `HH:MM` → minutes, defaulting to end of day. Small local convenience. */
export function endOfDayMinutes(timeHHMM?: string): number {
  return timeHHMM ? (minutesOfDay(timeHHMM) ?? 24 * 60) : 24 * 60;
}
