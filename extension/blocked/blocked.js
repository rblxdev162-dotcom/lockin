/**
 * Block page controller.
 *
 * The only thing this page knows about the blocked request is the domain that
 * matched a rule — the full URL never reaches it. Loading the page is what
 * increments that domain's block counter.
 */
import { INTERNAL } from '../shared/protocol.js';
import { prettyDomain } from '../shared/domains.js';

const params = new URLSearchParams(window.location.search);
const rawDomain = params.get('d') || '';
// Defensive: only ever render a plain hostname, never arbitrary text.
const domain = /^[a-z0-9.-]{1,253}$/i.test(rawDomain) ? rawDomain.toLowerCase() : '';

const $ = (id) => document.getElementById(id);

$('site-name').textContent = domain ? prettyDomain(domain) : 'a blocked site';
// The friendly name is for reading; the exact host is for knowing. Showing
// only "YouTube" leaves a student guessing which of several hosts was blocked
// — and if the friendly name is ever wrong, the fact is still on the page.
$('site-domain').textContent = domain;
document.title = domain ? `${prettyDomain(domain)} is blocked — LockIn` : 'Blocked by LockIn';

/** Ask the worker for the current view and paint progress. */
async function render() {
  let view;
  try {
    view = await chrome.runtime.sendMessage({ type: INTERNAL.GET_VIEW });
  } catch {
    return; // worker restarting; the static copy is still correct
  }
  if (!view || !view.state) return;

  const { state } = view;

  /**
   * The static copy says "Focus Mode is active", which stopped being true when
   * blocking started running through homework hours on its own. Saying it
   * anyway would be the app misdescribing its own state on the one page a
   * student reads when they are annoyed with it.
   */
  if (!state.focusModeActive && !state.isTest) {
    $('kicker').textContent = 'Homework hours.';
    $('hint').textContent =
      'LockIn blocks distractions after school. It stops by itself at midnight, and during school hours.';
  }

  if (state.isTest) {
    $('kicker').textContent = 'TEST MODE is active.';
    $('hint').textContent =
      'This is the 5-minute blocking test from LockIn Settings. It ends by itself.';
  }

  if (state.requiredTaskCount > 0) {
    $('progress-panel').hidden = false;
    $('progress-count').textContent = `${state.completedTaskCount} / ${state.requiredTaskCount}`;
    const pct = Math.min(100, (state.completedTaskCount / state.requiredTaskCount) * 100);
    $('progress-fill').style.width = `${pct}%`;
  }

  if (state.currentTaskTitle) {
    $('task-row').hidden = false;
    $('task-title').textContent = state.currentTaskTitle;
  }
}

/* Count this block — aggregate only, no URL is stored. */
if (domain) {
  chrome.runtime.sendMessage({ type: INTERNAL.BLOCK_HIT, domain }).catch(() => {});
}

void render();

/* ---------------- actions ---------------- */

$('open-lockin').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: INTERNAL.OPEN_APP }).catch(() => {});
});

$('go-back').addEventListener('click', () => {
  // history.back() would land on the blocked URL again and bounce straight
  // back here. Going two entries back skips the blocked navigation itself;
  // if there's nowhere to go, fall back to the new-tab page.
  if (history.length > 2) history.go(-2);
  else chrome.runtime.sendMessage({ type: INTERNAL.OPEN_APP }).catch(() => {});
});

const toggle = $('school-toggle');
toggle.addEventListener('click', () => {
  const open = $('school-panel').hidden;
  $('school-panel').hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
});

$('school-cancel').addEventListener('click', () => {
  $('school-panel').hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
});

$('request-temp').addEventListener('click', () => {
  chrome.runtime
    .sendMessage({ type: INTERNAL.REQUEST_TEMP_ACCESS, domain })
    .catch(() => {});
});

$('request-allow').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: INTERNAL.REQUEST_ALLOWLIST, domain }).catch(() => {});
});
