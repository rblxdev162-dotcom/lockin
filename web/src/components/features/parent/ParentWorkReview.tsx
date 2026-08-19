/**
 * Recent work, the detail view behind each item, refused attempts, and exams.
 *
 * The wording here is load-bearing. A verification detail says what LockIn
 * observed — "a live photo appeared to show 47% course progress" — and never
 * what the student did, because those are different claims and only the first
 * one is supported by anything. Refusals are shown as "not accepted", never as
 * an accusation: OCR failing in bad light is by far the most likely cause.
 */
import { useState } from 'react';
import type { AppState } from '../../../types';
import { Card, CardHeader, EmptyState } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Chip } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import {
  PARENT_ASSIGNMENT_FILTERS,
  VERIFICATION_KIND_EXPLANATION,
  selectParentAssignmentSummary,
  selectParentExams,
  selectRecentVerifications,
  selectRefusedAttempts,
} from '../../../lib/parent/selectors';
import type {
  ParentAssignmentFilter,
  RecentVerification,
} from '../../../lib/parent/selectors';
import { formatDue } from '../../../lib/time';

const KIND_TONE = {
  canvas: 'brand',
  edgenuity_enhanced: 'mint',
  edgenuity_standard: 'brand',
  manual: 'neutral',
} as const;

export function ParentWorkReview({ state, now }: { state: AppState; now: Date }) {
  const recent = selectRecentVerifications(state, 12);
  const refused = selectRefusedAttempts(state, 12);
  const exams = selectParentExams(state, now);
  const [detail, setDetail] = useState<RecentVerification | null>(null);
  const [filter, setFilter] = useState<ParentAssignmentFilter>('all');
  const rows = selectParentAssignmentSummary(state, filter);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Recent work" subtitle="Completed assignments, newest first." />
        {recent.length === 0 ? (
          <EmptyState
            icon={<Icon name="check" size={26} />}
            title="Nothing completed yet"
            hint="Completed assignments and how they were verified will appear here."
          />
        ) : (
          <div className="space-y-2.5">
            {recent.map((entry) => (
              <button
                key={entry.assignmentId}
                type="button"
                onClick={() => setDetail(entry)}
                className="lk-sunken block w-full rounded-2xl border lk-border p-3.5 text-left transition-colors hover:border-brand-400"
              >
                <p className="text-xs font-bold tracking-wide text-brand-600 uppercase dark:text-brand-300">
                  {entry.subject}
                </p>
                <p className="mt-0.5 font-bold lk-strong">{entry.title}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONE[entry.kind]}>
                    {entry.label}
                    {entry.kind !== 'manual' ? ' ✓' : ''}
                  </Badge>
                  <span className="text-xs lk-muted">{formatTime(entry.completedAt)}</span>
                  {entry.progressBefore !== undefined && entry.progressAfter !== undefined && (
                    <span className="text-xs font-semibold lk-strong">
                      {entry.progressBefore}% → {entry.progressAfter}%
                    </span>
                  )}
                </div>
                {entry.attemptsBefore > 0 && (
                  <p className="mt-1.5 text-xs lk-muted">
                    {entry.attemptsBefore + 1} verification attempts before success
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Verification attempts not accepted"
          subtitle="Usually a photo that couldn’t be read — not evidence of anything else."
        />
        {refused.length === 0 ? (
          <p className="text-sm lk-muted">No refused verification attempts recorded.</p>
        ) : (
          <div className="space-y-2">
            {refused.map((attempt) => (
              <div
                key={`${attempt.at}-${attempt.reason}`}
                className="lk-sunken rounded-xl border lk-border px-3.5 py-2.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold lk-strong">
                    {attempt.title ?? 'Edgenuity verification'}
                  </p>
                  <span className="text-xs lk-muted">{formatTime(attempt.at)}</span>
                </div>
                <p className="mt-0.5 text-xs lk-muted">
                  Not accepted — {attempt.reason}
                  {attempt.repeats > 1 && ` · ${attempt.repeats} attempts in a row`}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs lk-muted">
          A refused attempt means the evidence didn’t meet the requirement. Glare, handwriting and
          a small window all cause this, so it is not by itself a sign of anything.
        </p>
      </Card>

      <Card>
        <CardHeader title="Assignments" subtitle={`${rows.length} shown`} />
        <div className="mb-4 flex flex-wrap gap-2">
          {PARENT_ASSIGNMENT_FILTERS.map((option) => (
            <Chip key={option} active={filter === option} onClick={() => setFilter(option)}>
              {FILTER_LABEL[option]}
            </Chip>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm lk-muted">Nothing matches this filter.</p>
        ) : (
          <div className="space-y-2">
            {rows.map(({ assignment, kind, requiredTrust, awaitingStrongerProof }) => (
              <div
                key={assignment.id}
                className="lk-sunken flex flex-wrap items-center justify-between gap-2 rounded-xl border lk-border px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold lk-strong">{assignment.title}</p>
                  <p className="truncate text-xs lk-muted">
                    {assignment.subject} · {formatDue(assignment.dueDate, assignment.dueTime)}
                  </p>
                  {awaitingStrongerProof && (
                    <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                      Progress detected — Enhanced verification still required
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {assignment.edgenuity && requiredTrust === 'enhanced' && (
                    <Badge tone="brand">Enhanced required</Badge>
                  )}
                  {kind ? (
                    <Badge tone={KIND_TONE[kind]}>{kind === 'manual' ? 'Manual' : 'Verified'}</Badge>
                  ) : (
                    <Badge tone="neutral">{assignment.status}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Upcoming exams" subtitle="From the student’s own exam list." />
        {exams.length === 0 ? (
          <p className="text-sm lk-muted">No upcoming exams.</p>
        ) : (
          <div className="space-y-2">
            {exams.map(({ exam, daysAway, studySessions }) => (
              <div
                key={exam.id}
                className="lk-sunken flex items-center justify-between gap-3 rounded-xl border lk-border px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold lk-strong">{exam.name}</p>
                  <p className="text-xs lk-muted">
                    {exam.subject} · {studySessions} focus session
                    {studySessions === 1 ? '' : 's'} on this subject this week
                  </p>
                </div>
                <Badge tone={daysAway <= 2 ? 'flame' : 'neutral'}>
                  {daysAway === 0 ? 'Today' : `${daysAway} day${daysAway === 1 ? '' : 's'}`}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <VerificationDetail entry={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

const FILTER_LABEL: Record<ParentAssignmentFilter, string> = {
  all: 'All',
  completed: 'Completed',
  incomplete: 'Incomplete',
  canvas: 'Canvas verified',
  edgenuity_standard: 'Edgenuity Standard',
  edgenuity_enhanced: 'Edgenuity Enhanced',
  manual: 'Manual',
};

function VerificationDetail({
  entry,
  onClose,
}: {
  entry: RecentVerification | null;
  onClose: () => void;
}) {
  if (!entry) return null;
  const evidence = entry.record?.evidence ?? {};
  const isEdgenuity = entry.kind.startsWith('edgenuity');

  return (
    <Modal open title="Verification details" subtitle={entry.title} onClose={onClose}>
      <dl className="space-y-2.5 text-sm">
        <Row label="Subject" value={entry.subject} />
        <Row label="Verification" value={entry.label} />
        <Row label="Completed" value={new Date(entry.completedAt).toLocaleString()} />

        {entry.canvasStatus && <Row label="Status detected" value={entry.canvasStatus} />}

        {isEdgenuity && entry.progressBefore !== undefined && (
          <>
            <Row label="Progress" value={`${entry.progressBefore}% → ${entry.progressAfter}%`} />
            {evidence.progressDelta !== undefined && (
              <Row label="Verified gain" value={`+${String(evidence.progressDelta)}%`} />
            )}
            <Row
              label="Before challenge"
              value={
                entry.trust === 'enhanced'
                  ? evidence.challengeBeforeVerified
                    ? 'Verified ✓'
                    : 'Not verified'
                  : 'Not required'
              }
            />
            <Row
              label="After challenge"
              value={
                entry.trust === 'enhanced'
                  ? evidence.challengeAfterVerified
                    ? 'Verified ✓'
                    : 'Not verified'
                  : 'Not required'
              }
            />
            <Row
              label="Screen confidence"
              value={capitalise(String(evidence.screenConfidence ?? 'low'))}
            />
          </>
        )}
        <Row label="Photos stored" value="No" />
        <Row label="OCR text stored" value="No" />
      </dl>

      <p className="mt-4 rounded-xl border lk-border p-3 text-xs lk-muted">
        {isEdgenuity
          ? `A live photo appeared to show ${entry.subject} at ${entry.progressAfter ?? '—'}% course progress. ${VERIFICATION_KIND_EXPLANATION[entry.kind]}`
          : VERIFICATION_KIND_EXPLANATION[entry.kind]}
      </p>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b lk-border pb-2">
      <dt className="text-xs font-semibold lk-muted">{label}</dt>
      <dd className="text-right font-semibold lk-strong">{value}</dd>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
