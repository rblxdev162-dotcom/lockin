import { useMemo, useState } from 'react';
import { useApp } from '../store/context';
import { Card, CardHeader, EmptyState } from '../components/ui/Card';
import { Chip } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import type { IconName } from '../components/ui/Icon';
import type { ActivityType } from '../types';
import { prettyDomain } from '../lib/domains';
import { relativeTime } from '../lib/time';
import { WeeklyReviewCard } from '../components/features/WeeklyReviewCard';

const ICONS: Record<ActivityType, IconName> = {
  focus_mode_started: 'lock',
  focus_mode_completed: 'check',
  focus_mode_ended: 'unlock',
  parent_override: 'shield',
  emergency_exit: 'alert',
  temporary_unlock_started: 'unlock',
  temporary_unlock_ended: 'lock',
  assignment_completed: 'check',
  assignment_created: 'plus',
  assignment_deleted: 'trash',
  class_renamed: 'edit',
  focus_session_completed: 'timer',
  blocking_test_started: 'bolt',
  allowlist_changed: 'shield',
  pin_changed: 'shield',
  canvas_connected: 'canvas',
  canvas_disconnected: 'unlink',
  canvas_assignment_imported: 'canvas',
  canvas_assignment_linked: 'link',
  canvas_submission_verified: 'check',
  canvas_assignment_missing: 'alert',
  canvas_grade_confirmed: 'check',
  canvas_completion_contested: 'alert',
  parent_controls_changed: 'shield',
  parent_requirement_changed: 'shield',
  plan_generated: 'calendar',
  plan_settings_changed: 'settings',
  plan_item_skipped: 'refresh',
  plan_item_moved: 'refresh',
  integration_connected: 'link',
  integration_disconnected: 'unlink',
  integration_synced: 'refresh',
  integration_error: 'alert',
  feed_assignments_imported: 'calendar',
  feed_assignment_updated: 'calendar',
  feed_assignment_cancelled: 'close',
  course_progress_updated: 'edgenuity',
  canvas_grades_read: 'badge',
  canvas_check_refused: 'lock',
  canvas_check_override: 'unlock',
};

const TONES: Partial<Record<ActivityType, 'brand' | 'mint' | 'flame' | 'amber'>> = {
  focus_mode_started: 'brand',
  focus_mode_completed: 'mint',
  assignment_completed: 'mint',
  focus_session_completed: 'mint',
  parent_override: 'amber',
  emergency_exit: 'flame',
  temporary_unlock_started: 'amber',
  blocking_test_started: 'amber',
  canvas_connected: 'brand',
  canvas_assignment_imported: 'brand',
  canvas_assignment_linked: 'brand',
  canvas_submission_verified: 'mint',
  canvas_assignment_missing: 'flame',
  canvas_grade_confirmed: 'mint',
  canvas_completion_contested: 'amber',
  parent_controls_changed: 'brand',
  parent_requirement_changed: 'brand',
};

const GROUPS = {
  All: null,
  'Focus Mode': [
    'focus_mode_started',
    'focus_mode_completed',
    'focus_mode_ended',
    'blocking_test_started',
  ],
  Overrides: [
    'parent_override',
    'emergency_exit',
    'temporary_unlock_started',
    'temporary_unlock_ended',
    'pin_changed',
    'allowlist_changed',
    'parent_controls_changed',
    'parent_requirement_changed',
  ],
  Work: ['assignment_completed', 'assignment_created', 'assignment_deleted', 'focus_session_completed'],
  Canvas: [
    'canvas_connected',
    'canvas_disconnected',
    'canvas_assignment_imported',
    'canvas_assignment_linked',
    'canvas_submission_verified',
    'canvas_assignment_missing',
    'canvas_grade_confirmed',
    'canvas_completion_contested',
  ],
  Edgenuity: [
    'edgenuity_verification_started',
    'edgenuity_progress_verified',
    'edgenuity_verification_failed',
    'edgenuity_verification_expired',
    'edgenuity_verification_cancelled',
  ],
} as const;

export function ActivityPage() {
  const { state } = useApp();
  const [filter, setFilter] = useState<keyof typeof GROUPS>('All');

  const events = useMemo(() => {
    const allowed = GROUPS[filter];
    if (!allowed) return state.activity;
    return state.activity.filter((e) => (allowed as readonly string[]).includes(e.type));
  }, [state.activity, filter]);

  const totalBlocks = state.blockStats.reduce((sum, s) => sum + s.count, 0);
  const totalMinutes = state.completedSessions.reduce((sum, s) => sum + s.actualMinutes, 0);
  const completedCount = state.assignments.filter((a) => a.status === 'Completed').length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight lk-strong">Activity</h1>
        <p className="mt-1 text-sm lk-muted">
          Everything below is stored only on this device.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Minutes studied', value: totalMinutes },
          { label: 'Tasks completed', value: completedCount },
          { label: 'Blocks enforced', value: totalBlocks },
        ].map((s) => (
          <Card key={s.label} className="text-center" padded={false}>
            <div className="p-4">
              <p className="text-2xl font-extrabold tracking-tight lk-strong">{s.value}</p>
              <p className="mt-0.5 text-[0.7rem] font-semibold lk-muted">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      <WeeklyReviewCard />

      <Card>
        <CardHeader
          title="Blocked attempts"
          subtitle="Counts only — LockIn never stores which pages you visited."
        />
        {state.blockStats.length === 0 ? (
          <EmptyState
            icon={<Icon name="shield" size={26} />}
            title="No blocks recorded"
            hint="When Focus Mode redirects a distracting site, it gets counted here."
          />
        ) : (
          <div className="space-y-2">
            {[...state.blockStats]
              .sort((a, b) => b.count - a.count)
              .map((s) => (
                <div
                  key={s.domain}
                  className="lk-sunken flex items-center justify-between gap-3 rounded-xl border lk-border px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold lk-strong">
                      {prettyDomain(s.domain)}
                    </p>
                    <p className="text-xs lk-muted">{s.domain}</p>
                  </div>
                  <Badge tone="flame">
                    blocked {s.count} time{s.count === 1 ? '' : 's'}
                  </Badge>
                </div>
              ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Event log" subtitle={`${state.activity.length} recent events`} />
        <div className="mb-4 flex flex-wrap gap-2">
          {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((g) => (
            <Chip key={g} active={filter === g} onClick={() => setFilter(g)}>
              {g}
            </Chip>
          ))}
        </div>

        {events.length === 0 ? (
          <EmptyState
            icon={<Icon name="activity" size={26} />}
            title="Nothing logged yet"
            hint="Focus sessions, completions and overrides all show up here."
          />
        ) : (
          <ol className="relative space-y-0.5 pl-1">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 py-2">
                <span
                  className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
                    TONES[e.type] === 'mint'
                      ? 'bg-mint-400/20 text-mint-600 dark:text-mint-400'
                      : TONES[e.type] === 'flame'
                        ? 'bg-flame-400/20 text-flame-600 dark:text-flame-400'
                        : TONES[e.type] === 'amber'
                          ? 'bg-amber-400/20 text-amber-700 dark:text-amber-300'
                          : TONES[e.type] === 'brand'
                            ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200'
                            : 'lk-sunken lk-muted border lk-border'
                  }`}
                >
                  <Icon name={ICONS[e.type] ?? 'activity'} size={16} />
                </span>
                <div className="min-w-0 flex-1 border-b lk-border pb-2.5">
                  <p className="text-sm font-semibold lk-strong">{e.message}</p>
                  <p className="mt-0.5 text-xs lk-muted">
                    {relativeTime(e.timestamp)} ·{' '}
                    {new Date(e.timestamp).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
