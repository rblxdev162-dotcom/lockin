/**
 * Reminders that actually reach the student.
 *
 * ## The problem this fixes
 *
 * `web/src/hooks/useReminders.ts` can only run while a LockIn tab is alive — a
 * website has no other way to keep time. Close the tab and reminders stop; the
 * student who most needs nagging is exactly the student who closed it. Worse,
 * a hidden tab is throttled to roughly one timer tick a minute, so even an open
 * tab is a weak promise.
 *
 * The extension has neither limit. It gets `chrome.alarms`, which wake a
 * sleeping service worker, and `chrome.notifications`, which are real OS
 * notifications rather than a toast inside a tab nobody is looking at.
 *
 * ## The split
 *
 * The web app stays the source of truth: it owns assignments, due dates and
 * the reminder settings, and it hands this module a *schedule* — a small,
 * validated list of what to say and when. This module owns nothing but timing
 * and delivery.
 *
 * Both halves fire independently and both remember separately: the page shows
 * its in-app toast when it is open, this shows an OS notification whether or
 * not it is. `firedKeys` here guarantees at most one notification per
 * assignment and stage, whatever the page does — so a reload, a second tab, or
 * a re-sent schedule cannot produce a second buzz.
 *
 * ## What it is not
 *
 * It carries titles and due times, because a notification that will not say
 * what is due is useless. It carries nothing else: no progress, no history, no
 * URLs, no browsing data. Invariant 14 — accountability, never surveillance.
 */

const SCHEDULE_KEY = 'lockin_reminder_schedule';
const FIRED_KEY = 'lockin_reminders_fired';

/** Caps. A schedule is untrusted input like any other message payload. */
const LIMITS = {
  MAX_ITEMS: 100,
  MAX_TITLE_LENGTH: 80,
  /** Fired keys retained. Roughly three stages per assignment, well clear. */
  MAX_FIRED: 400,
};

/**
 * Stages, in the order they fire, mirroring `useReminders.ts`.
 * `minutesBefore` arrives per assignment — students set their own.
 */
const STAGES = ['first', 'escalation', 'warning'];

/** Nothing fires for work this far past due; it has stopped being a reminder. */
const STOP_NAGGING_AFTER_MS = 12 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Schedule storage                                                    */
/* ------------------------------------------------------------------ */

function str(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function validIso(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  const year = new Date(time).getFullYear();
  return year >= 2000 && year <= 2100 ? new Date(time).toISOString() : null;
}

function minutes(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(60 * 24 * 14, Math.max(0, Math.round(number)));
}

/** Rebuilds one scheduled item field by field, or returns null. */
export function validateReminderItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 64);
  const title = str(raw.title, LIMITS.MAX_TITLE_LENGTH);
  const dueAt = validIso(raw.dueAt);
  if (!id || !title || !dueAt) return null;

  return {
    id,
    title,
    dueAt,
    first: minutes(raw.first, 120),
    escalation: minutes(raw.escalation, 60),
    warning: minutes(raw.warning, 30),
    /** Purely cosmetic: shapes the wording, never whether it fires. */
    behind: str(raw.behind, 120) || undefined,
  };
}

export function validateSchedule(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, LIMITS.MAX_ITEMS).map(validateReminderItem).filter(Boolean);
}

export async function setSchedule(raw) {
  const items = validateSchedule(raw);
  await chrome.storage.local.set({ [SCHEDULE_KEY]: items });
  return items.length;
}

export async function getSchedule() {
  try {
    const stored = await chrome.storage.local.get(SCHEDULE_KEY);
    return Array.isArray(stored[SCHEDULE_KEY]) ? stored[SCHEDULE_KEY] : [];
  } catch {
    return [];
  }
}

async function getFired() {
  try {
    const stored = await chrome.storage.local.get(FIRED_KEY);
    return Array.isArray(stored[FIRED_KEY]) ? stored[FIRED_KEY] : [];
  } catch {
    return [];
  }
}

async function markFired(keys) {
  const fired = await getFired();
  // Newest last, oldest trimmed first — a key that aged out belongs to work
  // long past due, which `STOP_NAGGING_AFTER_MS` has already silenced.
  const next = [...fired, ...keys].slice(-LIMITS.MAX_FIRED);
  await chrome.storage.local.set({ [FIRED_KEY]: next });
}

/**
 * Clears fired marks for work no longer on the schedule.
 *
 * Without this, an assignment completed and later re-opened would stay
 * permanently silent, and the list would grow forever.
 */
export async function pruneFired() {
  const items = await getSchedule();
  const live = new Set(items.map((item) => item.id));
  const fired = await getFired();
  const kept = fired.filter((key) => live.has(key.split('|')[0]));
  if (kept.length !== fired.length) await chrome.storage.local.set({ [FIRED_KEY]: kept });
}

/* ------------------------------------------------------------------ */
/* Deciding what is due                                                */
/* ------------------------------------------------------------------ */

function wording(item, stage) {
  const behind = item.behind ? ` ${item.behind}` : '';
  switch (stage) {
    case 'first':
      return { title: 'Due soon', body: `“${item.title}” is coming up.${behind}` };
    case 'escalation':
      return { title: 'Still unfinished', body: `“${item.title}” hasn’t been started.${behind}` };
    default:
      return { title: 'Due very soon', body: `“${item.title}” is nearly due.${behind}` };
  }
}

/**
 * Pure: which notifications are owed right now.
 *
 * Split out from delivery so it can be tested in Node without Chrome — the
 * timing rules are where the bugs live, not in `notifications.create`.
 *
 * @returns {{ key: string, title: string, body: string }[]}
 */
export function dueNotifications(items, fired, now) {
  const already = new Set(fired);
  const out = [];

  for (const item of items) {
    const due = Date.parse(item.dueAt);
    if (Number.isNaN(due)) continue;
    const minutesLeft = (due - now) / 60_000;
    if (minutesLeft < -(STOP_NAGGING_AFTER_MS / 60_000)) continue;

    /**
     * Only the furthest-along stage fires.
     *
     * A tab that was closed for three hours comes back to several stages all
     * technically overdue; firing them together would be three buzzes saying
     * the same thing. The later stage is the more urgent wording, so it wins
     * and the earlier ones are marked without being shown.
     */
    const reached = STAGES.filter((stage) => minutesLeft <= item[stage]);
    if (reached.length === 0) continue;

    const stage = reached[reached.length - 1];
    const key = `${item.id}|${stage}`;
    if (already.has(key)) continue;

    const { title, body } = wording(item, stage);
    out.push({
      key,
      title,
      body,
      // Earlier stages are consumed silently so they cannot fire later.
      alsoMark: reached.slice(0, -1).map((s) => `${item.id}|${s}`),
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

async function notify(entry) {
  try {
    await chrome.notifications.create(`lockin-${entry.key}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icon-128.png'),
      title: entry.title,
      message: entry.body,
      priority: 1,
    });
    return true;
  } catch (error) {
    // Notifications can be refused at the OS level. That is not fatal, and it
    // must not stop the rest of the schedule from being evaluated.
    console.warn('[LockIn] notification refused', error);
    return false;
  }
}

/**
 * Called from the heartbeat alarm. Cheap when nothing is due, which is almost
 * always: one storage read and some arithmetic.
 */
export async function runReminderCheck(now = Date.now()) {
  const items = await getSchedule();
  if (items.length === 0) return { fired: 0 };

  const fired = await getFired();
  const owed = dueNotifications(items, fired, now);
  if (owed.length === 0) return { fired: 0 };

  const keys = [];
  for (const entry of owed) {
    // Mark regardless of whether the OS showed it. A notification the system
    // swallowed is not worth re-attempting every minute forever.
    keys.push(entry.key, ...entry.alsoMark);
    await notify(entry);
  }
  await markFired(keys);
  return { fired: owed.length };
}

/** Notification clicked → open LockIn. Registered once, from the worker. */
export function onNotificationClicked(openApp) {
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith('lockin-')) return;
    chrome.notifications.clear(id).catch(() => {});
    void openApp();
  });
}

export const REMINDER_STORAGE_KEYS = { SCHEDULE_KEY, FIRED_KEY };
