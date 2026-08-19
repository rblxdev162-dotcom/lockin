/**
 * The wire format between the LockIn web app and the Chrome extension.
 *
 * Mirrored (as plain JS) in `extension/shared/protocol.js`. Both sides
 * validate: the page never trusts a message that isn't tagged as coming from
 * the extension, and the content script never forwards a message from another
 * window or a foreign origin.
 */

export const WEB_SOURCE = 'lockin-web';
export const EXT_SOURCE = 'lockin-extension';

/**
 * The message-schema version both halves speak.
 *
 * Bump it when the *shape* of a message changes in a way the other side cannot
 * ignore — a renamed field, a new required field, a changed meaning. Adding a
 * new message type does not need a bump: an extension that does not know a
 * type replies `unknown-type`, and the app treats that as "not supported".
 *
 * Only ever bumped together with a note in CHANGELOG.md, because a mismatch is
 * something a student has to act on (reload the extension) rather than
 * something the app can paper over.
 */
export const PROTOCOL_VERSION = 1;

/**
 * How the installed extension compares to this build of the web app.
 *
 * `unknown` is for an extension that answers a PING without saying which
 * protocol it speaks — i.e. one built before versioning existed. It is
 * reported honestly rather than being optimistically treated as compatible.
 */
export type ExtensionCompatibility = 'ok' | 'unknown' | 'extension_outdated' | 'app_outdated';

export function checkCompatibility(theirProtocol: number | undefined): ExtensionCompatibility {
  if (typeof theirProtocol !== 'number' || !Number.isFinite(theirProtocol)) return 'unknown';
  if (theirProtocol < PROTOCOL_VERSION) return 'extension_outdated';
  if (theirProtocol > PROTOCOL_VERSION) return 'app_outdated';
  return 'ok';
}

/** One sentence a student can act on, per compatibility state. */
export const COMPATIBILITY_MESSAGE: Record<Exclude<ExtensionCompatibility, 'ok'>, string> = {
  extension_outdated:
    'Your LockIn extension is older than this version of the site. Reload it at chrome://extensions, or install the current build.',
  app_outdated:
    'Your LockIn extension is newer than this version of the site. Refresh the page, or update the site build.',
  unknown:
    'The LockIn extension answered but did not report its version. Reload it at chrome://extensions if blocking misbehaves.',
};

export const MSG = {
  PING: 'PING',
  PONG: 'PONG',
  SYNC_STATE: 'SYNC_STATE',
  STATE_ACK: 'STATE_ACK',
  GET_STATS: 'GET_STATS',
  STATS: 'STATS',
  CLEAR_STATS: 'CLEAR_STATS',
  /** Pushed by the extension when its own storage changes. */
  PUSH_STATE: 'PUSH_STATE',
  /** Pushed when the block page asks for a domain to be allowlisted. */
  ALLOWLIST_REQUEST: 'ALLOWLIST_REQUEST',

  /* --- Canvas Browser Connection (Phase 3) --- */
  CANVAS_CONFIGURE: 'CANVAS_CONFIGURE',
  CANVAS_REQUEST_PERMISSION: 'CANVAS_REQUEST_PERMISSION',
  CANVAS_GET_VIEW: 'CANVAS_GET_VIEW',
  CANVAS_SYNC: 'CANVAS_SYNC',
  CANVAS_DISCONNECT: 'CANVAS_DISCONNECT',
  CANVAS_OPEN: 'CANVAS_OPEN',
  CANVAS_VIEW: 'CANVAS_VIEW',
  /** Pushed by the extension when a Canvas detection changes something. */
  CANVAS_PUSH: 'CANVAS_PUSH',

  /* --- Reminders (Phase 13) --- */
  /** Hands the extension the schedule it fires OS notifications from. */
  REMINDER_SCHEDULE: 'REMINDER_SCHEDULE',
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

/** Exactly the slice of app state the extension is allowed to know about. */
export interface BridgeState {
  focusModeActive: boolean;
  requiredTaskCount: number;
  completedTaskCount: number;
  currentTaskTitle: string | null;
  blockedDomains: string[];
  allowedDomains: string[];
  focusStartedAt: string | null;
  temporaryUnlockUntil: number | null;
  blockingEnabled: boolean;
  reminderMode: string;
  isTest: boolean;
  testExpiresAt: number | null;
  /** Where the extension should send the student when they click "Open LockIn". */
  appUrl: string;
  /**
   * The configured Canvas host, carried separately from `allowedDomains` so the
   * blocking engine protects it even if it is removed from the school allowlist.
   */
  canvasDomain: string | null;
}

export interface Envelope<P = unknown> {
  source: typeof WEB_SOURCE | typeof EXT_SOURCE;
  version: number;
  type: MessageType;
  requestId?: string;
  payload?: P;
}

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<Envelope>;
  return (
    (e.source === WEB_SOURCE || e.source === EXT_SOURCE) &&
    typeof e.type === 'string' &&
    Object.values(MSG).includes(e.type as MessageType)
  );
}

/** Rejects anything that isn't a well-formed BridgeState. */
export function validateBridgeState(value: unknown): BridgeState | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<BridgeState>;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length < 254) : [];
  if (typeof s.focusModeActive !== 'boolean') return null;
  return {
    focusModeActive: s.focusModeActive,
    requiredTaskCount: Number.isFinite(s.requiredTaskCount) ? Number(s.requiredTaskCount) : 0,
    completedTaskCount: Number.isFinite(s.completedTaskCount) ? Number(s.completedTaskCount) : 0,
    currentTaskTitle: typeof s.currentTaskTitle === 'string' ? s.currentTaskTitle.slice(0, 120) : null,
    blockedDomains: strings(s.blockedDomains).slice(0, 500),
    allowedDomains: strings(s.allowedDomains).slice(0, 500),
    focusStartedAt: typeof s.focusStartedAt === 'string' ? s.focusStartedAt : null,
    temporaryUnlockUntil: Number.isFinite(s.temporaryUnlockUntil)
      ? Number(s.temporaryUnlockUntil)
      : null,
    blockingEnabled: s.blockingEnabled !== false,
    reminderMode: typeof s.reminderMode === 'string' ? s.reminderMode : 'Normal',
    isTest: s.isTest === true,
    testExpiresAt: Number.isFinite(s.testExpiresAt) ? Number(s.testExpiresAt) : null,
    appUrl: typeof s.appUrl === 'string' ? s.appUrl.slice(0, 300) : '',
    canvasDomain:
      typeof s.canvasDomain === 'string' && s.canvasDomain.length < 254 ? s.canvasDomain : null,
  };
}
