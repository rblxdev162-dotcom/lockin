/**
 * Tests the real shipped modules (`background/rules.js`, `shared/domains.js`,
 * `shared/protocol.js`) under Node.
 *
 * `matchRules` reimplements how Chrome resolves declarativeNetRequest rules:
 * collect every rule whose condition matches, keep the highest priority, and
 * within that priority let `allow` beat `redirect`. If this file passes, the
 * rule set Chrome receives blocks and allows the same things.
 *
 * Run:  node --test extension/tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRules, isBlockingActive, isHomeworkTime, effectiveBlocklist } from '../background/rules.js';
import { normalizeDomain, hostMatches, shouldBlock, PROTECTED_DOMAINS } from '../shared/domains.js';
import { validateBridgeState, emptyBridgeState, isEnvelope, MSG } from '../shared/protocol.js';

/* ------------------------------------------------------------------ */
/* A faithful-enough DNR evaluator                                     */
/* ------------------------------------------------------------------ */

function conditionMatches(condition, url) {
  const { hostname, protocol } = new URL(url);
  if (!['http:', 'https:'].includes(protocol)) return false;
  if (!condition.resourceTypes.includes('main_frame')) return false;
  return condition.requestDomains.some(
    (d) => hostname === d || hostname.endsWith('.' + d),
  );
}

/** Returns 'allow' | { redirectTo } | 'no-match'. */
function matchRules(rules, url) {
  const matched = rules.filter((r) => conditionMatches(r.condition, url));
  if (matched.length === 0) return 'no-match';
  const top = Math.max(...matched.map((r) => r.priority));
  const band = matched.filter((r) => r.priority === top);
  if (band.some((r) => r.action.type === 'allow')) return 'allow';
  const redirect = band.find((r) => r.action.type === 'redirect');
  return redirect ? { redirectTo: redirect.action.redirect.extensionPath } : 'no-match';
}

function stateWith(overrides = {}) {
  return {
    ...emptyBridgeState(),
    focusModeActive: true,
    blockingEnabled: true,
    blockedDomains: ['youtube.com', 'reddit.com', 'x.com'],
    allowedDomains: ['instructure.com', 'edgenuity.com', 'docs.google.com', 'google.com'],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Domain normalisation                                                */
/* ------------------------------------------------------------------ */

test('normalizes messy input to a bare host', () => {
  assert.equal(normalizeDomain('https://www.youtube.com/watch?v=test'), 'youtube.com');
  assert.equal(normalizeDomain('HTTP://Reddit.COM/r/all'), 'reddit.com');
  assert.equal(normalizeDomain('  www.tiktok.com  '), 'tiktok.com');
  assert.equal(normalizeDomain('http://user:pw@x.com:8080/path#frag'), 'x.com');
  assert.equal(normalizeDomain('docs.google.com'), 'docs.google.com');
  assert.equal(normalizeDomain('twitch.tv.'), 'twitch.tv');
});

test('rejects invalid domains', () => {
  for (const bad of ['', '   ', 'notadomain', 'http://', '...', '-bad.com', 'bad-.com',
                     '192.168.1.1', 'a..b.com', 'space bar.com', 'foo.123']) {
    assert.equal(normalizeDomain(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('hostMatches covers subdomains but not lookalikes', () => {
  assert.ok(hostMatches('m.youtube.com', 'youtube.com'));
  assert.ok(hostMatches('www.youtube.com', 'youtube.com'));
  assert.ok(hostMatches('youtube.com', 'youtube.com'));
  assert.equal(hostMatches('notyoutube.com', 'youtube.com'), false);
  assert.equal(hostMatches('youtube.com.evil.net', 'youtube.com'), false);
});

/* ------------------------------------------------------------------ */
/* The blocking decision                                               */
/* ------------------------------------------------------------------ */

test('allowlist always beats the blocklist', () => {
  // youtube.com on BOTH lists must resolve to "allowed".
  const state = stateWith({ allowedDomains: ['youtube.com'] });
  assert.equal(shouldBlock('youtube.com', state.blockedDomains, state.allowedDomains), false);
  assert.deepEqual(effectiveBlocklist(state).includes('youtube.com'), false);

  const rules = buildRules(state);
  assert.equal(matchRules(rules, 'https://www.youtube.com/watch?v=x'), 'allow');
});

test('Google and school domains are never blocked, even if listed', () => {
  const state = stateWith({
    blockedDomains: ['google.com', 'docs.google.com', 'drive.google.com', 'youtube.com'],
    allowedDomains: [],
  });
  const rules = buildRules(state);
  for (const url of [
    'https://www.google.com/search?q=mitosis',
    'https://docs.google.com/document/d/abc/edit',
    'https://drive.google.com/drive/my-drive',
    'https://classroom.google.com/',
  ]) {
    assert.equal(matchRules(rules, url), 'allow', `${url} must stay reachable`);
  }
  // The genuine distraction still blocks.
  assert.notEqual(matchRules(rules, 'https://youtube.com/'), 'allow');
});

test('Canvas, Edgenuity and Imagine Learning stay reachable', () => {
  const state = stateWith({
    allowedDomains: ['instructure.com', 'edgenuity.com', 'imaginelearning.com', 'clever.com'],
  });
  const rules = buildRules(state);
  for (const url of [
    'https://myschool.instructure.com/courses/1',
    'https://canvas.instructure.com/',
    'https://r10.core.learn.edgenuity.com/player/',
    'https://app.imaginelearning.com/',
    'https://clever.com/in/school',
  ]) {
    assert.equal(matchRules(rules, url), 'allow', `${url} must stay reachable`);
  }
});

test('blocked domains redirect to the extension block page, not a dead tab', () => {
  const rules = buildRules(stateWith());
  const result = matchRules(rules, 'https://www.youtube.com/feed/subscriptions');
  assert.notEqual(result, 'allow');
  assert.notEqual(result, 'no-match');
  assert.match(result.redirectTo, /^\/blocked\/blocked\.html\?d=youtube\.com$/);
});

test('subdomains of a blocked domain are blocked too', () => {
  const rules = buildRules(stateWith());
  assert.ok(matchRules(rules, 'https://m.youtube.com/').redirectTo);
  assert.ok(matchRules(rules, 'https://old.reddit.com/r/all').redirectTo);
});

test('unlisted sites are untouched', () => {
  const rules = buildRules(stateWith());
  assert.equal(matchRules(rules, 'https://en.wikipedia.org/wiki/Mitosis'), 'no-match');
});

test('the LockIn app itself is never blocked', () => {
  const state = stateWith({ blockedDomains: ['localhost', 'youtube.com'] });
  const rules = buildRules(state);
  assert.equal(matchRules(rules, 'http://localhost:5173/home'), 'allow');
});

test('no rule can redirect the block page to itself (no redirect loop)', () => {
  const rules = buildRules(stateWith());
  for (const rule of rules) {
    if (rule.action.type !== 'redirect') continue;
    const target = `https://example.invalid${rule.action.redirect.extensionPath}`;
    // The block page lives on chrome-extension://, which no rule condition can
    // match (requestDomains only sees http/https hosts).
    assert.equal(
      conditionMatches(rule.condition, 'chrome-extension://abcdef/blocked/blocked.html?d=youtube.com'),
      false,
    );
    assert.ok(target.includes('/blocked/blocked.html'));
  }
});

/* ------------------------------------------------------------------ */
/* When blocking is / isn't active                                     */
/* ------------------------------------------------------------------ */

test('no rules exist when Focus Mode is off', () => {
  assert.deepEqual(buildRules(stateWith({ focusModeActive: false })), []);
  assert.equal(isBlockingActive(stateWith({ focusModeActive: false })), false);
});

test('no rules when blocking is disabled in settings', () => {
  assert.deepEqual(buildRules(stateWith({ blockingEnabled: false })), []);
});

test('temporary unlock pauses blocking, then it returns', () => {
  const now = Date.now();
  const state = stateWith({ temporaryUnlockUntil: now + 60_000 });
  assert.equal(isBlockingActive(state, now), false);
  assert.deepEqual(buildRules(state, now), []);

  // One millisecond after expiry the rules are back.
  const after = now + 60_001;
  assert.equal(isBlockingActive(state, after), true);
  assert.ok(buildRules(state, after).length > 0);
});

test('test mode expires on its own', () => {
  const now = Date.now();
  const state = stateWith({ isTest: true, testExpiresAt: now + 5 * 60_000 });
  assert.equal(isBlockingActive(state, now), true);
  assert.equal(isBlockingActive(state, now + 5 * 60_000 + 1), false);
});

/* ------------------------------------------------------------------ */
/* Message validation                                                  */
/* ------------------------------------------------------------------ */

test('rejects malformed bridge state', () => {
  assert.equal(validateBridgeState(null), null);
  assert.equal(validateBridgeState('focusModeActive'), null);
  assert.equal(validateBridgeState({}), null);
  assert.equal(validateBridgeState({ focusModeActive: 'yes' }), null);
});

test('sanitises hostile-looking payloads instead of trusting them', () => {
  const clean = validateBridgeState({
    focusModeActive: true,
    blockedDomains: ['youtube.com', 42, null, 'x'.repeat(300), 'reddit.com'],
    allowedDomains: 'not-an-array',
    currentTaskTitle: 'y'.repeat(500),
    temporaryUnlockUntil: 'soon',
    extraFieldFromAttacker: 'ignored',
  });
  assert.deepEqual(clean.blockedDomains, ['youtube.com', 'reddit.com']);
  assert.deepEqual(clean.allowedDomains, []);
  assert.equal(clean.currentTaskTitle.length, 120);
  assert.equal(clean.temporaryUnlockUntil, null);
  assert.equal('extraFieldFromAttacker' in clean, false);
});

test('caps list sizes so a page cannot flood the rule engine', () => {
  const huge = Array.from({ length: 5000 }, (_, i) => `site${i}.com`);
  assert.equal(validateBridgeState({ focusModeActive: true, blockedDomains: huge }).blockedDomains.length, 500);
});

test('envelope validation rejects unknown message types and sources', () => {
  assert.ok(isEnvelope({ source: 'lockin-web', type: MSG.PING }));
  assert.equal(isEnvelope({ source: 'evil-page', type: MSG.PING }), false);
  assert.equal(isEnvelope({ source: 'lockin-web', type: 'DROP_ALL_RULES' }), false);
  assert.equal(isEnvelope(null), false);
  assert.equal(isEnvelope('PING'), false);
});

/* ------------------------------------------------------------------ */
/* Rule hygiene                                                        */
/* ------------------------------------------------------------------ */

test('rule ids are unique and priorities are banded correctly', () => {
  const rules = buildRules(stateWith());
  const ids = rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate rule ids would be rejected by Chrome');
  for (const rule of rules) {
    assert.ok(rule.id > 0);
    if (rule.action.type === 'allow') assert.equal(rule.priority, 2);
    else assert.equal(rule.priority, 1);
    assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
  }
  assert.ok(PROTECTED_DOMAINS.every((d) => rules.some((r) => r.condition.requestDomains.includes(d))));
});

test('duplicate and invalid entries never reach the rule set', () => {
  const state = stateWith({
    blockedDomains: ['youtube.com', 'https://www.youtube.com/watch', 'YOUTUBE.COM', 'not a domain'],
  });
  const blocked = effectiveBlocklist(state);
  assert.deepEqual(blocked, ['youtube.com']);
});

/* ------------------------------------------------------------------ */
/* The school-hours pause                                              */
/* ------------------------------------------------------------------ */

/** A local wall-clock time on a given weekday. 0 = Sunday. */
function at(weekday, hhmm) {
  // 2024-01-07 was a Sunday, so +weekday lands on the day asked for.
  const [hours, minutes] = hhmm.split(':').map(Number);
  return new Date(2024, 0, 7 + weekday, hours, minutes, 0, 0).getTime();
}

/** Mon–Fri, 7:30am–3:30pm. */
const SCHOOL = { days: [1, 2, 3, 4, 5], from: 7 * 60 + 30, until: 15 * 60 + 30 };

test('no rules exist during school hours', () => {
  const state = stateWith({ schoolHours: SCHOOL });
  assert.equal(isBlockingActive(state, at(3, '10:15')), false);
  assert.deepEqual(buildRules(state, at(3, '10:15')), []);
});

test('a blocked site loads normally during school', () => {
  const state = stateWith({ schoolHours: SCHOOL });
  const rules = buildRules(state, at(1, '12:00'));
  assert.equal(matchRules(rules, 'https://youtube.com/watch'), 'no-match');
});

test('blocking returns by itself after the last bell', () => {
  const state = stateWith({ schoolHours: SCHOOL });
  assert.equal(isBlockingActive(state, at(3, '15:29')), false, 'still school at 3:29');
  assert.equal(isBlockingActive(state, at(3, '15:30')), true, 'the bell ends school');
  const rules = buildRules(state, at(3, '16:00'));
  assert.deepEqual(matchRules(rules, 'https://youtube.com/watch'), {
    redirectTo: '/blocked/blocked.html?d=youtube.com',
  });
});

test('before the first bell is still homework time', () => {
  const state = stateWith({ schoolHours: SCHOOL });
  assert.equal(isBlockingActive(state, at(2, '07:29')), true);
  assert.equal(isBlockingActive(state, at(2, '07:30')), false);
});

test('the pause is weekday-scoped: Saturday blocks all day', () => {
  const state = stateWith({ schoolHours: SCHOOL });
  assert.equal(isBlockingActive(state, at(6, '10:15')), true);
  assert.equal(isBlockingActive(state, at(0, '10:15')), true);
});

test('no school hours means nothing is suspended', () => {
  const state = stateWith({ schoolHours: null });
  assert.equal(isBlockingActive(state, at(3, '10:15')), true);
});

test('a malformed window suspends nothing rather than everything', () => {
  // Validation is the boundary, so junk should never reach the rule builder —
  // but the direction of failure is the whole point, so it is pinned here too.
  for (const broken of [
    { days: [1], from: 600, until: 600 },
    { days: [1], from: 900, until: 600 },
    { days: [], from: 450, until: 930 },
    { days: [1], from: 'noon', until: 930 },
  ]) {
    const clean = validateBridgeState(stateWith({ schoolHours: broken }));
    assert.equal(clean.schoolHours, null, JSON.stringify(broken));
    assert.equal(isBlockingActive(stateWith({ schoolHours: broken }), at(1, '10:00')), true);
  }
});

test('a valid window survives the wire contract intact', () => {
  const clean = validateBridgeState(stateWith({ schoolHours: SCHOOL }));
  assert.deepEqual(clean.schoolHours, SCHOOL);
});

test('school hours cannot resurrect blocking that is off for another reason', () => {
  // Outside school, but Focus Mode is off / blocking disabled / unlocked.
  const evening = at(3, '19:00');
  assert.equal(isBlockingActive(stateWith({ schoolHours: SCHOOL, focusModeActive: false }), evening), false);
  assert.equal(isBlockingActive(stateWith({ schoolHours: SCHOOL, blockingEnabled: false }), evening), false);
  assert.equal(
    isBlockingActive(stateWith({ schoolHours: SCHOOL, temporaryUnlockUntil: evening + 60_000 }), evening),
    false,
  );
});

/* ------------------------------------------------------------------ */
/* Homework hours — blocking that does not wait to be switched on      */
/* ------------------------------------------------------------------ */

/** School ends 3:30pm; free days start 9am; runs to midnight. */
const HOMEWORK = { schoolDays: [1, 2, 3, 4, 5], from: 15 * 60 + 30, freeDayFrom: 9 * 60, until: 24 * 60 };

/** A student who never presses Start: no Focus session, automatic window on. */
function autoState(overrides = {}) {
  return stateWith({
    focusModeActive: false,
    schoolHours: SCHOOL,
    homeworkWindow: HOMEWORK,
    ...overrides,
  });
}

test('blocking runs after school with no Focus session started', () => {
  const rules = buildRules(autoState(), at(3, '16:00'));
  assert.deepEqual(matchRules(rules, 'https://youtube.com/watch'), {
    redirectTo: '/blocked/blocked.html?d=youtube.com',
  });
});

test('homework hours begin at the same bell school hours end at', () => {
  const state = autoState();
  assert.equal(isBlockingActive(state, at(3, '15:29')), false, 'still in class');
  assert.equal(isBlockingActive(state, at(3, '15:30')), true, 'homework hours');
});

test('nothing is blocked before school, automatic or not', () => {
  assert.equal(isBlockingActive(autoState(), at(2, '06:45')), false);
  assert.equal(isBlockingActive(autoState(), at(2, '07:30')), false);
});

test('automatic blocking runs to midnight, not to an evening cutoff', () => {
  const state = autoState();
  assert.equal(isBlockingActive(state, at(3, '21:30')), true);
  assert.equal(isBlockingActive(state, at(3, '23:59')), true);
});

test('a free day blocks from the morning instead of waiting for a bell', () => {
  const state = autoState();
  assert.equal(isBlockingActive(state, at(6, '08:59')), false);
  assert.equal(isBlockingActive(state, at(6, '09:00')), true);
});

test('a no-school date is a free day, not a school day', () => {
  // 2024-01-10 is the Wednesday `at(3, …)` lands on.
  const state = autoState({ noSchoolDates: ['2024-01-10'] });
  // The school pause must not swallow a day spent at home...
  assert.equal(isBlockingActive(state, at(3, '10:15')), true);
  // ...and homework hours start in the morning rather than at 3:30pm.
  assert.equal(isHomeworkTime(HOMEWORK, at(3, '09:30'), ['2024-01-10']), true);
  assert.equal(isHomeworkTime(HOMEWORK, at(3, '09:30'), []), false);
});

test('turning automatic blocking off restores Focus-session-only blocking', () => {
  const off = autoState({ homeworkWindow: null });
  assert.equal(isBlockingActive(off, at(3, '16:00')), false, 'no session, no automatic window');
  assert.equal(
    isBlockingActive({ ...off, focusModeActive: true }, at(3, '16:00')),
    true,
    'a deliberate session still blocks',
  );
});

test('a deliberate Focus session blocks outside homework hours too', () => {
  // 6am on a school day is outside every automatic window, but the student
  // pressed Start, and that is an explicit choice to be held to.
  const state = autoState({ focusModeActive: true });
  assert.equal(isBlockingActive(state, at(2, '06:00')), true);
  // School is the one thing a session cannot override.
  assert.equal(isBlockingActive(state, at(2, '10:00')), false);
});

test('the 5-minute test blocks at any hour, including during school', () => {
  const state = autoState({ isTest: true, testExpiresAt: at(2, '10:05'), focusModeActive: true });
  assert.equal(isBlockingActive(state, at(2, '10:00')), true, 'a test is deliberate and expires');
  assert.equal(isBlockingActive(state, at(2, '10:06')), false, 'and it still expires on time');
});

test('temporary unlock still wins during homework hours', () => {
  const evening = at(3, '17:00');
  const state = autoState({ temporaryUnlockUntil: evening + 60_000 });
  assert.equal(isBlockingActive(state, evening), false);
  assert.equal(isBlockingActive(state, evening + 120_000), true, 'and it expires');
});

test('a malformed homework window blocks nothing rather than everything', () => {
  for (const broken of [
    { schoolDays: [1], from: 930, freeDayFrom: 540, until: 540 },
    { schoolDays: [1], from: 'later', freeDayFrom: 540, until: 1440 },
    { schoolDays: [1], from: 930, freeDayFrom: 540, until: 1441 },
  ]) {
    const clean = validateBridgeState(autoState({ homeworkWindow: broken }));
    assert.equal(clean.homeworkWindow, null, JSON.stringify(broken));
  }
});

test('a valid homework window and no-school dates survive the wire', () => {
  const clean = validateBridgeState(autoState({ noSchoolDates: ['2024-01-10', 'nonsense'] }));
  assert.deepEqual(clean.homeworkWindow, HOMEWORK);
  assert.deepEqual(clean.noSchoolDates, ['2024-01-10']);
});

test('blocking disabled in settings still beats every window', () => {
  assert.equal(isBlockingActive(autoState({ blockingEnabled: false }), at(3, '16:00')), false);
});
