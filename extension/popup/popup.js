/** Read-only status view. Every state change happens in the web app. */
import { INTERNAL } from '../shared/protocol.js';

const $ = (id) => document.getElementById(id);

function formatCountdown(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function render() {
  let view;
  try {
    view = await chrome.runtime.sendMessage({ type: INTERNAL.GET_VIEW });
  } catch {
    $('state').textContent = 'Unavailable';
    $('foot').textContent = 'The extension is restarting. Reopen this popup.';
    return;
  }
  if (!view || !view.state) return;

  const { state, blocking, blockedCount } = view;
  const now = Date.now();
  const unlocked = state.temporaryUnlockUntil && state.temporaryUnlockUntil > now;

  if (!state.focusModeActive) {
    $('pill').textContent = 'OFF';
    $('pill').className = 'pill';
    $('state').textContent = 'OFF';
    $('idle-note').hidden = false;
    $('active-block').hidden = true;
    $('foot').textContent = 'Start Focus Mode in LockIn to block distractions.';
    return;
  }

  $('idle-note').hidden = true;
  $('active-block').hidden = false;

  if (unlocked) {
    $('pill').textContent = 'UNLOCKED';
    $('pill').className = 'pill paused';
    $('state').textContent = 'PAUSED';
    $('foot').textContent = `Blocking returns in ${formatCountdown(state.temporaryUnlockUntil - now)}.`;
  } else if (state.isTest) {
    $('pill').textContent = 'TEST';
    $('pill').className = 'pill test';
    $('state').textContent = 'TEST MODE';
    $('foot').textContent = state.testExpiresAt
      ? `Test ends in ${formatCountdown(state.testExpiresAt - now)}.`
      : '';
  } else {
    $('pill').textContent = 'ACTIVE';
    $('pill').className = 'pill on';
    $('state').textContent = 'ACTIVE';
    $('foot').textContent = blocking
      ? 'School sites and Google stay open.'
      : 'Blocking is switched off in LockIn settings.';
  }

  const remaining = Math.max(0, state.requiredTaskCount - state.completedTaskCount);
  $('tasks-remaining').textContent = String(remaining);
  $('blocked-count').textContent = String(blockedCount);

  if (state.requiredTaskCount > 0) {
    $('bar-wrap').hidden = false;
    $('bar').style.width = `${Math.min(100, (state.completedTaskCount / state.requiredTaskCount) * 100)}%`;
  }

  if (state.currentTaskTitle) {
    $('task-row').hidden = false;
    $('task-title').textContent = state.currentTaskTitle;
  }
}

$('open-lockin').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: INTERNAL.OPEN_APP }).catch(() => {});
  window.close();
});

void render();
// Keep countdowns live while the popup is open.
setInterval(render, 1000);
