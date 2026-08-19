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
/** id -> epoch ms until which this assignment is silent. */
const SNOOZE_KEY = 'lockin_reminders_snoozed';
/** Cross-subsystem delivery record, so nothing can buzz twice in a row. */
const LAST_SENT_KEY = 'lockin_last_notification';
/** Praise is rationed separately from nags; the two must not crowd each other. */
const PRAISE_KEY = 'lockin_last_praise';

/**
 * No two notifications from LockIn within this window, whatever fired them.
 *
 * This is the rule that stops the failure the brief names explicitly: five
 * reminders about one assignment because five subsystems each noticed it. The
 * schedule, the pace nudge and the praise path all pass through `deliver()`,
 * and `deliver()` is the only thing that calls `chrome.notifications.create`.
 */
export const GLOBAL_COOLDOWN_MS = 10 * 60 * 1000;

/** One snooze is 20 minutes. Long enough to matter, short enough to return. */
export const SNOOZE_MS = 20 * 60 * 1000;

/** At most one piece of positive feedback a day. */
export const PRAISE_COOLDOWN_MS = 20 * 60 * 60 * 1000;

/**
 * How long a student has to be working before reminders hold their tongue.
 *
 * "You're already working on it, I'll stop reminding you" is only true if they
 * really are — two seconds on a school tab is a click, not a study session.
 */
export const PRESENCE_QUIET_MS = 3 * 60 * 1000;

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
export function dueNotifications(items, fired, now, options = {}) {
  const already = new Set(fired);
  const snoozed = options.snoozed ?? {};
  const out = [];

  for (const item of items) {
    // A snoozed assignment is silent until its own deadline passes, and then
    // only for the stage it was snoozed at. Snooze is a promise to come back,
    // not a way to lose an assignment.
    if (typeof snoozed[item.id] === 'number' && snoozed[item.id] > now) continue;
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
      stage,
      assignmentId: item.id,
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

async function readKey(key, fallback) {
  try {
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getSnoozes() {
  const raw = await readKey(SNOOZE_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

/**
 * Silences one assignment for `SNOOZE_MS`.
 *
 * Stored per assignment rather than globally: snoozing biology should not also
 * silence the maths homework due in an hour, which is the behaviour that makes
 * people stop trusting a snooze button.
 */
export async function snooze(id, now = Date.now()) {
  if (typeof id !== 'string' || !id) return null;
  const snoozes = await getSnoozes();
  const live = Object.fromEntries(
    Object.entries(snoozes).filter(([, until]) => typeof until === 'number' && until > now),
  );
  live[id.slice(0, 64)] = now + SNOOZE_MS;
  await chrome.storage.local.set({ [SNOOZE_KEY]: live });
  // The stage mark is cleared so the same stage can speak again after the
  // snooze — otherwise "remind me in 20 minutes" would mean "never".
  const fired = await getFired();
  await chrome.storage.local.set({
    [FIRED_KEY]: fired.filter((key) => key.split('|')[0] !== id),
  });
  return live[id];
}

/**
 * The single gate every LockIn notification passes through.
 *
 * Nothing else in the extension may call `chrome.notifications.create`. That is
 * the whole mechanism behind "a student never gets five reminders because five
 * subsystems noticed the same thing": there is one door, and it is timed.
 */
export async function deliver(entry, now = Date.now(), { bypassCooldown = false } = {}) {
  const lastSent = Number(await readKey(LAST_SENT_KEY, 0)) || 0;
  if (!bypassCooldown && now - lastSent < GLOBAL_COOLDOWN_MS) {
    return { sent: false, reason: 'cooldown' };
  }

  const buttons = [];
  if (entry.assignmentId) {
    buttons.push({ title: 'Start Focus' }, { title: 'Snooze 20m' });
  }

  try {
    await chrome.notifications.create(`lockin-${entry.key}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icon-128.png'),
      title: entry.title,
      message: entry.body,
      priority: entry.priority ?? 1,
      ...(buttons.length > 0 ? { buttons } : {}),
    });
  } catch (error) {
    // Notifications can be refused at the OS level. That is not fatal, and it
    // must not stop the rest of the schedule from being evaluated.
    console.warn('[LockIn] notification refused', error);
  }

  await chrome.storage.local.set({ [LAST_SENT_KEY]: now });
  return { sent: true };
}

/**
 * Whether the student is visibly working, and so should be left alone.
 *
 * Takes the presence reader as an argument rather than importing it, so this
 * file stays testable without a browser and so the dependency runs one way:
 * reminders know about presence, presence knows nothing about reminders.
 */
export async function shouldStayQuiet(presenceReader, now = Date.now()) {
  if (typeof presenceReader !== 'function') return false;
  try {
    const presence = await presenceReader(now);
    return presence.working === true && presence.forMs >= PRESENCE_QUIET_MS;
  } catch {
    return false;
  }
}

/**
 * Called from the heartbeat alarm. Cheap when nothing is due, which is almost
 * always: one storage read and some arithmetic.
 *
 * `presenceReader` is optional. When it is supplied and says the student is
 * already working, the *early* stages hold their tongue — but the last stage
 * before a deadline always speaks. Being deep in one assignment is exactly how
 * people miss a different one.
 */
export async function runReminderCheck(now = Date.now(), presenceReader = null) {
  const items = await getSchedule();
  if (items.length === 0) return { fired: 0 };

  const fired = await getFired();
  const snoozed = await getSnoozes();
  const owed = dueNotifications(items, fired, now, { snoozed });
  if (owed.length === 0) return { fired: 0 };

  const quiet = await shouldStayQuiet(presenceReader, now);

  let sent = 0;
  const keys = [];
  for (const entry of owed) {
    if (quiet && entry.stage !== 'warning') continue;
    const result = await deliver(entry, now);
    if (!result.sent) continue;
    sent += 1;
    // Marked only once it actually went out. A notification held back by the
    // cooldown has not been delivered, and marking it would lose it entirely.
    keys.push(entry.key, ...entry.alsoMark);
    // One buzz per check. The next heartbeat is a minute away and the cooldown
    // governs the pace from there.
    break;
  }
  if (keys.length > 0) await markFired(keys);
  return { fired: sent };
}

/**
 * Positive feedback, rationed hard.
 *
 * Praise that arrives for everything means nothing, so this is capped at once
 * a day *and* passes the same global cooldown as every nag. The caller decides
 * whether something is worth saying; this decides whether it may be said now.
 */
export async function praise(text, now = Date.now()) {
  const last = Number(await readKey(PRAISE_KEY, 0)) || 0;
  if (now - last < PRAISE_COOLDOWN_MS) return { sent: false, reason: 'cooldown' };

  const result = await deliver(
    { key: `praise-${now}`, title: 'LockIn', body: text, priority: 0 },
    now,
  );
  if (result.sent) await chrome.storage.local.set({ [PRAISE_KEY]: now });
  return result;
}

/**
 * Clicks and button presses.
 *
 * A notification with no way to act on it is a nag; the two buttons are what
 * make it useful. `Start Focus` opens LockIn at the assignment rather than
 * starting a session behind the student's back — the extension does not own
 * Focus Mode, the app does, and inventing a second way to start one would
 * break the "one timer, one blocker" invariant.
 *
 * The notification id carries the assignment id, so the handlers need no state
 * of their own and survive the worker being killed between showing a
 * notification and the student pressing a button on it.
 */
export function onNotificationClicked(openApp) {
  const idFrom = (notificationId) => {
    // `lockin-<assignmentId>|<stage>`
    const rest = notificationId.slice('lockin-'.length);
    const [assignmentId] = rest.split('|');
    return assignmentId || null;
  };

  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith('lockin-')) return;
    chrome.notifications.clear(id).catch(() => {});
    void openApp(idFrom(id));
  });

  chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
    if (!id.startsWith('lockin-')) return;
    const assignmentId = idFrom(id);
    chrome.notifications.clear(id).catch(() => {});

    if (buttonIndex === 0) {
      void openApp(assignmentId, { focus: true });
    } else {
      void snooze(assignmentId);
    }
  });

  // A dismissed notification is an answer too: it is not snoozed, but it is
  // not re-shown either — `firedKeys` already recorded it.
  chrome.notifications.onClosed.addListener(() => {});
}

export const REMINDER_STORAGE_KEYS = { SCHEDULE_KEY, FIRED_KEY, SNOOZE_KEY, LAST_SENT_KEY, PRAISE_KEY };
