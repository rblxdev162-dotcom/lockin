/**
 * Browser Protection setup and status (Phase 8).
 *
 * One component, two contexts: the first-run onboarding step and the Settings
 * page. Both need to answer the same five questions, so they ask them here
 * rather than drifting apart:
 *
 *   1. Is the extension installed?
 *   2. Does it answer right now?
 *   3. Which version, and can it talk to this build?
 *   4. Can it actually block? (blocking switched on, at least one site listed)
 *   5. Which sites would it block?
 *
 * The rule running through all of it: never claim protection that isn't there.
 * Every unhappy state says what is *not* happening, and the app keeps working
 * — planning and assignments never depend on the extension.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../store/context';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';
import { EXTENSION_DOWNLOAD_URL, companionInstallGuide } from '../../lib/downloads';
import { COMPATIBILITY_MESSAGE, PROTOCOL_VERSION } from '../../lib/protocol';
import { prettyDomain } from '../../lib/domains';

export function BrowserProtectionSetup({ compact }: { compact?: boolean }) {
  const { state, extension } = useApp();
  const [testing, setTesting] = useState(false);

  const connected = extension.status === 'connected';
  const guide = companionInstallGuide();
  const checking = extension.status === 'checking';
  const blocked = state.settings.blockedDomains;
  const canBlock = connected && state.settings.blockingEnabled && blocked.length > 0;

  const runTest = async () => {
    setTesting(true);
    const ok = await extension.test();
    setTesting(false);
    toast(
      ok
        ? 'Extension responded — blocking is wired up.'
        : `No response on ${guide.host}. Check it is installed and enabled, that this tab has been reloaded since, and that the copy you installed was built for this address.`,
      ok ? 'success' : 'error',
    );
  };

  return (
    <div className="space-y-4">
      {/* ---- 1 + 2: installed, and answering ---- */}
      <div
        className={`flex items-start gap-3 rounded-2xl border p-4 ${
          connected
            ? 'border-mint-500/40 bg-mint-400/10'
            : checking
              ? 'lk-border lk-sunken'
              : 'border-amber-400/50 bg-amber-400/10'
        }`}
      >
        <Icon
          name={connected ? 'shield' : 'alert'}
          size={20}
          aria-hidden
          className={
            connected
              ? 'mt-0.5 shrink-0 text-mint-600 dark:text-mint-400'
              : 'mt-0.5 shrink-0 text-amber-700 dark:text-amber-300'
          }
        />
        <div className="min-w-0 flex-1 text-sm">
          {connected ? (
            <>
              <p className="font-bold lk-strong">Browser Protection is connected</p>
              <p className="mt-0.5 lk-muted">
                Extension version {extension.version ?? '—'} · message format v
                {extension.protocolVersion ?? '?'} (this site speaks v{PROTOCOL_VERSION})
                {extension.lastSyncedAt
                  ? ` · last synced ${new Date(extension.lastSyncedAt).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                    })}`
                  : ''}
              </p>
            </>
          ) : checking ? (
            <p className="font-bold lk-strong">Checking for Browser Protection…</p>
          ) : extension.everConnected ? (
            <>
              <p className="font-bold lk-strong">Browser Protection is unavailable</p>
              <p className="mt-0.5 leading-relaxed lk-muted">
                LockIn has talked to the extension on this device before, but it isn’t responding
                now. Distracting websites are <strong className="lk-strong">not</strong> being
                blocked. It is usually disabled, removed, or waiting for this tab to be reloaded.
              </p>
            </>
          ) : (
            <>
              <p className="font-bold lk-strong">Browser Protection isn’t installed</p>
              <p className="mt-0.5 leading-relaxed lk-muted">
                Planning, assignments, exams and focus timers all still work. Distracting websites
                just can’t be blocked without the Chrome extension.
              </p>
            </>
          )}
        </div>
        <Badge tone={connected ? 'mint' : checking ? 'neutral' : 'flame'}>
          {connected ? 'Connected' : checking ? 'Checking…' : 'Not connected'}
        </Badge>
      </div>

      {/* ---- 3: version compatibility ---- */}
      {connected && extension.compatibility !== 'ok' && (
        <p
          role="alert"
          className="rounded-2xl border border-amber-400/50 bg-amber-400/10 p-3.5 text-sm font-semibold text-amber-800 dark:text-amber-200"
        >
          {COMPATIBILITY_MESSAGE[extension.compatibility]}
        </p>
      )}

      {/* ---- install instructions ----
           Origin-aware. A Companion is built for one web address and is
           invisible on every other, so instructions that always named the
           repo folder were wrong for anyone using the published site — and
           produced exactly the failure they were meant to prevent. */}
      {!connected && !checking && (
        <div className="rounded-2xl border lk-border p-4 text-sm lk-muted">
          <ol className="list-decimal space-y-1.5 pl-4">
            {guide.steps.map((item, index) => (
              <li key={item.title}>
                <strong className="lk-strong">
                  {index === 0 && guide.download ? (
                    <a
                      className="text-brand-600 underline underline-offset-2 dark:text-brand-300"
                      href={EXTENSION_DOWNLOAD_URL}
                    >
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </strong>
                {' — '}
                {item.body}
              </li>
            ))}
          </ol>
          {extension.everConnected && (
            <p className="mt-3 rounded-xl lk-sunken p-3 text-xs">
              LockIn has talked to a Companion on this device before. If it is still installed,
              the likely reason it cannot be seen here is that this page is{' '}
              <strong className="lk-strong">{guide.host}</strong> and the installed copy was built
              for a different address.
            </p>
          )}
        </div>
      )}

      {/* ---- 4 + 5: can it block, and what ---- */}
      {!compact && (
        <div className="rounded-2xl border lk-border p-4 text-sm">
          <p className="font-bold lk-strong">What would be blocked</p>
          <ul className="mt-2 space-y-1.5 lk-muted">
            <li className="flex items-center gap-2">
              <StatusDot ok={state.settings.blockingEnabled} />
              Blocking is {state.settings.blockingEnabled ? 'switched on' : 'switched off in Settings'}
            </li>
            <li className="flex items-center gap-2">
              <StatusDot ok={blocked.length > 0} />
              {blocked.length === 0
                ? 'No distracting sites listed yet'
                : `${blocked.length} site${blocked.length === 1 ? '' : 's'} listed`}
            </li>
            <li className="flex items-center gap-2">
              <StatusDot ok={canBlock} />
              {canBlock
                ? 'Blocking will apply the next time Focus Mode starts'
                : 'Nothing would be blocked right now'}
            </li>
          </ul>
          {blocked.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-1.5">
              {blocked.slice(0, 12).map((domain) => (
                <span key={domain} className="rounded-lg lk-sunken px-2 py-0.5 text-xs font-semibold lk-strong">
                  {prettyDomain(domain)}
                </span>
              ))}
              {blocked.length > 12 && (
                <span className="px-1 py-0.5 text-xs lk-muted">+{blocked.length - 12} more</span>
              )}
            </p>
          )}
          <p className="mt-3 text-xs lk-muted">
            School sites and Google are protected in code and can never be blocked, whatever is on
            the list. <Link className="underline" to="/settings#browser-protection">Edit the list</Link>
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={testing} onClick={runTest}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
      </div>
    </div>
  );
}

/**
 * A dot *and* a word — never colour alone. Someone who cannot distinguish the
 * green from the amber still reads the sentence next to it, which carries the
 * whole meaning on its own.
 */
function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${
        ok ? 'bg-mint-500 text-white' : 'bg-slate-400/60 text-slate-900 dark:bg-slate-600'
      }`}
    >
      <Icon name={ok ? 'check' : 'close'} size={10} strokeWidth={3} />
    </span>
  );
}
