/**
 * Edgenuity Browser Connection — background side.
 *
 * Mirrors `background/canvas.js`, with two differences that matter:
 *
 *   - There is no configurable domain. Edgenuity is a single vendor at known
 *     hosts, so the origin is a constant and cannot be pointed anywhere else.
 *   - The cache holds one small record per course — id, name, three numbers,
 *     a timestamp — and never page content.
 *
 * Everything stays in chrome.storage.local. Nothing is ever sent anywhere, and
 * nothing here ever issues a request to Edgenuity: the content script reports
 * what the student's own navigation rendered, and that is the only source.
 */
import { LIMITS } from '../edgenuity/types.js';
import { originPatterns, isEdgenuityUrl } from '../edgenuity/urls.js';
import { EDGENUITY_MSG, validateEdgenuityMessage } from '../edgenuity/messaging.js';

const CONFIG_KEY = 'lockin_edgenuity_config';
const CACHE_KEY = 'lockin_edgenuity_cache';
const SCRIPT_ID = 'lockin-edgenuity';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export async function getEdgenuityConfig() {
  try {
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    const raw = stored[CONFIG_KEY];
    if (!raw || typeof raw !== 'object') return null;
    return {
      connected: raw.connected === true,
      connectedAt: typeof raw.connectedAt === 'string' ? raw.connectedAt : new Date().toISOString(),
      lastSeenAt: typeof raw.lastSeenAt === 'string' ? raw.lastSeenAt : null,
      permissionGranted: raw.permissionGranted === true,
    };
  } catch {
    return null;
  }
}

async function setEdgenuityConfig(config) {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  return config;
}

export async function hasEdgenuityPermission() {
  try {
    return await chrome.permissions.contains({ origins: originPatterns() });
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Reading cache                                                       */
/* ------------------------------------------------------------------ */

export async function getEdgenuityCache() {
  try {
    const stored = await chrome.storage.local.get(CACHE_KEY);
    const raw = stored[CACHE_KEY];
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

async function setEdgenuityCache(cache) {
  const entries = Object.entries(cache);
  if (entries.length > LIMITS.MAX_CACHED_COURSES) {
    entries.sort((a, b) => String(b[1].readAt).localeCompare(String(a[1].readAt)));
    cache = Object.fromEntries(entries.slice(0, LIMITS.MAX_CACHED_COURSES));
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

export async function clearEdgenuityCache() {
  await chrome.storage.local.set({ [CACHE_KEY]: {} });
}

/**
 * Folds a validated reading into the cache.
 *
 * `firstSeen` is kept so the web app can show movement even across a restart,
 * but it is NOT what verification measures from — invariant 10 still applies,
 * and new progress is always measured from `lastVerifiedProgress` in the app.
 *
 * Progress that goes *backwards* is stored as-is rather than rejected: courses
 * do get reset, and refusing the lower number would leave a stale high-water
 * mark that quietly counts as completed work.
 */
async function applyReading(message) {
  const cache = await getEdgenuityCache();
  let changed = 0;

  for (const course of message.courses) {
    const previous = cache[course.externalCourseId];
    const moved =
      !previous ||
      previous.progressPercent !== course.progressPercent ||
      previous.activitiesCompleted !== course.activitiesCompleted ||
      previous.activitiesTotal !== course.activitiesTotal;
    if (moved) changed += 1;

    cache[course.externalCourseId] = {
      ...course,
      courseName: course.courseName ?? previous?.courseName,
      firstSeenAt: previous?.firstSeenAt ?? course.readAt,
      changedAt: moved ? course.readAt : (previous?.changedAt ?? course.readAt),
    };
  }

  await setEdgenuityCache(cache);

  const config = await getEdgenuityConfig();
  if (config) await setEdgenuityConfig({ ...config, lastSeenAt: message.readAt });

  return { changed, total: message.courses.length };
}

/* ------------------------------------------------------------------ */
/* Content-script registration                                         */
/* ------------------------------------------------------------------ */

export async function registerEdgenuityScript() {
  if (!(await hasEdgenuityPermission())) return false;
  await unregisterEdgenuityScript();
  try {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches: originPatterns(),
        js: ['edgenuity/content.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    return true;
  } catch (error) {
    console.warn('[LockIn] could not register Edgenuity content script', error);
    return false;
  }
}

export async function unregisterEdgenuityScript() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  } catch {
    /* nothing registered */
  }
}

export async function isEdgenuityScriptRegistered() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    return existing.length > 0;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Public operations                                                   */
/* ------------------------------------------------------------------ */

export async function connectEdgenuity() {
  const existing = await getEdgenuityConfig();
  const permissionGranted = await hasEdgenuityPermission();

  const config = await setEdgenuityConfig({
    connected: true,
    connectedAt: existing?.connected ? existing.connectedAt : new Date().toISOString(),
    lastSeenAt: existing?.lastSeenAt ?? null,
    permissionGranted,
  });

  if (permissionGranted) await registerEdgenuityScript();
  else await unregisterEdgenuityScript();

  return { ok: true, config };
}

/** Keeps the stored flag honest about what Chrome actually grants right now. */
export async function refreshEdgenuityPermission() {
  const config = await getEdgenuityConfig();
  if (!config) return null;
  const granted = await hasEdgenuityPermission();
  if (granted !== config.permissionGranted) {
    await setEdgenuityConfig({ ...config, permissionGranted: granted });
  }
  if (granted) await registerEdgenuityScript();
  else await unregisterEdgenuityScript();
  return { ...config, permissionGranted: granted };
}

export async function disconnectEdgenuity() {
  await unregisterEdgenuityScript();
  await clearEdgenuityCache();

  let permissionRemoved = false;
  try {
    permissionRemoved = await chrome.permissions.remove({ origins: originPatterns() });
  } catch {
    permissionRemoved = false;
  }

  await chrome.storage.local.remove(CONFIG_KEY);
  return { ok: true, permissionRemoved };
}

/** Snapshot for the web app. */
export async function getEdgenuityView() {
  const config = await getEdgenuityConfig();
  const cache = await getEdgenuityCache();
  const courses = Object.values(cache);
  const permissionGranted = await hasEdgenuityPermission();

  let openTabs = 0;
  if (config?.connected && permissionGranted) {
    try {
      const tabs = await Promise.all(
        originPatterns().map((pattern) => chrome.tabs.query({ url: pattern })),
      );
      openTabs = tabs.flat().length;
    } catch {
      openTabs = 0;
    }
  }

  return {
    connected: config?.connected === true,
    connectedAt: config?.connectedAt ?? null,
    lastSeenAt: config?.lastSeenAt ?? null,
    permissionGranted,
    scriptRegistered: await isEdgenuityScriptRegistered(),
    courses,
    courseCount: courses.length,
    openTabs,
  };
}

/**
 * Ask every open Edgenuity tab to re-read right now.
 *
 * This is the ONLY "sync", and it deliberately cannot fetch anything: with no
 * Edgenuity tab open there is nothing to read and the answer is "open your
 * course page", not a background request.
 */
export async function syncEdgenuityNow() {
  const config = await getEdgenuityConfig();
  if (!config?.connected) return { ok: false, reason: 'not-connected' };
  if (!(await hasEdgenuityPermission())) return { ok: false, reason: 'no-permission' };

  let tabs = [];
  try {
    const found = await Promise.all(
      originPatterns().map((pattern) => chrome.tabs.query({ url: pattern })),
    );
    tabs = found.flat();
  } catch {
    tabs = [];
  }
  if (tabs.length === 0) return { ok: false, reason: 'no-edgenuity-tab' };

  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? Promise.resolve()
        : chrome.tabs.sendMessage(tab.id, { type: EDGENUITY_MSG.REPARSE }).catch(() => {
            /* tab not ready / script not injected yet */
          }),
    ),
  );

  // Readings arrive as separate messages; give them a moment to land.
  await new Promise((resolve) => setTimeout(resolve, 900));

  const cache = await getEdgenuityCache();
  const courses = Object.values(cache);
  return { ok: true, tabsChecked: tabs.length, found: courses.length, courses };
}

/**
 * The trust boundary. Re-verifies the sending tab's origin and the live host
 * permission before a single field is believed — a message is not trusted
 * because it claims to come from Edgenuity, but because the tab it came from
 * is actually on Edgenuity.
 */
export async function handleEdgenuityContentMessage(message, sender) {
  const config = await getEdgenuityConfig();
  if (!config?.connected) return { ok: false, reason: 'not-connected' };

  const tabUrl = sender?.tab?.url;
  if (!sender?.tab || !tabUrl) return { ok: false, reason: 'not-a-tab' };
  if (!isEdgenuityUrl(tabUrl)) return { ok: false, reason: 'origin-mismatch' };
  if (!(await hasEdgenuityPermission())) return { ok: false, reason: 'no-permission' };

  if (message.type === EDGENUITY_MSG.UNREADABLE) {
    await setEdgenuityConfig({ ...config, lastSeenAt: new Date().toISOString() });
    return { ok: true, readable: false };
  }

  const clean = validateEdgenuityMessage(message);
  if (!clean) return { ok: false, reason: 'invalid-payload' };

  const result = await applyReading(clean);
  return { ok: true, ...result };
}

export const EDGENUITY_STORAGE_KEYS = { CONFIG_KEY, CACHE_KEY };
