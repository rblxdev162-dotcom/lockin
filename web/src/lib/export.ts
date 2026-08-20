/**
 * "Export my LockIn data" (Phase 8).
 *
 * Built as an **allowlist**: every field in the output is named here on
 * purpose. That is the whole design. A denylist ("copy the state, delete the
 * PIN") leaks the next secret somebody adds, and this file is the one place in
 * LockIn where local-only data is turned into a file that can be emailed,
 * uploaded or dropped in a shared folder.
 *
 * Never exported, and asserted in `extension/tests/release.test.mjs`:
 *   - the parent PIN hash, its salt, or anything derived from them
 *   - challenge values or value hashes (a live code is a secret for 5 minutes,
 *     and a spent one still shows what the alphabet looks like)
 *   - raw OCR text, photographs, or anything image-shaped (none of which is
 *     stored in the first place — see types/edgenuity.ts)
 *   - Canvas cookies, tokens or session identifiers (LockIn never has any)
 *
 * The export is for a human and for portability, not for re-import: there is
 * deliberately no importer, because an importer is a path that turns a text
 * file a student can edit into verified progress.
 */
import type { AppState } from '../types';

export const EXPORT_FORMAT_VERSION = 1;

export interface LockInExport {
  format: 'lockin-export';
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  schemaVersion: number;
  /** Present so a reader knows this is not a backup that can be restored. */
  readonly note: string;
  profile: { firstName: string } | null;
  assignments: unknown[];
  exams: unknown[];
  focusSessions: unknown[];
  focusRuns: unknown[];
  activity: unknown[];
  verification: unknown[];
  planner: unknown;
  settings: unknown;
  blockedSiteCounts: unknown[];
  parentControls: unknown;
  parentPinSet: boolean;
}

export function buildExport(state: AppState, appVersion: string, now = new Date()): LockInExport {
  return {
    format: 'lockin-export',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    schemaVersion: state.schemaVersion,
    note: 'A readable copy of what LockIn stores on this device. LockIn cannot import this file back.',

    profile: state.profile ? { firstName: state.profile.firstName } : null,

    assignments: state.assignments.map((a) => ({
      title: a.title,
      subject: a.subject,
      platform: a.platform,
      dueDate: a.dueDate,
      dueTime: a.dueTime,
      estimatedMinutes: a.estimatedMinutes,
      loggedMinutes: a.loggedMinutes,
      priority: a.priority,
      status: a.status,
      completionMethod: a.completionMethod,
      createdAt: a.createdAt,
      completedAt: a.completedAt ?? null,
      verificationStatus: a.verificationStatus,
      // The link, not the credentials: a Canvas URL is a bookmark, and LockIn
      // has never held a Canvas password or token to leak alongside it.
      canvas: a.canvas
        ? { domain: a.canvas.domain, url: a.canvas.url, submissionStatus: a.canvas.submissionStatus }
        : null,
    })),

    exams: state.exams.map((e) => ({
      name: e.name,
      subject: e.subject,
      examDate: e.examDate,
      materialAmount: e.materialAmount,
      studyEstimateMinutes: e.studyEstimateMinutes ?? null,
      loggedMinutes: e.loggedMinutes,
      confidenceLevel: e.confidenceLevel ?? null,
    })),

    focusSessions: state.completedSessions.map((s) => ({
      assignmentTitle: s.assignmentTitle,
      plannedMinutes: s.plannedMinutes,
      actualMinutes: s.actualMinutes,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    })),

    focusRuns: state.focusRuns.map((r) => ({
      startedAt: r.startedAt,
      endedAt: r.endedAt ?? null,
      requiredCount: r.requiredCount,
      completedCount: r.completedCount,
      outcome: r.outcome,
      note: r.note ?? null,
      wasTest: r.isTest,
      unlocks: r.unlocks.map((u) => ({
        minutes: u.minutes,
        startedAt: u.startedAt,
        byParent: u.byParent,
      })),
      // Counters only. LockIn has no browsing history to export because it has
      // never collected one.
      blockedSiteCounts: r.blocked.map((b) => ({ domain: b.domain, count: b.count })),
    })),

    activity: state.activity.map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
      message: e.message,
    })),

    /**
     * Verification summaries, flattened out of the assignments they belong to.
     * These are the small structured facts the Parent Dashboard reads — a
     * status, a percentage, a timestamp. There is no evidence blob to export
     * because none is kept.
     */
    verification: state.assignments.flatMap((a) =>
      a.verificationRecords.map((r) => ({
        assignmentTitle: a.title,
        type: r.type,
        status: r.status,
        timestamp: r.timestamp,
        sourceDomain: r.sourceDomain ?? null,
        note: r.note ?? null,
      })),
    ),

    planner: {
      configured: state.planner.settings.configured,
      workloadPreference: state.planner.settings.workloadPreference,
      horizonDays: state.planner.settings.horizonDays,
      availability: state.planner.settings.availability,
      fixedBlocks: state.planner.settings.fixedBlocks,
      currentPlan: state.planner.plan
        ? {
            generatedAt: state.planner.plan.generatedAt,
            planVersion: state.planner.plan.planVersion,
            days: state.planner.plan.days.map((d) => ({
              date: d.date,
              plannedMinutes: d.plannedMinutes,
              items: d.items.map((i) => ({
                title: i.title,
                subject: i.subject,
                plannedMinutes: i.plannedMinutes,
                chunk: `${i.chunkIndex}/${i.chunkCount}`,
                status: i.status,
              })),
            })),
          }
        : null,
    },

    settings: {
      reminderMode: state.settings.reminderMode,
      defaultStudyTime: state.settings.defaultStudyTime,
      defaultFocusMinutes: state.settings.defaultFocusMinutes,
      blockingEnabled: state.settings.blockingEnabled,
      blockedDomains: state.settings.blockedDomains,
      allowedDomains: state.settings.allowedDomains,
      theme: state.settings.theme,
    },

    blockedSiteCounts: state.blockStats.map((b) => ({ domain: b.domain, count: b.count })),

    parentControls: { ...state.parentControls },

    // Whether a PIN exists is useful; the PIN itself, its hash and its salt are
    // not in this file at any depth.
    parentPinSet: state.parentPin !== null,
  };
}

/** A filename a human can find again: `lockin-export-2026-08-16.json`. */
export function exportFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `lockin-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * Hands the file to the browser's download machinery.
 *
 * Kept separate from `buildExport` so the shape can be tested in Node without
 * a DOM — the safety of this feature lives entirely in what the object
 * contains, not in how it reaches the disk.
 */
export function downloadExport(data: LockInExport, filename = exportFilename()): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some Chrome versions.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
