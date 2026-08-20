/**
 * The small pieces that carry meaning across every screen: pace status, where
 * a record came from, and how old that is.
 *
 * They live together because they share one rule — **never colour alone**.
 * Every status has a word, every source has a name, every timestamp has a
 * phrase. A student who cannot distinguish the green from the amber must lose
 * nothing, and so must a student looking at a screenshot in grayscale.
 */
import type { ReactNode } from 'react';
import type { PaceStatus } from '../../types/pace';
import type { DataState, SourceKind, SourceRecord } from '../../types/source';
import { SOURCE_DETAIL, SOURCE_LABEL, classify } from '../../lib/sources/freshness';
import { PACE_LABEL } from '../../lib/pace/engine';
import { cx } from '../../lib/cx';

/** Maps a status onto the token class that carries its colour. */
export const STATUS_CLASS: Record<PaceStatus, string> = {
  AHEAD: 'lk-status-ahead',
  ON_TRACK: 'lk-status-on_track',
  AT_RISK: 'lk-status-at_risk',
  BEHIND: 'lk-status-behind',
  UNKNOWN: 'lk-status-unknown',
};

/**
 * The pace pill.
 *
 * There is no "official" variant any more: with Canvas the only source, and a
 * calendar feed publishing no verdict of its own, every status on this badge is
 * LockIn's own reading. Saying so once here beats implying otherwise on every
 * screen.
 */
export function PaceBadge({
  status,
  size = 'md',
  className,
}: {
  status: PaceStatus;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      className={cx(
        STATUS_CLASS[status],
        'lk-status-chip inline-flex items-center gap-1.5 rounded-full font-bold',
        size === 'sm' ? 'px-2 py-0.5 text-[0.68rem]' : 'px-2.5 py-1 text-xs',
        className,
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'currentColor' }}
      />
      {PACE_LABEL[status]}
    </span>
  );
}

/** Sources that are worth naming on a dense row. MANUAL is not. */
const ROW_SOURCES: readonly SourceKind[] = ['CANVAS_CALENDAR', 'CANVAS_OAUTH'];

/**
 * A subtle source mark for a list row.
 *
 * Deliberately quiet — grey text, no border, no icon. On the Assignments page
 * there is one of these per row, and anything louder turns the list into a
 * legend. Freshness is *not* shown here; it belongs on the detail view, which
 * is where somebody is actually asking the question.
 */
export function SourceBadge({ source, className }: { source?: SourceRecord; className?: string }) {
  if (!source || !ROW_SOURCES.includes(source.kind)) return null;
  return (
    <span className={cx('text-caption font-semibold lk-muted', className)}>
      {SOURCE_LABEL[source.kind]}
    </span>
  );
}

const STATE_TONE: Record<DataState, string> = {
  LIVE: 'lk-status-ahead',
  SYNCED: 'lk-status-on_track',
  VERIFIED: 'lk-status-ahead',
  IMPORTED: 'lk-status-on_track',
  MANUAL: 'lk-status-unknown',
  STALE: 'lk-status-at_risk',
  UNAVAILABLE: 'lk-status-behind',
};

const STATE_WORD: Record<DataState, string> = {
  LIVE: 'Live',
  SYNCED: 'Synced',
  VERIFIED: 'Verified',
  IMPORTED: 'Imported',
  MANUAL: 'Added by you',
  STALE: 'Out of date',
  UNAVAILABLE: 'Not connected',
};

/**
 * Provenance with its age, for a detail view or an integration card.
 *
 * The state word and the age are always shown together. "Synced" on its own
 * invites the reader to assume "just now", which is the exact assumption the
 * whole source model exists to prevent.
 */
export function FreshnessBadge({
  source,
  now,
  showSource = true,
  className,
}: {
  source?: SourceRecord;
  now: number;
  showSource?: boolean;
  className?: string;
}) {
  const freshness = classify(source, now);
  return (
    <span
      className={cx(
        STATE_TONE[freshness.state],
        'inline-flex flex-wrap items-baseline gap-x-1.5 text-caption',
        className,
      )}
    >
      <span className="lk-status-text font-bold">{STATE_WORD[freshness.state]}</span>
      <span className="lk-muted">
        {showSource && source ? `${SOURCE_DETAIL[source.kind]} · ` : ''}
        {freshness.label}
      </span>
    </span>
  );
}

/** A section heading with an optional right-hand control. One shape everywhere. */
export function SectionHeader({
  title,
  hint,
  action,
  id,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <h2 id={id} className="text-heading font-bold lk-strong">
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-caption lk-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * A number with its label, for the Progress page.
 *
 * The number is the display size and the label is a caption, so the hierarchy
 * is doing the work rather than a border or a background.
 */
export function Metric({
  value,
  label,
  tone,
  sub,
}: {
  value: string;
  label: string;
  tone?: PaceStatus;
  sub?: string;
}) {
  return (
    <div className={cx('min-w-0', tone && STATUS_CLASS[tone])}>
      <p
        className={cx(
          'text-display font-extrabold tabular-nums',
          tone ? 'lk-status-text' : 'lk-strong',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-caption font-bold tracking-wide lk-muted uppercase">{label}</p>
      {sub && <p className="mt-1 text-caption lk-muted">{sub}</p>}
    </div>
  );
}
