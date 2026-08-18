/**
 * How much time there actually is.
 *
 * Availability is what the student said they are free. Capacity is what the
 * planner is willing to fill: availability minus fixed commitments, minus a
 * buffer, capped by the daily maximum and scaled by the workload preference.
 * The gap between the two is deliberate — a plan that uses every free minute
 * is a plan that fails the first time dinner runs late.
 */
import type { FixedBlock, PlannerSettings } from '../../types/planner';
import { WORKLOAD_UTILISATION, isWeekend } from '../../types/planner';
import { addDaysISO, hhmmFromMinutes, minutesOfDay, todayISO, weekdayOf } from '../time';
import type { DayCapacity, TimeWindow } from './types';

/** Today's remaining time is rounded up to the next slot boundary. */
export const START_GRANULARITY_MINUTES = 5;

/** Subtracts busy windows from free ones. Both lists may be unsorted. */
export function subtractWindows(free: TimeWindow[], busy: TimeWindow[]): TimeWindow[] {
  let result = [...free].sort((a, b) => a.start - b.start);
  for (const block of [...busy].sort((a, b) => a.start - b.start)) {
    const next: TimeWindow[] = [];
    for (const window of result) {
      if (block.end <= window.start || block.start >= window.end) {
        next.push(window);
        continue;
      }
      if (block.start > window.start) next.push({ start: window.start, end: block.start });
      if (block.end < window.end) next.push({ start: block.end, end: window.end });
    }
    result = next;
  }
  return result.filter((w) => w.end > w.start);
}

export function windowMinutes(windows: TimeWindow[]): number {
  return windows.reduce((sum, w) => sum + (w.end - w.start), 0);
}

/**
 * The free clock windows on one date.
 *
 * `now` matters only for today: opening LockIn at 8:30 PM must not produce a
 * plan that starts at 4:00 PM. Anything already in the past is simply not
 * available, which is what makes the late-start behaviour fall out rather than
 * needing a special case.
 */
export function windowsForDate(
  dateISO: string,
  settings: PlannerSettings,
  now: Date,
): TimeWindow[] {
  const weekday = weekdayOf(dateISO);
  if (weekday === null) return [];
  const row = settings.availability.find((a) => a.weekday === weekday);
  if (!row || !row.available) return [];

  const start = minutesOfDay(row.startTime);
  const end = minutesOfDay(row.endTime);
  if (start === null || end === null || end <= start) return [];

  let free: TimeWindow[] = [{ start, end }];

  const busy: TimeWindow[] = settings.fixedBlocks
    .filter((b: FixedBlock) => b.weekday === weekday)
    .map((b) => ({ start: minutesOfDay(b.startTime), end: minutesOfDay(b.endTime) }))
    .filter((b): b is TimeWindow => b.start !== null && b.end !== null && b.end > b.start);

  free = subtractWindows(free, busy);

  if (dateISO === todayISO(now)) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const floor =
      Math.ceil(nowMinutes / START_GRANULARITY_MINUTES) * START_GRANULARITY_MINUTES;
    free = free
      .map((w) => ({ start: Math.max(w.start, floor), end: w.end }))
      .filter((w) => w.end > w.start);
  }

  return free;
}

/** The daily ceiling: the day's own maximum, and the weekday/weekend cap. */
export function dailyMaximum(weekday: number, settings: PlannerSettings): number {
  const row = settings.availability.find((a) => a.weekday === weekday);
  const global = isWeekend(weekday) ? settings.weekendMaxMinutes : settings.weekdayMaxMinutes;
  return Math.min(row?.maxMinutes ?? global, global);
}

/**
 * Available minutes → the number the scheduler is allowed to spend.
 *
 * Buffer first, then the daily cap: a 15% buffer on four free hours is 36
 * minutes of slack, and a 120-minute cap on top of that is still 120. Applying
 * the cap first would make the buffer silently cut into an already-capped day.
 */
export function capacityFor(
  availableMinutes: number,
  weekday: number,
  settings: PlannerSettings,
): number {
  const buffered = availableMinutes * (1 - settings.bufferPercent / 100);
  const utilised = buffered * WORKLOAD_UTILISATION[settings.workloadPreference];
  return Math.max(0, Math.floor(Math.min(utilised, dailyMaximum(weekday, settings))));
}

/** The whole horizon, one entry per day, starting today. */
export function buildCapacity(settings: PlannerSettings, now: Date): DayCapacity[] {
  const start = todayISO(now);
  const days: DayCapacity[] = [];
  for (let i = 0; i < settings.horizonDays; i += 1) {
    const date = addDaysISO(start, i);
    const weekday = weekdayOf(date) ?? 0;
    const windows = windowsForDate(date, settings, now);
    const availableMinutes = windowMinutes(windows);
    const full = capacityFor(availableMinutes, weekday, settings);
    const restDay = settings.availability.find((a) => a.weekday === weekday)?.restDay === true;
    days.push({
      date,
      weekday,
      windows,
      availableMinutes,
      // A rest day has no capacity at all. It is never quietly used: when work
      // cannot fit without it, the planner reports the shortfall instead.
      capacityMinutes: restDay ? 0 : full,
      restDay,
      restDayCapacityMinutes: restDay ? full : 0,
    });
  }
  return days;
}

/** Human-readable window list, e.g. `4:00 PM – 6:00 PM, 7:00 PM – 8:00 PM`. */
export function describeWindows(windows: TimeWindow[]): string[] {
  return windows.map((w) => `${hhmmFromMinutes(w.start)}–${hhmmFromMinutes(w.end)}`);
}
