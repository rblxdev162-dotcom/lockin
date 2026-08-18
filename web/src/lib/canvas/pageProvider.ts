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
  /** Present on the reply to CANVAS_SYNC. */
  sync?: {
    ok: boolean;
    reason?: string;
    tabsChecked?: number;
    found?: number;
    added?: number;
    updated?: number;
    newlySubmitted?: number;
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
    detectedAt:
      typeof d.detectedAt === 'string' && !Number.isNaN(Date.parse(d.detectedAt))
        ? d.detectedAt
        : new Date().toISOString(),
    courseName: typeof d.courseName === 'string' ? d.courseName.slice(0, 120) : undefined,
    kind: typeof d.kind === 'string' ? d.kind.slice(0, 30) : undefined,
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
    sync: (v.sync as CanvasExtensionView['sync']) ?? undefined,
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
  async sync(): Promise<CanvasExtensionView | null> {
    return this.view(MSG.CANVAS_SYNC, undefined, 6000);
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
