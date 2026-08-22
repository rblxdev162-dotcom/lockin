import type { AppState, CompletedSession } from '../types';
import { selectWeeklySummary, weekWindow } from './parent/selectors';

export interface StudentWeeklyReview {
  from: string;
  to: string;
  completed: number;
  focusMinutes: number;
  focusSessions: number;
  blockedAttempts: number;
  plannedSessionMinutes: number;
  actualSessionMinutes: number;
  estimateDeltaPercent: number | null;
  suggestion: string;
}

function inWindow(iso: string | undefined, from: Date, to: Date): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && time >= from.getTime() && time <= to.getTime();
}

function calibration(sessions: CompletedSession[]): {
  planned: number;
  actual: number;
  delta: number | null;
} {
  const planned = sessions.reduce((sum, session) => sum + Math.max(0, session.plannedMinutes), 0);
  const actual = sessions.reduce((sum, session) => sum + Math.max(0, session.actualMinutes), 0);
  if (planned < 15) return { planned, actual, delta: null };
  return {
    planned,
    actual,
    delta: Math.round(((actual - planned) / planned) * 100),
  };
}

/** A factual, local-only reflection. It never scores or ranks the student. */
export function buildStudentWeeklyReview(
  state: AppState,
  now = new Date(),
): StudentWeeklyReview {
  const summary = selectWeeklySummary(state, now);
  const { from, to } = weekWindow(now);
  const sessions = state.completedSessions.filter((session) =>
    inWindow(session.endedAt, from, to),
  );
  const runs = state.focusRuns.filter(
    (run) => !run.isTest && inWindow(run.startedAt, from, to),
  );
  const blockedAttempts = runs.reduce(
    (total, run) => total + run.blocked.reduce((sum, item) => sum + Math.max(0, item.count), 0),
    0,
  );
  const estimate = calibration(sessions);

  let suggestion = 'Keep the plan as it is for another week; there is no strong signal to change it.';
  if (summary.focusSessions === 0) {
    suggestion = 'Make the first step small: schedule one 15-minute focus session this week.';
  } else if (estimate.delta !== null && estimate.delta >= 25) {
    suggestion = `Your finished sessions ran about ${estimate.delta}% longer than planned. Give similar work more room next week.`;
  } else if (summary.emergencyExits > 0) {
    suggestion = 'A Focus Mode run ended early. Next time, require a smaller set of work and finish one clear target first.';
  } else if (blockedAttempts >= 5) {
    suggestion = 'Distractions pushed back several times. Start Focus Mode only after the assignment is open and the first step is visible.';
  } else if (estimate.delta !== null && estimate.delta <= -25) {
    suggestion = 'Your finished sessions used less time than planned. You can cautiously shorten similar blocks next week.';
  }

  return {
    from: summary.from,
    to: summary.to,
    completed: summary.assignmentsCompleted,
    focusMinutes: summary.focusMinutes,
    focusSessions: summary.focusSessions,
    blockedAttempts,
    plannedSessionMinutes: estimate.planned,
    actualSessionMinutes: estimate.actual,
    estimateDeltaPercent: estimate.delta,
    suggestion,
  };
}
