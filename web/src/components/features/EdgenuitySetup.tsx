/**
 * Choosing how an Edgenuity assignment's progress will be measured.
 *
 * Three options, in the order a student should prefer them: a percentage
 * target (strongest evidence), activity counting (only works when OCR reads
 * activity names cleanly, so it says so), and focus time plus screen proof
 * (weakest, and labelled as such rather than dressed up as verified progress).
 */
import { useEffect, useState } from 'react';
import type { Assignment, EdgenuityConfig, EdgenuityTargetType } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, TextInput, Toggle } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { useApp } from '../../store/context';
import { ParentPinDialog } from './ParentPinDialog';
import { toast } from '../ui/Toast';
import { cx } from '../../lib/cx';

const OPTIONS: {
  type: EdgenuityTargetType;
  title: string;
  example: string;
  note?: string;
}[] = [
  {
    type: 'progress_percent',
    title: 'Increase course progress',
    example: 'Example: +3%',
    note: 'The most reliable option. Use it whenever your course shows a progress percentage.',
  },
  {
    type: 'activities',
    title: 'Complete activities',
    example: 'Example: 2 activities',
    note: 'Experimental — it only counts when the activity name is read clearly in both photos.',
  },
  {
    type: 'session_progress',
    title: 'Focus time + proof',
    example: 'Example: 25 minutes',
    note: 'For courses with no dependable percentage. Recorded as “Focus + Screen Proof”, not as verified course progress.',
  },
];

export function EdgenuitySetup({
  open,
  assignment,
  onClose,
}: {
  open: boolean;
  assignment: Assignment;
  onClose: () => void;
}) {
  const { state, dispatch } = useApp();
  const existing = assignment.edgenuity?.config;
  /** The global floor. When it's on, the per-assignment switch can't turn it off. */
  const globalEnhanced = state.settings.edgenuityProofMode === 'enhanced';
  /** A parent has locked verification strength; changing it needs the PIN. */
  const managed = state.parentControls.lockVerificationSettings && !!state.parentPin;
  const [pinOpen, setPinOpen] = useState(false);
  const [approved, setApproved] = useState(false);

  const [targetType, setTargetType] = useState<EdgenuityTargetType>(
    existing?.targetType ?? 'progress_percent',
  );
  const [delta, setDelta] = useState(String(existing?.requiredProgressDelta ?? 3));
  const [activities, setActivities] = useState(String(existing?.requiredActivities ?? 2));
  const [minutes, setMinutes] = useState(String(existing?.requiredFocusMinutes ?? 25));
  const [courseName, setCourseName] = useState(existing?.courseName ?? assignment.subject ?? '');
  const [requireEnhanced, setRequireEnhanced] = useState(
    existing?.requiredVerificationTrust === 'enhanced',
  );
  /**
   * Where the number comes from. Browser reading needs Edgenuity to be running
   * in this Chrome; a school computer LockIn cannot see still needs the camera,
   * which is why the photo path stays rather than being replaced.
   */
  const [readFromBrowser, setReadFromBrowser] = useState(existing?.source === 'browser');

  useEffect(() => {
    if (!open) return;
    setTargetType(existing?.targetType ?? 'progress_percent');
    setDelta(String(existing?.requiredProgressDelta ?? 3));
    setActivities(String(existing?.requiredActivities ?? 2));
    setMinutes(String(existing?.requiredFocusMinutes ?? 25));
    setCourseName(existing?.courseName ?? assignment.subject ?? '');
    setRequireEnhanced(existing?.requiredVerificationTrust === 'enhanced');
    setReadFromBrowser(existing?.source === 'browser');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    /**
     * The requirement is the only locked field here. Everything else — the
     * target type, the percentage, the course name — stays the student's, so a
     * locked device still lets them plan their own work.
     */
    const existingTrust = existing?.requiredVerificationTrust ?? 'standard';
    const wantsTrustChange = (requireEnhanced ? 'enhanced' : 'standard') !== existingTrust;
    if (managed && wantsTrustChange && !approved) {
      setPinOpen(true);
      return;
    }

    const config: EdgenuityConfig = {
      source: readFromBrowser ? 'browser' : undefined,
      // Keep the course this assignment already claimed; a source switch must
      // not silently re-point it at whatever page is open next.
      externalCourseId: existing?.externalCourseId,
      courseName: courseName.trim().slice(0, 120) || undefined,
      targetType,
      requiredProgressDelta:
        targetType === 'progress_percent'
          ? Math.min(100, Math.max(1, Number(delta) || 3))
          : undefined,
      requiredActivities:
        targetType === 'activities' ? Math.min(50, Math.max(1, Number(activities) || 2)) : undefined,
      requiredFocusMinutes:
        targetType === 'session_progress'
          ? Math.min(240, Math.max(1, Number(minutes) || 25))
          : undefined,
      requiredVerificationTrust:
        managed && !approved ? existingTrust : requireEnhanced ? 'enhanced' : 'standard',
    };
    dispatch({ type: 'EDGENUITY_CONFIGURE', assignmentId: assignment.id, config });
    toast('Edgenuity verification set up. Take a starting photo when you begin.', 'success');
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Edgenuity verification"
      subtitle="How should progress be measured?"
      onClose={onClose}
      wide
      footer={
        <>
          {assignment.edgenuity && (
            <Button
              variant="secondary"
              onClick={() => {
                dispatch({ type: 'EDGENUITY_UNCONFIGURE', assignmentId: assignment.id });
                toast('Edgenuity verification removed. Progress already verified is kept.', 'info');
                onClose();
              }}
            >
              Remove
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Course name as Edgenuity shows it" hint="Used to check both photos show the same course.">
          <TextInput
            value={courseName}
            maxLength={120}
            placeholder="Physical Science Semester A"
            onChange={(e) => setCourseName(e.target.value)}
          />
        </Field>

        <div className="space-y-2">
          {OPTIONS.map((option) => {
            const on = targetType === option.type;
            return (
              <button
                key={option.type}
                type="button"
                onClick={() => setTargetType(option.type)}
                className={cx(
                  'block w-full rounded-2xl border p-3.5 text-left transition-colors',
                  on ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'lk-border lk-sunken',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      'grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full border-2',
                      on ? 'border-brand-500 bg-brand-500 text-white' : 'lk-border',
                    )}
                  >
                    {on && <Icon name="check" size={10} strokeWidth={3} />}
                  </span>
                  <span className="text-sm font-bold lk-strong">{option.title}</span>
                </div>
                <p className="mt-1 pl-6.5 text-xs lk-muted">{option.example}</p>
                {option.note && <p className="mt-1 pl-6.5 text-xs lk-muted">{option.note}</p>}
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border p-3.5 lk-border">
          <Toggle
            checked={readFromBrowser}
            onChange={setReadFromBrowser}
            label="Read this from Edgenuity automatically"
          />
          <p className="mt-1.5 text-xs lk-muted">
            {readFromBrowser
              ? 'LockIn will read this course’s progress from the Edgenuity page you open in this browser — no photos. Turn on Edgenuity reading in Settings first. Your first visit records a starting point; only work after that counts.'
              : 'Off: verify with a live photo of the Edgenuity screen instead. Use this when Edgenuity runs on a school computer LockIn cannot see.'}
          </p>
        </div>

        {targetType === 'progress_percent' && (
          <Field label="Percentage points of new progress required">
            <TextInput
              type="number"
              min={1}
              max={100}
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
          </Field>
        )}
        {targetType === 'activities' && (
          <Field label="Activities to complete">
            <TextInput
              type="number"
              min={1}
              max={50}
              value={activities}
              onChange={(e) => setActivities(e.target.value)}
            />
          </Field>
        )}
        {targetType === 'session_progress' && (
          <Field label="Focus minutes required" hint="Plus a before and after photo of the same course.">
            <TextInput
              type="number"
              min={1}
              max={240}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </Field>
        )}

        <div className="rounded-2xl border lk-border p-3.5">
          <Toggle
            checked={requireEnhanced || globalEnhanced}
            onChange={setRequireEnhanced}
            label="Require Enhanced Proof"
            description={
              globalEnhanced
                ? 'Enhanced Proof is on for every assignment in Settings, so this assignment already requires it.'
                : managed
                  ? 'Managed by Parent Controls — saving a change to this needs the parent PIN.'
                  : 'Each capture must also show a one-time code issued moments before. Harder to fake with a prepared photo; slower for the student.'
            }
          />
        </div>
      </div>

      <ParentPinDialog
        open={pinOpen}
        title="Parent approval required"
        description="A parent has locked verification requirements on this device."
        confirmLabel="Approve change"
        onCancel={() => setPinOpen(false)}
        onVerified={() => {
          setPinOpen(false);
          setApproved(true);
          // Re-run the save now that the change is approved.
          window.setTimeout(save, 0);
        }}
      />
    </Modal>
  );
}
