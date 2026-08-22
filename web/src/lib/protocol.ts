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
  /** Ask the companion to read one needed class gradebook in a background tab. */
  CANVAS_AUTO_READ: 'CANVAS_AUTO_READ',
  /** web → ext: the school-hours check window the gate enforces. */
  CANVAS_SET_WINDOW: 'CANVAS_SET_WINDOW',
  CANVAS_DISCONNECT: 'CANVAS_DISCONNECT',
  CANVAS_OPEN: 'CANVAS_OPEN',
  CANVAS_VIEW: 'CANVAS_VIEW',
  /** Pushed by the extension when a Canvas detection changes something. */
  CANVAS_PUSH: 'CANVAS_PUSH',

  /* --- Canvas Calendar Feed (Phase 16) --- */
  /**
   * web → ext: store a feed URL. The URL crosses this boundary exactly once,
   * on the way in, and never comes back — see `toCalendarView`.
   */
  CALENDAR_CONFIGURE: 'CALENDAR_CONFIGURE',
  /** web → ext: current configuration, minus the secret */
  CALENDAR_GET_VIEW: 'CALENDAR_GET_VIEW',
  /** web → ext: fetch now and hand back the raw ICS text for parsing */
  CALENDAR_FETCH: 'CALENDAR_FETCH',
  /** web → ext: change refresh cadence or the startup behaviour */
  CALENDAR_SET_OPTIONS: 'CALENDAR_SET_OPTIONS',
  /** web → ext: forget the URL and the cached body entirely */
  CALENDAR_DISCONNECT: 'CALENDAR_DISCONNECT',
  /** ext → web: the reply carrying a calendar view */
  CALENDAR_VIEW: 'CALENDAR_VIEW',
  /** ext → web: the reply carrying feed text */
  CALENDAR_TEXT: 'CALENDAR_TEXT',

  /* --- Activity awareness (Phase 16) --- */
  /** web → ext: today's category counters. Never a site, never a history. */
  ACTIVITY_GET: 'ACTIVITY_GET',
  /** ext → web: the reply carrying those counters */
  ACTIVITY_VIEW: 'ACTIVITY_VIEW',
  /** web → ext: a Focus Mode run began; reset the per-run counters */
  FOCUS_RUN_STARTED: 'FOCUS_RUN_STARTED',
  /** web → ext: silence one assignment's reminders for a while */
  REMINDER_SNOOZE: 'REMINDER_SNOOZE',

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
  /**
   * The school day, so the extension can keep blocking out of it without a
   * LockIn tab being open (schema v15).
   *
   * `null` means either the student turned the pause off or LockIn genuinely
   * does not know when school is. Both cases mean "do not suspend anything" —
   * the extension never invents an interval of its own.
   */
  schoolHours: { days: number[]; from: number; until: number } | null;
  /**
   * Homework hours — when blocking runs on its own, with no Focus session
   * (schema v16). `null` means automatic blocking is off.
   */
  homeworkWindow: {
    schoolDays: number[];
    from: number;
    freeDayFrom: number;
    until: number;
  } | null;
  /** `YYYY-MM-DD` dates that are not school days, however the calendar reads. */
  noSchoolDates: string[];
  /**
   * Epoch ms until which automatic blocking stands down because the student
   * finished their work today, or `null`. A Focus session still blocks.
   */
  autoBlockEarnedUntil: number | null;
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
    schoolHours: schoolHours(s.schoolHours),
    homeworkWindow: homeworkWindow(s.homeworkWindow),
    noSchoolDates: Array.isArray(s.noSchoolDates)
      ? s.noSchoolDates
          .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
          .slice(0, 180)
      : [],
    autoBlockEarnedUntil: Number.isFinite(s.autoBlockEarnedUntil)
      ? Number(s.autoBlockEarnedUntil)
      : null,
  };
}

/**
 * Rebuilt like `schoolHours`, but failing the other way.
 *
 * A malformed school window must not switch blocking off, so it becomes
 * `null`. A malformed homework window must not switch blocking *on* at a time
 * nobody chose — so it also becomes `null`, which here means "no automatic
 * blocking". Both directions land on the same rule: an unusable window does
 * nothing.
 */
function homeworkWindow(value: unknown): BridgeState['homeworkWindow'] {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const minute = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
  const from = minute(raw.from, 1439);
  const freeDayFrom = minute(raw.freeDayFrom, 1439);
  const until = minute(raw.until, 1440);
  if (from === null || freeDayFrom === null || until === null) return null;
  if (until <= from || until <= freeDayFrom) return null;
  const schoolDays = Array.isArray(raw.schoolDays)
    ? [...new Set(raw.schoolDays)].filter(
        (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
      )
    : [];
  return { schoolDays, from, freeDayFrom, until };
}

/**
 * Rebuilt field by field, like every other part of this contract.
 *
 * An interval is only kept if it is genuinely usable: real minute values, an
 * end after its start, and at least one weekday. Anything else becomes `null`,
 * which means "do not suspend blocking" — a malformed window must never be
 * able to switch blocking off for a day, or forever.
 */
function schoolHours(value: unknown): BridgeState['schoolHours'] {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { days?: unknown; from?: unknown; until?: unknown };
  const minute = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440 ? v : null;
  const from = minute(raw.from);
  const until = minute(raw.until);
  if (from === null || until === null || until <= from) return null;
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days)].filter(
        (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
      )
    : [];
  if (!days.length) return null;
  return { days, from, until };
}
