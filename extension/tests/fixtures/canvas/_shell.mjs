/**
 * Fixture builders for Canvas-like pages.
 *
 * These are hand-written, sanitized approximations of Canvas' public markup
 * patterns — Instructure layout ids (`#application`, `#content`,
 * `#breadcrumbs`), `/courses/:id/assignments/:id` routes, `<time datetime>`,
 * and submission pills. No real school data, no copied pages, no private
 * content. They exist so the parser is tested against realistic *shapes*
 * rather than against itself.
 */

export function canvasShell({ title = 'Canvas', breadcrumbCourse = '', body = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="csrf-param" content="authenticity_token">
  <meta name="generator" content="Instructure Canvas LMS">
  <title>${title}</title>
  <link rel="stylesheet" href="https://du11hjcvx0uqb.cloudfront.net/dist/brandable_css/instructure.css">
</head>
<body class="ic-app">
  <div id="application">
    <header id="header">
      <nav id="breadcrumbs" aria-label="breadcrumbs">
        <ul>
          <li><a href="/">Dashboard</a></li>
          ${breadcrumbCourse}
        </ul>
      </nav>
    </header>
    <div id="wrapper" class="ic-Layout-wrapper">
      <main id="content" class="ic-Layout-contentMain" role="main">
        ${body}
      </main>
    </div>
  </div>
</body>
</html>`;
}

export function crumb(courseId, name) {
  return `<li class="course"><a href="/courses/${courseId}">${name}</a></li>`;
}

/** One row of an assignment list, as Canvas renders index/dashboard lists. */
export function assignmentRow({
  courseId,
  assignmentId,
  title,
  dueIso,
  points,
  pills = [],
  quiz = false,
}) {
  const href = quiz
    ? `/courses/${courseId}/quizzes/${assignmentId}`
    : `/courses/${courseId}/assignments/${assignmentId}`;
  const due = dueIso
    ? `<span class="assignment-date-due">Due <time datetime="${dueIso}">${dueIso}</time></span>`
    : '<span class="assignment-date-due">No due date</span>';
  const pointsHtml = points
    ? `<span class="points_possible">${points} points</span>`
    : '';
  const pillHtml = pills
    .map((p) => `<span class="submission-${p}-pill" data-testid="${p}-pill">${p}</span>`)
    .join('');
  return `
  <li class="assignment" id="assignment_${assignmentId}">
    <div class="ig-row">
      <a class="ig-title" href="${href}">${title}</a>
      <div class="ig-details">${due}${pointsHtml}${pillHtml}</div>
    </div>
  </li>`;
}
