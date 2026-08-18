/**
 * The Edgenuity consent page.
 *
 * Exists for the same reason as the Canvas one: `chrome.permissions.request()`
 * only works from an extension page in response to a real user gesture.
 *
 * The difference is that there is no domain to read out of the query string —
 * Edgenuity is a single vendor at known hosts, so the origins are a constant
 * and this page cannot be pointed at anything else.
 */
import { INTERNAL } from '../shared/protocol.js';
import { originPatterns } from './urls.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.className = `note${tone ? ' ' + tone : ''}`;
}

/**
 * Same honesty problem as the Canvas page: LockIn already holds broad site
 * access because Chrome requires it to redirect blocked websites, so Chrome
 * will not show a new prompt. What the student is choosing is the *scope of
 * Edgenuity reading*, which LockIn enforces itself — the reader is registered
 * for Edgenuity origins only, and every reading is re-checked against the
 * sending tab's URL.
 */
async function describeAccess() {
  let broad = false;
  try {
    broad = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    broad = false;
  }
  if (!broad) return;

  $('grant').textContent = 'Limit Edgenuity reading to Edgenuity';
  document.querySelector('.foot').innerHTML =
    'LockIn already has site access, because Chrome requires it to redirect blocked ' +
    'websites. Chrome will not show a new prompt. Confirming here tells LockIn to read ' +
    '<strong>only Edgenuity</strong> — you can undo it any time with Disconnect Edgenuity, ' +
    'or remove LockIn’s access entirely from <code>chrome://extensions</code>.';
}
void describeAccess();

$('grant').addEventListener('click', async () => {
  setStatus('');
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: originPatterns() });
  } catch {
    setStatus('Chrome refused the permission request. Please try again.', 'error');
    return;
  }

  // Tell the worker either way, so the stored flag matches reality.
  try {
    await chrome.runtime.sendMessage({ type: INTERNAL.EDGENUITY_PERMISSION_RESULT, granted });
  } catch {
    /* worker asleep; it re-checks permissions on its next wake */
  }

  if (granted) {
    setStatus('Edgenuity connected — LockIn will read only Edgenuity. You can close this tab.', 'ok');
    $('grant').disabled = true;
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: INTERNAL.OPEN_APP }).catch(() => {});
      window.close();
    }, 900);
  } else {
    setStatus('Edgenuity permission not granted. You can enable it later from Settings.', 'error');
  }
});

$('cancel').addEventListener('click', () => {
  chrome.runtime
    .sendMessage({ type: INTERNAL.EDGENUITY_PERMISSION_RESULT, granted: false })
    .catch(() => {});
  window.close();
});
