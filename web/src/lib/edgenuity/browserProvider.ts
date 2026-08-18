/**
 * Talking to the extension about Edgenuity.
 *
 * The mirror of `canvas/pageProvider.ts`, and much smaller, because the wire
 * shape is much smaller: a connection flag, a permission flag, and one record
 * per course carrying two integers.
 *
 * Everything crossing back from the extension is re-validated here even though
 * the extension already validated it at its own trust boundary. Doing it twice
 * costs nothing and means React state can only ever hold known shapes
 * (invariant 6).
 */
import { bridge } from '../extensionBridge';
import { MSG } from '../protocol';
import type { MessageType } from '../protocol';
import type { EdgenuityReading } from './browserVerification';

/** Shape the extension returns for EDGENUITY_GET_VIEW / EDGENUITY_VIEW. */
export interface EdgenuityExtensionView {
  connected: boolean;
  connectedAt: string | null;
  lastSeenAt: string | null;
  permissionGranted: boolean;
  /** Whether the Edgenuity reader is actually registered. */
  scriptRegistered: boolean;
  courses: EdgenuityReading[];
  courseCount: number;
  openTabs: number;
  sync?: { ok: boolean; reason?: string; tabsChecked?: number; found?: number };
  disconnect?: { ok: boolean; permissionRemoved: boolean };
  connectOk?: boolean;
  promptOpened?: boolean;
}

/** A view for when the extension isn't there at all. Never claims connection. */
export function disconnectedView(): EdgenuityExtensionView {
  return {
    connected: false,
    connectedAt: null,
    lastSeenAt: null,
    permissionGranted: false,
    scriptRegistered: false,
    courses: [],
    courseCount: 0,
    openTabs: 0,
  };
}

const MAX_COURSES = 100;

function int(value: unknown, max: number): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const rounded = Math.round(number);
  return rounded >= 0 && rounded <= max ? rounded : undefined;
}

function iso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function sanitizeReading(raw: unknown): EdgenuityReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const externalCourseId =
    typeof r.externalCourseId === 'string' ? r.externalCourseId.trim().slice(0, 64) : '';
  if (!externalCourseId) return null;

  const progressPercent = int(r.progressPercent, 100);
  const activitiesCompleted = int(r.activitiesCompleted, 2000);
  const activitiesTotal = int(r.activitiesTotal, 2000);

  // Same rule as the extension's validator: a half pair is not a pair, and a
  // reading with no usable number is not a reading.
  const countsValid =
    activitiesCompleted !== undefined &&
    activitiesTotal !== undefined &&
    activitiesTotal > 0 &&
    activitiesCompleted <= activitiesTotal;
  if (progressPercent === undefined && !countsValid) return null;

  return {
    externalCourseId,
    courseName:
      typeof r.courseName === 'string'
        ? r.courseName.replace(/\s+/g, ' ').trim().slice(0, 120) || undefined
        : undefined,
    progressPercent,
    activitiesCompleted: countsValid ? activitiesCompleted : undefined,
    activitiesTotal: countsValid ? activitiesTotal : undefined,
    readAt: iso(r.readAt) ?? new Date().toISOString(),
  };
}

export function sanitizeEdgenuityView(raw: unknown): EdgenuityExtensionView {
  if (!raw || typeof raw !== 'object') return disconnectedView();
  const v = raw as Record<string, unknown>;

  const courses = Array.isArray(v.courses)
    ? v.courses.slice(0, MAX_COURSES).map(sanitizeReading).filter((c): c is EdgenuityReading => !!c)
    : [];

  const sync = v.sync as EdgenuityExtensionView['sync'];
  const disconnect = v.disconnect as EdgenuityExtensionView['disconnect'];

  return {
    connected: v.connected === true,
    connectedAt: iso(v.connectedAt),
    lastSeenAt: iso(v.lastSeenAt),
    permissionGranted: v.permissionGranted === true,
    scriptRegistered: v.scriptRegistered === true,
    courses,
    courseCount: courses.length,
    openTabs: int(v.openTabs, 1000) ?? 0,
    sync: sync && typeof sync === 'object' ? sync : undefined,
    disconnect: disconnect && typeof disconnect === 'object' ? disconnect : undefined,
    connectOk: v.connectOk === true ? true : undefined,
    promptOpened: v.promptOpened === true ? true : undefined,
  };
}

/**
 * One request/response with the extension.
 *
 * Note what is missing: there is no method here that reads Edgenuity. The
 * extension only ever reports pages the student opened themselves, and
 * `sync()` asks open tabs to re-read — with no Edgenuity tab open, the honest
 * answer is "open your course page", not a background request.
 */
export class EdgenuityBrowserProvider {
  private async send(type: MessageType): Promise<EdgenuityExtensionView> {
    try {
      const reply = await bridge.request(type);
      if (!reply || reply.type !== MSG.EDGENUITY_VIEW) return disconnectedView();
      return sanitizeEdgenuityView(reply.payload);
    } catch {
      return disconnectedView();
    }
  }

  getView(): Promise<EdgenuityExtensionView> {
    return this.send(MSG.EDGENUITY_GET_VIEW);
  }

  /** Turns reading on. The Chrome prompt is raised separately. */
  connect(): Promise<EdgenuityExtensionView> {
    return this.send(MSG.EDGENUITY_CONNECT);
  }

  /** Opens the extension's own consent page — a web page cannot prompt. */
  requestPermission(): Promise<EdgenuityExtensionView> {
    return this.send(MSG.EDGENUITY_REQUEST_PERMISSION);
  }

  /** Asks every open Edgenuity tab to re-read what is already on screen. */
  sync(): Promise<EdgenuityExtensionView> {
    return this.send(MSG.EDGENUITY_SYNC);
  }

  disconnect(): Promise<EdgenuityExtensionView> {
    return this.send(MSG.EDGENUITY_DISCONNECT);
  }
}

export const edgenuityBrowser = new EdgenuityBrowserProvider();
