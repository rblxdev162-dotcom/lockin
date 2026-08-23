/**
 * The shape of today, in real clock time.
 *
 * ## What was wrong
 *
 * The Home rail drew four fixed words — School · Break · Homework · Finished —
 * with a dot sliding across them. It said the same thing on a Saturday as on a
 * Tuesday, it named no actual times, and it recommended nothing: a student
 * looking at it learned only that time passes.
 *
 * This module answers the two questions that rail was pretending to:
 *
 *   1. **What kind of day is this?** A school day, a free day (weekend or a
 *      day the student marked as no-school), and on a free day whether they
 *      have actually planned to study.
 *   2. **When, concretely, is the homework part?** Real blocks with real
 *      times, and which of them LockIn suggests using, sized by how much work
 *      is actually close.
 *
 * ## Rules it will not break
 *
 * - It never invents a school day. `homeworkWindowFrom` returns `null` when
 *   neither the schedule nor the Canvas window has been configured, and this
 *   returns `null` too rather than guessing an interval — the same refusal the
 *   blocking code makes, for the same reason.
 * - A free day is never dressed up as a school day. No "Morning mode" on a
 *   Saturday.
 * - A suggestion is a suggestion. Nothing here blocks, unblocks, completes or
 *   schedules anything; `isBlockingActive` and the planner are untouched.
 */
import type { Assignment } from '../types';
import type { AvailabilityDay } from '../types/planner';
import type { SchoolSchedule } from './schoolSchedule';
import {
  homeworkWindowFrom,
  localISODate,
  minutesOfDay,
  type HomeworkWindow,
} from './schoolSchedule';
import { dueTimestamp, isComplete } from './selectors';

/** A free day is a weekend or a day the student marked as no-school. */
export type DayKind = 'school' | 'weekend' | 'day_off';

export type BlockKind = 'school' | 'homework' | 'break' | 'free';

export interface DayBlock {
  /** Minutes past midnight. */
  start: number;
  end: number;
  kind: BlockKind;
  /** "School", "3:30 – 6:30", "Dinner" — the words shown on the rail. */
  label: string;
  /** LockIn suggests working here, because work is close and this slot is free. */
  recommended: boolean;
  /** `now` falls inside this block. */
  current: boolean;
}

export interface DayShape {
  kind: DayKind;
  /** "After school", "Chill weekend" — the one-line answer. */
  headline: string;
  /** The sentence under it. Always says something true about today. */
  detail: string;
  blocks: DayBlock[];
  /** Where "you are here" sits across the whole strip, 0–100. */
  markerPercent: number;
  /** Minutes of work LockIn thinks today is worth, before any buffer. */
  suggestedMinutes: number;
  /** Minutes past midnight the homework part of the day begins. */
  homeworkFrom: number;
}

/** Blocks are three hours, which is long enough to mean something and short
 * enough that an evening has more than one of them. */
const BLOCK_MINUTES = 3 * 60;
/**
 * Below this, a leftover gap is not a block worth naming.
 *
 * Breaks that butt up against the three-hour grid used to leave slivers — a
 * student whose shift ran to 11:59pm was offered "11:59pm – 12am" as the slot
 * for two hours of homework. Fifteen minutes matches the planner's own
 * `minChunkMinutes`: the smallest piece of work it will schedule.
 */
const MIN_BLOCK_MINUTES = 15;
const END_OF_DAY = 24 * 60;
/** Nobody is doing six hours on a Tuesday; a suggestion that says so is noise. */
const MAX_SUGGESTED_MINUTES = 4 * 60;

export function formatClock(minutes: number): string {
  const total = Math.max(0, Math.min(END_OF_DAY, Math.round(minutes)));
  if (total === END_OF_DAY) return 'midnight';
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour24 < 12 ? 'am' : 'pm';
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${hour}${suffix}` : `${hour}:${String(minute).padStart(2, '0')}${suffix}`;
}

/**
 * How much work today is actually carrying: everything overdue, everything due
 * today, and tomorrow's work at half weight — it is real, but it is not
 * tonight's emergency.
 */
export function workloadMinutes(assignments: Assignment[], now: Date): number {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfTomorrow = endOfToday.getTime() + 24 * 60 * 60 * 1000;

  let total = 0;
  for (const assignment of assignments) {
    if (isComplete(assignment)) continue;
    const due = dueTimestamp(assignment);
    if (!Number.isFinite(due) || due === Number.MAX_SAFE_INTEGER) continue;
    const remaining = Math.max(0, assignment.estimatedMinutes - assignment.loggedMinutes);
    if (remaining === 0) continue;
    if (due <= endOfToday.getTime()) total += remaining;
    else if (due <= endOfTomorrow) total += remaining / 2;
  }
  return Math.min(MAX_SUGGESTED_MINUTES, Math.round(total));
}

/**
 * A block's name is its own clock times. Midnight is written `12am` here
 * rather than the word — five of these sit side by side on a phone, and the
 * long word is the one that gets cut off.
 */
function blockLabel(start: number, end: number): string {
  return `${formatClock(start)} – ${end >= END_OF_DAY ? '12am' : formatClock(end)}`;
}

/** Breaks the student listed that land inside the homework part of the day. */
function eveningBreaks(schedule: SchoolSchedule, weekday: number, from: number) {
  return schedule.breaks
    .filter((item) => item.days.includes(weekday))
    .map((item) => ({ start: minutesOfDay(item.start), end: minutesOfDay(item.end), label: item.label }))
    .filter((item) => item.end > from && item.end > item.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Splits `from`–`until` into three-hour blocks, carving out the student's own
 * breaks so a suggestion never lands on top of dinner.
 */
function buildBlocks(from: number, until: number, breaks: { start: number; end: number; label: string }[]) {
  const blocks: { start: number; end: number; kind: BlockKind; label: string }[] = [];
  let cursor = from;

  /**
   * A working span, cut into three-hour blocks. A final piece too small to be
   * a block is folded into the one before it rather than shown as its own
   * near-empty slot; if there is nothing before it, it is marked `free`, which
   * the suggestion pass never fills.
   */
  const fillTo = (edge: number) => {
    while (cursor < edge) {
      const end = Math.min(edge, cursor + BLOCK_MINUTES);
      const remaining = edge - end;
      // Absorb a would-be sliver into this block instead of leaving it behind.
      const stop = remaining > 0 && remaining < MIN_BLOCK_MINUTES ? edge : end;
      if (stop - cursor < MIN_BLOCK_MINUTES) {
        const previous = blocks.at(-1);
        if (previous && previous.kind === 'homework' && previous.end === cursor) {
          previous.end = stop;
          previous.label = blockLabel(previous.start, stop);
        } else {
          blocks.push({ start: cursor, end: stop, kind: 'free', label: blockLabel(cursor, stop) });
        }
      } else {
        blocks.push({ start: cursor, end: stop, kind: 'homework', label: blockLabel(cursor, stop) });
      }
      cursor = stop;
    }
  };

  for (const item of breaks) {
    const start = Math.max(from, item.start);
    const end = Math.min(until, item.end);
    // An overlapping or already-passed break adds nothing; the cursor has it.
    if (end <= cursor || start >= until) continue;
    fillTo(start);
    if (end > cursor) {
      blocks.push({ start: cursor, end, kind: 'break', label: item.label });
      cursor = end;
    }
  }

  fillTo(until);
  return blocks;
}

export interface DayShapeInput {
  now: Date | number;
  schedule: SchoolSchedule;
  canvasWindow: { schoolDays: number[]; schoolDayStart: number; freeDayStart: number } | null;
  assignments: Assignment[];
  /**
   * The student's planner availability, so a planned weekend is respected —
   * and whether they ever configured it. The shipped default marks every day
   * of the week available, so without that flag "you set this as a study day"
   * would be true of a student who has never opened the planner, and "Chill
   * weekend" could never appear at all.
   */
  availability?: AvailabilityDay[];
  plannerConfigured?: boolean;
  /** Dates marked no-school, from the local toolkit. */
  noSchoolDates?: string[];
}

/**
 * Today, described. Returns `null` when LockIn genuinely does not know when
 * school is — the caller shows nothing rather than a made-up day.
 */
export function dayShapeOf(input: DayShapeInput): DayShape | null {
  const window: HomeworkWindow | null = homeworkWindowFrom(input.schedule, input.canvasWindow);
  if (!window) return null;

  const at = input.now instanceof Date ? new Date(input.now) : new Date(input.now);
  const current = at.getHours() * 60 + at.getMinutes();
  const weekday = at.getDay();
  const markedOff = (input.noSchoolDates ?? []).includes(localISODate(at));
  const isSchoolDay = !markedOff && window.schoolDays.includes(weekday);
  const kind: DayKind = isSchoolDay ? 'school' : markedOff ? 'day_off' : 'weekend';

  const suggestedMinutes = workloadMinutes(input.assignments, at);
  const planned = input.availability?.find((day) => day.weekday === weekday);
  /**
   * A free day only becomes a study day if the student said so or the work
   * says so. "Chill weekend" has to be able to be the honest answer, or the
   * app is just a nag with a calendar.
   */
  const plannedStudyDay =
    input.plannerConfigured === true && planned ? planned.available && !planned.restDay : false;
  const studyToday = isSchoolDay || suggestedMinutes > 0 || plannedStudyDay;

  const homeworkFrom = isSchoolDay ? window.from : window.freeDayFrom;
  /**
   * The strip starts at the first bell — unless the schedule's own start time
   * disagrees with where homework hours begin, which happens when the hours
   * were incoherent and `homeworkWindowFrom` fell back to the Canvas window.
   * Then there is no honest school block to draw, and drawing a stub one
   * ("School, 3:00–3:30pm") would be inventing a school day.
   */
  const schoolStart = minutesOfDay(input.schedule.schoolStart);
  const showSchoolBlock = isSchoolDay && homeworkFrom > schoolStart;
  const stripFrom = showSchoolBlock ? schoolStart : homeworkFrom;
  const stripUntil = END_OF_DAY;

  const raw: { start: number; end: number; kind: BlockKind; label: string }[] = [];
  if (showSchoolBlock) {
    raw.push({ start: stripFrom, end: homeworkFrom, kind: 'school', label: 'School' });
  }
  raw.push(...buildBlocks(homeworkFrom, stripUntil, eveningBreaks(input.schedule, weekday, homeworkFrom)));

  /**
   * Which blocks to suggest.
   *
   * The work is laid into the earliest free blocks after the day's homework
   * hour, skipping the student's own breaks. A block is suggested if any of
   * the needed minutes land in it, so two hours of work on a 3:30 finish
   * suggests one block, not the whole evening.
   */
  let left = studyToday ? suggestedMinutes : 0;
  const blocks: DayBlock[] = raw.map((block) => {
    const usable = block.kind === 'homework' ? block.end - block.start : 0;
    const used = Math.min(left, usable);
    left -= used;
    return {
      ...block,
      recommended: used > 0,
      current: current >= block.start && current < block.end,
    };
  });

  const markerPercent = Math.max(
    0,
    Math.min(100, ((current - stripFrom) / Math.max(1, stripUntil - stripFrom)) * 100),
  );

  return {
    kind,
    ...describe({ kind, current, homeworkFrom, suggestedMinutes, plannedStudyDay, blocks }),
    blocks,
    markerPercent,
    suggestedMinutes,
    homeworkFrom,
  };
}

export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} h ${rest} min`;
}

function describe({
  kind,
  current,
  homeworkFrom,
  suggestedMinutes,
  plannedStudyDay,
  blocks,
}: {
  kind: DayKind;
  current: number;
  homeworkFrom: number;
  suggestedMinutes: number;
  plannedStudyDay: boolean;
  blocks: DayBlock[];
}): { headline: string; detail: string } {
  const nextRecommended = blocks.find((block) => block.recommended && block.end > current);
  const work = suggestedMinutes > 0 ? formatDuration(suggestedMinutes) : null;

  if (kind === 'school') {
    if (current < homeworkFrom) {
      return {
        headline: 'School day',
        detail: work
          ? `Homework time starts at ${formatClock(homeworkFrom)} · about ${work} of work is close.`
          : `Homework time starts at ${formatClock(homeworkFrom)} · nothing is close right now.`,
      };
    }
    if (!work) {
      return {
        headline: 'After school',
        detail: 'Nothing is due today or tomorrow. Anything you do now is getting ahead.',
      };
    }
    return {
      headline: 'After school',
      detail: nextRecommended
        ? `About ${work} of work is close · ${nextRecommended.label} is the slot for it.`
        : `About ${work} of work is close.`,
    };
  }

  if (kind === 'day_off') {
    return {
      headline: 'Day off',
      detail: work
        ? `No school today · about ${work} of work is still close.`
        : 'No school today, and nothing is close. Normal school prompts are paused.',
    };
  }

  // Weekend.
  if (!work && !plannedStudyDay) {
    return {
      headline: 'Chill weekend',
      detail: 'Nothing is due before the next school day. LockIn is off your back.',
    };
  }
  if (!work && plannedStudyDay) {
    return {
      headline: 'Weekend',
      detail: `You set this as a study day · nothing is close, so ${formatClock(homeworkFrom)} onwards is yours.`,
    };
  }
  return {
    headline: 'Weekend, with work waiting',
    detail: nextRecommended
      ? `About ${work} of work is close · ${nextRecommended.label} would clear it.`
      : `About ${work} of work is close.`,
  };
}
