/** Builders that guarantee every new record is schema-complete. */
import type {
  Assignment,
  CanvasDetectedAssignment,
  ConfidenceLevel,
  Exam,
  MaterialAmount,
  Platform,
  Priority,
  Status,
} from '../types';
import type { FeedItem } from '../lib/canvas/calendarFeed';
import { feedSource } from '../lib/canvas/calendarFeed';
import { manualSource } from '../lib/sources/freshness';
import { splitIsoToLocal, todayISO, uid } from '../lib/time';
import { isVerifiedComplete } from '../lib/canvas/verification';

export interface AssignmentDraft {
  title: string;
  subject: string;
  platform: Platform;
  dueDate: string;
  dueTime: string;
  estimatedMinutes: number;
  priority: Priority;
  status?: Status;
  firstReminderMinutes?: number;
  escalationMinutes?: number;
  focusWarningMinutes?: number;
  remindersEnabled?: boolean;
  steps?: string[];
}

export function createAssignment(draft: AssignmentDraft): Assignment {
  const now = new Date().toISOString();
  return {
    id: uid('asg'),
    title: draft.title.trim(),
    subject: draft.subject.trim() || 'General',
    platform: draft.platform,
    dueDate: draft.dueDate,
    dueTime: draft.dueTime || '23:59',
    estimatedMinutes: Math.max(5, Math.round(draft.estimatedMinutes || 30)),
    priority: draft.priority,
    status: draft.status ?? 'Not Started',
    completionMethod: 'manual',
    createdAt: now,
    updatedAt: now,
    loggedMinutes: 0,
    reminders: {
      firstReminderMinutes: draft.firstReminderMinutes ?? 120,
      escalationMinutes: draft.escalationMinutes ?? 60,
      focusWarningMinutes: draft.focusWarningMinutes ?? 30,
      enabled: draft.remindersEnabled ?? true,
    },
    remindersFired: [],
    verificationStatus: 'not_required',
    verificationRecords: [],
    steps: (draft.steps ?? []).filter((text) => text.trim()).slice(0, 20).map((text, index) => ({
      id: `step-${Date.now()}-${index}`,
      text: text.trim().slice(0, 160),
      done: false,
    })),
    // Everything built from a draft was typed by the student. Stamping it
    // MANUAL is not a demotion — it is what lets the Pace Engine treat a
    // hand-typed due date as the student's own claim rather than as school
    // data that has gone stale.
    source: manualSource(now),
  };
}

/**
 * Builds a LockIn assignment from one calendar-feed item.
 *
 * The estimate is the one field the feed cannot supply, so it gets LockIn's
 * usual default rather than a fabricated number — `estimateFor()` in the
 * capture flow learns a better one from the student's own logged time, and a
 * feed import is exactly the case where guessing confidently would be worst.
 *
 * Nothing here sets a status. A calendar feed says when work is due and never
 * whether it was handed in, and inferring completion from a feed is the single
 * most damaging mistake this integration could make.
 */
export function createAssignmentFromFeed(
  item: FeedItem,
  options: { sourceId: string; syncedAt: string; live: boolean },
): Assignment {
  const now = new Date().toISOString();
  return {
    ...createAssignment({
      title: item.title,
      subject: item.courseName ?? '',
      platform: 'Canvas',
      dueDate: item.dueDate,
      dueTime: item.dueTime,
      estimatedMinutes: 30,
      priority: 'Normal',
    }),
    createdAt: now,
    updatedAt: now,
    externalAssignmentId: item.externalAssignmentId,
    source: feedSource(options.sourceId, item.externalId, options.syncedAt, options.live),
  };
}

/**
 * Builds a LockIn assignment from a detected Canvas assignment.
 *
 * `completionMethod: 'canvas'` is what makes the UI offer "Check Canvas Status"
 * instead of a plain Mark Complete button, and the two external ids are the
 * identity used to prevent duplicate imports.
 */
export function createAssignmentFromCanvas(
  detected: CanvasDetectedAssignment,
  domain: string,
): Assignment {
  const now = new Date().toISOString();
  const due = detected.dueAt ? splitIsoToLocal(detected.dueAt) : null;
  const verified = isVerifiedComplete(detected.submissionStatus);

  return {
    id: uid('asg'),
    title: detected.title.trim().slice(0, 200) || 'Canvas assignment',
    subject: (detected.courseName || 'Canvas').trim().slice(0, 120),
    platform: 'Canvas',
    // Canvas assignments without a due date are real; fall back to today so the
    // assignment is still visible rather than silently sorted to the end.
    dueDate: due?.date ?? todayISO(),
    dueTime: due?.time ?? '23:59',
    estimatedMinutes: 30,
    // "Missing" is urgent for work Canvas could have received. For paper
    // homework it only means the teacher has not marked it yet, so importing
    // one would otherwise arrive pre-panicked.
    priority:
      detected.submissionStatus === 'missing' &&
      detected.submissionType !== 'on_paper' &&
      detected.submissionType !== 'none'
        ? 'Urgent'
        : 'Normal',
    status: verified ? 'Completed' : 'Not Started',
    completionMethod: 'canvas',
    verificationMethod: 'canvas',
    createdAt: now,
    updatedAt: now,
    completedAt: verified ? now : undefined,
    loggedMinutes: 0,
    reminders: {
      firstReminderMinutes: 120,
      escalationMinutes: 60,
      focusWarningMinutes: 30,
      enabled: true,
    },
    remindersFired: [],
    externalCourseId: detected.externalCourseId,
    externalAssignmentId: detected.externalAssignmentId,
    verificationStatus: verified ? 'verified' : 'pending',
    verificationRecords: verified
      ? [
          {
            id: uid('ver'),
            type: 'canvas_submission',
            timestamp: now,
            status: 'verified',
            sourceDomain: domain,
            externalCourseId: detected.externalCourseId,
            externalAssignmentId: detected.externalAssignmentId,
            evidence: { canvasStatus: detected.submissionStatus },
          },
        ]
      : [],
    steps: [],
    canvas: {
      domain,
      url: detected.url,
      submissionStatus: detected.submissionStatus,
      lastCheckedAt: detected.detectedAt,
      lastStatusChangeAt: detected.detectedAt,
      courseName: detected.courseName,
      kind: detected.kind,
      submissionType: detected.submissionType,
    },
  };
}

export interface ExamDraft {
  name: string;
  subject: string;
  examDate: string;
  materialAmount: MaterialAmount;
  /** Planner override; when absent the material amount picks the default. */
  studyEstimateMinutes?: number;
  confidenceLevel?: ConfidenceLevel;
}

export function createExam(draft: ExamDraft): Exam {
  const now = new Date().toISOString();
  return {
    id: uid('exm'),
    name: draft.name.trim(),
    subject: draft.subject.trim() || 'General',
    examDate: draft.examDate,
    materialAmount: draft.materialAmount,
    createdAt: now,
    updatedAt: now,
    studyEstimateMinutes:
      typeof draft.studyEstimateMinutes === 'number' && Number.isFinite(draft.studyEstimateMinutes)
        ? Math.max(0, Math.round(draft.studyEstimateMinutes))
        : undefined,
    confidenceLevel: draft.confidenceLevel,
    loggedMinutes: 0,
  };
}
