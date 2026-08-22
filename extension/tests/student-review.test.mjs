import { test } from 'node:test';
import assert from 'node:assert/strict';

const { defaultState } = await import('../../web/src/lib/storage.ts');
const { buildStudentWeeklyReview } = await import('../../web/src/lib/studentReview.ts');

const NOW = new Date('2026-08-21T18:00:00');

test('the weekly review calibrates estimates from sessions in the rolling week only', () => {
  const state = defaultState();
  state.completedSessions = [
    {
      id: 'recent',
      assignmentId: 'a',
      assignmentTitle: 'Essay',
      plannedMinutes: 40,
      actualMinutes: 60,
      startedAt: '2026-08-20T16:00:00.000Z',
      endedAt: '2026-08-20T17:00:00.000Z',
    },
    {
      id: 'old',
      assignmentId: 'b',
      assignmentTitle: 'Old work',
      plannedMinutes: 100,
      actualMinutes: 10,
      startedAt: '2026-08-01T16:00:00.000Z',
      endedAt: '2026-08-01T16:10:00.000Z',
    },
  ];

  const review = buildStudentWeeklyReview(state, NOW);
  assert.equal(review.focusSessions, 1);
  assert.equal(review.plannedSessionMinutes, 40);
  assert.equal(review.actualSessionMinutes, 60);
  assert.equal(review.estimateDeltaPercent, 50);
  assert.match(review.suggestion, /50% longer/);
});

test('blocked attempts come only from real Focus Mode runs in the week', () => {
  const state = defaultState();
  state.completedSessions = [
    {
      id: 'session',
      assignmentId: null,
      assignmentTitle: null,
      plannedMinutes: 20,
      actualMinutes: 20,
      startedAt: '2026-08-20T16:00:00.000Z',
      endedAt: '2026-08-20T16:20:00.000Z',
    },
  ];
  state.focusRuns = [
    {
      id: 'real',
      startedAt: '2026-08-20T16:00:00.000Z',
      endedAt: '2026-08-20T16:20:00.000Z',
      requiredTaskIds: [],
      requiredCount: 0,
      completedCount: 0,
      outcome: 'ended',
      isTest: false,
      unlocks: [],
      blocked: [{ domain: 'example.com', count: 6 }],
      blockBaseline: [],
      awayCount: 0,
      awayMs: 0,
    },
    {
      id: 'test',
      startedAt: '2026-08-20T17:00:00.000Z',
      endedAt: '2026-08-20T17:05:00.000Z',
      requiredTaskIds: [],
      requiredCount: 0,
      completedCount: 0,
      outcome: 'ended',
      isTest: true,
      unlocks: [],
      blocked: [{ domain: 'example.com', count: 99 }],
      blockBaseline: [],
      awayCount: 0,
      awayMs: 0,
    },
  ];

  const review = buildStudentWeeklyReview(state, NOW);
  assert.equal(review.blockedAttempts, 6);
  assert.match(review.suggestion, /assignment is open/);
});

test('an empty week suggests one small session instead of assigning a score', () => {
  const review = buildStudentWeeklyReview(defaultState(), NOW);
  assert.equal(review.estimateDeltaPercent, null);
  assert.match(review.suggestion, /15-minute focus session/);
  assert.equal('score' in review, false);
});
