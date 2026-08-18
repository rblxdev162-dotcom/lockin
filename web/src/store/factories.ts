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
import type { ChallengePhase, VerificationChallenge } from '../types/edgenuity';
import { splitIsoToLocal, todayISO, uid } from '../lib/time';
import { isVerifiedComplete } from '../lib/canvas/verification';
import {
  challengeExpiryFrom,
  generateChallengeValue,
  hashChallengeValue,
} from '../lib/edgenuity/challenge';

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
    priority: detected.submissionStatus === 'missing' ? 'Urgent' : 'Normal',
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
    canvas: {
      domain,
      url: detected.url,
      submissionStatus: detected.submissionStatus,
      lastCheckedAt: detected.detectedAt,
      lastStatusChangeAt: detected.detectedAt,
      courseName: detected.courseName,
      kind: detected.kind,
    },
  };
}

/**
 * Issues a one-time challenge (Phase 5).
 *
 * A factory rather than something the reducer conjures, matching how
 * assignments are built: the random value comes from `crypto.getRandomValues`
 * in one place, and the reducer stays a function of its inputs.
 *
 * `sessionId` is null for the starting challenge — the session it will belong
 * to does not exist until the starting proof is accepted.
 */
export function createChallenge(
  assignmentId: string,
  phase: ChallengePhase,
  sessionId: string | null = null,
): VerificationChallenge {
  const now = new Date().toISOString();
  const value = generateChallengeValue();
  return {
    id: uid('chl'),
    assignmentId,
    sessionId,
    phase,
    type: 'visual_code',
    value,
    valueHash: hashChallengeValue(value),
    createdAt: now,
    expiresAt: challengeExpiryFrom(now),
    status: 'pending',
    attempts: 0,
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
