/**
 * Activity awareness — knowing whether the student is working, without
 * watching what they are doing.
 *
 * ## The line this file will not cross
 *
 * It reads **tab metadata only**: the hostname of the active tab, and when it
 * became active. It never reads page contents, never injects a script into an
 * ordinary site, never records a URL path, a query string, a title, or a
 * history. Storage holds counters and one current hostname, nothing that could
 * reconstruct a browsing session.
 *
 * That is not a limitation to work around, it is the feature. "You're already
 * working, so I'll stay out of the way" needs a category, not a transcript.
 *
 * ## Three categories, and the third is the default
 *
 *  - **PRODUCTIVE** — the student's own list, plus LockIn itself and the
 *    configured school domains.
 *  - **DISTRACTING** — the student's own blocklist. Nothing is on it by
 *    default, because a list somebody else wrote is a list they will argue
 *    with instead of using.
 *  - **NEUTRAL** — everything else, and most of the web. Unknown is not
 *    suspicious.
 *
 * ## Service-worker lifecycle
 *
 * The worker dies constantly, so nothing accumulates in module scope: every
 * event reads and writes storage, and the "current" tab is re-derived rather
 * than remembered. A restart mid-session loses at most the seconds since the
 * last event, and never corrupts a total.
 */
import { hostMatches, normalizeDomain } from '../shared/domains.js';
import { getState } from './storage.js';

const KEY = 'lockin_activity';

/** Counters reset each day; a rolling total nobody can interpret is noise. */
const DEFAULTS = {
  /** Local `YYYY-MM-DD` the counters belong to. */
  day: '',
  productiveMs: 0,
  distractingMs: 0,
  neutralMs: 0,
  /** Category of the tab currently focused, or null when Chrome is unfocused. */
  currentCategory: null,
  /** Hostname of the focused tab. One string, overwritten, never appended to. */
  currentHost: null,
  /** Epoch ms the current tab became active. */
  since: 0,
  /** Times a distracting site was opened during a Focus Mode run. */
  distractionAttempts: 0,
  /** Epoch ms of the last distraction, so a nudge can be rate-limited. */
  lastDistractionAt: 0,
};

export const CATEGORIES = { PRODUCTIVE: 'productive', DISTRACTING: 'distracting', NEUTRAL: 'neutral' };

function today(now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function getActivity(now = Date.now()) {
  let stored;
  try {
    stored = (await chrome.storage.local.get(KEY))[KEY];
  } catch {
    stored = null;
  }
  const activity = { ...DEFAULTS, ...(stored ?? {}) };
  // A new day starts from zero rather than carrying yesterday's minutes into
  // a number labelled "today".
  const day = today(now);
  if (activity.day !== day) {
    return { ...DEFAULTS, day, currentCategory: activity.currentCategory, currentHost: activity.currentHost, since: now };
  }
  return activity;
}

async function setActivity(activity) {
  await chrome.storage.local.set({ [KEY]: activity });
  return activity;
}

/**
 * Which bucket a hostname falls in.
 *
 * Pure, and exported for the test suite: the categorisation rules are where
 * the bugs would be, and they should be checkable without a browser.
 *
 * LockIn's own origin is always productive — the app cannot be the thing that
 * makes you look distracted — and the allowlist (which includes the school's
 * Canvas domain) counts as productive because that is precisely what it is.
 */
export function categorise(host, state) {
  const raw = typeof host === 'string' ? host.trim().toLowerCase().replace(/^www\./, '') : '';

  // LockIn's own origin is checked against the raw hostname, before
  // normalisation. `normalizeDomain` requires two labels — correctly, since a
  // single-label blocklist entry would be meaningless — but in development
  // LockIn *is* a single label, `localhost`, and it must never be the thing
  // that makes a student look distracted.
  try {
    if (state.appUrl && raw === new URL(state.appUrl).hostname.replace(/^www\./, '')) {
      return CATEGORIES.PRODUCTIVE;
    }
  } catch {
    /* a malformed appUrl is not worth failing a categorisation over */
  }

  const domain = normalizeDomain(host);
  if (!domain) return CATEGORIES.NEUTRAL;

  if (state.canvasDomain && domain === normalizeDomain(state.canvasDomain)) {
    return CATEGORIES.PRODUCTIVE;
  }
  // The allowlist wins over the blocklist here for the same reason it does in
  // the blocker: a site the student marked as school work is school work.
  // `hostMatches` is the blocker's own comparison, so a domain categorised as
  // distracting here is exactly one the blocker would block — the two can
  // never disagree about what counts.
  const listed = (list) => (list ?? []).some((entry) => hostMatches(domain, entry));
  if (listed(state.allowedDomains)) return CATEGORIES.PRODUCTIVE;
  if (listed(state.blockedDomains)) return CATEGORIES.DISTRACTING;
  return CATEGORIES.NEUTRAL;
}

/**
 * Records the time spent in the previous category and starts the next.
 *
 * Called on every tab activation, navigation and window focus change. Elapsed
 * time is only credited when it is plausible — a machine that slept for six
 * hours must not report six hours of productive study, and the clock jumping
 * backwards must not produce a negative total.
 */
export async function noteActive(host, now = Date.now()) {
  const state = await getState();
  const activity = await getActivity(now);
  const category = host === null ? null : categorise(host, state);

  const elapsed = activity.since > 0 ? now - activity.since : 0;
  const credited = elapsed > 0 && elapsed < 15 * 60_000 ? elapsed : 0;

  const next = { ...activity, day: today(now) };
  if (activity.currentCategory === CATEGORIES.PRODUCTIVE) next.productiveMs += credited;
  else if (activity.currentCategory === CATEGORIES.DISTRACTING) next.distractingMs += credited;
  else if (activity.currentCategory === CATEGORIES.NEUTRAL) next.neutralMs += credited;

  next.currentCategory = category;
  next.currentHost = host ? normalizeDomain(host) : null;
  next.since = now;

  // A distraction opened *during* Focus Mode is the only thing worth counting
  // as an attempt. Outside Focus Mode it is just browsing, and counting it
  // would turn this into the surveillance the Parent Dashboard refuses to be.
  if (category === CATEGORIES.DISTRACTING && state.focusModeActive) {
    next.distractionAttempts += 1;
    next.lastDistractionAt = now;
  }

  return setActivity(next);
}

/** Hostname of a tab, or null when it is not an ordinary web page. */
export function hostOf(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Whether the student appears to be working right now.
 *
 * Deliberately coarse: a category and a duration. This is what lets a reminder
 * hold its tongue — "you're already working in your planned block, so I'll
 * stay out of the way" — and it is the *only* thing the reminder path is
 * allowed to ask about presence.
 */
export async function studyPresence(now = Date.now()) {
  const activity = await getActivity(now);
  const runningMs = activity.since > 0 ? Math.max(0, now - activity.since) : 0;
  return {
    category: activity.currentCategory,
    /** How long the current category has been continuous, in ms. */
    forMs: runningMs < 15 * 60_000 ? runningMs : 0,
    working: activity.currentCategory === CATEGORIES.PRODUCTIVE,
    productiveMs: activity.productiveMs,
    distractingMs: activity.distractingMs,
    distractionAttempts: activity.distractionAttempts,
  };
}

/** Zeroes the per-run distraction counter when a Focus Mode run begins. */
export async function resetRunCounters(now = Date.now()) {
  const activity = await getActivity(now);
  return setActivity({ ...activity, distractionAttempts: 0, lastDistractionAt: 0 });
}

/**
 * Wires the tab and window listeners.
 *
 * Registered once from the service worker's top level, which is the only place
 * MV3 guarantees listeners are attached before an event can arrive.
 *
 * `windows.onFocusChanged` with `WINDOW_ID_NONE` means Chrome lost focus
 * entirely — the student switched to another app, or walked away. That is
 * recorded as "no category" rather than as continued study, because counting
 * it would make an app in the background look like an hour of work.
 */
export function registerActivityListeners() {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      await noteActive(hostOf(tab.url));
    } catch {
      /* the tab closed between the event and the lookup */
    }
  });

  chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    // Only a committed navigation in the focused tab matters; a background tab
    // finishing a load is not the student changing what they are doing.
    if (!changeInfo.url || !tab.active) return;
    await noteActive(hostOf(changeInfo.url));
  });

  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await noteActive(null);
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      await noteActive(tab ? hostOf(tab.url) : null);
    } catch {
      await noteActive(null);
    }
  });

  // A closed tab is only interesting when it was the focused one; the next
  // activation event handles the rest.
  chrome.tabs.onRemoved.addListener(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await noteActive(tab ? hostOf(tab.url) : null);
    } catch {
      /* no window left */
    }
  });
}

/**
 * Re-derives the current tab after a worker restart.
 *
 * The worker is killed constantly, and it comes back with no idea what is on
 * screen. Without this, `since` would still point at a tab from an hour ago
 * and the next event would try to credit an hour of study to it — the elapsed
 * cap catches that, but starting from the truth is better than relying on a
 * cap.
 */
export async function resyncActive(now = Date.now()) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const activity = await getActivity(now);
    await setActivity({ ...activity, since: now, currentHost: tab ? normalizeDomain(hostOf(tab.url) ?? '') : null, currentCategory: tab ? categorise(hostOf(tab.url), await getState()) : null });
  } catch {
    /* no windows open yet */
  }
}
