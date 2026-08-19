/**
 * The popup: what LockIn would say if you asked it in one glance.
 *
 * Two states and no dashboard. Either a focus session is running — the task,
 * the time left, nothing else — or it is not, and the useful thing is what is
 * next and a button to start it.
 *
 * **It changes nothing.** Every action opens the app at the right screen. The
 * extension enforces Focus Mode; it does not decide when one starts, because a
 * second start path would be a second thing to keep in step with the reducer's
 * `recompute()`. That is invariant 1, seen from this side.
 */
import { INTERNAL } from '../shared/protocol.js';

const $ = (id) => document.getElementById(id);

function clock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "7:00 PM", or "tomorrow, 8:00 AM" when it is not today. */
function dueLabel(iso, now) {
  const due = Date.parse(iso);
  if (Number.isNaN(due)) return '';
  const time = new Date(due).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `Due ${time}`;
  if (days === 1) return `Due tomorrow, ${time}`;
  if (days < 0) return `Was due ${time}`;
  const day = new Date(due).toLocaleDateString(undefined, { weekday: 'long' });
  return `Due ${day}, ${time}`;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The soonest unfinished item on the reminder schedule the app already sent. */
async function nextUp() {
  try {
    const stored = await chrome.storage.local.get('lockin_reminder_schedule');
    const items = Array.isArray(stored.lockin_reminder_schedule)
      ? stored.lockin_reminder_schedule
      : [];
    return items
      .filter((item) => item && typeof item.dueAt === 'string')
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0] ?? null;
  } catch {
    return null;
  }
}

function show(id, visible) {
  $(id).hidden = !visible;
}

async function render() {
  let view;
  try {
    view = await chrome.runtime.sendMessage({ type: INTERNAL.GET_VIEW });
  } catch {
    // The worker is restarting. Say so plainly rather than showing stale numbers.
    $('pill').textContent = '—';
    $('idle-headline').textContent = 'Reconnecting…';
    show('idle-view', true);
    show('focus-view', false);
    return;
  }
  if (!view || !view.state) return;

  const { state, blocking, blockedCount } = view;
  const now = Date.now();
  const unlocked = state.temporaryUnlockUntil && state.temporaryUnlockUntil > now;

  $('conn').textContent = `Connected · v${view.version}`;

  if (state.focusModeActive) {
    show('focus-view', true);
    show('idle-view', false);
    $('primary').hidden = true;
    $('open-lockin').hidden = false;

    $('focus-task').textContent = state.currentTaskTitle || 'Focus Mode';

    if (unlocked) {
      $('pill').textContent = 'UNLOCKED';
      $('pill').className = 'pill paused';
      $('focus-timer').textContent = clock(state.temporaryUnlockUntil - now);
      $('focus-sub').textContent = 'Blocking returns when this runs out.';
    } else if (state.isTest && state.testExpiresAt) {
      $('pill').textContent = 'TEST';
      $('pill').className = 'pill test';
      $('focus-timer').textContent = clock(state.testExpiresAt - now);
      $('focus-sub').textContent = 'Blocking test.';
    } else {
      $('pill').textContent = 'ON';
      $('pill').className = 'pill on';
      const remaining = Math.max(0, state.requiredTaskCount - state.completedTaskCount);
      $('focus-timer').textContent =
        state.requiredTaskCount > 0 ? `${remaining} to go` : `${blockedCount} sites blocked`;
      $('focus-sub').textContent = blocking
        ? `${blockedCount} sites blocked · school sites stay open`
        : 'Blocking is switched off in LockIn settings.';
    }

    if (state.requiredTaskCount > 0) {
      show('bar-wrap', true);
      $('bar').style.width = `${Math.min(100, (state.completedTaskCount / state.requiredTaskCount) * 100)}%`;
    } else {
      show('bar-wrap', false);
    }
    return;
  }

  show('focus-view', false);
  show('idle-view', true);
  $('primary').hidden = false;
  $('open-lockin').hidden = true;
  $('pill').textContent = 'OFF';
  $('pill').className = 'pill';

  const next = await nextUp();
  if (next) {
    show('next-row', true);
    $('next-title').textContent = next.title;
    $('next-due').textContent = dueLabel(next.dueAt, now);
    // The headline is deliberately not a verdict: the popup cannot see
    // completions or pace, and guessing one here would contradict the app.
    $('idle-headline').textContent = 'Ready when you are.';
    $('idle-sub').textContent = '';
    $('primary').textContent = 'Start Focus';
  } else {
    show('next-row', false);
    $('idle-headline').textContent = 'Nothing due right now.';
    $('idle-sub').textContent = 'Open LockIn to plan the week.';
    $('primary').textContent = 'Open LockIn';
  }
}

$('primary').addEventListener('click', async () => {
  const next = await nextUp();
  await chrome.runtime
    .sendMessage({ type: INTERNAL.OPEN_APP, assignmentId: next?.id ?? null, focus: !!next })
    .catch(() => {});
  window.close();
});

$('open-lockin').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: INTERNAL.OPEN_APP }).catch(() => {});
  window.close();
});

$('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

void render();
// Keeps the countdown live while the popup is open, and nothing more.
setInterval(render, 1000);
