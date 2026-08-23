/**
 * The Canvas section in Settings: setup, health, sync, course names, disconnect.
 *
 * Wording is deliberate — this is a "Canvas Browser Connection", never an
 * official integration.
 */
import { useState } from 'react';
import { useApp } from '../../store/context';
import { useCanvas } from '../../hooks/useCanvas';
import { Card, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Field, TextInput } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { normalizeCanvasDomainWeb } from '../../lib/canvas/domain';
import { canvasAssignments, importCandidates, isCanvasStale } from '../../lib/selectors';
import { relativeTime } from '../../lib/time';

export function CanvasSettings({ onOpenImport }: { onOpenImport: () => void }) {
  const { state, now, extension } = useApp();
  const { connection, busy, connect, sync, disconnect, refresh, openInCanvas } = useCanvas();

  const [setupOpen, setSetupOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [keepAssignments, setKeepAssignments] = useState(true);
  const [coursesOpen, setCoursesOpen] = useState(false);

  const linked = canvasAssignments(state);
  const candidates = importCandidates(state);
  const stale = isCanvasStale(state, now);

  /* ---------------- not configured ---------------- */
  if (!connection) {
    return (
      <>
        <Card>
          <CardHeader
            title="Canvas"
            subtitle="Canvas Browser Connection"
            action={<Badge tone="neutral">Not configured</Badge>}
          />
          <p className="mb-4 text-sm lk-muted">
            LockIn can detect assignments and submission status from Canvas pages you visit.
            LockIn does not need your Canvas password.
          </p>
          <Button icon={<Icon name="canvas" size={16} />} onClick={() => setSetupOpen(true)}>
            Set Up Canvas
          </Button>
        </Card>
        <CanvasSetupModal
          open={setupOpen}
          onClose={() => setSetupOpen(false)}
          onConnect={async (domain) => {
            const ok = await connect(domain);
            if (!ok) return;
            setSetupOpen(false);
            // Land on the payoff rather than back on the settings panel you
            // started from. "Connected." with no next step is what made this
            // flow feel like it had gone nowhere.
            onOpenImport();
          }}
          connecting={busy === 'connect'}
          extensionConnected={extension.status === 'connected'}
        />
      </>
    );
  }

  /* ---------------- configured ---------------- */
  const permission = connection.permissionGranted;

  return (
    <>
      <Card>
        <CardHeader
          title="Canvas"
          subtitle="Canvas Browser Connection"
          action={
            <Badge tone={permission ? 'mint' : 'amber'}>
              {permission ? 'Connected' : 'Permission needed'}
            </Badge>
          }
        />

        <div
          className={`rounded-2xl border p-4 ${
            permission
              ? 'border-mint-500/40 bg-mint-400/10'
              : 'border-amber-400/40 bg-amber-400/10'
          }`}
        >
          {permission ? (
            <p className="text-sm font-bold lk-strong">Canvas Browser Connection · Connected ✅</p>
          ) : (
            <>
              <p className="text-sm font-bold lk-strong">Canvas permission not granted.</p>
              <p className="mt-1 text-sm lk-muted">
                You can enable it later from Settings. LockIn needs permission to read assignment
                names, due dates and submission status from this Canvas site.
              </p>
              <Button
                className="mt-3"
                size="sm"
                disabled={busy === 'connect'}
                onClick={() => connect(connection.domain)}
              >
                Grant Canvas access
              </Button>
            </>
          )}

          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold tracking-wide lk-muted uppercase">School</dt>
              <dd className="font-semibold break-all lk-strong">{connection.domain}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold tracking-wide lk-muted uppercase">Last detected</dt>
              <dd className="font-semibold lk-strong">
                {connection.lastSeenAt ? relativeTime(connection.lastSeenAt) : 'Never'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold tracking-wide lk-muted uppercase">
                Assignments detected
              </dt>
              <dd className="font-semibold lk-strong">
                {state.canvas.detected.length + linked.length}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold tracking-wide lk-muted uppercase">Linked in LockIn</dt>
              <dd className="font-semibold lk-strong">{linked.length}</dd>
            </div>
          </dl>
        </div>

        {stale && permission && (
          <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
            Canvas hasn’t been seen recently. Open Canvas to refresh the connection.
          </p>
        )}

        {state.canvas.lastError && (
          <p className="mt-3 rounded-xl border border-flame-500/40 bg-flame-400/10 p-3 text-xs font-semibold text-flame-600 dark:text-flame-400">
            {state.canvas.lastError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy === 'sync'}
            icon={<Icon name="refresh" size={15} />}
            onClick={() => sync()}
          >
            {busy === 'sync' ? 'Checking Canvas…' : 'Sync Canvas'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => openInCanvas(`https://${connection.domain}/`)}
          >
            Open Canvas
          </Button>
          {candidates.length > 0 && (
            <Button onClick={onOpenImport}>
              Review {candidates.length} found in Canvas
            </Button>
          )}
          <Button variant="secondary" onClick={() => setCoursesOpen(true)}>
            Course names
          </Button>
          <Button variant="danger" onClick={() => setDisconnectOpen(true)}>
            Disconnect Canvas
          </Button>
        </div>

        <p className="mt-3 text-xs lk-muted">
          Read-only. LockIn never submits work, changes grades, or opens anything in Canvas on your
          behalf — and {connection.domain} is protected from blocking while connected. The Canvas
          reader is loaded only on {connection.domain}; readings from anywhere else are rejected.
        </p>
      </Card>

      <CourseNamesModal open={coursesOpen} onClose={() => setCoursesOpen(false)} />

      <Modal
        open={disconnectOpen}
        title="Disconnect Canvas?"
        subtitle={`LockIn will stop reading ${connection.domain}.`}
        onClose={() => setDisconnectOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy === 'disconnect'}
              onClick={async () => {
                await disconnect(keepAssignments);
                setDisconnectOpen(false);
                void refresh();
              }}
            >
              Disconnect
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="lk-muted">
            LockIn will remove the saved Canvas address, ask Chrome to drop access to that site,
            and clear the temporary detection cache.
          </p>
          <div className="lk-sunken rounded-2xl border lk-border p-3.5">
            <p className="font-semibold lk-strong">
              Keep imported Canvas assignments in LockIn as normal assignments?
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => setKeepAssignments(true)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${
                  keepAssignments
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                    : 'lk-border lk-muted'
                }`}
              >
                Yes, keep them
              </button>
              <button
                onClick={() => setKeepAssignments(false)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${
                  !keepAssignments
                    ? 'border-flame-500 bg-flame-400/15 text-flame-600'
                    : 'lk-border lk-muted'
                }`}
              >
                No, delete {linked.length}
              </button>
            </div>
            {!keepAssignments && (
              <p className="mt-2 text-xs font-semibold text-flame-600 dark:text-flame-400">
                {linked.length} imported assignment{linked.length === 1 ? '' : 's'} will be deleted
                from LockIn. This cannot be undone.
              </p>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Setup flow                                                          */
/* ------------------------------------------------------------------ */

export function CanvasSetupModal({
  open,
  onClose,
  onConnect,
  connecting,
  extensionConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnect: (domain: string) => void;
  connecting: boolean;
  extensionConnected: boolean;
}) {
  const [step, setStep] = useState(0);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();

  const close = () => {
    setStep(0);
    setValue('');
    setError(undefined);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={step === 0 ? 'Set up Canvas' : 'Your school’s Canvas'}
      onClose={close}
    >
      {step === 0 ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed lk-muted">
            LockIn can detect assignments and submission status from Canvas pages you visit.
            LockIn does not need your Canvas password.
          </p>
          <ul className="lk-sunken space-y-2 rounded-2xl border lk-border p-4 text-sm lk-muted">
            <li className="flex gap-2">
              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-mint-600" />
              Reads only the one Canvas site you name
            </li>
            <li className="flex gap-2">
              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-mint-600" />
              Read-only — never submits work or clicks anything for you
            </li>
            <li className="flex gap-2">
              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-mint-600" />
              Everything stays on this computer
            </li>
          </ul>
          {!extensionConnected && (
            /*
              A warning is not a stop. This used to say the extension was
              missing and then let the student continue, name their school,
              press Connect and receive a toast for their trouble — every step
              of a working flow except the working part. Canvas detection runs
              inside the Companion; with no Companion answering there is
              nothing to connect to, so the flow stops here and says what to do.
            */
            <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <p>
                The LockIn Companion isn’t answering on this page, so there is nothing to connect
                Canvas to yet. Canvas detection runs inside it.
              </p>
              <p className="mt-1.5 font-normal">
                If you have installed it, check two things: that this page has been reloaded since,
                and that you installed the copy downloaded from <strong>this</strong> address
                ({typeof window === 'undefined' ? '' : window.location.host}) — a Companion built
                for a different address cannot see this one.
              </p>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => setStep(1)} disabled={!extensionConnected}>
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const result = normalizeCanvasDomainWeb(value);
            if (!result.ok || !result.domain) {
              setError(result.error);
              return;
            }
            setError(undefined);
            onConnect(result.domain);
          }}
        >
          <Field
            label="What is your school’s Canvas website?"
            error={error}
            hint="For example myschool.instructure.com or canvas.schooldistrict.org"
          >
            <TextInput
              autoFocus
              value={value}
              placeholder="myschool.instructure.com"
              onChange={(e) => {
                setValue(e.target.value);
                setError(undefined);
              }}
            />
          </Field>
          <p className="text-xs leading-relaxed lk-muted">
            LockIn needs to read assignment names, due dates and submission status from this Canvas
            site. Confirming on the next screen limits Canvas reading to this one address —
            LockIn’s Canvas reader is only ever loaded there.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button type="submit" disabled={!value.trim() || connecting}>
              {connecting ? 'Opening…' : 'Connect Canvas'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Course display names                                                */
/* ------------------------------------------------------------------ */

function CourseNamesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp();

  // Course ids come from everything Canvas has shown us so far.
  const seen = new Map<string, string>();
  for (const a of state.assignments) {
    if (a.canvas && a.externalCourseId) {
      seen.set(a.externalCourseId, a.canvas.courseName || a.subject || a.externalCourseId);
    }
  }
  for (const d of state.canvas.detected) {
    if (!seen.has(d.externalCourseId)) {
      seen.set(d.externalCourseId, d.courseName || d.externalCourseId);
    }
  }

  return (
    <Modal
      open={open}
      title="Course names"
      subtitle="Canvas course codes are ugly. Rename them for LockIn only — Canvas itself is never changed."
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {seen.size === 0 ? (
        <p className="text-sm lk-muted">No Canvas courses detected yet.</p>
      ) : (
        <div className="space-y-3">
          {[...seen.entries()].map(([id, original]) => {
            const course = state.canvas.courses.find((c) => c.externalCourseId === id);
            return (
              <Field key={id} label={original}>
                <TextInput
                  defaultValue={course?.displayName ?? ''}
                  placeholder={original}
                  onBlur={(e) =>
                    dispatch({
                      type: 'CANVAS_SET_COURSE_NAME',
                      externalCourseId: id,
                      displayName: e.target.value || original,
                    })
                  }
                />
              </Field>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
