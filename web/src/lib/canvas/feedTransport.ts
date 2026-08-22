/**
 * One way to reach the Canvas feed, whichever machinery is actually present.
 *
 * The page cannot fetch a Canvas feed itself — Canvas serves it with no
 * `Access-Control-Allow-Origin` header, measured against a real feed, so a
 * browser refuses to hand the response to script. Two things on this machine
 * can do it instead:
 *
 *  1. **LockIn's local service** (`npm run service:install`). Preferred: it
 *     needs no extension, it keeps fetching while Chrome is closed, and it does
 *     not care which browser profile is in front.
 *  2. **The companion extension.** Used when there is no local service — a
 *     plain `npm run dev` session, or an install where LockIn is a website
 *     only.
 *
 * The rest of the app asks this module and never learns which answered, except
 * where the UI genuinely needs to explain the difference.
 */
import {
  connectCalendar,
  disconnectCalendar,
  getCalendarView,
  syncCalendar,
} from './calendarClient';
import {
  connectService,
  disconnectService,
  getServiceView,
  syncFromService,
} from './serviceFeed';
import type { FeedReadResult } from './calendarFeed';

export type Transport = 'service' | 'extension' | 'none';

export interface FeedView {
  configured: boolean;
  host: string | null;
  lastFetchedAt: number | null;
  lastError: string | null;
  refreshMinutes: number;
  /** Extension only; the service has no browser to open a tab in. */
  transport: Transport;
}

const NONE: FeedView = {
  configured: false,
  host: null,
  lastFetchedAt: null,
  lastError: null,
  refreshMinutes: 15,
  transport: 'none',
};

/**
 * Which transport to use, and what it currently knows.
 *
 * The service is asked first. A configured service wins outright; an
 * unconfigured one still wins over a *missing* extension, so the connect button
 * has somewhere to send the URL.
 */
export async function getFeedView(): Promise<FeedView> {
  const service = await getServiceView();
  if (service?.configured) {
    return {
      configured: true,
      host: service.host,
      lastFetchedAt: service.lastFetchedAt,
      lastError: service.lastError,
      refreshMinutes: service.refreshMinutes,
          transport: 'service',
    };
  }

  const extension = await getCalendarView();
  if (extension?.configured) {
    return {
      configured: true,
      host: extension.host,
      lastFetchedAt: extension.lastFetchedAt,
      lastError: extension.lastError,
      refreshMinutes: extension.refreshMinutes,
      transport: 'extension',
    };
  }

  if (service) return { ...NONE, refreshMinutes: service.refreshMinutes, transport: 'service' };
  if (extension) return { ...NONE, transport: 'extension' };
  return { ...NONE };
}

export interface ConnectResult {
  ok: boolean;
  /** A reason code the UI turns into a sentence. */
  reason?: string;
  view?: FeedView;
}

/**
 * Stores a feed URL wherever it can be stored.
 *
 * The service path proves the URL works before reporting success — it fetches
 * once and forgets the URL again if that fails. "Connected" should never be
 * shown for an address that will fail quietly later.
 */
export async function connectFeed(url: string): Promise<ConnectResult> {
  const service = await connectService(url);
  if (!service.unavailable) {
    return { ok: service.ok, reason: service.reason, view: await getFeedView() };
  }

  const extension = await connectCalendar(url);
  if (!extension) return { ok: false, reason: 'no-transport' };
  return { ok: extension.ok !== false, reason: extension.reason, view: await getFeedView() };
}

export async function disconnectFeed(): Promise<FeedView> {
  await disconnectService();
  await disconnectCalendar();
  return getFeedView();
}

export interface SyncResult {
  ok: boolean;
  reason?: string;
  feed?: FeedReadResult;
  fetchedAt?: number;
  transport: Transport;
}

export async function syncFeed(
  now: number,
  horizonDays: number,
  force = false,
): Promise<SyncResult> {
  const service = await syncFromService(now, horizonDays, force);
  if (!service.unavailable) {
    return {
      ok: service.ok,
      reason: service.reason,
      feed: service.feed,
      fetchedAt: service.fetchedAt,
      transport: 'service',
    };
  }

  const extension = await syncCalendar(now, horizonDays, force);
  if (extension.noCompanion) return { ok: false, reason: 'no-transport', transport: 'none' };
  return {
    ok: extension.ok,
    reason: extension.reason,
    feed: extension.feed,
    fetchedAt: extension.fetchedAt,
    transport: 'extension',
  };
}

/** Plain English for each failure. The student is never shown a reason code. */
export const FEED_MESSAGES: Record<string, string> = {
  empty: 'Paste the feed address first.',
  'not-a-url': 'That doesn’t look like a web address.',
  'not-https': 'A calendar feed address has to start with https://.',
  'private-host': 'That address points at this computer, not at Canvas.',
  'not-configured': 'No calendar feed is connected yet.',
  rejected:
    'Canvas refused that address. Feed links expire when your password changes — copy a fresh one from Canvas → Calendar → Calendar Feed.',
  'http-error': 'Canvas returned an error. Your existing assignments are still here.',
  redirected: 'That address redirected somewhere unexpected, so it was not read.',
  'too-large': 'That feed was too large to read.',
  timeout: 'Canvas took too long to answer. Your existing assignments are still here.',
  network: 'Could not reach Canvas. Your existing assignments are still here.',
  unreadable: 'That address answered, but not with a calendar.',
  'no-transport':
    'LockIn can’t fetch the feed from this browser. Run `npm run service:install`, or add the LockIn Companion extension.',
};
