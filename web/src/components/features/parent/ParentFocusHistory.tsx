/**
 * Focus Mode history, and the three ways a session can be cut short.
 *
 * Blocked attempts are shown as per-domain counts and nothing else. LockIn has
 * never recorded which pages were opened — the extension reports totals per
 * domain and that is the whole of it — so there is no URL list to show here
 * even if someone wanted one.
 */
import type { AppState } from '../../../types';
import { Card, CardHeader, EmptyState } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Icon } from '../../ui/Icon';
import { selectFocusHistory, selectOverrideHistory } from '../../../lib/parent/selectors';
import { prettyDomain } from '../../../lib/domains';

const OUTCOME_TONE = {
  completed: 'mint',
  active: 'brand',
  ended: 'neutral',
  override: 'amber',
  emergency: 'flame',
  test_expired: 'neutral',
} as const;

export function ParentFocusHistory({ state }: { state: AppState }) {
  const runs = selectFocusHistory(state, { limit: 15 });
  const overrides = selectOverrideHistory(state, 20);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Focus Mode history"
          subtitle="Each session, what it required, and how it ended."
        />
        {runs.length === 0 ? (
          <EmptyState
            icon={<Icon name="lock" size={26} />}
            title="No Focus Mode sessions yet"
            hint="Sessions appear here once Focus Mode has been used."
          />
        ) : (
          <div className="space-y-2.5">
            {runs.map((run) => (
              <div key={run.id} className="lk-sunken rounded-2xl border lk-border p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold lk-strong">{formatRange(run.startedAt, run.endedAt)}</p>
                  <Badge tone={OUTCOME_TONE[run.outcome]}>{run.outcomeLabel}</Badge>
                </div>

                <p className="mt-1 text-xs lk-muted">
                  {run.minutes} min · Required {run.requiredCount} · Completed {run.completedCount} /{' '}
                  {run.requiredCount}
                </p>

                {run.requiredTitles.length > 0 && (
                  <p className="mt-1 truncate text-xs lk-muted">
                    {run.requiredTitles.join(' · ')}
                  </p>
                )}

                {run.note && (
                  <p className="mt-1.5 text-xs lk-strong">Reason given: “{run.note}”</p>
                )}

                {run.unlocks.length > 0 && (
                  <p className="mt-1.5 text-xs lk-muted">
                    {run.unlocks.length} temporary unlock{run.unlocks.length === 1 ? '' : 's'} —{' '}
                    {run.unlocks
                      .map((u) => `${u.minutes} min${u.byParent ? ' (parent)' : ''}`)
                      .join(', ')}
                  </p>
                )}

                {run.blocked.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {run.blocked.slice(0, 6).map((entry) => (
                      <Badge key={entry.domain} tone="neutral">
                        {prettyDomain(entry.domain)} {entry.count}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs lk-muted">
          Blocked attempts are per-domain counts. LockIn does not record which pages were opened.
        </p>
      </Card>

      <Card>
        <CardHeader
          title="Overrides, exits and unlocks"
          subtitle="Kept as three separate things, because they mean three different things."
        />
        {overrides.length === 0 ? (
          <p className="text-sm lk-muted">Nothing recorded.</p>
        ) : (
          <div className="space-y-2">
            {overrides.map((entry) => (
              <div key={entry.id} className="lk-sunken rounded-xl border lk-border px-3.5 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold lk-strong">
                    {entry.kind === 'override'
                      ? 'Parent override'
                      : entry.kind === 'emergency'
                        ? 'Emergency exit'
                        : `${entry.minutes ?? ''}-minute temporary unlock`}
                  </p>
                  <span className="text-xs lk-muted">{formatMoment(entry.at)}</span>
                </div>

                {entry.kind === 'override' && (
                  <p className="mt-0.5 text-xs lk-muted">
                    Focus Mode was ended with the parent PIN before the required work was finished.
                  </p>
                )}
                {entry.kind === 'emergency' && (
                  <p className="mt-0.5 text-xs lk-muted">
                    {entry.note ? `Reason given: “${entry.note}”` : 'No reason was recorded.'}
                  </p>
                )}
                {entry.kind === 'temporary_unlock' && (
                  <p className="mt-0.5 text-xs lk-muted">
                    Blocking paused
                    {entry.endedAt ? ` · resumed ${formatClockOnly(entry.endedAt)}` : ' · still active'}.
                    Focus Mode stayed on.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function formatRange(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt);
  const day = start.toLocaleDateString(undefined, { weekday: 'long' });
  const from = formatClockOnly(startedAt);
  return endedAt ? `${day} · ${from} – ${formatClockOnly(endedAt)}` : `${day} · ${from} – now`;
}

function formatClockOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
