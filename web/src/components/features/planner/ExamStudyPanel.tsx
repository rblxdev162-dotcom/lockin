/**
 * Exam study: how much is recommended, how much is planned, how much is done.
 *
 * The three numbers are kept apart on purpose. "120 of 180 minutes planned,
 * 75 completed" is a fact; collapsing them into one percentage would hide
 * whether the gap is a scheduling problem or a doing problem.
 */
import { useApp } from '../../../store/context';
import { Card, CardHeader, EmptyState } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Icon } from '../../ui/Icon';
import { ProgressBar } from '../../ui/Progress';
import { Field, TextInput } from '../../ui/Field';
import { selectExamProgress } from '../../../lib/planner';
import { MATERIAL_STUDY_MINUTES } from '../../../lib/planner/exams';
import { formatMinutes } from '../../../lib/planner/explanations';
import { daysUntil, formatDaysRemaining } from '../../../lib/time';

export function ExamStudyPanel() {
  const { state, dispatch, now } = useApp();
  const at = new Date(now);
  const exams = selectExamProgress(state, at);

  if (exams.length === 0) {
    return (
      <Card>
        <CardHeader title="Exam study" />
        <EmptyState
          icon={<Icon name="exam" size={26} />}
          title="No upcoming exams"
          hint="Add one and LockIn spreads its study across the days before it."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Exam study"
        subtitle="Study is spread across the days before each exam, ending with a short review."
      />
      <div className="space-y-3">
        {exams.map((exam) => {
          const days = daysUntil(exam.examDate, at);
          const source = state.exams.find((e) => e.id === exam.examId);
          const isDefault = !source?.studyEstimateMinutes;
          return (
            <div key={exam.examId} className="lk-sunken rounded-2xl border lk-border p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold lk-strong">{exam.name}</p>
                  <p className="text-xs lk-muted">
                    {exam.subject} · {source?.materialAmount ?? 'Medium'} material
                  </p>
                </div>
                <Badge tone={days !== null && days <= 3 ? 'flame' : 'brand'}>
                  {formatDaysRemaining(days)}
                </Badge>
              </div>

              <div className="mt-2.5">
                <ProgressBar
                  value={exam.completedMinutes}
                  max={Math.max(1, exam.estimateMinutes)}
                  tone={exam.completedMinutes >= exam.estimateMinutes ? 'mint' : 'brand'}
                />
                <p className="mt-1.5 text-xs lk-muted">
                  {formatMinutes(exam.plannedMinutes)} planned ·{' '}
                  {formatMinutes(exam.completedMinutes)} completed ·{' '}
                  {formatMinutes(exam.remainingMinutes)} left of{' '}
                  {formatMinutes(exam.estimateMinutes)} recommended
                </p>
              </div>

              <div className="mt-3">
                <Field
                  label="Study time to plan (minutes)"
                  hint={
                    isDefault
                      ? `Default for ${source?.materialAmount ?? 'Medium'} material (${
                          MATERIAL_STUDY_MINUTES[source?.materialAmount ?? 'Medium']
                        } min). A starting point, not a measurement — change it if you know better.`
                      : 'Your own estimate.'
                  }
                >
                  <TextInput
                    type="number"
                    min={0}
                    max={3000}
                    step={15}
                    aria-label={`Study minutes for ${exam.name}`}
                    value={exam.estimateMinutes}
                    onChange={(e) =>
                      dispatch({
                        type: 'UPDATE_EXAM',
                        id: exam.examId,
                        patch: { studyEstimateMinutes: Math.max(0, Number(e.target.value) || 0) },
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
