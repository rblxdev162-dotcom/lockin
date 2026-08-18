/**
 * The trust badge, and the detail panel behind it.
 *
 * Wording is the entire point of this file. "Enhanced Verified" says the
 * evidence cleared the higher bar; it does not say the work is proven, and
 * nothing here is allowed to drift into "tamper proof", "cheat proof" or
 * "100% verified". The detail view is where the honest caveat lives, in full.
 */
import { useState } from 'react';
import type { Assignment, VerificationTrust } from '../../types';
import { TRUST_LABEL } from '../../types/edgenuity';
import { trustOfRecord } from '../../lib/edgenuity/verification';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { cx } from '../../lib/cx';

const TONE: Record<VerificationTrust, 'mint' | 'brand' | 'neutral'> = {
  manual: 'neutral',
  standard: 'brand',
  browser: 'brand',
  enhanced: 'mint',
};

export function VerificationTrustBadge({
  trust,
  onClick,
}: {
  trust: VerificationTrust;
  onClick?: () => void;
}) {
  const badge = (
    <Badge tone={TONE[trust]}>
      {trust === 'enhanced' && <Icon name="badge" size={11} className="mr-1 inline-block" />}
      {TRUST_LABEL[trust]}
    </Badge>
  );
  if (!onClick) return badge;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full transition-transform active:scale-95"
      aria-label={`${TRUST_LABEL[trust]} — show verification details`}
    >
      {badge}
    </button>
  );
}

/** The badge plus the "what does this actually mean" dialog. */
export function EdgenuityVerificationSummary({ assignment }: { assignment: Assignment }) {
  const [open, setOpen] = useState(false);
  const record = [...assignment.verificationRecords]
    .reverse()
    .find((r) => r.type === 'edgenuity_photo');
  if (!record) return null;

  const trust = trustOfRecord(record);

  return (
    <>
      <VerificationTrustBadge trust={trust} onClick={() => setOpen(true)} />
      <Modal
        open={open}
        title={trust === 'enhanced' ? 'Enhanced verification' : 'Standard verification'}
        subtitle="What LockIn recorded for this assignment"
        onClose={() => setOpen(false)}
      >
        <dl className="space-y-3 text-sm">
          <Row label="Course" value={String(record.evidence?.courseName || assignment.subject)} />
          {record.progressBefore !== undefined && record.progressAfter !== undefined && (
            <Row label="Progress" value={`${record.progressBefore}% → ${record.progressAfter}%`} />
          )}
          {record.evidence?.progressDelta !== undefined && (
            <Row label="Verified this session" value={`+${record.evidence.progressDelta}%`} />
          )}
          <Row
            label="Challenge"
            value={
              trust === 'enhanced' ? (
                <span className="space-x-3">
                  <span>Before {record.evidence?.challengeBeforeVerified ? '✓' : '—'}</span>
                  <span>After {record.evidence?.challengeAfterVerified ? '✓' : '—'}</span>
                </span>
              ) : (
                'Not required'
              )
            }
          />
          <Row
            label="Screen evidence"
            value={`${String(record.evidence?.screenConfidence ?? 'low')} · ${String(
              record.evidence?.screenSignals ?? 0,
            )} signals matched`}
          />
          <Row label="Verified" value={new Date(record.timestamp).toLocaleString()} />
          <Row label="Photos retained" value="No" />
        </dl>

        <p className="mt-4 rounded-xl border lk-border p-3 text-xs lk-muted">
          {trust === 'enhanced'
            ? 'A live photo showed this progress alongside a one-time code issued minutes earlier, for both the starting and the final capture. That makes a previously prepared photo much harder to reuse. It does not establish who took the photo, and it does not prove the Edgenuity screen itself was genuine.'
            : 'A live photo showed this progress. No one-time code was required, so a previously prepared image is harder to rule out. It does not prove the Edgenuity screen itself was genuine.'}
        </p>
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4 border-b lk-border pb-2')}>
      <dt className="text-xs font-semibold lk-muted">{label}</dt>
      <dd className="text-right font-semibold lk-strong">{value}</dd>
    </div>
  );
}
