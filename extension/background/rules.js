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

/**
 * True while `now` falls inside the school day the web app sent.
 *
 * `schoolHours` is absent whenever the pause is switched off or LockIn does
 * not know when school is, and an absent window suspends nothing. The interval
 * is half-open, so the moment the last bell rings is already after school.
 *
 * This is checked against the wall clock rather than a stored "school is on"
 * flag on purpose: an MV3 worker that was asleep across the last bell has no
 * flag to trust, but it always knows what time it is.
 */
export function isDuringSchoolHours(schoolHours, now = Date.now(), noSchoolDates = []) {
  if (!schoolHours) return false;
  const { days, from, until } = schoolHours;
  if (!Array.isArray(days) || until <= from) return false;
  const at = new Date(now);
  // A holiday is not a school day. Without this the pause swallows a Monday
  // the student spends at home, which is the opposite of what it is for.
  if (noSchoolDates.includes(localISODate(at))) return false;
  if (!days.includes(at.getDay())) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return minutes >= from && minutes < until;
}

/**
 * `YYYY-MM-DD` in local time — never `toISOString()`, which is UTC and names
 * yesterday for anyone west of Greenwich in the afternoon. The afternoon is
 * the entire subject of this file.
 */
function localISODate(at) {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * True while `now` is inside homework hours — after the last bell on a school
 * day, from the free-day hour otherwise, until midnight.
 *
 * There is no evening cutoff on purpose. The late hours are the ones a student
 * most needs held, and a blocker that clocks off at half past nine protects
 * the wrong half of the evening.
 */
export function isHomeworkTime(homeworkWindow, now = Date.now(), noSchoolDates = []) {
  if (!homeworkWindow) return false;
  const { schoolDays, from, freeDayFrom, until } = homeworkWindow;
  const at = new Date(now);
  const holiday = noSchoolDates.includes(localISODate(at));
  const schoolDay = !holiday && Array.isArray(schoolDays) && schoolDays.includes(at.getDay());
  const start = schoolDay ? from : freeDayFrom;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return minutes >= start && minutes < until;
}

/**
 * True when blocking should be enforced right now. Mirrors `blockingActive()`
 * in `web/src/lib/selectors.ts`.
 *
 * The rule a student can hold in their head is: **LockIn blocks after school,
 * and only after school.** Two mechanisms produce it —
 *
 *   - the school day is carved out, so nothing is blocked in class; and
 *   - homework hours block on their own, with no Focus session started.
 *
 * The second half is the one that matters. Until it existed, blocking only
 * ever ran inside a timer the student chose to start, which meant the student
 * most in need of it — the one who never presses Start — was never blocked at
 * all. A deliberately started Focus session still blocks outside school
 * whenever it runs, including late at night, because that is the student
 * asking for it explicitly.
 */
export function isBlockingActive(state, now = Date.now()) {
  if (!state) return false;
  if (!state.blockingEnabled) return false;
  if (state.temporaryUnlockUntil && state.temporaryUnlockUntil > now) return false;
  if (state.isTest && state.testExpiresAt && state.testExpiresAt <= now) return false;
  /**
   * The five-minute test from Settings ignores the schedule.
   *
   * It is the one way a student can confirm blocking actually works, and a
   * test button that silently does nothing because of the hour teaches the
   * opposite of what it is for. It is deliberate, self-expiring and has a Stop
   * button, so it is the student's call to make at any time.
   */
  if (state.isTest) return true;
  // School time is not homework time.
  if (isDuringSchoolHours(state.schoolHours, now, state.noSchoolDates)) return false;
  // A session the student started themselves.
  if (state.focusModeActive) return true;
  // Homework hours, running on their own.
  return isHomeworkTime(state.homeworkWindow, now, state.noSchoolDates);
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

async function writeRules(state, now, attempt = 0) {
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

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (error) {
    /**
     * Self-heal rather than give up.
     *
     * The queue above serialises this extension's own writes, which is where
     * the collision came from — but "blocking silently did not apply" is too
     * expensive a failure to leave resting on one mechanism being complete.
     * So a duplicate-id rejection is retried once against a freshly read rule
     * set, wiping whatever is actually there first. If it fails again the
     * error propagates, because a second identical failure means something
     * this code does not understand and should be visible.
     */
    if (attempt === 0 && /unique ID/i.test(String(error?.message ?? error))) {
      const current = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: current.map((r) => r.id),
        addRules: [],
      });
      return writeRules(state, now, 1);
    }
    throw error;
  }
  return addRules.length;
}
