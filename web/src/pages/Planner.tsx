/**
 * /planner — Today, This Week, Exams, Availability, Settings.
 *
 * The page renders a plan; it never computes one. Every number on screen comes
 * out of `lib/planner/`, which is a pure function of state and settings — so
 * what is displayed here and what the engine decided cannot drift apart.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../store/context';
import { Card, CardHeader, EmptyState } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import { Modal } from '../components/ui/Modal';
import { Chip } from '../components/ui/Field';
import { TodayPlanCard } from '../components/features/planner/TodayPlanCard';
import { WeekView } from '../components/features/planner/WeekView';
import { PlanWarnings } from '../components/features/planner/PlanWarnings';
import { AvailabilityEditor } from '../components/features/planner/AvailabilityEditor';
import { PlannerSettingsPanel } from '../components/features/planner/PlannerSettingsPanel';
import { ExamStudyPanel } from '../components/features/planner/ExamStudyPanel';
import { usePlanner } from '../hooks/usePlanner';
import { buildPlan, livePlan, selectWeekSummary } from '../lib/planner';
import { diffPlans, isMeaningfulChange } from '../lib/planner/reschedule';
import type { PlanChange } from '../lib/planner/reschedule';
import { explainPlanReason, formatMinutes } from '../lib/planner/explanations';
import { PlannerIntelligence } from '../components/features/planner/PlannerIntelligence';

const TABS = ['Today', 'This Week', 'Exams', 'Availability', 'Settings'] as const;
type Tab = (typeof TABS)[number];

export function PlannerPage() {
  const { state, now } = useApp();
  const at = new Date(now);
  const [tab, setTab] = useState<Tab>('Today');
  const [plannerDays, setPlannerDays] = useState(7);
  const [preview, setPreview] = useState<PlanChange[] | null>(null);
  const planner = usePlanner();

  const plan = useMemo(
    () => livePlan(state, new Date(now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.planner.plan, state.assignments, state.exams, state.completedSessions, state.activeSession],
  );
  const summary = useMemo(() => selectWeekSummary(state, at), [state, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPreview = () => {
    // The engine is deterministic, so the plan previewed here is exactly the
    // plan Apply will produce — nothing is recalculated differently on the way.
    const next = buildPlan(state, 'manual_rebuild', at);
    setPreview(diffPlans(state.planner.plan, next));
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight lk-strong">Planner</h1>
          <p className="mt-1 text-sm lk-muted">
            {plan
              ? `${summary.assignments} assignment${summary.assignments === 1 ? '' : 's'}, ${
                  summary.exams
                } exam${summary.exams === 1 ? '' : 's'} · ${formatMinutes(
                  summary.plannedMinutes,
                )} planned this week`
              : 'A realistic daily schedule, worked out from your own due dates and availability.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={openPreview}>
            Rebuild plan
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {TABS.map((name) => (
          <Chip key={name} active={tab === name} onClick={() => setTab(name)}>
            {name}
          </Chip>
        ))}
      </div>

      {plan && plan.warnings.length > 0 && tab !== 'Settings' && (
        <PlanWarnings warnings={plan.warnings} onAdjust={() => setTab('Availability')} />
      )}

      {tab === 'Today' && (
        <>
          <TodayPlanCard />
          <PlannerIntelligence onAvailability={() => setTab('Availability')} />
          {plan && (
            <Card>
              <CardHeader title="Why did my plan change?" />
              <p className="text-sm lk-muted">{explainPlanReason(plan)}</p>
              <p className="mt-2 text-xs lk-muted">
                Plan version {plan.planVersion} · built{' '}
                {new Date(plan.generatedAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                . Same assignments, same settings, same plan — LockIn does not guess, and there is
                no AI involved.
              </p>
              {state.planner.history.length > 1 && (
                <ul className="mt-3 space-y-1">
                  {state.planner.history.slice(0, 5).map((entry) => (
                    <li key={entry.planVersion} className="text-xs lk-muted">
                      v{entry.planVersion} · {entry.reason.replace(/_/g, ' ')} ·{' '}
                      {formatMinutes(entry.plannedMinutes)} across {entry.itemCount} sessions
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}

      {tab === 'This Week' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-caption font-bold lk-muted">Spatial zoom</p><div className="flex gap-2">{[{label:'Day',days:1},{label:'Week',days:7},{label:'Month',days:28}].map((option) => <Chip key={option.days} active={plannerDays === option.days} onClick={() => setPlannerDays(option.days)}>{option.label}</Chip>)}</div></div>
          <WeekView days={plannerDays} />
          <Card>
            <CardHeader title="Upcoming load" />
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Assignments', value: summary.assignments },
                { label: 'Exams', value: summary.exams },
                { label: 'Minutes planned', value: summary.plannedMinutes },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="lk-sunken rounded-2xl border lk-border p-3 text-center"
                >
                  <p className="text-2xl font-extrabold tracking-tight lk-strong">{stat.value}</p>
                  <p className="mt-0.5 text-[0.7rem] font-semibold lk-muted">{stat.label}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {tab === 'Exams' && <ExamStudyPanel />}
      {tab === 'Availability' && <AvailabilityEditor />}
      {tab === 'Settings' && <PlannerSettingsPanel />}

      {!plan && tab === 'Today' && (
        <Card>
          <EmptyState
            icon={<Icon name="calendar" size={28} />}
            title="No plan yet"
            hint="Set your availability, then build a plan."
            action={<Button onClick={planner.rebuild}>Build my plan</Button>}
          />
        </Card>
      )}

      <Modal
        open={preview !== null}
        title="Plan changes"
        subtitle="Nothing is applied until you say so."
        onClose={() => setPreview(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                planner.rebuild();
                setPreview(null);
              }}
            >
              Apply
            </Button>
          </>
        }
      >
        {preview && preview.length === 0 ? (
          <p className="text-sm lk-muted">There is nothing to schedule right now.</p>
        ) : preview && !isMeaningfulChange(preview) ? (
          <p className="text-sm lk-muted">
            Nothing would change — your plan already matches your work and availability.
          </p>
        ) : (
          <ul className="space-y-2">
            {(preview ?? []).map((change) => (
              <li
                key={`${change.sourceType}:${change.sourceId}`}
                className="lk-sunken flex flex-wrap items-center justify-between gap-2 rounded-xl border lk-border px-3.5 py-2.5"
              >
                <span className="text-sm font-semibold lk-strong">{change.title}</span>
                <span className="text-xs lk-muted">
                  {change.kind === 'moved' && (
                    <>
                      moved: {change.fromDate} → {change.toDate}
                    </>
                  )}
                  {change.kind === 'added' && <>added on {change.toDate}</>}
                  {change.kind === 'removed' && <>removed</>}
                  {change.kind === 'minutes_changed' && (
                    <>
                      {change.beforeMinutes} → {change.afterMinutes} min
                    </>
                  )}
                  {change.kind === 'unchanged' && <Badge tone="neutral">unchanged</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
