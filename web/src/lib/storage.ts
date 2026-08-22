/**
 * Versioned localStorage persistence.
 *
 * Everything stays on the device. `load()` never throws: corrupted or
 * partially-written state falls back to defaults (and stashes the bad blob
 * under a `.corrupt` key so nothing is silently destroyed).
 */
import type {
  ActivityEvent,
  AppState,
  BlockStat,
  Assignment,
  AvailabilityDay,
  CompletedSession,
  Exam,
  FixedBlock,
  FocusRun,
  PlanManualOrder,
  PlanReason,
  PlanRecovery,
  PlanSkip,
  PlanVersionEntry,
  PlanWarning,
  PlannedDay,
  PlannedWorkItem,
  PlannerSettings,
  PlannerState,
  PlanningReason,
  StudyPlan,
  FocusRunUnlock,
  ParentControls,
  CanvasLink,
  CanvasReadCoverage,
  CanvasState,
  Settings,
  CanvasCalendarConfig,
  IntegrationRecord,
  IntegrationsState,
  SourceRecord,
} from '../types';
import { INTEGRATION_IDS, INTEGRATION_STATUSES } from '../types/integrations';
import { CONFIDENCES, SOURCE_KINDS } from '../types/source';
import { CANVAS_SUBMISSION_STATUSES, defaultCanvasState } from '../types/canvas';
import { FOCUS_RUN_OUTCOMES, MAX_FOCUS_RUNS, defaultParentControls } from '../types/parent';
import {
  MAX_PLAN_HISTORY,
  MAX_PLAN_SKIPS,
  PLAN_ITEM_STATUSES,
  PLAN_REASONS,
  PLAN_WARNING_KINDS,
  PLANNING_REASON_CODES,
  WORKLOAD_PREFERENCES,
  defaultPlannerSettings,
  defaultPlannerState,
} from '../types/planner';
import { ACTIVITY_TYPES } from '../types';
import { defaultGradesState } from '../types/grades';
import type { CourseGrade, GradesState } from '../types/grades';
import { defaultCheckWindow, normalizeCheckWindow } from './canvas/checkWindow';
import { defaultSchoolSchedule, normalizeSchoolSchedule } from './schoolSchedule';
import { DEFAULT_ALLOWLIST } from './domains';
import {
  MAX_BLOCK_STATS,
  MAX_COMPLETED_SESSIONS,
  trimActivity,
  trimVerificationRecords,
} from './retention';

/**
 * The storage key is intentionally frozen at `.v1` — it is the *location*, not
 * the schema. Schema changes are handled by SCHEMA_VERSION + MIGRATIONS so
 * existing users are upgraded in place rather than wiped.
 */
export const STORAGE_KEY = 'lockin.state.v1';
export const CORRUPT_KEY = 'lockin.state.corrupt';
export const SCHEMA_VERSION = 16;

export function defaultSettings(): Settings {
  return {
    reminderMode: 'Normal',
    defaultStudyTime: '17:00',
    defaultFocusMinutes: 25,
    blockingEnabled: true,
    blockedDomains: [],
    allowedDomains: [...DEFAULT_ALLOWLIST],
    notificationsAsked: false,
    theme: 'system',
    extensionSeen: false,
    // On by default: it is observation, not obstruction, and it is the option
    // students actually keep. Onboarding still announces it.
    focusGuard: true,
    blockingAsked: false,
    // Blocking stays out of the school day unless the student says otherwise.
    pauseBlockingDuringSchool: true,
    // The point of a homework blocker is the afternoon nobody opts into.
    autoBlockAfterSchool: true,
    canvasCheckWindow: defaultCheckWindow(),
    schoolSchedule: defaultSchoolSchedule(),
  };
}

export function defaultState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: null,
    assignments: [],
    exams: [],
    settings: defaultSettings(),
    focusMode: {
      active: false,
      startedAt: null,
      requiredTaskIds: [],
      requiredCompletionCount: 0,
      completedCount: 0,
      temporaryUnlockUntil: null,
      overrideUsed: false,
      emergencyExitUsed: false,
      isTest: false,
      testExpiresAt: null,
    },
    activeSession: null,
    completedSessions: [],
    activity: [],
    parentPin: null,
    blockStats: [],
    canvas: defaultCanvasState(),
    parentControls: defaultParentControls(),
    focusRuns: [],
    planner: defaultPlannerState(),
    integrations: defaultIntegrationsState(),
    grades: defaultGradesState(),
  };
}

/**
 * No connections, no courses. Every integration starts `not_configured`
 * except the two that cannot be configured on this install at all.
 */
export function defaultIntegrationsState(): IntegrationsState {
  return {
    records: INTEGRATION_IDS.map((id) => ({
      id,
      // `unavailable` is not the same as "off": these need an authorization
      // nobody has, so the UI must explain rather than offer a dead button.
      status:
        id === 'canvas_oauth'
          ? ('unavailable' as const)
          : ('not_configured' as const),
    })),
    canvasCalendar: { configured: false, refreshMinutes: 15, horizonDays: 120 },
  };
}

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

/**
 * Map of `fromVersion -> migration`. To ship a schema change: bump
 * SCHEMA_VERSION, add `[n]: (s) => ...` here. Users are never wiped.
 */
const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: pre-release states had no schemaVersion.
  0: (s) => ({ ...s, schemaVersion: 1 }),

  // 1 -> 2 (Phase 3): add the Canvas slice. Everything a Phase 2 user already
  // had — assignments, exams, activity, blocklists, PIN, sessions — is carried
  // through untouched; only the new key is introduced.
  1: (s) => ({
    ...s,
    schemaVersion: 2,
    canvas: (s.canvas as CanvasState | undefined) ?? defaultCanvasState(),
  }),

  // 2 -> 3 (Phase 4): added the Edgenuity slice.
  //
  // Kept as a no-op rather than deleted. A save file at v2 still has to walk
  // every step to reach the current version, and a missing step would strand
  // it. The slice this used to add is removed again by v10.
  2: (s) => ({ ...s, schemaVersion: 3 }),

  // 3 -> 4 (Phase 5): added the challenge ledger. No-op for the same reason
  // as v2 above.
  3: (s) => ({ ...s, schemaVersion: 4 }),

  // 4 -> 5 (Phase 6): add parent controls and the Focus Mode run history.
  // Everything earlier is carried through untouched. The controls default to
  // *off*: an upgrade must never silently start demanding a PIN for settings
  // the student could change yesterday, and it must never retroactively raise
  // a verification requirement.
  4: (s) => ({
    ...s,
    schemaVersion: 5,
    parentControls: (s.parentControls as ParentControls | undefined) ?? defaultParentControls(),
    // History starts empty; there is no honest way to reconstruct past runs.
    focusRuns: (s.focusRuns as FocusRun[] | undefined) ?? [],
  }),

  // 5 -> 6 (Phase 7): add the Smart Study Planner slice, and give every exam
  // the two planner fields.
  //
  // Everything earlier is carried through untouched: assignments, Canvas and
  // Edgenuity links, verification records, focus history, parent controls, the
  // PIN and both domain lists. No plan is generated here — a plan is a function
  // of settings the student has not chosen yet, and inventing one at load time
  // would produce a schedule nobody asked for out of defaults nobody saw.
  5: (s) => ({
    ...s,
    schemaVersion: 6,
    exams: asArray<Record<string, unknown>>(s.exams).map((exam) => ({
      ...exam,
      loggedMinutes: Number.isFinite(exam?.loggedMinutes) ? exam.loggedMinutes : 0,
    })),
    planner: (s.planner as PlannerState | undefined) ?? defaultPlannerState(),
  }),

  // 6 -> 7 (Phase 8): record whether Browser Protection has ever answered on
  // this device, so the app can tell "never installed" from "stopped
  // responding" after a restart.
  //
  // Everything earlier is carried through untouched. The flag starts `true`
  // for existing users *only* when there is evidence the extension was in use
  // — block counts can only have been written by it. Defaulting everyone to
  // `true` would make a brand-new install claim it had lost an extension it
  // never had; defaulting everyone to `false` would tell a long-time user with
  // a broken extension that they simply never installed one.
  6: (s) => ({
    ...s,
    schemaVersion: 7,
    settings: {
      ...(s.settings as Settings | undefined),
      extensionSeen: asArray<unknown>(s.blockStats).length > 0,
    },
  }),

  // 7 -> 8 (Phase 9): add Focus Guard and the blocking question.
  //
  // Everything earlier is carried through untouched. Focus Guard starts on,
  // matching a new install; `blockingAsked` starts *true* for existing users,
  // because they have already seen the extension setup and being asked again
  // after an update would read as nagging rather than as consent. Past focus
  // runs get zeroes: there is no honest way to reconstruct away-time that was
  // never measured.
  7: (s) => ({
    ...s,
    schemaVersion: 8,
    settings: {
      ...(s.settings as Settings | undefined),
      focusGuard: true,
      blockingAsked: true,
    },
    focusRuns: asArray<Record<string, unknown>>(s.focusRuns).map((run) => ({
      ...run,
      awayCount: Number.isFinite(run?.awayCount) ? run.awayCount : 0,
      awayMs: Number.isFinite(run?.awayMs) ? run.awayMs : 0,
    })),
  }),
  // 8 -> 9 (Phase 16): provenance, integrations, and the end of the browser
  // reading path.
  //
  // Three things happen here, and each is a decision rather than a rename:
  //
  //  1. **Every existing assignment gains a `source`.** Anything Canvas ever
  //     linked is stamped CANVAS_CALENDAR with no `lastSyncedAt` — which
  //     classifies as UNAVAILABLE until a feed is actually connected, rather
  //     than as fresh data nobody has checked. Everything else is MANUAL,
  //     because that is what it was.
  //  2. **`integrations` is created empty.** No connection is ever inferred
  //     from the presence of old data.
  8: (s) => ({
    ...s,
    schemaVersion: 9,
    assignments: asArray<Record<string, unknown>>(s.assignments).map((a) => {
      const linkedToCanvas = !!a?.canvas;
      return {
        ...a,
        source: a?.source ?? {
          kind: linkedToCanvas ? 'CANVAS_CALENDAR' : 'MANUAL',
          sourceId: linkedToCanvas ? 'canvas-legacy' : 'manual',
          confidence: 'low',
          isLive: false,
          rawDataRetained: false,
        },
      };
    }),
    settings: (() => {
      const { edgenuityBridgeEnabled: _drop, ...settings } = (s.settings ??
        {}) as Record<string, unknown>;
      return settings;
    })(),
    integrations: defaultIntegrationsState(),
  }),
  // 9 -> 10 (Phase 17): Edgenuity removed.
  //
  // The whole `edgenuity` slice goes — sessions, challenges, the OCR flags —
  // along with the per-assignment link and the proof-mode setting. The feature
  // was scrapped because the only channels that were ethical to use (a weekly
  // progress email, a course report file) could not reach this student's
  // browser profile, which made them useless for live data.
  //
  // What is deliberately *kept*: every `verificationRecords` entry, including
  // ones written by Edgenuity. They are history — a record that work was
  // verified on a date — and deleting a student's own completion history to
  // tidy up a removed integration would be the wrong trade. `Platform` no
  // longer has an `Edgenuity` member, so any assignment still carrying it is
  // moved to `Other`; it keeps its title, its due date and its logged time.
  9: (s) => {
    const { edgenuity: _slice, ...rest } = s as Record<string, unknown>;
    const { edgenuityProofMode: _mode, ...settings } = (s.settings ?? {}) as Record<
      string,
      unknown
    >;
    return {
      ...rest,
      schemaVersion: 10,
      settings,
      assignments: asArray<Record<string, unknown>>(s.assignments).map((a) => {
        const { edgenuity: _link, ...assignment } = a ?? {};
        return {
          ...assignment,
          platform: assignment.platform === 'Edgenuity' ? 'Other' : assignment.platform,
        };
      }),
    };
  },
  // 10 -> 11 (Phase 18): the Canvas check window, and class grades.
  //
  // Both are additive, and the window's default is the conservative one:
  // `manual`, so an existing install that was quietly refreshing a calendar
  // feed every thirty minutes stops doing that on upgrade rather than
  // inheriting an automatic behaviour the student never chose. Nothing is
  // dropped — an upgrade must never cost a student their history
  // (invariant 34).
  10: (s) => ({
    ...s,
    schemaVersion: 11,
    settings: {
      ...((s.settings ?? {}) as Record<string, unknown>),
      canvasCheckWindow: normalizeCheckWindow(
        ((s.settings ?? {}) as Record<string, unknown>).canvasCheckWindow,
      ),
    },
    grades: defaultGradesState(),
  }),
  // 11 -> 12: a privacy-safe receipt of the last Canvas check.
  11: (s) => ({
    ...s,
    schemaVersion: 12,
    canvas: {
      ...((s.canvas ?? {}) as Record<string, unknown>),
      lastCheckReport: null,
    },
  }),
  12: (s) => ({
    ...s,
    schemaVersion: 13,
    settings: {
      ...((s.settings ?? {}) as Record<string, unknown>),
      schoolSchedule: defaultSchoolSchedule(),
    },
  }),
  // 13 -> 14: the Canvas check receipt records what the current rendered page
  // actually yielded. Old receipts stay readable, but deliberately gain no
  // inferred coverage: a pageKind alone cannot prove that its rows parsed.
  13: (s) => ({
    ...s,
    schemaVersion: 14,
    canvas: {
      ...((s.canvas ?? {}) as Record<string, unknown>),
      lastCheckReport:
        s.canvas && typeof s.canvas === 'object'
          ? ((s.canvas as Record<string, unknown>).lastCheckReport ?? null)
          : null,
    },
  }),
  // 14 -> 15: website blocking pauses during school hours. Existing students
  // get it on, because it is the behaviour they would have chosen: nobody
  // installs a homework blocker in order to be blocked during class.
  14: (s) => ({
    ...s,
    schemaVersion: 15,
    settings: {
      ...((s.settings ?? {}) as Record<string, unknown>),
      pauseBlockingDuringSchool: true,
    },
  }),
  // 15 -> 16: blocking runs through homework hours by itself, and the schedule
  // learns which dates are not school days. Existing students get automatic
  // blocking on, because "only when I remember to press Start" is the failure
  // mode this app exists to fix — Settings turns it off in one tap.
  15: (s) => {
    const settings = (s.settings ?? {}) as Record<string, unknown>;
    const schedule = (settings.schoolSchedule ?? {}) as Record<string, unknown>;
    return {
      ...s,
      schemaVersion: 16,
      settings: {
        ...settings,
        autoBlockAfterSchool: true,
        schoolSchedule: { ...schedule, noSchoolDates: [] },
      },
    };
  },
};

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let state = raw;
  let version = typeof state.schemaVersion === 'number' ? state.schemaVersion : 0;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break;
    state = step(state);
    version = typeof state.schemaVersion === 'number' ? state.schemaVersion : version + 1;
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Coercion — defends against hand-edited or half-written storage      */
/* ------------------------------------------------------------------ */

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function coerceAssignment(raw: unknown): Assignment | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<Assignment>;
  if (!a.id || typeof a.title !== 'string') return null;
  const now = new Date().toISOString();
  return {
    id: String(a.id),
    title: a.title,
    subject: typeof a.subject === 'string' ? a.subject : '',
    platform: a.platform ?? 'Other',
    dueDate: typeof a.dueDate === 'string' ? a.dueDate : '',
    dueTime: typeof a.dueTime === 'string' ? a.dueTime : '23:59',
    // Clamped, not merely finiteness-checked. Remaining work is
    // `estimate − logged`, so a negative `logged` invents work that was never
    // set, and a negative `estimate` makes an assignment permanently "done" to
    // the planner. Neither is a shape the reducer can produce, but a
    // hand-edited or half-written file can.
    estimatedMinutes: clampInt(a.estimatedMinutes, 0, 100_000, 30),
    priority: a.priority ?? 'Normal',
    status: a.status ?? 'Not Started',
    completionMethod: a.completionMethod ?? 'manual',
    createdAt: a.createdAt ?? now,
    updatedAt: a.updatedAt ?? now,
    completedAt: a.completedAt,
    loggedMinutes: clampInt(a.loggedMinutes, 0, 100_000, 0),
    reminders: a.reminders ?? {
      firstReminderMinutes: 120,
      escalationMinutes: 60,
      focusWarningMinutes: 30,
      enabled: true,
    },
    remindersFired: asArray<string>(a.remindersFired),
    verificationMethod: a.verificationMethod,
    externalAssignmentId: a.externalAssignmentId,
    externalCourseId: a.externalCourseId,
    verificationStatus: a.verificationStatus ?? 'not_required',
    verificationRecords: trimVerificationRecords(asArray(a.verificationRecords)),
    canvas: coerceCanvasLink(a.canvas),
    steps: asArray<Record<string, unknown>>(a.steps).flatMap((step, index) => {
      const text = typeof step?.text === 'string' ? step.text.trim().slice(0, 160) : '';
      return text ? [{ id: typeof step.id === 'string' ? step.id.slice(0, 80) : `step-${index}`, text, done: step.done === true }] : [];
    }).slice(0, 20),
    // Rebuilt like everything else: a `source` added to the type but not
    // rebuilt here would be silently dropped on every reload, which is the
    // exact bug `lastVerifiedTrust` shipped with in Phase 5.
    source: coerceSource(a.source),
  };
}




/** A half-written Canvas link is dropped rather than trusted. */
function coerceCanvasLink(raw: unknown): CanvasLink | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Partial<CanvasLink>;
  if (typeof c.domain !== 'string' || typeof c.url !== 'string') return undefined;
  return {
    domain: c.domain,
    url: c.url,
    submissionStatus: (CANVAS_SUBMISSION_STATUSES as readonly string[]).includes(
      c.submissionStatus as string,
    )
      ? (c.submissionStatus as CanvasLink['submissionStatus'])
      : 'unknown',
    lastCheckedAt: typeof c.lastCheckedAt === 'string' ? c.lastCheckedAt : null,
    lastStatusChangeAt: typeof c.lastStatusChangeAt === 'string' ? c.lastStatusChangeAt : null,
    courseName: typeof c.courseName === 'string' ? c.courseName : undefined,
    kind: typeof c.kind === 'string' ? c.kind : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Recovery reporting (Phase 8)                                        */
/* ------------------------------------------------------------------ */

/**
 * What `load()` had to do to make the stored blob usable.
 *
 * The coercion functions below have always repaired quietly. Quiet is right
 * for a stray field, but wrong when a student's exam disappears: they deserve
 * to be told something was lost rather than to discover it the night before.
 * Nothing here is technical enough to show verbatim — the UI turns it into one
 * sentence (see components/layout/RecoveryNotice.tsx).
 */
export interface StorageRecovery {
  /** `reset` means the blob was unreadable and defaults were used instead. */
  kind: 'none' | 'repaired' | 'reset';
  /** Records that could not be repaired and were dropped. */
  dropped: {
    assignments: number;
    exams: number;
    focusRuns: number;
    plan: boolean;
  };
  /** Records removed because a retention cap was over-run. */
  trimmed: {
    activity: number;
    completedSessions: number;
    blockStats: number;
  };
  /** The schema version the file was written by, when it was an older one. */
  migratedFrom: number | null;
}

export function emptyRecovery(): StorageRecovery {
  return {
    kind: 'none',
    dropped: { assignments: 0, exams: 0, focusRuns: 0, plan: false },
    trimmed: { activity: 0, completedSessions: 0, blockStats: 0 },
    migratedFrom: null,
  };
}

/** True when the student should be told something happened. */
export function isSignificantRecovery(r: StorageRecovery): boolean {
  if (r.kind === 'reset') return true;
  const { assignments, exams, focusRuns, plan } = r.dropped;
  // A dropped plan is not worth a message: the plan is a cache and the next
  // rebuild restores it with nothing lost. Trimming is routine housekeeping.
  void plan;
  return assignments + exams + focusRuns > 0;
}

/* ------------------------------------------------------------------ */
/* Integrations and provenance (Phase 16)                              */
/* ------------------------------------------------------------------ */

/**
 * Rebuilds a provenance stamp field by field.
 *
 * An unrecognised `kind` becomes MANUAL rather than being dropped: losing the
 * stamp entirely would make the record look like it had never had a source,
 * and MANUAL is the value that claims the least.
 *
 * `isLive` is forced false on load, always. A save file cannot assert that a
 * connection is answering — only a live handshake can, and one has not
 * happened yet at load time.
 */
function coerceSource(value: unknown): SourceRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const kind = SOURCE_KINDS.includes(raw.kind as never) ? (raw.kind as SourceRecord['kind']) : 'MANUAL';
  return {
    kind,
    sourceId: typeof raw.sourceId === 'string' ? raw.sourceId.slice(0, 64) : 'manual',
    externalId: typeof raw.externalId === 'string' ? raw.externalId.slice(0, 256) : undefined,
    lastSyncedAt: typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : undefined,
    lastVerifiedAt: typeof raw.lastVerifiedAt === 'string' ? raw.lastVerifiedAt : undefined,
    confidence: CONFIDENCES.includes(raw.confidence as never)
      ? (raw.confidence as SourceRecord['confidence'])
      : 'low',
    isLive: false,
    syncError: typeof raw.syncError === 'string' ? raw.syncError.slice(0, 160) : undefined,
    rawDataRetained: raw.rawDataRetained === true,
  };
}






function coerceIntegrationRecord(value: unknown, id: IntegrationRecord['id']): IntegrationRecord {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id,
    status: INTEGRATION_STATUSES.includes(raw.status as never)
      ? (raw.status as IntegrationRecord['status'])
      : 'not_configured',
    lastSyncedAt: typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : undefined,
    lastAttemptAt: typeof raw.lastAttemptAt === 'string' ? raw.lastAttemptAt : undefined,
    lastError: typeof raw.lastError === 'string' ? raw.lastError.slice(0, 160) : undefined,
    lastItemCount: Number.isFinite(raw.lastItemCount)
      ? Math.max(0, Math.round(Number(raw.lastItemCount)))
      : undefined,
    account: typeof raw.account === 'string' ? raw.account.slice(0, 120) : undefined,
  };
}

function coerceCanvasCalendarConfig(value: unknown): CanvasCalendarConfig {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    configured: raw.configured === true,
    // Host only, and only ever a hostname — never a path, which is where the
    // secret in a feed URL lives.
    host:
      typeof raw.host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(raw.host)
        ? raw.host.toLowerCase()
        : undefined,
    connectedAt: typeof raw.connectedAt === 'string' ? raw.connectedAt : undefined,
    refreshMinutes: Number.isFinite(raw.refreshMinutes)
      ? [3, 30].includes(Number(raw.refreshMinutes))
        ? 15
        : Math.min(24 * 60, Math.max(15, Math.round(Number(raw.refreshMinutes))))
      : 15,
    horizonDays: Number.isFinite(raw.horizonDays)
      ? Math.min(365, Math.max(7, Math.round(Number(raw.horizonDays))))
      : 120,
  };
}

function coerceIntegrations(value: unknown): IntegrationsState {
  const base = defaultIntegrationsState();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Record<string, unknown>;
  const stored = asArray<Record<string, unknown>>(raw.records);

  return {
    // Driven by INTEGRATION_IDS rather than by what was stored, so a new
    // integration appears for existing users and a deleted one disappears.
    records: INTEGRATION_IDS.map((id) => {
      const found = stored.find((r) => r?.id === id);
      const record = coerceIntegrationRecord(found, id);
      // These two have no authorization on any install; a save file must not
      // be able to claim otherwise.
      if (id === 'canvas_oauth') record.status = 'unavailable';
      return record;
    }),
    canvasCalendar: coerceCanvasCalendarConfig(raw.canvasCalendar),
  };
}

function coerce(raw: Record<string, unknown>, report = emptyRecovery()): AppState {
  const base = defaultState();
  const settings = { ...base.settings, ...(raw.settings as object | undefined) } as Settings;
  settings.blockedDomains = asArray<string>(settings.blockedDomains).filter(
    (d) => typeof d === 'string',
  );
  settings.allowedDomains = asArray<string>(settings.allowedDomains).filter(
    (d) => typeof d === 'string',
  );
  settings.focusGuard = settings.focusGuard !== false;
  settings.blockingAsked = settings.blockingAsked === true;
  // Defaults on, like `focusGuard`: a save file missing the field belongs to a
  // student who never had the choice, and the pause is the kinder default.
  settings.pauseBlockingDuringSchool = settings.pauseBlockingDuringSchool !== false;
  settings.autoBlockAfterSchool = settings.autoBlockAfterSchool !== false;
  // Rebuilt rather than trusted: a hand-edited save file must not be able to
  // widen the window LockIn is allowed to touch Canvas in, and an unreadable
  // one falls back to the conservative default rather than to "always".
  settings.canvasCheckWindow = normalizeCheckWindow(settings.canvasCheckWindow);
  settings.schoolSchedule = normalizeSchoolSchedule(settings.schoolSchedule);

  const rawAssignments = asArray<unknown>(raw.assignments);
  const assignments = rawAssignments
    .map(coerceAssignment)
    .filter((a): a is Assignment => a !== null);
  report.dropped.assignments += rawAssignments.length - assignments.length;

  const rawExams = asArray<unknown>(raw.exams);
  const exams = rawExams.map(coerceExam).filter((e): e is Exam => e !== null);
  report.dropped.exams += rawExams.length - exams.length;

  const rawRuns = asArray<unknown>(raw.focusRuns);
  const focusRuns = rawRuns
    .map(coerceFocusRun)
    .filter((r): r is FocusRun => r !== null)
    .slice(0, MAX_FOCUS_RUNS);
  report.dropped.focusRuns += Math.max(0, rawRuns.length - focusRuns.length);

  // These three were previously taken on trust (`asArray` with no element
  // check), which meant one malformed entry — a `null`, a number, an object
  // with no `timestamp` — reached the render as-is. They are history, so a bad
  // entry is dropped rather than repaired.
  const rawActivity = asArray<unknown>(raw.activity);
  const activity = trimActivity(
    rawActivity.map(coerceActivityEvent).filter((e): e is ActivityEvent => e !== null),
  );
  report.trimmed.activity += Math.max(0, rawActivity.length - activity.length);

  const rawSessions = asArray<unknown>(raw.completedSessions);
  const completedSessions = rawSessions
    .map(coerceCompletedSession)
    .filter((s): s is CompletedSession => s !== null)
    .slice(0, MAX_COMPLETED_SESSIONS);
  report.trimmed.completedSessions += Math.max(0, rawSessions.length - completedSessions.length);

  const rawStats = asArray<unknown>(raw.blockStats);
  const blockStats = coerceBlockStats(rawStats);
  report.trimmed.blockStats += Math.max(0, rawStats.length - blockStats.length);


  const planner = coercePlanner(raw.planner);
  if (raw.planner && typeof raw.planner === 'object' &&
      (raw.planner as PlannerState).plan && !planner.plan) {
    report.dropped.plan = true;
  }

  return {
    ...base,
    ...(raw as Partial<AppState>),
    schemaVersion: SCHEMA_VERSION,
    settings,
    focusMode: { ...base.focusMode, ...(raw.focusMode as object | undefined) },
    assignments,
    exams,
    completedSessions,
    activity,
    blockStats,
    canvas: coerceCanvas(raw.canvas),
    parentControls: coerceParentControls(raw.parentControls),
    focusRuns,
    planner,
    integrations: coerceIntegrations(raw.integrations),
    grades: coerceGrades(raw.grades),
  };
}

/**
 * Class grades from a save file.
 *
 * Every entry is rebuilt: a stored grade is only ever a copy of what a page
 * showed, so a malformed one is dropped rather than repaired, and a score
 * outside 0–1000 is treated as no score at all rather than clamped into a
 * number nobody ever saw.
 */
function coerceGrades(raw: unknown): GradesState {
  const base = defaultGradesState();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<GradesState>;

  const courses = asArray<unknown>(value.courses)
    .map((entry): CourseGrade | null => {
      if (!entry || typeof entry !== 'object') return null;
      const g = entry as Partial<CourseGrade>;
      if (typeof g.externalCourseId !== 'string' || !g.externalCourseId) return null;
      if (typeof g.readAt !== 'string') return null;
      const score =
        typeof g.currentScore === 'number' &&
        Number.isFinite(g.currentScore) &&
        g.currentScore >= 0 &&
        g.currentScore <= 1000
          ? g.currentScore
          : null;
      const letter = typeof g.currentGrade === 'string' ? g.currentGrade.slice(0, 20) : null;
      return {
        externalCourseId: g.externalCourseId.slice(0, 40),
        courseName: typeof g.courseName === 'string' ? g.courseName.slice(0, 120) : undefined,
        currentScore: score,
        currentGrade: letter,
        totalsHidden: score === null && letter === null,
        readAt: g.readAt,
        totalsHiddenSince:
          typeof g.totalsHiddenSince === 'string' ? g.totalsHiddenSince : undefined,
        url: typeof g.url === 'string' ? g.url.slice(0, 500) : undefined,
      };
    })
    .filter((g): g is CourseGrade => g !== null)
    .slice(0, 50);

  return {
    courses,
    lastReadAt: typeof value.lastReadAt === 'string' ? value.lastReadAt : null,
  };
}

/**
 * One activity entry. Anything without an id, a type the app knows, a
 * timestamp and a message cannot be rendered honestly, so it is dropped.
 */
function coerceActivityEvent(raw: unknown): ActivityEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<ActivityEvent>;
  if (typeof e.id !== 'string' || typeof e.timestamp !== 'string') return null;
  if (!(ACTIVITY_TYPES as readonly string[]).includes(e.type as string)) return null;
  if (typeof e.message !== 'string') return null;
  return {
    id: e.id.slice(0, 64),
    type: e.type as ActivityEvent['type'],
    timestamp: e.timestamp,
    message: e.message.slice(0, 300),
    meta: e.meta && typeof e.meta === 'object' ? e.meta : undefined,
  };
}

/**
 * One finished focus session. Minutes are clamped rather than trusted: a
 * negative or NaN value would flow straight into `logged`, and remaining work
 * is `estimate − logged`, so a bad number here silently un-plans real work.
 */
function coerceCompletedSession(raw: unknown): CompletedSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CompletedSession>;
  // Only the id is required. A session is history that has already been
  // credited to `loggedMinutes`, so dropping one for a missing timestamp would
  // lose a record while keeping the minutes it produced — the worst of both.
  if (typeof s.id !== 'string') return null;
  const startedAt = typeof s.startedAt === 'string' ? s.startedAt : '';
  return {
    id: s.id.slice(0, 64),
    assignmentId: typeof s.assignmentId === 'string' ? s.assignmentId.slice(0, 64) : null,
    examId: typeof s.examId === 'string' ? s.examId.slice(0, 64) : null,
    assignmentTitle: typeof s.assignmentTitle === 'string' ? s.assignmentTitle.slice(0, 200) : null,
    plannedMinutes: clampInt(s.plannedMinutes, 0, 1440, 0),
    actualMinutes: clampInt(s.actualMinutes, 0, 1440, 0),
    startedAt,
    endedAt: typeof s.endedAt === 'string' ? s.endedAt : startedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Planner (Phase 7)                                                   */
/* ------------------------------------------------------------------ */

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function coerceHHMM(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) && Number(value.slice(0, 2)) < 24
    ? value
    : fallback;
}

function coerceISODate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * Exams gained two planner fields in v6. An exam is small and entirely
 * student-authored, so a bad field is repaired rather than the exam dropped —
 * losing an exam date is far worse than losing a study estimate.
 */
function coerceExam(raw: unknown): Exam | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<Exam>;
  if (typeof e.id !== 'string' || typeof e.name !== 'string') return null;
  const now = new Date().toISOString();
  return {
    id: e.id,
    name: e.name.slice(0, 200),
    subject: typeof e.subject === 'string' ? e.subject.slice(0, 120) : 'General',
    examDate: coerceISODate(e.examDate) ?? '',
    materialAmount:
      e.materialAmount === 'Light' || e.materialAmount === 'Heavy' ? e.materialAmount : 'Medium',
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : now,
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : now,
    studyEstimateMinutes:
      typeof e.studyEstimateMinutes === 'number' && Number.isFinite(e.studyEstimateMinutes)
        ? clampInt(e.studyEstimateMinutes, 0, 3000, 0)
        : undefined,
    loggedMinutes: clampInt(e.loggedMinutes, 0, 100_000, 0),
    confidenceLevel:
      e.confidenceLevel === 'Low' || e.confidenceLevel === 'Medium' || e.confidenceLevel === 'High'
        ? e.confidenceLevel
        : undefined,
  };
}

function coerceAvailability(raw: unknown): AvailabilityDay[] {
  const base = defaultPlannerSettings().availability;
  const stored = asArray<Record<string, unknown>>(raw);
  return base.map((fallback) => {
    const row = stored.find((r) => r && Number(r.weekday) === fallback.weekday);
    if (!row) return fallback;
    // An end before the start is not a shorter day, it is a broken row — fall
    // back rather than quietly producing negative capacity.
    const startTime = coerceHHMM(row.startTime, fallback.startTime);
    const endTime = coerceHHMM(row.endTime, fallback.endTime);
    const ordered = endTime > startTime;
    return {
      weekday: fallback.weekday,
      available: row.available !== false,
      startTime: ordered ? startTime : fallback.startTime,
      endTime: ordered ? endTime : fallback.endTime,
      maxMinutes: clampInt(row.maxMinutes, 0, 720, fallback.maxMinutes),
      restDay: row.restDay === true,
    };
  });
}

function coerceFixedBlocks(raw: unknown): FixedBlock[] {
  return asArray<Record<string, unknown>>(raw)
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      const weekday = Number(b.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
      const startTime = coerceHHMM(b.startTime, '');
      const endTime = coerceHHMM(b.endTime, '');
      if (!startTime || !endTime || endTime <= startTime) return null;
      return {
        id: typeof b.id === 'string' ? b.id.slice(0, 64) : `blk_${weekday}_${startTime}`,
        weekday: weekday as FixedBlock['weekday'],
        label: typeof b.label === 'string' ? b.label.slice(0, 60) : 'Busy',
        startTime,
        endTime,
      };
    })
    .filter((b): b is FixedBlock => b !== null)
    .slice(0, 40);
}

function coercePlannerSettings(raw: unknown): PlannerSettings {
  const base = defaultPlannerSettings();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Record<string, unknown>;
  const minChunk = clampInt(s.minChunkMinutes, 5, 60, base.minChunkMinutes);
  const maxChunk = clampInt(s.maxChunkMinutes, minChunk, 120, base.maxChunkMinutes);
  return {
    configured: s.configured === true,
    availability: coerceAvailability(s.availability),
    fixedBlocks: coerceFixedBlocks(s.fixedBlocks),
    weekdayMaxMinutes: clampInt(s.weekdayMaxMinutes, 0, 720, base.weekdayMaxMinutes),
    weekendMaxMinutes: clampInt(s.weekendMaxMinutes, 0, 720, base.weekendMaxMinutes),
    bufferPercent: clampInt(s.bufferPercent, 0, 50, base.bufferPercent),
    focusBlockMinutes: clampInt(s.focusBlockMinutes, 5, 120, base.focusBlockMinutes),
    breakMinutes: clampInt(s.breakMinutes, 0, 60, base.breakMinutes),
    minChunkMinutes: minChunk,
    // Guaranteed >= minChunk by construction above; a saved file with the two
    // crossed over would otherwise make every chunk size unsatisfiable.
    maxChunkMinutes: maxChunk,
    deadlineBufferHours: clampInt(s.deadlineBufferHours, 0, 48, base.deadlineBufferHours),
    workloadPreference: (WORKLOAD_PREFERENCES as readonly string[]).includes(
      s.workloadPreference as string,
    )
      ? (s.workloadPreference as PlannerSettings['workloadPreference'])
      : base.workloadPreference,
    horizonDays: clampInt(s.horizonDays, 1, 60, base.horizonDays),
    useAdjustedEstimates: s.useAdjustedEstimates === true,
  };
}

function coercePlanItem(raw: unknown): PlannedWorkItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const i = raw as Record<string, unknown>;
  const scheduledDate = coerceISODate(i.scheduledDate);
  if (typeof i.id !== 'string' || typeof i.sourceId !== 'string' || !scheduledDate) return null;
  const reason = (i.reason ?? {}) as Record<string, unknown>;
  return {
    id: i.id.slice(0, 120),
    sourceType: i.sourceType === 'exam' ? 'exam' : 'assignment',
    sourceId: i.sourceId.slice(0, 64),
    subject: typeof i.subject === 'string' ? i.subject.slice(0, 120) : '',
    title: typeof i.title === 'string' ? i.title.slice(0, 200) : '',
    chunkIndex: clampInt(i.chunkIndex, 1, 100, 1),
    chunkCount: clampInt(i.chunkCount, 1, 100, 1),
    plannedMinutes: clampInt(i.plannedMinutes, 0, 720, 0),
    reason: {
      codes: asArray<string>(reason.codes)
        .filter((c) => (PLANNING_REASON_CODES as readonly string[]).includes(c))
        .slice(0, 8) as PlannedWorkItem['reason']['codes'],
      facts:
        reason.facts && typeof reason.facts === 'object'
          ? (reason.facts as PlanningReason['facts'])
          : {},
    },
    status: (PLAN_ITEM_STATUSES as readonly string[]).includes(i.status as string)
      ? (i.status as PlannedWorkItem['status'])
      : 'planned',
    scheduledDate,
    originalScheduledDate: coerceISODate(i.originalScheduledDate) ?? undefined,
    priorityScore: typeof i.priorityScore === 'number' && Number.isFinite(i.priorityScore)
      ? i.priorityScore
      : 0,
    startTime: coerceHHMM(i.startTime, '') || undefined,
    endTime: coerceHHMM(i.endTime, '') || undefined,
    finalReview: i.finalReview === true,
  };
}

/**
 * A stored plan is a *cache* of something the engine can rebuild from
 * assignments, exams and settings, so anything unreadable is dropped rather
 * than repaired. The student's own edits — skips, manual ordering, locks —
 * live outside the plan for exactly this reason and survive on their own.
 */
function coercePlan(raw: unknown): StudyPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const start = coerceISODate(p.planningHorizonStart);
  const end = coerceISODate(p.planningHorizonEnd);
  if (typeof p.id !== 'string' || !start || !end) return null;
  const days = asArray<Record<string, unknown>>(p.days)
    .map((d) => {
      const date = coerceISODate(d?.date);
      if (!date) return null;
      const items = asArray<unknown>(d.items)
        .map(coercePlanItem)
        .filter((i): i is PlannedWorkItem => i !== null)
        .slice(0, 40);
      return {
        date,
        availableMinutes: clampInt(d.availableMinutes, 0, 1440, 0),
        capacityMinutes: clampInt(d.capacityMinutes, 0, 1440, 0),
        plannedMinutes: items.reduce((sum, i) => sum + i.plannedMinutes, 0),
        restDay: d.restDay === true,
        items,
      };
    })
    .filter((d): d is PlannedDay => d !== null)
    .slice(0, 60);

  return {
    id: p.id.slice(0, 64),
    planVersion: clampInt(p.planVersion, 1, 1_000_000, 1),
    generatedAt: typeof p.generatedAt === 'string' ? p.generatedAt : new Date().toISOString(),
    reason: (PLAN_REASONS as readonly string[]).includes(p.reason as string)
      ? (p.reason as StudyPlan['reason'])
      : 'initial',
    planningHorizonStart: start,
    planningHorizonEnd: end,
    days,
    warnings: asArray<Record<string, unknown>>(p.warnings)
      .map((w) => {
        if (!w || typeof w !== 'object' || typeof w.id !== 'string') return null;
        if (!(PLAN_WARNING_KINDS as readonly string[]).includes(w.kind as string)) return null;
        const warning: PlanWarning = {
          id: w.id.slice(0, 120),
          kind: w.kind as PlanWarning['kind'],
          severity:
            w.severity === 'critical' || w.severity === 'info'
              ? (w.severity as PlanWarning['severity'])
              : 'warning',
          sourceType:
            w.sourceType === 'exam' ? 'exam' : w.sourceType === 'assignment' ? 'assignment' : undefined,
          sourceId: typeof w.sourceId === 'string' ? w.sourceId.slice(0, 64) : undefined,
          title: typeof w.title === 'string' ? w.title.slice(0, 200) : '',
          date: coerceISODate(w.date) ?? undefined,
          facts: w.facts && typeof w.facts === 'object' ? (w.facts as PlanWarning['facts']) : {},
        };
        return warning;
      })
      .filter((w): w is PlanWarning => w !== null)
      .slice(0, 40),
    unscheduledMinutes: clampInt(p.unscheduledMinutes, 0, 100_000, 0),
  };
}

function coercePlanner(raw: unknown): PlannerState {
  const base = defaultPlannerState();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Record<string, unknown>;
  return {
    settings: coercePlannerSettings(p.settings),
    plan: coercePlan(p.plan),
    history: asArray<Record<string, unknown>>(p.history)
      .map((h) =>
        h && typeof h === 'object' && typeof h.generatedAt === 'string'
          ? {
              planVersion: clampInt(h.planVersion, 1, 1_000_000, 1),
              generatedAt: h.generatedAt,
              reason: (PLAN_REASONS as readonly string[]).includes(h.reason as string)
                ? (h.reason as PlanReason)
                : 'initial',
              plannedMinutes: clampInt(h.plannedMinutes, 0, 100_000, 0),
              itemCount: clampInt(h.itemCount, 0, 10_000, 0),
              warningCount: clampInt(h.warningCount, 0, 10_000, 0),
            }
          : null,
      )
      .filter((h): h is PlanVersionEntry => h !== null)
      .slice(0, MAX_PLAN_HISTORY),
    skips: asArray<Record<string, unknown>>(p.skips)
      .map((s) => {
        const date = coerceISODate(s?.date);
        if (!date || typeof s.sourceId !== 'string') return null;
        return {
          sourceType: s.sourceType === 'exam' ? ('exam' as const) : ('assignment' as const),
          sourceId: s.sourceId.slice(0, 64),
          date,
          createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
        };
      })
      .filter((s): s is PlanSkip => s !== null)
      .slice(0, MAX_PLAN_SKIPS),
    manualOrders: asArray<Record<string, unknown>>(p.manualOrders)
      .map((m) => {
        const date = coerceISODate(m?.date);
        if (!date) return null;
        return {
          date,
          order: asArray<string>(m.order)
            .filter((k) => typeof k === 'string')
            .map((k) => k.slice(0, 80))
            .slice(0, 40),
          updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : new Date().toISOString(),
        };
      })
      .filter((m): m is PlanManualOrder => m !== null)
      .slice(0, 30),
    lockedDates: asArray<string>(p.lockedDates)
      .map((d) => coerceISODate(d))
      .filter((d): d is string => d !== null)
      .slice(0, 30),
    acceptedSubjectFactors: asArray<string>(p.acceptedSubjectFactors)
      .filter((s) => typeof s === 'string')
      .map((s) => s.slice(0, 120))
      .slice(0, 60),
    lastRecovery: coerceRecovery(p.lastRecovery),
  };
}

/** The "plan updated" note. Unreadable means "nothing to announce". */
function coerceRecovery(raw: unknown): PlanRecovery | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PlanRecovery>;
  const date = coerceISODate(r.date);
  if (!date || typeof r.recordedAt !== 'string') return null;
  return {
    date,
    unfinishedMinutes: clampInt(r.unfinishedMinutes, 0, 100_000, 0),
    itemCount: clampInt(r.itemCount, 0, 500, 0),
    recordedAt: r.recordedAt,
  };
}

/** Every control defaults to off — the permissive side — when unreadable. */
function coerceParentControls(raw: unknown): ParentControls {
  const base = defaultParentControls();
  if (!raw || typeof raw !== 'object') return base;
  const c = raw as Partial<ParentControls>;
  return {
    lockVerificationSettings: c.lockVerificationSettings === true,
    protectBlocklistInStrictMode: c.protectBlocklistInStrictMode === true,
    protectAllowlistInStrictMode: c.protectAllowlistInStrictMode === true,
  };
}

function coerceDomainCounts(raw: unknown): { domain: string; count: number }[] {
  return asArray<unknown>(raw)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as { domain?: unknown; count?: unknown };
      if (typeof e.domain !== 'string') return null;
      return {
        domain: e.domain.slice(0, 120),
        count: Number.isFinite(e.count) ? Math.max(0, Math.round(Number(e.count))) : 0,
      };
    })
    .filter((e): e is { domain: string; count: number } => e !== null)
    .slice(0, 100);
}

/**
 * Per-domain block counters. These are the only thing LockIn ever learns about
 * browsing, and they stay counters: a domain and a number, never a URL, never a
 * path, never a title.
 */
function coerceBlockStats(raw: unknown): BlockStat[] {
  return asArray<unknown>(raw)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Partial<BlockStat>;
      if (typeof e.domain !== 'string') return null;
      return {
        domain: e.domain.slice(0, 120),
        count: Number.isFinite(e.count) ? Math.max(0, Math.round(Number(e.count))) : 0,
        lastBlockedAt: typeof e.lastBlockedAt === 'string' ? e.lastBlockedAt : '',
      };
    })
    .filter((e): e is BlockStat => e !== null)
    .slice(0, MAX_BLOCK_STATS);
}

function coerceFocusRunUnlock(raw: unknown): FocusRunUnlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Partial<FocusRunUnlock>;
  if (typeof u.startedAt !== 'string') return null;
  return {
    minutes: Number.isFinite(u.minutes) ? Math.max(0, Number(u.minutes)) : 0,
    startedAt: u.startedAt,
    endedAt: typeof u.endedAt === 'string' ? u.endedAt : undefined,
    byParent: u.byParent === true,
  };
}

function coerceFocusRun(raw: unknown): FocusRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<FocusRun>;
  if (typeof r.id !== 'string' || typeof r.startedAt !== 'string') return null;
  return {
    id: r.id.slice(0, 64),
    startedAt: r.startedAt,
    endedAt: typeof r.endedAt === 'string' ? r.endedAt : undefined,
    requiredTaskIds: asArray<string>(r.requiredTaskIds)
      .filter((id) => typeof id === 'string')
      .slice(0, 50),
    requiredCount: Number.isFinite(r.requiredCount) ? Math.max(0, Number(r.requiredCount)) : 0,
    completedCount: Number.isFinite(r.completedCount) ? Math.max(0, Number(r.completedCount)) : 0,
    outcome: (FOCUS_RUN_OUTCOMES as readonly string[]).includes(r.outcome as string)
      ? r.outcome!
      : 'ended',
    note: typeof r.note === 'string' ? r.note.slice(0, 200) : undefined,
    isTest: r.isTest === true,
    unlocks: asArray<unknown>(r.unlocks)
      .map(coerceFocusRunUnlock)
      .filter((u): u is FocusRunUnlock => u !== null)
      .slice(0, 40),
    blocked: coerceDomainCounts(r.blocked),
    blockBaseline: coerceDomainCounts(r.blockBaseline),
    awayCount: clampInt(r.awayCount, 0, 10_000, 0),
    // A day's worth is the ceiling: anything larger is a clock jump rather
    // than a student, and reporting "away for 3 weeks" would be nonsense.
    awayMs: clampInt(r.awayMs, 0, 86_400_000, 0),
  };
}


function coerceCanvas(raw: unknown): CanvasState {
  const base = defaultCanvasState();
  if (!raw || typeof raw !== 'object') return base;
  const c = raw as Partial<CanvasState>;
  const connection =
    c.connection && typeof c.connection === 'object' && typeof c.connection.domain === 'string'
      ? {
          domain: c.connection.domain,
          mode: 'browser' as const,
          connectedAt: c.connection.connectedAt ?? new Date().toISOString(),
          lastSeenAt: typeof c.connection.lastSeenAt === 'string' ? c.connection.lastSeenAt : null,
          permissionGranted: c.connection.permissionGranted === true,
        }
      : null;
  const reportRaw =
    c.lastCheckReport && typeof c.lastCheckReport === 'object'
      ? (c.lastCheckReport as unknown as Record<string, unknown>)
      : null;
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(10_000, Math.round(value)))
      : 0;
  const coverage: CanvasReadCoverage | undefined =
    reportRaw?.coverage === 'gradebook' ||
    reportRaw?.coverage === 'totals_only' ||
    reportRaw?.coverage === 'limited' ||
    reportRaw?.coverage === 'unreadable' ||
    reportRaw?.coverage === 'dates_only'
      ? reportRaw.coverage
      : undefined;
  const lastCheckReport =
    reportRaw &&
    typeof reportRaw.checkedAt === 'string' &&
    typeof reportRaw.message === 'string'
      ? {
          checkedAt: reportRaw.checkedAt.slice(0, 40),
          origin: reportRaw.origin === 'automatic' ? ('automatic' as const) : ('manual' as const),
          ok: reportRaw.ok === true,
          message: reportRaw.message.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240),
          newAssignments: count(reportRaw.newAssignments),
          updatedAssignments: count(reportRaw.updatedAssignments),
          cancelledAssignments: count(reportRaw.cancelledAssignments),
          pageKind:
            typeof reportRaw.pageKind === 'string' ? reportRaw.pageKind.slice(0, 40) : undefined,
          coverage,
          rowsSeen: count(reportRaw.rowsSeen),
          rowsRead: count(reportRaw.rowsRead),
        }
      : null;
  return {
    connection,
    courses: asArray(c.courses),
    detected: asArray(c.detected),
    ignoredKeys: asArray<string>(c.ignoredKeys).filter((k) => typeof k === 'string'),
    lastSyncAt: typeof c.lastSyncAt === 'string' ? c.lastSyncAt : null,
    lastError: typeof c.lastError === 'string' ? c.lastError : null,
    lastCheckReport,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Reads, migrates and repairs the stored state, and reports what it had to do.
 *
 * Never throws, and never wipes: an unreadable blob is stashed under
 * `lockin.state.corrupt` so it can be inspected (or recovered by hand) rather
 * than destroyed.
 */
export function loadWithRecovery(): { state: AppState; recovery: StorageRecovery } {
  const recovery = emptyRecovery();
  let text: string | null = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage disabled (private mode / blocked cookies) — run in-memory.
    return { state: defaultState(), recovery };
  }
  if (!text) return { state: defaultState(), recovery };

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    const raw = parsed as Record<string, unknown>;
    const storedVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
    if (storedVersion < SCHEMA_VERSION) recovery.migratedFrom = storedVersion;

    const state = coerce(migrate(raw), recovery);
    if (isSignificantRecovery(recovery)) recovery.kind = 'repaired';
    return { state, recovery };
  } catch {
    try {
      localStorage.setItem(CORRUPT_KEY, text);
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* nothing more we can do */ }
    recovery.kind = 'reset';
    return { state: defaultState(), recovery };
  }
}

export function load(): AppState {
  return loadWithRecovery().state;
}

/**
 * Persists the state, shedding history rather than failing if the quota is hit.
 *
 * The order of the fallbacks is the order LockIn is willing to lose things in:
 * activity first, then finished sessions and block counts, then plan history.
 * Assignments, exams, the plan itself, verification records, the PIN and
 * parent settings are never dropped to make room — if those cannot be saved,
 * the write fails and the session continues in memory, which is recoverable;
 * a save that silently deleted homework would not be.
 */
export function save(state: AppState): boolean {
  const attempts: AppState[] = [
    state,
    { ...state, activity: state.activity.slice(0, 50) },
    {
      ...state,
      activity: [],
      completedSessions: state.completedSessions.slice(0, 50),
      blockStats: state.blockStats.slice(0, 20),
    },
    {
      ...state,
      activity: [],
      completedSessions: [],
      blockStats: [],
      focusRuns: state.focusRuns.slice(0, 10),
      planner: { ...state.planner, history: [] },
    },
  ];

  for (const attempt of attempts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(attempt));
      return true;
    } catch {
      /* try the next, smaller, shape */
    }
  }
  return false;
}

export function clearAll(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CORRUPT_KEY);
  } catch { /* ignore */ }
}
