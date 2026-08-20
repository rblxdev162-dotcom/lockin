/**
 * Talking to LockIn's own local service about the Canvas feed.
 *
 * This is the **one** file in `web/src` allowed to call `fetch`, and the
 * release suite names it explicitly so a second one has to be a deliberate edit
 * to that test. What it calls is not a network request in any sense that
 * matters: same-origin relative paths on the loopback service already serving
 * this page. Nothing leaves the machine.
 *
 * Every URL here is relative. An absolute one would be a bug, and the release
 * test checks for that too.
 *
 * ## Why this exists alongside the extension path
 *
 * Canvas serves the feed with no `Access-Control-Allow-Origin` header, so the
 * page cannot read it directly. Two things on this machine can: the companion
 * extension, and the local service. The service is the better one where it is
 * installed — it needs no extension, it keeps fetching while Chrome is closed,
 * and it does not care which browser profile is in front.
 */
import { readFeed } from './calendarFeed';
import type { CanvasCheckWindow } from './checkWindow';
import type { FeedReadResult } from './calendarFeed';

export interface ServiceFeedView {
  configured: boolean;
  host: string | null;
  addedAt: string | null;
  lastFetchedAt: number | null;
  lastError: string | null;
  refreshMinutes: number;
  hasCache: boolean;
  cachedAt: number | null;
  transport: 'service';
}

const EMPTY: ServiceFeedView = {
  configured: false,
  host: null,
  addedAt: null,
  lastFetchedAt: null,
  lastError: null,
  refreshMinutes: 30,
  hasCache: false,
  cachedAt: null,
  transport: 'service',
};

/**
 * Rebuilds a view field by field.
 *
 * The service is more trusted than a web page, but it is still another process
 * and another trust boundary, and "unknown keys are dropped" is the rule
 * everywhere else in this project.
 */
export function sanitizeServiceView(raw: unknown): ServiceFeedView {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const value = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    configured: value.configured === true,
    host:
      typeof value.host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(value.host)
        ? value.host.toLowerCase()
        : null,
    addedAt: typeof value.addedAt === 'string' ? value.addedAt.slice(0, 40) : null,
    lastFetchedAt: num(value.lastFetchedAt),
    lastError: typeof value.lastError === 'string' ? value.lastError.slice(0, 160) : null,
    refreshMinutes:
      typeof value.refreshMinutes === 'number' && Number.isFinite(value.refreshMinutes)
        ? Math.min(1440, Math.max(15, Math.round(value.refreshMinutes)))
        : 30,
    hasCache: value.hasCache === true,
    cachedAt: num(value.cachedAt),
    transport: 'service',
  };
}

/** Returns null when the local service is not running — an ordinary state. */
async function call(path: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: { 'x-lockin-bridge': '1', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** True when LockIn is being served by its own local service. */
export async function serviceAvailable(): Promise<boolean> {
  return (await call('/api/canvas/status')) !== null;
}

export async function getServiceView(): Promise<ServiceFeedView | null> {
  const raw = await call('/api/canvas/status');
  return raw === null ? null : sanitizeServiceView(raw);
}

/**
 * Tells the local service which hours it may fetch in.
 *
 * The service is a LaunchAgent: it keeps running with every browser closed,
 * so a gate that only existed in the page would be a promise that holds only
 * while LockIn is open. Pushed whenever the setting changes, and on load.
 */
export async function setServiceCheckWindow(window: CanvasCheckWindow): Promise<boolean> {
  const raw = await call('/api/canvas/window', {
    method: 'POST',
    body: JSON.stringify({ window }),
  });
  return raw !== null;
}

export interface ServiceConnectResult {
  ok: boolean;
  reason?: string;
  view?: ServiceFeedView;
  /** True when the service itself did not answer. */
  unavailable?: boolean;
}

/**
 * Stores the URL and immediately proves it works.
 *
 * The service fetches once before reporting success, and forgets the URL again
 * if that fetch fails — so "Connected" is never shown for an address that will
 * quietly fail half an hour later.
 */
export async function connectService(url: string): Promise<ServiceConnectResult> {
  const raw = await call('/api/canvas/connect', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  if (raw === null) return { ok: false, unavailable: true };
  const value = raw as Record<string, unknown>;
  return {
    ok: value.ok === true,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    view: sanitizeServiceView(value.view),
  };
}

export async function disconnectService(): Promise<ServiceFeedView | null> {
  const raw = await call('/api/canvas/disconnect', { method: 'POST' });
  if (raw === null) return null;
  return sanitizeServiceView((raw as Record<string, unknown>).view);
}

export interface ServiceFetchResult {
  ok: boolean;
  reason?: string;
  feed?: FeedReadResult;
  fetchedAt?: number;
  view?: ServiceFeedView;
  unavailable?: boolean;
}

/** Fetch and parse in one step. `now` is passed in so this stays testable. */
export async function syncFromService(
  now: number,
  horizonDays: number,
  force = false,
): Promise<ServiceFetchResult> {
  const raw = await call(`/api/canvas/feed${force ? '?force=1' : ''}`);
  if (raw === null) return { ok: false, unavailable: true };

  const value = raw as Record<string, unknown>;
  const view = sanitizeServiceView(value.view);
  if (value.ok !== true || typeof value.text !== 'string') {
    return {
      ok: false,
      reason: typeof value.reason === 'string' ? value.reason : 'network',
      view,
    };
  }

  const feed = readFeed(value.text, now, horizonDays);
  return {
    ok: !feed.fatal,
    reason: feed.fatal ? 'unreadable' : undefined,
    feed,
    fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : undefined,
    view,
  };
}
