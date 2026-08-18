/**
 * Settings → Edgenuity verification.
 *
 * Two jobs: tell the student honestly what this feature can and cannot do, and
 * let them test the camera *before* they are standing in front of a school
 * computer trying to verify real work. Camera permission is never requested on
 * app launch — only from here, or from a real verification.
 */
import { useEffect, useState } from 'react';
import { Card, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Toggle } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { CameraCapture } from './CameraCapture';
import { ParentPinDialog } from './ParentPinDialog';
import { useApp } from '../../store/context';
import { checkCameraSupport } from '../../lib/edgenuity/capture';
import { cx } from '../../lib/cx';
import { ocrEverLoaded, ocrReady, warmUpOcr } from '../../lib/edgenuity/ocr';

export function EdgenuitySettings() {
  const { state, dispatch } = useApp();
  const [testing, setTesting] = useState(false);
  const [warming, setWarming] = useState(false);
  /**
   * When a parent locks verification settings the control stays visible and
   * says why, rather than disappearing. A setting that silently vanishes reads
   * as a bug; one that says "Managed by Parent Controls" and offers the PIN is
   * a rule the student can understand and, with the PIN, satisfy.
   */
  const [pendingMode, setPendingMode] = useState<'standard' | 'enhanced' | null>(null);
  const managed = state.parentControls.lockVerificationSettings && !!state.parentPin;
  const support = checkCameraSupport();
  const permission = state.edgenuity.cameraPermission;
  const loaded = state.edgenuity.ocrEverLoaded || ocrEverLoaded();

  // The browser may already know the answer without prompting; asking here
  // avoids showing "Not allowed" to someone who allowed it last week.
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (status.state === 'granted' || status.state === 'denied') {
          dispatch({ type: 'EDGENUITY_SET_CAMERA_PERMISSION', permission: status.state });
        }
      })
      .catch(() => {
        /* Firefox and Safari don't expose the camera permission; leave it unknown. */
      });
  }, [dispatch]);

  const activeSessions = state.edgenuity.sessions.filter((s) => s.status === 'in_progress').length;

  return (
    <Card id="edgenuity-verification">
      <CardHeader
        title="Edgenuity verification"
        subtitle="Prove progress with a live photo of your Edgenuity screen."
        action={<Badge tone={support.supported ? 'brand' : 'amber'}>PHASE 4</Badge>}
      />

      <div className="space-y-4">
        <dl className="grid gap-2 sm:grid-cols-3">
          <Stat
            label="Local OCR"
            value={loaded ? (ocrReady() ? 'Ready' : 'Installed') : 'Loads on first use'}
            tone={loaded ? 'mint' : 'neutral'}
          />
          <Stat
            label="Camera"
            value={
              !support.supported
                ? 'Unavailable'
                : permission === 'granted'
                  ? 'Allowed'
                  : permission === 'denied'
                    ? 'Not allowed'
                    : 'Not asked yet'
            }
            tone={permission === 'granted' ? 'mint' : permission === 'denied' ? 'flame' : 'neutral'}
          />
          <Stat label="Photos uploaded externally" value="Never" tone="mint" />
        </dl>

        {!support.supported && (
          <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
            {support.detail}
          </p>
        )}

        {!loaded && (
          <p className="text-xs lk-muted">
            The text-reading engine loads the first time you verify progress. It is bundled with
            LockIn — nothing is downloaded from the internet.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<Icon name="camera" size={16} />}
            disabled={!support.supported}
            onClick={() => setTesting(true)}
          >
            Test camera
          </Button>
          <Button
            variant="secondary"
            icon={<Icon name="refresh" size={16} />}
            disabled={warming}
            onClick={() => {
              setWarming(true);
              void warmUpOcr().then((ok) => {
                setWarming(false);
                if (ok) dispatch({ type: 'EDGENUITY_OCR_LOADED' });
                toast(
                  ok ? 'Text reader is ready.' : 'The text reader could not start.',
                  ok ? 'success' : 'error',
                );
              });
            }}
          >
            {warming ? 'Loading…' : 'Load text reader now'}
          </Button>
        </div>

        <div className="lk-sunken rounded-2xl border lk-border p-3.5 text-xs lk-muted">
          <p className="font-bold lk-strong">What this proves, and what it doesn’t</p>
          <p className="mt-1">
            LockIn checks that a live camera photo appears to show an Edgenuity screen with the
            values it read. It cannot prove the screen itself was genuine — photo verification makes
            casual cheating harder, not impossible.
          </p>
          <p className="mt-2">
            Photos are read on this device and discarded straight afterwards. Only the course name,
            activity name, progress percentage, confidence and timestamp are kept.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold lk-strong">Proof strength</p>
            {managed && <Badge tone="brand">Managed by Parent Controls</Badge>}
          </div>
          <p className="text-xs lk-muted">
            The minimum for every Edgenuity assignment. An assignment can ask for more, never less.
          </p>
          {(
            [
              {
                value: 'standard' as const,
                title: 'Standard',
                detail: 'Live camera + local OCR of the progress screen.',
              },
              {
                value: 'enhanced' as const,
                title: 'Enhanced',
                detail:
                  'Live camera + local OCR + a one-time code that must appear in the same photo.',
              },
            ]
          ).map((option) => {
            const on = state.settings.edgenuityProofMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  if (option.value === state.settings.edgenuityProofMode) return;
                  if (managed) {
                    setPendingMode(option.value);
                    return;
                  }
                  dispatch({ type: 'UPDATE_SETTINGS', patch: { edgenuityProofMode: option.value } });
                }}
                className={cx(
                  'block w-full rounded-2xl border p-3 text-left transition-colors',
                  on ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'lk-border lk-sunken',
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cx(
                      'grid h-4 w-4 shrink-0 place-items-center rounded-full border-2',
                      on ? 'border-brand-500 bg-brand-500 text-white' : 'lk-border',
                    )}
                  >
                    {on && <Icon name="check" size={9} strokeWidth={3} />}
                  </span>
                  <span className="text-sm font-bold lk-strong">{option.title}</span>
                </span>
                <span className="mt-1 block pl-6 text-xs lk-muted">{option.detail}</span>
              </button>
            );
          })}
          <p className="text-xs lk-muted">
            Enhanced Proof makes previously prepared screenshots harder to reuse, but it cannot
            prove with certainty that a screen is genuine.
          </p>
          {managed && (
            <p className="text-xs lk-muted">
              A parent has locked this setting. Changing it needs the parent PIN.
            </p>
          )}
        </div>

        <Toggle
          checked={state.edgenuity.developerMode}
          onChange={(on) => dispatch({ type: 'EDGENUITY_SET_DEVELOPER_MODE', on })}
          label="Developer diagnostics"
          description={
            activeSessions > 0
              ? 'Keeps raw OCR text for the active verification while it is being processed. Test images can never produce a verified result.'
              : 'Keeps raw OCR text while a verification is being processed, for debugging. Off by default.'
          }
        />
      </div>

      <ParentPinDialog
        open={pendingMode !== null}
        title="Parent approval required"
        description="A parent has locked the Edgenuity proof requirement on this device."
        confirmLabel="Change setting"
        onCancel={() => setPendingMode(null)}
        onVerified={() => {
          if (pendingMode) {
            dispatch({
              type: 'UPDATE_SETTINGS',
              patch: { edgenuityProofMode: pendingMode },
              parentApproved: true,
            });
            toast('Proof requirement updated.', 'success');
          }
          setPendingMode(null);
        }}
      />

      <Modal
        open={testing}
        title="Test camera"
        subtitle="Nothing is captured, read or saved here."
        onClose={() => setTesting(false)}
        wide
      >
        <CameraCapture
          active={testing}
          onPermission={(p) => dispatch({ type: 'EDGENUITY_SET_CAMERA_PERMISSION', permission: p })}
          onCancel={() => setTesting(false)}
          onCapture={(image) => {
            // A test shot is discarded immediately — it is never read or stored.
            image.release();
            setTesting(false);
            toast('Camera works. The test photo was discarded.', 'success');
          }}
          guidance={
            <p className="text-xs lk-muted">
              Check that the preview appears and looks sharp. Capture to confirm, then the camera
              switches off.
            </p>
          }
        />
      </Modal>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'mint' | 'flame' | 'neutral';
}) {
  return (
    <div className="lk-sunken rounded-2xl border lk-border p-3">
      <dt className="text-[0.7rem] font-semibold lk-muted">{label}</dt>
      <dd className="mt-0.5">
        <Badge tone={tone}>{value}</Badge>
      </dd>
    </div>
  );
}
