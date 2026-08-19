/**
 * LockIn service worker — the only place that writes blocking rules.
 *
 * Message flow:
 *   page  --window.postMessage-->  content/bridge.js  --sendMessage-->  here
 *   here  --sendResponse-->        content/bridge.js  --postMessage-->  page
 *
 * The worker can be torn down at any moment, so state always comes from
 * chrome.storage.local and expiries are scheduled with chrome.alarms rather
 * than setTimeout.
 */
import {
  MSG,
  INTERNAL,
  EXT_SOURCE,
  PROTOCOL_VERSION,
  isEnvelope,
  validateBridgeState,
} from '../shared/protocol.js';
import { isAllowedOrigin, DEFAULT_APP_URL } from '../shared/config.js';
import { normalizeDomain } from '../shared/domains.js';
import { normalizeCanvasDomain } from '../canvas/urls.js';
import { applyRules, isBlockingActive, effectiveBlocklist } from './rules.js';
import { getState, setState, getStats, recordBlock, clearStats } from './storage.js';
import { CANVAS_MSG } from '../canvas/messaging.js';
import {
  configureCanvas,
  disconnectCanvas,
  getCanvasView,
  handleCanvasContentMessage,
  openCanvasUrl,
  refreshCanvasPermission,
  syncCanvasNow,
} from './canvas.js';
import {
  CALENDAR_ALARM,
  configureCalendar,
  disconnectCalendar,
  fetchCalendar,
  getCalendarConfig,
  runCalendarRefresh,
  scheduleCalendarRefresh,
  toCalendarView,
} from './calendar.js';
import {
  onNotificationClicked,
  pruneFired,
  runReminderCheck,
  setSchedule,
} from './reminders.js';

const VERSION = chrome.runtime.getManifest().version;
const EXPIRY_ALARM = 'lockin-expiry';
const HEARTBEAT_ALARM = 'lockin-heartbeat';

/* ------------------------------------------------------------------ */
/* Rule + badge refresh                                                */
/* ------------------------------------------------------------------ */

async function refresh(state) {
  const current = state ?? (await getState());
  const now = Date.now();
  const active = isBlockingActive(current, now);

  let ruleCount = 0;
  try {
    ruleCount = await applyRules(current, now);
  } catch (error) {
    console.error('[LockIn] failed to apply blocking rules', error);
  }

  // Badge: green count while blocking, muted dot while Focus Mode is paused.
  try {
    if (active) {
      await chrome.action.setBadgeText({ text: String(effectiveBlocklist(current).length) });
      await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
    } else if (current.focusModeActive) {
      await chrome.action.setBadgeText({ text: '॥' });
      await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    /* badge is cosmetic */
  }

  await scheduleExpiry(current, now);
  return ruleCount;
}

/**
 * Temporary unlocks and the 5-minute test both end at a wall-clock time. An
 * alarm wakes the worker back up so blocking returns without the web app
 * needing to be open.
 */
async function scheduleExpiry(state, now) {
  const times = [state.temporaryUnlockUntil, state.isTest ? state.testExpiresAt : null].filter(
    (t) => typeof t === 'number' && t > now,
  );
  await chrome.alarms.clear(EXPIRY_ALARM);
  if (times.length === 0) return;
  // +1s so the alarm fires just after the deadline, never just before.
  await chrome.alarms.create(EXPIRY_ALARM, { when: Math.min(...times) + 1000 });
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  void refresh();
  // Re-assert the Canvas content-script registration and permission flag.
  void refreshCanvasPermission();
  // A slow heartbeat re-asserts rules if Chrome ever drops dynamic rules.
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  void reassertCalendarAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  // Chrome was restarted: rebuild rules from persisted state so an active
  // Focus Mode keeps blocking without the web app being opened first.
  void refresh();
  void refreshCanvasPermission();
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  void reassertCalendarAlarm();
});

/**
 * Alarms do not survive an update or a browser restart, so a configured feed
 * re-arms its refresh in both lifecycle hooks. A feed that silently stopped
 * refreshing is worse than one that never worked: it still looks connected.
 */
async function reassertCalendarAlarm() {
  const config = await getCalendarConfig();
  if (config.url) await scheduleCalendarRefresh(config.refreshMinutes);
}

// If the student revokes Canvas access from chrome://extensions, stop the
// content script rather than leaving a dead registration behind.
chrome.permissions.onRemoved.addListener(() => {
  void refreshCanvasPermission();
});
chrome.permissions.onAdded.addListener(() => {
  void refreshCanvasPermission();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  /**
   * The calendar refresh rides its own alarm rather than the heartbeat: the
   * heartbeat runs every minute, and a school's server should be asked a few
   * times a day, not 1,440.
   */
  if (alarm.name === CALENDAR_ALARM) {
    void runCalendarRefresh();
  }
  if (alarm.name === HEARTBEAT_ALARM) {
    // Reminders ride the existing one-minute heartbeat rather than adding an
    // alarm of their own; the check is a storage read and some arithmetic.
    void runReminderCheck();
  }
  if (alarm.name === EXPIRY_ALARM || alarm.name === HEARTBEAT_ALARM) {
    void refresh();
  }
});

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

async function handlePageMessage(envelope, sender) {
  // Only the LockIn origin may drive the extension. The content script checks
  // this too; checking again here means a compromised content script or a
  // stray sendMessage can't slip past.
  const origin = sender?.origin ?? (sender?.url ? new URL(sender.url).origin : null);
  if (!origin || !isAllowedOrigin(origin)) {
    return { source: 'lockin-extension', version: PROTOCOL_VERSION, type: MSG.STATE_ACK, payload: { ok: false, reason: 'origin' } };
  }

  switch (envelope.type) {
    case MSG.PING:
      return {
        type: MSG.PONG,
        payload: { version: VERSION, protocolVersion: PROTOCOL_VERSION },
      };

    case MSG.SYNC_STATE: {
      const clean = validateBridgeState(envelope.payload);
      if (!clean) return { type: MSG.STATE_ACK, payload: { ok: false, reason: 'invalid' } };
      await setState(clean);
      const ruleCount = await refresh(clean);
      return {
        type: MSG.STATE_ACK,
        payload: { ok: true, ruleCount, blocking: isBlockingActive(clean), stats: await getStats() },
      };
    }

    case MSG.GET_STATS:
      return { type: MSG.STATS, payload: { stats: await getStats() } };

    case MSG.CLEAR_STATS:
      await clearStats();
      return { type: MSG.STATS, payload: { stats: [] } };

    /* ---- Canvas Browser Connection ---- */

    case MSG.CANVAS_GET_VIEW:
      return { type: MSG.CANVAS_VIEW, payload: await getCanvasView() };

    case MSG.CANVAS_CONFIGURE: {
      const domain = envelope.payload?.domain;
      const result = await configureCanvas(domain);
      return {
        type: MSG.CANVAS_VIEW,
        payload: { ...(await getCanvasView()), configureOk: result.ok, reason: result.reason },
      };
    }

    /**
     * The permission prompt cannot be raised from a web page, so the worker
     * opens the extension's own consent page. Chrome then shows its prompt for
     * that single origin when the student clicks there.
     */
    case MSG.CANVAS_REQUEST_PERMISSION: {
      const domain = envelope.payload?.domain;
      const clean = normalizeCanvasDomain(domain);
      if (!clean) return { type: MSG.CANVAS_VIEW, payload: { ...(await getCanvasView()), reason: 'invalid-domain' } };
      await configureCanvas(clean);
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`canvas/connect.html?domain=${encodeURIComponent(clean)}`),
      });
      return { type: MSG.CANVAS_VIEW, payload: { ...(await getCanvasView()), promptOpened: true } };
    }

    case MSG.CANVAS_SYNC: {
      const result = await syncCanvasNow();
      return { type: MSG.CANVAS_VIEW, payload: { ...(await getCanvasView()), sync: result } };
    }

    case MSG.CANVAS_DISCONNECT: {
      const result = await disconnectCanvas();
      return { type: MSG.CANVAS_VIEW, payload: { ...(await getCanvasView()), disconnect: result } };
    }

    case MSG.CANVAS_OPEN: {
      const result = await openCanvasUrl(envelope.payload?.url);
      return { type: MSG.CANVAS_VIEW, payload: { ...(await getCanvasView()), open: result } };
    }

    case MSG.REMINDER_SCHEDULE: {
      const count = await setSchedule(envelope.payload?.items);
      await pruneFired();
      return { type: MSG.STATE_ACK, payload: { ok: true, scheduled: count } };
    }


    default:
      return { type: MSG.STATE_ACK, payload: { ok: false, reason: 'unknown-type' } };
  }
}

/**
 * Brings LockIn to the front, reusing an existing tab rather than piling up
 * new ones. Shared by the popup, the block page and a clicked reminder.
 */
async function openApp() {
  const state = await getState();
  const url = state.appUrl || DEFAULT_APP_URL;
  const tabs = await chrome.tabs.query({ url: `${new URL(url).origin}/*` });
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    await chrome.tabs.update(tabs[0].id, { active: true, url });
    if (tabs[0].windowId !== undefined) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url });
  }
}

// A reminder is only useful if it takes you to the work.
onNotificationClicked(openApp);

async function handleInternalMessage(message) {
  switch (message.type) {
    case INTERNAL.GET_VIEW: {
      const state = await getState();
      return {
        state,
        blocking: isBlockingActive(state),
        blockedCount: effectiveBlocklist(state).length,
        stats: await getStats(),
        version: VERSION,
        appUrl: state.appUrl || DEFAULT_APP_URL,
      };
    }

    case INTERNAL.BLOCK_HIT: {
      const domain = normalizeDomain(message.domain);
      if (domain) await recordBlock(domain);
      return { ok: true };
    }

    case INTERNAL.OPEN_APP: {
      await openApp();
      return { ok: true };
    }

    /**
     * The block page's "this site is needed for school" flow. The extension
     * deliberately does NOT edit the allowlist itself — that decision (and any
     * parent PIN gate) belongs to the web app, so we forward the request to
     * every open LockIn tab and open one if none exists.
     */
    case INTERNAL.REQUEST_ALLOWLIST:
    case INTERNAL.REQUEST_TEMP_ACCESS: {
      const domain = normalizeDomain(message.domain);
      if (!domain) return { ok: false };
      const state = await getState();
      const appUrl = state.appUrl || DEFAULT_APP_URL;
      const wanted =
        message.type === INTERNAL.REQUEST_ALLOWLIST
          ? `${new URL(appUrl).origin}/settings?allowlist=${encodeURIComponent(domain)}`
          : `${new URL(appUrl).origin}/focus?unlock=${encodeURIComponent(domain)}`;
      await chrome.tabs.create({ url: wanted });
      return { ok: true };
    }

    /** Result of the one-origin permission prompt shown by connect.html. */
    case INTERNAL.CANVAS_PERMISSION_RESULT: {
      const config = await refreshCanvasPermission();
      await notifyAppOfCanvas();
      return { ok: true, permissionGranted: config?.permissionGranted === true };
    }


    default:
      return { ok: false, reason: 'unknown-internal' };
  }
}


/**
 * Pushes a fresh Canvas view into every open LockIn tab, so a submission
 * detected while the student is on Canvas reaches the app without a refresh.
 */
async function notifyAppOfCanvas() {
  let view;
  try {
    view = await getCanvasView();
  } catch {
    return;
  }
  let tabs = [];
  try {
    const state = await getState();
    const origin = new URL(state.appUrl || DEFAULT_APP_URL).origin;
    tabs = await chrome.tabs.query({ url: `${origin}/*` });
  } catch {
    return;
  }
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? Promise.resolve()
        : chrome.tabs
            .sendMessage(tab.id, {
              source: EXT_SOURCE,
              version: PROTOCOL_VERSION,
              type: MSG.CANVAS_PUSH,
              payload: view,
            })
            .catch(() => {
              /* that tab has no bridge yet */
            }),
    ),
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  /**
   * Canvas detections from the Canvas content script.
   * `handleCanvasContentMessage` re-verifies the sending tab's origin and the
   * live host permission before trusting a single field — see canvas.js.
   */
  if (
    message &&
    typeof message === 'object' &&
    (message.type === CANVAS_MSG.DETECTION || message.type === CANVAS_MSG.UNREADABLE)
  ) {
    if (sender.id !== chrome.runtime.id) return false;
    handleCanvasContentMessage(message, sender)
      .then(async (result) => {
        // Only wake the web app when something actually changed.
        if (result.ok && (result.changed > 0 || result.newlyComplete > 0)) {
          await notifyAppOfCanvas();
        }
        sendResponse(result);
      })
      .catch((error) => {
        console.error('[LockIn] Canvas message failed', error);
        sendResponse({ ok: false });
      });
    return true;
  }


  // Internal pages (popup, block page) have no tab origin restriction, but they
  // must come from this extension.
  if (message && typeof message === 'object' && typeof message.type === 'string' &&
      message.type.startsWith('INTERNAL_')) {
    if (sender.id !== chrome.runtime.id) return false;
    handleInternalMessage(message)
      .then(sendResponse)
      .catch((error) => {
        console.error('[LockIn] internal message failed', error);
        sendResponse({ ok: false });
      });
    return true;
  }

  if (!isEnvelope(message) || message.source !== 'lockin-web') return false;

  handlePageMessage(message, sender)
    .then((reply) =>
      sendResponse({
        source: 'lockin-extension',
        version: PROTOCOL_VERSION,
        type: reply.type,
        requestId: message.requestId,
        payload: reply.payload,
      }),
    )
    .catch((error) => {
      console.error('[LockIn] page message failed', error);
      sendResponse({
        source: 'lockin-extension',
        version: PROTOCOL_VERSION,
        type: MSG.STATE_ACK,
        requestId: message.requestId,
        payload: { ok: false },
      });
    });
  return true; // async response
});

// Rules are also refreshed when storage changes from any context.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lockin_state) void refresh();
});

// Cold start of the worker itself.
void refresh();
