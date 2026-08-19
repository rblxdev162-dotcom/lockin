/**
 * Canvas Calendar Feed → LockIn's idea of school work.
 *
 * ## What a Canvas feed actually contains
 *
 * Canvas publishes one ICS per user covering every course they are enrolled
 * in. Assignments arrive as events whose `UID` starts with `event-assignment-`
 * and whose `SUMMARY` is `Title [Course Name]`; calendar events arrive as
 * `event-calendar-event-…`. The `URL` points at the assignment page.
 *
 * ## What it does not contain, and must never be inferred
 *
 *  - **Submission state.** The feed says when something is due, never whether
 *    it was handed in. Nothing in this file may set a completion status.
 *  - **Every To-Do.** Ungraded to-dos and some course items never appear. An
 *    empty feed is not an empty week.
 *  - **Deletion.** An assignment removed from the feed might have been
 *    deleted, unpublished, moved past the horizon, or hidden by a Canvas
 *    setting. `CANCELLED` is explicit and is handled; absence is not.
 */
import type { SourceRecord } from '../../types/source';
import type { IcsEvent } from '../ics/parse';
import { expandRecurrence, parseIcs } from '../ics/parse';

/** What one feed event becomes before it meets existing assignments. */
export interface FeedItem {
  /** Stable identity: the ICS UID. The whole dedupe story rests on this. */
  externalId: string;
  title: string;
  /** Course name parsed out of the summary, when Canvas included one. */
  courseName?: string;
  /** Canvas's own numeric assignment id, when the UID carries one. */
  externalAssignmentId?: string;
  /** Local `YYYY-MM-DD`. */
  dueDate: string;
  /** Local `HH:MM`. */
  dueTime: string;
  /** Epoch ms of the due instant, for comparison without re-parsing. */
  dueAt: number;
  /** `assignment` items are work; `event` items are things on a calendar. */
  kind: 'assignment' | 'event';
  /** Only ever an https link to the school's own host. */
  url?: string;
  allDay: boolean;
  cancelled: boolean;
  /** Epoch ms the feed says this event last changed. */
  changedAt?: number;
}

export interface FeedReadResult {
  items: FeedItem[];
  calendarName?: string;
  warnings: string[];
  fatal?: string;
}

/** Events further out than this are noise for a study planner. */
const DEFAULT_HORIZON_DAYS = 120;
/** And anything older than this has stopped being actionable. */
const PAST_WINDOW_DAYS = 30;

/**
 * `Cell Respiration Worksheet [Biology 1 - P3]` → title + course.
 *
 * Canvas puts the course in trailing brackets. Parsed from the *end* only: an
 * assignment legitimately titled `Worksheet [draft]` keeps its brackets if
 * there is nothing after them, and a title containing brackets mid-string is
 * left alone entirely.
 */
export function splitSummary(summary: string): { title: string; courseName?: string } {
  const match = /^(.*)\s\[([^[\]]{1,120})\]\s*$/.exec(summary.trim());
  if (!match) return { title: summary.trim().slice(0, 200) };
  const title = match[1].trim().slice(0, 200);
  const courseName = match[2].trim().slice(0, 120);
  if (!title) return { title: summary.trim().slice(0, 200) };
  return { title, courseName };
}

/**
 * Canvas UIDs look like `event-assignment-123456@school.instructure.com`.
 * The numeric part is the assignment id an OAuth adapter would use later, so
 * it is worth keeping now — it is what will let a future authorized sync
 * recognise work this feed already imported instead of duplicating it.
 */
export function readUid(uid: string): {
  kind: FeedItem['kind'];
  externalAssignmentId?: string;
} {
  const assignment = /^event-assignment-(\d{1,20})/.exec(uid);
  if (assignment) return { kind: 'assignment', externalAssignmentId: assignment[1] };
  if (/^event-assignment-override-(\d{1,20})/.test(uid)) return { kind: 'assignment' };
  return { kind: 'event' };
}

/** Local `YYYY-MM-DD` and `HH:MM` for an instant, in the student's own zone. */
export function localParts(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Only an `https:` URL on a real host is kept.
 *
 * A feed is remote data, and `javascript:` in a link that the UI will later
 * render as "Open in Canvas" is the most obvious attack this file invites.
 */
export function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    if (!parsed.hostname.includes('.')) return undefined;
    return parsed.toString().slice(0, 500);
  } catch {
    return undefined;
  }
}

/**
 * Parses a whole feed into items.
 *
 * `now` is an input so the horizon is deterministic in tests. Items outside
 * the window are dropped here rather than in the reconciler, so nothing
 * downstream has to know the feed covers a year.
 */
export function readFeed(
  text: string,
  now: number,
  horizonDays = DEFAULT_HORIZON_DAYS,
): FeedReadResult {
  const parsed = parseIcs(text);
  if (parsed.fatal) {
    return { items: [], warnings: parsed.warnings, fatal: parsed.fatal };
  }

  const horizonMs = now + horizonDays * 86_400_000;
  const floorMs = now - PAST_WINDOW_DAYS * 86_400_000;
  const items: FeedItem[] = [];
  const seen = new Set<string>();

  for (const event of parsed.events) {
    for (const occurrence of expandRecurrence(event, horizonMs)) {
      const item = toItem(occurrence);
      if (!item) continue;
      if (item.dueAt > horizonMs || item.dueAt < floorMs) continue;
      // A feed that repeats a UID is a feed bug, not two assignments. First
      // one wins, because later duplicates are usually truncated copies.
      if (seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      items.push(item);
    }
  }

  return { items, calendarName: parsed.calendarName, warnings: parsed.warnings };
}

function toItem(event: IcsEvent): FeedItem | null {
  if (!event.uid || event.start === undefined) return null;
  const summary = event.summary?.trim();
  if (!summary) return null;

  // A title is one line by definition. Collapsing here rather than in the
  // parser keeps multi-line DESCRIPTION text intact for anything that wants it.
  const { title, courseName } = splitSummary(summary.replace(/\s+/g, ' '));
  if (!title) return null;

  const { kind, externalAssignmentId } = readUid(event.uid);
  const parts = localParts(event.start);

  return {
    externalId: event.uid,
    title,
    courseName,
    externalAssignmentId,
    dueDate: parts.date,
    // An all-day Canvas assignment has no clock time. 23:59 is the honest
    // reading of "due that day", and it matches what Canvas shows a student.
    dueTime: event.allDay ? '23:59' : parts.time,
    dueAt: event.allDay ? endOfLocalDay(event.start) : event.start,
    kind,
    url: safeUrl(event.url),
    allDay: event.allDay,
    cancelled: event.status === 'CANCELLED',
    changedAt: event.changedAt,
  };
}

function endOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

/**
 * The provenance stamp every item imported from this feed carries.
 *
 * `confidence` is high because a calendar feed is the school's own statement
 * of when something is due — the least ambiguous data LockIn handles. It says
 * nothing about whether the work is done, which is a different field.
 */
export function feedSource(
  sourceId: string,
  externalId: string,
  syncedAt: string,
  live: boolean,
): SourceRecord {
  return {
    kind: 'CANVAS_CALENDAR',
    sourceId,
    externalId,
    lastSyncedAt: syncedAt,
    confidence: 'high',
    isLive: live,
    // The ICS text is parsed and dropped. Nothing keeps it, which is why the
    // Integrations page can state it as a fact.
    rawDataRetained: false,
  };
}
