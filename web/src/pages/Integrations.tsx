/**
 * Integrations — Canvas, and the companion that fetches it.
 *
 * Every card answers the same four questions in the same order: what it can
 * access, what it cannot, when it last worked, and how to disconnect. That
 * uniformity is the point — a student deciding whether to hand something their
 * school data should not have to work out which card buried the caveat.
 *
 * Edgenuity was removed in Phase 17. The only channels that were ethical to
 * use (a weekly progress email, a course report file) could not reach this
 * student's browser profile, which made them useless for live data — so rather
 * than ship an integration that would be wrong more often than right, there
 * isn't one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../store/context';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, TextInput, Toggle } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import type { IconName } from '../components/ui/Icon';
import { Modal } from '../components/ui/Modal';
import { toast } from '../components/ui/Toast';
import { SectionHeader } from '../components/ui/Status';
import { cx } from '../lib/cx';
import { relativeAge } from '../lib/sources/freshness';
import {
  FETCH_MESSAGES,
  connectCalendar,
  disconnectCalendar,
  getCalendarView,
  readCalendarFile,
  setCalendarOptions,
  syncCalendar,
} from '../lib/canvas/calendarClient';
import type { CalendarView } from '../lib/canvas/calendarClient';
import { describeDiff, diffIsInteresting, reconcileFeed } from '../lib/canvas/calendarReconcile';
import type { FeedDiff } from '../lib/canvas/calendarReconcile';
import type { IntegrationStatus } from '../types/integrations';

export function IntegrationsPage() {
  const { state, extension } = useApp();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title font-extrabold lk-strong">Integrations</h1>
        <p className="mt-1 text-body lk-muted">
          Connect Canvas so you stop typing your work in by hand.
        </p>
      </header>

      <section aria-labelledby="school-heading">
        <SectionHeader id="school-heading" title="School" />
        <CanvasCard />
      </section>

      <section aria-labelledby="lockin-heading">
        <SectionHeader id="lockin-heading" title="LockIn" />
        <IntegrationCard
          icon="bolt"
          title="LockIn Companion"
          status={extension.status === 'connected' ? 'connected' : 'not_configured'}
          statusText={
            extension.status === 'connected'
              ? `Chrome${extension.version ? ` · v${extension.version}` : ''}`
              : state.settings.extensionSeen
                ? 'Installed, but not answering right now'
                : 'Not installed'
          }
          can={[
            'Block distracting sites in every window of this Chrome profile',
            'Send reminders while LockIn is closed',
            'Fetch your Canvas calendar feed every 30 minutes',
            'Read assignment status from Canvas pages open in this profile',
          ]}
          cannot={[
            'Read any page other than Canvas',
            'See anything in another Chrome profile',
            'Keep a browsing history — block counts are per-site totals',
          ]}
          footer={
            <a
              className="text-caption font-bold lk-muted underline underline-offset-2 hover:lk-strong"
              href="/settings#browser-protection"
            >
              Set up or troubleshoot
            </a>
          }
        />
      </section>

      <p className="text-caption lk-muted">
        Nothing on this page sends your data anywhere. Everything is parsed on
        this device and stored in this browser — see{' '}
        <a className="font-semibold underline underline-offset-2" href="/privacy">
          Privacy
        </a>
        .
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The shared card                                                     */
/* ------------------------------------------------------------------ */

const STATUS_WORD: Record<IntegrationStatus, string> = {
  connected: 'Connected',
  not_configured: 'Not connected',
  error: 'Needs attention',
  disabled: 'Turned off',
  unavailable: 'Not available',
};

const STATUS_TONE: Record<IntegrationStatus, string> = {
  connected: 'lk-status-ahead',
  not_configured: 'lk-status-unknown',
  error: 'lk-status-behind',
  disabled: 'lk-status-unknown',
  unavailable: 'lk-status-unknown',
};

/**
 * One integration, in the shape every integration uses.
 *
 * `can` and `cannot` are required rather than optional. A card that lists its
 * powers and omits its limits is marketing, and the whole reason this page
 * exists is that a student has to be able to trust it.
 */
function IntegrationCard({
  icon,
  title,
  status,
  statusText,
  can,
  cannot,
  children,
  footer,
}: {
  icon: IconName;
  title: string;
  status: IntegrationStatus;
  statusText?: string;
  can: string[];
  cannot: string[];
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <Card className={cx('lk-status-edge', STATUS_TONE[status])}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl lk-sunken border lk-border lk-muted">
            <Icon name={icon} size={19} />
          </span>
          <div className="min-w-0">
            <h3 className="text-heading font-bold lk-strong">{title}</h3>
            <p className="mt-0.5 text-caption">
              <span className="lk-status-text font-bold">{STATUS_WORD[status]}</span>
              {statusText && <span className="lk-muted"> · {statusText}</span>}
            </p>
          </div>
        </div>
      </div>

      {children && <div className="mt-4">{children}</div>}

      <button
        type="button"
        onClick={() => setShowDetail((open) => !open)}
        aria-expanded={showDetail}
        className="mt-3.5 text-caption font-bold lk-muted underline underline-offset-2 hover:lk-strong"
      >
        {showDetail ? 'Hide details' : 'What it can and cannot see'}
      </button>

      {showDetail && (
        <div className="animate-fade mt-2.5 grid gap-4 border-t lk-border pt-3 sm:grid-cols-2">
          <div>
            <p className="text-caption font-bold tracking-wide lk-muted uppercase">Can access</p>
            <ul className="mt-1.5 space-y-1">
              {can.map((line) => (
                <li key={line} className="flex gap-2 text-caption lk-strong">
                  <Icon name="check" size={13} className="mt-0.5 shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-caption font-bold tracking-wide lk-muted uppercase">Cannot access</p>
            <ul className="mt-1.5 space-y-1">
              {cannot.map((line) => (
                <li key={line} className="flex gap-2 text-caption lk-muted">
                  <Icon name="close" size={13} className="mt-0.5 shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {footer && <div className="mt-3">{footer}</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

function CanvasCard() {
  const { state, dispatch, now, extension } = useApp();
  const record = state.integrations.records.find((r) => r.id === 'canvas_calendar');
  const [view, setView] = useState<CalendarView | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ diff: FeedDiff; live: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const companion = extension.status === 'connected';
  const horizon = state.integrations.canvasCalendar.horizonDays;

  const refresh = useCallback(() => {
    void getCalendarView().then((next) => next && setView(next));
  }, []);

  useEffect(() => {
    if (companion) refresh();
  }, [companion, refresh]);

  const applyDiff = (diff: FeedDiff, live: boolean) => {
    dispatch({
      type: 'FEED_APPLY',
      diff,
      sourceId: live ? 'canvas-calendar' : 'canvas-calendar-file',
      syncedAt: new Date(now).toISOString(),
      live,
    });
    dispatch({
      type: 'INTEGRATION_STATUS',
      id: 'canvas_calendar',
      status: 'connected',
      itemCount: diff.create.length + diff.update.length,
      account: view?.host ?? undefined,
    });
    toast(describeDiff(diff), 'success');
    setPending(null);
  };

  const sync = async (force = false) => {
    setBusy(true);
    try {
      const result = await syncCalendar(now, horizon, force);

      if (result.noCompanion) {
        toast('The LockIn Companion isn’t answering, so the feed can’t be fetched.', 'error');
        return;
      }
      if (!result.ok || !result.feed) {
        const message =
          result.reason === 'unreadable'
            ? (result.feed?.fatal ?? 'That feed could not be read.')
            : (FETCH_MESSAGES[result.reason ?? 'network'] ?? 'The sync failed.');
        dispatch({
          type: 'INTEGRATION_STATUS',
          id: 'canvas_calendar',
          status: 'error',
          error: message,
        });
        toast(message, 'error');
        if (result.view) setView(result.view);
        return;
      }

      if (result.view) setView(result.view);
      const diff = reconcileFeed(result.feed.items, state.assignments, {
        sourceId: 'canvas-calendar',
        syncedAt: new Date(result.fetchedAt ?? now).toISOString(),
        live: true,
      });

      if (!diffIsInteresting(diff)) {
        applyDiff(diff, true);
        return;
      }
      setPending({ diff, live: true });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const feed = await readCalendarFile(file, now, horizon);
      if (feed.fatal) {
        toast(feed.fatal, 'error');
        return;
      }
      const diff = reconcileFeed(feed.items, state.assignments, {
        sourceId: 'canvas-calendar-file',
        syncedAt: new Date(now).toISOString(),
        live: false,
      });
      if (!diffIsInteresting(diff)) {
        toast('Everything in that file is already here.', 'info');
        return;
      }
      setPending({ diff, live: false });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const status: IntegrationStatus = view?.configured
    ? record?.status === 'error'
      ? 'error'
      : 'connected'
    : 'not_configured';

  const statusText = view?.configured
    ? view.lastFetchedAt
      ? `${view.host} · checked ${relativeAge(now - view.lastFetchedAt)}`
      : (view.host ?? undefined)
    : companion
      ? 'Add your calendar feed to import assignments automatically'
      : 'Needs the LockIn Companion, or import a .ics file';

  return (
    <>
      <IntegrationCard
        icon="canvas"
        title="Canvas"
        status={status}
        statusText={statusText}
        can={[
          'Assignment titles, courses and due dates from your calendar feed',
          'Submitted, graded, missing and late status from Canvas pages you open',
          'Links back to Canvas',
        ]}
        cannot={[
          'Your Canvas password — LockIn has never held one',
          'Anything in a Chrome profile the Companion is not installed in',
          'Course content, messages or files',
        ]}
        footer={
          record?.lastError ? (
            <p className="text-caption lk-status-behind lk-status-text">{record.lastError}</p>
          ) : null
        }
      >
        <div className="flex flex-wrap gap-2">
          {view?.configured ? (
            <>
              <Button size="sm" onClick={() => void sync(true)} disabled={busy}>
                {busy ? 'Syncing…' : 'Sync now'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const next = await disconnectCalendar();
                  setView(next);
                  dispatch({
                    type: 'INTEGRATION_STATUS',
                    id: 'canvas_calendar',
                    status: 'not_configured',
                  });
                  toast('Canvas calendar disconnected. Your assignments are still here.', 'info');
                }}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setSetupOpen(true)} disabled={!companion}>
              Connect Canvas Calendar
            </Button>
          )}

          <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} disabled={busy}>
            Import .ics file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".ics,text/calendar"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </div>

        {view?.configured && (
          <div className="mt-3.5 space-y-2.5 border-t lk-border pt-3">
            <p className="text-caption lk-muted">
              LockIn checks your feed every 30 minutes on its own, and once when
              Chrome starts.
            </p>
            <Toggle
              checked={view.openCanvasOnStartup}
              onChange={(on) => {
                void setCalendarOptions({ openCanvasOnStartup: on }).then((next) => {
                  if (next) setView(next);
                });
              }}
              label="Open Canvas in the background to check what's graded"
            />
            <p className="text-caption lk-muted">
              A calendar feed says when work is due but never whether it was
              handed in. With this on, the Companion opens your Canvas dashboard
              in a background tab at startup and reads submitted / graded /
              missing status from your own session. It closes the tab
              afterwards, and it only ever opens Canvas.
            </p>
          </div>
        )}

        {!companion && (
          <p className="mt-2.5 text-caption lk-muted">
            A Canvas feed can’t be fetched by a web page — Canvas doesn’t allow
            it. The Companion does the fetching, or you can download the file
            and import it here.
          </p>
        )}
      </IntegrationCard>

      <CanvasSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onConnected={(next) => {
          setView(next);
          setSetupOpen(false);
          void sync(true);
        }}
      />

      <ReviewModal
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && applyDiff(pending.diff, pending.live)}
      />
    </>
  );
}

/** The connect flow: how to find the feed, and where the URL goes. */
function CanvasSetupModal({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: (view: CalendarView) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const REASONS: Record<string, string> = {
    empty: 'Paste the feed address first.',
    'not-a-url': 'That doesn’t look like a web address.',
    'not-https': 'A calendar feed address has to start with https://.',
    'private-host': 'That address points at this computer, not at Canvas.',
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const view = await connectCalendar(url.trim());
    setBusy(false);
    if (!view) {
      setError('The LockIn Companion didn’t answer. Is it installed and enabled?');
      return;
    }
    if (view.ok === false) {
      setError(REASONS[view.reason ?? ''] ?? 'That address was not accepted.');
      return;
    }
    setUrl('');
    onConnected(view);
  };

  return (
    <Modal
      open={open}
      title="Connect Canvas Calendar"
      subtitle="Canvas publishes a private calendar address for your courses."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || url.trim().length === 0}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </>
      }
    >
      <ol className="mb-4 space-y-2 text-body lk-strong">
        <li>
          <strong>1.</strong> In Canvas, open <strong>Calendar</strong>.
        </li>
        <li>
          <strong>2.</strong> Click <strong>Calendar Feed</strong> in the sidebar.
        </li>
        <li>
          <strong>3.</strong> Copy the address it shows and paste it below.
        </li>
      </ol>

      <Field
        label="Calendar feed address"
        hint="It ends in .ics and contains a long private code."
      >
        <TextInput
          type="password"
          value={url}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://school.instructure.com/feeds/calendars/user_…"
          onChange={(event) => setUrl(event.target.value)}
        />
      </Field>

      {error && <p className="mt-2 text-caption lk-status-behind lk-status-text">{error}</p>}

      <div className="mt-4 rounded-xl lk-sunken border lk-border p-3">
        <p className="text-caption lk-strong">
          <strong>Treat this address like a password.</strong> Anyone who has it
          can read your calendar without logging in.
        </p>
        <p className="mt-1.5 text-caption lk-muted">
          LockIn keeps it inside the Companion extension. It is never stored by
          this web page, never included in an export, and never shown again
          after you paste it. If it ever leaks, reset the feed in Canvas.
        </p>
      </div>
    </Modal>
  );
}

/** The review screen: nothing lands without being shown first. */
function ReviewModal({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { diff: FeedDiff; live: boolean } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;
  const { diff } = pending;
  const changed = diff.update.filter((u) => u.changes.length > 0);

  return (
    <Modal
      open
      title="Review changes"
      subtitle={describeDiff(diff)}
      onClose={onCancel}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Apply</Button>
        </>
      }
    >
      <div className="space-y-4">
        {diff.create.length > 0 && (
          <div>
            <p className="text-caption font-bold tracking-wide lk-muted uppercase">
              New ({diff.create.length})
            </p>
            <ul className="mt-1.5 space-y-1">
              {diff.create.slice(0, 12).map((item) => (
                <li key={item.externalId} className="text-body lk-strong">
                  {item.title}
                  <span className="lk-muted"> · {item.dueDate}</span>
                </li>
              ))}
              {diff.create.length > 12 && (
                <li className="text-caption lk-muted">and {diff.create.length - 12} more</li>
              )}
            </ul>
          </div>
        )}

        {changed.length > 0 && (
          <div>
            <p className="text-caption font-bold tracking-wide lk-muted uppercase">
              Updated ({changed.length})
            </p>
            <ul className="mt-1.5 space-y-1">
              {changed.slice(0, 12).map((update) => (
                <li key={update.assignmentId} className="text-body lk-strong">
                  {update.changes.join(' · ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {diff.cancel.length > 0 && (
          <div>
            <p className="text-caption font-bold tracking-wide lk-muted uppercase">
              Cancelled in Canvas ({diff.cancel.length})
            </p>
            <ul className="mt-1.5 space-y-1">
              {diff.cancel.map((entry) => (
                <li key={entry.assignmentId} className="text-body lk-strong">
                  {entry.title}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-caption lk-muted">
              These stay in LockIn with their reminders switched off. Nothing is
              deleted and nothing is marked complete.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
