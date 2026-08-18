/**
 * Reminder timing — the pure half, no Chrome.
 *
 * `dueNotifications` is where the bugs would live: everything around it is
 * storage reads and `notifications.create`. The rules it has to get right, and
 * the reason each one exists:
 *
 *   - fire once per assignment and stage, ever, however often the check runs;
 *   - when several stages are overdue at once — a laptop that was asleep — say
 *     the most urgent thing once, not three things in a row;
 *   - stop nagging twelve hours after due, matching the page-side engine;
 *   - never fire for work that is not yet near.
 *
 * Run: npm run test:reminders
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dueNotifications,
  validateReminderItem,
  validateSchedule,
} from '../background/reminders.js';

const NOW = Date.parse('2026-08-17T12:00:00.000Z');

/** Due in `minutes`, with the default stage offsets. */
function item(minutesUntilDue, overrides = {}) {
  return {
    id: 'a-1',
    title: 'Algebra module 4',
    dueAt: new Date(NOW + minutesUntilDue * 60_000).toISOString(),
    first: 120,
    escalation: 60,
    warning: 30,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

test('nothing fires for work that is not near yet', () => {
  assert.deepEqual(dueNotifications([item(300)], [], NOW), []);
});

test('the first stage fires at its offset', () => {
  const due = dueNotifications([item(119)], [], NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0].key, 'a-1|first');
  assert.match(due[0].body, /Algebra module 4/);
});

test('each stage fires once, and only once', () => {
  const first = dueNotifications([item(119)], [], NOW);
  assert.equal(first.length, 1);
  // Same check a minute later, with the first stage already recorded.
  const second = dueNotifications([item(118)], ['a-1|first'], NOW);
  assert.deepEqual(second, []);
});

test('a later stage still fires after an earlier one', () => {
  const due = dueNotifications([item(29)], ['a-1|first', 'a-1|escalation'], NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0].key, 'a-1|warning');
});

test('several overdue stages collapse into the most urgent one', () => {
  // The machine was asleep through all three offsets.
  const due = dueNotifications([item(5)], [], NOW);
  assert.equal(due.length, 1, 'one notification, not three');
  assert.equal(due[0].key, 'a-1|warning');
  // The skipped stages are consumed so they cannot fire later.
  assert.deepEqual(due[0].alsoMark.sort(), ['a-1|escalation', 'a-1|first']);
});

test('nagging stops twelve hours after due', () => {
  assert.deepEqual(dueNotifications([item(-60 * 13)], [], NOW), []);
  // Still inside the window, so it does fire.
  assert.equal(dueNotifications([item(-60)], [], NOW).length, 1);
});

test('an unreadable due date is skipped rather than throwing', () => {
  assert.deepEqual(dueNotifications([item(10, { dueAt: 'not a date' })], [], NOW), []);
});

test('the behind-pace clause reaches the notification body', () => {
  const due = dueNotifications(
    [item(29, { behind: 'Edgenuity says you’re 6% behind target.' })],
    [],
    NOW,
  );
  assert.match(due[0].body, /6% behind target/);
});

/* ------------------------------------------------------------------ */
/* The schedule is untrusted input like any other payload              */
/* ------------------------------------------------------------------ */

test('an item without id, title or due date is dropped', () => {
  assert.equal(validateReminderItem({ title: 'x', dueAt: new Date().toISOString() }), null);
  assert.equal(validateReminderItem({ id: 'a', dueAt: new Date().toISOString() }), null);
  assert.equal(validateReminderItem({ id: 'a', title: 'x' }), null);
  assert.equal(validateReminderItem({ id: 'a', title: 'x', dueAt: 'nope' }), null);
});

test('titles are capped and whitespace-normalised', () => {
  const clean = validateReminderItem({
    id: 'a',
    title: '  Algebra\n\n   module  ' + 'x'.repeat(200),
    dueAt: new Date(NOW).toISOString(),
  });
  assert.ok(clean.title.length <= 80);
  assert.ok(clean.title.startsWith('Algebra module'));
});

test('only the fields a notification needs survive', () => {
  const clean = validateReminderItem({
    id: 'a',
    title: 'x',
    dueAt: new Date(NOW).toISOString(),
    // None of these belong in the extension.
    progressPercent: 40,
    url: 'https://learn.edgenuity.com/x',
    notes: 'private',
  });
  assert.deepEqual(Object.keys(clean).sort(), [
    'behind',
    'dueAt',
    'escalation',
    'first',
    'id',
    'title',
    'warning',
  ]);
});

test('a schedule is capped and non-arrays are refused', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    id: `a-${i}`,
    title: 't',
    dueAt: new Date(NOW).toISOString(),
  }));
  assert.equal(validateSchedule(many).length, 100);
  assert.deepEqual(validateSchedule(null), []);
  assert.deepEqual(validateSchedule({ items: [] }), []);
});
