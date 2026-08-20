/**
 * Canvas Browser Connection — background side.
 *
 * Responsibilities:
 *   - own the configured Canvas domain and its optional host permission
 *   - register/unregister the Canvas content script for exactly that origin
 *   - accept detections ONLY from a tab actually loaded on that origin
 *   - keep a small local detection cache so a submission is not lost when the
 *     LockIn tab is closed
 *
 * Everything stays in chrome.storage.local. Nothing is ever sent anywhere.
 */
import { LIMITS } from '../canvas/types.js';
import { normalizeCanvasDomain, originPattern, isConfiguredCanvasUrl } from '../canvas/urls.js';
import { mergeStatus } from '../canvas/status.js';
import { CANVAS_MSG, validateDetectionMessage } from '../canvas/messaging.js';

const CONFIG_KEY = 'lockin_canvas_config';
const CACHE_KEY = 'lockin_canvas_cache';
const SCRIPT_ID = 'lockin-canvas';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export async function getCanvasConfig() {
  try {
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    const raw = stored[CONFIG_KEY];
    if (!raw || typeof raw !== 'object') return null;
    const domain = normalizeCanvasDomain(raw.domain);
    if (!domain) return null;
    return {
      domain,
      mode: 'browser',
      connectedAt: typeof raw.connectedAt === 'string' ? raw.connectedAt : new Date().toISOString(),
      lastSeenAt: typeof raw.lastSeenAt === 'string' ? raw.lastSeenAt : null,
      permissionGranted: raw.permissionGranted === true,
    };
  } catch {
    return null;
  }
}

async function setCanvasConfig(config) {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  return config;
}

/** True when Chrome currently grants us the configured Canvas origin. */
export async function hasCanvasPermission(domain) {
  const pattern = originPattern(domain);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Whether the extension already holds blanket host access.
 *
 * It does, today: Phase 2's website blocking uses declarativeNetRequest
 * `redirect` rules, and Chrome requires host permissions for redirects to
 * arbitrary user-chosen sites, which cannot be enumerated at build time.
 *
 * This matters for honesty, not for capability. When blanket access is already
 * held, asking Chrome for the Canvas origin is a no-op — Chrome will not show a
 * prompt — so the consent UI must say what is actually true: the *scope of
 * reading* is what the student is choosing, and that scope is enforced in code
 * (content script registered for one origin, plus origin checks on every
 * message), not by the permission system.
 */
export async function hasBroadHostAccess() {
  try {
    // Probe two unrelated origins rather than asking about `<all_urls>`
    // directly — `permissions.contains` wants concrete match patterns, and
    // holding both of these can only mean blanket access.
    return await chrome.permissions.contains({
      origins: ['https://example.com/*', 'https://example.org/*'],
    });
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Detection cache                                                     */
/* ------------------------------------------------------------------ */

export async function getCanvasCache() {
  try {
    const stored = await chrome.storage.local.get(CACHE_KEY);
    const raw = stored[CACHE_KEY];
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

async function setCanvasCache(cache) {
  // Keep the newest detections if the cache ever grows past the cap.
  const entries = Object.entries(cache);
  if (entries.length > LIMITS.MAX_CACHED_ASSIGNMENTS) {
    entries.sort((a, b) => String(b[1].detectedAt).localeCompare(String(a[1].detectedAt)));
    cache = Object.fromEntries(entries.slice(0, LIMITS.MAX_CACHED_ASSIGNMENTS));
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

export async function clearCanvasCache() {
  await chrome.storage.local.set({ [CACHE_KEY]: {} });
}

function cacheKey(domain, courseId, assignmentId) {
  return `${domain}|${courseId}|${assignmentId}`;
}

/**
 * Folds a validated detection into the cache.
 *
 * Idempotent by construction: re-seeing the same assignment with the same
 * status only refreshes `lastSeenAt`. `statusChangedAt` moves only on a real
 * change, which is what stops repeated visits producing repeated activity
 * events in the web app.
 */
async function applyDetection(message) {
  const cache = await getCanvasCache();
  let changed = 0;
  let newlyComplete = 0;

  for (const assignment of message.assignments) {
    const key = cacheKey(
      message.domain,
      assignment.externalCourseId,
      assignment.externalAssignmentId,
    );
    const previous = cache[key];
    const previousStatus = previous ? previous.submissionStatus : 'unknown';
    const nextStatus = mergeStatus(previousStatus, assignment.submissionStatus);

    const statusChanged = nextStatus !== previousStatus;
    if (statusChanged) {
      changed += 1;
      if (['submitted', 'graded', 'late_submitted'].includes(nextStatus)) newlyComplete += 1;
    }

    cache[key] = {
      ...assignment,
      submissionStatus: nextStatus,
      detectedAt: assignment.detectedAt,
      statusChangedAt: statusChanged
        ? assignment.detectedAt
        : previous?.statusChangedAt ?? assignment.detectedAt,
      courseName: assignment.courseName ?? previous?.courseName,
    };
  }

  await setCanvasCache(cache);

  const config = await getCanvasConfig();
  if (config) {
    await setCanvasConfig({ ...config, lastSeenAt: message.detectedAt });
  }

  return { changed, newlyComplete, total: message.assignments.length };
}

/* ------------------------------------------------------------------ */
/* Content-script registration                                         */
/* ------------------------------------------------------------------ */

/**
 * Registers the Canvas content script for one origin only.
 * `persistAcrossSessions` means detection keeps working after a browser
 * restart without the web app having to be opened first.
 */
export async function registerCanvasScript(domain) {
  const pattern = originPattern(domain);
  if (!pattern) return false;
  if (!(await hasCanvasPermission(domain))) return false;

  await unregisterCanvasScript();
  try {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches: [pattern],
        js: ['canvas/content.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    return true;
  } catch (error) {
    console.warn('[LockIn] could not register Canvas content script', error);
    return false;
  }
}

export async function unregisterCanvasScript() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  } catch {
    /* nothing registered */
  }
}

/* ------------------------------------------------------------------ */
/* Public operations (called from the service worker)                  */
/* ------------------------------------------------------------------ */

/** Stores the domain. Permission is requested separately, from connect.html. */
export async function configureCanvas(rawDomain) {
  const domain = normalizeCanvasDomain(rawDomain);
  if (!domain) return { ok: false, reason: 'invalid-domain' };

  const existing = await getCanvasConfig();
  const permissionGranted = await hasCanvasPermission(domain);

  const config = await setCanvasConfig({
    domain,
    mode: 'browser',
    connectedAt: existing?.domain === domain ? existing.connectedAt : new Date().toISOString(),
    lastSeenAt: existing?.domain === domain ? existing.lastSeenAt : null,
    permissionGranted,
  });

  if (permissionGranted) await registerCanvasScript(domain);
  else await unregisterCanvasScript();

  return { ok: true, config };
}

/**
 * Called after the consent page reports a result, and on startup, to keep the
 * stored flag honest about what Chrome actually grants right now.
 */
export async function refreshCanvasPermission() {
  const config = await getCanvasConfig();
  if (!config) return null;
  const granted = await hasCanvasPermission(config.domain);
  if (granted !== config.permissionGranted) {
    await setCanvasConfig({ ...config, permissionGranted: granted });
  }
  if (granted) await registerCanvasScript(config.domain);
  else await unregisterCanvasScript();
  return { ...config, permissionGranted: granted };
}

export async function disconnectCanvas() {
  const config = await getCanvasConfig();
  await unregisterCanvasScript();
  await clearCanvasCache();

  let permissionRemoved = false;
  if (config) {
    const pattern = originPattern(config.domain);
    if (pattern) {
      try {
        permissionRemoved = await chrome.permissions.remove({ origins: [pattern] });
      } catch {
        // Chrome refuses in some contexts; leaving the grant is not fatal and
        // the student can revoke it from chrome://extensions.
        permissionRemoved = false;
      }
    }
  }

  await chrome.storage.local.remove(CONFIG_KEY);
  return { ok: true, permissionRemoved };
}

/** Snapshot for the web app: config + permission + cached detections. */
export async function getCanvasView() {
  const config = await getCanvasConfig();
  const cache = await getCanvasCache();
  const detected = Object.values(cache);
  const permissionGranted = config ? await hasCanvasPermission(config.domain) : false;

  let openTabs = 0;
  if (config && permissionGranted) {
    try {
      const tabs = await chrome.tabs.query({ url: `https://${config.domain}/*` });
      openTabs = tabs.length;
    } catch {
      openTabs = 0;
    }
  }

  return {
    configured: !!config,
    domain: config?.domain ?? null,
    connectedAt: config?.connectedAt ?? null,
    lastSeenAt: config?.lastSeenAt ?? null,
    permissionGranted,
    // Lets the UI tell the truth about whether Chrome will actually prompt.
    broadHostAccess: await hasBroadHostAccess(),
    scriptRegistered: await isCanvasScriptRegistered(),
    detected,
    detectedCount: detected.length,
    openTabs,
  };
}

/** Whether the Canvas content script is currently registered. */
export async function isCanvasScriptRegistered() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    return existing.length > 0;
  } catch {
    return false;
  }
}

/**
 * Sync: ask every open Canvas tab to re-parse right now.
 * Returns counts the UI can report honestly.
 */
export async function syncCanvasNow() {
  const config = await getCanvasConfig();
  if (!config) return { ok: false, reason: 'not-configured' };
  if (!(await hasCanvasPermission(config.domain))) {
    return { ok: false, reason: 'no-permission', domain: config.domain };
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: `https://${config.domain}/*` });
  } catch {
    tabs = [];
  }
  if (tabs.length === 0) {
    return { ok: false, reason: 'no-canvas-tab', domain: config.domain };
  }

  const before = await getCanvasCache();
  const beforeCount = Object.keys(before).length;

  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? Promise.resolve()
        : chrome.tabs
            .sendMessage(tab.id, { type: CANVAS_MSG.REPARSE })
            .catch(() => {
              /* tab not ready / script not injected yet */
            }),
    ),
  );

  // Detections arrive as separate messages; give them a moment to land.
  await new Promise((resolve) => setTimeout(resolve, 900));

  const after = await getCanvasCache();
  const afterEntries = Object.entries(after);
  const updated = afterEntries.filter(
    ([key, value]) => before[key] && before[key].submissionStatus !== value.submissionStatus,
  ).length;
  const newlySubmitted = afterEntries.filter(
    ([key, value]) =>
      ['submitted', 'graded', 'late_submitted'].includes(value.submissionStatus) &&
      (!before[key] ||
        !['submitted', 'graded', 'late_submitted'].includes(before[key].submissionStatus)),
  ).length;

  return {
    ok: true,
    tabsChecked: tabs.length,
    found: afterEntries.length,
    added: Math.max(0, afterEntries.length - beforeCount),
    updated,
    newlySubmitted,
    detected: afterEntries.map(([, value]) => value),
  };
}

/** Opens a Canvas URL, reusing an existing tab for the same page when possible. */
export async function openCanvasUrl(url) {
  const config = await getCanvasConfig();
  if (!config) return { ok: false, reason: 'not-configured' };
  const target =
    typeof url === 'string' && isConfiguredCanvasUrl(url, config.domain)
      ? url
      : `https://${config.domain}/`;
  try {
    const existing = await chrome.tabs.query({ url: target });
    if (existing.length > 0 && existing[0].id !== undefined) {
      await chrome.tabs.update(existing[0].id, { active: true });
      if (existing[0].windowId !== undefined) {
        await chrome.windows.update(existing[0].windowId, { focused: true });
      }
    } else {
      await chrome.tabs.create({ url: target });
    }
    return { ok: true, url: target };
  } catch {
    return { ok: false, reason: 'open-failed' };
  }
}

/* ------------------------------------------------------------------ */
/* Inbound messages from the Canvas content script                     */
/* ------------------------------------------------------------------ */

/**
 * THE trust boundary for Canvas verification.
 *
 * A detection is accepted only when every one of these holds:
 *   1. it came from a tab (not another extension page, not the web app)
 *   2. that tab's URL is on the configured Canvas origin, over https
 *   3. Chrome actually grants us that origin right now
 *   4. the payload passes strict schema validation, including the domain
 *
 * This is what stops an arbitrary page shouting "CANVAS_SUBMITTED" and
 * unlocking Focus Mode.
 */
export async function handleCanvasContentMessage(message, sender) {
  const config = await getCanvasConfig();
  if (!config) return { ok: false, reason: 'not-configured' };

  const tabUrl = sender?.tab?.url;
  if (!sender?.tab || !tabUrl) return { ok: false, reason: 'not-a-tab' };
  if (!isConfiguredCanvasUrl(tabUrl, config.domain)) {
    return { ok: false, reason: 'origin-mismatch' };
  }
  if (!(await hasCanvasPermission(config.domain))) {
    return { ok: false, reason: 'no-permission' };
  }

  if (message.type === CANVAS_MSG.UNREADABLE) {
    await setCanvasConfig({ ...config, lastSeenAt: new Date().toISOString() });
    return { ok: true, readable: false };
  }

  const clean = validateDetectionMessage(message, config.domain);
  if (!clean) return { ok: false, reason: 'invalid-payload' };

  const result = await applyDetection(clean);
  return { ok: true, ...result };
}

export const CANVAS_STORAGE_KEYS = { CONFIG_KEY, CACHE_KEY };

/**
 * Opens the Canvas dashboard in a background tab so the content script can read
 * submission status.
 *
 * ## Why this exists
 *
 * A calendar feed carries due dates and nothing else — it cannot say whether
 * something was handed in, marked, or missed. The only other way to know is the
 * Canvas API, which needs a Developer Key a student cannot issue themselves. So
 * the remaining honest option is to read the page the student is already
 * entitled to see, in their own logged-in session.
 *
 * ## The limits it keeps
 *
 *  - **Only Canvas.** The URL is built from the configured domain; nothing a
 *    caller passes in reaches it.
 *  - **Only when the student asked for it**, and only when they have already
 *    granted the Canvas host permission.
 *  - **Never steals focus** (`active: false`), and never opens a second tab
 *    while one it opened is still going.
 *  - **Nothing is fetched by LockIn.** It is an ordinary navigation the
 *    student's own browser makes.
 *
 * ## About closing it again
 *
 * Invariant 5 says LockIn never closes a tab. That rule is about never fighting
 * the student for control of their own browser, and it stands — but it was
 * written when every tab was one *they* opened. A background tab LockIn opened
 * itself, unasked and unseen, is the one case where leaving it is the ruder
 * option. So the invariant is now scoped: **LockIn may close a tab it opened
 * itself, and only that tab.** The id is recorded, checked before the close,
 * and forgotten immediately after; if the student adopted the tab and navigated
 * it somewhere else, the URL check fails and it is left alone.
 *
 * The close happens on the next alarm tick rather than a `setTimeout`, because
 * a service worker can be killed mid-timer and would leave the tab behind.
 */
const SYNC_TAB_KEY = 'lockin_canvas_sync_tab';

export async function openCanvasForSync() {
  const config = await getCanvasConfig();
  if (!config.domain || !config.permissionGranted) {
    return { ok: false, reason: 'not-connected' };
  }

  // Already open? The content script is already reporting, and a second tab
  // would be pure noise.
  try {
    const existing = await chrome.tabs.query({ url: `https://${config.domain}/*` });
    if (existing.length > 0) return { ok: true, reason: 'already-open' };
  } catch {
    /* fall through and open one */
  }

  try {
    const tab = await chrome.tabs.create({ url: `https://${config.domain}/`, active: false });
    await chrome.storage.local.set({
      [SYNC_TAB_KEY]: { id: tab.id, domain: config.domain, openedAt: Date.now() },
    });
    return { ok: true, reason: 'opened' };
  } catch {
    return { ok: false, reason: 'open-failed' };
  }
}

/**
 * Closes the tab `openCanvasForSync` opened, if it is still ours.
 *
 * Called from the heartbeat, so the worker being killed in between changes
 * nothing: the record is in storage and the next tick picks it up.
 */
export async function closeCanvasSyncTab(now = Date.now()) {
  let record;
  try {
    record = (await chrome.storage.local.get(SYNC_TAB_KEY))[SYNC_TAB_KEY];
  } catch {
    return { closed: false };
  }
  if (!record || typeof record.id !== 'number') return { closed: false };

  // Give the page a moment to load and report before taking it away.
  if (now - (record.openedAt ?? 0) < 25_000) return { closed: false, waiting: true };

  await chrome.storage.local.remove(SYNC_TAB_KEY);
  try {
    const tab = await chrome.tabs.get(record.id);
    // Only if it is still the tab we opened. If the student adopted it and
    // navigated somewhere else, it is theirs now.
    if (tab?.url && new URL(tab.url).hostname === record.domain) {
      await chrome.tabs.remove(record.id);
      return { closed: true };
    }
  } catch {
    /* already gone */
  }
  return { closed: false };
}
