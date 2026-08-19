/**
 * LockIn School Companion — the smallest useful thing.
 *
 * ## What it does
 *
 * It answers one question: **is a Canvas or Edgenuity tab open and in front of
 * you right now?** It sends that answer to LockIn's local service on
 * 127.0.0.1, and it does nothing else.
 *
 * ## What it deliberately cannot do
 *
 * There is no content script in this extension, and no `scripting` permission,
 * so it cannot run code in a page even if something asked it to. It therefore
 * cannot read assignments, lesson text, questions, answers, grades, or any
 * authentication state — not as a policy, but structurally.
 *
 * The only host permission is `http://127.0.0.1/*`, which is LockIn's own
 * service. It has no permission to reach Canvas, Edgenuity, or anything else
 * on the network.
 *
 * The `tabs` permission lets it read a tab's URL. It uses that URL to answer
 * "is this Canvas / Edgenuity / neither", and keeps nothing else: the payload
 * it sends has no field for a URL, a title, a course, or a page.
 *
 * ## Off by default, and it stays off
 *
 * `enabled` starts false. Installing this extension does nothing at all until
 * somebody opens its options page, confirms their organization allows it, and
 * pastes a pairing secret. There is no auto-start, no silent install path, and
 * nothing here modifies a Chrome policy or works around an administrator
 * setting — if a district disallows extensions, that is the answer, and LockIn
 * works without this.
 */

const KEY = 'lockin_school_companion';
const ALARM = 'lockin-school-report';

/** Hostname fragments that identify each provider. Nothing else is reported. */
const PROVIDERS = [
  { provider: 'canvas', hosts: ['instructure.com', 'canvas.'] },
  { provider: 'edgenuity', hosts: ['edgenuity.com', 'imagineedgenuity.com'] },
];

const DEFAULTS = {
  /** Nothing happens until this is deliberately turned on. */
  enabled: false,
  /** Pasted from LockIn. Never generated here. */
  secret: '',
  /** Where LockIn's local service is listening. */
  port: 5173,
  /** The organization-permission confirmation, recorded so it is not implicit. */
  authorizedConfirmed: false,
  lastSentAt: 0,
  lastResult: '',
  /** Epoch ms the current provider session started. */
  startedAt: 0,
  currentProvider: '',
};

export async function getConfig() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return { ...DEFAULTS, ...(stored[KEY] ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/** Which provider a URL belongs to, or null. Pure, and the only URL handling. */
export function providerFor(url) {
  if (typeof url !== 'string') return null;
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const entry of PROVIDERS) {
    if (entry.hosts.some((fragment) => host.includes(fragment))) return entry.provider;
  }
  return null;
}

function nonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 22);
}

/**
 * Sends one context report.
 *
 * The payload is four small facts. There is no field here for anything else,
 * which is the strongest guarantee available: a future change that wanted to
 * send page data would have to add a field, in a diff, on purpose.
 */
async function send(config, provider, activity, now = Date.now()) {
  const body = {
    provider,
    activity,
    startedAt: config.startedAt || now,
    lastActiveAt: now,
    sentAt: now,
    nonce: nonce(),
  };

  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/context/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Not a CORS-simple header, so nothing that is not an extension or a
        // same-origin caller can reach the route at all.
        'x-lockin-bridge': '1',
        'x-lockin-secret': config.secret,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({ ok: false, reason: 'unreadable' }));
    await setConfig({ lastSentAt: now, lastResult: result.ok ? 'ok' : result.reason || 'refused' });
    return result;
  } catch {
    // LockIn's service simply is not running. That is an ordinary state — the
    // student closed it, or has not installed it — not an error to escalate.
    await setConfig({ lastSentAt: now, lastResult: 'no-service' });
    return { ok: false, reason: 'no-service' };
  }
}

/**
 * Looks at the focused tab and reports what provider, if any, is in front.
 *
 * Runs on an alarm rather than on every tab event: a report a minute is plenty
 * for "are they working right now", and it means this extension is asleep
 * almost all of the time.
 */
export async function tick(now = Date.now()) {
  const config = await getConfig();
  if (!config.enabled || !config.secret || !config.authorizedConfirmed) return { skipped: true };

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    return { skipped: true };
  }

  const provider = tab ? providerFor(tab.url) : null;

  if (!provider) {
    // The session ended. One 'closed' report, then silence — repeating it
    // every minute would be chatter with no information in it.
    if (config.currentProvider) {
      await send({ ...config }, config.currentProvider, 'closed', now);
      await setConfig({ currentProvider: '', startedAt: 0 });
    }
    return { provider: null };
  }

  const continuing = config.currentProvider === provider;
  const startedAt = continuing ? config.startedAt || now : now;
  await setConfig({ currentProvider: provider, startedAt });
  await send({ ...config, startedAt }, provider, 'active', now);
  return { provider };
}

/**
 * Listener registration, guarded so the pure parts of this file can be
 * imported by the test suite without a browser.
 *
 * The guard is not a testing hack that weakens anything: inside Chrome the
 * check is always true, and outside Chrome there is nothing to register.
 */
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  });
  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void tick();
  });
}
