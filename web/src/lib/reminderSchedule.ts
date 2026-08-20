/**
 * Turning app state into the small schedule the extension fires from.
 *
 * Pure — no clock reads, no dispatch, no bridge calls. `now` is an input, the
 * same rule the planner follows, so this can be tested without faking time.
 *
 * ## Why a schedule rather than "just send the assignments"
 *
 * The extension is the wrong place for LockIn's data model, and every field
 * that crosses into it is a field that lives in a second store, ages
 * separately, and has to be reasoned about twice. So it gets the minimum a
 * notification needs to be worth reading — a title, a due time, and the
 * student's own stage offsets — and nothing else.
 *
 * Completed work is dropped here rather than filtered there. An extension
 * holding due dates for finished assignments would be carrying data with no
 * purpose, and the honest place to fix that is at the source.
 */
import type { AppState } from '../types';
import { isComplete } from './selectors';
import { parseDueDate } from './time';

export interface ReminderScheduleItem {
  id: string;
  title: string;
  /** ISO. The extension compares against this and nothing else. */
  dueAt: string;
  /** Minutes before `dueAt` for each stage, from the student's own settings. */
  first: number;
  escalation: number;
  warning: number;
  /** One short clause of context, e.g. "Edgenuity says you're 6% behind." */
  behind?: string;
}

/** Nothing is scheduled further out than this — it is not a reminder yet. */
const HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
/** Matches the extension's own cap; sending more would only be trimmed there. */
const MAX_ITEMS = 100;


export function buildReminderSchedule(state: AppState, now: number): ReminderScheduleItem[] {
  const items: ReminderScheduleItem[] = [];

  for (const assignment of state.assignments) {
    if (isComplete(assignment) || !assignment.reminders.enabled) continue;
    const due = parseDueDate(assignment.dueDate, assignment.dueTime);
    if (!due) continue;

    const untilDue = due.getTime() - now;
    if (untilDue > HORIZON_MS) continue;
    // Twelve hours past due, the extension stops nagging too; sending it would
    // only hand over a due date nothing will ever use.
    if (untilDue < -12 * 60 * 60 * 1000) continue;

    items.push({
      id: assignment.id,
      title: assignment.title.slice(0, 80),
      dueAt: due.toISOString(),
      first: assignment.reminders.firstReminderMinutes,
      escalation: assignment.reminders.escalationMinutes,
      warning: assignment.reminders.focusWarningMinutes,
    });
  }

  // Soonest first, so the cap drops the least urgent work rather than whatever
  // happened to be last in the array.
  items.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  return items.slice(0, MAX_ITEMS);
}

/**
 * A stable key for "has this schedule actually changed?".
 *
 * The schedule is rebuilt on every state change, and re-sending an identical
 * one would wake the service worker for nothing. Deliberately excludes
 * nothing — every field here changes what the student would be told.
 */
export function scheduleKey(items: ReminderScheduleItem[]): string {
  return items
    .map((i) => `${i.id}:${i.dueAt}:${i.first}/${i.escalation}/${i.warning}:${i.behind ?? ''}`)
    .join('|');
}
