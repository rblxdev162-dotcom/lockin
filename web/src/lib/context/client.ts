/**
 * Reading study context from the local bridge.
 *
 * This is the **one** file in `web/src` allowed to call `fetch`, and the
 * release suite names it explicitly so a second one has to be a deliberate
 * edit to that test. What it calls is not a network request in any sense that
 * matters: a same-origin path on the loopback service already serving this
 * page. Nothing leaves the machine, and the privacy page's claim is unchanged.
 *
 * Every URL here is relative. An absolute one would be a bug — and the release
 * test checks for that too.
 */

export interface StudyContext {
  provider: 'edgenuity' | 'canvas';
  activity: 'active' | 'idle' | 'closed';
  startedAt: number | null;
  lastActiveAt: number;
  receivedAt: number;
  ageMs: number;
}

export interface ContextSnapshot {
  /** Whether a pairing code has been issued at all. */
  paired: boolean;
  context: StudyContext[];
  /** True when the local service is not running — an ordinary state. */
  unavailable?: boolean;
}

const EMPTY: ContextSnapshot = { paired: false, context: [], unavailable: true };

const PROVIDERS = ['edgenuity', 'canvas'];
const ACTIVITIES = ['active', 'idle', 'closed'];

/**
 * Rebuilds the snapshot field by field.
 *
 * The bridge already validates what it accepts, but this is a different trust
 * boundary — a reply arriving at the page — and every one of those in LockIn
 * is rebuilt rather than trusted.
 */
export function sanitizeContext(raw: unknown): ContextSnapshot {
  if (!raw || typeof raw !== 'object') return { paired: false, context: [] };
  const value = raw as Record<string, unknown>;
  const list = Array.isArray(value.context) ? value.context : [];

  const context: StudyContext[] = [];
  for (const entry of list.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (!PROVIDERS.includes(row.provider as string)) continue;
    if (!ACTIVITIES.includes(row.activity as string)) continue;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const lastActiveAt = num(row.lastActiveAt);
    const receivedAt = num(row.receivedAt);
    if (lastActiveAt === null || receivedAt === null) continue;
    context.push({
      provider: row.provider as StudyContext['provider'],
      activity: row.activity as StudyContext['activity'],
      startedAt: num(row.startedAt),
      lastActiveAt,
      receivedAt,
      ageMs: num(row.ageMs) ?? 0,
    });
  }

  return { paired: value.paired === true, context };
}

async function call(path: string, method: 'GET' | 'POST'): Promise<unknown | null> {
  try {
    const response = await fetch(path, {
      method,
      headers: { 'x-lockin-bridge': '1' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // The local service is not running. That is not an error worth surfacing
    // as one — the app is perfectly usable without the bridge, and most
    // installs will never have it.
    return null;
  }
}

export async function readContext(): Promise<ContextSnapshot> {
  const raw = await call('/api/context', 'GET');
  if (raw === null) return { ...EMPTY };
  return sanitizeContext(raw);
}

/**
 * Issues a fresh pairing code.
 *
 * Returned once, shown once, never stored by the page. The student carries it
 * to the School Companion's options page by hand — which is deliberate: a code
 * that moved automatically between two profiles would be doing exactly the
 * thing this architecture refuses to do.
 */
export async function issuePairingCode(): Promise<string | null> {
  const raw = await call('/api/context/pair', 'POST');
  if (!raw || typeof raw !== 'object') return null;
  const secret = (raw as Record<string, unknown>).secret;
  return typeof secret === 'string' && secret.length > 8 ? secret : null;
}

export async function revokePairing(): Promise<boolean> {
  const raw = await call('/api/context/unpair', 'POST');
  return !!raw && (raw as Record<string, unknown>).ok === true;
}

/**
 * Whether the student is working in a provider right now, per the bridge.
 *
 * Used for exactly one thing: holding a reminder back. "I was about to remind
 * you about Edgenuity, but you're already working there." It is never used to
 * credit progress, complete an assignment, or unlock anything — being present
 * is not evidence that work happened, and treating it as such would be a
 * second unblock path.
 */
export function workingIn(
  snapshot: ContextSnapshot,
  provider: StudyContext['provider'],
  maxAgeMs = 3 * 60_000,
): boolean {
  return snapshot.context.some(
    (entry) => entry.provider === provider && entry.activity === 'active' && entry.ageMs <= maxAgeMs,
  );
}
