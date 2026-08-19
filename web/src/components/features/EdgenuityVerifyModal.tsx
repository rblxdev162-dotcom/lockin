/**
 * The Edgenuity verification flow: guidance → shared window → local OCR → review.
 *
 * Used twice per verification session — once for the starting proof and once
 * for the final one — because the two are the same act with different
 * consequences, and a student who has done it once already knows this screen.
 *
 * The one rule worth stating loudly: a value the student can type is not
 * evidence. When OCR misreads the number, the only route to a *verified*
 * result is a better photo. Typing a correction is offered, but it is recorded
 * as "Manual / unverified" and cannot unlock Strict Mode.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Assignment, EdgenuityProof, EdgenuitySession } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Field, TextInput } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { ProgressBar } from '../ui/Progress';
import { toast } from '../ui/Toast';
import { ScreenCapture } from './ScreenCapture';
import { useApp } from '../../store/context';
import type { CapturedImage } from '../../lib/edgenuity/capture';
import { STAGE_LABEL, terminateOcr } from '../../lib/edgenuity/ocr';
import type { OcrProgress } from '../../lib/edgenuity/ocr';
import { READ_PROBLEM_ADVICE, proofFromReading, readProofImage } from '../../lib/edgenuity/pipeline';
import type { ProofReading } from '../../lib/edgenuity/pipeline';
import {
  checkProgress,
  requiredDeltaOf,
} from '../../lib/edgenuity/verification';
import { cx } from '../../lib/cx';

type Step = 'guidance' | 'screen' | 'reading' | 'review';

export function EdgenuityVerifyModal({
  open,
  assignment,
  session,
  onClose,
}: {
  open: boolean;
  assignment: Assignment;
  /** Present for the final proof; absent when starting a new session. */
  session?: EdgenuitySession;
  onClose: () => void;
}) {
  const { state, dispatch } = useApp();
  const [step, setStep] = useState<Step>('guidance');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [reading, setReading] = useState<ProofReading | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  /** How the frame under review was obtained. Set at capture time. */
  const [capturedSource, setCapturedSource] = useState<CapturedImage['source']>('live_screen');
  const abortRef = useRef<AbortController | null>(null);

  const config = assignment.edgenuity?.config;
  const isFinal = !!session;
  const requirePercent = config?.targetType === 'progress_percent';
  const devFixtures = import.meta.env.DEV && state.edgenuity.developerMode;

  /**
   * Enhanced Proof needs a code in this frame.
   *
   * A session already under way keeps the requirement it started with, so
   * changing the setting midway can neither strand a student nor quietly
   * downgrade a verification they began under the stricter rule.
   */
  /* Reset every time the dialog opens, and never leave work running behind it. */
  useEffect(() => {
    if (open) {
      setStep('guidance');
      setReading(null);
      setProgress(null);
      setManualOpen(false);
      setManualValue('');
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  // Leaving the flow releases the OCR worker rather than holding ~50MB of wasm
  // for a student who is not coming back.
  useEffect(() => () => void terminateOcr(), []);

  const process = useCallback(
    async (image: CapturedImage) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStep('reading');
      setProgress({ stage: 'preparing_image' });
      try {
        const result = await readProofImage(image, {
          requirePercent,
          wantThumbnail: true,
          keepRawText: state.edgenuity.developerMode,
          signal: controller.signal,
          onProgress: setProgress,
        });
        dispatch({ type: 'EDGENUITY_OCR_LOADED' });
        setReading(result);
        setStep('review');
      } catch (error) {
        if ((error as DOMException)?.name !== 'AbortError') {
          toast('The text reader could not start. Try again.', 'error');
        }
        setStep('guidance');
      } finally {
        // The frame is released whatever happened — nothing keeps a
        // full-resolution photo of a school screen alive.
        image.release();
        abortRef.current = null;
      }
    },
    [dispatch, requirePercent, state.edgenuity.developerMode],
  );

  const cancelReading = useCallback(() => {
    abortRef.current?.abort();
    void terminateOcr();
    setStep('guidance');
  }, []);

  if (!config) return null;

  const proof: EdgenuityProof | null = reading
    ? proofFromReading(reading, capturedSource)
    : null;

  return (
    <Modal
      open={open}
      title={isFinal ? 'Verify Edgenuity progress' : 'Start Edgenuity verification'}
      subtitle={
        step === 'guidance'
          ? isFinal
            ? 'Step 3 of 3 — show your progress now'
            : 'Step 1 of 3 — show your current progress'
          : step === 'reading'
              ? 'Reading the photo on this device'
              : 'Check what was detected'
      }
      onClose={() => {
        cancelReading();
        onClose();
      }}
      wide
    >
      {step === 'guidance' && (
        <GuidanceStep
          isFinal={isFinal}
          onOpenScreen={() => setStep('screen')}
          devFixtures={devFixtures}
          onFixture={(src) => {
            void (async () => {
              // The guard is not decoration: `import.meta.env.DEV` is replaced
              // with `false` in a production build, so this branch — and the
              // whole fixture module behind it — is eliminated rather than
              // shipped and merely hidden.
              if (!import.meta.env.DEV) return;
              const { TestFixtureCapture } = await import('../../lib/edgenuity/capture.dev');
              setCapturedSource('fixture');
              const image = await new TestFixtureCapture(src).capture();
              await process(image);
            })();
          }}
        />
      )}

      {step === 'screen' && (
        <ScreenCapture
          onCancel={() => setStep('guidance')}
          onCapture={(image) => {
            setCapturedSource('live_screen');
            void process(image);
          }}
          guidance={
            <p className="text-xs lk-muted">
              Put your Edgenuity course page on screen first, then share that window. The course
              name and the progress number both need to be visible in it.
            </p>
          }
        />
      )}

      {step === 'reading' && <ReadingStep progress={progress} onCancel={cancelReading} />}

      {step === 'review' && reading && proof && (
        <ReviewStep
          assignment={assignment}
          session={session}
          reading={reading}
          proof={proof}
          manualOpen={manualOpen}
          manualValue={manualValue}
          onManualOpen={() => setManualOpen(true)}
          onManualValue={setManualValue}
          onManualSave={() => {
            const value = Number(manualValue);
            dispatch({
              type: 'EDGENUITY_MANUAL_NOTE',
              assignmentId: assignment.id,
              progressPercent: Number.isFinite(value) ? value : undefined,
              note: 'Student-entered progress; OCR could not confirm it',
            });
            toast('Saved as Manual / unverified. It does not unlock blocked sites.', 'info');
            onClose();
          }}
          onRetake={() => {
            setReading(null);
            setStep('screen');
          }}
          onConfirm={() => {
            if (session) {
              dispatch({
                type: 'EDGENUITY_SUBMIT_PROOF',
                sessionId: session.id,
                after: proof,
              });
            } else {
              dispatch({
                type: 'EDGENUITY_START_SESSION',
                assignmentId: assignment.id,
                before: proof,
              });
              toast('Starting progress saved. Come back and verify when you’ve worked.', 'success');
            }
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function GuidanceStep({
  isFinal,
  onOpenScreen,
  devFixtures,
  onFixture,
}: {
  isFinal: boolean;
  onOpenScreen: () => void;
  devFixtures: boolean;
  onFixture: (src: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm lk-strong">
        {isFinal
          ? 'Show your Edgenuity progress now, the same way you did at the start.'
          : 'Before you begin, show your current Edgenuity progress.'}
      </p>

      <div className="lk-sunken rounded-2xl border lk-border p-4">
        <p className="text-xs font-bold tracking-wide lk-muted uppercase">Make sure these are visible</p>
        <ul className="mt-2 space-y-1.5 text-sm lk-strong">
          {[
            'The Edgenuity course or activity name',
            'The progress percentage',
            'Enough of the page to recognise the screen',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Icon name="check" size={14} className="mt-1 shrink-0 text-mint-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs lk-muted">
          You don’t need the whole monitor — just the part of the page showing your progress.
        </p>
      </div>

      <Button
        size="lg"
        block
        icon={<Icon name="edgenuity" size={18} />}
        onClick={onOpenScreen}
      >
        Share my Edgenuity window
      </Button>

      <p className="text-center text-xs lk-muted">
        Live capture only. Photos and files from your computer can’t verify Edgenuity progress.
      </p>

      {/* `import.meta.env.DEV &&` is repeated here, not just at the call site.
          The prop crosses a component boundary, so Rollup cannot prove it is
          always false — without this literal the whole block, and the fixture
          paths inside it, survive into the production bundle. */}
      {import.meta.env.DEV && devFixtures && (
        <div className="rounded-2xl border border-dashed lk-border p-3">
          <p className="text-xs font-bold lk-muted">
            Developer mode · test fixtures (always recorded as unverified)
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {['clear-43', 'clear-47'].map((name) => (
              <Button
                key={name}
                variant="secondary"
                size="sm"
                onClick={() => onFixture(`/fixtures/edgenuity/${name}.png`)}
              >
                {name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadingStep({
  progress,
  onCancel,
}: {
  progress: OcrProgress | null;
  onCancel: () => void;
}) {
  const stage = progress?.stage ?? 'preparing_image';
  const ratio = progress?.ratio;
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center gap-3">
        <Icon name="refresh" size={18} className="animate-spin text-brand-500" />
        <p className="text-sm font-bold lk-strong">{STAGE_LABEL[stage]}</p>
      </div>
      <ProgressBar
        value={ratio !== undefined ? Math.round(ratio * 100) : 30}
        max={100}
        tone="brand"
      />
      <p className="text-xs lk-muted">
        Reading happens on this device. The first read of the day also loads the text engine, which
        takes a few seconds.
      </p>
      <Button variant="secondary" block onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function ReviewStep({
  assignment,
  session,
  reading,
  proof,
  manualOpen,
  manualValue,
  onManualOpen,
  onManualValue,
  onManualSave,
  onRetake,
  onConfirm,
}: {
  assignment: Assignment;
  session?: EdgenuitySession;
  reading: ProofReading;
  proof: EdgenuityProof;
  manualOpen: boolean;
  manualValue: string;
  onManualOpen: () => void;
  onManualValue: (value: string) => void;
  onManualSave: () => void;
  onRetake: () => void;
  onConfirm: () => void;
}) {
  const problem = reading.result.problem;
  const advice = reading.qualityAdvice ?? (problem ? READ_PROBLEM_ADVICE[problem] : undefined);

  /**
   * The code failing is a different failure from the screen failing, and it
   * gets its own screen: the fix is "write it bigger", not "move closer".
   * Nothing here offers a way to confirm the code by hand — a student ticking
   * "yes it was there" would turn the whole feature back into a question.
   */
  if (problem || advice) {
    return (
      <div className="space-y-4">
        {reading.thumbnail && <Thumb src={reading.thumbnail} />}
        <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
          <p className="text-sm font-bold text-amber-700 dark:text-amber-300">
            {problem === 'not_edgenuity'
              ? 'We couldn’t confidently recognise this as an Edgenuity progress screen.'
              : 'We couldn’t read the progress clearly.'}
          </p>
          <p className="mt-2 text-sm lk-muted">{advice}</p>
          <ul className="mt-2 space-y-1 text-xs lk-muted">
            <li>• share the window with your course page on it</li>
            <li>• scroll so the progress number is visible</li>
            <li>• make the browser window larger</li>
          </ul>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {!manualOpen && (
            <Button variant="secondary" onClick={onManualOpen}>
              Enter it manually instead
            </Button>
          )}
          <Button icon={<Icon name="edgenuity" size={16} />} onClick={onRetake}>
            Retake
          </Button>
        </div>

        {manualOpen && (
          <div className="space-y-3 rounded-2xl border lk-border p-4">
            <p className="text-sm font-bold lk-strong">Manual / unverified</p>
            <p className="text-xs lk-muted">
              A number you type is not evidence, so this is saved for your own tracking only. It
              will not complete the assignment and will not unlock blocked sites — retake the photo
              for that.
            </p>
            <Field label="Course progress (%)">
              <TextInput
                type="number"
                min={0}
                max={100}
                value={manualValue}
                onChange={(e) => onManualValue(e.target.value)}
              />
            </Field>
            <Button variant="secondary" block onClick={onManualSave}>
              Save as unverified
            </Button>
          </div>
        )}
      </div>
    );
  }

  /**
   * A preview of what the reducer will decide. It calls the same pure policy
   * with the same inputs, so the two cannot disagree — the reducer remains the
   * only thing that actually records anything.
   */
  const preview =
    session && assignment.edgenuity
      ? checkProgress({
          session,
          link: assignment.edgenuity,
          after: proof,
          focusMinutesNow: assignment.loggedMinutes,
        })
      : null;

  const required = assignment.edgenuity ? requiredDeltaOf(assignment.edgenuity.config) : 0;

  return (
    <div className="space-y-4">
      {reading.thumbnail && <Thumb src={reading.thumbnail} />}

      <div className="lk-sunken rounded-2xl border lk-border p-4">
        <p className="text-xs font-bold tracking-wide lk-muted uppercase">Detected</p>
        <p className="mt-1 text-lg font-extrabold lk-strong">
          {reading.result.detectedCourse ?? assignment.subject}
        </p>
        {reading.result.detectedProgressPercent !== undefined && (
          <p className="text-3xl font-extrabold text-brand-600 dark:text-brand-300">
            {reading.result.detectedProgressPercent}%
          </p>
        )}
        {reading.result.detectedActivity && (
          <p className="mt-1 text-sm lk-muted">{reading.result.detectedActivity}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={reading.result.parseConfidence === 'high' ? 'mint' : 'amber'}>
            {reading.result.parseConfidence === 'high' ? 'Clear reading' : 'Lower confidence'}
          </Badge>
          {proof.source !== 'live_screen' && <Badge tone="flame">Not a live capture</Badge>}
        </div>
      </div>

      {preview && (
        <div
          className={cx(
            'rounded-2xl border p-4 text-sm',
            preview.outcome === 'verified'
              ? 'border-mint-500/40 bg-mint-500/10'
              : preview.outcome === 'partial'
                ? 'border-brand-500/40 bg-brand-500/10'
                : 'border-amber-400/40 bg-amber-400/10',
          )}
        >
          {preview.progressBefore !== undefined && preview.progressAfter !== undefined && (
            <p className="font-bold lk-strong">
              {preview.progressBefore}% → {preview.progressAfter}% ({preview.newProgress >= 0 ? '+' : ''}
              {preview.newProgress}%) · required +{required}%
            </p>
          )}
          <p className="mt-1 lk-muted">{preview.message}</p>
        </div>
      )}

      <p className="text-xs lk-muted">
        This records that a window you shared showed these values. It does not prove the page
        itself was genuine.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" icon={<Icon name="camera" size={16} />} onClick={onRetake}>
          Retake
        </Button>
        <Button icon={<Icon name="check" size={16} />} onClick={onConfirm}>
          {session ? 'Use this' : 'Confirm & start'}
        </Button>
      </div>
    </div>
  );
}

/** Session-scoped preview only: held in component state, never persisted. */
function Thumb({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt="Small preview of the photo just taken"
      className="mx-auto max-h-32 rounded-xl border lk-border"
    />
  );
}
