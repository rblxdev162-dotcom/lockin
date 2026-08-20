/**
 * "LockIn repaired some stored settings."
 *
 * Shown once per session, only when the load actually lost records (see
 * `isSignificantRecovery`). Deliberately not a stack trace and not a count of
 * fields: the student needs to know that something was repaired and that their
 * work survived, not which coercion function ran.
 */
import { useApp } from '../../store/context';
import { Icon } from '../ui/Icon';

export function RecoveryNotice() {
  const { recovery, dismissRecovery } = useApp();
  if (!recovery) return null;

  const lost: string[] = [];
  if (recovery.dropped.assignments > 0) {
    lost.push(`${recovery.dropped.assignments} assignment${recovery.dropped.assignments === 1 ? '' : 's'}`);
  }
  if (recovery.dropped.exams > 0) {
    lost.push(`${recovery.dropped.exams} exam${recovery.dropped.exams === 1 ? '' : 's'}`);
  }
  if (recovery.dropped.focusRuns > 0) lost.push('some focus history');
  if (0 > 0) lost.push('some verification history');

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4"
    >
      <Icon
        name="alert"
        size={20}
        aria-hidden
        className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"
      />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-bold lk-strong">
          {recovery.kind === 'reset'
            ? 'LockIn could not read its saved data'
            : 'LockIn repaired some stored data'}
        </p>
        <p className="mt-1 leading-relaxed lk-muted">
          {recovery.kind === 'reset' ? (
            <>
              The saved file was damaged, so LockIn started fresh. The old file was kept on this
              device rather than deleted, in case it can be recovered.
            </>
          ) : (
            <>
              Everything readable was kept.
              {lost.length > 0 ? ` ${capitalise(listly(lost))} could not be read and were removed.` : ''}{' '}
              Your other assignments, exams and history are unchanged.
            </>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={dismissRecovery}
        aria-label="Dismiss this message"
        className="shrink-0 rounded-lg p-1 lk-muted hover:lk-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <Icon name="close" size={16} aria-hidden />
      </button>
    </div>
  );
}

function listly(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
