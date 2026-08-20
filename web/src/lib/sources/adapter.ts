/**
 * The one shape every school-data channel presents to the rest of LockIn.
 *
 * ## Why this exists
 *
 * The planner must not care whether an assignment arrived from a calendar
 * feed, an authorized API, a progress email or a file the student dropped in.
 * The moment it does, adding a channel means touching the planner, the
 * dashboard and the reducer — and the whole point of Phase 16 is that adding
 * `EDGENUITY_APPROVED_API` later should be one new file.
 *
 * So an adapter's job is narrow and total: **normalise**. It converts whatever
 * its channel produces into the two currencies LockIn already understands —
 * work with due dates, and course progress with provenance — and it never
 * decides anything about completion, pacing or Focus Mode.
 *
 * ## What an adapter may never do
 *
 *  - Infer completion. Only `recompute()` decides what is done, from evidence.
 *  - Write to storage. Adapters return values; the reducer applies them.
 *  - Hold a secret in a field that crosses into the page. Credentials live in
 *    the extension, or they do not exist.
 *  - Claim `isLive` for a file import, however recently the file was made.
 */
import type { SourceKind, SourceRecord } from '../../types/source';
import type { FeedItem } from '../canvas/calendarFeed';

/** Why an adapter cannot run right now. Rendered as a sentence, never a code. */
export type AdapterUnavailableReason =
  | 'not_configured'
  | 'needs_companion'
  | 'needs_authorization'
  | 'not_implemented';

export interface AdapterCapabilities {
  /** Produces dated work items. */
  work: boolean;
  /** Knows whether something was submitted. Only an authorized API can. */
  submissionState: boolean;
  /** Can be refreshed on a timer without the student doing anything. */
  automatic: boolean;
}

export interface AdapterResult {
  ok: boolean;
  /** Work items, already normalised. Empty for progress-only adapters. */
  items: FeedItem[];
  /** Short and human. Shown to the student verbatim. */
  error?: string;
  /** ISO of the moment the data was obtained. */
  syncedAt?: string;
  warnings: string[];
}

export interface SchoolDataAdapter {
  readonly kind: SourceKind;
  /** Stable identity for the connection this adapter represents. */
  readonly sourceId: string;
  /** Shown in the Integrations list. Must never overstate what it is. */
  readonly label: string;
  readonly capabilities: AdapterCapabilities;

  /** Why it cannot run, or null when it can. */
  unavailable(): AdapterUnavailableReason | null;

  /**
   * Pulls fresh data. `now` is passed in so every adapter is testable without
   * faking the clock, exactly like the planner.
   */
  sync(now: number): Promise<AdapterResult>;
}

/** The empty result, so no adapter has to build one by hand on a failure. */
export function emptyResult(error?: string): AdapterResult {
  return { ok: !error, items: [], error, warnings: [] };
}

/**
 * The provenance stamp for any adapter.
 *
 * Centralised so `isLive` cannot drift: an adapter that is not `automatic` is
 * never live, and no amount of enthusiasm at the call site can change that.
 */
export function stampFor(
  adapter: SchoolDataAdapter,
  externalId: string | undefined,
  syncedAt: string,
  confidence: SourceRecord['confidence'] = 'high',
): SourceRecord {
  return {
    kind: adapter.kind,
    sourceId: adapter.sourceId,
    externalId,
    lastSyncedAt: syncedAt,
    confidence,
    isLive: adapter.capabilities.automatic,
    rawDataRetained: false,
  };
}

export const UNAVAILABLE_TEXT: Record<AdapterUnavailableReason, string> = {
  not_configured: 'Not set up yet.',
  needs_companion: 'Needs the LockIn Companion extension to fetch it.',
  needs_authorization: 'Needs authorization from your school or the vendor.',
  not_implemented: 'Not built — this is an interface waiting for approved access.',
};
