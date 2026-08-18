/**
 * Planner settings: daily limits, buffer, chunk sizes, deadline safety, and
 * the opt-in estimate correction.
 *
 * Everything here is a number the scheduler actually uses, so each control
 * says what it does to the plan rather than describing a mood.
 */
import { useApp } from '../../../store/context';
import { Card, CardHeader } from '../../ui/Card';
import { Chip, Field, TextInput, Toggle } from '../../ui/Field';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { WORKLOAD_PREFERENCES, WORKLOAD_UTILISATION } from '../../../types/planner';
import type { PlannerSettings, WorkloadPreference } from '../../../types/planner';
import { selectEstimateSuggestions } from '../../../lib/planner';
import { PLANNER_LIMITATIONS, formatMinutes } from '../../../lib/planner/explanations';

const FOCUS_PRESETS: { focus: number; brk: number }[] = [
  { focus: 25, brk: 5 },
  { focus: 45, brk: 10 },
  { focus: 50, brk: 10 },
];

export function PlannerSettingsPanel() {
  const { state, dispatch } = useApp();
  const settings = state.planner.settings;
  const suggestions = selectEstimateSuggestions(state);

  const set = (patch: Partial<PlannerSettings>) =>
    dispatch({ type: 'PLANNER_UPDATE_SETTINGS', patch });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Daily limits"
          subtitle="LockIn will never plan more than this, however much work exists."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Maximum planned homework per weekday"
            hint="Minutes. Applies on top of each day's own limit."
          >
            <TextInput
              type="number"
              min={0}
              max={720}
              value={settings.weekdayMaxMinutes}
              onChange={(e) => set({ weekdayMaxMinutes: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Maximum planned homework per weekend day" hint="Minutes.">
            <TextInput
              type="number"
              min={0}
              max={720}
              value={settings.weekendMaxMinutes}
              onChange={(e) => set({ weekendMaxMinutes: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Daily buffer"
            hint={`${settings.bufferPercent}% of your free time is deliberately left unplanned — for dinner, delays and the school day running long.`}
          >
            <input
              type="range"
              min={0}
              max={40}
              step={5}
              aria-label="Daily buffer percentage"
              value={settings.bufferPercent}
              onChange={(e) => set({ bufferPercent: Number(e.target.value) })}
              className="w-full accent-brand-600"
            />
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-sm font-semibold lk-strong">School night workload</p>
          <div className="flex flex-wrap gap-2">
            {WORKLOAD_PREFERENCES.map((pref: WorkloadPreference) => (
              <Chip
                key={pref}
                active={settings.workloadPreference === pref}
                onClick={() => set({ workloadPreference: pref })}
              >
                {pref} · {Math.round(WORKLOAD_UTILISATION[pref] * 100)}%
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-sm lk-muted">
            How much of the time left after the buffer LockIn is willing to fill. Nothing more
            mysterious than that.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Sessions and breaks" subtitle="How work is broken up." />
        <div className="flex flex-wrap gap-2">
          {FOCUS_PRESETS.map((preset) => (
            <Chip
              key={preset.focus}
              active={
                settings.focusBlockMinutes === preset.focus && settings.breakMinutes === preset.brk
              }
              onClick={() => set({ focusBlockMinutes: preset.focus, breakMinutes: preset.brk })}
            >
              {preset.focus} / {preset.brk}
            </Chip>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Shortest session" hint="Minutes. Stops the plan filling up with fragments.">
            <TextInput
              type="number"
              min={5}
              max={60}
              value={settings.minChunkMinutes}
              onChange={(e) => set({ minChunkMinutes: Number(e.target.value) || 5 })}
            />
          </Field>
          <Field label="Longest session" hint="Minutes. Long work is split across days instead.">
            <TextInput
              type="number"
              min={settings.minChunkMinutes}
              max={120}
              value={settings.maxChunkMinutes}
              onChange={(e) => set({ maxChunkMinutes: Number(e.target.value) || 45 })}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field
            label="Finish assignments this many hours before they are due"
            hint="Nothing is scheduled in the last hours before a deadline."
          >
            <TextInput
              type="number"
              min={0}
              max={48}
              value={settings.deadlineBufferHours}
              onChange={(e) => set({ deadlineBufferHours: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Days to plan ahead" hint="How far the week view and warnings look.">
            <TextInput
              type="number"
              min={1}
              max={60}
              value={settings.horizonDays}
              onChange={(e) => set({ horizonDays: Number(e.target.value) || 14 })}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Estimate correction"
          subtitle="Based only on assignments you have actually finished."
        />
        <Toggle
          checked={settings.useAdjustedEstimates}
          onChange={(v) => set({ useAdjustedEstimates: v })}
          label="Use adjusted estimates for planning"
          description="Needs at least three finished assignments in a subject. The adjustment is capped between 0.5× and 2×, and uses the median so one strange session cannot move it."
        />

        {suggestions.length > 0 && (
          <div className="mt-4 space-y-2">
            {suggestions.map((factor) => (
              <div
                key={factor.subject}
                className="lk-sunken flex flex-wrap items-center justify-between gap-3 rounded-xl border lk-border p-3"
              >
                <p className="text-sm lk-strong">
                  Your <strong>{factor.subject}</strong> assignments usually take about{' '}
                  {Math.round(Math.abs(factor.factor - 1) * 100)}%{' '}
                  {factor.factor > 1 ? 'longer' : 'less time'} than your estimates.
                  <span className="lk-muted"> ({factor.samples} finished assignments)</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      dispatch({ type: 'PLANNER_ACCEPT_FACTOR', subject: factor.subject })
                    }
                  >
                    Use it
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {state.planner.acceptedSubjectFactors.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold lk-muted">Applied:</span>
            {state.planner.acceptedSubjectFactors.map((subject) => (
              <Badge key={subject} tone="brand">
                {subject}
                <button
                  type="button"
                  aria-label={`Stop adjusting ${subject}`}
                  className="ml-1 font-bold"
                  onClick={() => dispatch({ type: 'PLANNER_REJECT_FACTOR', subject })}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="What the planner can’t know" />
        <ul className="space-y-1">
          {PLANNER_LIMITATIONS.map((line) => (
            <li key={line} className="text-sm lk-muted">
              • {line}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm lk-muted">
          It plans from due dates, your estimates, your availability and the time you have actually
          logged, and recalculates whenever any of those change. Reminders still only fire while a
          LockIn tab is open — there is no server and no background push.
        </p>
        <p className="mt-2 text-sm lk-muted">
          Today’s plan is worth {formatMinutes(
            state.planner.plan?.days[0]?.plannedMinutes ?? 0,
          )}{' '}
          of work.
        </p>
      </Card>
    </div>
  );
}
