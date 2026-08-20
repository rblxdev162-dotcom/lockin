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
import { defaultCheckWindow, evaluateCheckWindow, normalizeCheckWindow } from '../canvas/checkWindow.js';

const CONFIG_KEY = 'lockin_canvas_config';
const CACHE_KEY = 'lockin_canvas_cache';
const GRADES_KEY = 'lockin_canvas_grades';
const WINDOW_KEY = 'lockin_canvas_window';
const GATE_LOG_KEY = 'lockin_canvas_gate_log';
const LAST_READ_KEY = 'lockin_canvas_last_read';
const SCRIPT_ID = 'lockin-canvas';

/** Gate decisions kept for the student to inspect. Small on purpose. */
const MAX_GATE_LOG = 60;

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
/* THE GATE — the only thing that decides if Canvas is touched at all   */
/* ------------------------------------------------------------------ */

/**
 * Every path that reads Canvas, or asks Canvas's servers for anything, goes
 * through `canvasGate()` first. Not most paths. All of them:
 *
 *   - a detection arriving from the content script  (`passive` / `manual`)
 *   - the Check Canvas button                       (`manual` / `override`)
 *   - the calendar feed's refresh alarm             (`automatic`)
 *   - the startup catch-up                          (`automatic`)
 *
 * The rule this enforces is the student's, and it is about school: they take
 * proctored tests on a district device while this app is running at home, and
 * a machine of theirs quietly talking to the school's Canvas mid-assessment is
 * not something anyone should have to explain. So the guarantee is structural
 * rather than careful — if the gate says no, nothing happens, and the refusal
 * is written down.
 *
 * The decision itself is pure and lives in `canvas/checkWindow.js`, mirrored
 * from `web/src/lib/canvas/checkWindow.ts`, with a test that runs both.
 */

export async function getCheckWindow() {
  try {
    const stored = await chrome.storage.local.get(WINDOW_KEY);
    return normalizeCheckWindow(stored[WINDOW_KEY]);
  } catch {
    return defaultCheckWindow();
  }
}

/** The web app is the source of truth for the window; this stores its copy. */
export async function setCheckWindow(raw) {
  const next = normalizeCheckWindow(raw);
  await chrome.storage.local.set({ [WINDOW_KEY]: next });
  return next;
}

export async function getGateLog() {
  try {
    const stored = await chrome.storage.local.get(GATE_LOG_KEY);
    const raw = stored[GATE_LOG_KEY];
    return Array.isArray(raw) ? raw.slice(0, MAX_GATE_LOG) : [];
  } catch {
    return [];
  }
}

async function recordGateDecision(entry) {
  const log = await getGateLog();
  log.unshift(entry);
  await chrome.storage.local.set({ [GATE_LOG_KEY]: log.slice(0, MAX_GATE_LOG) });
}

/**
 * @param {'manual'|'override'|'passive'|'automatic'} reason
 * @returns {Promise<{allowed:boolean, verdict:string, overridable:boolean, nextAllowedAt:number|null}>}
 */
export async function canvasGate(reason, now = Date.now(), options = {}) {
  const window = await getCheckWindow();
  const config = options.config === undefined ? await getCanvasConfig() : options.config;
  const decision = evaluateCheckWindow(window, reason, now, { connected: !!config });

  // Passive refusals are the common case once the observer is off, and logging
  // one per mutation would drown the log the guarantee depends on.
  const worthRecording = decision.allowed || reason !== 'passive';
  if (worthRecording) {
    await recordGateDecision({
      at: now,
      reason,
      verdict: decision.verdict,
      allowed: decision.allowed,
    });
  }
  return decision;
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

/* ------------------------------------------------------------------ */
/* Class grades                                                        */
/* ------------------------------------------------------------------ */

/**
 * One entry per class, replaced wholesale each time the student opens a
 * Grades page. Deliberately *not* merged field-by-field: a grade is a single
 * fact with a timestamp, and a stitched-together one from three different
 * readings would be a number that never appeared on any page.
 *
 * A reading where Canvas published no total does not erase a real number read
 * earlier — it is recorded as hidden, and the older figure keeps its own
 * `readAt` so the UI can say how old it is (invariants 25–27).
 */
export async function getCanvasGrades() {
  try {
    const stored = await chrome.storage.local.get(GRADES_KEY);
    const raw = stored[GRADES_KEY];
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

async function applyGrades(message) {
  if (!message.grades || message.grades.length === 0) return { gradesChanged: 0 };
  const store = await getCanvasGrades();
  let gradesChanged = 0;

  for (const grade of message.grades) {
    const key = `${message.domain}|${grade.externalCourseId}`;
    const previous = store[key];

    // Nothing published now, something published before: keep the old reading
    // and say so, rather than replacing a real grade with a blank.
    if (grade.totalsHidden && previous && !previous.totalsHidden) {
      store[key] = { ...previous, totalsHiddenSince: grade.readAt };
      continue;
    }

    if (
      !previous ||
      previous.currentScore !== grade.currentScore ||
      previous.currentGrade !== grade.currentGrade
    ) {
      gradesChanged += 1;
    }
    store[key] = {
      ...grade,
      courseName: grade.courseName ?? previous?.courseName,
      totalsHiddenSince: undefined,
    };
  }

  await chrome.storage.local.set({ [GRADES_KEY]: store });
  return { gradesChanged };
}

export async function clearCanvasGrades() {
  await chrome.storage.local.set({ [GRADES_KEY]: {} });
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

  const { gradesChanged } = await applyGrades(message);

  return { changed, newlyComplete, gradesChanged, total: message.assignments.length };
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
  await clearCanvasGrades();

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

  const grades = Object.values(await getCanvasGrades());
  const checkWindow = await getCheckWindow();

  return {
    configured: !!config,
    domain: config?.domain ?? null,
    connectedAt: config?.connectedAt ?? null,
    lastSeenAt: config?.lastSeenAt ?? null,
    permissionGranted,
    grades,
    checkWindow,
    gateLog: await getGateLog(),
    /**
     * How many Canvas tabs the student has open, and whether any of them is a
     * gradebook. The button can then say "open Canvas → Grades" *before* they
     * press it rather than after.
     */
    canvasTabsOpen: openTabs,
    gradesTabOpen: await gradesTabOpen(config?.domain),
    // Lets the UI tell the truth about whether Chrome will actually prompt.
    broadHostAccess: await hasBroadHostAccess(),
    scriptRegistered: await isCanvasScriptRegistered(),
    detected,
    detectedCount: detected.length,
    openTabs,
  };
}

/** Counts and booleans only — never page text. */
function sanitizeDiagnostics(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') out[key.slice(0, 30)] = value;
    else if (Number.isFinite(value)) out[key.slice(0, 30)] = Math.min(99999, Number(value));
  }
  return out;
}

/** Path only — never the query string, which is where Canvas puts tokens. */
function pathOf(url) {
  try {
    return new URL(url).pathname.slice(0, 120);
  } catch {
    return '';
  }
}

/** How useful a Canvas URL is to read: a gradebook outranks anything else. */
function gradesRank(url) {
  if (typeof url !== 'string') return 0;
  if (/\/courses\/\d+\/grades/.test(url)) return 2;
  if (/\/grades\/?$/.test(url)) return 2;
  return 1;
}

/** True when one of the student's open Canvas tabs is a gradebook. */
async function gradesTabOpen(domain) {
  if (!domain) return false;
  try {
    const tabs = await chrome.tabs.query({ url: `https://${domain}/*` });
    return tabs.some((tab) => gradesRank(tab.url) === 2);
  } catch {
    return false;
  }
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
 * Check Canvas: re-read the Canvas page the student is looking at.
 *
 * ## Why the *active* tab only
 *
 * The old version messaged every open Canvas tab, and an earlier phase went
 * further and opened one in the background. Both are gone. LockIn now reads
 * exactly the page the student deliberately has in front of them, when they
 * press the button — which is the whole claim this feature makes, and it
 * should be true by construction rather than by policy.
 *
 * If the active tab is not Canvas, that is not an error: it is an instruction
 * to the student ("open Canvas → Grades"), and LockIn does not navigate there
 * for them.
 *
 * @param {{ override?: boolean, now?: number }} options
 */
export async function syncCanvasNow(options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const config = await getCanvasConfig();
  if (!config) return { ok: false, reason: 'not-configured' };
  if (!(await hasCanvasPermission(config.domain))) {
    return { ok: false, reason: 'no-permission', domain: config.domain };
  }

  const gate = await canvasGate(options.override ? 'override' : 'manual', now, { config });
  if (!gate.allowed) {
    return {
      ok: false,
      reason: 'gate-refused',
      verdict: gate.verdict,
      overridable: gate.overridable,
      nextAllowedAt: gate.nextAllowedAt,
      domain: config.domain,
    };
  }

  /**
   * Every Canvas tab the student has open — **not** the active one.
   *
   * The first version of this asked for the active tab, which could never
   * work: the button lives in the LockIn tab, so at the moment of the press
   * the active tab is always LockIn and never Canvas. The feature returned
   * "no Canvas tab" every single time.
   *
   * Reading every open Canvas tab keeps the rule that actually matters — LockIn
   * reads pages the student opened themselves, and opens none of its own. A tab
   * they left on their gradebook is exactly such a page.
   */
  let tabs = [];
  try {
    tabs = (await chrome.tabs.query({ url: `https://${config.domain}/*` })).filter(
      (candidate) => candidate.id !== undefined && isConfiguredCanvasUrl(candidate.url, config.domain),
    );
  } catch {
    tabs = [];
  }
  if (tabs.length === 0) {
    return { ok: false, reason: 'no-canvas-tab', domain: config.domain };
  }

  // Grades pages first: they are the ones carrying scores, so if the student
  // has several Canvas tabs open the useful one is read before the noise.
  tabs.sort((a, b) => gradesRank(b.url) - gradesRank(a.url));

  const before = await getCanvasCache();
  const beforeCount = Object.keys(before).length;

  /**
   * Ask each tab to re-read, injecting the reader first if it is not there.
   *
   * A tab that was already open when the extension started has no content
   * script in it — registration only affects *future* navigations. That
   * produced the worst possible failure: the student's gradebook tab stayed
   * silent, a dashboard tab answered instead, and the check reported success
   * having read nothing that carries a score. Telling them to reload the tab
   * was a workaround for something the extension can simply fix, since it
   * already holds `scripting` permission for this origin.
   */
  const kinds = [];
  const tabsSeen = [];
  let reached = 0;
  let injected = 0;

  for (const candidate of tabs) {
    const seen = { path: pathOf(candidate.url), answered: false, injected: false };
    let reply = null;
    try {
      reply = await chrome.tabs.sendMessage(candidate.id, { type: CANVAS_MSG.REPARSE });
    } catch {
      // Nobody home. That happens for a tab loaded before the reader was
      // registered, and — the case that cost days — for a tab whose content
      // script was orphaned by an extension reload. Clear the loader's guards
      // before re-injecting: they live in this extension's isolated world and
      // survive the script that set them, so an injection without this hits
      // `if (window.__lockinCanvasLoaded) return;` and silently does nothing,
      // leaving the tab mute forever.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: candidate.id, allFrames: false },
          func: () => {
            window.__lockinCanvasLoaded = false;
            window.__lockinCanvasActive = false;
          },
        });
        await chrome.scripting.executeScript({
          target: { tabId: candidate.id, allFrames: false },
          files: ['canvas/content.js'],
        });
        injected += 1;
        seen.injected = true;
        // The loader pulls the module in dynamically, so give it a moment.
        await new Promise((resolve) => setTimeout(resolve, 500));
        reply = await chrome.tabs.sendMessage(candidate.id, { type: CANVAS_MSG.REPARSE });
      } catch (error) {
        seen.error = String(error?.message ?? error).slice(0, 120);
      }
    }
    if (reply) {
      reached += 1;
      seen.answered = true;
      if (typeof reply.pageKind === 'string') {
        kinds.push(reply.pageKind);
        seen.kind = reply.pageKind;
      }
    }
    tabsSeen.push(seen);
  }

  // Recorded so a failure like "it only ever reads the dashboard" is a fact on
  // disk rather than a guess. Paths only — no query strings, which is where
  // Canvas puts anything sensitive.
  try {
    const key = LAST_READ_KEY;
    const previous = (await chrome.storage.local.get(key))[key];
    const history = Array.isArray(previous) ? previous : [];
    history.unshift({ at: now, event: 'press', tabsSeen });
    await chrome.storage.local.set({ [key]: history.slice(0, 10) });
  } catch {
    /* diagnostics must never break a check */
  }

  if (reached === 0) {
    return { ok: false, reason: 'tab-not-ready', domain: config.domain };
  }
  const pageKind =
    kinds.find((kind) => kind === 'grades' || kind === 'grades_all') ?? kinds[0] ?? 'unknown';

  // The detection arrives as its own message; give it a moment to land.
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
    pageKind,
    // True when they were on a page that actually carries scores, so the UI can
    // nudge them to Grades instead of silently finding little.
    readGrades: pageKind === 'grades' || pageKind === 'grades_all',
    tabsChecked: reached,
    tabsInjected: injected,
    tabsSeen,
    /** Every page kind that answered, so the UI can say what it actually read. */
    pageKinds: kinds,
    found: afterEntries.length,
    added: Math.max(0, afterEntries.length - beforeCount),
    updated,
    newlySubmitted,
    detected: afterEntries.map(([, value]) => value),
    grades: Object.values(await getCanvasGrades()),
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

  // 5. and the gate agrees this reading may happen at all. A page the student
  //    merely browsed past is refused unless they asked for that; anything
  //    during configured school hours is refused outright.
  const trigger = message.trigger === 'passive' ? 'passive' : 'manual';
  const gate = await canvasGate(trigger, Date.now(), { config });
  if (!gate.allowed) return { ok: false, reason: gate.verdict };

  if (message.type === CANVAS_MSG.UNREADABLE) {
    // Record it. A page that answers and yields nothing is the failure that
    // hides best, so it is the one that most needs writing down.
    try {
      const previous = (await chrome.storage.local.get(LAST_READ_KEY))[LAST_READ_KEY];
      const history = Array.isArray(previous) ? previous : [];
      history.unshift({
        at: Date.now(),
        event: 'unreadable',
        pageKind: typeof message.pageKind === 'string' ? message.pageKind.slice(0, 40) : 'unknown',
        diagnostics: sanitizeDiagnostics(message.diagnostics),
      });
      await chrome.storage.local.set({ [LAST_READ_KEY]: history.slice(0, 10) });
    } catch {
      /* diagnostics must never break a read */
    }
    await setCanvasConfig({ ...config, lastSeenAt: new Date().toISOString() });
    return { ok: true, readable: false };
  }

  const clean = validateDetectionMessage(message, config.domain);
  if (!clean) return { ok: false, reason: 'invalid-payload' };

  // What the page looked like, in counts. Kept so a gradebook that reads as
  // nothing can be diagnosed from this machine rather than guessed at.
  try {
    const previous = (await chrome.storage.local.get(LAST_READ_KEY))[LAST_READ_KEY];
    const history = Array.isArray(previous) ? previous : [];
    history.unshift({
      at: Date.now(),
      pageKind: clean.pageKind,
      assignments: clean.assignments.length,
      grades: clean.grades.length,
      diagnostics: clean.diagnostics,
    });
    await chrome.storage.local.set({ [LAST_READ_KEY]: history.slice(0, 10) });
  } catch {
    /* diagnostics must never break a read */
  }

  const result = await applyDetection(clean);
  return { ok: true, ...result };
}

export const CANVAS_STORAGE_KEYS = {
  CONFIG_KEY,
  CACHE_KEY,
  GRADES_KEY,
  WINDOW_KEY,
  GATE_LOG_KEY,
  LAST_READ_KEY,
};
