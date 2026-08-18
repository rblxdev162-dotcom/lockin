/**
 * The Canvas consent page.
 *
 * This page exists for one reason: `chrome.permissions.request()` only works
 * from an extension page, in response to a real user gesture. A website — even
 * the LockIn app — cannot trigger it. So the app opens this page, the student
 * clicks once, and Chrome shows its own prompt for exactly one origin.
 *
 * We request `https://<their-canvas>/*` and nothing else. No <all_urls>.
 */
import { INTERNAL } from '../shared/protocol.js';

const params = new URLSearchParams(location.search);
const rawDomain = params.get('domain') || '';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.className = `note${tone ? ' ' + tone : ''}`;
}

/** Mirrors canvas/urls.js — kept tiny here so the page has no extra imports. */
function normalize(input) {
  let value = String(input || '').trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9.-]+$/.test(value)) return null;
  const labels = value.split('.');
  if (labels.length < 2) return null;
  return value;
}

const domain = normalize(rawDomain);
$('domain').textContent = domain || 'Unknown site';

if (!domain) {
  setStatus('That Canvas address could not be read. Go back to LockIn and try again.', 'error');
  $('grant').disabled = true;
}

/**
 * Tell the truth about what this button does.
 *
 * LockIn already holds broad site access, because Chrome requires it to
 * redirect blocked websites (Phase 2). So Chrome will NOT show a new prompt
 * here. What the student is actually choosing is the *scope of Canvas
 * reading*, which LockIn enforces itself: the Canvas reader is registered for
 * this one origin, and every detection is re-checked against it.
 *
 * Claiming "Chrome will ask you to confirm" when it won't would be a lie, so
 * the copy adapts.
 */
async function describeAccess() {
  let broad = false;
  try {
    broad = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    broad = false;
  }
  if (!broad) return;

  $('grant').textContent = 'Limit Canvas reading to this site';
  document.querySelector('.foot').innerHTML =
    'LockIn already has site access, because Chrome requires it to redirect blocked ' +
    'websites. Chrome will not show a new prompt. Confirming here tells LockIn to read ' +
    '<strong>only this Canvas site</strong> — you can undo it any time with Disconnect Canvas, ' +
    'or remove LockIn’s access entirely from <code>chrome://extensions</code>.';
}
void describeAccess();

$('grant').addEventListener('click', async () => {
  if (!domain) return;
  setStatus('');
  const origins = [`https://${domain}/*`];

  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins });
  } catch (error) {
    setStatus('Chrome refused the permission request. Please try again.', 'error');
    return;
  }

  // Tell the worker either way so the stored flag matches reality.
  try {
    await chrome.runtime.sendMessage({
      type: INTERNAL.CANVAS_PERMISSION_RESULT,
      domain,
      granted,
    });
  } catch {
    /* worker asleep; it re-checks permissions on its next wake */
  }

  if (granted) {
    setStatus('Canvas connected — LockIn will read only this site. You can close this tab.', 'ok');
    $('grant').disabled = true;
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: INTERNAL.OPEN_APP }).catch(() => {});
      window.close();
    }, 900);
  } else {
    setStatus(
      'Canvas permission not granted. You can enable it later from Settings.',
      'error',
    );
  }
});

$('cancel').addEventListener('click', () => {
  chrome.runtime
    .sendMessage({ type: INTERNAL.CANVAS_PERMISSION_RESULT, domain, granted: false })
    .catch(() => {});
  window.close();
});
