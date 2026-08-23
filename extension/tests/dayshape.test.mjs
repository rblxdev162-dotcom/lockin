/**
 * The shape of a day: school, weekend, day off — and where the homework part
 * of it actually is.
 *
 * The rules under test are the ones a student would notice being wrong:
 * a Saturday must not be drawn as a school day, "Chill weekend" must be
 * reachable, a suggestion must never land on top of a break the student
 * listed, and an unconfigured schedule must produce nothing at all rather
 * than an invented timetable.
 *
 * Run: npm run test:dayshape
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { dayShapeOf, workloadMinutes, formatClock, formatDuration } = await import(
  '../../web/src/lib/dayShape.ts'
);
const { defaultSchoolSchedule, normalizeSchoolSchedule, schoolHoursFrom } = await import(
  '../../web/src/lib/schoolSchedule.ts'
);

/** Wednesday 2026-08-19, and the Saturday of that week. */
const WEDNESDAY = (h, m = 0) => new Date(2026, 7, 19, h, m);
const SATURDAY = (h, m = 0) => new Date(2026, 7, 22, h, m);

const schedule = (patch = {}) => ({
  ...defaultSchoolSchedule(),
  configured: true,
  schoolStart: '07:30',
  schoolEnd: '15:30',
  schoolDays: [1, 2, 3, 4, 5],
  ...patch,
});

const CANVAS_WINDOW = { schoolDays: [1, 2, 3, 4, 5], schoolDayStart: 15 * 60 + 30, freeDayStart: 9 * 60 };

function assignment(patch = {}) {
  const now = new Date().toISOString();
  return {
    id: patch.id ?? 'a1',
    title: 'Worksheet',
    subject: 'Science',
    platform: 'Canvas',
    dueDate: '2026-08-19',
    dueTime: '23:59',
    estimatedMinutes: 60,
    loggedMinutes: 0,
    priority: 'Normal',
    status: 'Not Started',
    completionMethod: 'manual',
    createdAt: now,
    updatedAt: now,
    reminders: { firstReminderMinutes: 120, escalationMinutes: 60, focusWarningMinutes: 30, enabled: true },
    remindersFired: [],
    verificationStatus: 'not_required',
    verificationRecords: [],
    steps: [],
    ...patch,
  };
}

/* ------------------------------------------------------------------ */
/* It refuses to invent a day                                          */
/* ------------------------------------------------------------------ */

test('an unconfigured schedule produces no day shape at all', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: defaultSchoolSchedule(),
    canvasWindow: null,
    assignments: [],
  });
  assert.equal(shape, null, 'a made-up school day is worse than no rail');
});

test('the Canvas window can supply the day when the schedule was never filled in', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: defaultSchoolSchedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
  });
  assert.equal(shape?.kind, 'school');
});

/* ------------------------------------------------------------------ */
/* Weekends                                                            */
/* ------------------------------------------------------------------ */

test('a Saturday is a weekend, not a school day with nobody in it', () => {
  const shape = dayShapeOf({
    now: SATURDAY(11),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
  });
  assert.equal(shape.kind, 'weekend');
  assert.equal(shape.headline, 'Chill weekend');
  assert.equal(
    shape.blocks.some((block) => block.kind === 'school'),
    false,
    'no school block on a day with no school',
  );
  assert.equal(
    shape.blocks.some((block) => block.recommended),
    false,
    'nothing is due, so nothing is suggested',
  );
});

test('a weekend with work waiting says so instead of pretending it is chill', () => {
  const shape = dayShapeOf({
    now: SATURDAY(11),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    // Due Saturday itself.
    assignments: [assignment({ dueDate: '2026-08-22', estimatedMinutes: 90 })],
  });
  assert.equal(shape.kind, 'weekend');
  assert.match(shape.headline, /work waiting/i);
  assert.equal(shape.suggestedMinutes, 90);
  assert.equal(shape.blocks.some((block) => block.recommended), true);
});

test('a weekend the student planned as a study day is respected, even with nothing due', () => {
  const availability = [
    { weekday: 6, available: true, startTime: '10:00', endTime: '18:00', maxMinutes: 180, restDay: false },
  ];
  const shape = dayShapeOf({
    now: SATURDAY(11),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
    availability,
    plannerConfigured: true,
  });
  assert.equal(shape.headline, 'Weekend');
  assert.match(shape.detail, /study day/i);
});

test('a rest day is not a study day', () => {
  const availability = [
    { weekday: 6, available: true, startTime: '10:00', endTime: '18:00', maxMinutes: 180, restDay: true },
  ];
  const shape = dayShapeOf({
    now: SATURDAY(11),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
    availability,
    plannerConfigured: true,
  });
  assert.equal(shape.headline, 'Chill weekend');
});

test('a marked no-school weekday is a day off, not a weekend and not school', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(11),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
    noSchoolDates: ['2026-08-19'],
  });
  assert.equal(shape.kind, 'day_off');
  assert.equal(shape.headline, 'Day off');
});

test('a student with no Friday classes has a free Friday', () => {
  const shape = dayShapeOf({
    now: new Date(2026, 7, 21, 11),
    schedule: schedule({ schoolDays: [1, 2, 3, 4] }),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
  });
  assert.equal(shape.kind, 'weekend', 'a day school does not happen on is a free day');
});


test('the shipped planner default cannot claim a weekend was planned', () => {
  // Every day is "available" until the student configures the planner, so
  // without the configured flag "Chill weekend" would be unreachable.
  const shape = dayShapeOf({
    now: SATURDAY(11),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
    availability: [
      { weekday: 6, available: true, startTime: '10:00', endTime: '18:00', maxMinutes: 180, restDay: false },
    ],
    plannerConfigured: false,
  });
  assert.equal(shape.headline, 'Chill weekend');
});

/* ------------------------------------------------------------------ */
/* School days, in real clock time                                     */
/* ------------------------------------------------------------------ */

test('a school day starts with school and then three-hour blocks to midnight', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
  });
  assert.equal(shape.kind, 'school');
  assert.equal(shape.blocks[0].kind, 'school');
  assert.equal(shape.blocks[0].start, 7 * 60 + 30);
  assert.equal(shape.blocks[0].end, 15 * 60 + 30);

  const evening = shape.blocks.slice(1);
  assert.deepEqual(
    evening.map((block) => [block.start, block.end]),
    [
      [15 * 60 + 30, 18 * 60 + 30],
      [18 * 60 + 30, 21 * 60 + 30],
      [21 * 60 + 30, 24 * 60],
    ],
  );
  assert.equal(evening[0].label, '3:30pm – 6:30pm');
  assert.equal(evening.at(-1).label, '9:30pm – 12am');
});

test('the block holding the current time is the current one, and only that one', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(19),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
  });
  const current = shape.blocks.filter((block) => block.current);
  assert.equal(current.length, 1);
  assert.equal(current[0].start, 18 * 60 + 30);
});

test('how much is suggested follows how close the work is', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [
      assignment({ id: 'today', dueDate: '2026-08-19', estimatedMinutes: 60 }),
      // Tomorrow counts at half weight: real, but not tonight's emergency.
      assignment({ id: 'tomorrow', dueDate: '2026-08-20', estimatedMinutes: 60 }),
      // Next week is not tonight's problem at all.
      assignment({ id: 'later', dueDate: '2026-08-28', estimatedMinutes: 200 }),
    ],
  });
  assert.equal(shape.suggestedMinutes, 90);
  // 90 minutes fits inside the first evening block, so only it is suggested.
  const suggested = shape.blocks.filter((block) => block.recommended);
  assert.equal(suggested.length, 1);
  assert.equal(suggested[0].start, 15 * 60 + 30);
});

test('work already logged is not suggested twice', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [assignment({ estimatedMinutes: 60, loggedMinutes: 45 })],
  });
  assert.equal(shape.suggestedMinutes, 15);
});

test('a completed assignment suggests nothing, however close its deadline', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [assignment({ status: 'Completed', completedAt: new Date().toISOString() })],
  });
  assert.equal(shape.suggestedMinutes, 0);
  assert.match(shape.detail, /getting ahead/i);
});

test('nobody is asked for six hours', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: Array.from({ length: 12 }, (_, index) =>
      assignment({ id: `a${index}`, estimatedMinutes: 120 }),
    ),
  });
  assert.equal(shape.suggestedMinutes, 4 * 60, 'the suggestion is capped, not honest-to-a-fault');
});

test('a break the student listed is never suggested, and pushes work around it', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule({
      breaks: [{ id: 'dinner', label: 'Dinner', start: '17:00', end: '18:00', days: [1, 2, 3, 4, 5] }],
    }),
    canvasWindow: CANVAS_WINDOW,
    assignments: [assignment({ estimatedMinutes: 150 })],
  });
  const dinner = shape.blocks.find((block) => block.kind === 'break');
  assert.ok(dinner, 'the break is its own block');
  assert.equal(dinner.label, 'Dinner');
  assert.equal(dinner.recommended, false, 'LockIn does not suggest working through dinner');
  // 150 minutes: 90 before dinner, the rest after.
  const suggested = shape.blocks.filter((block) => block.recommended);
  assert.equal(suggested.length, 2);
  assert.equal(suggested[0].end, 17 * 60);
});

test('before the last bell, the day says when homework time starts', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(9),
    schedule: schedule(),
    canvasWindow: CANVAS_WINDOW,
    assignments: [assignment({ estimatedMinutes: 45 })],
  });
  assert.equal(shape.headline, 'School day');
  assert.match(shape.detail, /starts at 3:30pm/);
});

test('the marker sits inside the strip, never outside it', () => {
  for (const hour of [0, 7, 12, 15, 23]) {
    const shape = dayShapeOf({
      now: WEDNESDAY(hour),
      schedule: schedule(),
      canvasWindow: CANVAS_WINDOW,
      assignments: [],
    });
    assert.ok(shape.markerPercent >= 0 && shape.markerPercent <= 100, `hour ${hour}`);
  }
});

/* ------------------------------------------------------------------ */
/* Schedules that do not make sense                                    */
/* ------------------------------------------------------------------ */

test('an end time of midnight does not make the whole day homework hours', () => {
  // The sharp version of this bug is in blocking, not the rail: minutesOfDay
  // ('00:00') is 0, so homework hours would begin at midnight and automatic
  // blocking would run straight through school.
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule({ schoolEnd: '00:00' }),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
  });
  assert.equal(shape.homeworkFrom, 15 * 60 + 30, 'it falls back to the Canvas window');
  assert.equal(
    shape.blocks.every((block) => block.end > block.start),
    true,
    'no empty or backwards blocks',
  );
});

test('a school day that ends before it starts is refused, not drawn', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule({ schoolStart: '15:00', schoolEnd: '07:00' }),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
  });
  assert.equal(shape.homeworkFrom, 15 * 60 + 30);
  assert.equal(shape.blocks.every((block) => block.end > block.start), true);
});

test('school hours are not used at all when they are incoherent', () => {
  // Before this, `until <= from` produced hours that matched no moment, so
  // "school is happening" was never true and the school-hours pause silently
  // stopped protecting a student who typed their times in the wrong order.
  const hours = schoolHoursFrom(schedule({ schoolStart: '15:00', schoolEnd: '07:00' }), {
    schoolDays: [1, 2, 3, 4, 5],
    schoolDayFrom: 7 * 60 + 30,
    schoolDayStart: 15 * 60 + 30,
  });
  assert.equal(hours.from, 7 * 60 + 30, 'the Canvas window answers instead');
  assert.equal(hours.until, 15 * 60 + 30);
  assert.ok(hours.until > hours.from);
});

test('a break that swallows the evening leaves no one-minute homework slot', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule({
      breaks: [{ id: 'shift', label: 'Work shift', start: '15:30', end: '23:59', days: [1, 2, 3, 4, 5] }],
    }),
    canvasWindow: CANVAS_WINDOW,
    assignments: [assignment({ estimatedMinutes: 120 })],
  });
  const sliver = shape.blocks.find((block) => block.end - block.start < 15);
  assert.ok(sliver, 'the last minute of the day is still shown');
  assert.equal(sliver.kind, 'free');
  assert.equal(sliver.recommended, false, 'one minute is not a slot for two hours of work');
});

test('overlapping breaks produce blocks, not fragments of blocks', () => {
  const shape = dayShapeOf({
    now: WEDNESDAY(16),
    schedule: schedule({
      breaks: [
        { id: 'b1', label: 'A', start: '16:00', end: '18:00', days: [1, 2, 3, 4, 5] },
        { id: 'b2', label: 'B', start: '17:00', end: '19:00', days: [1, 2, 3, 4, 5] },
      ],
    }),
    canvasWindow: CANVAS_WINDOW,
    assignments: [],
  });
  assert.equal(shape.blocks.every((block) => block.end > block.start), true);
  for (const block of shape.blocks) {
    if (block.kind === 'homework') {
      assert.ok(block.end - block.start >= 15, `${block.label} is too small to be a block`);
    }
  }
  // Blocks are contiguous and ordered: no gaps, no overlaps.
  for (let i = 1; i < shape.blocks.length; i += 1) {
    assert.equal(shape.blocks[i].start, shape.blocks[i - 1].end, 'blocks tile the day');
  }
});

/* ------------------------------------------------------------------ */
/* The pieces underneath                                               */
/* ------------------------------------------------------------------ */

test('clock formatting reads like a person wrote it', () => {
  assert.equal(formatClock(15 * 60 + 30), '3:30pm');
  assert.equal(formatClock(9 * 60), '9am');
  assert.equal(formatClock(12 * 60), '12pm');
  assert.equal(formatClock(0), '12am');
  assert.equal(formatClock(24 * 60), 'midnight');
});

test('durations read like a person wrote them', () => {
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(60), '1 hour');
  assert.equal(formatDuration(150), '2 h 30 min');
});

test('undated work is not counted as close', () => {
  assert.equal(
    workloadMinutes([assignment({ dueDate: '', dueTime: '' })], WEDNESDAY(16)),
    0,
    'no due date means no claim about urgency',
  );
});

/* ------------------------------------------------------------------ */
/* The migration off per-class meeting days                            */
/* ------------------------------------------------------------------ */

test('a schedule stored before school days existed keeps the days its classes met', () => {
  const migrated = normalizeSchoolSchedule({
    configured: true,
    schoolStart: '08:00',
    schoolEnd: '15:00',
    classes: [
      { id: 'c1', name: 'Math', days: [1, 3], color: 'brand', icon: 'M' },
      { id: 'c2', name: 'Art', days: [3, 5], color: 'mint', icon: 'A' },
    ],
  });
  assert.deepEqual(migrated.schoolDays, [1, 3, 5]);
});

test('and a schedule with no classes at all still has a normal week', () => {
  const migrated = normalizeSchoolSchedule({ configured: true, classes: [] });
  assert.deepEqual(migrated.schoolDays, [1, 2, 3, 4, 5]);
});

/* ------------------------------------------------------------------ */
/* Getting the Companion, from wherever the page is served             */
/* ------------------------------------------------------------------ */

const { companionInstallGuide, EXTENSION_DOWNLOAD_URL } = await import(
  '../../web/src/lib/downloads.ts'
);

test('on the local service the steps point at the repo folder, not a download', () => {
  const guide = companionInstallGuide('localhost:5173');
  assert.equal(guide.download, false);
  assert.match(guide.steps.at(-2).body, /lockin\/extension/);
  assert.match(guide.steps.at(-1).body, /localhost:5173/, 'it names the address it is built for');
});

test('on a published site the first step is the download built for that site', () => {
  const guide = companionInstallGuide('rblxdev162-dotcom.github.io');
  assert.equal(guide.download, true);
  assert.match(guide.steps[0].title, /download/i);
  assert.match(
    guide.steps[0].body,
    /cannot see this site/i,
    'the one-origin rule is stated where it bites',
  );
  assert.match(guide.steps[0].body, /rblxdev162-dotcom\.github\.io/);
});

test('127.0.0.1 counts as local too', () => {
  assert.equal(companionInstallGuide('127.0.0.1:5173').download, false);
});

test('the download is a relative path, so it works from any address', () => {
  assert.equal(EXTENSION_DOWNLOAD_URL.startsWith('/'), true);
  assert.equal(/^https?:/.test(EXTENSION_DOWNLOAD_URL), false);
});

/* ------------------------------------------------------------------ */
/* Classes adopted from Canvas                                         */
/* ------------------------------------------------------------------ */

const { withCanvasClasses } = await import('../../web/src/lib/schoolSchedule.ts');

test('a Canvas-linked assignment gives its class a place in the schedule', () => {
  const next = withCanvasClasses(schedule(), [
    { subject: 'Biology 1 - P3', canvas: { courseName: 'Biology 1 - P3' } },
    { subject: 'Per 2 — Emmett', externalCourseId: '404' },
  ]);
  assert.deepEqual(next.classes.map((item) => item.name), ['Biology 1 - P3', 'Per 2 — Emmett']);
  assert.deepEqual(next.classes[0].days, [1, 2, 3, 4, 5]);
});

test('hand-typed work does not create classes, because a parser guess is not evidence', () => {
  const next = withCanvasClasses(schedule(), [{ subject: 'Science' }]);
  assert.deepEqual(next.classes, []);
});

test('a class the student renamed is never rewritten, and nothing is duplicated', () => {
  const first = withCanvasClasses(schedule(), [{ subject: 'Math', externalCourseId: '1' }]);
  const renamed = {
    ...first,
    classes: [{ ...first.classes[0], name: 'Math', icon: '🧮', color: 'rose' }],
  };
  const again = withCanvasClasses(renamed, [
    { subject: 'Math', externalCourseId: '1' },
    { subject: 'math', externalCourseId: '1' },
  ]);
  assert.equal(again.classes.length, 1);
  assert.equal(again.classes[0].icon, '🧮');
  assert.equal(again.classes[0].color, 'rose');
});

test('an unchanged schedule is returned as-is, so nothing re-renders for nothing', () => {
  const start = schedule();
  assert.equal(withCanvasClasses(start, []), start);
});
