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
