/**
 * The Edgenuity block shown on an assignment card and inside Focus Mode.
 *
 * It is the only place a student starts or finishes a verification, so it has
 * to answer three questions at a glance: what am I aiming at, what have I
 * proved so far, and what do I press next.
 */
import { useState } from 'react';
import type { Assignment } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { ProgressBar } from '../ui/Progress';
import { useApp } from '../../store/context';
import { EdgenuityVerifyModal } from './EdgenuityVerifyModal';
import { EdgenuitySetup } from './EdgenuitySetup';
import {
  activeSessionFor,
  requiredActivitiesOf,
  requiredDeltaOf,
  requiredFocusMinutesOf,
  requiredTrustFor,
} from '../../lib/edgenuity/verification';
import { EdgenuityVerificationSummary } from './VerificationTrustBadge';

export function EdgenuityPanel({
  assignment,
  compact,
}: {
  assignment: Assignment;
  /** Tighter layout for the Focus Mode required-work list. */
  compact?: boolean;
}) {
  const { state, dispatch, now } = useApp();
  const [verifying, setVerifying] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const link = assignment.edgenuity;
  const session = link ? activeSessionFor(state.edgenuity.sessions, assignment.id, now) : undefined;
  const done = assignment.status === 'Completed';
  const requiredTrust = link
    ? requiredTrustFor(link.config)
    : 'standard';
  /**
   * A session already running keeps the requirement it began with, so raising
   * the setting mid-verification can't strand a student halfway through.
   */
  const sessionTrustRequirement = session?.requiredTrust ?? requiredTrust;

  if (!link) {
    return (
      <>
        <button
          onClick={() => setSetupOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-bold lk-muted transition-colors hover:text-brand-600 dark:hover:text-brand-300"
        >
          <Icon name="edgenuity" size={13} />
          Set up Edgenuity verification
        </button>
        <EdgenuitySetup open={setupOpen} assignment={assignment} onClose={() => setSetupOpen(false)} />
      </>
    );
  }

  const config = link.config;
  const target =
    config.targetType === 'progress_percent'
      ? `+${requiredDeltaOf(config)}% course progress`
      : config.targetType === 'activities'
        ? `${requiredActivitiesOf(config)} activities`
        : `${requiredFocusMinutesOf(config)} min focus + screen proof`;

  const earned =
    config.targetType === 'activities' ? link.verifiedActivities : link.verifiedProgressDelta;
  const goal =
    config.targetType === 'activities' ? requiredActivitiesOf(config) : requiredDeltaOf(config);

  return (
    <div className="w-full space-y-2.5 border-t lk-border pt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">EDGENUITY</Badge>
        {done ? (
          <EdgenuityVerificationSummary assignment={assignment} />
        ) : session ? (
          <Badge tone="amber">Waiting for final proof</Badge>
        ) : (
          <Badge tone="neutral">Verification required</Badge>
        )}
        {!compact && (
          <button
            onClick={() => setSetupOpen(true)}
            className="ml-auto inline-flex items-center gap-1 text-xs font-bold lk-muted hover:lk-strong"
          >
            <Icon name="edit" size={12} />
            Change target
          </button>
        )}
      </div>

      <p className="text-xs lk-muted">
        Target: <span className="font-bold lk-strong">{target}</span>
        {sessionTrustRequirement === 'enhanced' && (
          <>
            {' · '}
            <span className="font-bold text-brand-600 dark:text-brand-300">
              Enhanced Proof required
            </span>
          </>
        )}
      </p>

      {/* The student did the work and the reading was fine, but the capture
          didn't reach the strength this assignment asks for. Saying so beats a
          bare failure, and the fix is one more photo with the code in it. */}
      {!done && sessionTrustRequirement === 'enhanced' && link.lastVerifiedTrust === 'standard' && (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-2.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
          Progress detected ✓ — Enhanced verification still required.
        </p>
      )}

      {config.targetType !== 'session_progress' && (earned > 0 || !done) && (
        <div>
          <ProgressBar value={Math.min(earned, goal)} max={goal} tone={done ? 'mint' : 'brand'} />
          <p className="mt-1 text-xs lk-muted">
            {config.targetType === 'activities'
              ? `${earned} / ${goal} activities verified`
              : `${earned}% / ${goal}% verified`}
            {link.lastVerifiedProgress !== null && ` · last reading ${link.lastVerifiedProgress}%`}
          </p>
        </div>
      )}

      {session && !done && (
        <div className="lk-sunken rounded-xl border lk-border p-2.5 text-xs">
          <p className="lk-muted">
            Starting progress:{' '}
            <span className="font-bold lk-strong">
              {session.before.progressPercent !== undefined
                ? `${session.before.progressPercent}%`
                : 'recorded'}
            </span>
            {session.before.progressPercent !== undefined &&
              config.targetType === 'progress_percent' && (
                <>
                  {' · '}Target:{' '}
                  <span className="font-bold lk-strong">
                    {Math.min(100, session.before.progressPercent + requiredDeltaOf(config))}%
                  </span>
                </>
              )}
          </p>
          {session.pendingConfirmation && (
            <p className="mt-1 font-bold text-amber-600 dark:text-amber-400">
              {session.pendingConfirmation.reason === 'large_jump'
                ? 'Large progress change detected — take another verification photo.'
                : 'That was very soon after the starting photo — take another to confirm.'}
            </p>
          )}
        </div>
      )}

      {!done && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<Icon name="camera" size={14} />}
            onClick={() => setVerifying(true)}
          >
            {session ? 'Verify progress' : 'Start work'}
          </Button>
          {session && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => dispatch({ type: 'EDGENUITY_CANCEL_SESSION', sessionId: session.id })}
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      {done && link.lastVerifiedProgress !== null && (
        <p className="text-xs text-mint-600 dark:text-mint-400">
          {link.verifiedProgressDelta > 0
            ? `+${link.verifiedProgressDelta}% verified progress`
            : 'Focus + Screen Proof complete'}
        </p>
      )}

      <EdgenuityVerifyModal
        open={verifying}
        assignment={assignment}
        session={session}
        onClose={() => setVerifying(false)}
      />
      <EdgenuitySetup open={setupOpen} assignment={assignment} onClose={() => setSetupOpen(false)} />
    </div>
  );
}
