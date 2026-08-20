/**
 * Turning a `SourceRecord` plus the current time into what LockIn is allowed
 * to say about it.
 *
 * Pure, `now` is an input. Nothing here reads the clock, dispatches, or
 * touches storage — the whole point is that the same record classified at two
 * different times gives two different answers, which is exactly what a stored
 * freshness flag cannot do.
 */
import type { Confidence, DataState, Freshness, SourceKind, SourceRecord } from '../../types/source';
import { FRESHNESS_HOURS } from '../../types/source';

const HOUR_MS = 3_600_000;

/** Human labels for each source, used everywhere a badge or sentence needs one. */
export const SOURCE_LABEL: Record<SourceKind, string> = {
  CANVAS_CALENDAR: 'Canvas',
  CANVAS_OAUTH: 'Canvas',
  MANUAL: 'Added by you',
  LOCKIN_VERIFIED: 'Verified',
};

/** The longer form, for detail views and the Integrations page. */
export const SOURCE_DETAIL: Record<SourceKind, string> = {
  CANVAS_CALENDAR: 'Canvas calendar feed',
  CANVAS_OAUTH: 'Canvas (authorized access)',
  MANUAL: 'Added by you',
  LOCKIN_VERIFIED: 'Verified by LockIn',
};

/**
 * "7 minutes ago", "yesterday", "12 days ago".
 *
 * Deliberately coarse past a day: an exact hour count on week-old data implies
 * a precision that does not matter and invites reading it as a countdown.
 */
export function relativeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * The one function allowed to decide what state a record is in.
 *
 * Order matters, and each branch is a rule from the brief:
 *
 *  - An erroring source is UNAVAILABLE regardless of how recent its last good
 *    sync was. "It worked this morning" is not a reason to present data as
 *    live now.
 *  - A source that never synced is UNAVAILABLE, not STALE. Stale implies there
 *    was once something fresh.
 *  - Imports never become LIVE, however recent. They were a snapshot on
 *    arrival and they stay one.
 *  - Only `isLive` *and* inside the fresh window earns LIVE.
 */
export function classify(record: SourceRecord | undefined, now: number): Freshness {
  if (!record) {
    return { state: 'UNAVAILABLE', ageMs: null, stale: false, label: 'No source' };
  }

  if (record.kind === 'MANUAL') {
    return { state: 'MANUAL', ageMs: null, stale: false, label: 'Added by you' };
  }

  const syncedAt = record.lastSyncedAt ? Date.parse(record.lastSyncedAt) : NaN;
  const ageMs = Number.isNaN(syncedAt) ? null : Math.max(0, now - syncedAt);

  if (record.syncError) {
    return {
      state: 'UNAVAILABLE',
      ageMs,
      stale: true,
      label: ageMs === null ? 'Not connected' : `Last synced ${relativeAge(ageMs)}`,
    };
  }

  if (ageMs === null) {
    return { state: 'UNAVAILABLE', ageMs: null, stale: false, label: 'Never synced' };
  }

  const window = FRESHNESS_HOURS[record.kind];
  const stale = ageMs > window.stale * HOUR_MS;
  const fresh = ageMs <= window.fresh * HOUR_MS;

  if (stale) {
    return { state: 'STALE', ageMs, stale: true, label: `Updated ${relativeAge(ageMs)}` };
  }

  if (record.kind === 'LOCKIN_VERIFIED') {
    return { state: 'VERIFIED', ageMs, stale: false, label: `Verified ${relativeAge(ageMs)}` };
  }

  if (record.isLive) {
    return fresh
      ? { state: 'LIVE', ageMs, stale: false, label: `Synced ${relativeAge(ageMs)}` }
      : { state: 'SYNCED', ageMs, stale: false, label: `Synced ${relativeAge(ageMs)}` };
  }

  // Not live, not stale: a file the student handed over. It was a snapshot when
  // it arrived and it stays one, however recently it was dropped in.
  return { state: 'IMPORTED', ageMs, stale: false, label: `Imported ${relativeAge(ageMs)}` };
}

/**
 * How much a record's *content* should be believed, after ageing.
 *
 * The stored `confidence` is what the adapter thought at parse time — "I read
 * this percentage cleanly" versus "I inferred it". Age can only lower it,
 * never raise it: a perfectly-parsed number from three weeks ago is still a
 * three-week-old number.
 */
export function effectiveConfidence(record: SourceRecord | undefined, now: number): Confidence {
  if (!record) return 'low';
  const { state } = classify(record, now);
  if (state === 'UNAVAILABLE' || state === 'STALE') return 'low';
  if (state === 'MANUAL') return 'low';
  if (record.confidence === 'high' && (state === 'IMPORTED' || state === 'SYNCED')) {
    return 'high';
  }
  return record.confidence;
}

/**
 * Whether a record is good enough to make a *judgment* from.
 *
 * The Pace Engine asks this before saying anyone is ahead or behind. It is
 * separate from "show it on screen": stale data is still worth displaying with
 * its age attached, but it is not worth telling a student they are behind over.
 */
export function trustworthyForJudgment(record: SourceRecord | undefined, now: number): boolean {
  if (!record) return false;
  const { state } = classify(record, now);
  return state === 'LIVE' || state === 'SYNCED' || state === 'IMPORTED' || state === 'VERIFIED';
}

/** A source stamp for something the student typed. */
export function manualSource(now: string): SourceRecord {
  return {
    kind: 'MANUAL',
    sourceId: 'manual',
    confidence: 'low',
    isLive: false,
    rawDataRetained: false,
    lastSyncedAt: now,
  };
}

/**
 * Picks the record that should own a field when two sources both have it.
 *
 * The rule is deliberately simple, and stated so the UI can explain it too:
 * **live beats imported, then newer beats older, then higher confidence wins.**
 * Never "whichever arrived last", which would let a stale file import overwrite
 * a fresh sync.
 */
export function preferSource(
  a: SourceRecord | undefined,
  b: SourceRecord | undefined,
  now: number,
): SourceRecord | undefined {
  if (!a) return b;
  if (!b) return a;

  const rank = (r: SourceRecord) => {
    const { state } = classify(r, now);
    if (state === 'LIVE') return 4;
    if (state === 'VERIFIED') return 3;
    if (state === 'SYNCED') return 2;
    if (state === 'IMPORTED') return 1;
    return 0;
  };

  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra > rb ? a : b;

  const ta = a.lastSyncedAt ? Date.parse(a.lastSyncedAt) : 0;
  const tb = b.lastSyncedAt ? Date.parse(b.lastSyncedAt) : 0;
  if (ta !== tb) return ta > tb ? a : b;

  const weight: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  return weight[a.confidence] >= weight[b.confidence] ? a : b;
}

/** True when a state must never be described to the student as current. */
export function isStaleState(state: DataState): boolean {
  return state === 'STALE' || state === 'UNAVAILABLE';
}
