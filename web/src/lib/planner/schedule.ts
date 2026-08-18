/**
 * Turning a day's list of work into clock times.
 *
 * This is presentation, not scheduling: the decision about *what* to do was
 * already made. Here the items are dropped into the free windows in order,
 * with the student's break length between them, and anything that will not fit
 * on the clock keeps its planned minutes but simply has no start time. That
 * last case is real — capacity is computed with a buffer, so the sum of a
 * day's work is always smaller than its windows, but a single long chunk can
 * still fail to fit inside one short window.
 */
import type { PlannedWorkItem, PlannerSettings } from '../../types/planner';
import { hhmmFromMinutes } from '../time';
import type { DayCapacity, TimeWindow } from './types';

export interface ScheduledBreak {
  startTime: string;
  endTime: string;
  minutes: number;
}

/** Assigns `startTime`/`endTime` to as many items as the windows can hold. */
export function layOutDay(
  items: PlannedWorkItem[],
  day: DayCapacity,
  settings: PlannerSettings,
): PlannedWorkItem[] {
  if (items.length === 0) return items;
  const windows: TimeWindow[] = day.windows.map((w) => ({ ...w }));
  if (windows.length === 0) return items.map((item) => ({ ...item, startTime: undefined, endTime: undefined }));

  let windowIndex = 0;
  let cursor = windows[0].start;
  const result: PlannedWorkItem[] = [];

  for (const item of items) {
    let placed = false;
    while (windowIndex < windows.length) {
      const window = windows[windowIndex];
      if (cursor < window.start) cursor = window.start;
      if (cursor + item.plannedMinutes <= window.end) {
        result.push({
          ...item,
          startTime: hhmmFromMinutes(cursor),
          endTime: hhmmFromMinutes(cursor + item.plannedMinutes),
        });
        cursor += item.plannedMinutes + settings.breakMinutes;
        placed = true;
        break;
      }
      windowIndex += 1;
      if (windowIndex < windows.length) cursor = windows[windowIndex].start;
    }
    if (!placed) result.push({ ...item, startTime: undefined, endTime: undefined });
  }

  return result;
}

/**
 * The breaks implied by a laid-out day, for display.
 *
 * Derived rather than stored: a break is just the gap the layout left, so
 * there is nothing to keep in sync.
 */
export function breaksBetween(items: PlannedWorkItem[]): ScheduledBreak[] {
  const breaks: ScheduledBreak[] = [];
  for (let i = 0; i < items.length - 1; i += 1) {
    const end = items[i].endTime;
    const next = items[i + 1].startTime;
    if (!end || !next || next <= end) continue;
    const [eh, em] = end.split(':').map(Number);
    const [nh, nm] = next.split(':').map(Number);
    const minutes = nh * 60 + nm - (eh * 60 + em);
    if (minutes > 0) breaks.push({ startTime: end, endTime: next, minutes });
  }
  return breaks;
}

/**
 * How a single planned chunk splits into focus blocks and breaks.
 *
 * A 45-minute chunk with a 25/5 preference is two blocks, not one — the
 * planner hands the focus timer the chunk, and this is what the UI shows the
 * student so the number on screen matches the way they actually work.
 */
export function focusBlocksFor(
  minutes: number,
  settings: Pick<PlannerSettings, 'focusBlockMinutes' | 'breakMinutes'>,
): { blocks: number[]; breaks: number } {
  const block = Math.max(5, settings.focusBlockMinutes);
  if (minutes <= block) return { blocks: [minutes], breaks: 0 };
  const blocks: number[] = [];
  let left = minutes;
  while (left > 0) {
    const take = Math.min(block, left);
    // A stub shorter than a third of a block is folded into the previous one
    // rather than shown as its own three-minute session.
    if (take < block / 3 && blocks.length > 0) {
      blocks[blocks.length - 1] += take;
      left = 0;
      break;
    }
    blocks.push(take);
    left -= take;
  }
  return { blocks, breaks: Math.max(0, blocks.length - 1) };
}
