/**
 * Translates LockIn state into declarativeNetRequest dynamic rules.
 *
 * Two bands of rules:
 *   priority 2  → `allow` for every school/protected domain
 *   priority 1  → `redirect` to the block page for every blocked domain
 *
 * Chrome resolves ties by priority and, within a priority, `allow` beats
 * `redirect`. Both mechanisms point the same way, so the allowlist can never
 * lose. Only `main_frame` requests are touched: sub-resources are left alone so
 * an embedded video on a school page doesn't break the page.
 */
import { PROTECTED_DOMAINS, hostMatches, normalizeDomain } from '../shared/domains.js';

const ALLOW_PRIORITY = 2;
const BLOCK_PRIORITY = 1;

/** True when blocking should be enforced right now. Mirrors the web selector. */
export function isBlockingActive(state, now = Date.now()) {
  if (!state || !state.focusModeActive) return false;
  if (!state.blockingEnabled) return false;
  if (state.temporaryUnlockUntil && state.temporaryUnlockUntil > now) return false;
  if (state.isTest && state.testExpiresAt && state.testExpiresAt <= now) return false;
  return true;
}

/**
 * Everything that must never be blocked: the built-in protected list, the
 * school allowlist, and — critically — the configured Canvas domain.
 *
 * Canvas is included here rather than relying on the allowlist so that deleting
 * it from the school allowlist by mistake cannot lock a student out of the site
 * their homework lives on.
 */
function allowedDomainsFor(state) {
  const list = [...PROTECTED_DOMAINS, ...(state.allowedDomains || [])];
  if (state.canvasDomain) list.push(state.canvasDomain);
  return list;
}

/** Blocked domains minus anything the allowlist or protection list rescues. */
export function effectiveBlocklist(state) {
  const allowed = allowedDomainsFor(state);
  const seen = new Set();
  const out = [];
  for (const raw of state.blockedDomains || []) {
    const domain = normalizeDomain(raw);
    if (!domain || seen.has(domain)) continue;
    if (allowed.some((a) => hostMatches(domain, a))) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

export function buildRules(state, now = Date.now()) {
  if (!isBlockingActive(state, now)) return [];

  const rules = [];
  let id = 1;

  // Allow band first — school domains, Google, Canvas, and LockIn itself.
  const allowSet = new Set();
  for (const raw of allowedDomainsFor(state)) {
    const domain = raw === 'localhost' ? 'localhost' : normalizeDomain(raw);
    if (!domain || allowSet.has(domain)) continue;
    allowSet.add(domain);
    rules.push({
      id: id++,
      priority: ALLOW_PRIORITY,
      action: { type: 'allow' },
      condition: { requestDomains: [domain], resourceTypes: ['main_frame'] },
    });
  }

  // Block band — redirect to the in-extension block page, never close a tab.
  for (const domain of effectiveBlocklist(state)) {
    rules.push({
      id: id++,
      priority: BLOCK_PRIORITY,
      action: {
        type: 'redirect',
        redirect: {
          // Only the domain travels to the block page — never the full URL, so
          // no browsing history is written anywhere.
          extensionPath: `/blocked/blocked.html?d=${encodeURIComponent(domain)}`,
        },
      },
      condition: { requestDomains: [domain], resourceTypes: ['main_frame'] },
    });
  }

  return rules;
}

/** Replaces every dynamic rule with the ones this state implies. */
/**
 * Serialises rule writes.
 *
 * `refresh()` is called from six places — cold start, onInstalled, onStartup,
 * the heartbeat alarm, the expiry alarm, `storage.onChanged` and every
 * SYNC_STATE from the app — and several of those fire within milliseconds of
 * each other when Chrome starts. The read-then-write below is not atomic, so
 * two overlapping runs both saw an empty rule set, both built rules numbered
 * from 1, and the second one failed with:
 *
 *   Error: Rule with id 1 does not have a unique ID.
 *
 * The failure is caught upstream, so nothing crashed — it simply meant the
 * blocking rules were not applied that time round, which is the one failure
 * this extension exists to prevent. A chained promise makes overlapping calls
 * queue instead of race.
 */
let ruleWriteQueue = Promise.resolve(0);

export async function applyRules(state, now = Date.now()) {
  const run = ruleWriteQueue.then(
    () => writeRules(state, now),
    () => writeRules(state, now),
  );
  // The queue must survive a failed write, or one error stalls every later one.
  ruleWriteQueue = run.catch(() => 0);
  return run;
}

async function writeRules(state, now) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = buildRules(state, now);

  /**
   * Remove what is there *and* every id about to be added.
   *
   * The union matters: if a previous write half-applied, or another context
   * added rules between the read above and the write below, an id we are about
   * to add may already exist without appearing in `existing`. Naming it in
   * `removeRuleIds` is harmless when it is absent and decisive when it is not —
   * Chrome processes removals before additions.
   */
  const removeRuleIds = [...new Set([...existing.map((r) => r.id), ...addRules.map((r) => r.id)])];

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  return addRules.length;
}
