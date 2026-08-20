/**
 * Extension-side mirror of `web/src/lib/protocol.ts`.
 * Keep the two in sync — they are the same wire contract.
 */

export const WEB_SOURCE = 'lockin-web';
export const EXT_SOURCE = 'lockin-extension';
export const PROTOCOL_VERSION = 1;

export const MSG = {
  PING: 'PING',
  PONG: 'PONG',
  SYNC_STATE: 'SYNC_STATE',
  STATE_ACK: 'STATE_ACK',
  GET_STATS: 'GET_STATS',
  STATS: 'STATS',
  CLEAR_STATS: 'CLEAR_STATS',
  PUSH_STATE: 'PUSH_STATE',
  ALLOWLIST_REQUEST: 'ALLOWLIST_REQUEST',

  /* --- Canvas Browser Connection (Phase 3) --- */
  /** web → ext: store the configured Canvas domain */
  CANVAS_CONFIGURE: 'CANVAS_CONFIGURE',
  /** web → ext: open the extension consent page so Chrome can prompt */
  CANVAS_REQUEST_PERMISSION: 'CANVAS_REQUEST_PERMISSION',
  /** web → ext: current config, permission and cached detections */
  CANVAS_GET_VIEW: 'CANVAS_GET_VIEW',
  /** web → ext: re-read the Canvas page in the active tab now */
  CANVAS_SYNC: 'CANVAS_SYNC',
  /**
   * web → ext: the school-hours check window.
   *
   * The web app owns this setting; the extension keeps a copy because the
   * gate has to be able to refuse a reading when no LockIn tab is open.
   */
  CANVAS_SET_WINDOW: 'CANVAS_SET_WINDOW',
  /** web → ext: forget the domain, drop the permission, clear the cache */
  CANVAS_DISCONNECT: 'CANVAS_DISCONNECT',
  /** web → ext: open a Canvas URL (Open in Canvas / Check Canvas Status) */
  CANVAS_OPEN: 'CANVAS_OPEN',
  /** ext → web: the reply carrying a Canvas view */
  CANVAS_VIEW: 'CANVAS_VIEW',
  /** ext → web: pushed when new detections land, so no refresh is needed */
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
  /**
   * web → ext: the reminder schedule.
   *
   * Sent whenever it changes. The extension fires OS notifications from it on
   * its own alarm, so reminders survive every LockIn tab being closed — which
   * the page-side timer cannot do.
   */
  REMINDER_SCHEDULE: 'REMINDER_SCHEDULE',
};

/**
 * Messages exchanged inside the extension only (popup, block page). These never
 * cross the page boundary, so they are kept separate from MSG on purpose.
 */
export const INTERNAL = {
  GET_VIEW: 'INTERNAL_GET_VIEW',
  BLOCK_HIT: 'INTERNAL_BLOCK_HIT',
  OPEN_APP: 'INTERNAL_OPEN_APP',
  REQUEST_ALLOWLIST: 'INTERNAL_REQUEST_ALLOWLIST',
  REQUEST_TEMP_ACCESS: 'INTERNAL_REQUEST_TEMP_ACCESS',
  /** popup → worker: today's activity summary */
  GET_ACTIVITY: 'INTERNAL_GET_ACTIVITY',
  /** connect.html → worker: the outcome of chrome.permissions.request */
  CANVAS_PERMISSION_RESULT: 'INTERNAL_CANVAS_PERMISSION_RESULT',
};

const KNOWN_TYPES = new Set(Object.values(MSG));

export function isEnvelope(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    (value.source === WEB_SOURCE || value.source === EXT_SOURCE) &&
    typeof value.type === 'string' &&
    KNOWN_TYPES.has(value.type)
  );
}

const MAX_DOMAINS = 500;

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string' && v.length > 0 && v.length < 254)
    .slice(0, MAX_DOMAINS);
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Hard validation of anything arriving from the page. Unknown fields are
 * dropped rather than passed through — the service worker only ever sees a
 * shape it fully controls.
 */
export function validateBridgeState(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.focusModeActive !== 'boolean') return null;

  return {
    focusModeActive: value.focusModeActive,
    requiredTaskCount: Number.isFinite(value.requiredTaskCount) ? value.requiredTaskCount : 0,
    completedTaskCount: Number.isFinite(value.completedTaskCount) ? value.completedTaskCount : 0,
    currentTaskTitle:
      typeof value.currentTaskTitle === 'string' ? value.currentTaskTitle.slice(0, 120) : null,
    blockedDomains: stringList(value.blockedDomains),
    allowedDomains: stringList(value.allowedDomains),
    focusStartedAt: typeof value.focusStartedAt === 'string' ? value.focusStartedAt : null,
    temporaryUnlockUntil: finiteOrNull(value.temporaryUnlockUntil),
    blockingEnabled: value.blockingEnabled !== false,
    reminderMode: typeof value.reminderMode === 'string' ? value.reminderMode : 'Normal',
    isTest: value.isTest === true,
    testExpiresAt: finiteOrNull(value.testExpiresAt),
    appUrl: typeof value.appUrl === 'string' ? value.appUrl.slice(0, 300) : '',
    // Carried separately from allowedDomains so the student's homework site
    // stays reachable even if it is deleted from the school allowlist.
    canvasDomain:
      typeof value.canvasDomain === 'string' && value.canvasDomain.length < 254
        ? value.canvasDomain
        : null,
  };
}

export function emptyBridgeState() {
  return {
    focusModeActive: false,
    requiredTaskCount: 0,
    completedTaskCount: 0,
    currentTaskTitle: null,
    blockedDomains: [],
    allowedDomains: [],
    focusStartedAt: null,
    temporaryUnlockUntil: null,
    blockingEnabled: true,
    reminderMode: 'Normal',
    isTest: false,
    testExpiresAt: null,
    appUrl: '',
    canvasDomain: null,
  };
}
