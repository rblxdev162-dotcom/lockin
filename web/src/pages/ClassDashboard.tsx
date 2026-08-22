import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store/context';
import { Card, CardHeader, EmptyState } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { classStyle, SCHOOL_DAYS } from '../lib/schoolSchedule';
import { classSwitchLabel } from '../lib/classNames';
import { formatScore, hasPublishedTotal } from '../types/grades';
import { readGradeHistory } from '../lib/localExperience';
import { whatToDoNext, workStateOf, WORK_STATE_LABEL, WORK_STATE_TONE } from '../lib/workState';
import { cx } from '../lib/cx';
import { ClassWorkspace } from '../components/features/ClassWorkspace';

export function ClassDashboard() {
  const { subject: raw = '' } = useParams();
  const navigate = useNavigate();
  const subject = decodeURIComponent(raw);
  const { state, now } = useApp();
  const assignments = useMemo(
    () => state.assignments.filter((item) => item.subject === subject),
    [state.assignments, subject],
  );
  const open = useMemo(() => whatToDoNext(assignments, now), [assignments, now]);
  const style = classStyle(state.settings.schoolSchedule, subject);
  const grade = state.grades.courses.find((item) =>
    assignments.some((assignment) => assignment.externalCourseId === item.externalCourseId) ||
    item.courseName?.toLowerCase() === subject.toLowerCase(),
  );
  const gradeHistory = grade ? readGradeHistory(grade.externalCourseId) : [];
  const assignmentIds = new Set(assignments.map((item) => item.id));
  const studyMinutes = state.completedSessions
    .filter((session) => session.assignmentId && assignmentIds.has(session.assignmentId))
    .reduce((sum, session) => sum + session.actualMinutes, 0);
  const exams = state.exams.filter((exam) => exam.subject.toLowerCase() === subject.toLowerCase());
  const teacherLabel = classSwitchLabel(subject);
  const recentChanges = state.activity.filter((event) =>
    (event.type === 'feed_assignment_updated' || event.type === 'feed_assignment_cancelled') &&
    event.message.toLowerCase().includes(subject.toLowerCase()),
  ).slice(0, 4);

  return (
    <div className={cx('space-y-5 lk-class-page', `lk-class-theme-${style?.color ?? 'brand'}`)}>
      <header className="lk-class-hero relative overflow-hidden rounded-[1.5rem] border lk-border p-5 sm:p-7">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link to="/home" className="text-caption font-bold lk-muted hover:underline">← Home</Link>
            <div className="mt-4 flex items-center gap-3">
              <span className="lk-class-icon grid h-12 w-12 place-items-center rounded-2xl text-lg font-black text-white">
                {style?.icon ?? subject.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <p className="text-caption font-bold tracking-[0.16em] text-white/70 uppercase">Class dashboard</p>
                <h1 className="text-title font-extrabold text-white">{subject}</h1>
              </div>
            </div>
          </div>
          <Button variant="secondary" onClick={() => navigate(`/assignments?class=${encodeURIComponent(subject)}`)}>
            Open assignments
          </Button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Class summary">
        <Metric label="Open work" value={String(open.length)} />
        <Metric label="Current grade" value={grade && hasPublishedTotal(grade) ? (grade.currentScore !== null ? formatScore(grade.currentScore) : grade.currentGrade ?? '—') : 'Hidden'} />
        <Metric label="Study time" value={`${studyMinutes}m`} />
        <Metric label="Meeting days" value={style?.days.length ? style.days.map((day) => SCHOOL_DAYS.find((item) => item.id === day)?.short).join(' · ') : 'Not set'} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_.85fr]">
        <Card>
          <CardHeader title="Assignments" subtitle={open.length ? 'The next work for this class, in deadline order.' : 'This class is clear.'} />
          {open.length === 0 ? (
            <EmptyState icon={<Icon name="check" size={28} />} title="Nothing open" hint="Completed work stays in the full assignment view." />
          ) : (
            <div className="space-y-2">
              {open.slice(0, 6).map((assignment) => {
                const workState = workStateOf(assignment, now);
                return <Link key={assignment.id} to={`/assignments?class=${encodeURIComponent(subject)}`} className="flex items-center gap-3 rounded-2xl border lk-border p-3 transition-transform hover:-translate-y-0.5">
                  <span className="lk-class-icon grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-black text-white">{style?.icon ?? subject.slice(0, 1)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-body font-extrabold lk-strong">{assignment.title}</span><span className="text-caption lk-muted">{assignment.estimatedMinutes - assignment.loggedMinutes} min remaining</span></span>
                  <Badge className={WORK_STATE_TONE[workState]}>{WORK_STATE_LABEL[workState]}</Badge>
                </Link>;
              })}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Class details" />
            <dl className="space-y-3 text-body">
              <Detail label="Teacher / section" value={teacherLabel === subject ? 'Not set' : teacherLabel} />
              <Detail label="Meeting days" value={style?.days.length ? style.days.map((day) => SCHOOL_DAYS.find((item) => item.id === day)?.label).join(', ') : 'Not set'} />
              <Detail label="Upcoming exams" value={exams.length ? exams.map((exam) => `${exam.name} · ${exam.examDate}`).join(', ') : 'None listed'} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Grade history" subtitle="Read locally from Canvas—never predicted." />
            <GradeLine points={gradeHistory} />
          </Card>
        </div>
      </div>

      {recentChanges.length > 0 && <Card><CardHeader title="Teacher changes" subtitle="Recent calendar updates for this class." /><div className="space-y-2">{recentChanges.map((event) => <p key={event.id} className="lk-deadline-move rounded-xl lk-sunken px-3 py-2 text-body font-semibold lk-strong">{event.message}</p>)}</div></Card>}
      <ClassWorkspace subject={subject} assignments={assignments} gradeHistory={gradeHistory} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="lk-card lk-metric p-4"><p className="text-display font-extrabold tabular-nums lk-strong">{value}</p><p className="text-caption font-bold lk-muted">{label}</p></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><dt className="font-semibold lk-muted">{label}</dt><dd className="text-right font-bold lk-strong">{value}</dd></div>;
}

function GradeLine({ points }: { points: { score: number; readAt: string }[] }) {
  if (points.length === 0) return <p className="text-body lk-muted">No grade readings recorded yet.</p>;
  const values = points.slice(-12);
  const min = Math.min(...values.map((point) => point.score), 0);
  const max = Math.max(...values.map((point) => point.score), 100);
  const coords = values.map((point, index) => `${values.length === 1 ? 50 : (index / (values.length - 1)) * 100},${100 - ((point.score - min) / Math.max(1, max - min)) * 80 - 10}`).join(' ');
  return <div><svg viewBox="0 0 100 100" className="h-28 w-full overflow-visible" role="img" aria-label={`Grade history, ${values.length} readings`}><defs><linearGradient id="grade-line" x1="0" x2="1"><stop stopColor="var(--color-brand-500)"/><stop offset="1" stopColor="var(--color-mint-500)"/></linearGradient></defs><polyline points={coords} fill="none" stroke="url(#grade-line)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="lk-grade-line"/>{values.map((point, index) => { const [x, y] = coords.split(' ')[index].split(','); return <circle key={`${point.readAt}-${index}`} cx={x} cy={y} r="2.4" fill="var(--surface-raised)" stroke="var(--color-brand-500)" strokeWidth="1.8"><title>{formatScore(point.score)} · {new Date(point.readAt).toLocaleDateString()}</title></circle>; })}</svg><p className="text-caption lk-muted">Latest: <strong className="lk-strong">{formatScore(values.at(-1)?.score ?? null)}</strong> · {values.length} local reading{values.length === 1 ? '' : 's'}</p></div>;
}
