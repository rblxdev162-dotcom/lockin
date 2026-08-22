/**
 * What state work is in, and what order to do it in.
 *
 * These are the rules the whole app sorts and labels by, so they are tested
 * where they live rather than through a screen. The interesting cases are the
 * distinctions that used to be flattened: graded versus submitted versus ticked
 * off, and missing versus merely overdue.
 *
 * Run: npm run test:worklist
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  WORK_STATE_LABEL,
  byUrgency,
  groupByClass,
  isContested,
  isHandInWork,
  isSettled,
  urgency,
  whatToDoNext,
  workStateOf,
} = await import('../../web/src/lib/workState.ts');
const { classGradesUrl, classSwitchLabel } = await import('../../web/src/lib/classNames.ts');

const NOW = Date.parse('2026-03-10T18:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const pad = (n) => String(n).padStart(2, '0');

function assignment(patch = {}) {
  const { dueIn, canvasStatus, submissionType, ...rest } = patch;
  const due = dueIn === null ? null : new Date(NOW + (dueIn ?? DAY));
  return {
    id: rest.id ?? 'a1',
    title: rest.title ?? 'Worksheet',
    subject: rest.subject ?? 'Biology',
    platform: 'Canvas',
    dueDate: due ? `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}` : '',
    dueTime: due ? `${pad(due.getHours())}:${pad(due.getMinutes())}` : '',
    estimatedMinutes: 30,
    loggedMinutes: 0,
    priority: 'Normal',
    status: 'Not Started',
    completionMethod: 'manual',
    createdAt: new Date(NOW - DAY).toISOString(),
    updatedAt: new Date(NOW - DAY).toISOString(),
    reminders: { firstReminderMinutes: 120, escalationMinutes: 60, focusWarningMinutes: 30, enabled: true },
    remindersFired: [],
    verificationStatus: 'not_required',
    verificationRecords: [],
    ...(canvasStatus
      ? {
          canvas: {
            domain: 'example.instructure.com',
            url: 'https://example.instructure.com/x',
            submissionStatus: canvasStatus,
            submissionType,
            lastCheckedAt: null,
            lastStatusChangeAt: null,
          },
        }
      : {}),
    ...rest,
  };
}


/* ------------------------------------------------------------------ */
/* Work Canvas can never see: paper homework                           */
/* ------------------------------------------------------------------ */

test('paper homework is never called Missing, because Canvas cannot know', () => {
  const paper = assignment({
    dueIn: -2 * DAY,
    canvasStatus: 'missing',
    submissionType: 'on_paper',
  });
  assert.equal(isHandInWork(paper), true);
  // Overdue is honest — the deadline really has passed. "Missing" would be
  // Canvas asserting nothing was handed in, which it has no way of knowing.
  assert.equal(workStateOf(paper, NOW), 'overdue');
});

test('and it stops sitting in the worst-trouble band above genuinely missing work', () => {
  const paper = assignment({
    id: 'paper',
    dueIn: -2 * DAY,
    canvasStatus: 'missing',
    submissionType: 'on_paper',
  });
  const reallyMissing = assignment({
    id: 'online',
    dueIn: -1 * HOUR,
    canvasStatus: 'missing',
    submissionType: 'online',
  });
  assert.deepEqual(
    byUrgency([paper, reallyMissing], NOW).map((a) => a.id),
    ['online', 'paper'],
  );
});

test('an online assignment Canvas calls missing is still missing', () => {
  const online = assignment({ dueIn: -DAY, canvasStatus: 'missing', submissionType: 'online' });
  assert.equal(isHandInWork(online), false);
  assert.equal(workStateOf(online, NOW), 'missing');
});

test('a page that never said how work is handed in changes nothing', () => {
  // The dangerous default. Unknown must behave exactly as before, never as
  // "on paper" (which would hide real missing work) and never as "online".
  const unknown = assignment({ dueIn: -DAY, canvasStatus: 'missing' });
  assert.equal(isHandInWork(unknown), false);
  assert.equal(workStateOf(unknown, NOW), 'missing');
});

test('paper homework the student finished is done, and is not contested', () => {
  const paper = assignment({
    dueIn: -DAY,
    canvasStatus: 'missing',
    submissionType: 'on_paper',
    status: 'Completed',
    completedAt: new Date(NOW).toISOString(),
  });
  assert.equal(workStateOf(paper, NOW), 'done');
  assert.equal(isContested(paper), false);
});

test('but online work marked done that Canvas says never arrived is contested', () => {
  const online = assignment({
    dueIn: -DAY,
    canvasStatus: 'missing',
    submissionType: 'online',
    status: 'Completed',
    completedAt: new Date(NOW).toISOString(),
  });
  // Still settled — a lagging gradebook does not un-complete work — but named.
  assert.equal(workStateOf(online, NOW), 'done');
  assert.equal(isSettled(workStateOf(online, NOW)), true);
  assert.equal(isContested(online), true);
});

/* ------------------------------------------------------------------ */
/* The distinctions the old list could not make                        */
/* ------------------------------------------------------------------ */

test('graded, submitted and ticked-off are three different states', () => {
  assert.equal(workStateOf(assignment({ canvasStatus: 'graded' }), NOW), 'graded');
  assert.equal(workStateOf(assignment({ canvasStatus: 'submitted' }), NOW), 'submitted');
  assert.equal(workStateOf(assignment({ canvasStatus: 'late_submitted' }), NOW), 'submitted');
  assert.equal(
    workStateOf(assignment({ status: 'Completed', completedAt: new Date(NOW).toISOString() }), NOW),
    'done',
  );
});

test('all three mean there is nothing left to do', () => {
  for (const state of ['graded', 'submitted', 'done']) assert.equal(isSettled(state), true);
  for (const state of ['missing', 'overdue', 'needs_sync', 'due_today', 'upcoming', 'undated']) {
    assert.equal(isSettled(state), false);
  }
});

test('Canvas saying "missing" outranks LockIn noticing a passed deadline', () => {
  // Both are late. Only one of them is the school's own assertion.
  assert.equal(workStateOf(assignment({ dueIn: -2 * DAY, canvasStatus: 'missing' }), NOW), 'missing');
  assert.equal(workStateOf(assignment({ dueIn: -2 * DAY }), NOW), 'overdue');
});

test('graded work stays graded even if its due date has passed', () => {
  const state = workStateOf(assignment({ dueIn: -5 * DAY, canvasStatus: 'graded' }), NOW);
  assert.equal(state, 'graded', 'LockIn must not contradict the source of truth');
});

test('a stale Canvas date is not called overdue until Canvas answers again', () => {
  const staleCanvas = assignment({
    dueIn: -DAY,
    source: {
      kind: 'CANVAS_CALENDAR',
      sourceId: 'canvas_calendar',
      lastSyncedAt: new Date(NOW - 3 * DAY).toISOString(),
      confidence: 'high',
      isLive: false,
      rawDataRetained: false,
    },
  });
  assert.equal(workStateOf(staleCanvas, NOW), 'needs_sync');

  const currentCanvas = {
    ...staleCanvas,
    source: { ...staleCanvas.source, lastSyncedAt: new Date(NOW - HOUR).toISOString() },
  };
  assert.equal(workStateOf(currentCanvas, NOW), 'overdue');
});

test('undated work has its own state rather than being called overdue', () => {
  assert.equal(workStateOf(assignment({ dueIn: null }), NOW), 'undated');
});

test('due today and upcoming are separated at the end of today', () => {
  assert.equal(workStateOf(assignment({ dueIn: 2 * HOUR }), NOW), 'due_today');
  assert.equal(workStateOf(assignment({ dueIn: 2 * DAY }), NOW), 'upcoming');
});

test('every state has a word, because none of them may be colour alone', () => {
  for (const state of ['graded', 'submitted', 'done', 'missing', 'overdue', 'needs_sync', 'due_today', 'upcoming', 'undated']) {
    assert.ok(WORK_STATE_LABEL[state]?.length > 0, `${state} has no label`);
  }
});

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

test('the order is missing, overdue, needs-sync, today, upcoming, undated, then settled', () => {
  const list = [
    assignment({ id: 'settled', canvasStatus: 'graded' }),
    assignment({ id: 'undated', dueIn: null }),
    assignment({ id: 'upcoming', dueIn: 3 * DAY }),
    assignment({ id: 'today', dueIn: 2 * HOUR }),
    assignment({
      id: 'needs-sync',
      dueIn: -HOUR,
      source: {
        kind: 'CANVAS_CALENDAR',
        sourceId: 'canvas_calendar',
        lastSyncedAt: new Date(NOW - 3 * DAY).toISOString(),
        confidence: 'high',
        isLive: false,
        rawDataRetained: false,
      },
    }),
    assignment({ id: 'overdue', dueIn: -DAY }),
    assignment({ id: 'missing', dueIn: -2 * DAY, canvasStatus: 'missing' }),
  ];
  assert.deepEqual(
    byUrgency(list, NOW).map((a) => a.id),
    ['missing', 'overdue', 'needs-sync', 'today', 'upcoming', 'undated', 'settled'],
  );
});

test('inside a band it is strictly chronological', () => {
  const list = [
    assignment({ id: 'later', dueIn: 5 * DAY }),
    assignment({ id: 'sooner', dueIn: 2 * DAY }),
    assignment({ id: 'middle', dueIn: 3 * DAY }),
  ];
  assert.deepEqual(
    byUrgency(list, NOW).map((a) => a.id),
    ['sooner', 'middle', 'later'],
  );
});

test('priority never beats a due date', () => {
  // The failure this prevents: an "Urgent" essay due next week sitting above
  // a "Normal" worksheet due in an hour.
  const list = [
    assignment({ id: 'urgent-next-week', priority: 'Urgent', dueIn: 7 * DAY }),
    assignment({ id: 'normal-in-an-hour', priority: 'Normal', dueIn: HOUR }),
  ];
  assert.deepEqual(
    byUrgency(list, NOW).map((a) => a.id),
    ['normal-in-an-hour', 'urgent-next-week'],
  );
});

test('the band always dominates the due time', () => {
  // An overdue item from a year ago still outranks something due in a minute.
  const ancient = assignment({ id: 'ancient', dueIn: -365 * DAY });
  const imminent = assignment({ id: 'imminent', dueIn: 60_000 });
  assert.ok(urgency(ancient, NOW) < urgency(imminent, NOW));
});

test('what to do next drops finished work rather than sorting it to the bottom', () => {
  const list = [
    assignment({ id: 'graded', canvasStatus: 'graded' }),
    assignment({ id: 'submitted', canvasStatus: 'submitted' }),
    assignment({ id: 'todo', dueIn: HOUR }),
  ];
  assert.deepEqual(
    whatToDoNext(list, NOW).map((a) => a.id),
    ['todo'],
  );
});

/* ------------------------------------------------------------------ */
/* Grouping by class                                                   */
/* ------------------------------------------------------------------ */

test('work groups by class, and the most urgent class comes first', () => {
  const list = [
    assignment({ id: 'art', subject: 'Art', dueIn: 5 * DAY }),
    assignment({ id: 'bio1', subject: 'Biology', dueIn: 2 * DAY }),
    assignment({ id: 'bio2', subject: 'Biology', dueIn: -DAY }),
    assignment({ id: 'math', subject: 'Math', dueIn: 3 * HOUR }),
  ];
  const groups = groupByClass(list, NOW);

  assert.deepEqual(
    groups.map((g) => g.subject),
    ['Biology', 'Math', 'Art'],
    'the column you need first should be the one on the left',
  );
  // And within a class, the same urgency order.
  assert.deepEqual(
    groups[0].assignments.map((a) => a.id),
    ['bio2', 'bio1'],
  );
});

test('a class with nothing outstanding sorts last', () => {
  const list = [
    assignment({ id: 'done-early', subject: 'History', dueIn: -10 * DAY, canvasStatus: 'graded' }),
    assignment({ id: 'todo', subject: 'Math', dueIn: 5 * DAY }),
  ];
  assert.deepEqual(
    groupByClass(list, NOW).map((g) => g.subject),
    ['Math', 'History'],
  );
});

test('work with no class is grouped rather than dropped', () => {
  const groups = groupByClass([assignment({ subject: '' })], NOW);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].subject, 'No class');
});

test('grouping is stable when two classes are equally urgent', () => {
  const list = [
    assignment({ id: 'z', subject: 'Zoology', dueIn: DAY }),
    assignment({ id: 'a', subject: 'Algebra', dueIn: DAY }),
  ];
  assert.deepEqual(
    groupByClass(list, NOW).map((g) => g.subject),
    ['Algebra', 'Zoology'],
    'a tie falls back to the name so columns do not shuffle between renders',
  );
});

test('class switch labels surface the teacher or useful course name', () => {
  assert.equal(classSwitchLabel('Per 2 — Emmett'), 'Emmett');
  assert.equal(classSwitchLabel('El/B/O — Chopra'), 'Chopra');
  assert.equal(classSwitchLabel('Period 1 & 4: ACC Math'), 'ACC Math');
  assert.equal(classSwitchLabel('AP US History'), 'AP US History');
});

test('the class Grades link is navigation on the configured Canvas host, never an API URL', () => {
  assert.equal(
    classGradesUrl(
      'https://school.instructure.com/courses/123/assignments/456',
      'school.instructure.com',
    ),
    'https://school.instructure.com/courses/123/grades',
  );
  assert.equal(
    classGradesUrl('https://other.instructure.com/courses/123/assignments/456', 'school.instructure.com'),
    null,
  );
  assert.equal(classGradesUrl('https://school.instructure.com/api/v1/courses/123', 'school.instructure.com'), null);
});
