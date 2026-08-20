/**
 * The Canvas calendar feed, fetched by LockIn's own local service.
 *
 * ## Why this exists as well as the extension path
 *
 * A Canvas feed is served with **no `Access-Control-Allow-Origin` header** —
 * measured, not assumed — so a web page cannot read it however politely it
 * asks. Something outside the page has to do the fetching.
 *
 * The extension can. So can this: the LaunchAgent that already serves LockIn on
 * 127.0.0.1 is a Node process, and same-origin rules do not apply to it. On a
 * machine where that service is installed, this path is strictly better:
 *
 *  - it works with **no extension installed at all**;
 *  - it keeps running when **Chrome is closed**, so a machine left on
 *    overnight has this morning's assignments waiting;
 *  - it survives Chrome profile switches, since it is not in a browser.
 *
 * The extension path stays for installs with no local service. Neither is
 * required; the page tries this first and falls back.
 *
 * ## Where the URL lives, and why not in the page
 *
 * A feed URL is a bearer credential: anyone holding it reads the student's
 * whole calendar with no login. It is written to `~/.lockin/canvas-feed.json`
 * with mode 0600 — outside the web root, so this server cannot serve it as a
 * file even by accident — and it is **never** included in a response. The page
 * is told the host and the timestamps, and nothing else.
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DIR = join(homedir(), '.lockin');
const FILE = join(DIR, 'canvas-feed.json');

/** A calendar feed this large is not a calendar. Matches the parser's cap. */
const MAX_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/** Half an hour, matching the extension's alarm. One cadence, two places. */
export const DEFAULT_REFRESH_MINUTES = 30;

const DEFAULTS = {
  url: '',
  host: '',
  addedAt: '',
  lastFetchedAt: 0,
  lastError: '',
  refreshMinutes: DEFAULT_REFRESH_MINUTES,
  /**
   * The school-hours gate, pushed here by the app (Phase 18).
   *
   * This service is a LaunchAgent: it keeps running with every browser closed,
   * which is exactly why it must obey the window too. A student who has been
   * promised "nothing talks to Canvas during school" is not helped by a
   * guarantee that only holds while Chrome is open.
   *
   * Shape mirrors `web/src/lib/canvas/checkWindow.ts`. Unset means the app has
   * never told this service anything — and in that case it does **not** fetch
   * on a timer, because the conservative reading of silence is the only safe
   * one here.
   */
  checkWindow: null,
};

/** In-memory only. The body is a copy of the school's data; it is not ours to keep. */
let cache = { text: '', at: 0 };

function read() {
  try {
    if (!existsSync(FILE)) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(patch) {
  const next = { ...read(), ...patch };
  mkdirSync(dirname(FILE), { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify(next), { mode: 0o600 });
  // `writeFileSync`'s mode is only applied when it creates the file, so an
  // existing one is re-tightened explicitly.
  try {
    chmodSync(FILE, 0o600);
  } catch {
    /* a filesystem that cannot chmod is not a reason to fail the write */
  }
  return next;
}

/**
 * What the page is allowed to know.
 *
 * Note what is absent: the URL. A view cannot leak a secret it does not carry.
 */
export function toView(config = read()) {
  return {
    configured: !!config.url,
    host: config.host || null,
    addedAt: config.addedAt || null,
    lastFetchedAt: config.lastFetchedAt || null,
    lastError: config.lastError || null,
    refreshMinutes: config.refreshMinutes,
    hasCache: !!cache.text,
    cachedAt: cache.at || null,
    /** Whether the timer is currently allowed to fetch, and why not. */
    autoFetch: autoFetchAllowed(Date.now(), config),
    /** Tells the page which transport answered, so the UI can say so. */
    transport: 'service',
  };
}

/**
 * Validates a feed URL without being precious about its exact shape.
 *
 * Canvas hands out `https://<host>/feeds/calendars/user_<token>.ics`, but
 * self-hosted and white-labelled installs vary. So: https, a real host, and
 * not this machine. The real test is whether it returns a calendar, which
 * `fetchFeed` finds out immediately after.
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
  // A "feed" pointing at this machine is not a feed, it is a way to make the
  // service probe the student's own computer.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(parsed.hostname)) {
    return { ok: false, reason: 'private-host' };
  }
  return { ok: true, url: parsed.toString(), host: parsed.hostname };
}

export function connect(rawUrl) {
  const check = validateFeedUrl(rawUrl);
  if (!check.ok) return { ok: false, reason: check.reason };
  cache = { text: '', at: 0 };
  write({
    url: check.url,
    host: check.host,
    addedAt: new Date().toISOString(),
    lastError: '',
  });
  return { ok: true, host: check.host };
}

export function disconnect() {
  cache = { text: '', at: 0 };
  // Removed, not blanked: a cleared-but-present file still holds the URL in any
  // backup taken before the write.
  try {
    rmSync(FILE, { force: true });
  } catch {
    /* already gone */
  }
  return { ok: true };
}

export function isConfigured() {
  return !!read().url;
}

/**
 * Fetches the feed.
 *
 * Never throws: every failure becomes `{ ok: false, reason }`, because the
 * caller's correct behaviour in all of them is the same — keep the assignments
 * already on file, and say the sync failed.
 */
export async function fetchFeed({ force = false } = {}) {
  const config = read();
  if (!config.url) return { ok: false, reason: 'not-configured' };

  // A cached body under a minute old is reused, so two open tabs never become
  // two requests to the school's server.
  if (!force && cache.text && Date.now() - cache.at < 60_000) {
    return { ok: true, text: cache.text, fetchedAt: cache.at, cached: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(config.url, {
      // No cookies. The token in the URL is the whole authorization, and
      // attaching a session would turn one calendar read into something else.
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1' },
    });

    if (!response.ok) {
      const reason =
        response.status === 404 || response.status === 401 || response.status === 403
          ? 'rejected'
          : 'http-error';
      write({ lastError: `${config.host} answered ${response.status}`, lastFetchedAt: Date.now() });
      return { ok: false, reason, status: response.status };
    }

    // A redirect that left the configured host is not this feed any more.
    try {
      if (response.url && new URL(response.url).hostname !== config.host) {
        write({ lastError: 'The feed redirected somewhere else.' });
        return { ok: false, reason: 'redirected' };
      }
    } catch {
      /* an unparseable response URL is not worth failing the sync over */
    }

    const text = await response.text();
    if (text.length > MAX_BYTES) {
      write({ lastError: 'The feed was too large.' });
      return { ok: false, reason: 'too-large' };
    }

    const now = Date.now();
    cache = { text, at: now };
    write({ lastFetchedAt: now, lastError: '' });
    return { ok: true, text, fetchedAt: now, cached: false };
  } catch (error) {
    const aborted = error && error.name === 'AbortError';
    write({
      lastError: aborted ? 'The feed timed out.' : `Could not reach ${config.host}.`,
      lastFetchedAt: Date.now(),
    });
    return { ok: false, reason: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The background refresh.
 *
 * Runs for as long as the service does — which on this machine is "always",
 * including while Chrome is shut. `unref()` so it never holds the process open
 * on its own account.
 */
/**
 * May the timer fetch right now?
 *
 * Deliberately its own small copy of the rule rather than an import: this file
 * runs in a LaunchAgent with no build step and no access to the web app's
 * TypeScript. `extension/tests/canvas-grades.test.mjs` runs this function over
 * the same matrix as the other two copies and fails if they disagree.
 */
export function autoFetchAllowed(now = Date.now(), config = read()) {
  const w = config.checkWindow;
  // Never told what the window is → never fetch on a timer. Silence is not
  // permission, and the app refreshes the feed on Check Canvas anyway.
  if (!w || typeof w !== 'object') return { allowed: false, verdict: 'unknown_window' };
  if (w.mode !== 'scheduled') return { allowed: false, verdict: 'automatic_disabled' };
  if (typeof w.pausedUntil === 'number' && w.pausedUntil > now) {
    return { allowed: false, verdict: 'paused' };
  }

  const date = new Date(now);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const schoolDay = Array.isArray(w.schoolDays) && w.schoolDays.includes(date.getDay());
  const start = schoolDay ? w.schoolDayStart : w.freeDayStart;
  if (minutes < start) {
    const duringSchool = schoolDay && minutes >= (w.schoolDayFrom ?? 450);
    return { allowed: false, verdict: duringSchool ? 'school_hours' : 'outside_window' };
  }
  if (minutes >= w.dayEnd) return { allowed: false, verdict: 'outside_window' };
  return { allowed: true, verdict: 'allowed' };
}

/** Stores the window the app is enforcing. Rebuilt field by field. */
export function setCheckWindow(raw) {
  if (!raw || typeof raw !== 'object') return write({ checkWindow: null });
  const num = (value, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : fallback;
  };
  return write({
    checkWindow: {
      mode: raw.mode === 'scheduled' ? 'scheduled' : 'manual',
      schoolDays: Array.isArray(raw.schoolDays)
        ? raw.schoolDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : [1, 2, 3, 4, 5],
      schoolDayFrom: num(raw.schoolDayFrom, 7 * 60 + 30),
      schoolDayStart: num(raw.schoolDayStart, 15 * 60 + 30),
      dayEnd: num(raw.dayEnd, 21 * 60 + 30),
      freeDayStart: num(raw.freeDayStart, 9 * 60),
      pausedUntil:
        typeof raw.pausedUntil === 'number' && Number.isFinite(raw.pausedUntil)
          ? raw.pausedUntil
          : null,
    },
  });
}

export function startAutoRefresh() {
  const config = read();
  const minutes = Math.min(1440, Math.max(15, config.refreshMinutes || DEFAULT_REFRESH_MINUTES));
  const tick = () => {
    if (!isConfigured()) return;
    // The gate, on this side too. A timer that fires at 10am on a Tuesday must
    // do nothing at all.
    if (!autoFetchAllowed().allowed) return;
    void fetchFeed({ force: true });
  };

  const timer = setInterval(tick, minutes * 60_000);
  timer.unref?.();

  // And once shortly after boot, so a machine switched on after school has the
  // day's assignments before anyone opens the app.
  const first = setTimeout(tick, 5000);
  first.unref?.();

  return () => {
    clearInterval(timer);
    clearTimeout(first);
  };
}
