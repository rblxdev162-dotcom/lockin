/**
 * The local context bridge.
 *
 * ## What problem it solves, and what it refuses to solve
 *
 * Chrome profiles are isolated. The LockIn companion, installed in the
 * personal profile, cannot see a tab in the school profile — no API, flag or
 * permission crosses that line, and LockIn does not try to make one.
 *
 * What *can* cross, with the student's consent, is a message from a second
 * extension installed in the school profile to a service on this machine. That
 * is what this file receives. It carries **context, never content**:
 *
 *     { provider: 'edgenuity', activity: 'active', startedAt, lastActiveAt }
 *
 * That is enough for LockIn to say "I was about to remind you about Edgenuity,
 * but you're already working there" — which is the whole point — and it is not
 * enough to reconstruct a single thing about the coursework.
 *
 * ## The security model
 *
 * 1. **Loopback only.** The HTTP server binds 127.0.0.1. Nothing on the LAN
 *    can reach it, and no port forwarding is set up anywhere in this project.
 * 2. **A pairing secret.** Generated here, shown once in LockIn, pasted into
 *    the School Companion's options page. Every POST must carry it. Compared
 *    with a constant-time comparison so a wrong secret cannot be discovered a
 *    byte at a time.
 * 3. **A custom header.** `x-lockin-bridge: 1` is not a CORS-simple header, so
 *    any cross-origin caller is forced into a preflight this server never
 *    answers. A random web page cannot reach the route even though the port is
 *    guessable.
 * 4. **Replay protection.** Each report carries a timestamp and a nonce.
 *    Anything outside a two-minute window, or a nonce seen before, is refused.
 * 5. **Schema validation.** The body is rebuilt field by field. Unknown keys
 *    are dropped, every string is capped, and the provider must be one of two
 *    literals.
 * 6. **Nothing sensitive may enter.** There is no field for a cookie, a token,
 *    a URL, page text, a course name, a score or an answer. A field that does
 *    not exist cannot be filled in by a compromised client.
 * 7. **Memory only.** Context is held in this process and never written to
 *    disk. Restarting the service forgets everything.
 *
 * ## Deliberately not native messaging
 *
 * Chrome Native Messaging would also work and avoids a listening socket. It
 * needs a manifest installed into a per-browser directory, a host binary, and
 * a different install path per OS — for a bridge that already has a running
 * local service to live in, that is a lot of moving parts to gain very little.
 * The transport is kept behind this module's small interface so it can be
 * swapped without touching either end.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** How far out of date a report may be before it is refused. */
const MAX_SKEW_MS = 2 * 60 * 1000;
/** Nonces remembered. Two minutes of reports at any plausible rate. */
const MAX_NONCES = 500;
/** Context older than this is not evidence of anything current. */
export const CONTEXT_TTL_MS = 10 * 60 * 1000;
/** Bodies larger than this are not context reports. */
export const MAX_BODY_BYTES = 4096;

const PROVIDERS = ['edgenuity', 'canvas'];
const ACTIVITIES = ['active', 'idle', 'closed'];

/**
 * The bridge's whole state: one secret, a nonce set, and the latest context
 * per provider. Deliberately a closure rather than module-level `let`s, so a
 * test can create an isolated instance.
 */
export function createContextBridge({ now = () => Date.now() } = {}) {
  let secret = null;
  const nonces = new Map();
  const context = new Map();

  /**
   * Issues a new pairing secret, invalidating any previous one.
   *
   * Rotating on demand matters: the secret is pasted between two browser
   * profiles by hand, which means it can end up in a clipboard manager or a
   * screenshot, and there has to be a way to make an old copy useless.
   */
  function pair() {
    secret = randomBytes(24).toString('base64url');
    nonces.clear();
    return secret;
  }

  function isPaired() {
    return secret !== null;
  }

  function unpair() {
    secret = null;
    nonces.clear();
    context.clear();
  }

  /** Constant-time, and length-safe — `timingSafeEqual` throws on a mismatch. */
  function secretMatches(candidate) {
    if (!secret || typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  function pruneNonces(at) {
    for (const [nonce, seenAt] of nonces) {
      if (at - seenAt > MAX_SKEW_MS) nonces.delete(nonce);
    }
    while (nonces.size > MAX_NONCES) {
      const oldest = nonces.keys().next().value;
      nonces.delete(oldest);
    }
  }

  /**
   * Rebuilds a report field by field.
   *
   * Returns null for anything that is not exactly the shape expected. This is
   * the only place a message from another browser profile becomes data LockIn
   * will act on, so it is written as a whitelist with no fall-through.
   */
  function validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const provider = PROVIDERS.includes(raw.provider) ? raw.provider : null;
    const activity = ACTIVITIES.includes(raw.activity) ? raw.activity : null;
    if (!provider || !activity) return null;

    const number = (value) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;

    const startedAt = number(raw.startedAt);
    const lastActiveAt = number(raw.lastActiveAt);
    const sentAt = number(raw.sentAt);
    const nonce =
      typeof raw.nonce === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw.nonce) ? raw.nonce : null;
    if (!lastActiveAt || !sentAt || !nonce) return null;

    return { provider, activity, startedAt, lastActiveAt, sentAt, nonce };
  }

  /**
   * Accepts one context report.
   *
   * Every refusal returns a reason the School Companion can show its own user;
   * none of them leaks whether the secret was close.
   */
  function report(rawBody, headers = {}) {
    const at = now();

    if (!isPaired()) return { ok: false, reason: 'not-paired' };
    if (headers['x-lockin-bridge'] !== '1') return { ok: false, reason: 'header' };
    if (!secretMatches(headers['x-lockin-secret'])) return { ok: false, reason: 'unauthorized' };

    const clean = validate(rawBody);
    if (!clean) return { ok: false, reason: 'schema' };

    if (Math.abs(at - clean.sentAt) > MAX_SKEW_MS) return { ok: false, reason: 'stale' };

    pruneNonces(at);
    if (nonces.has(clean.nonce)) return { ok: false, reason: 'replay' };
    nonces.set(clean.nonce, at);

    context.set(clean.provider, {
      provider: clean.provider,
      activity: clean.activity,
      startedAt: clean.startedAt,
      lastActiveAt: clean.lastActiveAt,
      receivedAt: at,
    });

    return { ok: true };
  }

  /**
   * What LockIn is allowed to read back.
   *
   * Entries older than the TTL are dropped rather than returned with an age
   * attached: "the student was on Edgenuity an hour ago" is not context for a
   * decision being made now, and offering it invites somebody to use it.
   */
  function snapshot() {
    const at = now();
    const out = [];
    for (const [provider, entry] of context) {
      if (at - entry.receivedAt > CONTEXT_TTL_MS) {
        context.delete(provider);
        continue;
      }
      out.push({ ...entry, ageMs: at - entry.receivedAt });
    }
    return { paired: isPaired(), context: out };
  }

  return { pair, unpair, isPaired, report, snapshot, validate, secretMatches };
}

/** The single shared instance the HTTP server mounts. */
export const contextBridge = createContextBridge();
