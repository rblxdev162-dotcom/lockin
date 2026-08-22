import type { CanvasLink } from '../../types';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { canvasStatusLabel, canvasStatusTone } from '../../lib/canvas/verification';
import { relativeTime } from '../../lib/time';

/**
 * The Canvas status line on an assignment card.
 * Shows what Canvas said and when — "Verified 2 min ago" only appears for
 * statuses that actually count as verification.
 */
export function CanvasStatusBadge({
  link,
  showVerifiedAt = true,
}: {
  link: CanvasLink;
  showVerifiedAt?: boolean;
}) {
  const tone = canvasStatusTone(link.submissionStatus);
  const verifiedAt =
    tone === 'mint' && link.lastStatusChangeAt ? relativeTime(link.lastStatusChangeAt) : null;

  /**
   * Work Canvas can never show a submission for.
   *
   * Until it is graded, Canvas says "Missing" or shows nothing at all — which
   * is a statement about Canvas, not about whether the student handed the
   * paper to their teacher. Repeating it as a status was the app calling
   * finished work undone, so the badge says what is actually true instead: no
   * online submission exists, and none is expected.
   */
  const handIn = link.submissionType === 'on_paper' || link.submissionType === 'none';
  if (handIn && link.submissionStatus !== 'graded') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">
          <Icon name="canvas" size={12} />
          {link.submissionType === 'on_paper' ? 'Handed in on paper' : 'No submission needed'}
        </Badge>
        <span className="text-xs lk-muted">
          {link.submissionType === 'on_paper'
            ? 'Canvas has nothing to show until your teacher grades it.'
            : 'Canvas expects nothing to be handed in for this one.'}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={tone}>
        <Icon name="canvas" size={12} />
        {canvasStatusLabel(link.submissionStatus).replace('Canvas · ', '')}
      </Badge>
      {showVerifiedAt && verifiedAt && (
        <span className="text-xs lk-muted">Verified by Canvas {verifiedAt}</span>
      )}
      {link.submissionStatus === 'verification_unavailable' && (
        <span className="text-xs lk-muted">LockIn couldn’t read a reliable status</span>
      )}
    </span>
  );
}
