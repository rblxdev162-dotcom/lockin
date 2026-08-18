/**
 * Turning reason codes and calculated facts into sentences.
 *
 * Every line here is generated from a number the scheduler actually used. That
 * is the difference between an explanation and a decoration: if the wording
 * says "45 minutes remaining", 45 is the figure that entered the priority
 * score, not a plausible-looking number written next to it.
 *
 * There is no AI in LockIn, so nothing here says there is. The planner says
 * "LockIn scheduled this because…", never "AI thinks you should…".
 */
import type {
  PlanWarning,
  PlannedWorkItem,
  PlanningReasonCode,
  StudyPlan,
} from '../../types/planner';
import { formatDaysRemaining, formatTime } from '../time';

export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fact(item: PlannedWorkItem, key: string): number {
  const value = item.reason.facts[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * The bullet points behind "Why this?".
 *
 * Ordered by how much each factor mattered, so the first line is the actual
 * reason and the rest is supporting detail.
 */
export function explainItem(item: PlannedWorkItem): string[] {
  const lines: string[] = [];
  const days = fact(item, 'daysUntilDue');
  const remaining = fact(item, 'remainingMinutes');

  const has = (code: PlanningReasonCode) => item.reason.codes.includes(code);

  if (has('overdue')) {
    lines.push(`Overdue by ${formatDaysRemaining(days).toLowerCase()}`);
  } else if (has('due_today')) {
    lines.push('Due today');
  } else if (has('due_tomorrow')) {
    lines.push('Due tomorrow');
  } else if (has('exam_tomorrow')) {
    lines.push('Exam is tomorrow');
  } else if (item.sourceType === 'exam') {
    lines.push(`Exam in ${days} day${days === 1 ? '' : 's'}`);
  } else if (days > 0) {
    lines.push(`Due in ${days} day${days === 1 ? '' : 's'}`);
  }

  if (remaining > 0) lines.push(`About ${formatMinutes(remaining)} of work left`);
  if (has('priority_urgent')) lines.push('Marked Urgent');
  else if (has('priority_important')) lines.push('Marked Important');

  if (has('large_task_needs_early_start')) {
    lines.push('Large enough that it needs more than one session before the deadline');
  }
  if (has('few_opportunities')) {
    const opportunities = fact(item, 'opportunities');
    lines.push(
      opportunities <= 1
        ? 'Today is the only day left with study time before the deadline'
        : `Only ${opportunities} days with study time remain before the deadline`,
    );
  }
  if (has('exam_final_review')) lines.push('Reserved as the final review before the exam');
  else if (has('exam_spaced_study')) {
    lines.push(`Study is spread across ${item.chunkCount} sessions rather than crammed`);
  }
  if (has('moved_from_missed')) {
    lines.push(`Moved here from ${item.originalScheduledDate} — it was not finished that day`);
  } else if (has('work_ahead')) {
    lines.push(`Brought forward from ${item.originalScheduledDate} because later days are full`);
  }
  if (item.chunkCount > 1) {
    lines.push(`Session ${item.chunkIndex} of ${item.chunkCount}`);
  }

  return lines;
}

/** One-line summary for compact UI. */
export function summariseItem(item: PlannedWorkItem): string {
  return explainItem(item)[0] ?? 'Scheduled from your available study time';
}

/** The plain-language form of a calculated warning. */
export function explainWarning(warning: PlanWarning): { title: string; detail: string } {
  const f = (key: string) => {
    const value = warning.facts[key];
    return typeof value === 'number' ? value : 0;
  };

  switch (warning.kind) {
    case 'assignment_cannot_fit':
      return {
        title: `${warning.title} may not fit before its deadline`,
        detail: `${formatMinutes(f('neededMinutes'))} of work, ${formatMinutes(
          f('plannedMinutes'),
        )} scheduled — ${formatMinutes(f('shortfallMinutes'))} has nowhere to go with your current availability.`,
      };
    case 'exam_impossible':
      return {
        title: `Not enough study time before ${warning.title}`,
        detail: `Estimated ${formatMinutes(f('neededMinutes'))}, scheduled ${formatMinutes(
          f('plannedMinutes'),
        )} — short by ${formatMinutes(f('shortfallMinutes'))}.`,
      };
    case 'exam_under_scheduled':
      return {
        title: `${warning.title} has less study scheduled than recommended`,
        detail: `${formatMinutes(f('plannedMinutes'))} of a recommended ${formatMinutes(
          f('recommendedMinutes'),
        )}.`,
      };
    case 'day_overloaded':
      return {
        title: `${warning.date} is overloaded`,
        detail: `${formatMinutes(f('requiredMinutes'))} needed, ${formatMinutes(
          f('availableMinutes'),
        )} available — ${formatMinutes(f('shortfallMinutes'))} cannot fit.`,
      };
    case 'rest_day_used':
      return {
        title: 'A rest day is being kept free',
        detail: `${warning.date} is marked as a rest day, so LockIn left it empty. Some of the shortfall above would fit there if you changed it.`,
      };
    case 'no_availability':
      return {
        title: 'No study time set',
        detail: 'Add the times you are usually free and LockIn can build a plan.',
      };
    case 'past_deadline':
      return {
        title: `${warning.title} is past its deadline`,
        detail: 'It stays in the plan while it is still worth doing.',
      };
    default:
      return { title: warning.title, detail: '' };
  }
}

/** "Why did my plan change?" — from the plan's own reason field. */
export function explainPlanReason(plan: StudyPlan): string {
  switch (plan.reason) {
    case 'initial':
      return 'This is your first plan, built from your assignments, exams and availability.';
    case 'assignment_added':
      return 'A new assignment was added, so the remaining work was spread again.';
    case 'assignment_changed':
      return 'An assignment changed, so the plan was recalculated.';
    case 'assignment_completed':
      return 'You finished an assignment, so its remaining sessions were removed.';
    case 'assignment_deleted':
      return 'An assignment was deleted, so its sessions were removed.';
    case 'exam_added':
      return 'A new exam was added and its study time was spread across the days before it.';
    case 'exam_changed':
      return 'An exam changed, so its study sessions were spread again.';
    case 'exam_deleted':
      return 'An exam was deleted, so its study sessions were removed.';
    case 'missed_work':
      return 'Some planned work was not finished, so it was redistributed across the days ahead.';
    case 'session_logged':
      return 'You logged study time, so the remaining work was recalculated.';
    case 'availability_changed':
      return 'Your availability changed, so the plan was rebuilt around it.';
    case 'settings_changed':
      return 'Your planner settings changed, so the plan was rebuilt.';
    case 'manual_rebuild':
      return 'You asked LockIn to rebuild the plan.';
    case 'day_rollover':
      return 'A new day started, so unfinished work was carried forward.';
    default:
      return 'The plan was recalculated.';
  }
}

/** The one-line clock summary for an item, when it has times. */
export function itemTimeRange(item: PlannedWorkItem): string | null {
  if (!item.startTime || !item.endTime) return null;
  return `${formatTime(item.startTime)} – ${formatTime(item.endTime)}`;
}

/**
 * What the planner cannot know. Shown in the UI verbatim — this is not a
 * disclaimer for lawyers, it is the honest limit of a deterministic scheduler
 * working from estimates a student typed in.
 */
export const PLANNER_LIMITATIONS = [
  'How hard something will actually feel on the day',
  'Homework your teachers have not set yet',
  'What is really on an exam',
  'Changes your school makes after you enter them',
] as const;
