/**
 * Integrations — one place to connect school tools, and one place that tells
 * the truth about them.
 *
 * Every card answers the same four questions in the same order: what it can
 * access, what it cannot, when it last worked, and how to disconnect. That
 * uniformity is the point. A student deciding whether to hand something their
 * school data should not have to work out which card buried the caveat.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../store/context';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, TextInput } from '../components/ui/Field';
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
  syncCalendar,
} from '../lib/canvas/calendarClient';
import type { CalendarView } from '../lib/canvas/calendarClient';
import { describeDiff, diffIsInteresting, reconcileFeed } from '../lib/canvas/calendarReconcile';
import type { FeedDiff } from '../lib/canvas/calendarReconcile';
import { parseProgressEmail } from '../lib/edgenuity/progressEmail';
import { parseCourseReport, readReportFile } from '../lib/edgenuity/courseReport';
import { mergeCourseReport, mergeProgressEmail } from '../lib/edgenuity/merge';
import { SETUP_STEPS, WHY_NOT_AUTOMATIC } from '../lib/edgenuity/gmailAdapter';
import { issuePairingCode, readContext, revokePairing } from '../lib/context/client';
import type { ContextSnapshot } from '../lib/context/client';
import type { IntegrationId, IntegrationStatus } from '../types/integrations';
import type { SourceRecord } from '../types/source';

export function IntegrationsPage() {
  const { state, dispatch, now, extension } = useApp();

  const record = useCallback(
    (id: IntegrationId) => state.integrations.records.find((r) => r.id === id),
    [state.integrations.records],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title font-extrabold lk-strong">Integrations</h1>
        <p className="mt-1 text-body lk-muted">
          Connect your school tools so you stop typing everything in by hand.
        </p>
      </header>

      <section aria-labelledby="school-heading">
        <SectionHeader id="school-heading" title="School" />
        <div className="space-y-3">
          <CanvasCalendarCard />
          <EdgenuityCard />
        </div>
      </section>

      <section aria-labelledby="lockin-heading">
        <SectionHeader id="lockin-heading" title="LockIn" />
        <div className="space-y-3">
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
              'Fetch your Canvas calendar feed',
              'Tell school sites from distracting ones, by site name only',
            ]}
            cannot={[
              'Read any page’s contents, forms or passwords',
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
          <SchoolCompanionCard />
        </div>
      </section>

      <p className="text-caption lk-muted">
        Nothing on this page sends your data anywhere. Everything is parsed on
        this device and stored in this browser — see{' '}
        <a className="font-semibold underline underline-offset-2" href="/privacy">
          Privacy
        </a>
        .
      </p>

      {/* Kept mounted so a sync started here can report into the store. */}
      <span hidden data-now={now} data-records={state.integrations.records.length} />
      {record('canvas_calendar') === undefined && null}
      {dispatch === undefined && null}
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
 * `can` and `cannot` are required rather than optional. An integration card
 * that lists its powers and omits its limits is marketing, and the whole
 * reason this page exists is that a student has to be able to trust it.
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

function CanvasCalendarCard() {
  const { state, dispatch, now, extension } = useApp();
  const record = state.integrations.records.find((r) => r.id === 'canvas_calendar');
  const [view, setView] = useState<CalendarView | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ diff: FeedDiff; live: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const companion = extension.status === 'connected';

  useEffect(() => {
    if (!companion) return;
    void getCalendarView().then((next) => next && setView(next));
  }, [companion]);

  const horizon = state.integrations.canvasCalendar.horizonDays;

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

      // Nothing to review means nothing to interrupt for: the provenance
      // refresh is applied silently and the student is told it is up to date.
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
      ? `${view.host} · synced ${relativeAge(now - view.lastFetchedAt)}`
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
          'Event links back to Canvas',
        ]}
        cannot={[
          'Whether something was submitted — a calendar feed does not say',
          'Your grades',
          'Anything you have not published to your own calendar feed',
        ]}
        footer={record?.lastError ? <p className="text-caption lk-status-text">{record.lastError}</p> : null}
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

/* ------------------------------------------------------------------ */
/* Edgenuity                                                           */
/* ------------------------------------------------------------------ */

function EdgenuityCard() {
  const { state, dispatch, now } = useApp();
  const emailRecord = state.integrations.records.find((r) => r.id === 'edgenuity_email');
  const [busy, setBusy] = useState(false);
  const [gmailOpen, setGmailOpen] = useState(false);
  const [courseNamePrompt, setCourseNamePrompt] = useState<{
    report: ReturnType<typeof parseCourseReport>;
    name: string;
  } | null>(null);

  const progressInput = useRef<HTMLInputElement>(null);
  const reportInput = useRef<HTMLInputElement>(null);

  const courses = state.integrations.courses;
  const newest = useMemo(() => {
    const times = courses
      .map((course) => course.actualProgressPercent?.source.lastSyncedAt)
      .filter((value): value is string => !!value)
      .map((value) => Date.parse(value))
      .filter((value) => !Number.isNaN(value));
    return times.length > 0 ? Math.max(...times) : null;
  }, [courses]);

  const stamp = (kind: SourceRecord['kind'], sourceId: string): SourceRecord => ({
    kind,
    sourceId,
    lastSyncedAt: new Date(now).toISOString(),
    confidence: 'high',
    isLive: false,
    rawDataRetained: false,
  });

  const importProgress = async (file: File) => {
    setBusy(true);
    try {
      const parsed = parseProgressEmail(await file.text());
      if (!parsed.ok) {
        dispatch({
          type: 'INTEGRATION_STATUS',
          id: 'edgenuity_email',
          status: 'error',
          error: parsed.error,
        });
        toast(parsed.error ?? 'That file could not be read.', 'error');
        return;
      }
      const merged = mergeProgressEmail(
        courses,
        parsed.courses,
        stamp('EDGENUITY_PROGRESS_EMAIL', 'edgenuity-email'),
        now,
        parsed.reportedAt,
      );
      dispatch({
        type: 'COURSES_MERGE',
        courses: merged.courses,
        summary: `Edgenuity progress updated for ${parsed.courses.length} course${parsed.courses.length === 1 ? '' : 's'}`,
      });
      dispatch({
        type: 'INTEGRATION_STATUS',
        id: 'edgenuity_email',
        status: 'connected',
        itemCount: parsed.courses.length,
      });
      for (const warning of parsed.warnings) toast(warning, 'info');
      toast(
        merged.changes.length > 0
          ? merged.changes.map((c) => `${c.courseName}: ${c.field} ${c.text}`).join(' · ')
          : 'Already up to date.',
        'success',
      );
    } finally {
      setBusy(false);
      if (progressInput.current) progressInput.current.value = '';
    }
  };

  const importReport = async (file: File) => {
    setBusy(true);
    try {
      const parsed = await readReportFile(file);
      if (!parsed.ok) {
        toast(parsed.error ?? 'That file could not be read.', 'error');
        return;
      }
      for (const warning of parsed.warnings) toast(warning, 'info');

      // The parser could not name the course, so it asks rather than guessing:
      // a schedule attached to the wrong course is worse than no schedule.
      if (!parsed.courseName) {
        setCourseNamePrompt({ report: parsed, name: '' });
        return;
      }
      commitReport(parsed, parsed.courseName);
    } finally {
      setBusy(false);
      if (reportInput.current) reportInput.current.value = '';
    }
  };

  const commitReport = (parsed: ReturnType<typeof parseCourseReport>, name: string) => {
    const merged = mergeCourseReport(
      courses,
      parsed,
      name,
      stamp('EDGENUITY_COURSE_REPORT', 'edgenuity-report'),
      now,
    );
    dispatch({
      type: 'COURSES_MERGE',
      courses: merged.courses,
      summary: `Imported ${parsed.activities.length} activities for ${name}`,
    });
    dispatch({
      type: 'INTEGRATION_STATUS',
      id: 'edgenuity_report',
      status: 'connected',
      itemCount: parsed.activities.length,
    });
    toast(`${name}: ${parsed.activities.length} activities imported.`, 'success');
    setCourseNamePrompt(null);
  };

  return (
    <>
      <IntegrationCard
        icon="edgenuity"
        title="Edgenuity"
        status={courses.length > 0 ? 'connected' : 'not_configured'}
        statusText={
          newest
            ? `${courses.length} course${courses.length === 1 ? '' : 's'} · updated ${relativeAge(now - newest)}`
            : 'Import a progress report to see pacing'
        }
        can={[
          'Course completion and target percentages from a progress report',
          'The activity schedule from a course report you downloaded',
          'Grades, when the report states them',
        ]}
        cannot={[
          'Read the Edgenuity website — LockIn never opens or scrapes it',
          'See lessons, questions, answers or assessments',
          'Log in, or touch your Edgenuity account in any way',
        ]}
        footer={
          emailRecord?.lastError ? (
            <p className="text-caption lk-status-behind lk-status-text">{emailRecord.lastError}</p>
          ) : null
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => progressInput.current?.click()} disabled={busy}>
            Import progress report
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => reportInput.current?.click()}
            disabled={busy}
          >
            Import course report
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setGmailOpen(true)}>
            Automatic sync
          </Button>
        </div>

        <input
          ref={progressInput}
          type="file"
          accept=".html,.htm,.txt,.eml,text/html,text/plain"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importProgress(file);
          }}
        />
        <input
          ref={reportInput}
          type="file"
          accept=".csv,.tsv,.txt,.html,.htm,text/csv,text/plain,text/html"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importReport(file);
          }}
        />

        <p className="mt-2.5 text-caption lk-muted">
          Save the progress email Edgenuity sends, or download a course report,
          and drop the file in. It is read on this device and not kept.
        </p>
      </IntegrationCard>

      <Modal
        open={gmailOpen}
        title="Automatic Edgenuity sync"
        subtitle="What it would take, and why it isn’t switched on."
        onClose={() => setGmailOpen(false)}
        footer={<Button onClick={() => setGmailOpen(false)}>Close</Button>}
      >
        <p className="text-body lk-strong">{WHY_NOT_AUTOMATIC}</p>
        <ol className="mt-3 space-y-1.5">
          {SETUP_STEPS.map((step, index) => (
            <li key={step} className="flex gap-2 text-body lk-muted">
              <span className="font-bold lk-strong">{index + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-caption lk-muted">
          LockIn would ask Gmail only for messages from Edgenuity with
          &ldquo;progress&rdquo; or &ldquo;report&rdquo; in the subject, from the
          last 90 days, read-only. Nothing else in the mailbox is ever
          requested, and message bodies are parsed on this device and dropped.
        </p>
      </Modal>

      <Modal
        open={courseNamePrompt !== null}
        title="Which course is this?"
        subtitle="The report doesn’t name it, and guessing would attach it to the wrong one."
        onClose={() => setCourseNamePrompt(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCourseNamePrompt(null)}>
              Cancel
            </Button>
            <Button
              disabled={!courseNamePrompt?.name.trim()}
              onClick={() =>
                courseNamePrompt &&
                commitReport(courseNamePrompt.report, courseNamePrompt.name.trim())
              }
            >
              Import
            </Button>
          </>
        }
      >
        <Field label="Course name" hint="Use the name Edgenuity shows.">
          <TextInput
            value={courseNamePrompt?.name ?? ''}
            placeholder="Algebra I"
            onChange={(event) =>
              setCourseNamePrompt((prev) => (prev ? { ...prev, name: event.target.value } : prev))
            }
          />
        </Field>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* School Companion                                                    */
/* ------------------------------------------------------------------ */

function SchoolCompanionCard() {
  const [snapshot, setSnapshot] = useState<ContextSnapshot | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [learnOpen, setLearnOpen] = useState(false);

  useEffect(() => {
    void readContext().then(setSnapshot);
  }, []);

  const available = snapshot !== null && !snapshot.unavailable;
  const status: IntegrationStatus = !available
    ? 'unavailable'
    : snapshot.paired
      ? 'connected'
      : 'not_configured';

  return (
    <>
      <IntegrationCard
        icon="shield"
        title="School Companion"
        status={status}
        statusText={
          !available
            ? 'Needs LockIn’s local service running, and permission from your school'
            : snapshot.paired
              ? snapshot.context.length > 0
                ? `Reporting: ${snapshot.context.map((c) => c.provider).join(', ')}`
                : 'Paired, nothing reported yet'
              : 'Not paired'
        }
        can={[
          'Say whether Canvas or Edgenuity is open in your school Chrome profile',
          'Say how long that has been true',
        ]}
        cannot={[
          'Read any page — it has no content script and no scripting permission',
          'See assignments, questions, answers, grades or logins',
          'Send a web address anywhere — the message has no field for one',
        ]}
        footer={
          <button
            type="button"
            onClick={() => setLearnOpen(true)}
            className="text-caption font-bold lk-muted underline underline-offset-2 hover:lk-strong"
          >
            Learn more
          </button>
        }
      >
        {available && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const secret = await issuePairingCode();
                if (!secret) {
                  toast('LockIn’s local service didn’t answer.', 'error');
                  return;
                }
                setCode(secret);
                void readContext().then(setSnapshot);
              }}
            >
              Show pairing code
            </Button>
            {snapshot?.paired && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await revokePairing();
                  setCode(null);
                  void readContext().then(setSnapshot);
                  toast('Pairing revoked.', 'info');
                }}
              >
                Revoke
              </Button>
            )}
          </div>
        )}

        {code && (
          <div className="animate-fade mt-3 rounded-xl lk-sunken border lk-border p-3">
            <p className="text-caption font-bold tracking-wide lk-muted uppercase">Pairing code</p>
            <p className="mt-1 font-mono text-body break-all lk-strong">{code}</p>
            <p className="mt-1.5 text-caption lk-muted">
              Paste this into the School Companion’s options page in your school
              Chrome profile. It is shown once; generate a new one any time,
              which makes the old one useless.
            </p>
          </div>
        )}
      </IntegrationCard>

      <Modal
        open={learnOpen}
        title="School Companion"
        subtitle="Optional, off by default, and only where your school allows it."
        onClose={() => setLearnOpen(false)}
        wide
        footer={<Button onClick={() => setLearnOpen(false)}>Close</Button>}
      >
        <div className="space-y-3 text-body lk-strong">
          <p>
            Chrome keeps profiles completely separate. LockIn, running in your
            personal profile, cannot see a tab in your school profile — and it
            does not try to. There is no setting, flag or trick here that gets
            around that.
          </p>
          <p>
            What this optional package does is much smaller: installed in the
            school profile, it says <em>“Edgenuity is open right now”</em> to
            LockIn on the same computer. That is enough for LockIn to hold a
            reminder back when you are already working, and it is not enough to
            learn anything about the work itself.
          </p>
          <p className="rounded-xl lk-sunken border lk-border p-3 text-body">
            <strong>Before installing it:</strong> many school profiles are
            managed by the district, and many districts do not permit
            extensions. This is for the case where installing it is allowed.
            LockIn will not help you get around an administrator setting, and
            everything else works without this.
          </p>
          <p className="text-caption lk-muted">
            The connection is on this computer only (127.0.0.1), authenticated
            with a pairing code you carry across by hand, and the context it
            holds is kept in memory and forgotten when the service restarts.
          </p>
        </div>
      </Modal>
    </>
  );
}
