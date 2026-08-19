/**
 * The School Companion's only screen.
 *
 * Two things are load-bearing here and both are about consent rather than
 * configuration:
 *
 *  - **The authorization checkbox gates everything.** `enabled` cannot be
 *    switched on until it is ticked, and unticking it switches `enabled` off.
 *    Recording that somebody made the claim is the whole point; an implicit
 *    "well, they installed it" is not the same thing.
 *  - **The pairing code is write-only.** It is stored, never re-displayed. The
 *    field shows whether one is set, not what it is.
 */
import { getConfig, setConfig, tick } from './background.js';

const $ = (id) => document.getElementById(id);

function say(message, tone = '') {
  const status = $('status');
  status.textContent = message;
  status.className = `status ${tone}`;
}

/** Plain sentences for every refusal the bridge can return. */
const REASONS = {
  'not-paired': 'LockIn has not issued a pairing code yet. Open Integrations → School Companion in LockIn first.',
  unauthorized: 'That pairing code was not accepted. Show a fresh one in LockIn and paste it again.',
  header: 'The request was rejected by LockIn. Reinstall this extension if it keeps happening.',
  schema: 'LockIn refused the message format. The two halves may be different versions.',
  stale: 'This computer’s clock is more than two minutes out from LockIn’s. Check the date and time.',
  replay: 'That message was a duplicate and was ignored.',
  'no-service': 'LockIn is not running on this computer, or is on a different port.',
  unreadable: 'LockIn answered with something unexpected.',
};

async function render() {
  const config = await getConfig();
  $('authorized').checked = config.authorizedConfirmed;
  $('enabled').checked = config.enabled;
  $('enabled').disabled = !config.authorizedConfirmed;
  $('port').value = String(config.port);
  // Never render the secret back. Its presence is the only fact worth showing.
  $('secret').placeholder = config.secret ? '•••••••• (saved)' : 'Paste the code from LockIn';

  if (config.lastSentAt) {
    const when = new Date(config.lastSentAt).toLocaleTimeString();
    say(
      config.lastResult === 'ok'
        ? `Last report accepted at ${when}.`
        : `Last attempt at ${when}: ${REASONS[config.lastResult] ?? config.lastResult}`,
      config.lastResult === 'ok' ? 'ok' : 'warn',
    );
  }
}

$('authorized').addEventListener('change', async (event) => {
  const authorized = event.target.checked;
  // Withdrawing the claim withdraws the permission with it. Leaving it running
  // on the strength of a claim that was just retracted would be exactly the
  // kind of quiet persistence this package must not have.
  await setConfig({ authorizedConfirmed: authorized, ...(authorized ? {} : { enabled: false }) });
  await render();
});

$('enabled').addEventListener('change', async (event) => {
  await setConfig({ enabled: event.target.checked });
  await render();
});

$('save').addEventListener('click', async () => {
  const secret = $('secret').value.trim();
  const port = Number($('port').value);
  const patch = {};
  if (secret) patch.secret = secret;
  if (Number.isFinite(port) && port > 0 && port < 65536) patch.port = Math.round(port);

  await setConfig(patch);
  $('secret').value = '';
  say('Saved.', 'ok');
  await render();
});

$('test').addEventListener('click', async () => {
  const config = await getConfig();
  if (!config.authorizedConfirmed) {
    say('Confirm your school allows this first.', 'warn');
    return;
  }
  if (!config.secret) {
    say('Paste a pairing code from LockIn first.', 'warn');
    return;
  }
  say('Testing…');
  await tick();
  await render();
});

void render();
