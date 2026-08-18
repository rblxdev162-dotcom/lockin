/**
 * The Edgenuity bridge — reading a course page in a Chrome window LockIn's
 * extension can never reach.
 *
 * ## Why this exists
 *
 * Chrome profiles are fully isolated: the LockIn extension installed in the
 * personal profile cannot see a tab in the school profile, and no API, flag or
 * permission crosses that line. But the two profiles are two *windows of one
 * application*, and this file is not in a browser at all — it runs in the
 * LaunchAgent that already serves LockIn on :5173. From outside, macOS lets one
 * process ask another about its windows.
 *
 * So the read goes around the browser instead of through it. Nothing is
 * installed in the school profile, nothing is bookmarked there, and no window
 * has to be shared or photographed.
 *
 * ## What it will and will not do
 *
 * It runs ONE fixed, embedded script, and only ever in a tab already showing
 * an Edgenuity course page. The script is a constant in this file — no
 * JavaScript from the HTTP request is ever executed, because the moment a
 * local endpoint can run caller-supplied code in your browser it stops being a
 * study app and becomes a vulnerability.
 *
 * It returns at most: a course id, a course name, and two integers. Never page
 * text, never answers, never scores, never other tabs' URLs.
 *
 * It refuses assessment pages, exactly like the extension does.
 *
 * ## The two things the student has to grant, once
 *
 *   1. **Automation** — macOS asks the first time this talks to Chrome.
 *   2. **View → Developer → Allow JavaScript from Apple Events** in Chrome.
 *      This is an application-wide toggle, not a per-profile setting, so it can
 *      be switched on from the personal window and applies everywhere.
 *
 * `diagnose()` exists so the UI can say which of those is missing instead of
 * showing a dead button.
 */
import { execFile } from 'node:child_process';

/** Hosts that count as Edgenuity. Mirrors extension/edgenuity/types.js. */
const EDGENUITY_HOSTS = ['edgenuity.com', 'imagineedgenuity.com'];

/** Mirrors extension/edgenuity/types.js — an assessment is never read. */
const ASSESSMENT_URL_HINTS = [
  'quiz',
  'test',
  'exam',
  'assessment',
  'proctor',
  'lockdown',
  'benchmark',
  'diagnostic',
];

/** osascript is fast, but a hung Apple Event must never wedge the server. */
const TIMEOUT_MS = 8000;

/**
 * The page-side extractor, as source text.
 *
 * Deliberately the same three rules as `extension/edgenuity/parser.js`: an
 * accessible progress bar, "12 of 40 activities" in rendered text, and a
 * percentage the page itself labels as progress. Two readings that disagree
 * mean the page was misread, so it returns nothing rather than picking one.
 *
 * Kept as a string because it is evaluated inside Chrome, not here. It touches
 * nothing but the document, and returns a JSON string or "null".
 */
const EXTRACTOR = `(function () {
  try {
    var text = (document.body ? (document.body.innerText || document.body.textContent || '') : '')
      .replace(/\\s+/g, ' ').slice(0, 200000);

    var PROGRESS = /progress|complete|completed|finished/i;

    function bar() {
      var nodes = document.querySelectorAll('[role="progressbar"], progress');
      if (!nodes.length || nodes.length > 40) return null;
      var found = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var label = [n.getAttribute('aria-label'), n.getAttribute('title'),
          n.parentElement ? n.parentElement.textContent : ''].join(' ');
        if (!PROGRESS.test(label)) continue;
        var now = Number(n.getAttribute('aria-valuenow') !== null ? n.getAttribute('aria-valuenow') : n.value);
        var max = Number(n.getAttribute('aria-valuemax') !== null ? n.getAttribute('aria-valuemax') : (n.max || 100));
        if (!isFinite(now) || !(max > 0)) continue;
        var pct = Math.round((now / max) * 100);
        if (pct >= 0 && pct <= 100 && found.indexOf(pct) === -1) found.push(pct);
      }
      return found.length === 1 ? found[0] : null;
    }

    function counts() {
      var re = /(\\d{1,4})\\s*(?:of|\\/|out of)\\s*(\\d{1,4})\\s*(?:activities|activity|lessons|assignments)/gi;
      var m, seen = [], pair = null;
      while ((m = re.exec(text)) !== null) {
        var c = Number(m[1]), t = Number(m[2]);
        if (!(t > 0) || c > t || t > 2000) continue;
        var key = c + '/' + t;
        if (seen.indexOf(key) === -1) { seen.push(key); pair = { completed: c, total: t }; }
      }
      return seen.length === 1 ? pair : null;
    }

    function labelledPercent() {
      var re = /(\\d{1,3})\\s*%/g, m, found = [];
      while ((m = re.exec(text)) !== null) {
        var v = Number(m[1]);
        if (v < 0 || v > 100) continue;
        var from = Math.max(0, m.index - 48);
        var ctx = text.slice(from, m.index + m[0].length + 48);
        if (PROGRESS.test(ctx) && found.indexOf(v) === -1) found.push(v);
      }
      return found.length === 1 ? found[0] : null;
    }

    var b = bar(), p = labelledPercent(), c = counts();
    if (b !== null && p !== null && Math.abs(b - p) > 1) return 'null';
    var percent = b !== null ? b : p;
    if (percent === null && !c) return 'null';

    var h1 = document.querySelector('h1, [role="heading"][aria-level="1"]');
    var name = ((h1 && h1.textContent) || (document.title || '').split(/[|\\u2013\\u2014]/)[0] || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 120);

    var id = null;
    try {
      var u = new URL(location.href);
      var keys = ['courseId', 'courseid', 'CourseID', 'cid', 'courseSectionId'];
      for (var k = 0; k < keys.length; k++) {
        var v = u.searchParams.get(keys[k]);
        if (v && /^[a-z0-9_-]{1,64}$/i.test(v)) { id = v; break; }
      }
      if (!id) { var d = u.pathname.match(/\\/(\\d{4,})(?:\\/|$)/); if (d) id = d[1]; }
    } catch (e) {}
    if (!id) id = name ? 'name:' + name : null;
    if (!id) return 'null';

    return JSON.stringify({
      externalCourseId: String(id).slice(0, 64),
      courseName: name || undefined,
      progressPercent: percent === null ? undefined : percent,
      activitiesCompleted: c ? c.completed : undefined,
      activitiesTotal: c ? c.total : undefined
    });
  } catch (e) {
    return 'null';
  }
})()`;

/**
 * Runs a JXA script and resolves its stdout.
 *
 * JXA rather than AppleScript so the extractor above can be embedded as
 * ordinary JavaScript instead of being escaped into AppleScript string syntax,
 * which is where this kind of code usually goes wrong. The script is fed on
 * stdin so nothing has to survive shell or argv quoting either.
 */
function runJxa(source) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'osascript',
      ['-l', 'JavaScript', '-'],
      { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(new Error(stderr || error.message), { stderr: String(stderr || '') }));
          return;
        }
        resolve(String(stdout).trim());
      },
    );
    child.stdin.end(source);
  });
}

function isEdgenuityUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return EDGENUITY_HOSTS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

function looksLikeAssessment(url) {
  try {
    const parsed = new URL(url);
    const haystack = (parsed.pathname + ' ' + parsed.search).toLowerCase();
    return ASSESSMENT_URL_HINTS.some((hint) => haystack.includes(hint));
  } catch {
    return false;
  }
}

/**
 * Every Chrome tab URL, across every window and therefore every profile.
 *
 * URLs are read here and filtered in Node rather than inside the Apple Event,
 * so the matching rules live in one place with the rest of the project's — and
 * so nothing but Edgenuity is ever acted on.
 */
async function listTabs() {
  const out = await runJxa(`
    var chrome = Application('Google Chrome');
    if (!chrome.running()) { 'NOT_RUNNING'; }
    else {
      var rows = [];
      var wins = chrome.windows();
      for (var w = 0; w < wins.length; w++) {
        var tabs = wins[w].tabs();
        for (var t = 0; t < tabs.length; t++) {
          rows.push({ w: w, t: t, url: tabs[t].url() });
        }
      }
      JSON.stringify(rows);
    }
  `);
  if (out === 'NOT_RUNNING') return null;
  try {
    return JSON.parse(out);
  } catch {
    return [];
  }
}

/** Classifies an osascript failure into something the UI can act on. */
function classifyError(error) {
  const message = String(error?.stderr || error?.message || '');
  if (/not authoriz|not allowed|-1743/i.test(message)) {
    return {
      problem: 'automation_denied',
      detail:
        'macOS has not allowed LockIn to talk to Chrome. Open System Settings → Privacy & Security → Automation and enable Chrome for the LockIn service, then try again.',
    };
  }
  if (/javascript.*apple event|not allowed to send apple events|-2700/i.test(message)) {
    return {
      problem: 'apple_events_js_disabled',
      detail:
        'Chrome is blocking scripted reads. In Chrome, open View → Developer → Allow JavaScript from Apple Events, then try again.',
    };
  }
  if (/timed out|ETIMEDOUT|SIGTERM/i.test(message)) {
    return { problem: 'timeout', detail: 'Chrome did not answer in time. Try again.' };
  }
  return { problem: 'unknown', detail: 'LockIn could not read Chrome just now.' };
}

/**
 * What is working and what is not — for the UI, never for verification.
 * @returns {{ ok: boolean, problem?: string, detail?: string,
 *             chromeRunning: boolean, edgenuityTabs: number, jsAllowed?: boolean }}
 */
export async function diagnose() {
  let tabs;
  try {
    tabs = await listTabs();
  } catch (error) {
    return { ok: false, chromeRunning: false, edgenuityTabs: 0, ...classifyError(error) };
  }
  if (tabs === null) {
    return {
      ok: false,
      problem: 'chrome_closed',
      detail: 'Chrome is not running.',
      chromeRunning: false,
      edgenuityTabs: 0,
    };
  }

  const edgenuity = tabs.filter((row) => isEdgenuityUrl(row.url));
  if (edgenuity.length === 0) {
    return {
      ok: false,
      problem: 'no_edgenuity_tab',
      detail: 'No Edgenuity course page is open in any Chrome window.',
      chromeRunning: true,
      edgenuityTabs: 0,
    };
  }

  /**
   * Prove the JavaScript toggle is on with a trivial expression, in the
   * Edgenuity tab we would actually read. Testing it anywhere else would
   * answer a different question — the tab may be in a window whose profile
   * behaves differently than expected, and that is exactly the unknown here.
   */
  const target = edgenuity[0];
  try {
    await runJxa(`
      var chrome = Application('Google Chrome');
      var tab = chrome.windows[${target.w}].tabs[${target.t}];
      String(tab.execute({ javascript: '1+1' }));
    `);
  } catch (error) {
    return {
      ok: false,
      chromeRunning: true,
      edgenuityTabs: edgenuity.length,
      jsAllowed: false,
      ...classifyError(error),
    };
  }

  return { ok: true, chromeRunning: true, edgenuityTabs: edgenuity.length, jsAllowed: true };
}

/**
 * Reads progress from every open Edgenuity course tab.
 *
 * Assessment pages are skipped before the extractor is ever sent to them —
 * progress does not move during a test, so this costs nothing and keeps LockIn
 * from touching a page a proctor is watching.
 *
 * @returns {{ ok: boolean, courses: object[], skipped: number,
 *             problem?: string, detail?: string }}
 */
export async function readProgress() {
  let tabs;
  try {
    tabs = await listTabs();
  } catch (error) {
    return { ok: false, courses: [], skipped: 0, ...classifyError(error) };
  }
  if (tabs === null) {
    return {
      ok: false,
      courses: [],
      skipped: 0,
      problem: 'chrome_closed',
      detail: 'Chrome is not running.',
    };
  }

  const candidates = tabs.filter((row) => isEdgenuityUrl(row.url));
  const readable = candidates.filter((row) => !looksLikeAssessment(row.url));
  const skipped = candidates.length - readable.length;

  if (readable.length === 0) {
    return {
      ok: false,
      courses: [],
      skipped,
      problem: skipped > 0 ? 'assessment_only' : 'no_edgenuity_tab',
      detail:
        skipped > 0
          ? 'The only Edgenuity pages open are tests. LockIn does not read those.'
          : 'No Edgenuity course page is open in any Chrome window.',
    };
  }

  const courses = [];
  const readAt = new Date().toISOString();
  for (const row of readable) {
    let raw;
    try {
      raw = await runJxa(`
        var chrome = Application('Google Chrome');
        var tab = chrome.windows[${row.w}].tabs[${row.t}];
        String(tab.execute({ javascript: ${JSON.stringify(EXTRACTOR)} }));
      `);
    } catch (error) {
      return { ok: false, courses: [], skipped, ...classifyError(error) };
    }
    if (!raw || raw === 'null' || raw === 'undefined') continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.externalCourseId) {
        courses.push({ ...parsed, readAt });
      }
    } catch {
      /* A tab that answered with something unparseable is simply not read. */
    }
  }

  return { ok: courses.length > 0, courses, skipped, readAt };
}
