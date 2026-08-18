/**
 * Exams → schedulable study.
 *
 * An exam is not an assignment with a different name. There is no artefact to
 * submit, the work is open-ended, and cramming it into the night before is the
 * failure mode the planner exists to prevent — so exam study is spread across
 * the days that are actually available and ends with a short review.
 *
 * The default estimates below are starting points a student can edit. They are
 * not measurements of anything, and the UI says so.
 */
import type { Exam, MaterialAmount, PlannerSettings } from '../../types';
import { addDaysISO, todayISO } from '../time';
import { lastUsableDate } from './assignments';
import type { DayCapacity, WorkTask } from './types';

/** Rough study time per material amount. Editable per exam. */
export const MATERIAL_STUDY_MINUTES: Record<MaterialAmount, number> = {
  Light: 90,
  Medium: 180,
  Heavy: 300,
};

/** Self-reported confidence nudges the estimate; it never halves or doubles it. */
export const CONFIDENCE_MULTIPLIER = { Low: 1.25, Medium: 1, High: 0.8 } as const;

/** More sessions than this stops being spacing and starts being noise. */
export const EXAM_MAX_SESSIONS = 6;
/** The reserved pre-exam review, as a share of the total. */
export const FINAL_REVIEW_SHARE = 0.2;
export const FINAL_REVIEW_MAX_MINUTES = 30;

export function examStudyEstimate(exam: Exam): number {
  if (typeof exam.studyEstimateMinutes === 'number' && exam.studyEstimateMinutes > 0) {
    return Math.round(exam.studyEstimateMinutes);
  }
  const base = MATERIAL_STUDY_MINUTES[exam.materialAmount] ?? MATERIAL_STUDY_MINUTES.Medium;
  const multiplier = exam.confidenceLevel ? CONFIDENCE_MULTIPLIER[exam.confidenceLevel] : 1;
  return Math.round(base * multiplier);
}

export function examRemainingMinutes(exam: Exam): number {
  return Math.max(0, examStudyEstimate(exam) - Math.round(exam.loggedMinutes ?? 0));
}

/**
 * The last day study is worth scheduling.
 *
 * The day of the exam only counts when the exam is today — anything else would
 * schedule revision for an exam that has already been sat. Normally the last
 * study day is the day before, which is also where the final review lands.
 */
export function lastStudyDate(exam: Exam, todayDate: string): string {
  if (exam.examDate <= todayDate) return todayDate;
  return addDaysISO(exam.examDate, -1);
}

export interface ExamSpacing {
  /** Ceiling on minutes for this exam on any one day. */
  maxMinutesPerDay: number;
  /** How many sittings the study is aimed at. */
  sessions: number;
  /** Minutes held back for the review session right before the exam. */
  finalReviewMinutes: number;
}

/**
 * How to spread `remaining` minutes over `usableDays` days.
 *
 * With room, study is divided into up to six sittings and capped so no single
 * day swallows the subject. With one day left, spacing is meaningless and the
 * cap is lifted — an exam tomorrow gets whatever time exists, and the shortfall
 * (if any) is reported rather than hidden.
 */
export function examSpacing(
  remaining: number,
  usableDays: number,
  settings: PlannerSettings,
): ExamSpacing {
  if (usableDays <= 1) {
    return { maxMinutesPerDay: remaining, sessions: 1, finalReviewMinutes: 0 };
  }

  const finalReview =
    remaining >= settings.minChunkMinutes * 2
      ? Math.min(
          FINAL_REVIEW_MAX_MINUTES,
          settings.maxChunkMinutes,
          Math.max(settings.minChunkMinutes, Math.round(remaining * FINAL_REVIEW_SHARE)),
        )
      : 0;

  const sessions = Math.min(usableDays, EXAM_MAX_SESSIONS);
  const perSession = Math.ceil(remaining / sessions);
  const spaced = Math.min(
    settings.maxChunkMinutes,
    Math.max(settings.minChunkMinutes, perSession),
  );
  // If even the spaced rate cannot clear the material in the days available,
  // raise the ceiling rather than quietly planning less than is needed.
  const needed = Math.ceil(remaining / usableDays);
  return {
    maxMinutesPerDay: Math.max(spaced, needed),
    sessions,
    finalReviewMinutes: finalReview,
  };
}

export interface ExamTaskOptions {
  now: Date;
  settings: PlannerSettings;
  days: DayCapacity[];
}

/** Upcoming exams with study left, as schedulable tasks. */
export function buildExamTasks(exams: Exam[], options: ExamTaskOptions): WorkTask[] {
  const today = todayISO(options.now);
  const tasks: WorkTask[] = [];

  for (const exam of exams) {
    if (!exam.examDate || exam.examDate < today) continue;
    const remaining = examRemainingMinutes(exam);
    if (remaining <= 0) continue;

    const studyBy = lastStudyDate(exam, today);
    const usable = lastUsableDate(
      { dateISO: studyBy, minutes: 24 * 60, overdue: false },
      options.days,
    );
    const usableDays = options.days.filter(
      (d) => d.date <= usable && d.capacityMinutes > 0,
    ).length;
    const spacing = examSpacing(remaining, Math.max(1, usableDays), options.settings);

    tasks.push({
      key: `exam:${exam.id}`,
      sourceType: 'exam',
      sourceId: exam.id,
      title: exam.name,
      subject: exam.subject,
      remainingMinutes: remaining,
      rawEstimateMinutes: examStudyEstimate(exam),
      loggedMinutes: Math.round(exam.loggedMinutes ?? 0),
      lastUsableDate: usable,
      deadlineDate: exam.examDate,
      overdue: false,
      // Exams have no priority field of their own; proximity does the work,
      // and inventing a field would only be a second place to disagree.
      priority: 'Normal',
      createdAt: exam.createdAt,
      maxMinutesPerDay: spacing.maxMinutesPerDay,
      finalReviewMinutes: spacing.finalReviewMinutes,
    });
  }

  return tasks;
}
