/**
 * Talking to the local bridge.
 *
 * The extension can only see tabs in its own Chrome profile. When Edgenuity
 * lives in a different profile — a school account whose password the student
 * does not have, so the course cannot simply be opened in the personal
 * window — there is no in-browser path to it at all. The bridge is the way
 * around that: LockIn's own local server asks Chrome, from outside, and
 * reports back the same shape the extension would have sent.
 *
 * Which is the point of this file: a reading from the bridge is an
 * `EdgenuityReading`, identical to one from the extension, so it flows through
 * `EDGENUITY_BROWSER_READING` and the existing policy without a second path
 * through the reducer. Two ways of getting the number, one way of judging it.
 *
 * The bridge only exists when LockIn is served by `scripts/serve.mjs` (the
 * LaunchAgent). Under `vite dev` these endpoints are absent, and every call
 * here degrades to "unavailable" rather than throwing.
 */
import type { EdgenuityReading } from './browserVerification';
import { sanitizeReading } from './browserProvider';

export type BridgeProblem =
  | 'unavailable'
  | 'chrome_closed'
  | 'automation_denied'
  | 'apple_events_js_disabled'
  | 'no_edgenuity_tab'
  | 'assessment_only'
  | 'timeout'
  | 'busy'
  | 'unknown';

export interface BridgeStatus {
  ok: boolean;
  problem?: BridgeProblem;
  detail?: string;
  chromeRunning: boolean;
  edgenuityTabs: number;
  jsAllowed?: boolean;
}

export interface BridgeReadResult {
  ok: boolean;
  problem?: BridgeProblem;
  detail?: string;
  courses: EdgenuityReading[];
  /** Assessment pages the bridge refused to read. Not an error. */
  skipped: number;
}

/**
 * The header is the access control, not decoration: it is not a CORS-simple
 * header, so any page that is not same-origin gets stopped at a preflight the
 * server never answers.
 */
const HEADERS = { 'x-lockin-bridge': '1' };
const TIMEOUT_MS = 12_000;

const UNAVAILABLE: BridgeStatus = {
  ok: false,
  problem: 'unavailable',
  detail:
    'The LockIn background service is not running. Start it with `npm run service:install`, or open LockIn from the always-on server rather than the dev server.',
  chromeRunning: false,
  edgenuityTabs: 0,
};

async function call<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(path, { headers: HEADERS, signal: controller.signal });
    // A 403 means the fencing rejected us; a 404 means we are on the dev
    // server. Neither is worth distinguishing to the student.
    if (!response.ok && response.status !== 429) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Is the bridge there, and can it see Edgenuity? Never verifies anything. */
export async function bridgeStatus(): Promise<BridgeStatus> {
  const result = await call<BridgeStatus>('/api/edgenuity/status');
  return result ?? UNAVAILABLE;
}

/**
 * Reads every open Edgenuity course page.
 *
 * Everything coming back is re-validated with the same `sanitizeReading` the
 * extension path uses. The bridge already caps and shapes its output, but a
 * local endpoint is still a trust boundary, and one validator for both sources
 * means they cannot drift apart.
 */
export async function bridgeRead(): Promise<BridgeReadResult> {
  const result = await call<{
    ok: boolean;
    problem?: BridgeProblem;
    detail?: string;
    courses?: unknown[];
    skipped?: number;
  }>('/api/edgenuity/read');

  if (!result) {
    return { ok: false, problem: 'unavailable', detail: UNAVAILABLE.detail, courses: [], skipped: 0 };
  }

  const courses = Array.isArray(result.courses)
    ? result.courses
        .slice(0, 100)
        .map(sanitizeReading)
        .filter((c): c is EdgenuityReading => !!c)
    : [];

  return {
    ok: result.ok === true && courses.length > 0,
    problem: result.problem,
    detail: result.detail,
    courses,
    skipped: Number.isFinite(result.skipped) ? Number(result.skipped) : 0,
  };
}

/** What the student should do about a given problem. One sentence, actionable. */
export const BRIDGE_FIX: Record<BridgeProblem, string> = {
  unavailable: 'Start the LockIn background service, then reload this page.',
  chrome_closed: 'Chrome is not running.',
  automation_denied:
    'Allow LockIn to control Chrome: System Settings → Privacy & Security → Automation.',
  apple_events_js_disabled:
    'In Chrome, turn on View → Developer → Allow JavaScript from Apple Events.',
  no_edgenuity_tab: 'Open your Edgenuity course page in any Chrome window.',
  assessment_only: 'Only a test is open. LockIn does not read those.',
  timeout: 'Chrome did not answer in time. Try again.',
  busy: 'Already reading. Give it a second.',
  unknown: 'Something went wrong reading Chrome.',
};
