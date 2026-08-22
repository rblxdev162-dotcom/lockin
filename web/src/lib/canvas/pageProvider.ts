/**
 * CanvasPageProvider — Canvas Browser Connection.
 *
 * Reads Canvas pages the student already has open, through the LockIn Chrome
 * extension. No Canvas password, no API key, no OAuth, no network calls of our
 * own — the extension parses the page the student is already looking at.
 *
 * This must never be described to the user as an official Canvas integration.
 *
 * All the real work happens in the extension; this class is the typed,
 * validating client for it.
 */
import { bridge } from '../extensionBridge';
import { MSG } from '../protocol';
import type {
  CanvasAssignmentStatus,
  CanvasConnectionStatus,
  CanvasCourse,
  CanvasDetectedAssignment,
  CanvasSubmissionStatus,
} from '../../types/canvas';
import type { CanvasProvider } from './provider';
import { coerceStatus } from './verification';
import type { CourseGrade } from '../../types/grades';
import { normalizeCheckWindow } from './checkWindow';
import type { CanvasCheckWindow } from './checkWindow';

/** Shape the extension returns for CANVAS_GET_VIEW / CANVAS_VIEW. */
export interface CanvasExtensionView {
  configured: boolean;
  domain: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  permissionGranted: boolean;
  /**
   * True when the extension already holds blanket host access (it does — the
   * blocker needs it). Used so the UI never claims Chrome will prompt when it
   * won't. See extension/background/canvas.js → hasBroadHostAccess.
   */
  broadHostAccess: boolean;
  /** Whether the Canvas reader is actually registered for the domain. */
  scriptRegistered: boolean;
  detected: unknown[];
  detectedCount: number;
  openTabs: number;
  /** Class grades read off a Grades page (Phase 18). Re-validated below. */
  grades: unknown[];
  /** The gate the extension enforces, so the UI can explain a refusal. */
  checkWindow?: CanvasCheckWindow;
  /** Recent gate decisions — allowed and refused — newest first. */
  gateLog?: { at: number; reason: string; verdict: string; allowed: boolean }[];
  /** How many Canvas tabs the student has open, and whether one is a gradebook. */
  canvasTabsOpen: number;
  gradesTabOpen: boolean;
  /** Present on the reply to CANVAS_SYNC. */
  sync?: {
    ok: boolean;
    reason?: string;
    /** Set when the gate refused: which rule, and whether a press can pass it. */
    verdict?: string;
    overridable?: boolean;
    nextAllowedAt?: number | null;
    /** Which kind of Canvas page was read, so the UI can suggest Grades. */
    pageKind?: string;
    pageKinds?: string[];
    readGrades?: boolean;
    /** A page carrying per-assignment submission states was read. */
    readSubmissions?: boolean;
    tabsInjected?: number;
    /** Which Canvas tabs the check found, and whether each answered. */
    tabsSeen?: {
      path: string;
      answered: boolean;
      readable?: boolean;
      injected?: boolean;
      kind?: string;
      error?: string;
    }[];
    tabsChecked?: number;
    /** Tabs that answered and yielded structured Canvas data. */
    readableTabs?: number;
    /** Tabs that answered but whose rendered markup could not be read. */
    unreadableTabs?: number;
    /** A gradebook route answered, even if its markup was unreadable. */
    gradebookAnswered?: boolean;
    /** Privacy-safe parser coverage counts from the selected gradebook. */
    rowsSeen?: number;
    rowsRead?: number;
    found?: number;
    added?: number;
    updated?: number;
    newlySubmitted?: number;
  };
  /** Result of one owned-tab automatic class gradebook read. */
  autoRead?: {
    ok: boolean;
    reason?: string;
    courseId?: string;
    pageKind?: string;
    pageKinds?: string[];
    readGrades?: boolean;
    readSubmissions?: boolean;
    opened?: boolean;
    reused?: boolean;
    closed?: boolean;
  };
  disconnect?: { ok: boolean; permissionRemoved: boolean };
  open?: { ok: boolean; reason?: string };
  configureOk?: boolean;
  promptOpened?: boolean;
  reason?: string;
}

const MAX_DETECTED = 300;

/**
 * Re-validates everything the extension hands back.
 * The extension already validates Canvas page data at its own trust boundary;
 * doing it again here means the React state can only ever hold known shapes.
 */
export function sanitizeDetected(raw: unknown): CanvasDetectedAssignment | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;

  const courseId = typeof d.externalCourseId === 'string' ? d.externalCourseId : '';
  const assignmentId =
    typeof d.externalAssignmentId === 'string' ? d.externalAssignmentId : '';
  if (!/^(quiz_)?\d+$/.test(courseId) && !/^\d+$/.test(courseId)) return null;
  if (!/^(quiz_)?\d+$/.test(assignmentId)) return null;

  const title = typeof d.title === 'string' ? d.title.trim().slice(0, 200) : '';
  if (!title) return null;

  const url = typeof d.url === 'string' ? d.url.slice(0, 500) : '';
  if (!/^https:\/\//.test(url)) return null;

  const points = Number(d.pointsPossible);

  return {
    externalCourseId: courseId,
    externalAssignmentId: assignmentId,
    title,
    url,
    dueAt: typeof d.dueAt === 'string' && !Number.isNaN(Date.parse(d.dueAt)) ? d.dueAt : undefined,
    pointsPossible: Number.isFinite(points) && points >= 0 ? points : undefined,
    submissionStatus: coerceStatus(d.submissionStatus),
    score: Number.isFinite(Number(d.score)) && d.score !== null && d.score !== undefined
      ? Number(d.score)
      : undefined,
    scoreText: typeof d.scoreText === 'string' ? d.scoreText.slice(0, 40) : undefined,
    excused: d.excused === true ? true : undefined,
    detectedAt:
      typeof d.detectedAt === 'string' && !Number.isNaN(Date.parse(d.detectedAt))
        ? d.detectedAt
        : new Date().toISOString(),
    courseName: typeof d.courseName === 'string' ? d.courseName.slice(0, 120) : undefined,
    kind: typeof d.kind === 'string' ? d.kind.slice(0, 30) : undefined,
  };
}

/**
 * One class grade from the extension, rebuilt.
 *
 * A score outside 0–100(0) is treated as no score rather than clamped: LockIn
 * showing a number that was never on the page is the failure this whole
 * feature is trying to avoid.
 */
export function sanitizeGrade(raw: unknown): CourseGrade | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const courseId = typeof g.externalCourseId === 'string' ? g.externalCourseId : '';
  if (!/^\d+$/.test(courseId)) return null;

  const rawScore = Number(g.currentScore);
  const currentScore =
    g.currentScore !== null && Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 1000
      ? rawScore
      : null;
  const currentGrade = typeof g.currentGrade === 'string' ? g.currentGrade.slice(0, 20) : null;

  return {
    externalCourseId: courseId,
    courseName: typeof g.courseName === 'string' ? g.courseName.slice(0, 120) : undefined,
    currentScore,
    currentGrade,
    totalsHidden: currentScore === null && currentGrade === null,
    readAt:
      typeof g.readAt === 'string' && !Number.isNaN(Date.parse(g.readAt))
        ? g.readAt
        : new Date().toISOString(),
    totalsHiddenSince:
      typeof g.totalsHiddenSince === 'string' ? g.totalsHiddenSince : undefined,
    url: typeof g.url === 'string' && /^https:\/\//.test(g.url) ? g.url.slice(0, 500) : undefined,
  };
}

export function sanitizeView(payload: unknown): CanvasExtensionView | null {
  if (!payload || typeof payload !== 'object') return null;
  const v = payload as Record<string, unknown>;
  const detected = Array.isArray(v.detected) ? v.detected.slice(0, MAX_DETECTED) : [];
  return {
    configured: v.configured === true,
    domain: typeof v.domain === 'string' ? v.domain : null,
    connectedAt: typeof v.connectedAt === 'string' ? v.connectedAt : null,
    lastSeenAt: typeof v.lastSeenAt === 'string' ? v.lastSeenAt : null,
    permissionGranted: v.permissionGranted === true,
    broadHostAccess: v.broadHostAccess === true,
    scriptRegistered: v.scriptRegistered === true,
    detected,
    detectedCount: Number.isFinite(v.detectedCount) ? Number(v.detectedCount) : detected.length,
    openTabs: Number.isFinite(v.openTabs) ? Number(v.openTabs) : 0,
    grades: Array.isArray(v.grades) ? v.grades.slice(0, 60) : [],
    checkWindow: v.checkWindow ? normalizeCheckWindow(v.checkWindow) : undefined,
    gateLog: Array.isArray(v.gateLog)
      ? (v.gateLog.slice(0, 60) as CanvasExtensionView['gateLog'])
      : undefined,
    canvasTabsOpen: Number.isFinite(v.canvasTabsOpen) ? Number(v.canvasTabsOpen) : 0,
    gradesTabOpen: v.gradesTabOpen === true,
    sync: (v.sync as CanvasExtensionView['sync']) ?? undefined,
    autoRead: (v.autoRead as CanvasExtensionView['autoRead']) ?? undefined,
    disconnect: (v.disconnect as CanvasExtensionView['disconnect']) ?? undefined,
    open: (v.open as CanvasExtensionView['open']) ?? undefined,
    configureOk: v.configureOk === true,
    promptOpened: v.promptOpened === true,
    reason: typeof v.reason === 'string' ? v.reason : undefined,
  };
}

export class CanvasPageProvider implements CanvasProvider {
  readonly kind = 'browser' as const;
  readonly label = 'Canvas Browser Connection';

  private async view(
    type: (typeof MSG)[keyof typeof MSG],
    payload?: unknown,
    timeoutMs?: number,
  ): Promise<CanvasExtensionView | null> {
    const reply = await bridge.request(type, payload, timeoutMs);
    if (!reply || reply.type !== MSG.CANVAS_VIEW) return null;
    return sanitizeView(reply.payload);
  }

  async getView(): Promise<CanvasExtensionView | null> {
    return this.view(MSG.CANVAS_GET_VIEW);
  }

  async getConnectionStatus(): Promise<CanvasConnectionStatus> {
    const view = await this.getView();
    if (!view) {
      return {
        configured: false,
        permissionGranted: false,
        domain: null,
        extensionConnected: false,
        lastSeenAt: null,
        detectedCount: 0,
        unavailableReason: 'The LockIn Chrome extension is not connected.',
      };
    }
    return {
      configured: view.configured,
      permissionGranted: view.permissionGranted,
      domain: view.domain,
      extensionConnected: true,
      lastSeenAt: view.lastSeenAt,
      detectedCount: view.detectedCount,
    };
  }

  /** Stores the domain, without prompting for permission yet. */
  async configure(domain: string): Promise<CanvasExtensionView | null> {
    return this.view(MSG.CANVAS_CONFIGURE, { domain });
  }

  /**
   * Opens the extension's consent page. Chrome's permission prompt cannot be
   * raised from a web page, so this is the required extra hop.
   */
  async requestPermission(domain: string): Promise<CanvasExtensionView | null> {
    return this.view(MSG.CANVAS_REQUEST_PERMISSION, { domain });
  }

  /** Re-parses every open Canvas tab. Slower than other calls by design. */
  /**
   * @param override the student's second, explicit press after a refusal
   *                 ("I'm not at school right now"). Honoured, and logged by
   *                 the extension as an override rather than a normal check.
   */
  async sync(override = false): Promise<CanvasExtensionView | null> {
    return this.view(MSG.CANVAS_SYNC, { override }, 6000);
  }

  /**
   * Lets the companion read one needed class in a temporary background tab.
   * Numeric course ids are the only page-derived values crossing this request.
   */
  async autoRead(courseIds: string[]): Promise<CanvasExtensionView | null> {
    return this.view(MSG.CANVAS_AUTO_READ, { courseIds }, 18_000);
  }

  /** Pushes the check window the gate enforces into the extension. */
  async setCheckWindow(window: CanvasCheckWindow): Promise<CanvasExtensionView | null> {
    return this.view(MSG.CANVAS_SET_WINDOW, { window });
  }

  async disconnect(): Promise<CanvasExtensionView | null> {
    return this.view(MSG.CANVAS_DISCONNECT);
  }

  async openInCanvas(url: string): Promise<boolean> {
    const view = await this.view(MSG.CANVAS_OPEN, { url });
    return view?.open?.ok === true;
  }

  async detectCourses(): Promise<CanvasCourse[]> {
    // Courses arrive alongside assignments; the extension caches assignments
    // only, so course names are derived from what has been detected.
    const assignments = await this.detectAssignments();
    const map = new Map<string, CanvasCourse>();
    for (const a of assignments) {
      if (!a.courseName || map.has(a.externalCourseId)) continue;
      map.set(a.externalCourseId, {
        externalCourseId: a.externalCourseId,
        originalName: a.courseName,
        displayName: a.courseName,
      });
    }
    return [...map.values()];
  }

  async detectAssignments(): Promise<CanvasDetectedAssignment[]> {
    const view = await this.getView();
    if (!view) return [];
    return view.detected
      .map(sanitizeDetected)
      .filter((d): d is CanvasDetectedAssignment => d !== null);
  }

  async getAssignmentStatus(
    courseId: string,
    assignmentId: string,
  ): Promise<CanvasAssignmentStatus> {
    const detected = await this.detectAssignments();
    const match = detected.find(
      (d) => d.externalCourseId === courseId && d.externalAssignmentId === assignmentId,
    );
    const status: CanvasSubmissionStatus = match ? match.submissionStatus : 'unknown';
    return {
      externalCourseId: courseId,
      externalAssignmentId: assignmentId,
      submissionStatus: status,
      checkedAt: new Date().toISOString(),
      unavailable: !match,
    };
  }
}

export const canvasProvider = new CanvasPageProvider();
