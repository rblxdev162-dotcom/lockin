/**
 * The Companion's background behaviour: activity categorisation, notification
 * cooldowns, snooze, and staying quiet while the student is visibly working.
 *
 * Chrome is faked with a small in-memory stub — `chrome.storage.local`,
 * `chrome.notifications` and nothing else — because the interesting rules are
 * timing and suppression, and those are pure enough to test without a browser.
 * The parts that genuinely need Chrome (blocking across windows, alarms
 * surviving a restart) are covered by the real-browser suites.
 *
 * Run: npm run test:companion
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* A minimal Chrome                                                    */
/* ------------------------------------------------------------------ */

const store = new Map();
const created = [];
const listeners = { tabs: {}, windows: {}, notifications: {} };

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        const keys = Array.isArray(key) ? key : [key];
        const out = {};
        for (const k of keys) if (store.has(k)) out[k] = store.get(k);
        return out;
      },
      async set(entries) {
        for (const [k, v] of Object.entries(entries)) store.set(k, v);
      },
      async remove(key) {
        for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
      },
    },
  },
  runtime: { getURL: (p) => `chrome-extension://test/${p}`, getManifest: () => ({ version: '1.2.1' }) },
  notifications: {
    async create(id, options) {
      created.push({ id, ...options });
      return id;
    },
    async clear() {},
    onClicked: { addListener: (fn) => (listeners.notifications.clicked = fn) },
    onButtonClicked: { addListener: (fn) => (listeners.notifications.button = fn) },
    onClosed: { addListener: (fn) => (listeners.notifications.closed = fn) },
  },
  tabs: {
    onActivated: { addListener: (fn) => (listeners.tabs.activated = fn) },
    onUpdated: { addListener: (fn) => (listeners.tabs.updated = fn) },
    onRemoved: { addListener: (fn) => (listeners.tabs.removed = fn) },
    async query() {
      return [];
    },
    async get() {
      throw new Error('no tab');
    },
  },
  windows: {
    WINDOW_ID_NONE: -1,
    onFocusChanged: { addListener: (fn) => (listeners.windows.focus = fn) },
  },
};

const activity = await import('../background/activity.js');
const reminders = await import('../background/reminders.js');

const NOW = Date.parse('2026-03-10T18:00:00Z');
const MINUTE = 60_000;

const bridgeState = (patch = {}) => ({
  focusModeActive: false,
  blockedDomains: ['youtube.com', 'reddit.com'],
  allowedDomains: ['docs.google.com'],
  appUrl: 'http://localhost:5173/home',
  canvasDomain: 'example.instructure.com',
  ...patch,
});

async function setBridgeState(patch = {}) {
  store.set('lockin_state', bridgeState(patch));
}

beforeEach(() => {
  store.clear();
  created.length = 0;
});

/* ------------------------------------------------------------------ */
/* Categorisation                                                      */
/* ------------------------------------------------------------------ */

test('sites fall into three buckets, and unknown means neutral', () => {
  const state = bridgeState();
  assert.equal(activity.categorise('youtube.com', state), 'distracting');
  assert.equal(activity.categorise('www.youtube.com', state), 'distracting');
  assert.equal(activity.categorise('m.youtube.com', state), 'distracting');
  assert.equal(activity.categorise('docs.google.com', state), 'productive');
  assert.equal(activity.categorise('example.instructure.com', state), 'productive');
  // Most of the web is none of LockIn's business.
  assert.equal(activity.categorise('en.wikipedia.org', state), 'neutral');
  assert.equal(activity.categorise('some-random-blog.net', state), 'neutral');
});

test('LockIn itself is never counted as a distraction', () => {
  assert.equal(activity.categorise('localhost', bridgeState()), 'productive');
});

test('the allowlist beats the blocklist, exactly as the blocker does', () => {
  const state = bridgeState({ blockedDomains: ['youtube.com'], allowedDomains: ['youtube.com'] });
  assert.equal(activity.categorise('youtube.com', state), 'productive');
});

test('only http and https tabs have a host at all', () => {
  assert.equal(activity.hostOf('https://example.com/x?y=1'), 'example.com');
  assert.equal(activity.hostOf('chrome://extensions'), null);
  assert.equal(activity.hostOf('file:///Users/x/secret.txt'), null);
  assert.equal(activity.hostOf(undefined), null);
});

/* ------------------------------------------------------------------ */
/* Time accounting                                                     */
/* ------------------------------------------------------------------ */

test('time is credited to the category that was open, not the one arriving', async () => {
  await setBridgeState();
  await activity.noteActive('docs.google.com', NOW);
  await activity.noteActive('youtube.com', NOW + 10 * MINUTE);

  const after = await activity.getActivity(NOW + 10 * MINUTE);
  assert.equal(after.productiveMs, 10 * MINUTE);
  assert.equal(after.distractingMs, 0, 'the distracting stretch has not happened yet');
});

test('a machine that slept does not report hours of study', async () => {
  await setBridgeState();
  await activity.noteActive('docs.google.com', NOW);
  await activity.noteActive('docs.google.com', NOW + 6 * 60 * MINUTE);

  const after = await activity.getActivity(NOW + 6 * 60 * MINUTE);
  assert.equal(after.productiveMs, 0, 'an implausible gap is not credited at all');
});

test('a clock that jumps backwards never produces a negative total', async () => {
  await setBridgeState();
  await activity.noteActive('docs.google.com', NOW);
  await activity.noteActive('docs.google.com', NOW - 5 * MINUTE);
  const after = await activity.getActivity(NOW);
  assert.ok(after.productiveMs >= 0);
});

test('losing focus to another app stops the clock rather than banking study time', async () => {
  await setBridgeState();
  await activity.noteActive('docs.google.com', NOW);
  await activity.noteActive(null, NOW + 5 * MINUTE);
  await activity.noteActive('docs.google.com', NOW + 65 * MINUTE);

  const after = await activity.getActivity(NOW + 65 * MINUTE);
  assert.equal(after.productiveMs, 5 * MINUTE, 'only the five minutes actually spent');
});

test('a new day starts from zero', async () => {
  await setBridgeState();
  await activity.noteActive('docs.google.com', NOW);
  await activity.noteActive('docs.google.com', NOW + 5 * MINUTE);
  assert.equal((await activity.getActivity(NOW + 5 * MINUTE)).productiveMs, 5 * MINUTE);

  const tomorrow = NOW + 26 * 60 * MINUTE;
  assert.equal((await activity.getActivity(tomorrow)).productiveMs, 0);
});

test('distractions are only counted as attempts during Focus Mode', async () => {
  await setBridgeState({ focusModeActive: false });
  await activity.noteActive('youtube.com', NOW);
  assert.equal((await activity.getActivity(NOW)).distractionAttempts, 0);

  await setBridgeState({ focusModeActive: true });
  await activity.noteActive('youtube.com', NOW + MINUTE);
  assert.equal((await activity.getActivity(NOW + MINUTE)).distractionAttempts, 1);
});

test('nothing stored can reconstruct where the student went', async () => {
  await setBridgeState();
  await activity.noteActive('en.wikipedia.org/wiki/Something_private', NOW);
  const stored = JSON.stringify(store.get('lockin_activity'));
  assert.ok(!stored.includes('Something_private'), 'no path is ever stored');
  // One current host, overwritten each time — not a list.
  await activity.noteActive('example.com', NOW + MINUTE);
  const after = store.get('lockin_activity');
  assert.equal(typeof after.currentHost, 'string');
  assert.ok(!Array.isArray(after.currentHost));
});

/* ------------------------------------------------------------------ */
/* Reminder delivery                                                   */
/* ------------------------------------------------------------------ */

const item = (patch = {}) => ({
  id: 'a1',
  title: 'Cell Respiration Worksheet',
  dueAt: new Date(NOW + 30 * MINUTE).toISOString(),
  first: 120,
  escalation: 60,
  warning: 30,
  ...patch,
});

test('a due reminder fires once and carries actions', async () => {
  await reminders.setSchedule([item()]);
  const result = await reminders.runReminderCheck(NOW);
  assert.equal(result.fired, 1);
  assert.equal(created.length, 1);
  assert.deepEqual(
    created[0].buttons.map((b) => b.title),
    ['Start Focus', 'Snooze 20m'],
  );

  // A second check a moment later must not repeat it.
  const again = await reminders.runReminderCheck(NOW + 1000);
  assert.equal(again.fired, 0);
  assert.equal(created.length, 1);
});

test('two subsystems noticing the same minute produce one buzz, not two', async () => {
  await reminders.setSchedule([item({ id: 'a1' }), item({ id: 'a2', title: 'Algebra' })]);
  await reminders.runReminderCheck(NOW);
  assert.equal(created.length, 1, 'one notification per check');

  // Even a direct delivery is refused inside the cooldown.
  const blocked = await reminders.deliver(
    { key: 'other', title: 'Something else', body: 'x' },
    NOW + MINUTE,
  );
  assert.equal(blocked.sent, false);
  assert.equal(blocked.reason, 'cooldown');
  assert.equal(created.length, 1);
});

test('the cooldown expires, and the held-back reminder is not lost', async () => {
  await reminders.setSchedule([item({ id: 'a1' }), item({ id: 'a2', title: 'Algebra' })]);
  await reminders.runReminderCheck(NOW);
  assert.equal(created.length, 1);

  const later = await reminders.runReminderCheck(NOW + reminders.GLOBAL_COOLDOWN_MS + 1000);
  assert.equal(later.fired, 1, 'the second assignment still gets its reminder');
  assert.equal(created.length, 2);
});

test('snooze silences one assignment and nothing else', async () => {
  await reminders.setSchedule([item({ id: 'a1' }), item({ id: 'a2', title: 'Algebra' })]);
  await reminders.snooze('a1', NOW);

  const snoozed = await reminders.getSnoozes();
  assert.ok(snoozed.a1 > NOW);
  assert.equal(snoozed.a2, undefined);

  await reminders.runReminderCheck(NOW);
  assert.equal(created.length, 1);
  assert.match(created[0].message, /Algebra/, 'the snoozed one stayed quiet');
});

test('a snooze ends, and the reminder comes back rather than vanishing', async () => {
  await reminders.setSchedule([item()]);
  await reminders.runReminderCheck(NOW);
  assert.equal(created.length, 1);

  await reminders.snooze('a1', NOW);
  const after = NOW + reminders.SNOOZE_MS + 1000;
  const result = await reminders.runReminderCheck(after);
  assert.equal(result.fired, 1, 'snooze is a promise to come back');
});

test('a student already working is left alone, until the last stage', async () => {
  const working = async () => ({ working: true, forMs: 10 * MINUTE });

  await reminders.setSchedule([item({ dueAt: new Date(NOW + 90 * MINUTE).toISOString() })]);
  await reminders.runReminderCheck(NOW, working);
  assert.equal(created.length, 0, 'the early nudge holds its tongue');

  // Half an hour out is the warning stage: being deep in one assignment is
  // exactly how a different deadline gets missed, so this one still speaks.
  await reminders.setSchedule([item({ dueAt: new Date(NOW + 20 * MINUTE).toISOString() })]);
  await reminders.runReminderCheck(NOW, working);
  assert.equal(created.length, 1);
});

test('a brief visit to a school tab is not "already working"', async () => {
  const glancing = async () => ({ working: true, forMs: 20_000 });
  assert.equal(await reminders.shouldStayQuiet(glancing, NOW), false);
  const settled = async () => ({ working: true, forMs: 5 * MINUTE });
  assert.equal(await reminders.shouldStayQuiet(settled, NOW), true);
});

test('praise is rationed to once a day and shares the same cooldown', async () => {
  const first = await reminders.praise('You’re ahead for the week.', NOW);
  assert.equal(first.sent, true);

  const second = await reminders.praise('Everything due tomorrow is handled.', NOW + 2 * MINUTE);
  assert.equal(second.sent, false);

  const tomorrow = NOW + reminders.PRAISE_COOLDOWN_MS + MINUTE;
  const third = await reminders.praise('Three days with no overdue work.', tomorrow);
  assert.equal(third.sent, true);
  assert.equal(created.length, 2);
});

test('a schedule from the page is rebuilt field by field', () => {
  const clean = reminders.validateSchedule([
    { id: 'ok', title: 'Fine', dueAt: new Date(NOW).toISOString(), evil: 'dropped' },
    { id: '', title: 'No id', dueAt: new Date(NOW).toISOString() },
    { id: 'x', title: 'No due date' },
    'not an object',
  ]);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].evil, undefined);
});

test('nothing fires for work long past due', async () => {
  await reminders.setSchedule([item({ dueAt: new Date(NOW - 20 * 60 * MINUTE).toISOString() })]);
  const result = await reminders.runReminderCheck(NOW);
  assert.equal(result.fired, 0, 'that has stopped being a reminder');
});
