/**
 * The planner's front door.
 *
 * The engine underneath is pure and knows nothing about `AppState`; this file
 * is the thin adapter that feeds it, plus the derived views the UI reads. No
 * planning decision lives here — and none lives in a React component.
 */
import type { AppState, PlanReason, PlannedDay, PlannedWorkItem, StudyPlan } from '../../types';
import { sourceKey } from '../../types/planner';
import { todayISO } from '../time';
import { generatePlan } from './engine';
import { annotatePlan, dayProgress, missedWork } from './reschedule';
import type { StatusContext } from './reschedule';
import { examRemainingMinutes, examStudyEstimate } from './exams';
import { factorSuggestions, subjectFactors } from './estimation';
import type { PlannerInputs } from './types';

export * from './types';
export { generatePlan, computeChunk, MAX_ITEMS_PER_DAY } from './engine';
export * from './capacity';
export * from './priorities';
export * from './estimation';
export * from './exams';
export * from './assignments';
export * from './schedule';
export * from './reschedule';
export * from './explanations';

/** Everything the engine needs, pulled out of the app state. */
export function plannerInputs(
  state: AppState,
  reason: PlanReason,
  now: Date = new Date(),
): PlannerInputs {
  return {
    now,
    assignments: state.assignments,
    exams: state.exams,
    completedSessions: state.completedSessions,
    settings: state.planner.settings,
    skips: state.planner.skips,
    manualOrders: state.planner.manualOrders,
    lockedDates: state.planner.lockedDates,
    acceptedSubjectFactors: state.planner.acceptedSubjectFactors,
    previousPlan: state.planner.plan,
    reason,
    planVersion: (state.planner.plan?.planVersion ?? 0) + 1,
  };
}

/** Builds the next plan for this state. Pure: nothing is written. */
export function buildPlan(state: AppState, reason: PlanReason, now: Date = new Date()): StudyPlan {
  return generatePlan(plannerInputs(state, reason, now));
}

export function statusContext(state: AppState, now: Date = new Date()): StatusContext {
  return {
    now,
    assignments: state.assignments,
    exams: state.exams,
    completedSessions: state.completedSessions,
    activeSession: state.activeSession,
  };
}

/** The stored plan with live statuses — what every screen should read. */
export function livePlan(state: AppState, now: Date = new Date()): StudyPlan | null {
  return state.planner.plan ? annotatePlan(state.planner.plan, statusContext(state, now)) : null;
}

export function selectPlannedDay(
  state: AppState,
  dateISO: string,
  now: Date = new Date(),
): PlannedDay | null {
  const plan = livePlan(state, now);
  return plan?.days.find((d) => d.date === dateISO) ?? null;
}

export function selectTodayPlan(state: AppState, now: Date = new Date()): PlannedDay | null {
  return selectPlannedDay(state, todayISO(now), now);
}

export function selectTodayProgress(state: AppState, now: Date = new Date()) {
  const plan = livePlan(state, now);
  if (!plan) return null;
  return dayProgress(plan, todayISO(now), statusContext(state, now));
}

/** Yesterday's unfinished work, for the "plan updated" explanation. */
export function selectMissedYesterday(state: AppState, now: Date = new Date()) {
  const plan = state.planner.plan;
  if (!plan) return null;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  return missedWork(plan, todayISO(yesterday), statusContext(state, now));
}

export interface WeekDayLoad {
  date: string;
  plannedMinutes: number;
  capacityMinutes: number;
  itemCount: number;
  restDay: boolean;
  /** 0–1+; above 1 would mean overbooked, which the engine never produces. */
  utilisation: number;
}

export function selectWeekLoad(
  state: AppState,
  days = 7,
  now: Date = new Date(),
): WeekDayLoad[] {
  const plan = livePlan(state, now);
  if (!plan) return [];
  return plan.days.slice(0, days).map((day) => ({
    date: day.date,
    plannedMinutes: day.plannedMinutes,
    capacityMinutes: day.capacityMinutes,
    itemCount: day.items.length,
    restDay: day.restDay,
    utilisation: day.capacityMinutes > 0 ? day.plannedMinutes / day.capacityMinutes : 0,
  }));
}

export interface ExamPlanProgress {
  examId: string;
  name: string;
  subject: string;
  examDate: string;
  estimateMinutes: number;
  plannedMinutes: number;
  completedMinutes: number;
  remainingMinutes: number;
}

export function selectExamProgress(
  state: AppState,
  now: Date = new Date(),
): ExamPlanProgress[] {
  const plan = livePlan(state, now);
  const today = todayISO(now);
  const plannedByExam = new Map<string, number>();
  for (const day of plan?.days ?? []) {
    for (const item of day.items) {
      if (item.sourceType !== 'exam') continue;
      plannedByExam.set(
        item.sourceId,
        (plannedByExam.get(item.sourceId) ?? 0) + item.plannedMinutes,
      );
    }
  }
  return state.exams
    .filter((e) => e.examDate >= today)
    .sort((a, b) => a.examDate.localeCompare(b.examDate) || a.id.localeCompare(b.id))
    .map((exam) => ({
      examId: exam.id,
      name: exam.name,
      subject: exam.subject,
      examDate: exam.examDate,
      estimateMinutes: examStudyEstimate(exam),
      plannedMinutes: plannedByExam.get(exam.id) ?? 0,
      completedMinutes: Math.round(exam.loggedMinutes ?? 0),
      remainingMinutes: examRemainingMinutes(exam),
    }));
}

/** Subjects whose finished work suggests the estimates are off. */
export function selectEstimateSuggestions(state: AppState) {
  return factorSuggestions(
    subjectFactors(state.assignments),
    state.planner.settings.useAdjustedEstimates
      ? // With the global switch on, everything is already applied; there is
        // nothing left to suggest.
        [...new Set(state.assignments.map((a) => a.subject))]
      : state.planner.acceptedSubjectFactors,
  );
}

/** The week's headline numbers for the planner page. */
export function selectWeekSummary(state: AppState, now: Date = new Date()) {
  const plan = livePlan(state, now);
  const today = todayISO(now);
  const week = plan?.days.slice(0, 7) ?? [];
  const assignmentIds = new Set<string>();
  const examIds = new Set<string>();
  let plannedMinutes = 0;
  for (const day of week) {
    plannedMinutes += day.plannedMinutes;
    for (const item of day.items) {
      if (item.sourceType === 'assignment') assignmentIds.add(item.sourceId);
      else examIds.add(item.sourceId);
    }
  }
  return {
    from: today,
    to: week.length ? week[week.length - 1].date : today,
    assignments: assignmentIds.size,
    exams: examIds.size,
    plannedMinutes,
    warnings: plan?.warnings.length ?? 0,
  };
}

/** Items on a date, keyed for manual ordering. */
export function orderKeys(items: PlannedWorkItem[]): string[] {
  return items.map((i) => sourceKey(i.sourceType, i.sourceId));
}
