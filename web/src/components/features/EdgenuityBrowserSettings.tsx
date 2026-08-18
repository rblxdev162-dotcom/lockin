/**
 * Settings → "Read progress from Edgenuity".
 *
 * The Edgenuity counterpart of `CanvasSettings`, and it has one extra job the
 * Canvas card does not: saying plainly what this reads, what it refuses to
 * read, and that a school-managed device is between the student and their
 * school. LockIn does not get to decide that for them.
 *
 * Wording rule, same as Canvas: this is "reading the page you opened", never
 * an official Edgenuity integration. There isn't one.
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';
import { useApp } from '../../store/context';
import { edgenuityBrowser, disconnectedView } from '../../lib/edgenuity/browserProvider';
import type { EdgenuityExtensionView } from '../../lib/edgenuity/browserProvider';
import { relativeTime } from '../../lib/time';

export function EdgenuityBrowserSettings() {
  const { extension, dispatch, now } = useApp();
  const [view, setView] = useState<EdgenuityExtensionView>(disconnectedView);
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null);

  const extensionReady = extension.status === 'connected';

  const refresh = useCallback(async () => {
    if (!extensionReady) {
      setView(disconnectedView());
      return;
    }
    setView(await edgenuityBrowser.getView());
  }, [extensionReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Readings that arrive while this panel is open are applied here as well as
   * in the store's push handler, because `sync()` returns the cache directly
   * rather than going through a push.
   */
  const applyReadings = (next: EdgenuityExtensionView) => {
    for (const reading of next.courses) {
      dispatch({ type: 'EDGENUITY_BROWSER_READING', reading });
    }
  };

  const connect = async () => {
    setBusy('connect');
    // Opens the extension's own consent page — a web page cannot raise
    // Chrome's permission prompt.
    const next = await edgenuityBrowser.requestPermission();
    setView(next);
    setBusy(null);
    if (next.promptOpened) {
      toast('Finish connecting in the tab that just opened.', 'success');
    } else {
      toast('LockIn could not reach the extension. Is it installed?', 'error');
    }
  };

  const sync = async () => {
    setBusy('sync');
    const next = await edgenuityBrowser.sync();
    setView(next);
    applyReadings(next);
    setBusy(null);
    if (next.sync?.ok) {
      toast(
        next.sync.found
          ? `Read ${next.sync.found} course${next.sync.found === 1 ? '' : 's'} from Edgenuity.`
          : 'Nothing readable on the open Edgenuity pages yet.',
        next.sync.found ? 'success' : 'info',
      );
    } else if (next.sync?.reason === 'no-edgenuity-tab') {
      // The honest answer. LockIn never opens Edgenuity by itself.
      toast('Open your Edgenuity course page in a tab, then check again.', 'info');
    } else {
      toast('Could not read Edgenuity right now.', 'error');
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    const next = await edgenuityBrowser.disconnect();
    setView(next);
    setBusy(null);
    toast('Edgenuity reading turned off.', 'success');
  };

  const active = view.connected && view.permissionGranted && view.scriptRegistered;

  return (
    <Card id="edgenuity-browser">
      <CardHeader
        title="Read progress from Edgenuity"
        subtitle="Counts completed activities from the Edgenuity page you have open — no photo needed."
        action={
          <Badge tone={active ? 'mint' : 'neutral'}>{active ? 'On' : 'Off'}</Badge>
        }
      />

      <div className="space-y-4">
        <ul className="space-y-1.5 text-sm lk-muted">
          <li className="flex gap-2">
            <Icon name="check" size={15} className="mt-0.5 shrink-0" />
            <span>
              Reads only Edgenuity, and only pages <strong>you</strong> open. LockIn never loads
              an Edgenuity page by itself.
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={15} className="mt-0.5 shrink-0" />
            <span>
              Keeps two numbers per course — how many activities are done, and the course
              percentage. Never your work, answers, scores or page text.
            </span>
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={15} className="mt-0.5 shrink-0" />
            <span>Stays switched off on quizzes, tests and exams.</span>
          </li>
        </ul>

        {!extensionReady && (
          <p className="rounded-xl border px-3 py-2 text-sm lk-border lk-muted">
            This needs the LockIn Chrome extension, which isn’t answering right now. Everything
            else in LockIn keeps working — you just can’t read Edgenuity automatically.
          </p>
        )}

        {active && (
          <>
            <dl className="grid gap-2 sm:grid-cols-3">
              <Stat label="Courses seen" value={String(view.courseCount)} />
              <Stat
                label="Edgenuity tabs open"
                value={String(view.openTabs)}
                tone={view.openTabs > 0 ? 'mint' : 'neutral'}
              />
              <Stat
                label="Last read"
                value={view.lastSeenAt ? relativeTime(view.lastSeenAt, new Date(now)) : 'Not yet'}
              />
            </dl>

            {/*
              "0 courses, 0 tabs, never read" is technically true and completely
              useless — it is the same display whether Edgenuity is closed, or
              open in a Chrome profile this extension can never see. The second
              case is invisible by construction and impossible to guess at, so
              it gets said out loud rather than left as a silent zero.
            */}
            {view.courseCount === 0 && view.openTabs === 0 && (
              <div className="rounded-xl border px-3 py-2.5 text-sm lk-border">
                <p className="font-semibold lk-strong">No Edgenuity page seen yet</p>
                <p className="mt-1 lk-muted">
                  If Edgenuity is open right now, it is in a different Chrome profile.
                  Extensions cannot see across profiles — LockIn only reads tabs in the
                  same profile it is installed in.
                </p>
                <p className="mt-1.5 lk-muted">
                  Open <strong>learn.edgenuity.com</strong> in <em>this</em> Chrome window and
                  log in there. Nothing about LockIn touches your school profile.
                </p>
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          {!active ? (
            <Button
              onClick={connect}
              disabled={!extensionReady || busy === 'connect'}
              icon={<Icon name="edgenuity" size={16} />}
            >
              {busy === 'connect' ? 'Opening…' : 'Turn on Edgenuity reading'}
            </Button>
          ) : (
            <>
              <Button onClick={sync} disabled={busy === 'sync'}>
                {busy === 'sync' ? 'Checking…' : 'Check open Edgenuity tabs'}
              </Button>
              <Button variant="secondary" onClick={disconnect} disabled={busy === 'disconnect'}>
                Turn off
              </Button>
            </>
          )}
        </div>

        {/*
          The one thing research could not answer for the student: their own
          school's rules. Reading your own page in your own session is between
          you and Edgenuity's terms; installing an extension on a device the
          school manages is between you and your school.
        */}
        <p className="text-xs lk-muted">
          On a computer your school manages, check your district’s device rules before turning
          this on — some schools only allow extensions they have approved. On your own computer
          this is your call.
        </p>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'mint' | 'neutral';
}) {
  return (
    <div className="rounded-xl border px-3 py-2 lk-border">
      <dt className="text-xs uppercase tracking-wide lk-muted">{label}</dt>
      <dd className={tone === 'mint' ? 'text-sm font-semibold text-mint-600' : 'text-sm font-semibold'}>
        {value}
      </dd>
    </div>
  );
}
