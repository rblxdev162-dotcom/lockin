/**
 * Focus Guard and quick-add (Phase 9).
 *
 * Both are new surfaces where a wrong answer is worse than no answer:
 *
 *  - Focus Guard is the *honest* half of LockIn. If it over-counts, it accuses
 *    a student of wandering off when they didn't; if it leaks a destination,
 *    the privacy claim on `/privacy` becomes a lie.
 *  - Quick-add turns free text into a deadline. A parser that silently guesses
 *    wrong puts a fake due date on the plan, and the plan is the thing the
 *    student is meant to trust.
 *
 * Run: npm run test:phase9
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '../..');
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const { AWAY_GRACE_MS, applyVisibility, describeTally, formatAway, tally } = await import(
  '../../web/src/lib/focusGuard.ts'
);
const { parseQuickAdd, DEFAULT_ESTIMATE_MINUTES } = await import('../../web/src/lib/quickAdd.ts');
const { reducer } = await import('../../web/src/store/reducer.ts');
const { defaultState, load, save } = await import('../../web/src/lib/storage.ts');
const { addDaysISO, todayISO } = await import('../../web/src/lib/time.ts');
const { createAssignment } = await import('../../web/src/store/factories.ts');

/* ------------------------------------------------------------------ */
/* Focus Guard — the visibility fold                                   */
/* ------------------------------------------------------------------ */

test('a trip away opens and closes exactly once', () => {
  let periods = [];
  periods = applyVisibility(periods, false, 1_000);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].returnedAt, undefined, 'the trip is open while away');

  periods = applyVisibility(periods, true, 11_000);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].returnedAt, 11_000);
});

test('repeated events on the same side cannot corrupt the list', () => {
  // Browsers do fire duplicate visibilitychange events, and a missed `visible`
  // — a crashed tab, a closed lid — must not leave two open periods that both
  // count forever.
  let periods = [];
  periods = applyVisibility(periods, false, 1_000);
  periods = applyVisibility(periods, false, 2_000);
  periods = applyVisibility(periods, false, 3_000);
  assert.equal(periods.length, 1, 'going hidden while hidden is a no-op');
  assert.equal(periods[0].leftAt, 1_000, 'and it does not restart the clock');

  periods = applyVisibility(periods, true, 9_000);
  periods = applyVisibility(periods, true, 10_000);
  assert.equal(periods.length, 1, 'returning while present is a no-op');
  assert.equal(periods[0].returnedAt, 9_000);
});

test('trips under the grace period are not counted at all', () => {
  const brief = [{ leftAt: 0, returnedAt: AWAY_GRACE_MS - 1 }];
  const counted = tally(brief, 100_000);
  assert.equal(counted.count, 0, 'checking a due date in another tab is not distraction');
  assert.equal(counted.totalMs, 0);

  const real = [{ leftAt: 0, returnedAt: AWAY_GRACE_MS + 1 }];
  assert.equal(tally(real, 100_000).count, 1);
});

test('an in-progress trip is timed but not yet counted', () => {
  const open = [{ leftAt: 10_000 }];
  const t = tally(open, 70_000);
  assert.equal(t.away, true);
  assert.equal(t.currentMs, 60_000);
  assert.equal(t.count, 0, 'a trip is only a trip once it ends');
  assert.equal(t.totalMs, 60_000, 'but the time so far is real and is shown');
});

test('the tally adds up across several trips', () => {
  const periods = [
    { leftAt: 0, returnedAt: 60_000 },
    { leftAt: 120_000, returnedAt: 121_000 }, // under the grace period
    { leftAt: 200_000, returnedAt: 260_000 },
  ];
  const t = tally(periods, 300_000);
  assert.equal(t.count, 2);
  assert.equal(t.totalMs, 120_000);
  assert.equal(t.away, false);
});

test('nothing in the module records where the student went', () => {
  const source = readFileSync(join(ROOT, 'web/src/lib/focusGuard.ts'), 'utf8');
  const hook = readFileSync(join(ROOT, 'web/src/hooks/useFocusGuard.ts'), 'utf8');
  const combined = source + hook;

  // The Page Visibility API cannot report a destination, and nothing here may
  // try to infer one from another source.
  for (const forbidden of [
    'location.href',
    'document.referrer',
    'window.open',
    'IdleDetector',
    'requestIdleDetection',
    'navigator.userAgent',
    'history',
  ]) {
    assert.ok(
      !combined.includes(forbidden),
      `Focus Guard references "${forbidden}" — it must only know visible/hidden`,
    );
  }
  assert.ok(combined.includes('visibilitychange'), 'and it uses the API it claims to use');
});

test('the Idle Detection API is refused, with the reason written down', () => {
  const source = readFileSync(join(ROOT, 'web/src/lib/focusGuard.ts'), 'utf8');
  // Mozilla and WebKit both classified it as a surveillance vector. The
  // rejection is documented in the module so nobody adds it back "for
  // accuracy" without reading why it is not there.
  assert.ok(source.includes('Idle Detection'), 'the rejection must be documented');
  assert.ok(/Mozilla/.test(source) && /WebKit/.test(source), 'and attributed');
});

test('the wording states facts and never scolds', () => {
  const messages = [
    describeTally({ count: 0, totalMs: 0, away: false, currentMs: 0 }),
    describeTally({ count: 1, totalMs: 30_000, away: false, currentMs: 0 }),
    describeTally({ count: 4, totalMs: 660_000, away: false, currentMs: 0 }),
    describeTally({ count: 2, totalMs: 60_000, away: true, currentMs: 5_000 }),
  ];
  for (const message of messages) {
    assert.ok(message.length > 0);
    assert.ok(
      !/(fail|wasted|bad|should|lazy|distract|sorry|!)/i.test(message),
      `guilt language leaked into: "${message}"`,
    );
  }
  assert.match(describeTally({ count: 1, totalMs: 660_000, away: false, currentMs: 0 }), /11 minute/);
  assert.equal(formatAway(65_000), '1m 05s');
});

/* ------------------------------------------------------------------ */
/* Focus Guard — the store                                             */
/* ------------------------------------------------------------------ */

function inFocusMode() {
  let state = defaultState();
  state = reducer(state, { type: 'CREATE_PROFILE', firstName: 'Sam' });
  return reducer(state, {
    type: 'START_FOCUS_MODE',
    requiredTaskIds: [],
    requiredCompletionCount: 0,
  });
}

test('away time is recorded against the running Focus Mode run', () => {
  let state = inFocusMode();
  assert.equal(state.focusRuns[0].awayCount, 0);

  state = reducer(state, { type: 'FOCUS_GUARD_AWAY', ms: 60_000 });
  state = reducer(state, { type: 'FOCUS_GUARD_AWAY', ms: 30_000 });

  assert.equal(state.focusRuns[0].awayCount, 2);
  assert.equal(state.focusRuns[0].awayMs, 90_000);
});

test('nothing is recorded outside Focus Mode', () => {
  let state = defaultState();
  state = reducer(state, { type: 'CREATE_PROFILE', firstName: 'Sam' });
  const after = reducer(state, { type: 'FOCUS_GUARD_AWAY', ms: 60_000 });
  assert.deepEqual(after, state, 'ordinary tab switching is not LockIn’s business');
});

test('nothing is recorded when the student turned Focus Guard off', () => {
  let state = inFocusMode();
  state = reducer(state, { type: 'UPDATE_SETTINGS', patch: { focusGuard: false } });
  const after = reducer(state, { type: 'FOCUS_GUARD_AWAY', ms: 60_000 });
  assert.equal(after.focusRuns[0].awayCount, 0, 'off means off, not hidden');
});

test('a nonsense duration cannot poison the tally', () => {
  let state = inFocusMode();
  state = reducer(state, { type: 'FOCUS_GUARD_AWAY', ms: -5_000 });
  state = reducer(state, { type: 'FOCUS_GUARD_AWAY', ms: 1 });
  assert.equal(state.focusRuns[0].awayCount, 0, 'sub-grace and negative are ignored');

  // A clock jump mid-trip could produce a week. A day is the ceiling.
  state = reducer(state, { type: 'FOCUS_GUARD_AWAY', ms: 9e12 });
  assert.ok(state.focusRuns[0].awayMs <= 86_400_000);
});

test('Focus Guard never ends, extends or unlocks Focus Mode', () => {
  let state = inFocusMode();
  const before = state.focusMode;
  state = reducer(state, { type: 'FOCUS_GUARD_AWAY', ms: 3_600_000 });
  assert.deepEqual(state.focusMode, before, 'it observes; it must never obstruct or punish');
});

test('away time survives a save and reload, and old runs read as zero', () => {
  store.clear();
  let state = inFocusMode();
  state = reducer(state, { type: 'FOCUS_GUARD_AWAY', ms: 120_000 });
  assert.ok(save(state));

  const reloaded = load();
  assert.equal(reloaded.focusRuns[0].awayCount, 1);
  assert.equal(reloaded.focusRuns[0].awayMs, 120_000);

  // A v7 file has runs with no away fields at all.
  store.clear();
  store.set(
    'lockin.state.v1',
    JSON.stringify({
      schemaVersion: 7,
      focusRuns: [{ id: 'run_old', startedAt: 'x', outcome: 'completed' }],
      settings: {},
    }),
  );
  const migrated = load();
  assert.equal(migrated.focusRuns[0].awayCount, 0, 'no honest way to invent past away-time');
  assert.equal(migrated.focusRuns[0].awayMs, 0);
  assert.equal(migrated.settings.focusGuard, true);
  assert.equal(
    migrated.settings.blockingAsked,
    true,
    'an existing user has already seen the extension setup; asking again is nagging',
  );
});

/* ------------------------------------------------------------------ */
/* Quick add                                                           */
/* ------------------------------------------------------------------ */

// A Wednesday, so "friday" is two days out and unambiguous.
const WED = new Date(2026, 8, 2, 9, 0);
const T = (offset) => addDaysISO(todayISO(WED), offset);

test('a realistic line parses into every field', () => {
  const r = parseQuickAdd('chapter 7 math due friday 45m', WED);
  assert.equal(r.title, 'chapter 7 math');
  assert.equal(r.dueDate, T(2));
  assert.equal(r.estimatedMinutes, 45);
  assert.equal(r.subject, 'Math');
  assert.equal(r.priority, 'Normal');
});

test('unrecognised words are never swallowed', () => {
  const r = parseQuickAdd('finish the diorama thing', WED);
  assert.equal(r.title, 'finish the diorama thing', 'every word survives into the title');
  assert.equal(r.dueDate, '', 'and nothing is invented');
});

test('no date is a real answer, not a reason to guess one', () => {
  const r = parseQuickAdd('read chapter 4', WED);
  assert.equal(r.dueDate, '', 'undated work is real work; a fake deadline is worse than none');
  assert.equal(r.estimateInferred, true, 'and the estimate is marked as a guess');
});

test('durations parse in every form people write them', () => {
  const cases = [
    ['essay 45m', 45],
    ['essay 45min', 45],
    ['essay 45 minutes', 45],
    ['essay 1h', 60],
    ['essay 1.5h', 90],
    ['essay 2 hours', 120],
  ];
  for (const [input, minutes] of cases) {
    assert.equal(parseQuickAdd(input, WED).estimatedMinutes, minutes, input);
  }
  // Clamped: a typo must not create a 40-hour assignment.
  assert.ok(parseQuickAdd('essay 9999m', WED).estimatedMinutes <= 600);
  assert.ok(parseQuickAdd('essay 1m', WED).estimatedMinutes >= 5);
});

test('dates parse in every form people write them', () => {
  assert.equal(parseQuickAdd('x today', WED).dueDate, T(0));
  assert.equal(parseQuickAdd('x tomorrow', WED).dueDate, T(1));
  assert.equal(parseQuickAdd('x thursday', WED).dueDate, T(1));
  assert.equal(parseQuickAdd('x 2026-09-10', WED).dueDate, '2026-09-10');
  assert.equal(parseQuickAdd('x 9/10', WED).dueDate, '2026-09-10');
  assert.equal(parseQuickAdd('x 9/10/27', WED).dueDate, '2027-09-10');
});

test('a weekday name always means the next one, never a date in the past', () => {
  // Said on a Wednesday, "wednesday" means the coming Wednesday. A deadline
  // that has already passed is a worse guess than one a week out.
  assert.equal(parseQuickAdd('x wednesday', WED).dueDate, T(7));
});

test('an impossible date is refused rather than rolled over', () => {
  const r = parseQuickAdd('x 2/31', WED);
  assert.equal(r.dueDate, '', '2/31 must not silently become March 3rd');
  assert.equal(r.title, 'x 2/31', 'and the text stays visible so the student can see why');
});

test('times of day parse, and the default is the end of the day', () => {
  assert.equal(parseQuickAdd('x tomorrow 5pm', WED).dueTime, '17:00');
  assert.equal(parseQuickAdd('x tomorrow 11:30pm', WED).dueTime, '23:30');
  assert.equal(parseQuickAdd('x tomorrow 09:15', WED).dueTime, '09:15');
  assert.equal(
    parseQuickAdd('x tomorrow', WED).dueTime,
    '23:59',
    'no time means end of day — midnight would make it overdue all day',
  );
});

test('priority and platform are recognised without eating the title', () => {
  const urgent = parseQuickAdd('lab report science tomorrow !!', WED);
  assert.equal(urgent.priority, 'Urgent');
  assert.equal(urgent.title, 'lab report science');
  assert.equal(urgent.subject, 'Science', 'the subject word stays in the title, it reads better');

  const canvas = parseQuickAdd('essay canvas due friday', WED);
  assert.equal(canvas.platform, 'Canvas');
  assert.equal(canvas.title, 'essay');
});

test('an unknown subject is left blank rather than guessed', () => {
  const r = parseQuickAdd('woodshop birdhouse due friday', WED);
  assert.equal(r.subject, '', 'a wrong subject quietly changes planning; blank does not');
});

/* ---- capture asks for nothing but the words ---- */

test('the estimate is inferred from the kind of work, never demanded', () => {
  // Motion requires duration + date + time and is the app people call
  // exhausting. Sunsama never asks and falls back to a default. LockIn needs a
  // number for the planner, so it guesses a *differentiated* one: defaulting an
  // essay and a worksheet to the same 30 minutes makes the first plan visibly
  // wrong, which is how a student learns to distrust it.
  assert.equal(parseQuickAdd('history essay', WED).estimatedMinutes, 90);
  assert.equal(parseQuickAdd('math worksheet', WED).estimatedMinutes, 30);
  assert.equal(parseQuickAdd('read chapter 4', WED).estimatedMinutes, 45);
  assert.equal(parseQuickAdd('spanish vocab', WED).estimatedMinutes, 20);
  assert.equal(parseQuickAdd('some thing', WED).estimatedMinutes, DEFAULT_ESTIMATE_MINUTES);
  assert.equal(parseQuickAdd('history essay', WED).estimateSource, 'keyword');
  assert.equal(parseQuickAdd('some thing', WED).estimateSource, 'default');

  // A stated duration always wins, and says it was not a guess.
  const stated = parseQuickAdd('history essay 20m', WED);
  assert.equal(stated.estimatedMinutes, 20);
  assert.equal(stated.estimateInferred, false);
  assert.equal(stated.estimateSource, 'stated');
});

test('the estimate is learned from what this student actually spends', () => {
  const done = (subject, loggedMinutes) => ({
    ...createAssignment({
      title: 'past work',
      subject,
      platform: 'Other',
      dueDate: '',
      dueTime: '23:59',
      estimatedMinutes: 30,
      priority: 'Normal',
    }),
    status: 'Completed',
    loggedMinutes,
  });

  // Two finished assignments is not a pattern; the keyword guess still wins.
  const thin = { assignments: [done('Math', 100), done('Math', 110)], sessions: [] };
  assert.equal(parseQuickAdd('math worksheet', WED, thin).estimatedMinutes, 30);

  // Three is enough to beat a guess made from words.
  const real = {
    assignments: [done('Math', 100), done('Math', 110), done('Math', 120)],
    sessions: [],
  };
  assert.equal(
    parseQuickAdd('math worksheet', WED, real).estimatedMinutes,
    110,
    'their own median beats the keyword default',
  );
  // The UI says where the number came from out loud, so the label has to be
  // right: claiming "based on your Math work" with no Math history is a small
  // lie, and small lies about numbers cost trust in every other number.
  assert.equal(parseQuickAdd('math worksheet', WED, real).estimateSource, 'learned');
  assert.equal(parseQuickAdd('math worksheet', WED, thin).estimateSource, 'keyword');

  // The median, not the mean: one all-nighter must not move every estimate.
  const outlier = {
    assignments: [done('Math', 30), done('Math', 35), done('Math', 600)],
    sessions: [],
  };
  assert.equal(parseQuickAdd('math worksheet', WED, outlier).estimatedMinutes, 35);

  // And history for another subject is not evidence about this one.
  assert.equal(parseQuickAdd('english essay', WED, real).estimatedMinutes, 90);
});

test('every understood word is reported as a span, so the input can show it', () => {
  const input = 'bio lab report next tuesday 5pm 90m !!';
  const r = parseQuickAdd(input, WED);

  const kinds = r.spans.map((s) => s.kind).sort();
  assert.deepEqual(kinds, ['date', 'duration', 'priority', 'time']);

  // Spans must be in order, non-overlapping, and land on the real characters —
  // they are used to underline the text in place, so an off-by-one is visible.
  let cursor = 0;
  for (const span of r.spans) {
    assert.ok(span.start >= cursor, 'spans do not overlap');
    assert.ok(span.end > span.start && span.end <= input.length, 'spans stay inside the text');
    cursor = span.end;
  }
  assert.equal(input.slice(r.spans[0].start, r.spans[0].end), 'next tuesday');

  // Nothing claimed by a span survives into the title.
  for (const span of r.spans) {
    assert.ok(!r.title.includes(input.slice(span.start, span.end)));
  }
  assert.equal(r.title, 'bio lab report');
});

test('richer date phrasings all land on the right day', () => {
  assert.equal(parseQuickAdd('x next friday', WED).dueDate, T(9), 'next friday is the one after');
  assert.equal(parseQuickAdd('x this friday', WED).dueDate, T(2));
  assert.equal(parseQuickAdd('x sep 12', WED).dueDate, '2026-09-12');
  assert.equal(parseQuickAdd('x 12 sep', WED).dueDate, '2026-09-12');
  assert.equal(parseQuickAdd('x september 12th', WED).dueDate, '2026-09-12');
  assert.equal(parseQuickAdd('x 5 pm tomorrow', WED).dueTime, '17:00');
  // A bare month/day already past means next year — school crosses a year end.
  assert.equal(parseQuickAdd('x 1/5', WED).dueDate, '2027-01-05');
});

test('the parser is pure and total', () => {
  for (const input of ['', '   ', '!!', 'due', '45m', '\n\t', 'x'.repeat(500)]) {
    const r = parseQuickAdd(input, WED);
    assert.equal(typeof r.title, 'string');
    assert.ok(r.title.length <= 200);
    assert.ok(Number.isFinite(r.estimatedMinutes) && r.estimatedMinutes > 0);
    assert.ok(r.dueDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate));
    assert.match(r.dueTime, /^\d{2}:\d{2}$/);
  }
});

test('a parsed line makes a valid assignment through the real reducer', () => {
  const parsed = parseQuickAdd('chapter 7 math due friday 45m', WED);
  let state = defaultState();
  state = reducer(state, { type: 'CREATE_PROFILE', firstName: 'Sam' });

  state = reducer(state, {
    type: 'ADD_ASSIGNMENT',
    assignment: createAssignment({
      title: parsed.title,
      subject: parsed.subject,
      platform: parsed.platform,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      estimatedMinutes: parsed.estimatedMinutes,
      priority: parsed.priority,
    }),
  });

  const added = state.assignments[0];
  assert.equal(added.title, 'chapter 7 math');
  assert.equal(added.estimatedMinutes, 45);
  assert.equal(added.status, 'Not Started');
  assert.equal(added.loggedMinutes, 0);

  // And it survives storage, which is where a malformed date would surface.
  store.clear();
  assert.ok(save(state));
  assert.equal(load().assignments[0].title, 'chapter 7 math');
});
