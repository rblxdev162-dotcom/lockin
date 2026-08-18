/**
 * "Found in Canvas" — the import review screen.
 *
 * Nothing is imported without a click. `Import All` exists, but it still
 * requires that click; LockIn never silently dumps a semester of work in.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../../store/context';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';
import type { CanvasDetectedAssignment } from '../../types';
import { canvasKey } from '../../types/canvas';
import { importCandidates, partitionCandidates } from '../../lib/selectors';
import { canvasStatusLabel, canvasStatusTone } from '../../lib/canvas/verification';
import { formatDue } from '../../lib/time';
import { splitIsoToLocal } from '../../lib/time';

export function CanvasImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [showOlder, setShowOlder] = useState(false);

  const domain = state.canvas.connection?.domain ?? '';
  const candidates = useMemo(() => importCandidates(state), [state]);
  const { priority, older } = useMemo(() => partitionCandidates(candidates), [candidates]);

  const visible = showOlder ? [...priority, ...older] : priority;

  const importItems = (items: CanvasDetectedAssignment[]) => {
    if (items.length === 0) return;
    dispatch({ type: 'CANVAS_IMPORT', items });
    toast(
      items.length === 1
        ? `Imported “${items[0].title}”.`
        : `Imported ${items.length} assignments from Canvas.`,
      'success',
    );
  };

  return (
    <Modal
      open={open}
      title="Found in Canvas"
      subtitle={
        candidates.length === 0
          ? 'Nothing new detected yet.'
          : `${candidates.length} assignment${candidates.length === 1 ? '' : 's'} LockIn can import.`
      }
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {visible.length > 0 && (
            <Button onClick={() => importItems(visible)}>Import All ({visible.length})</Button>
          )}
        </>
      }
    >
      {candidates.length === 0 ? (
        <div className="rounded-2xl border border-dashed lk-border p-6 text-center">
          <Icon name="canvas" size={26} className="mx-auto mb-2 lk-muted" />
          <p className="text-sm font-semibold lk-strong">Nothing to import</p>
          <p className="mt-1 text-sm lk-muted">
            Open Canvas in Chrome and press Sync Canvas. Anything already imported won’t appear
            here again.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((item) => (
            <CandidateRow
              key={canvasKey(domain, item.externalCourseId, item.externalAssignmentId)}
              item={item}
              onImport={() => importItems([item])}
              onIgnore={() =>
                dispatch({
                  type: 'CANVAS_IGNORE',
                  key: canvasKey(domain, item.externalCourseId, item.externalAssignmentId),
                })
              }
            />
          ))}

          {older.length > 0 && !showOlder && (
            <button
              onClick={() => setShowOlder(true)}
              className="w-full rounded-xl border border-dashed lk-border py-2.5 text-sm font-semibold lk-muted transition-colors hover:lk-strong"
            >
              Show older assignments ({older.length})
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

function CandidateRow({
  item,
  onImport,
  onIgnore,
}: {
  item: CanvasDetectedAssignment;
  onImport: () => void;
  onIgnore: () => void;
}) {
  const due = item.dueAt ? splitIsoToLocal(item.dueAt) : null;
  const tone = canvasStatusTone(item.submissionStatus);

  return (
    <div className="lk-sunken flex flex-wrap items-start justify-between gap-3 rounded-2xl border lk-border p-3.5">
      <div className="min-w-0 flex-1">
        {item.courseName && (
          <p className="text-xs font-bold tracking-wide text-brand-600 uppercase dark:text-brand-300">
            {item.courseName}
          </p>
        )}
        <p className="mt-0.5 font-bold lk-strong">{item.title}</p>
        <p className="mt-0.5 text-xs lk-muted">
          {due ? formatDue(due.date, due.time) : 'No due date'}
          {item.pointsPossible !== undefined && ` · ${item.pointsPossible} pts`}
          {item.kind === 'quiz' && ' · Quiz'}
        </p>
        <div className="mt-2">
          <Badge tone={tone}>{canvasStatusLabel(item.submissionStatus).replace('Canvas · ', '')}</Badge>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" onClick={onIgnore}>
          Ignore
        </Button>
        <Button size="sm" onClick={onImport}>
          Import
        </Button>
      </div>
    </div>
  );
}
