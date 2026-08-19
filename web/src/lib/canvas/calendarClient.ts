/**
 * The page's side of the Canvas Calendar Feed.
 *
 * It asks the extension to hold the URL and do the fetching, then parses what
 * comes back. Two things follow from that split and are worth stating plainly:
 *
 *  - **The page never holds the feed URL.** It is sent once, on connect, and
 *    the extension never sends it back. Every reply carries a *view*: host,
 *    timestamps, error text. That is why `lib/export.ts` needs no new
 *    exclusion — there is nothing here to exclude.
 *  - **Without the companion there is no live sync**, and the UI says so
 *    rather than showing a button that cannot work. A Canvas feed is served
 *    without CORS headers, so a page fetching it gets a network error every
 *    time, no matter how it is written. The offered alternative is a file
 *    import, which works everywhere and needs nothing.
 */
import { MSG } from '../protocol';
import { bridge } from '../extensionBridge';
import { readFeed } from './calendarFeed';
import type { FeedReadResult } from './calendarFeed';

export interface CalendarView {
  configured: boolean;
  host: string | null;
  addedAt: string | null;
  lastFetchedAt: number | null;
  lastError: string | null;
  refreshMinutes: number;
  hasCache: boolean;
  cachedAt: number | null;
  /** Set on the reply to a configure attempt. */
  ok?: boolean;
  reason?: string;
}

const EMPTY_VIEW: CalendarView = {
  configured: false,
  host: null,
  addedAt: null,
  lastFetchedAt: null,
  lastError: null,
  refreshMinutes: 180,
  hasCache: false,
  cachedAt: null,
};

/**
 * Rebuilds a view field by field.
 *
 * The extension is more trusted than a web page, but it is still another
 * context, and "unknown keys are dropped" is the rule everywhere else in this
 * project. It also means a future extension version adding a field cannot
 * surprise an older page.
 */
export function sanitizeCalendarView(raw: unknown): CalendarView {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_VIEW };
  const value = raw as Record<string, unknown>;
  const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    configured: value.configured === true,
    host:
      typeof value.host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(value.host)
        ? value.host.toLowerCase()
        : null,
    addedAt: typeof value.addedAt === 'string' ? value.addedAt.slice(0, 40) : null,
    lastFetchedAt: number(value.lastFetchedAt),
    lastError: typeof value.lastError === 'string' ? value.lastError.slice(0, 160) : null,
    refreshMinutes:
      typeof value.refreshMinutes === 'number' && Number.isFinite(value.refreshMinutes)
        ? Math.min(1440, Math.max(30, Math.round(value.refreshMinutes)))
        : 180,
    hasCache: value.hasCache === true,
    cachedAt: number(value.cachedAt),
    ok: value.ok === true ? true : value.ok === false ? false : undefined,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 60) : undefined,
  };
}

export async function getCalendarView(): Promise<CalendarView | null> {
  const reply = await bridge.request(MSG.CALENDAR_GET_VIEW);
  if (!reply || reply.type !== MSG.CALENDAR_VIEW) return null;
  return sanitizeCalendarView(reply.payload);
}

export async function connectCalendar(
  url: string,
  refreshMinutes?: number,
): Promise<CalendarView | null> {
  const reply = await bridge.request(MSG.CALENDAR_CONFIGURE, { url, refreshMinutes });
  if (!reply || reply.type !== MSG.CALENDAR_VIEW) return null;
  return sanitizeCalendarView(reply.payload);
}

export async function disconnectCalendar(): Promise<CalendarView | null> {
  const reply = await bridge.request(MSG.CALENDAR_DISCONNECT);
  if (!reply || reply.type !== MSG.CALENDAR_VIEW) return null;
  return sanitizeCalendarView(reply.payload);
}

export interface CalendarFetchResult {
  ok: boolean;
  /** Set when the extension answered but the fetch failed. */
  reason?: string;
  feed?: FeedReadResult;
  fetchedAt?: number;
  cached?: boolean;
  view?: CalendarView;
  /** True when the extension itself did not answer at all. */
  noCompanion?: boolean;
}

/** Plain English for each failure. The student is not shown a reason code. */
export const FETCH_MESSAGES: Record<string, string> = {
  'not-configured': 'No calendar feed is connected yet.',
  rejected: 'Canvas refused that feed address. It may have been reset — copy a fresh one.',
  'http-error': 'Canvas returned an error. Your existing assignments are still here.',
  redirected: 'That address redirected somewhere unexpected, so it was not read.',
  'too-large': 'That feed was too large to read.',
  timeout: 'Canvas took too long to answer. Your existing assignments are still here.',
  network: 'Could not reach Canvas. Your existing assignments are still here.',
};

/**
 * Fetch and parse in one step.
 *
 * `now` is passed in rather than read, so the horizon is the same value the
 * rest of a render used, and so this is testable.
 */
export async function syncCalendar(
  now: number,
  horizonDays: number,
  force = false,
): Promise<CalendarFetchResult> {
  const reply = await bridge.request(MSG.CALENDAR_FETCH, { force }, 30_000);
  if (!reply || reply.type !== MSG.CALENDAR_TEXT) {
    return { ok: false, noCompanion: true };
  }

  const payload = (reply.payload ?? {}) as Record<string, unknown>;
  const view = sanitizeCalendarView(payload.view);

  if (payload.ok !== true || typeof payload.text !== 'string') {
    return {
      ok: false,
      reason: typeof payload.reason === 'string' ? payload.reason : 'network',
      view,
    };
  }

  const feed = readFeed(payload.text, now, horizonDays);
  return {
    ok: !feed.fatal,
    reason: feed.fatal ? 'unreadable' : undefined,
    feed,
    fetchedAt: typeof payload.fetchedAt === 'number' ? payload.fetchedAt : undefined,
    cached: payload.cached === true,
    view,
  };
}

/**
 * The no-companion path: a `.ics` file the student downloaded themselves.
 *
 * Deliberately kept: it is the only way LockIn works on a browser where the
 * companion cannot be installed, and it is also the honest fallback whenever a
 * feed URL stops working. Imported items are stamped as an import, so they age
 * differently from a live feed and never claim to be live.
 */
export async function readCalendarFile(
  file: File,
  now: number,
  horizonDays: number,
): Promise<FeedReadResult> {
  if (file.size > 4 * 1024 * 1024) {
    return { items: [], warnings: [], fatal: 'That file is too large to be a calendar.' };
  }
  const text = await file.text();
  return readFeed(text, now, horizonDays);
}
