/**
 * The 13 Canvas fixture pages required by Phase 3.
 * Each exports a path + HTML so both the parser tests and the e2e server can
 * serve the exact same pages.
 */
import { assignmentRow, canvasShell, crumb } from './_shell.mjs';

const MATH = { id: '101', name: 'MATH-7-P3-26-27-SMITH' };
const ENGLISH = { id: '202', name: 'ENG-9-HONORS-SPRING' };

/** Fixed dates keep assertions stable; the harness rewrites them when needed. */
export const DUE_TODAY = '2026-08-15T23:59:00.000Z';
export const DUE_TOMORROW = '2026-08-16T23:59:00.000Z';

/* 1. Dashboard — several courses, mixed states */
const dashboard = canvasShell({
  title: 'Dashboard',
  body: `
  <h1>Dashboard</h1>
  <div class="ic-DashboardCard__box">
    <a class="ic-DashboardCard__link" href="/courses/${MATH.id}">${MATH.name}</a>
    <a class="ic-DashboardCard__link" href="/courses/${ENGLISH.id}">${ENGLISH.name}</a>
  </div>
  <div class="todo-list">
    <h2>To Do</h2>
    <ul>
      ${assignmentRow({
        courseId: MATH.id,
        assignmentId: '5001',
        title: 'Chapter 7 Homework',
        dueIso: DUE_TODAY,
        points: 20,
      })}
      ${assignmentRow({
        courseId: ENGLISH.id,
        assignmentId: '6001',
        title: 'Argument Essay',
        dueIso: DUE_TOMORROW,
        points: 100,
      })}
    </ul>
  </div>`,
});

/* 2. Assignments index for one course */
const assignmentsIndex = canvasShell({
  title: 'Assignments',
  breadcrumbCourse: crumb(MATH.id, MATH.name),
  body: `
  <h1>Assignments</h1>
  <ul class="assignment-list">
    ${assignmentRow({
      courseId: MATH.id,
      assignmentId: '5001',
      title: 'Chapter 7 Homework',
      dueIso: DUE_TODAY,
      points: 20,
    })}
    ${assignmentRow({
      courseId: MATH.id,
      assignmentId: '5002',
      title: 'Chapter 8 Practice',
      dueIso: DUE_TOMORROW,
      points: 15,
      pills: ['submitted'],
    })}
    ${assignmentRow({
      courseId: MATH.id,
      assignmentId: '5003',
      title: 'Warm-up Set',
      dueIso: null,
      points: 5,
    })}
  </ul>`,
});

/** A single assignment page. `statusBlock` is what varies between fixtures. */
function assignmentPage({ courseId, courseName, assignmentId, title, dueIso, statusBlock }) {
  return canvasShell({
    title,
    breadcrumbCourse: crumb(courseId, courseName),
    body: `
    <div id="assignment_show">
      <h1 class="title" data-testid="assignment-name">${title}</h1>
      <div class="assignment-date-due">
        ${dueIso ? `Due <time datetime="${dueIso}">${dueIso}</time>` : 'No due date'}
      </div>
      <div class="points_possible">20 points</div>
      <div class="description">
        Complete the practice problems. Work must be submitted as a PDF.
      </div>
      ${statusBlock}
    </div>`,
  });
}

/* 3. Not submitted */
const notSubmitted = assignmentPage({
  courseId: MATH.id,
  courseName: MATH.name,
  assignmentId: '5001',
  title: 'Chapter 7 Homework',
  dueIso: DUE_TODAY,
  statusBlock: `
    <div class="submission-details" data-testid="submission-status">
      <h2>Submission</h2>
      <p>Not Submitted</p>
    </div>`,
});

/* 4. Submitted */
const submitted = assignmentPage({
  courseId: MATH.id,
  courseName: MATH.name,
  assignmentId: '5001',
  title: 'Chapter 7 Homework',
  dueIso: DUE_TODAY,
  statusBlock: `
    <div class="submission-details" data-testid="submission-status">
      <h2>Submission</h2>
      <p>Submitted!</p>
      <p>Submitted on <time datetime="${DUE_TODAY}">Aug 15</time></p>
    </div>`,
});

/* 5. Graded */
const graded = assignmentPage({
  courseId: ENGLISH.id,
  courseName: ENGLISH.name,
  assignmentId: '6001',
  title: 'Argument Essay',
  dueIso: DUE_TOMORROW,
  statusBlock: `
    <div class="submission-details" data-testid="submission-status">
      <h2>Submission</h2>
      <p>Graded</p>
      <span class="submission-graded-pill" data-testid="graded-pill">Graded</span>
    </div>`,
});

/* 6. Missing */
const missing = assignmentPage({
  courseId: MATH.id,
  courseName: MATH.name,
  assignmentId: '5004',
  title: 'Unit 2 Review',
  dueIso: '2026-08-01T23:59:00.000Z',
  statusBlock: `
    <div class="submission-details" data-testid="submission-status">
      <h2>Submission</h2>
      <span class="submission-missing-pill" data-testid="missing-pill">Missing</span>
      <p>Not Submitted</p>
    </div>`,
});

/* 7. Late AND submitted — must normalise to late_submitted and still count */
const lateSubmitted = assignmentPage({
  courseId: ENGLISH.id,
  courseName: ENGLISH.name,
  assignmentId: '6002',
  title: 'Reading Response 4',
  dueIso: '2026-08-10T23:59:00.000Z',
  statusBlock: `
    <div class="submission-details" data-testid="submission-status">
      <h2>Submission</h2>
      <span class="submission-late-pill" data-testid="late-pill">Late</span>
      <span class="submission-submitted-pill" data-testid="submitted-pill">Submitted</span>
      <p>Submitted late</p>
    </div>`,
});

/* 8. No due date */
const noDueDate = assignmentPage({
  courseId: MATH.id,
  courseName: MATH.name,
  assignmentId: '5003',
  title: 'Warm-up Set',
  dueIso: null,
  statusBlock: `
    <div class="submission-details" data-testid="submission-status">
      <h2>Submission</h2>
      <p>Not Submitted</p>
    </div>`,
});

/* 9. Quiz with a reliable status */
const quizReliable = canvasShell({
  title: 'Vocabulary Quiz 3',
  breadcrumbCourse: crumb(ENGLISH.id, ENGLISH.name),
  body: `
  <div id="quiz_show">
    <h1 class="title" data-testid="assignment-name">Vocabulary Quiz 3</h1>
    <div class="assignment-date-due">Due <time datetime="${DUE_TOMORROW}">Aug 16</time></div>
    <div class="submission-details" data-testid="submission-status" data-submission-state="submitted">
      <h2>Submission</h2>
      <p>Submitted</p>
    </div>
  </div>`,
});

/* 10. Quiz with an ambiguous status — must NOT be treated as complete */
const quizAmbiguous = canvasShell({
  title: 'Pop Quiz',
  breadcrumbCourse: crumb(ENGLISH.id, ENGLISH.name),
  body: `
  <div id="quiz_show">
    <h1 class="title" data-testid="assignment-name">Pop Quiz</h1>
    <div class="assignment-date-due">Due <time datetime="${DUE_TOMORROW}">Aug 16</time></div>
    <div class="quiz-header">
      <p>This quiz has 1 attempt remaining.</p>
      <p>Time limit: 20 minutes</p>
    </div>
  </div>`,
});

/* 11. External tool assignment with no reliable indicator */
const externalTool = canvasShell({
  title: 'Lab Simulation',
  breadcrumbCourse: crumb(MATH.id, MATH.name),
  body: `
  <div id="assignment_show">
    <h1 class="title" data-testid="assignment-name">Lab Simulation</h1>
    <div class="assignment-date-due">Due <time datetime="${DUE_TOMORROW}">Aug 16</time></div>
    <div class="external-tool-launch">
      <iframe title="Lab Simulation" src="about:blank"></iframe>
      <p>This assignment opens in an external tool.</p>
    </div>
  </div>`,
});

/* 12. Malformed Canvas-like page — right host, nonsense content */
const malformed = `<!doctype html>
<html><head><title>Something</title></head>
<body>
  <div>Totally unexpected markup</div>
  <p>Submitted</p>
</body></html>`;

/* 13. A page on a custom (non-instructure) Canvas domain */
const customDomain = canvasShell({
  title: 'Assignments',
  breadcrumbCourse: crumb('777', 'District Science 8'),
  body: `
  <h1>Assignments</h1>
  <ul>
    ${assignmentRow({
      courseId: '777',
      assignmentId: '9001',
      title: 'Ecosystems Worksheet',
      dueIso: DUE_TODAY,
      points: 10,
    })}
  </ul>`,
});


/* ------------------------------------------------------------------ */
/* Grades pages (Phase 18)                                             */
/* ------------------------------------------------------------------ */

/**
 * `/courses/:id/grades` — Canvas's student gradebook.
 *
 * Written to the markup Canvas has emitted for years: a `#grades_summary`
 * table of `tr.student_assignment` rows, each with a title cell linking to the
 * assignment, a due cell, a status cell, an `assignment_score` cell and a
 * `points_possible` cell, plus the course total in the right-hand sidebar.
 *
 * The interesting rows are deliberately awkward:
 *   - one graded with a score
 *   - one submitted but not yet marked ("Score unavailable")
 *   - one missing
 *   - one excused
 *   - one with a dash where the score would be, which must NOT read as graded
 */
const courseGrades = canvasShell({
  title: 'Grades',
  breadcrumbCourse: crumb(MATH.id, MATH.name),
  body: `
  <h1>Grades for ${MATH.name}</h1>
  <table id="grades_summary" class="student_assignments editable">
    <thead><tr><th>Name</th><th>Due</th><th>Status</th><th>Score</th><th>Out of</th></tr></thead>
    <tbody>
      <tr class="student_assignment editable" id="submission_5001">
        <th class="title" scope="row">
          <a href="/courses/${MATH.id}/assignments/5001">Chapter 7 Homework</a>
          <div class="context">${MATH.name}</div>
        </th>
        <td class="due"><time datetime="${DUE_TODAY}">Aug 15 by 11:59pm</time></td>
        <td class="status"><span class="submission-graded-pill">graded</span></td>
        <td class="assignment_score">
          <div class="score_holder">
            <span class="tooltip"><span class="grade"><span class="screenreader-only">Score:</span> 18</span></span>
          </div>
        </td>
        <td class="points_possible">20</td>
      </tr>
      <tr class="student_assignment editable" id="submission_5002">
        <th class="title" scope="row">
          <a href="/courses/${MATH.id}/assignments/5002">Unit 3 Practice</a>
        </th>
        <td class="due"><time datetime="${DUE_TOMORROW}">Aug 16 by 11:59pm</time></td>
        <td class="status"><span class="submission-submitted-pill">submitted</span></td>
        <td class="assignment_score">
          <span class="grade"><span class="screenreader-only">Score unavailable</span>-</span>
        </td>
        <td class="points_possible">30</td>
      </tr>
      <tr class="student_assignment editable" id="submission_5004">
        <th class="title" scope="row">
          <a href="/courses/${MATH.id}/assignments/5004">Graphing Worksheet</a>
        </th>
        <td class="due"><time datetime="2026-08-10T23:59:00.000Z">Aug 10 by 11:59pm</time></td>
        <td class="status"><span class="submission-missing-pill">missing</span></td>
        <td class="assignment_score"><span class="grade">-</span></td>
        <td class="points_possible">15</td>
      </tr>
      <tr class="student_assignment editable" id="submission_5006">
        <th class="title" scope="row">
          <a href="/courses/${MATH.id}/assignments/5006">Field Trip Reflection</a>
        </th>
        <td class="due"></td>
        <td class="status"></td>
        <td class="assignment_score"><span class="grade">EX</span></td>
        <td class="points_possible">10</td>
      </tr>
      <tr class="student_assignment editable" id="submission_5007">
        <th class="title" scope="row">
          <a href="/courses/${MATH.id}/assignments/5007">Quiz Corrections</a>
        </th>
        <td class="due"><time datetime="${DUE_TOMORROW}">Aug 16 by 11:59pm</time></td>
        <td class="status"></td>
        <td class="assignment_score"></td>
        <td class="points_possible">25</td>
      </tr>
    </tbody>
  </table>
  <div id="student-grades-right-content">
    <div class="student_assignment final_grade">
      Total: <span class="grade">93.75%</span>
    </div>
  </div>`,
});

/** The same page for a class whose teacher hides totals. */
const courseGradesHidden = canvasShell({
  title: 'Grades',
  breadcrumbCourse: crumb(ENGLISH.id, ENGLISH.name),
  body: `
  <h1>Grades for ${ENGLISH.name}</h1>
  <table id="grades_summary" class="student_assignments">
    <tbody>
      <tr class="student_assignment" id="submission_6001">
        <th class="title" scope="row">
          <a href="/courses/${ENGLISH.id}/assignments/6001">Argument Essay</a>
        </th>
        <td class="due"><time datetime="${DUE_TOMORROW}">Aug 16</time></td>
        <td class="status"><span class="submission-submitted-pill">submitted</span></td>
        <td class="assignment_score"><span class="grade">-</span></td>
        <td class="points_possible">100</td>
      </tr>
    </tbody>
  </table>
  <div id="student-grades-right-content">
    <div class="final_grade">Your teacher has hidden the total grade.</div>
  </div>`,
});

/**
 * A gradebook that does NOT use the classic markup.
 *
 * No `#grades_summary`, no `tr.student_assignment`, no `.assignment_score` —
 * just rows with an assignment link and a "18/20" cell. This exists because
 * the first version of the parser required the classic shape and produced
 * absolutely nothing on anything else, which is indistinguishable from
 * "LockIn cannot tell what is done".
 */
const courseGradesModern = canvasShell({
  title: 'Grades',
  breadcrumbCourse: crumb('303', 'Museum Studies'),
  body: `
  <h1>Grades</h1>
  <div role="table" class="grades-table">
    <table>
      <tbody>
        <tr>
          <td><a href="/courses/303/assignments/88001">Museum Project</a></td>
          <td><time datetime="${DUE_TOMORROW}">Aug 16</time></td>
          <td>Graded</td>
          <td>100/100</td>
        </tr>
        <tr>
          <td><a href="/courses/303/assignments/88002">Reading Response</a></td>
          <td><time datetime="${DUE_TOMORROW}">Aug 16</time></td>
          <td>Submitted</td>
          <td>-</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div id="student-grades-right-content">Total: <span class="grade">97%</span></div>`,
});

/** `/grades` — every class, with the grade Canvas publishes for each. */
const allGrades = canvasShell({
  title: 'Grades',
  body: `
  <h1>Grades</h1>
  <table class="course_details student_grades">
    <thead><tr><th>Course</th><th>Grade</th></tr></thead>
    <tbody>
      <tr>
        <td><a href="/courses/${MATH.id}">${MATH.name}</a></td>
        <td class="percent">93.75%</td>
        <td class="grade">A</td>
      </tr>
      <tr>
        <td><a href="/courses/${ENGLISH.id}">${ENGLISH.name}</a></td>
        <td class="percent">No grades</td>
      </tr>
    </tbody>
  </table>`,
});

/* A page that is NOT Canvas at all, for the rejection test. */
const notCanvas = `<!doctype html>
<html><head><title>News</title></head>
<body><h1>Daily News</h1><a href="/courses/123/assignments/456">Not really canvas</a></body></html>`;

/**
 * Path → HTML. Paths mirror real Canvas routes so `classifyCanvasUrl` is
 * exercised exactly as it would be in production.
 */
export const CANVAS_FIXTURES = {
  '/': dashboard,
  '/dashboard': dashboard,
  [`/courses/${MATH.id}/assignments`]: assignmentsIndex,
  [`/courses/${MATH.id}/assignments/5001`]: notSubmitted,
  [`/courses/${MATH.id}/assignments/5001/submitted`]: submitted,
  [`/courses/${ENGLISH.id}/assignments/6001`]: graded,
  [`/courses/${MATH.id}/assignments/5004`]: missing,
  [`/courses/${ENGLISH.id}/assignments/6002`]: lateSubmitted,
  [`/courses/${MATH.id}/assignments/5003`]: noDueDate,
  [`/courses/${ENGLISH.id}/quizzes/7001`]: quizReliable,
  [`/courses/${ENGLISH.id}/quizzes/7002`]: quizAmbiguous,
  [`/courses/${MATH.id}/assignments/5005`]: externalTool,
  [`/courses/${MATH.id}/assignments/9999`]: malformed,
  [`/courses/${MATH.id}/grades`]: courseGrades,
  [`/courses/${ENGLISH.id}/grades`]: courseGradesHidden,
  '/courses/303/grades': courseGradesModern,
  '/grades': allGrades,
  '/courses/777/assignments': customDomain,
  '/news': notCanvas,
};

export const COURSES = { MATH, ENGLISH };

/**
 * The submitted variant is served at the canonical assignment URL when the
 * harness flips this switch, which is how "student submits" is simulated.
 */
export const SUBMITTED_VARIANTS = {
  [`/courses/${MATH.id}/assignments/5001`]: submitted,
};
