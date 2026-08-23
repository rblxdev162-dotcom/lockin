import { classSwitchLabel } from './classNames';

export const SCHOOL_DAYS = [
  { id: 1, short: 'M', label: 'Monday' },
  { id: 2, short: 'T', label: 'Tuesday' },
  { id: 3, short: 'W', label: 'Wednesday' },
  { id: 4, short: 'T', label: 'Thursday' },
  { id: 5, short: 'F', label: 'Friday' },
] as const;

export const CLASS_COLORS = ['brand', 'mint', 'sky', 'amber', 'violet', 'rose'] as const;
export type ClassColor = (typeof CLASS_COLORS)[number];

export interface ScheduledClass {
  id: string;
  name: string;
  days: number[];
  color: ClassColor;
  icon: string;
}

export interface SchoolBreak {
  id: string;
  label: string;
  start: string;
  end: string;
  days: number[];
}

export interface SchoolSchedule {
  configured: boolean;
  schoolStart: string;
  schoolEnd: string;
  /**
   * Days school happens, `Date.getDay()` numbering (schema v17).
   *
   * This used to be derived by unioning the meeting days of every class the
   * student typed in, which made one simple fact ("school is Monday to
   * Friday") a by-product of a much larger form — and made it wrong the moment
   * they stopped listing classes. It is one question now, asked once.
   */
  schoolDays: number[];
  classes: ScheduledClass[];
  breaks: SchoolBreak[];
  quietMode: boolean;
  /**
   * `YYYY-MM-DD` dates with no school — holidays, teacher workdays, snow days
   * (schema v16).
   *
   * These days are not school days, which cuts both ways: nothing is suspended
   * for a school day that is not happening, and automatic blocking starts at
   * the free-day hour instead of waiting for a last bell that never rings.
   */
  noSchoolDates: string[];
}

export function defaultSchoolSchedule(): SchoolSchedule {
  return {
    configured: false,
    schoolStart: '07:30',
    schoolEnd: '15:30',
    schoolDays: [1, 2, 3, 4, 5],
    classes: [],
    breaks: [],
    quietMode: false,
    noSchoolDates: [],
  };
}

const hhmm = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
const days = (value: unknown) =>
  Array.isArray(value)
    ? [...new Set(value.map(Number))].filter((day) => Number.isInteger(day) && day >= 1 && day <= 5)
    : [];

export function normalizeSchoolSchedule(value: unknown): SchoolSchedule {
  const base = defaultSchoolSchedule();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Record<string, unknown>;
  const classes = Array.isArray(raw.classes)
    ? raw.classes.flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
        if (!name) return [];
        const color = CLASS_COLORS.includes(item.color as ClassColor)
          ? (item.color as ClassColor)
          : CLASS_COLORS[index % CLASS_COLORS.length];
        return [{
          id: typeof item.id === 'string' ? item.id.slice(0, 80) : `class-${index}`,
          name,
          days: days(item.days),
          color,
          icon: typeof item.icon === 'string' ? item.icon.slice(0, 3) : name.slice(0, 1).toUpperCase(),
        }];
      }).slice(0, 30)
    : [];
  const breaks = Array.isArray(raw.breaks)
    ? raw.breaks.flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        const label = typeof item.label === 'string' ? item.label.trim().slice(0, 50) : '';
        if (!label) return [];
        return [{
          id: typeof item.id === 'string' ? item.id.slice(0, 80) : `break-${index}`,
          label,
          start: hhmm(item.start, '12:00'),
          end: hhmm(item.end, '12:30'),
          days: days(item.days),
        }];
      }).slice(0, 20)
    : [];
  /**
   * Before schema v17 the days lived on each class. A stored schedule from
   * then still knows its days — they are the union of what its classes met on
   * — so they are migrated rather than replaced with the Monday–Friday
   * default, which would quietly give a student with no Friday classes a
   * school day they do not have.
   */
  const storedDays = days(raw.schoolDays);
  const legacyDays = [...new Set(classes.flatMap((item) => item.days))].sort();
  const schoolDays = storedDays.length
    ? storedDays
    : legacyDays.length
      ? legacyDays
      : base.schoolDays;

  return {
    configured: raw.configured === true,
    schoolStart: hhmm(raw.schoolStart, base.schoolStart),
    schoolEnd: hhmm(raw.schoolEnd, base.schoolEnd),
    schoolDays,
    classes,
    breaks,
    quietMode: raw.quietMode === true,
    noSchoolDates: Array.isArray(raw.noSchoolDates)
      ? [...new Set(raw.noSchoolDates)]
          .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort()
          .slice(-180)
      : [],
  };
}

/**
 * Adopts the classes Canvas has actually produced work for.
 *
 * Onboarding used to ask the student to type every class. It no longer does —
 * the class list is a thing their school already knows, including the teacher
 * names Canvas puts in its course titles — so a subject seen on a real Canvas
 * assignment becomes a class here, which is what gives it a colour, an icon
 * and a place in the day's tools.
 *
 * Only additive: a class the student named or coloured themselves is never
 * rewritten, and nothing is ever removed, because a quiet week for one class
 * is not evidence they dropped it.
 */
export function withCanvasClasses(
  schedule: SchoolSchedule,
  assignments: {
    subject?: string;
    externalCourseId?: string;
    canvas?: { courseName?: string } | undefined;
  }[],
): SchoolSchedule {
  const known = new Set(schedule.classes.map((item) => item.name.trim().toLowerCase()));
  const additions: ScheduledClass[] = [];

  for (const assignment of assignments) {
    // Canvas-linked work only. Work the student typed by hand carries whatever
    // subject the quick-add parser guessed, and a guess is not evidence that a
    // class exists — it would put a permanent class in Settings for a typo.
    if (!assignment.canvas && !assignment.externalCourseId) continue;
    const name = (assignment.subject ?? '').trim().slice(0, 80);
    if (!name) continue;
    const key = name.toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    const index = schedule.classes.length + additions.length;
    if (index >= 30) break;
    additions.push({
      id: `class-canvas-${index}`,
      name,
      days: [...schedule.schoolDays],
      color: CLASS_COLORS[index % CLASS_COLORS.length],
      icon: classSwitchLabel(name).slice(0, 1).toUpperCase() || 'C',
    });
  }

  if (additions.length === 0) return schedule;
  return { ...schedule, classes: [...schedule.classes, ...additions] };
}

export function classStyle(schedule: SchoolSchedule, subject: string) {
  const full = subject.toLowerCase();
  const short = classSwitchLabel(subject).toLowerCase();
  return schedule.classes.find((item) => {
    const itemFull = item.name.toLowerCase();
    return itemFull === full || itemFull === short || classSwitchLabel(item.name).toLowerCase() === short;
  });
}

/* ------------------------------------------------------------------ */
/* School hours — the one definition of "school is happening"          */
/* ------------------------------------------------------------------ */

/**
 * The interval blocking must stay out of, in minutes past midnight.
 *
 * `days` uses `Date.getDay()` numbering (0 = Sunday), which the schedule's
 * 1–5 already matches.
 */
export interface SchoolHours {
  days: number[];
  from: number;
  until: number;
}

/**
 * True when the school day is a real interval: it ends after it starts, and
 * it leaves some of the day on the other side of the last bell.
 */
export function scheduleHasCoherentHours(schedule: SchoolSchedule): boolean {
  const from = minutesOfDay(schedule.schoolStart);
  const until = minutesOfDay(schedule.schoolEnd);
  return until > from && until < 24 * 60 && schedule.schoolDays.length > 0;
}

export function minutesOfDay(hhmmValue: string): number {
  const [hours, minutes] = hhmmValue.split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

/**
 * Where the school day comes from, in order of how much the student meant it:
 *
 *  1. The school schedule they filled in during onboarding — their own answer
 *     to "when are you in class".
 *  2. Failing that, the Canvas check window, whose `schoolDayFrom` →
 *     `schoolDayStart` interval is already the codebase's definition of school
 *     hours and is what the Canvas gate refuses inside.
 *
 * There is deliberately no third fallback that invents an interval. If neither
 * source has been configured this returns `null`, and the caller must treat
 * that as "we do not know when school is" rather than guessing — guessing
 * wrong here silently switches blocking off in the middle of a school day, or
 * leaves it on during one.
 */
export function schoolHoursFrom(
  schedule: SchoolSchedule,
  canvasWindow: { schoolDays: number[]; schoolDayFrom: number; schoolDayStart: number } | null,
): SchoolHours | null {
  /**
   * An incoherent schedule is not used at all.
   *
   * A student who types 3:00 PM as the start and 7:00 AM as the end — or
   * leaves the end at midnight — used to produce hours whose `until` was not
   * after its `from`. `isDuringSchoolHours` then matched nothing, so school
   * never appeared to be happening and the school-hours pause silently
   * stopped protecting them. Falling through to the Canvas window is both
   * safer and truer: it is the other place they said when school ends.
   */
  if (schedule.configured && scheduleHasCoherentHours(schedule)) {
    return {
      days: [...schedule.schoolDays],
      from: minutesOfDay(schedule.schoolStart),
      until: minutesOfDay(schedule.schoolEnd),
    };
  }
  if (canvasWindow && canvasWindow.schoolDays.length) {
    return {
      days: [...canvasWindow.schoolDays],
      from: canvasWindow.schoolDayFrom,
      until: canvasWindow.schoolDayStart,
    };
  }
  return null;
}

/**
 * True when `now` falls inside school. Half-open so the moment the last bell
 * rings is already after school, not still in it.
 *
 * A window whose end is not after its start describes nothing usable, so it
 * matches nothing rather than wrapping past midnight.
 */
export function isDuringSchoolHours(
  hours: SchoolHours | null,
  now: number | Date,
  noSchoolDates: string[] = [],
): boolean {
  if (!hours || hours.until <= hours.from) return false;
  const at = now instanceof Date ? now : new Date(now);
  // A holiday is not a school day. Without this, blocking suspends itself
  // through a Monday the student spends at home — the exact opposite of what
  // the pause is for.
  if (noSchoolDates.includes(localISODate(at))) return false;
  if (!hours.days.includes(at.getDay())) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return minutes >= hours.from && minutes < hours.until;
}

/**
 * `YYYY-MM-DD` in local time.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is UTC and names
 * yesterday for anyone west of Greenwich after their afternoon — which is
 * precisely the time of day this whole feature is about.
 */
export function localISODate(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
}

/* ------------------------------------------------------------------ */
/* Homework hours — when blocking may run on its own                   */
/* ------------------------------------------------------------------ */

/**
 * The window automatic blocking runs inside, in minutes past midnight.
 *
 * `until` may be 1440, meaning midnight — the end of the day rather than a
 * cutoff. There is deliberately no evening bound: the late hours are the ones
 * a student most needs held, and a blocker that clocks off at 9:30pm protects
 * the wrong half of the evening.
 */
export interface HomeworkWindow {
  /** Days the school day happens, `Date.getDay()` numbering. */
  schoolDays: number[];
  /** Minutes past midnight blocking begins on a school day — the last bell. */
  from: number;
  /** Minutes past midnight blocking begins on a day with no school. */
  freeDayFrom: number;
  /** Minutes past midnight blocking stops. 1440 = midnight. */
  until: number;
}

/**
 * Homework hours begin at the same bell school hours end at, so blocking can
 * never start before the day it is waiting on has finished. Same two sources,
 * same order, same refusal to invent one.
 */
export function homeworkWindowFrom(
  schedule: SchoolSchedule,
  canvasWindow: { schoolDays: number[]; schoolDayStart: number; freeDayStart: number } | null,
): HomeworkWindow | null {
  const freeDayFrom = canvasWindow ? canvasWindow.freeDayStart : 9 * 60;
  // Same coherence rule as above, and for a sharper reason: an end time of
  // midnight would otherwise make homework hours begin at 00:00, so automatic
  // blocking would run all day including through school.
  if (schedule.configured && scheduleHasCoherentHours(schedule)) {
    return {
      schoolDays: [...schedule.schoolDays],
      from: minutesOfDay(schedule.schoolEnd),
      freeDayFrom,
      until: 24 * 60,
    };
  }
  if (canvasWindow && canvasWindow.schoolDays.length) {
    return {
      schoolDays: [...canvasWindow.schoolDays],
      from: canvasWindow.schoolDayStart,
      freeDayFrom,
      until: 24 * 60,
    };
  }
  return null;
}

/** True when `now` is inside the homework hours automatic blocking runs in. */
export function isHomeworkTime(
  window: HomeworkWindow | null,
  now: number | Date,
  noSchoolDates: string[] = [],
): boolean {
  if (!window) return false;
  const at = now instanceof Date ? now : new Date(now);
  const holiday = noSchoolDates.includes(localISODate(at));
  const schoolDay = !holiday && window.schoolDays.includes(at.getDay());
  const from = schoolDay ? window.from : window.freeDayFrom;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return minutes >= from && minutes < window.until;
}

/** "Mon–Fri, 7:30 AM – 3:30 PM" for the copy that explains the pause. */
export function describeSchoolHours(hours: SchoolHours | null): string | null {
  if (!hours || hours.until <= hours.from) return null;
  const clock = (value: number) => {
    const hour = Math.floor(value / 60);
    const minute = String(value % 60).padStart(2, '0');
    const suffix = hour < 12 ? 'AM' : 'PM';
    const display = hour % 12 === 0 ? 12 : hour % 12;
    return `${display}:${minute} ${suffix}`;
  };
  const names = SCHOOL_DAYS.filter((day) => hours.days.includes(day.id)).map((day) => day.label);
  const weekdays = names.length === 5 ? 'Mon–Fri' : names.map((name) => name.slice(0, 3)).join(', ');
  return `${weekdays || 'School days'}, ${clock(hours.from)} – ${clock(hours.until)}`;
}
