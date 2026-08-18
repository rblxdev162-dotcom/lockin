/**
 * "Link to Canvas Assignment".
 *
 * Suggestions are deterministic heuristics (title overlap, same due date,
 * similar course) and are only ever *offered*. An uncertain match is never
 * linked automatically — the student picks.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../../store/context';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { TextInput } from '../ui/Field';
import { toast } from '../ui/Toast';
import type { Assignment, CanvasDetectedAssignment } from '../../types';
import { canvasKey } from '../../types/canvas';
import { importCandidates } from '../../lib/selectors';
import { suggestMatches, titleSimilarity } from '../../lib/canvas/matching';
import { canvasStatusLabel, canvasStatusTone } from '../../lib/canvas/verification';
import { formatDue, splitIsoToLocal } from '../../lib/time';
import { cx } from '../../lib/cx';

export function CanvasLinkModal({
  open,
  assignment,
  onClose,
}: {
  open: boolean;
  assignment: Assignment | null;
  onClose: () => void;
}) {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');

  const domain = state.canvas.connection?.domain ?? '';
  const candidates = useMemo(() => importCandidates(state), [state]);

  /**
   * Rank detected Canvas assignments against the LockIn assignment being
   * linked. Reuses the same scoring as suggestMatches, inverted.
   */
  const ranked = useMemo(() => {
    if (!assignment) return [];
    const scored = candidates.map((detected) => {
      const [suggestion] = suggestMatches([assignment], detected, 1);
      return {
        detected,
        score: suggestion?.score ?? titleSimilarity(assignment.title, detected.title) * 0.6,
        reasons: suggestion?.reasons ?? [],
      };
    });
    const filtered = query.trim()
      ? scored.filter((s) =>
          `${s.detected.title} ${s.detected.courseName ?? ''}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
      : scored;
    return filtered.sort(
      (a, b) => b.score - a.score || a.detected.title.localeCompare(b.detected.title),
    );
  }, [assignment, candidates, query]);

  if (!assignment) return null;

  return (
    <Modal
      open={open}
      title="Link to Canvas Assignment"
      subtitle={`Connect “${assignment.title}” to the matching assignment in Canvas.`}
      onClose={onClose}
      wide
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {candidates.length === 0 ? (
        <div className="rounded-2xl border border-dashed lk-border p-6 text-center text-sm lk-muted">
          No unlinked Canvas assignments detected yet. Open Canvas in Chrome and press
          <strong className="lk-strong"> Sync Canvas</strong>.
        </div>
      ) : (
        <div className="space-y-3">
          <TextInput
            value={query}
            placeholder="Search detected Canvas assignments…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {ranked.map(({ detected, score, reasons }) => (
              <CandidateRow
                key={canvasKey(domain, detected.externalCourseId, detected.externalAssignmentId)}
                detected={detected}
                score={score}
                reasons={reasons}
                onLink={() => {
                  dispatch({ type: 'CANVAS_LINK', assignmentId: assignment.id, detected });
                  toast(`Linked to “${detected.title}”.`, 'success');
                  onClose();
                }}
              />
            ))}
            {ranked.length === 0 && (
              <p className="py-4 text-center text-sm lk-muted">Nothing matches that search.</p>
            )}
          </div>
          <p className="text-xs lk-muted">
            LockIn suggests matches but never links automatically — pick the right one.
          </p>
        </div>
      )}
    </Modal>
  );
}

function CandidateRow({
  detected,
  score,
  reasons,
  onLink,
}: {
  detected: CanvasDetectedAssignment;
  score: number;
  reasons: string[];
  onLink: () => void;
}) {
  const due = detected.dueAt ? splitIsoToLocal(detected.dueAt) : null;
  const likely = score >= 0.65;

  return (
    <div
      className={cx(
        'flex flex-wrap items-start justify-between gap-3 rounded-2xl border p-3.5',
        likely ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/25' : 'lk-border lk-sunken',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {detected.courseName && (
            <span className="text-xs font-bold tracking-wide text-brand-600 uppercase dark:text-brand-300">
              {detected.courseName}
            </span>
          )}
          {likely && <Badge tone="brand">Likely match</Badge>}
        </div>
        <p className="mt-0.5 font-bold lk-strong">{detected.title}</p>
        <p className="mt-0.5 text-xs lk-muted">
          {due ? formatDue(due.date, due.time) : 'No due date'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone={canvasStatusTone(detected.submissionStatus)}>
            {canvasStatusLabel(detected.submissionStatus).replace('Canvas · ', '')}
          </Badge>
          {reasons.map((r) => (
            <span key={r} className="text-xs lk-muted">
              {r}
            </span>
          ))}
        </div>
      </div>
      <Button size="sm" icon={<Icon name="link" size={14} />} onClick={onLink}>
        Link
      </Button>
    </div>
  );
}
