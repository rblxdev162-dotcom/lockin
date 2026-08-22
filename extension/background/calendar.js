/**
 * The Canvas Calendar Feed, fetched by the extension.
 *
 * ## Why the extension and not the page
 *
 * Two reasons, and the second is the important one.
 *
 *  1. **CORS.** A Canvas feed is served without `Access-Control-Allow-Origin`,
 *     so a web page cannot read it however politely it asks. The extension
 *     holds host permissions and can.
 *  2. **The URL is a bearer credential.** Anyone holding a Canvas feed URL can
 *     read that student's whole calendar, with no login. Keeping it in
 *     extension storage means it is never in `localStorage`, never in a page's
 *     network log, never in a DevTools panel the student might screen-share,
 *     and never in LockIn's export file. The page is told the *host* and
 *     nothing else.
 *
 * The extension deliberately does not parse the ICS. There is one parser, in
 * `web/src/lib/ics/parse.ts`, and a second copy here would be a second set of
 * bugs — the same reasoning that keeps rules generation in one file.
 *
 * ## What it will not do
 *
 *  - No cookies. `credentials: 'omit'` — the feed URL carries its own token,
 *    and sending the student's Canvas session with it would turn a read of one
 *    calendar into an authenticated request.
 *  - No redirects to another origin (`redirect: 'follow'` is fine within
 *    Canvas; the response URL is checked afterwards).
 *  - No logging of the URL, ever. Errors name the host.
 */

const KEY = 'lockin_calendar';
/** A calendar feed this large is not a calendar. Matches the parser's cap. */
const MAX_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
export const CALENDAR_ALARM = 'lockin-calendar';

const DEFAULTS = {
  url: '',
  host: '',
  addedAt: '',
  lastFetchedAt: 0,
  lastError: '',
  /**
   * Fifteen minutes.
   *
   * Canvas publishes this feed for exactly this purpose and a check is one
   * conditional GET. The timer still obeys LockIn's automatic-check window,
   * so this cadence never turns into traffic during configured school hours.
   */
  refreshMinutes: 15,
  /** The last successful body, so opening LockIn is instant and offline-safe. */
  cachedText: '',
  cachedAt: 0,
};

export async function getCalendarConfig() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    const merged = { ...DEFAULTS, ...(stored[KEY] ?? {}) };
    // Phase 30: migrate both former shipped defaults without touching a student
    // who deliberately chose another valid cadence.
    return {
      ...merged,
      refreshMinutes: [3, 30].includes(merged.refreshMinutes)
        ? 15
        : Math.min(1440, Math.max(15, merged.refreshMinutes || 15)),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

async function setCalendarConfig(patch) {
  const next = { ...(await getCalendarConfig()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/**
 * What the page is allowed to know.
 *
 * Note what is absent: the URL. A `view` is what crosses the boundary, and it
 * cannot leak a secret it does not contain.
 */
export function toCalendarView(config) {
  return {
    configured: !!config.url,
    host: config.host || null,
    addedAt: config.addedAt || null,
    lastFetchedAt: config.lastFetchedAt || null,
    lastError: config.lastError || null,
    refreshMinutes: config.refreshMinutes,
    hasCache: !!config.cachedText,
    cachedAt: config.cachedAt || null,
  };
}

/**
 * Validates a feed URL without being precious about its exact shape.
 *
 * Canvas hands out `https://<host>/feeds/calendars/user_<token>.ics`, but
 * self-hosted and white-labelled installs vary, and a student who pastes a
 * working URL should not be told it is wrong because it lacks an expected
 * path. So: https, a real host, and a length sanity check. The real test is
 * whether it returns a calendar, which `fetchCalendar` finds out.
 */
export function validateFeedUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) {
    return { ok: false, reason: 'empty' };
  }
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not-a-url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (!parsed.hostname.includes('.')) return { ok: false, reason: 'not-a-url' };
  // Loopback and private hosts are refused: a "calendar feed" pointing at
  // 127.0.0.1 is not a calendar feed, it is a way to make the extension probe
  // the student's own machine.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(parsed.hostname)) {
    return { ok: false, reason: 'private-host' };
  }
  return { ok: true, url: parsed.toString(), host: parsed.hostname };
}

export async function configureCalendar(rawUrl, refreshMinutes) {
  const check = validateFeedUrl(rawUrl);
  if (!check.ok) return { ok: false, reason: check.reason };

  const minutes = Number.isFinite(refreshMinutes)
    ? Math.min(1440, Math.max(15, Math.round(refreshMinutes)))
    : 15;

  await setCalendarConfig({
    url: check.url,
    host: check.host,
    addedAt: new Date().toISOString(),
    lastError: '',
    refreshMinutes: minutes,
    cachedText: '',
    cachedAt: 0,
  });
  await scheduleCalendarRefresh(minutes);
  return { ok: true, host: check.host };
}

/**
 * Updates the options the page is allowed to change.
 *
 * Deliberately narrow: the URL is not settable here. Changing the feed means
 * going through `configureCalendar`, which validates it and resets the cache.
 */
export async function setCalendarOptions(patch) {
  const next = {};
  if (Number.isFinite(patch?.refreshMinutes)) {
    next.refreshMinutes = Math.min(1440, Math.max(15, Math.round(patch.refreshMinutes)));
  }
  const config = await setCalendarConfig(next);
  if (next.refreshMinutes !== undefined) await scheduleCalendarRefresh(config.refreshMinutes);
  return config;
}

export async function disconnectCalendar() {
  // Removed, not blanked: a cleared-but-present key still holds the URL in any
  // storage snapshot taken before the write.
  await chrome.storage.local.remove(KEY);
  await chrome.alarms.clear(CALENDAR_ALARM);
  return { ok: true };
}

export async function scheduleCalendarRefresh(minutes) {
  const period = Math.min(1440, Math.max(15, Number(minutes) || 15));
  await chrome.alarms.create(CALENDAR_ALARM, { periodInMinutes: period, delayInMinutes: 1 });
}

/**
 * Fetches the feed and returns its text.
 *
 * Never throws: every failure becomes `{ ok: false, reason }`, because the
 * caller's correct behaviour in all of them is identical — keep the
 * assignments already on file, and say the sync failed.
 */
export async function fetchCalendar({ force = false } = {}) {
  const config = await getCalendarConfig();
  if (!config.url) return { ok: false, reason: 'not-configured' };

  // A cached body less than a minute old is returned as-is. Two LockIn tabs
  // opening together must not become two requests to the school's server.
  const fresh = config.cachedText && Date.now() - config.cachedAt < 60_000;
  if (fresh && !force) {
    return { ok: true, text: config.cachedText, fetchedAt: config.cachedAt, cached: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(config.url, {
      // No cookies. The token in the URL is the whole authorization.
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1' },
    });

    if (!response.ok) {
      const reason = response.status === 404 || response.status === 401 || response.status === 403
        ? 'rejected'
        : 'http-error';
      await setCalendarConfig({
        lastError: `${config.host} answered ${response.status}`,
        lastFetchedAt: Date.now(),
      });
      return { ok: false, reason, status: response.status };
    }

    // A redirect that left the configured host is not this feed any more.
    try {
      if (response.url && new URL(response.url).hostname !== config.host) {
        await setCalendarConfig({ lastError: 'The feed redirected somewhere else.' });
        return { ok: false, reason: 'redirected' };
      }
    } catch {
      /* an unparseable response URL is not worth failing the sync over */
    }

    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BYTES) {
      await setCalendarConfig({ lastError: 'The feed was too large.' });
      return { ok: false, reason: 'too-large' };
    }

    const text = await response.text();
    if (text.length > MAX_BYTES) {
      await setCalendarConfig({ lastError: 'The feed was too large.' });
      return { ok: false, reason: 'too-large' };
    }

    const now = Date.now();
    await setCalendarConfig({
      lastFetchedAt: now,
      lastError: '',
      cachedText: text,
      cachedAt: now,
    });
    return { ok: true, text, fetchedAt: now, cached: false };
  } catch (error) {
    const aborted = error && error.name === 'AbortError';
    await setCalendarConfig({
      lastError: aborted ? 'The feed timed out.' : `Could not reach ${config.host}.`,
      lastFetchedAt: Date.now(),
    });
    return { ok: false, reason: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The periodic refresh.
 *
 * It fetches and caches; it does not parse, and it does not decide anything.
 * The page folds the text into assignments the next time it is open, which is
 * the only place that knows what LockIn already has.
 */
export async function runCalendarRefresh() {
  const config = await getCalendarConfig();
  if (!config.url) return { ok: false, reason: 'not-configured' };
  return fetchCalendar({ force: true });
}
