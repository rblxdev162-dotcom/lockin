/**
 * The Smart Study Planner's pure logic, against the shipping engine.
 *
 * These import `web/src/lib/planner/*.ts` directly (see ts-resolve.mjs), so
 * they test the code the app runs rather than a copy that could drift.
 *
 * The tests worth reading first are the ones that would let a bad plan look
 * fine: that unfinished minutes are never lost, that capacity is never
 * exceeded, that nothing is scheduled after its deadline, and that shuffling
 * the input arrays cannot change the schedule.
 *
 * Run: npm run test:planner-logic
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { generatePlan, computeChunk } = await import('../../web/src/lib/planner/engine.ts');
const { buildCapacity, capacityFor, subtractWindows, windowsForDate } = await import(
  '../../web/src/lib/planner/capacity.ts'
);
const { subjectFactors, effectiveFactor, MIN_SAMPLES } = await import(
  '../../web/src/lib/planner/estimation.ts'
);
const { examSpacing, examStudyEstimate, lastStudyDate, MATERIAL_STUDY_MINUTES } = await import(
  '../../web/src/lib/planner/exams.ts'
);
const { urgencyScore } = await import('../../web/src/lib/planner/priorities.ts');
const { annotatePlan, diffPlans, missedWork } = await import(
  '../../web/src/lib/planner/reschedule.ts'
);
const { explainItem, explainWarning } = await import(
  '../../web/src/lib/planner/explanations.ts'
);
const { defaultPlannerSettings } = await import('../../web/src/types/planner.ts');
const { addDaysISO, todayISO } = await import('../../web/src/lib/time.ts');

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Monday 17 August 2026, 4:00 PM local — the start of a normal school week. */
const MONDAY = () => new Date(2026, 7, 17, 16, 0, 0, 0);
const D = (offset, from = MONDAY()) => addDaysISO(todayISO(from), offset);

function assignment(over = {}) {
  return {
    id: over.id ?? 'a1',
    title: over.title ?? 'Math Worksheet',
    subject: over.subject ?? 'Math',
    platform: 'Other',
    dueDate: over.dueDate ?? D(1),
    dueTime: over.dueTime ?? '23:59',
    estimatedMinutes: over.estimatedMinutes ?? 60,
    priority: over.priority ?? 'Normal',
    status: over.status ?? 'Not Started',
    completionMethod: 'manual',
    createdAt: over.createdAt ?? '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    completedAt: over.completedAt,
    loggedMinutes: over.loggedMinutes ?? 0,
    reminders: {
      firstReminderMinutes: 120,
      escalationMinutes: 60,
      focusWarningMinutes: 30,
      enabled: true,
    },
    remindersFired: [],
    verificationStatus: 'not_required',
    verificationRecords: [],
    ...(over.canvas ? { canvas: over.canvas } : {}),
  };
}

function exam(over = {}) {
  return {
    id: over.id ?? 'e1',
    name: over.name ?? 'Biology Exam',
    subject: over.subject ?? 'Biology',
    examDate: over.examDate ?? D(4),
    materialAmount: over.materialAmount ?? 'Medium',
    createdAt: over.createdAt ?? '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    studyEstimateMinutes: over.studyEstimateMinutes,
    confidenceLevel: over.confidenceLevel,
    loggedMinutes: over.loggedMinutes ?? 0,
  };
}

function session(over = {}) {
  return {
    id: over.id ?? 's1',
    assignmentId: over.assignmentId ?? null,
    examId: over.examId ?? null,
    assignmentTitle: null,
    plannedMinutes: over.plannedMinutes ?? 30,
    actualMinutes: over.actualMinutes ?? 30,
    startedAt: over.endedAt ?? '2026-08-17T16:00:00.000Z',
    endedAt: over.endedAt ?? '2026-08-17T16:30:00.000Z',
  };
}

function settingsWith(patch = {}) {
  return { ...defaultPlannerSettings(), configured: true, ...patch };
}

function plan(over = {}) {
  return generatePlan({
    now: over.now ?? MONDAY(),
    assignments: over.assignments ?? [],
    exams: over.exams ?? [],
    completedSessions: over.completedSessions ?? [],
    settings: over.settings ?? settingsWith(),
    skips: over.skips ?? [],
    manualOrders: over.manualOrders ?? [],
    lockedDates: over.lockedDates ?? [],
    acceptedSubjectFactors: over.acceptedSubjectFactors ?? [],
    previousPlan: over.previousPlan ?? null,
    reason: over.reason ?? 'initial',
    planVersion: over.planVersion ?? 1,
  });
}

const allItems = (p) => p.days.flatMap((d) => d.items);
const itemsOf = (p, sourceId) => allItems(p).filter((i) => i.sourceId === sourceId);
const minutesOf = (p, sourceId) =>
  itemsOf(p, sourceId).reduce((sum, i) => sum + i.plannedMinutes, 0);
const dayOf = (p, date) => p.days.find((d) => d.date === date);
const totalPlanned = (p) => p.days.reduce((sum, d) => sum + d.plannedMinutes, 0);
const warningKinds = (p) => p.warnings.map((w) => w.kind);

/* ================================================================== */
/* Basic                                                              */
/* ================================================================== */

test('1. a single assignment is scheduled', () => {
  const p = plan({ assignments: [assignment({ estimatedMinutes: 45 })] });
  assert.equal(minutesOf(p, 'a1'), 45);
  assert.equal(p.unscheduledMinutes, 0);
});

test('2. several assignments all get time, and the day is shared out', () => {
  const p = plan({
    assignments: [
      assignment({ id: 'a1', estimatedMinutes: 45, dueDate: D(2) }),
      assignment({ id: 'a2', title: 'Essay', subject: 'English', estimatedMinutes: 45, dueDate: D(2) }),
      assignment({ id: 'a3', title: 'Lab', subject: 'Science', estimatedMinutes: 45, dueDate: D(3) }),
    ],
  });
  for (const id of ['a1', 'a2', 'a3']) assert.ok(minutesOf(p, id) > 0, `${id} scheduled`);
  const today = dayOf(p, D(0));
  assert.ok(new Set(today.items.map((i) => i.sourceId)).size >= 2, 'more than one task today');
});

test('3. no assignments produces an empty but well-formed plan', () => {
  const p = plan();
  assert.equal(allItems(p).length, 0);
  assert.equal(p.unscheduledMinutes, 0);
  assert.equal(p.days.length, defaultPlannerSettings().horizonDays);
  assert.equal(p.planningHorizonStart, D(0));
});

test('4. completed assignments are ignored entirely', () => {
  const p = plan({
    assignments: [assignment({ status: 'Completed', completedAt: '2026-08-16T10:00:00.000Z' })],
  });
  assert.equal(allItems(p).length, 0);
});

test('5. an overdue assignment is scheduled today and flagged overdue', () => {
  const p = plan({ assignments: [assignment({ dueDate: D(-2), estimatedMinutes: 40 })] });
  const items = itemsOf(p, 'a1');
  assert.equal(items[0].scheduledDate, D(0));
  assert.ok(items[0].reason.codes.includes('overdue'));
});

test('6. work due today is scheduled today', () => {
  const p = plan({ assignments: [assignment({ dueDate: D(0), estimatedMinutes: 40 })] });
  assert.equal(itemsOf(p, 'a1')[0].scheduledDate, D(0));
  assert.ok(itemsOf(p, 'a1')[0].reason.codes.includes('due_today'));
});

test('7. work due tomorrow may start today and never lands after tomorrow', () => {
  const p = plan({ assignments: [assignment({ dueDate: D(1), estimatedMinutes: 90 })] });
  const items = itemsOf(p, 'a1');
  assert.ok(items.length >= 2, 'split into chunks');
  for (const item of items) assert.ok(item.scheduledDate <= D(1));
  assert.equal(minutesOf(p, 'a1'), 90);
});

/* ================================================================== */
/* Capacity                                                           */
/* ================================================================== */

test('8. no day is ever planned beyond its capacity', () => {
  const p = plan({
    assignments: Array.from({ length: 8 }, (_, i) =>
      assignment({ id: `a${i}`, title: `Task ${i}`, estimatedMinutes: 120, dueDate: D(6) }),
    ),
  });
  for (const day of p.days) {
    assert.ok(
      day.plannedMinutes <= day.capacityMinutes,
      `${day.date}: ${day.plannedMinutes} > ${day.capacityMinutes}`,
    );
  }
});

test('9. the buffer is respected — capacity is below raw availability', () => {
  const s = settingsWith({
    bufferPercent: 20,
    weekdayMaxMinutes: 600,
    workloadPreference: 'Intensive',
    // The per-day ceiling is raised too, so this measures the buffer alone.
    availability: defaultPlannerSettings().availability.map((row) => ({ ...row, maxMinutes: 600 })),
  });
  const capacity = capacityFor(180, 1, s);
  assert.equal(capacity, 144, '20% of 180 held back');
  const p = plan({ settings: s, assignments: [assignment({ estimatedMinutes: 600, dueDate: D(1) })] });
  const today = dayOf(p, D(0));
  assert.ok(today.plannedMinutes <= today.availableMinutes * 0.8 + 1);
});

test('10. an unavailable day gets nothing', () => {
  const s = settingsWith({
    availability: defaultPlannerSettings().availability.map((row) =>
      row.weekday === 2 ? { ...row, available: false } : row,
    ),
  });
  const p = plan({ settings: s, assignments: [assignment({ estimatedMinutes: 600, dueDate: D(6) })] });
  const tuesday = dayOf(p, D(1));
  assert.equal(tuesday.capacityMinutes, 0);
  assert.equal(tuesday.items.length, 0);
});

test('11. partial-day availability caps the day', () => {
  const s = settingsWith({
    bufferPercent: 0,
    workloadPreference: 'Intensive',
    availability: defaultPlannerSettings().availability.map((row) =>
      row.weekday === 1 ? { ...row, startTime: '16:00', endTime: '17:00', maxMinutes: 600 } : row,
    ),
  });
  const p = plan({ settings: s, assignments: [assignment({ estimatedMinutes: 600, dueDate: D(6) })] });
  assert.equal(dayOf(p, D(0)).availableMinutes, 60);
  assert.ok(dayOf(p, D(0)).plannedMinutes <= 60);
});

test('12. a fixed block is carved out of the day', () => {
  const s = settingsWith({
    bufferPercent: 0,
    workloadPreference: 'Intensive',
    weekdayMaxMinutes: 600,
    fixedBlocks: [
      { id: 'b1', weekday: 1, label: 'Soccer', startTime: '18:00', endTime: '19:30' },
    ],
  });
  const windows = windowsForDate(D(0), s, MONDAY());
  assert.deepEqual(
    windows.map((w) => [w.start, w.end]),
    [
      [16 * 60, 18 * 60],
      [19 * 60 + 30, 20 * 60],
    ],
  );
  const p = plan({ settings: s, assignments: [assignment({ estimatedMinutes: 600, dueDate: D(6) })] });
  const today = dayOf(p, D(0));
  assert.equal(today.availableMinutes, 150);
  for (const item of today.items) {
    if (!item.startTime) continue;
    assert.ok(!(item.startTime >= '18:00' && item.startTime < '19:30'), 'nothing starts in the block');
  }
});

test('13. a rest day stays empty', () => {
  const s = settingsWith({
    availability: defaultPlannerSettings().availability.map((row) =>
      row.weekday === 0 ? { ...row, restDay: true } : row,
    ),
  });
  const p = plan({
    settings: s,
    assignments: [assignment({ estimatedMinutes: 900, dueDate: D(10) })],
  });
  const sunday = p.days.find((d) => d.restDay);
  assert.ok(sunday, 'a rest day exists in the horizon');
  assert.equal(sunday.items.length, 0);
  assert.equal(sunday.capacityMinutes, 0);
});

test('13b. a rest day is never used silently — the shortfall says so', () => {
  const s = settingsWith({
    weekdayMaxMinutes: 30,
    weekendMaxMinutes: 30,
    availability: defaultPlannerSettings().availability.map((row) =>
      row.weekday === 0 ? { ...row, restDay: true } : row,
    ),
  });
  const p = plan({
    settings: s,
    assignments: [assignment({ estimatedMinutes: 600, dueDate: D(7) })],
  });
  assert.ok(p.unscheduledMinutes > 0);
  assert.ok(warningKinds(p).includes('rest_day_used'));
});

/* ================================================================== */
/* Chunking                                                           */
/* ================================================================== */

test('14. a large assignment is split across days', () => {
  const p = plan({ assignments: [assignment({ estimatedMinutes: 240, dueDate: D(5) })] });
  const items = itemsOf(p, 'a1');
  assert.ok(items.length >= 4, `expected several chunks, got ${items.length}`);
  assert.equal(new Set(items.map((i) => i.scheduledDate)).size >= 3, true);
  assert.equal(minutesOf(p, 'a1'), 240);
});

test('15. a tiny assignment is not over-split', () => {
  const p = plan({ assignments: [assignment({ estimatedMinutes: 10, dueDate: D(3) })] });
  const items = itemsOf(p, 'a1');
  assert.equal(items.length, 1);
  assert.equal(items[0].plannedMinutes, 10);
});

test('16. chunks never fall below the minimum unless the work itself is shorter', () => {
  const s = settingsWith({ minChunkMinutes: 20, maxChunkMinutes: 40 });
  const p = plan({
    settings: s,
    assignments: [
      assignment({ id: 'a1', estimatedMinutes: 95, dueDate: D(5) }),
      assignment({ id: 'a2', title: 'Short', estimatedMinutes: 8, dueDate: D(5) }),
    ],
  });
  for (const item of itemsOf(p, 'a1')) assert.ok(item.plannedMinutes >= 20, `${item.plannedMinutes}`);
  assert.equal(itemsOf(p, 'a2')[0].plannedMinutes, 8);
});

test('17. chunks never exceed the maximum', () => {
  const s = settingsWith({ maxChunkMinutes: 30, minChunkMinutes: 10 });
  const p = plan({ settings: s, assignments: [assignment({ estimatedMinutes: 200, dueDate: D(6) })] });
  for (const item of itemsOf(p, 'a1')) assert.ok(item.plannedMinutes <= 30 + 10);
});

test('17b. computeChunk refuses fragments but allows genuinely short work', () => {
  const s = { minChunkMinutes: 15, maxChunkMinutes: 45 };
  assert.equal(computeChunk(60, 10, 60, s), 0, 'no 10-minute fragment of an hour of work');
  assert.equal(computeChunk(8, 30, 60, s), 8, 'short work is scheduled at its real size');
  assert.equal(computeChunk(60, 60, 60, s), 45, 'capped at the maximum');
  assert.equal(computeChunk(50, 60, 60, s), 50, 'a 5-minute tail is absorbed rather than stranded');
});

/* ================================================================== */
/* Exams                                                              */
/* ================================================================== */

test('18. a light exam uses the light default estimate', () => {
  assert.equal(examStudyEstimate(exam({ materialAmount: 'Light' })), MATERIAL_STUDY_MINUTES.Light);
  const p = plan({ exams: [exam({ materialAmount: 'Light', examDate: D(6) })] });
  assert.equal(minutesOf(p, 'e1'), 90);
});

test('19. a medium exam uses the medium default', () => {
  const p = plan({ exams: [exam({ materialAmount: 'Medium', examDate: D(7) })] });
  assert.equal(minutesOf(p, 'e1'), 180);
});

test('20. a heavy exam uses the heavy default', () => {
  const p = plan({ exams: [exam({ materialAmount: 'Heavy', examDate: D(9) })] });
  assert.equal(minutesOf(p, 'e1'), 300);
});

test('21. exam study is spaced across days rather than crammed', () => {
  const p = plan({ exams: [exam({ materialAmount: 'Medium', examDate: D(6) })] });
  const items = itemsOf(p, 'e1');
  const dates = new Set(items.map((i) => i.scheduledDate));
  assert.ok(dates.size >= 3, `expected spacing, got ${dates.size} day(s)`);
  for (const date of dates) {
    const onDay = items
      .filter((i) => i.scheduledDate === date)
      .reduce((s, i) => s + i.plannedMinutes, 0);
    assert.ok(onDay <= 180 * 0.5, `${date} took ${onDay} of 180`);
  }
});

test('22. a final review is reserved for the last study day', () => {
  const p = plan({ exams: [exam({ materialAmount: 'Medium', examDate: D(5) })] });
  const review = itemsOf(p, 'e1').find((i) => i.finalReview);
  assert.ok(review, 'a final review exists');
  assert.equal(review.scheduledDate, D(4), 'the day before the exam');
  assert.ok(review.reason.codes.includes('exam_final_review'));
  // Not all the study is in it.
  assert.ok(review.plannedMinutes < minutesOf(p, 'e1'));
});

test('23. an exam tomorrow schedules what is realistically possible', () => {
  const p = plan({ exams: [exam({ materialAmount: 'Heavy', examDate: D(1) })] });
  const items = itemsOf(p, 'e1');
  assert.ok(items.length > 0);
  for (const item of items) assert.equal(item.scheduledDate, D(0), 'today is the only study day');
  assert.ok(dayOf(p, D(0)).plannedMinutes <= dayOf(p, D(0)).capacityMinutes);
});

test('24. insufficient exam capacity is reported, not hidden', () => {
  const p = plan({
    settings: settingsWith({ weekdayMaxMinutes: 120 }),
    exams: [exam({ materialAmount: 'Heavy', studyEstimateMinutes: 300, examDate: D(1) })],
  });
  const warning = p.warnings.find((w) => w.kind === 'exam_impossible');
  assert.ok(warning, `expected exam_impossible, got ${warningKinds(p)}`);
  assert.equal(warning.facts.neededMinutes, 300);
  assert.ok(warning.facts.shortfallMinutes > 0);
  assert.equal(
    warning.facts.plannedMinutes + warning.facts.shortfallMinutes,
    warning.facts.neededMinutes,
    'the arithmetic in the warning adds up',
  );
});

test('24b. exam spacing maths is deterministic and clamped', () => {
  const s = settingsWith();
  const wide = examSpacing(180, 6, s);
  assert.ok(wide.maxMinutesPerDay <= s.maxChunkMinutes);
  assert.ok(wide.finalReviewMinutes > 0 && wide.finalReviewMinutes <= 30);
  const tight = examSpacing(300, 1, s);
  assert.equal(tight.finalReviewMinutes, 0, 'no review reserved when there is only one day');
  assert.equal(tight.maxMinutesPerDay, 300);
});

test('24c. study is never scheduled on or after the exam day', () => {
  const p = plan({ exams: [exam({ examDate: D(3) })] });
  assert.equal(lastStudyDate(exam({ examDate: D(3) }), D(0)), D(2));
  for (const item of itemsOf(p, 'e1')) assert.ok(item.scheduledDate < D(3));
});

/* ================================================================== */
/* Conflict                                                           */
/* ================================================================== */

test('25. an assignment and an exam on the same deadline share the time', () => {
  const p = plan({
    assignments: [assignment({ estimatedMinutes: 60, dueDate: D(1) })],
    exams: [exam({ examDate: D(1), materialAmount: 'Medium' })],
  });
  const today = dayOf(p, D(0));
  const sources = new Set(today.items.map((i) => i.sourceType));
  assert.equal(sources.size, 2, 'both kinds of work appear today');
  const assignmentMinutes = today.items
    .filter((i) => i.sourceType === 'assignment')
    .reduce((s, i) => s + i.plannedMinutes, 0);
  assert.ok(assignmentMinutes > 0 && assignmentMinutes < today.plannedMinutes);
});

test('26. several urgent tasks are divided rather than one taking the day', () => {
  const p = plan({
    assignments: [
      assignment({ id: 'a1', estimatedMinutes: 200, dueDate: D(1), priority: 'Urgent' }),
      assignment({ id: 'a2', title: 'B', estimatedMinutes: 60, dueDate: D(1), priority: 'Urgent' }),
      assignment({ id: 'a3', title: 'C', estimatedMinutes: 60, dueDate: D(1), priority: 'Urgent' }),
    ],
  });
  const today = dayOf(p, D(0));
  assert.equal(new Set(today.items.map((i) => i.sourceId)).size, 3);
});

test('27. overdue work and work due tonight both get time', () => {
  const p = plan({
    assignments: [
      assignment({ id: 'old', title: 'Old', estimatedMinutes: 120, dueDate: D(-3) }),
      assignment({ id: 'tonight', title: 'Tonight', estimatedMinutes: 45, dueDate: D(0) }),
    ],
  });
  assert.ok(minutesOf(p, 'old') > 0, 'overdue work is scheduled');
  assert.ok(minutesOf(p, 'tonight') > 0, 'work due tonight is scheduled');
  const today = dayOf(p, D(0));
  assert.equal(new Set(today.items.map((i) => i.sourceId)).size, 2);
});

test('27b. a task with fewer opportunities is scheduled before an equal one with more', () => {
  const s = settingsWith({
    // Only today and Wednesday are available; A is due Tuesday, B on Wednesday.
    weekdayMaxMinutes: 60,
    minChunkMinutes: 60,
    maxChunkMinutes: 60,
  });
  const p = plan({
    settings: s,
    assignments: [
      assignment({ id: 'a', title: 'A', estimatedMinutes: 60, dueDate: D(1), createdAt: '2026-08-02T00:00:00Z' }),
      assignment({ id: 'b', title: 'B', estimatedMinutes: 60, dueDate: D(3), createdAt: '2026-08-01T00:00:00Z' }),
    ],
  });
  assert.equal(dayOf(p, D(0)).items[0].sourceId, 'a', 'the tighter deadline goes first');
  assert.equal(minutesOf(p, 'b'), 60, 'the other still fits later');
});

/* ================================================================== */
/* Rescheduling                                                       */
/* ================================================================== */

test('28. a missed chunk comes back — nothing is lost', () => {
  const yesterday = new Date(2026, 7, 16, 16, 0);
  const first = plan({ now: yesterday, assignments: [assignment({ estimatedMinutes: 90, dueDate: D(3) })] });
  const plannedYesterday = first.days[0].plannedMinutes;
  assert.ok(plannedYesterday > 0);

  // A day later, nothing was logged.
  const second = plan({
    assignments: [assignment({ estimatedMinutes: 90, dueDate: D(3) })],
    previousPlan: first,
    reason: 'day_rollover',
  });
  assert.equal(minutesOf(second, 'a1'), 90, 'every minute is still planned');
  for (const item of itemsOf(second, 'a1')) assert.ok(item.scheduledDate >= D(0));
});

test('29. partial completion leaves exactly the remainder', () => {
  const p = plan({
    assignments: [assignment({ estimatedMinutes: 45, loggedMinutes: 25, dueDate: D(2) })],
  });
  assert.equal(minutesOf(p, 'a1'), 20, '25 of 45 done leaves 20');
});

test('30. an entire missed day is redistributed within capacity', () => {
  const yesterday = new Date(2026, 7, 16, 16, 0);
  const work = [
    assignment({ id: 'm', title: 'Math', estimatedMinutes: 30, dueDate: D(3) }),
    assignment({ id: 's', title: 'Science', estimatedMinutes: 30, dueDate: D(3) }),
    assignment({ id: 'e', title: 'English', estimatedMinutes: 45, dueDate: D(4) }),
  ];
  const before = plan({ now: yesterday, assignments: work });
  const after = plan({ assignments: work, previousPlan: before, reason: 'missed_work' });

  assert.equal(minutesOf(after, 'm') + minutesOf(after, 's') + minutesOf(after, 'e'), 105);
  for (const day of after.days) {
    assert.ok(day.plannedMinutes <= day.capacityMinutes, `${day.date} respects capacity`);
  }
});

test('31. when the future is full the shortfall is reported', () => {
  const s = settingsWith({ weekdayMaxMinutes: 30, weekendMaxMinutes: 30 });
  const p = plan({
    settings: s,
    assignments: [assignment({ estimatedMinutes: 300, dueDate: D(2) })],
  });
  assert.ok(p.unscheduledMinutes > 0);
  const warning = p.warnings.find((w) => w.kind === 'assignment_cannot_fit');
  assert.ok(warning);
  assert.equal(
    warning.facts.plannedMinutes + warning.facts.shortfallMinutes,
    warning.facts.neededMinutes,
  );
});

test('32. work is redistributed across several days when one cannot hold it', () => {
  const p = plan({
    settings: settingsWith({ weekdayMaxMinutes: 60, weekendMaxMinutes: 60 }),
    assignments: [assignment({ estimatedMinutes: 180, dueDate: D(6) })],
  });
  assert.equal(minutesOf(p, 'a1'), 180);
  assert.ok(new Set(itemsOf(p, 'a1').map((i) => i.scheduledDate)).size >= 3);
});

test('33. unfinished work never disappears across a rebuild chain', () => {
  const work = [
    assignment({ id: 'a1', estimatedMinutes: 120, dueDate: D(6) }),
    assignment({ id: 'a2', title: 'Second', estimatedMinutes: 90, dueDate: D(5) }),
  ];
  let current = plan({ assignments: work });
  for (let i = 0; i < 5; i += 1) {
    current = plan({ assignments: work, previousPlan: current, reason: 'manual_rebuild' });
  }
  assert.equal(minutesOf(current, 'a1') + minutesOf(current, 'a2'), 210);
  assert.equal(current.unscheduledMinutes, 0);
});

/* ================================================================== */
/* Completion                                                         */
/* ================================================================== */

test('34. finishing early removes the remaining chunks', () => {
  const before = plan({ assignments: [assignment({ estimatedMinutes: 120, dueDate: D(4) })] });
  assert.ok(itemsOf(before, 'a1').length > 1);
  const after = plan({
    assignments: [assignment({ status: 'Completed', estimatedMinutes: 120, dueDate: D(4) })],
    previousPlan: before,
    reason: 'assignment_completed',
  });
  assert.equal(itemsOf(after, 'a1').length, 0);
});

test('35. future chunks vanish while past ones are still reported as done', () => {
  const before = plan({ assignments: [assignment({ estimatedMinutes: 120, dueDate: D(4) })] });
  const completed = assignment({ status: 'Completed', estimatedMinutes: 120, dueDate: D(4) });
  const annotated = annotatePlan(before, {
    now: MONDAY(),
    assignments: [completed],
    exams: [],
    completedSessions: [],
    activeSession: null,
  });
  for (const item of allItems(annotated)) assert.equal(item.status, 'completed');
});

test('36. a Canvas-verified completion removes chunks — the planner sees only status', () => {
  const canvasDone = assignment({
    status: 'Completed',
    completionMethod: 'canvas',
    canvas: { domain: 'school.instructure.com', url: 'https://x', submissionStatus: 'submitted' },
  });
  const p = plan({ assignments: [canvasDone] });
  assert.equal(itemsOf(p, 'a1').length, 0);
});

test('37. an Edgenuity-verified completion behaves identically', () => {
  const edgenuityDone = assignment({ status: 'Completed', completionMethod: 'edgenuity' });
  const p = plan({ assignments: [edgenuityDone] });
  assert.equal(itemsOf(p, 'a1').length, 0);
});

/* ================================================================== */
/* Determinism                                                        */
/* ================================================================== */

test('38. the same input produces the identical plan', () => {
  const input = {
    assignments: [
      assignment({ id: 'a1', estimatedMinutes: 90, dueDate: D(2) }),
      assignment({ id: 'a2', title: 'B', estimatedMinutes: 45, dueDate: D(3) }),
    ],
    exams: [exam({ examDate: D(5) })],
  };
  assert.equal(JSON.stringify(plan(input)), JSON.stringify(plan(input)));
});

test('39. shuffling the input arrays does not change the schedule', () => {
  const assignments = [
    assignment({ id: 'a1', title: 'One', estimatedMinutes: 60, dueDate: D(2) }),
    assignment({ id: 'a2', title: 'Two', subject: 'English', estimatedMinutes: 60, dueDate: D(2) }),
    assignment({ id: 'a3', title: 'Three', subject: 'Science', estimatedMinutes: 60, dueDate: D(3) }),
    assignment({ id: 'a4', title: 'Four', subject: 'History', estimatedMinutes: 60, dueDate: D(4) }),
  ];
  const exams = [exam({ id: 'e1', examDate: D(5) }), exam({ id: 'e2', name: 'Chem', examDate: D(6) })];
  const straight = plan({ assignments, exams });
  const shuffled = plan({
    assignments: [assignments[2], assignments[0], assignments[3], assignments[1]],
    exams: [exams[1], exams[0]],
  });
  const shape = (p) =>
    p.days.map((d) => d.items.map((i) => [i.sourceId, i.scheduledDate, i.plannedMinutes]));
  assert.deepEqual(shape(straight), shape(shuffled));
});

test('40. ties break on a stable key, not array order', () => {
  const identical = (id, title) =>
    assignment({ id, title, estimatedMinutes: 45, dueDate: D(2), createdAt: '2026-08-01T00:00:00Z' });
  const a = plan({ assignments: [identical('z', 'Z'), identical('a', 'A')] });
  const b = plan({ assignments: [identical('a', 'A'), identical('z', 'Z')] });
  assert.deepEqual(
    a.days[0].items.map((i) => i.sourceId),
    b.days[0].items.map((i) => i.sourceId),
  );
});

/* ================================================================== */
/* Historical estimation                                              */
/* ================================================================== */

test('41. too few samples means no adjustment at all', () => {
  const done = [
    assignment({ id: 'd1', status: 'Completed', estimatedMinutes: 30, loggedMinutes: 45 }),
    assignment({ id: 'd2', status: 'Completed', estimatedMinutes: 30, loggedMinutes: 45 }),
  ];
  const factors = subjectFactors(done);
  assert.equal(factors.size, 0, `${MIN_SAMPLES} samples are required`);
  assert.equal(effectiveFactor('Math', factors, { useAdjustedEstimates: true, accepted: [] }), 1);
});

test('42. a consistently slower subject gets a factor above 1 and more planned time', () => {
  const history = [1, 2, 3, 4].map((n) =>
    assignment({ id: `d${n}`, status: 'Completed', estimatedMinutes: 40, loggedMinutes: 50 }),
  );
  const factors = subjectFactors(history);
  assert.equal(factors.get('math').factor, 1.25);

  const open = assignment({ id: 'live', estimatedMinutes: 40, dueDate: D(4) });
  const off = plan({ assignments: [...history, open] });
  const on = plan({
    assignments: [...history, open],
    settings: settingsWith({ useAdjustedEstimates: true }),
  });
  assert.equal(minutesOf(off, 'live'), 40);
  assert.equal(minutesOf(on, 'live'), 50);
});

test('43. a consistently faster subject gets a factor below 1', () => {
  const history = [1, 2, 3].map((n) =>
    assignment({ id: `d${n}`, subject: 'English', status: 'Completed', estimatedMinutes: 40, loggedMinutes: 36 }),
  );
  assert.equal(subjectFactors(history).get('english').factor, 0.9);
});

test('44. one absurd session cannot move the factor (median + clamps)', () => {
  const history = [
    assignment({ id: 'd1', status: 'Completed', estimatedMinutes: 30, loggedMinutes: 30 }),
    assignment({ id: 'd2', status: 'Completed', estimatedMinutes: 30, loggedMinutes: 33 }),
    assignment({ id: 'd3', status: 'Completed', estimatedMinutes: 30, loggedMinutes: 30 }),
    // Someone left the timer running overnight.
    assignment({ id: 'd4', status: 'Completed', estimatedMinutes: 30, loggedMinutes: 900 }),
  ];
  const factor = subjectFactors(history).get('math').factor;
  assert.ok(factor >= 1 && factor <= 1.1, `outlier survived: ${factor}`);
});

test('44b. per-subject opt-in works without the global switch', () => {
  const history = [1, 2, 3].map((n) =>
    assignment({ id: `d${n}`, status: 'Completed', estimatedMinutes: 40, loggedMinutes: 50 }),
  );
  const factors = subjectFactors(history);
  assert.equal(effectiveFactor('Math', factors, { useAdjustedEstimates: false, accepted: [] }), 1);
  assert.equal(
    effectiveFactor('Math', factors, { useAdjustedEstimates: false, accepted: ['Math'] }),
    1.25,
  );
});

/* ================================================================== */
/* Deadlines                                                          */
/* ================================================================== */

test('45. an impossible workload is flagged rather than crammed', () => {
  const p = plan({
    settings: settingsWith({ weekdayMaxMinutes: 100, weekendMaxMinutes: 100 }),
    assignments: [assignment({ estimatedMinutes: 300, dueDate: D(1) })],
  });
  assert.ok(p.unscheduledMinutes >= 100, `unscheduled: ${p.unscheduledMinutes}`);
  assert.ok(warningKinds(p).includes('assignment_cannot_fit'));
  assert.ok(warningKinds(p).includes('day_overloaded'));
  for (const day of p.days) assert.ok(day.plannedMinutes <= day.capacityMinutes);
});

test('46. the deadline buffer keeps work out of the final hours', () => {
  const s = settingsWith({ deadlineBufferHours: 3, bufferPercent: 0, workloadPreference: 'Intensive' });
  // Due at 6:00 PM tomorrow: with a 3-hour buffer the work must be done by 3 PM,
  // which is before tomorrow's 4 PM window opens — so it all lands today.
  const p = plan({
    settings: s,
    assignments: [assignment({ estimatedMinutes: 60, dueDate: D(1), dueTime: '18:00' })],
  });
  for (const item of itemsOf(p, 'a1')) assert.equal(item.scheduledDate, D(0));
});

test('47. nothing is ever scheduled after its deadline', () => {
  const p = plan({
    assignments: [
      assignment({ id: 'a1', estimatedMinutes: 400, dueDate: D(2) }),
      assignment({ id: 'a2', title: 'Later', estimatedMinutes: 100, dueDate: D(6) }),
    ],
    exams: [exam({ examDate: D(4) })],
  });
  for (const item of itemsOf(p, 'a1')) assert.ok(item.scheduledDate <= D(2), item.scheduledDate);
  for (const item of itemsOf(p, 'a2')) assert.ok(item.scheduledDate <= D(6));
  for (const item of itemsOf(p, 'e1')) assert.ok(item.scheduledDate <= D(3));
});

/* ================================================================== */
/* Time                                                               */
/* ================================================================== */

test('48. a late start only uses the time that is actually left today', () => {
  const late = new Date(2026, 7, 17, 19, 30, 0, 0); // 7:30 PM, window ends 8 PM
  const p = plan({ now: late, assignments: [assignment({ estimatedMinutes: 180, dueDate: D(2) })] });
  const today = dayOf(p, todayISO(late));
  assert.equal(today.availableMinutes, 30);
  assert.ok(today.plannedMinutes <= 30);
  for (const item of today.items) assert.ok(item.startTime >= '19:30');
});

test('48b. just before midnight, today has no capacity and nothing is planned for it', () => {
  const nearMidnight = new Date(2026, 7, 17, 23, 58, 0, 0);
  const p = plan({
    now: nearMidnight,
    assignments: [assignment({ estimatedMinutes: 60, dueDate: D(3) })],
  });
  assert.equal(dayOf(p, todayISO(nearMidnight)).availableMinutes, 0);
  assert.equal(dayOf(p, todayISO(nearMidnight)).items.length, 0);
  assert.equal(p.planningHorizonStart, todayISO(nearMidnight));
});

test('49. dates are local — a due date does not slide across the UTC boundary', () => {
  // 11:30 PM local on the 17th is already the 18th in UTC. A planner that
  // compared instants instead of local dates would call today "tomorrow" and
  // work due today "overdue".
  const lateNight = new Date(2026, 7, 17, 23, 30, 0, 0);
  assert.equal(todayISO(lateNight), '2026-08-17');

  const p = plan({
    now: lateNight,
    assignments: [
      assignment({ id: 'tomorrow', estimatedMinutes: 30, dueDate: '2026-08-18' }),
      assignment({ id: 'today', title: 'Tonight', estimatedMinutes: 30, dueDate: '2026-08-17' }),
    ],
  });
  assert.equal(p.planningHorizonStart, '2026-08-17');
  assert.equal(p.days[1].date, '2026-08-18');

  // There is no time left tonight, so tomorrow's work is planned tomorrow —
  // and is correctly described as due that day, not the day after.
  const item = itemsOf(p, 'tomorrow')[0];
  assert.equal(item.scheduledDate, '2026-08-18');
  assert.ok(item.reason.codes.includes('due_today'), item.reason.codes.join(','));

  // Work due *today* is past its deadline buffer but not lost.
  assert.equal(minutesOf(p, 'today'), 30);
});

test('50. day arithmetic survives a DST boundary', () => {
  // US DST ends on 1 November 2026; that day is 25 hours long.
  const dstEve = new Date(2026, 9, 31, 16, 0, 0, 0); // Sat 31 Oct
  const p = plan({
    now: dstEve,
    assignments: [assignment({ estimatedMinutes: 300, dueDate: '2026-11-05' })],
  });
  const dates = p.days.map((d) => d.date);
  assert.equal(dates[0], '2026-10-31');
  assert.equal(dates[1], '2026-11-01');
  assert.equal(dates[2], '2026-11-02');
  assert.equal(new Set(dates).size, dates.length, 'no duplicated or skipped day');
  assert.equal(minutesOf(p, 'a1'), 300);
});

/* ================================================================== */
/* Supporting behaviour                                               */
/* ================================================================== */

test('51. urgency is monotonic and overdue outranks due-today', () => {
  assert.ok(urgencyScore(-1) > urgencyScore(0));
  assert.ok(urgencyScore(0) > urgencyScore(1));
  assert.ok(urgencyScore(1) > urgencyScore(2));
  assert.ok(urgencyScore(3) >= urgencyScore(7));
});

test('52. "can\'t do this today" moves the work off today and keeps every minute', () => {
  const withoutSkip = plan({ assignments: [assignment({ estimatedMinutes: 60, dueDate: D(4) })] });
  assert.ok(dayOf(withoutSkip, D(0)).items.length > 0);

  const withSkip = plan({
    assignments: [assignment({ estimatedMinutes: 60, dueDate: D(4) })],
    skips: [{ sourceType: 'assignment', sourceId: 'a1', date: D(0), createdAt: '2026-08-17T16:00:00Z' }],
  });
  assert.equal(dayOf(withSkip, D(0)).items.length, 0);
  assert.equal(minutesOf(withSkip, 'a1'), 60);
});

test('53. clock times are laid out in order with breaks and never overlap', () => {
  const s = settingsWith({ breakMinutes: 10, minChunkMinutes: 15, maxChunkMinutes: 30 });
  const p = plan({
    settings: s,
    assignments: [
      assignment({ id: 'a1', estimatedMinutes: 30, dueDate: D(1) }),
      assignment({ id: 'a2', title: 'B', estimatedMinutes: 30, dueDate: D(1) }),
    ],
  });
  const items = dayOf(p, D(0)).items.filter((i) => i.startTime);
  assert.ok(items.length >= 2);
  for (let i = 1; i < items.length; i += 1) {
    assert.ok(items[i].startTime >= items[i - 1].endTime, 'no overlap');
  }
});

test('54. manual ordering is respected for a day', () => {
  const assignments = [
    assignment({ id: 'a1', title: 'Math', estimatedMinutes: 30, dueDate: D(1) }),
    assignment({ id: 'a2', title: 'English', subject: 'English', estimatedMinutes: 30, dueDate: D(1) }),
  ];
  const natural = plan({ assignments });
  const naturalOrder = dayOf(natural, D(0)).items.map((i) => i.sourceId);
  const reversed = [...naturalOrder].reverse();
  const manual = plan({
    assignments,
    manualOrders: [{ date: D(0), order: reversed.map((id) => `assignment:${id}`), updatedAt: '' }],
  });
  assert.deepEqual(
    dayOf(manual, D(0)).items.map((i) => i.sourceId),
    reversed,
  );
});

test('55. movement between plans is recorded with the original date', () => {
  const before = plan({ assignments: [assignment({ estimatedMinutes: 60, dueDate: D(5) })] });
  // The student becomes unavailable today, so the same work must move.
  const s = settingsWith({
    availability: defaultPlannerSettings().availability.map((row) =>
      row.weekday === 1 ? { ...row, available: false } : row,
    ),
  });
  const after = plan({
    settings: s,
    assignments: [assignment({ estimatedMinutes: 60, dueDate: D(5) })],
    previousPlan: before,
    reason: 'availability_changed',
  });
  const moved = itemsOf(after, 'a1')[0];
  assert.equal(moved.originalScheduledDate, D(0));
  assert.equal(moved.status, 'rescheduled');
});

test('56. the rebuild diff describes moves, additions and unchanged work', () => {
  const before = plan({ assignments: [assignment({ id: 'a1', estimatedMinutes: 45, dueDate: D(3) })] });
  const after = plan({
    assignments: [
      assignment({ id: 'a1', estimatedMinutes: 45, dueDate: D(3) }),
      assignment({ id: 'a2', title: 'New', estimatedMinutes: 45, dueDate: D(2) }),
    ],
    previousPlan: before,
    reason: 'assignment_added',
  });
  const changes = diffPlans(before, after);
  assert.ok(changes.some((c) => c.sourceId === 'a2' && c.kind === 'added'));
  assert.ok(changes.some((c) => c.sourceId === 'a1'));
});

test('57. statuses are derived from logged work, not stored guesses', () => {
  const a = assignment({ estimatedMinutes: 60, dueDate: D(2) });
  const p = plan({ assignments: [a] });
  const today = dayOf(p, D(0)).items[0];
  const ctx = (sessions) => ({
    now: MONDAY(),
    assignments: [a],
    exams: [],
    completedSessions: sessions,
    activeSession: null,
  });

  const untouched = annotatePlan(p, ctx([]));
  assert.equal(dayOf(untouched, D(0)).items[0].status, 'planned');

  const partial = annotatePlan(
    p,
    ctx([session({ assignmentId: 'a1', actualMinutes: 5, endedAt: '2026-08-17T16:30:00.000Z' })]),
  );
  assert.equal(dayOf(partial, D(0)).items[0].status, 'in_progress');

  const full = annotatePlan(
    p,
    ctx([
      session({
        assignmentId: 'a1',
        actualMinutes: today.plannedMinutes,
        endedAt: '2026-08-17T17:30:00.000Z',
      }),
    ]),
  );
  assert.equal(dayOf(full, D(0)).items[0].status, 'completed');
});

test('58. a past day with nothing logged reads as missed, with work logged as moved', () => {
  const yesterday = new Date(2026, 7, 16, 16, 0);
  const p = plan({ now: yesterday, assignments: [assignment({ estimatedMinutes: 60, dueDate: D(4) })] });
  const base = {
    now: MONDAY(),
    assignments: [assignment({ estimatedMinutes: 60, dueDate: D(4) })],
    exams: [],
    activeSession: null,
  };
  const missedPlan = annotatePlan(p, { ...base, completedSessions: [] });
  assert.equal(missedPlan.days[0].items[0].status, 'missed');

  const partialPlan = annotatePlan(p, {
    ...base,
    completedSessions: [
      session({ assignmentId: 'a1', actualMinutes: 10, endedAt: '2026-08-16T17:00:00.000Z' }),
    ],
  });
  assert.equal(partialPlan.days[0].items[0].status, 'rescheduled');

  const summary = missedWork(p, todayISO(yesterday), { ...base, completedSessions: [] });
  assert.equal(summary.unfinishedMinutes, p.days[0].plannedMinutes);
});

test('59. explanations are built from the numbers the scheduler used', () => {
  const p = plan({
    assignments: [assignment({ estimatedMinutes: 45, dueDate: D(1), priority: 'Important' })],
  });
  const lines = explainItem(dayOf(p, D(0)).items[0]);
  assert.ok(lines.some((l) => l.includes('Due tomorrow')));
  assert.ok(lines.some((l) => /45 min|of work left/.test(l)));
  assert.ok(lines.some((l) => l.includes('Important')));

  const warned = plan({
    settings: settingsWith({ weekdayMaxMinutes: 30, weekendMaxMinutes: 30 }),
    assignments: [assignment({ estimatedMinutes: 300, dueDate: D(1) })],
  });
  const explained = explainWarning(warned.warnings.find((w) => w.kind === 'assignment_cannot_fit'));
  assert.ok(explained.detail.includes('nowhere to go'));
});

test('60. capacity helpers: window subtraction is exact', () => {
  assert.deepEqual(
    subtractWindows([{ start: 0, end: 100 }], [{ start: 20, end: 40 }]),
    [
      { start: 0, end: 20 },
      { start: 40, end: 100 },
    ],
  );
  assert.deepEqual(subtractWindows([{ start: 0, end: 100 }], [{ start: 0, end: 200 }]), []);
  assert.deepEqual(subtractWindows([{ start: 0, end: 100 }], [{ start: 200, end: 300 }]), [
    { start: 0, end: 100 },
  ]);
});

test('61. the horizon is exactly as long as configured', () => {
  const p = plan({ settings: settingsWith({ horizonDays: 30 }) });
  assert.equal(p.days.length, 30);
  assert.equal(p.planningHorizonEnd, D(29));
  assert.equal(buildCapacity(settingsWith({ horizonDays: 3 }), MONDAY()).length, 3);
});

test('62. no duplicate item ids, and chunk numbering is contiguous', () => {
  const p = plan({
    assignments: [
      assignment({ id: 'a1', estimatedMinutes: 300, dueDate: D(6) }),
      assignment({ id: 'a2', title: 'Other', estimatedMinutes: 200, dueDate: D(6) }),
    ],
    exams: [exam({ examDate: D(6), materialAmount: 'Heavy' })],
  });
  const ids = allItems(p).map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const sourceId of ['a1', 'a2', 'e1']) {
    const numbers = itemsOf(p, sourceId)
      .map((i) => i.chunkIndex)
      .sort((x, y) => x - y);
    assert.deepEqual(numbers, numbers.map((_, index) => index + 1));
  }
});

test('63. large inputs still plan quickly (100 assignments, 20 exams, 30 days)', () => {
  const assignments = Array.from({ length: 100 }, (_, i) =>
    assignment({
      id: `a${i}`,
      title: `Task ${i}`,
      subject: ['Math', 'English', 'Science', 'History'][i % 4],
      estimatedMinutes: 30 + (i % 6) * 20,
      dueDate: D(1 + (i % 25)),
      priority: ['Normal', 'Important', 'Urgent'][i % 3],
    }),
  );
  const exams = Array.from({ length: 20 }, (_, i) =>
    exam({
      id: `e${i}`,
      name: `Exam ${i}`,
      subject: ['Math', 'Biology', 'Chemistry'][i % 3],
      examDate: D(2 + (i % 25)),
      materialAmount: ['Light', 'Medium', 'Heavy'][i % 3],
    }),
  );
  const start = performance.now();
  const p = plan({ assignments, exams, settings: settingsWith({ horizonDays: 30 }) });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1500, `planning took ${elapsed.toFixed(0)}ms`);
  for (const day of p.days) assert.ok(day.plannedMinutes <= day.capacityMinutes);
  assert.ok(totalPlanned(p) > 0);
});

test('64. verification back-ends get no scheduling advantage', () => {
  const plain = assignment({ id: 'plain', title: 'Plain', estimatedMinutes: 60, dueDate: D(2) });
  const canvasBacked = assignment({
    id: 'canvas',
    title: 'Canvas',
    estimatedMinutes: 60,
    dueDate: D(2),
    canvas: { domain: 'school.instructure.com', url: 'https://x', submissionStatus: 'unsubmitted' },
  });
  // Planned separately, so the comparison is not contaminated by the fact that
  // whichever is scheduled first leaves less capacity for the other.
  const alone = plan({ assignments: [plain] });
  const backed = plan({ assignments: [canvasBacked] });
  assert.equal(itemsOf(alone, 'plain')[0].priorityScore, itemsOf(backed, 'canvas')[0].priorityScore);
  assert.equal(minutesOf(alone, 'plain'), minutesOf(backed, 'canvas'));
});
