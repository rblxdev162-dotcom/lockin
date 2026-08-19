/**
 * The companion's own settings page.
 *
 * It deliberately owns almost nothing. Blocked sites, allowed sites, reminder
 * timing and Focus Mode rules are LockIn's data and are edited in LockIn —
 * duplicating them here would create two copies that drift, and the extension
 * is a mirror of app state by design (`validateBridgeState` exists for exactly
 * that reason).
 *
 * What is left is what genuinely belongs to the browser half: what the
 * extension can see, what it has been granted, today's counters, and a reset.
 */
import { INTERNAL } from '../shared/protocol.js';

const $ = (id) => document.getElementById(id);

function minutes(ms) {
  const total = Math.round((ms || 0) / 60_000);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

async function render() {
  $('version').textContent = `Version ${chrome.runtime.getManifest().version}`;

  try {
    const view = await chrome.runtime.sendMessage({ type: INTERNAL.GET_ACTIVITY });
    if (view?.activity) {
      $('stat-productive').textContent = minutes(view.activity.productiveMs);
      $('stat-distracting').textContent = minutes(view.activity.distractingMs);
      $('stat-blocked').textContent = String(view.activity.distractionAttempts ?? 0);
    }
  } catch {
    // The worker restarts constantly; an unavailable counter is not an error
    // worth shouting about on a settings page.
  }

  await renderPermissions();
}

async function renderPermissions() {
  let stored;
  try {
    stored = (await chrome.storage.local.get('lockin_canvas'))?.lockin_canvas;
  } catch {
    stored = null;
  }
  const domain = stored?.domain;
  const granted = stored?.permissionGranted === true;

  if (domain && granted) {
    $('perm-canvas').textContent = `Canvas page reading is on for ${domain}.`;
    $('drop-canvas').hidden = false;
  } else if (domain) {
    $('perm-canvas').textContent = `${domain} is configured, but Chrome has not granted access to it.`;
    $('drop-canvas').hidden = true;
  } else {
    $('perm-canvas').textContent = 'No Canvas domain is connected.';
    $('drop-canvas').hidden = true;
  }
}

$('open-app').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: INTERNAL.OPEN_APP }).catch(() => {});
});

$('drop-canvas').addEventListener('click', async () => {
  let stored;
  try {
    stored = (await chrome.storage.local.get('lockin_canvas'))?.lockin_canvas;
  } catch {
    return;
  }
  if (!stored?.domain) return;
  // Chrome requires the removal to come from a user gesture in an extension
  // page, which is exactly what this click is.
  await chrome.permissions.remove({ origins: [`https://${stored.domain}/*`] }).catch(() => {});
  await renderPermissions();
});

$('reset').addEventListener('click', async () => {
  // Named keys rather than `clear()`: a blanket wipe would also take whatever
  // the next feature stores, including things a student would not expect a
  // "clear counters" button to remove.
  await chrome.storage.local
    .remove([
      'lockin_block_stats',
      'lockin_reminder_schedule',
      'lockin_reminders_fired',
      'lockin_reminders_snoozed',
      'lockin_last_notification',
      'lockin_last_praise',
      'lockin_activity',
      'lockin_calendar',
    ])
    .catch(() => {});
  $('reset-note').hidden = false;
  await render();
});

void render();
