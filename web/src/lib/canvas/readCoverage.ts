import type { CanvasReadCoverage } from '../../types/canvas';

export interface CanvasReadSignal {
  ok?: boolean;
  reason?: string;
  pageKind?: string;
  readGrades?: boolean;
  gradebookAnswered?: boolean;
  readableTabs?: number;
  rowsSeen?: number;
  rowsRead?: number;
}

export interface CanvasReadAssessment {
  coverage: CanvasReadCoverage;
  label: string;
  detail: string;
}

/**
 * Describes only what the current press proved.
 *
 * Cached assignments are deliberately absent from the inputs. A previous read
 * may have filled the cache, but it cannot make today's broken parser look
 * healthy. This is presentation and diagnostics only; it never participates in
 * verification or completion.
 */
export function assessCanvasRead(signal: CanvasReadSignal | null | undefined): CanvasReadAssessment {
  if (!signal) {
    return {
      coverage: 'unreadable',
      label: 'No page read',
      detail: 'The Canvas reader did not return a result.',
    };
  }

  if (
    signal.ok === false ||
    signal.reason === 'page-unreadable' ||
    signal.readableTabs === 0 ||
    (signal.gradebookAnswered === true && signal.readGrades !== true)
  ) {
    return {
      coverage: 'unreadable',
      label: 'Layout not read',
      detail:
        'Canvas answered, but LockIn could not reliably read the rendered gradebook. Existing data was not treated as a fresh result.',
    };
  }

  if (signal.pageKind === 'grades_all') {
    return {
      coverage: 'totals_only',
      label: 'Class totals only',
      detail: 'The all-classes page carries course totals, not assignment submission states.',
    };
  }

  if (signal.pageKind === 'grades' && signal.readGrades) {
    const rowsSeen = Math.max(0, signal.rowsSeen ?? 0);
    const rowsRead = Math.max(0, signal.rowsRead ?? 0);
    if (rowsSeen > 0 && rowsRead === 0) {
      return {
        coverage: 'unreadable',
        label: 'Rows not recognized',
        detail: `Canvas rendered ${rowsSeen} candidate row${rowsSeen === 1 ? '' : 's'}, but none produced a trustworthy assignment record.`,
      };
    }
    return {
      coverage: 'gradebook',
      label: 'Assignment gradebook read',
      detail:
        rowsRead > 0
          ? `${rowsRead} assignment row${rowsRead === 1 ? '' : 's'} produced trustworthy structured data.`
          : 'The class gradebook responded and its structured data was readable.',
    };
  }

  return {
    coverage: 'limited',
    label: 'Limited Canvas page',
    detail: 'The page was readable, but it does not carry class assignment scores and statuses.',
  };
}

export function datesOnlyAssessment(): CanvasReadAssessment {
  return {
    coverage: 'dates_only',
    label: 'Dates only',
    detail: 'The calendar feed updated titles and due dates; no rendered gradebook was read.',
  };
}

export function describeStoredCoverage(
  coverage: CanvasReadCoverage | undefined,
  rowsRead = 0,
): CanvasReadAssessment | null {
  switch (coverage) {
    case 'gradebook':
      return {
        coverage,
        label: 'Gradebook read',
        detail:
          rowsRead > 0
            ? `${rowsRead} assignment row${rowsRead === 1 ? '' : 's'} produced trustworthy structured data.`
            : 'The rendered class gradebook produced trustworthy structured data.',
      };
    case 'totals_only':
      return {
        coverage,
        label: 'Class totals only',
        detail: 'This page carries course totals, not individual submission states.',
      };
    case 'limited':
      return {
        coverage,
        label: 'Limited page',
        detail: 'Canvas was readable, but this page does not carry assignment scores and statuses.',
      };
    case 'unreadable':
      return {
        coverage,
        label: 'Layout not read',
        detail: 'Canvas answered, but LockIn could not read the rendered structure reliably.',
      };
    case 'dates_only':
      return datesOnlyAssessment();
    default:
      return null;
  }
}
