/**
 * Export, the privacy statement, and the destructive controls.
 *
 * The privacy panel is not marketing copy — it is a list of things that are
 * true because the code cannot do otherwise. Photos are released after OCR,
 * raw text is discarded after parsing, the extension only ever reports
 * per-domain counts, and there is no network code in either half of the
 * project. Each line below corresponds to a decision made in an earlier phase.
 */
import { useState } from 'react';
import type { AppState } from '../../../types';
import { Card, CardHeader } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { ConfirmDialog } from '../../ui/Modal';
import { toast } from '../../ui/Toast';
import { useApp } from '../../../store/context';
import { todayISO } from '../../../lib/time';
import { buildWeeklyCsv, buildWeeklyExport, selectWeeklySummary } from '../../../lib/parent/selectors';

type Destructive = 'verification' | 'activity' | 'focus' | null;

export function ParentDataPanel({ state, now }: { state: AppState; now: Date }) {
  const { dispatch } = useApp();
  const [confirm, setConfirm] = useState<Destructive>(null);
  const summary = selectWeeklySummary(state, now);

  const download = (filename: string, contents: string, type: string) => {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    // Revoking immediately would race the download in Safari; a tick is enough.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // The student's own date, not UTC's: an export made at 6pm in the Americas
  // was being filed under tomorrow.
  const stamp = todayISO(new Date(now));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Weekly summary"
          subtitle="A printable, factual recap of the last seven days."
        />
        <div className="lk-sunken rounded-2xl border lk-border p-4">
          <p className="text-xs font-bold tracking-wide lk-muted uppercase">
            Week of {formatDay(summary.from)} – {formatDay(summary.to)}
          </p>
          <ul className="mt-2 space-y-1 text-sm lk-strong">
            <li>{summary.assignmentsCompleted} assignments completed</li>
            <li>{summary.verifiedCompletions} verified · {summary.manualCompletions} manual</li>
            <li>
              {Math.floor(summary.focusMinutes / 60)}h {summary.focusMinutes % 60}m focused across{' '}
              {summary.focusSessions} session{summary.focusSessions === 1 ? '' : 's'}
            </li>
            <li>
              {summary.parentOverrides} override{summary.parentOverrides === 1 ? '' : 's'} ·{' '}
              {summary.emergencyExits} emergency exit{summary.emergencyExits === 1 ? '' : 's'}
            </li>
          </ul>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<Icon name="external" size={15} />}
            onClick={() => {
              download(
                `lockin-week-${stamp}.json`,
                JSON.stringify(buildWeeklyExport(state, now), null, 2),
                'application/json',
              );
              toast('Weekly summary saved to your downloads.', 'success');
            }}
          >
            Export JSON
          </Button>
          <Button
            variant="secondary"
            icon={<Icon name="external" size={15} />}
            onClick={() => {
              download(`lockin-week-${stamp}.csv`, buildWeeklyCsv(state), 'text/csv');
              toast('Weekly summary saved to your downloads.', 'success');
            }}
          >
            Export CSV
          </Button>
          <Button variant="secondary" icon={<Icon name="list" size={15} />} onClick={() => window.print()}>
            Print
          </Button>
        </div>
        <p className="mt-3 text-xs lk-muted">
          Exports are built field by field from an allowlist, so they cannot pick up photos, OCR
          text, verification codes, PIN data or browsing history. The file is written to this
          device — nothing is uploaded.
        </p>
      </Card>

      <Card>
        <CardHeader title="Privacy" subtitle="What this dashboard can and cannot show." />
        <ul className="space-y-2 text-sm">
          {[
            'Everything is stored locally on this device.',
            'Edgenuity photos are never retained — they are read and released.',
            'Raw OCR text is never retained.',
            'Full browsing history is never recorded; only per-domain block counts.',
            'Verification codes are discarded once used.',
            'No data is sent to parents remotely, and there is no server to send it to.',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-mint-500" />
              <span className="lk-strong">{line}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-xl border lk-border p-3 text-xs lk-muted">
          <p className="font-bold lk-strong">What the PIN actually does</p>
          <p className="mt-1">
            It keeps this dashboard and the protected settings behind a deliberate step, and every
            override is recorded. It is not a security boundary against someone who controls this
            browser: anyone who can open developer tools or edit local storage can change what is
            stored here. LockIn does not pretend otherwise, and it does not try to detect or block
            developer tools.
          </p>
        </div>
      </Card>

      <Card className="border-flame-500/40">
        <CardHeader
          title="Delete accountability history"
          subtitle="Assignments, exams and the parent PIN are never touched by these."
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" size="sm" onClick={() => setConfirm('verification')}>
            Clear verification history
          </Button>
          <Button variant="danger" size="sm" onClick={() => setConfirm('activity')}>
            Clear activity history
          </Button>
          <Button variant="danger" size="sm" onClick={() => setConfirm('focus')}>
            Clear focus history
          </Button>
        </div>
        <p className="mt-3 text-xs lk-muted">
          Clearing verification history removes the evidence records behind completed work; the
          assignments themselves stay completed. To erase everything including schoolwork, use
          Settings → Reset in Student View.
        </p>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        danger
        title={
          confirm === 'verification'
            ? 'Clear verification history?'
            : confirm === 'activity'
              ? 'Clear activity history?'
              : 'Clear focus history?'
        }
        message={
          confirm === 'verification'
            ? 'Every verification record, Edgenuity session and challenge is deleted. Assignments stay exactly as they are, including their completed status. This cannot be undone.'
            : confirm === 'activity'
              ? 'The whole event log is deleted, including overrides and emergency exits. Assignments and verification records stay. This cannot be undone.'
              : 'Focus Mode run history and completed session records are deleted. Assignments stay. This cannot be undone.'
        }
        confirmLabel="Delete"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) dispatch({ type: 'PARENT_CLEAR_HISTORY', scope: confirm });
          setConfirm(null);
          toast('History cleared.', 'info');
        }}
      />
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
