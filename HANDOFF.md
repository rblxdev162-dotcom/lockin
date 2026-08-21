# LockIn — handoff for the next session

**Read this file first, then `README.md`.** Phases 1–8 are complete, tested,
and must not be rebuilt. `README.md` is the developer guide; this file is the
architecture, the invariants, and the reasoning behind them.

Project root: `/Users/arjun/lockin` (git branch `phase18-grades` at the start of Phase 19)

---

## What LockIn is

A local-first student productivity app: track Canvas/Edgenuity/other
assignments, run focus sessions, and — via a companion Chrome extension —
**actually block distracting websites** until required schoolwork is verified as
done. No accounts, no server, no paid APIs, no AI services. Everything stays on
the device.

Tagline: *Finish what matters before distractions take over.*

---

## Current state

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | React + TS + Vite + Tailwind site, versioned local persistence, assignments, exams, focus timer, Focus Mode, parent PIN, temporary unlock, emergency exit, activity log, responsive UI | **Done** |
| 2 | Manifest V3 extension, real `declarativeNetRequest` blocking, school allowlist, block page, popup, web↔extension bridge, Chrome-restart persistence, cross-tab sync | **Done** |
| 3 | **Canvas Browser Detection** — detect/import/link Canvas assignments, verify submissions, feed Focus Mode, auto-unlock | **Done** |
| 4 | **Edgenuity live-camera verification** | **Removed in Phase 17** |
| 5 | **Enhanced Proof** — one-time challenge codes photographed with the screen | **Removed in Phase 15** |
| 6 | **Parent Accountability Dashboard** — PIN-gated `/parent`, verification review, focus history, parent-controlled proof requirements, local export | **Done** |
| 7 | **Smart Study Planner** — deterministic daily schedule from due dates, estimates, exams and availability; adaptive rescheduling; `/planner` | **Done** |
| 9 | **Focus Guard + consent + capture** — Page Visibility honor mode, permission-style blocking consent, one-field assignment capture with learned estimates, four-step onboarding | **Done** |
| 15 | **Camera and Enhanced Proof removed** — screen sharing and page reading are the only sources; no strength setting remains | **Done** |
| 14 | **The bridge** — a local service read Edgenuity progress from any Chrome window | **Removed in Phase 16** |
| 13 | **OS reminders** — fired by the extension's alarm, so they survive every LockIn tab being closed | **Done** |
| 12 | **Screen-capture proofs** — sharing the Edgenuity window for OCR | **Removed in Phase 17** |
| 11 | **Edgenuity browser reading** — read course progress off the Edgenuity page the student opens | **Removed in Phase 16** |
| 17 | **Canvas only** — Edgenuity scrapped, 30-minute auto-sync, graded-vs-undone, urgency ordering, class columns, and a large deletion pass | **Done** |
| 18 | **The Grades page reader** — read the Canvas page the student opened, class grades, the school-hours gate, and the layout pass | **Done** |
| 19 | **Class-first work hub** — Home course overview, class-first Assignments layout, freshness-aware overdue labels | **Done** |
| 16 | **Product phase** — provenance model, Pace Engine, Canvas Calendar Feed, Edgenuity report/email import, Companion activity awareness, School Companion + context bridge, and the design/nav/dashboard rebuild | **Done** |
| 8 | **Release readiness** — environment-configurable origins, extension packaging, protocol versioning, privacy page, data export, storage recovery, retention caps, accessibility audit, security review, release + a11y + performance suites | **Done** |

### Test counts (all passing, all local fixtures — no real Canvas or Edgenuity account)

**Pure logic and reducer state** — `npm test`, ~3 seconds, no browser:

| Suite | Checks | Command |
| --- | --- | --- |
| Blocking, reminders, bridge, Canvas, Edgenuity, parent, planner | (see `npm test`) | (the suites `npm test` chains) |
| Storage recovery: corruption, migration, retention, quota | 18 | `npm run test:storage` |
| Security: the ten bypass paths | 22 | `npm run test:security` |
| Date/time boundaries and clock changes | 19 | `npm run test:time` |
| Release safety: packaging, versions, export secrets, no-network | 17 | `npm run test:release` |
| Performance budgets on a 100-assignment dataset | 7 | `npm run test:perf` |
| **Provenance + Pace Engine** | 20 | `npm run test:pace` |
| **The Canvas gate, its 3 mirrors, grades** | 21 | `npm run test:canvas-grades` |
| **Work states, urgency, class grouping** | 17 | `npm run test:worklist` |
| **Canvas ICS: parser, mapper, reconciler** | 36 | `npm run test:canvas-ics` |
| **Companion: activity, cooldowns, calendar** | 28 | `npm run test:companion` |
| **Phase 16 state, migration and feedback** | 14 | `npm run test:phase16` |

**Real browser** — needs Chrome for Testing, and (except the release suite) the
dev server on `:5173`:

| Suite | Checks | Command |
| --- | --- | --- |
| Canvas parser + Grades pages (real DOM) | 40 | `npm run test:parser` |
| Phase 2 blocking e2e | 26 | `npm run test:e2e` |
| Canvas e2e | 57 | `npm run test:canvas-e2e` |
| Parent Dashboard e2e (PIN, controls, enforcement) | **BROKEN** | `npm run test:parent-e2e` |
| Planner e2e (plan → start → partial → recalculate) | 54 | `npm run test:planner-e2e` |
| **Release e2e** (production build + packaged zip) | 22 | `npm run test:release-e2e` |
| **Accessibility e2e** (names, focus, keyboard, 320–768px, 200% zoom) | 40 | `npm run test:a11y-e2e` |

`npm run test:all` runs everything. All browser suites need **Chrome for
Testing** (branded Chrome 137+ ignores `--load-extension`); it's installed at
`~/chrome/mac_arm-152.0.7977.42/...`, or set `CHROME_BIN`.

The Edgenuity, parent and Phase 8 logic suites import `web/src/**/*.ts`
directly — Node strips the types, and `extension/tests/ts-resolve.mjs` resolves
the extensionless imports. They therefore test the shipping modules, not copies.

If a suite says the debug port is in use: `pkill -f "Chrome for Testing"`.

**`test:parent-e2e` does not run at all, and has not since Phase 17.** It
imports `extension/tests/edgenuity-fixtures.mjs`, which that phase deleted, and
about a third of its checks exercise features that no longer exist (the camera
proof flow, Enhanced trust, the `edgenuity` slice). It fails at import, so
`npm run test:all` cannot be green until it is either rewritten around the PIN /
controls / enforcement checks that are still meaningful, or retired. Verified
pre-existing on `5264871`, before Phase 18. **The Parent Dashboard itself is
fine** — this is dead test code, not a broken feature.

**Known time-sensitive block:** `test:planner-e2e` fails **six** checks when
run late in the evening — "today holds both the assignment and exam study",
"today is filled to capacity but no further", and the four Focus Mode
assertions that follow, which cascade from a today-plan holding one item
instead of two. By 11pm the seeded availability for *today* has no capacity
left, so the scheduler correctly places less; the planner is pure and takes
`now` as an input, so the test is asserting a daytime shape.

**Verified, not assumed:** the same six fail identically on `5264871` (the
commit before Phase 18) run at the same hour. Re-run during the day before
investigating — and if you do investigate, fix it by seeding a fixed `now`
rather than by loosening the assertions.

**Known flake:** `test:parent-e2e` and the Edgenuity suites drive real OCR over
rendered fixtures. A capture occasionally needs its retry budget and, rarely,
exhausts it. Re-run once before investigating.

---

## Running it

```bash
npm --prefix web install && npm run dev
```

Then load the extension: `chrome://extensions` → Developer mode → Load unpacked
→ select `/Users/arjun/lockin/extension` → reload the LockIn tab → Settings →
Browser protection → Test connection.

Port 5173 is fixed in development. Since Phase 8 it is *configuration* rather
than a literal: `lockin.config.json` is the source of truth, and
`scripts/gen-extension-config.mjs` writes `extension/shared/config.js`,
`extension/shared/build-config.js` and the manifest's `content_scripts.matches`
from it. The generated files are committed with development values so Load
unpacked keeps working with no build step.

## Release process

```bash
npm run build              # website          → web/dist
npm run package:extension  # extension + zip  → release/extension, dist/*.zip
npm run build:release      # both

# for a real production origin
LOCKIN_ENV=production LOCKIN_APP_ORIGIN=https://lockin.example.com \
  npm run package:extension
```

`scripts/build-extension.mjs` copies an **allowlist** of shipping directories
(a denylist silently ships whatever it has not heard of), regenerates the origin
config for the target environment, then verifies the output: nothing matching a
forbidden pattern, and every file the manifest references present.

The full pre-ship list is `RELEASE_CHECKLIST.md`; the human test is
`MANUAL_QA.md`. Phase 8 prepares a release and deliberately does not publish
one.

## Architecture invariants — do not break these

1. **One completion engine.** `recompute()` in `web/src/store/reducer.ts` is the
   only thing that recounts required work and ends Focus Mode. Any new
   verification source must produce a completed assignment and let `recompute()`
   do the rest. **Never add a second unblock path.**
2. **The verification chain is fixed:**
   `detect → validate → VerificationRecord → assignment Completed →
   recompute() → Focus Mode ends → DNR rules removed → sites unlock`.
3. **Asymmetric safety.** A false negative is fine; a false positive unlocks
   distractions on work that was never done. Anything ambiguous must degrade to
   `verification_unavailable`, never to a pass.
4. **Allowlist always wins** over the blocklist, and protected domains (Google,
   localhost, the configured Canvas domain) can never be blocked.
5. **Never fight the browser.** Never hide `chrome://extensions`, never trap
   the user (emergency exit always works), and never close a tab the *student*
   opened. Scoped in Phase 17: LockIn may close a background tab **it opened
   itself**, checking the id and the URL first — see `closeCanvasSyncTab()`.
   Leaving an unasked-for tab lying around is the ruder option.
6. **Page data is untrusted.** Everything crossing a trust boundary is rebuilt
   field-by-field with caps; unknown keys are dropped. No `eval`, no `innerHTML`
   with detected content.
7. **Local only.** No network calls in either half of the project. No analytics,
   no tracking, no browsing history — block stats are per-domain counts only.
8. **Schema migrations, never wipes.** Bump `SCHEMA_VERSION` in
   `web/src/lib/storage.ts` and add a `MIGRATIONS[n]` step. Currently **v10**.
9. **Only a machine-read measurement can verify Edgenuity progress** — a frame
   from a window the student shared with `getDisplayMedia` (Phase 12), or a DOM
   read from their own authenticated Edgenuity session (Phase 11, or Phase 14's
   bridge). The camera frame this rule was written for is gone (Phase 15). Anything else — a typed correction, a test
   fixture, a tampered save file — is recorded as unverified and refused.
   Never add a path that turns a student-supplied number into a verified
   result. *(Amended in Phase 11. The rule was "only a live camera frame"; the
   reason was never the camera, it was that a student-supplied number must not
   count. A reading the extension took off the real page, in a tab the
   background worker verified was on Edgenuity, is not student-supplied — it is
   the same class of evidence Canvas verification already trusts, and stronger
   than a photo, which cannot prove whose screen it is.)*
10. **New progress is measured from `lastVerifiedProgress`,** never from the
    session's starting photo, or the same percentage points get claimed twice. The
    browser path obeys the same rule with two extra pieces: `browserBaseline`
    (the first reading credits **nothing**, so connecting mid-course does not
    instantly satisfy a target) and `lastVerifiedActivityCount` (the
    high-water mark new activities are counted from). A course that resets
    reads lower and credits nothing rather than going negative.
11. **A challenge is only evidence if a machine checks it.** There is no
    "yes, the code was visible" button, and there must never be one. If OCR
    cannot find the code, the answer is a retake.
12. **Both halves of a session carry their own code, and the second is issued
    only when the student taps Verify progress.** Generating both up front
    would let a student stage two photos in one sitting.
13. **Nothing can require Enhanced.** `requiredTrustFor()` returns `standard`
    unconditionally and ignores any stored requirement. Enhanced was a
    handwritten code photographed beside the screen; with no camera it cannot
    be produced, and honouring an old `enhanced` value would leave an
    assignment permanently unverifiable with nothing able to explain why.
14. **The Parent Dashboard is accountability, not surveillance.** It may show
    work and verification events. Never add browsing history, screenshots,
    webcam, location, keystrokes or message monitoring — and note that most of
    those are impossible today because the data simply isn't stored.
15. **Parent requirement changes are prospective.** Raising the bar must never
    re-open work completed under the rule that applied at the time.
16. **The parent session is never persisted.** It lives in React state so a
    reload, a restart or Exit Parent View re-locks by construction.
17. **Protected settings are refused by the reducer,** not merely hidden by the
    UI — `UPDATE_SETTINGS` drops a locked field without `parentApproved`.
18. **The planner is pure and deterministic.** `lib/planner/` never reads the
    clock (`now` is an input), never calls `uid()`, and never decides what is
    *finished* — it reads `assignment.status`. Planning logic must not move
    into a React component, and no planning decision may depend on array order.
19. **A plan is a cache, not a source of truth.** Remaining work is derived
    from `estimate − logged` every time, which is why unfinished minutes cannot
    be lost. Never make the plan the place where "how much is left" is stored.
20. **Never claim protection that isn't there.** Whenever Focus Mode is running
    but the extension is not answering, the app says so — in a banner across
    every screen, not a badge three screens away. "Isn't installed" and "has
    stopped responding" are different sentences, which is what
    `settings.extensionSeen` exists to distinguish.
21. **Test-only code is eliminated, not hidden.** The fixture capture source and
    the dev seed live behind `import.meta.env.DEV` branches that Rollup removes,
    and `extension/tests/release.test.mjs` fails the release if their names
    appear in `web/dist`. Hiding a bypass in the UI is not the same as not
    shipping it.
22. **The export is an allowlist.** `lib/export.ts` names every field it emits.
    A denylist leaks the next secret somebody adds, and this is the one place
    local-only data becomes a file that can be emailed.
23. **History is capped; data is not.** `lib/retention.ts` trims the activity
    log, focus sessions and block counters. Assignments, exams, the plan, the
    PIN and parent settings have no cap and are never dropped to make room —
    `save()` sheds history rather than failing, in that order.
24. **One timer, one blocker.** Starting a planned session dispatches the
    existing `START_SESSION`; starting Focus Mode from the plan dispatches the
    existing `START_FOCUS_MODE` with assignment ids only. Never add a second.

25. **Freshness is derived, never stored.** `classify()` takes `now` and works
    out the state every time. Nothing may persist a `DataState`, and nothing
    may set `isLive` from a save file — only a live handshake can assert that a
    connection is answering.
26. **A missing sync is never bad news about the student.** Stale data produces
    UNKNOWN with the source named. Nothing is called overdue on a due date
    LockIn cannot currently believe, and no verdict is ever presented as a
    vendor's own unless the vendor published it.
27. **Absence is not completion, and never was.** A record that stops appearing
    in a feed is left exactly as it is. Only an explicit cancellation marks
    anything, and even that never completes it.
28. **Credentials never enter the page.** The Canvas feed URL and any future
    OAuth token live in the extension. What crosses to the page is a *view* —
    host, timestamps, error text — and the sanitiser has no field for a secret.
29. **One notification door.** `deliver()` in `background/reminders.js` is the
    only caller of `chrome.notifications.create`, and it is timed. Adding a
    second path re-introduces exactly the spam the cooldown exists to prevent.
30. **The School Companion is context, not content.** No content script, no
    `scripting` permission, one loopback host permission, off by default, and
    gated behind an explicit claim that the organization allows it. Nothing in
    LockIn may work around an administrator setting.
31. **Colour is never the only signal.** Every status has a word beside it, and
    the a11y suite checks it.
32. **One comparator.** `urgency()` in `lib/workState.ts` is the only ordering
    in the app. Bands first, then strictly by due time; priority never beats a
    due date. Anything that sorts work differently is a bug.
33. **Finished is four different words.** `graded`, `submitted`, `done` and
    `missing` are distinct states and must stay distinct — collapsing them into
    a tick box is what made the old list unable to answer "what have I got
    left?". Canvas's own word always outranks LockIn's inference.
34. **LockIn makes no request to Canvas.** It reads pages the student opened,
    on the student's press. No `/api/v1/` call, no access token, no session
    used as an authentication mechanism, no background tab, no poller that is
    on by default, and never a quiz or assessment page. If a future phase needs
    more than the rendered page gives, the answer is to ask the district — not
    to find a cleverer way in.
35. **One gate, in front of every Canvas path.** `canvasGateAllows()` in
    `extension/background/canvas.js`, `evaluateCheckWindow()` in
    `web/src/lib/canvas/checkWindow.ts`, and `autoFetchAllowed()` in
    `scripts/canvas-feed.mjs` are three copies of one rule, pinned against each
    other by a ~1,000-case test. Adding a Canvas code path that does not ask
    first is the bug this invariant exists to make obvious. When it says no,
    **zero** Canvas activity happens — not less, none — and the decision is
    logged either way, because a guarantee nobody can check is a promise, not a
    guarantee.
36. **The copy never claims more than the gate enforces.** LockIn cannot know
    when a test is happening; it knows the hours it was told about. The
    sentence is *"Automatic Canvas checks are disabled during your configured
    school hours"*, in onboarding, in Settings, in the refusal toast and in the
    log — and nothing stronger anywhere.
37. **A grade is never computed.** Every percentage was printed on a page the
    student opened. A class whose total Canvas hides says so; averaging the
    assignments LockIn happens to know about would be most wrong exactly when
    it matters most. Scores are display data and can never promote a submission
    status.
38. **A removed integration never takes history with it.** Migrations may drop
    a slice, a link or a setting; they may not drop a `verificationRecords`
    entry, a completion, or logged minutes.

---

## Key files

### Web (`web/src/`)
| Concern | File |
| --- | --- |
| All data models | `types/index.ts`, `types/canvas.ts`, `types/source.ts` |
| Every state transition | `store/reducer.ts` |
| Persistence + migrations | `lib/storage.ts` |
| Derived views, bridge payload | `lib/selectors.ts` |
| Blocking decision (web mirror) | `lib/domains.ts` |
| Parent PIN (logic only) | `lib/pin.ts` |
| Bridge client | `lib/extensionBridge.ts`, `lib/protocol.ts` |
| Canvas provider interface | `lib/canvas/provider.ts` |
| Canvas shipping provider | `lib/canvas/pageProvider.ts` |
| Canvas API stub (do not implement) | `lib/canvas/api.ts` |
| **What counts as verified** | `lib/canvas/verification.ts` |
| Canvas identity + suggestions | `lib/canvas/matching.ts` |
| **Everything the Parent Dashboard shows** | `lib/parent/selectors.ts` |
| Parent controls + focus-run models | `types/parent.ts` |
| Parent session (in-memory only) | `hooks/useParentSession.ts` |
| Parent UI | `pages/Parent.tsx`, `components/features/parent/*` |
| **The scheduler** | `lib/planner/engine.ts` |
| Priority constants (all of them) | `lib/planner/priorities.ts` |
| Availability → capacity | `lib/planner/capacity.ts` |
| Remaining work + deadline windows | `lib/planner/assignments.ts` |
| Exam estimates, spacing, final review | `lib/planner/exams.ts` |
| Subject speed factors | `lib/planner/estimation.ts` |
| Status derivation, diffs, missed work | `lib/planner/reschedule.ts` |
| Clock layout and breaks | `lib/planner/schedule.ts` |
| **Every sentence a plan says** | `lib/planner/explanations.ts` |
| Adapter + derived views | `lib/planner/index.ts` |
| Planner models | `types/planner.ts` |
| Planner actions from the UI | `hooks/usePlanner.ts` |
| Planner UI | `pages/Planner.tsx`, `components/features/planner/*` |
| **Where a record came from** | `types/source.ts`, `lib/sources/freshness.ts` |
| Connections and course progress | `types/integrations.ts` |
| **Ahead / on track / behind** | `lib/pace/engine.ts` |
| **What state work is in, and its order** | `lib/workState.ts` |
| Canvas auto-sync (gated; off by default) | `hooks/useCanvasAutoSync.ts` |
| **When Canvas may be touched at all** | `lib/canvas/checkWindow.ts` |
| The Check Canvas action | `hooks/useCanvasCheck.ts`, `components/features/CheckCanvasButton.tsx` |
| Class grades model | `types/grades.ts` |
| Grades page and its settings | `pages/Grades.tsx`, `components/features/CanvasCheckSettings.tsx` |
| iCalendar parser | `lib/ics/parse.ts` |
| Canvas feed → items, and the diff | `lib/canvas/calendarFeed.ts`, `lib/canvas/calendarReconcile.ts` |
| Canvas feed client (no URL ever) | `lib/canvas/calendarClient.ts` |
| **What LockIn is allowed to praise** | `lib/feedback.ts` |
| Progress and Integrations pages | `pages/Progress.tsx`, `pages/Integrations.tsx` |
| Status, source and freshness badges | `components/ui/Status.tsx` |
| **App version (one of three copies)** | `version.ts` |
| **Retention caps and log trimming** | `lib/retention.ts` |
| **What an export may contain** | `lib/export.ts` |
| Dev-only seed profile (DEV branch only) | `lib/devSeed.ts` |
| Extension status, versions, setup | `components/features/BrowserProtectionSetup.tsx` |
| "We repaired your data" notice | `components/layout/RecoveryNotice.tsx` |
| Per-page crash recovery | `components/layout/ErrorBoundary.tsx` → `RouteErrorBoundary` |
| Export / clear / reset | `components/features/DataPanel.tsx` |
| Privacy and Help pages | `pages/Privacy.tsx`, `pages/Help.tsx` |

### Extension (`extension/`)
| Concern | File |
| --- | --- |
| Rule generation | `background/rules.js` |
| **Canvas feed fetch, the URL, the 30-min alarm** | `background/calendar.js` |
| **The same, via the local service** | `scripts/canvas-feed.mjs` |
| Which transport answers | `lib/canvas/feedTransport.ts` |
| The page's side of the service | `lib/canvas/serviceFeed.ts` |
| **The gate** | `background/canvas.js` → `canvasGate()` |
| Grades-page parsers | `canvas/parser.js` → `parseCanvasGradesPage`, `parseCanvasAllGradesPage` |
| Window rule (extension mirror) | `canvas/checkWindow.js` |
| Window rule (service mirror) | `scripts/canvas-feed.mjs` → `autoFetchAllowed()` |
| Activity awareness (metadata only) | `background/activity.js` |
| **The one notification door** | `background/reminders.js` → `deliver()` |
| Companion settings page | `options/options.{html,js,css}` |
| Worker, messaging, lifecycle | `background/service-worker.js` |
| Canvas config/permission/cache/**trust boundary** | `background/canvas.js` |
| Web↔extension relay | `content/bridge.js` |
| Canvas reader | `canvas/{content,main,detector,parser,observer,messaging,status,urls,types}.js` |
| Canvas consent page | `canvas/connect.{html,css,js}` |
| Status policy (mirror of web) | `canvas/status.js` |
| **Origins (generated, ESM)** | `shared/config.js` |
| **Origins (generated, classic — for the content script)** | `shared/build-config.js` |

### Scripts (`scripts/`)
| Concern | File |
| --- | --- |
| Origin config generation, and its validation rules | `gen-extension-config.mjs` |
| Local server + bridge fence | `serve.mjs` |
| Shipping-file allowlist, packaging, zip, verification | `build-extension.mjs` |

⚠️ `web/src/lib/domains.ts` ↔ `extension/shared/domains.js` and
`web/src/lib/canvas/verification.ts` ↔ `extension/canvas/status.js` are
hand-synced mirrors (the extension has no build step). Change both together.
Since Phase 18 there is a third, and it is a safety rule:
`web/src/lib/canvas/checkWindow.ts` ↔ `extension/canvas/checkWindow.js` ↔
`autoFetchAllowed()` in `scripts/canvas-feed.mjs`. All three are run over the
same matrix by `npm run test:canvas-grades`.

---

## Phase 19 — Class-first work hub (done)

The mixed assignment rows on Home made six classes look like one undifferentiated
inbox. Home now keeps the single next action, then shows one compact card per
class: open count, genuinely late count, current Canvas grade when published,
and the next item for that class. Opening a class carries that filter into the
Assignments page.

Assignments now defaults to **By class** and renders one full-width class
section at a time rather than scattering classes across newspaper-style
columns. List view remains available and the student's explicit choice is
remembered.

The class names also drive a horizontal switcher. Administrative section names
stay as the stable identity, while `classSwitchLabel()` surfaces the useful
part for the control (`Per 2 — Emmett` → `Emmett`, `El/B/O — Chopra` →
`Chopra`). Selecting a class keeps the full course name visible and offers an
**Open Grades** action when LockIn has a trusted assignment link for that
course. `classGradesUrl()` only converts that same-host rendered-page link to
`/courses/<id>/grades`; it rejects other hosts and API-shaped URLs.

Check Canvas now exposes its two real stages — updating calendar dates, then
reading the open gradebook — and keeps the exact result under the button rather
than making a disappearing toast the only record of what happened.

Accuracy changed with the layout: a passed date from a stale or unavailable
external source is now **Check date**, not **Overdue**. The old date remains
visible with “sync to confirm”; LockIn only restores the overdue claim after
the source answers again. Manual dates and Canvas's explicit `missing` state
keep their existing meaning. `workStateOf()` remains the one source of truth,
and `AssignmentCard` now receives the store clock instead of consulting
`Date.now()` independently.

No Canvas transport, parser, permission, or request path changed. Phase 19 adds
no API call and no dependency.

### Visual polish pass

The app shell now has local CSS-only ambient lighting, translucent navigation,
deeper but restrained cards, active-nav motion, class-card accents, button
sheen, hover lift and staggered class entrances. The effects use the existing
design tokens in light and dark mode, make no asset or font request, and the
global `prefers-reduced-motion` rule collapses every animation. The release
safety suite and the full accessibility/responsive audit pass after the change.

---

## Phase 18 — The Grades page reader (done)

### The bug that started it, and what it turned out to be

"LockIn can't tell what's already graded and done." True, and for two reasons
that had to be found by looking at the machine rather than the code:

1. The Canvas connection on this install is the **calendar feed**, through the
   local service (`~/.lockin/canvas-feed.json`). An ICS feed carries a title
   and a due date. It has never carried submission status and never will.
2. The Phase 3 page reader — the only thing that *could* answer — lives in the
   extension, and **the extension was not installed in any Chrome profile.**
   Which also meant website blocking had never actually run, on the machine
   this whole project was built for.

So the feature was not broken; it had no path to the data at all.

### The approach, and the two it beat

The student made the call, and it is the right one:

| Option | Why not |
| --- | --- |
| Canvas REST API with a student access token | The district **disables student token generation**. Dead on arrival. |
| Canvas API with the logged-in session cookie | Would probably work — it is what the Canvas UI does — but Canvas's *documented* auth is OAuth2/tokens, so this is using a session as an undocumented API credential. Defensible right up until somebody asks. |
| **Read the rendered Grades page** | The student opened it themselves. LockIn issues no request at all. The explanation is one sentence: *"I opened my own Grades page after school and my local study app organised what was on it."* |

The third one also happens to be *sufficient*: Canvas's student Grades page
carries, per assignment, the name, due date, status, score and points possible,
and the all-courses screen carries the current grade per class. That is
everything the app wanted from the API.

### The gate is the load-bearing part

The student takes proctored tests at school on a district Chromebook while
LockIn runs at home. The requirement was not "be careful", it was "nothing of
mine is talking to the school's Canvas during a test". Hence invariant 35: one
function, in front of every path, three copies pinned by a test.

Three things follow, and each was a deliberate choice rather than a default:

- **`mode: 'manual'` ships.** Automatic polling of a school system is the part
  nobody has authorised, so it is off until the student turns it on.
- **The service obeys the window too.** `scripts/canvas-feed.mjs` is a
  LaunchAgent: it kept fetching every 30 minutes, school hours included, with
  every browser closed. A gate that lived only in the page would have been a
  promise that holds only while LockIn is open. A service that was never told
  the window **does not fetch at all** — silence is not permission.
- **A refusal is overridable, once, explicitly, and logged.** LockIn does not
  know the timetable; refusing a student who is home sick on a Tuesday would be
  the app deciding it knows better. "I'm not at school — check anyway" is one
  extra press and an activity-log line.

### What was deleted

- `openCanvasForSync()` and `closeCanvasSyncTab()`, the background Canvas tab,
  and the `openCanvasOnStartup` setting — **removed, not switched off**, along
  with its toggle and its test. A setting that still exists but controls
  nothing is worse than none: the UI keeps a promise the code no longer keeps.
- The 30-minute Canvas alarm's unconditional fire. It now asks the gate, and in
  the shipped default the answer is always no.
- `syncCanvasNow()` messaged *every* open Canvas tab. It now messages **the
  active tab only**, and refuses politely if that tab is not Canvas. Reading
  the page in front of the student is the entire claim; it should be true by
  construction.

### The two new parsers

`classifyCanvasUrl` already returned `kind: 'grades'` for
`/courses/:id/grades` — it just fell through to the generic link harvester.
Phase 18 adds `grades_all` for `/grades`, and:

- **`parseCanvasGradesPage`** — `#grades_summary`, row by row. Identity still
  comes from the href (rule 1 of that file). `graded` is asserted **only** when
  a real score cell is present; `-`, an empty cell and Canvas's "Score
  unavailable" screenreader text all fall back to the status pills, and to
  `unknown` when those say nothing. An excused row is settled and carries the
  word "Excused" rather than a number.
- **`parseCanvasAllGradesPage`** — one row per class. Written tolerantly (this
  page's markup varies more), and cells containing the course-name link are
  excluded from the grade scan so a class called "Algebra 100%" cannot be read
  as a grade.

Both are tested against fixture pages in a real browser
(`npm run test:parser`, +12 checks), because they work on documents.

### Grades in the app

`types/grades.ts` + a `grades` slice + one reducer action, deliberately
touching no assignment: a percentage is not a completion, and routing it
through the verification path would make a number capable of ending Focus Mode.

`formatScore` truncates rather than rounds — 89.95% shows as 89.9%, because a
student reading "90%" and being contradicted by Canvas has been misled by
LockIn.

### Layout

Nav six → five (Progress folds into Home, Integrations into Settings, both
routes still live). Assignment tabs took the vocabulary students already read
daily — Canvas's own widget filters by Missing/Upcoming, Google Classroom's
tabs are Assigned/Missing/Done — so `Next up`/`Overdue` became
**To do**/**Missing**. Home's Connections section became one quiet line: it had
a heading, a card and a "Manage" link, which gave plumbing the same weight as
the work.

### The bug that made the whole feature look broken

A graded assignment with a full score on Canvas still read "Not Started" in
LockIn, even after a successful Check Canvas. The reading was arriving and
being thrown away.

`assignmentCanvasKey()` needs three things — a `canvas` link, a course id and
an assignment id — and **a feed-imported assignment has only the assignment
id**. An `.ics` UID is `event-assignment-<id>`; the feed carries no course id
and no link object. So the exact-identity lookup in `CANVAS_DETECTED` returned
`null` for essentially every assignment in a real install, the reading fell
through to the "not linked to anything" pile, and the student was offered an
import of work they already had while the real assignment stayed unfinished.

`findByExternalId()` is the fallback: match on the Canvas assignment id alone,
which is safe *because it is an id* — issued by Canvas, unique in an instance,
and carried identically by both sources. Domain and course id are compared only
when the stored assignment already has them; an unlinked assignment adopts them
on the first match, so every later reading takes the exact path. Titles are
still never used for identity.

Five tests in `canvas-grades` pin it, and they were checked to fail without the
fallback (3 fail, 30 pass with it) rather than assumed to.

### Why it still looked broken after all that, and how it was found

Three fixes in, a graded assignment still read as not done. The next three
guesses would have been wrong too, so the answer came from reading what the
extension had written to disk on the user's own machine
(`Local Extension Settings/<id>/000003.log`, plain `strings` over the LevelDB):

| Evidence | What it ruled out |
| --- | --- |
| 12 gate decisions, every one `allowed` | the gate |
| `schoolDayFrom` present in the stored window | a stale extension build |
| 0 statuses `graded`; 142 `unknown` | the reader was running, on the wrong pages |
| **`lockin_canvas_grades` key absent entirely** | a Grades page had never once parsed |
| cached titles: "Assignment, Syllabus", "Submission Details" | it was reading the dashboard |

The cause: **a content script registered with `registerContentScripts` only
attaches to pages loaded afterwards.** The student's gradebook tab predated the
extension reload, so it was silent; a dashboard tab answered instead; and
`describeSync` reported success because *some* page had been read. Every part
of the chain worked, and the whole produced nothing.

Three changes followed:

1. **`syncCanvasNow` injects `canvas/content.js` into any Canvas tab that does
   not answer**, then retries. The extension already holds `scripting` for that
   origin, so "reload the Canvas tab" was a workaround for something it could
   simply do. That class of failure is gone.
2. **A check that read no gradebook is not a success.** It says which page it
   read and what to open instead. Reporting "12 assignments read" after reading
   a dashboard is how this stayed hidden.
3. **The grades parser no longer requires Canvas's classic markup.** It wanted
   `#grades_summary` + `tr.student_assignment` + `.assignment_score`; anything
   else produced nothing and fell through to the link harvester, whose statuses
   are all `unknown` — indistinguishable, from the student's side, from "LockIn
   cannot tell what is done". It now falls back to any row carrying an
   assignment link, and any cell shaped like `18/20`. A fixture with none of the
   classic markup pins it.

There is now a counts-only fingerprint of the last ten reads at
`lockin_canvas_last_read` — booleans and numbers, no titles, no scores — so the
next failure of this kind is read rather than guessed at.

### The rule-id race (found in the user's service-worker console)

    [LockIn] failed to apply blocking rules
    Error: Rule with id 1 does not have a unique ID.

`applyRules()` read the existing dynamic rules and then wrote, with no lock.
`refresh()` is called from **seven** places — cold start, `onInstalled`,
`onStartup`, the heartbeat alarm, the expiry alarm, `storage.onChanged`, and
every `SYNC_STATE` — and several fire within milliseconds of each other when
Chrome starts. Two overlapping runs both saw an empty rule set, both numbered
their rules from 1, and the second write was rejected.

The error was caught upstream, so nothing crashed and nothing was reported:
**blocking simply was not applied that time round**, which is the one thing
this half of the project exists to do. Silent, intermittent, and invisible
outside the worker console.

`applyRules` now chains onto a queue so overlapping calls serialise, and
`removeRuleIds` is the union of the observed ids and the ids about to be added
(Chrome processes removals first, so naming an id that is absent is free). The
queue survives a failed write — one error must not stall every later one.

Pinned by a test that stubs `declarativeNetRequest` faithfully enough to reject
a duplicate id, fires six concurrent `applyRules`, and was checked to fail
against the old implementation.

### A test that passed while testing nothing

Written to prove that a content script orphaned by an extension reload stays
mute — setting `window.__lockinCanvasLoaded` over CDP and then pressing. It
passed immediately, which should have been the tell: **CDP evaluates in the
page's world, and the guard lives in the extension's isolated world.** Two
different `window` objects. The test touched nothing it claimed to touch.

It is relabelled to what it actually covers (a tab opened before the press is
read). The orphaned-tab case needs a real extension reload mid-run, which this
harness cannot do, so it is instrumented on the live install instead rather
than asserted here.

**When a test passes on the first run for a bug you have not fixed yet, suspect
the test.**

### Instrumenting instead of deducing

Three reads on the user's install, all `pageKind: "dashboard"`, `grades: 0` —
and no way to tell from disk whether their gradebook tab was closed at that
moment or open-but-silent. Those need opposite fixes, so `syncCanvasNow` now
records `tabsSeen`: the **path** of every Canvas tab it found (never the query
string, which is where Canvas puts tokens), whether each answered, whether it
had to be injected, and any error. One press then answers the question as fact.

### The actual cause: a page that answers and yields nothing

Instrumenting `tabsSeen` settled it in one press:

    tabsSeen: [{path:"/grades", kind:"grades_all", answered:true, injected:false},
               {path:"/",       kind:"dashboard",  answered:true, injected:false}]

The gradebook tab was open, answered, and needed no injection — yet there was
no read record for it and no stored grades. One explanation fits: the parser
recognised nothing on the real page, `readable` came back false, and
`main.js` dropped it down the UNREADABLE branch, **which recorded nothing at
all**. Invisible by construction.

Two fixes:

1. **`parseCanvasAllGradesPage` no longer looks for rows.** It iterated
   `tr, li, [role=listitem]`; this Canvas builds its cards from `<div>`s, so it
   found zero rows and gave up. It now works from the **course links** —
   `/courses/<id>`, which Canvas cannot restructure without breaking its own
   navigation — and walks *up* from each link until a container holds something
   percentage-shaped.

   That rewrite shipped a bug of its own, caught by the new fixture rather than
   by the user: the walk reached an ancestor holding every class, so a class
   showing "No grades" borrowed its neighbour's 93.75%. It now **stops the
   moment a container holds a link to a different course** — inventing a grade
   is the worst thing this file can do, so it stops rather than guesses.

2. **UNREADABLE carries the fingerprint.** The branch that hid this for days
   now records `pageKind` and counts, so a page that answers and yields nothing
   is visible on disk. It is the failure mode that hides best and therefore the
   one most worth writing down.

### Things that will bite you

- **`readable === false` is a real outcome, not an error path.** Anything that
  drops a page silently will hide the next layout change exactly as long.
- **`refresh()` has seven callers and they overlap.** Anything it touches needs
  to be safe under concurrency, not merely correct in isolation.
- **A registered content script is not in tabs that were already open.** Inject,
  do not ask the student to reload.
- **A feed assignment has an assignment id and nothing else.** Any new code
  that matches Canvas data to LockIn work must go through
  `findByExternalId()`, not `assignmentCanvasKey()` alone. This is the single
  most likely place for this bug to come back.
- **`grades` is a whole new slice, so schema v11.** The migration is additive
  and sets the window to the conservative default, which means an existing
  install *stops* its 30-minute feed refresh on upgrade rather than inheriting
  an automatic behaviour nobody chose. That is intended.
- **Three copies of the window rule.** Web (TS, source of truth), extension
  (JS, no build step), service (JS, LaunchAgent). Change one, change all three;
  `extension/tests/canvas-grades.test.mjs` runs the matrix and will fail loudly.
- **The service's `checkWindow` is pushed by the page**, on every load and on
  every change (`/api/canvas/window`). Until it arrives, the service refuses to
  auto-fetch.
- The passive observer now stops itself when the background refuses a passive
  read, so "only when I press the button" costs nothing while idle.

## Phase 17 — Canvas only (done)

The user's call, and the right one. Phase 16 built two legitimate Edgenuity
channels; Phase 17 deleted them, because neither could actually reach this
student's setup:

- the **course report** is downloadable only in the school Chrome profile, and
  cannot be opened in the personal one;
- the **progress email** arrives **weekly**, which is useless for live data.

An integration that is right once a week and wrong the other six days is worse
than no integration, because the app quotes it as if it were current. So
Edgenuity is gone in full — verification, screen capture, local OCR,
tesseract.js, the report and email parsers, the course model, the Gmail adapter
architecture, and the 5MB `eng.traineddata` that was sitting in the repo root.

The **School Companion and the context bridge went with it.** Their whole job
was cross-profile Edgenuity presence; with Canvas signed in alongside LockIn in
one profile, they answered a question nobody was asking.

### The transport: LockIn's own service, not only the extension

**Measured, not assumed:** a Canvas feed comes back with no
`Access-Control-Allow-Origin` header, so a page cannot read it. Something
outside the page has to fetch it. Phase 17 shipped only the extension for that,
and on the machine this was built for the extension was never installed — so
"Connect Canvas Calendar" was a disabled button, and the feature did not work at
all.

`scripts/canvas-feed.mjs` fixes that. The LaunchAgent that already serves LockIn
on 127.0.0.1 is a Node process, so same-origin rules do not apply to it. Where
the service is installed it is the better transport outright:

- no extension needed;
- it keeps fetching **while Chrome is closed**;
- it does not care which browser profile is in front.

`lib/canvas/feedTransport.ts` picks: service first, extension second, and the UI
says which answered. The feed URL is stored at `~/.lockin/canvas-feed.json`
with mode 0600, outside the web root so the server cannot serve it as a file,
and no response ever contains it.

`connect` **proves the URL works before reporting success** — it fetches once
and forgets the URL again if that fetch fails. "Connected" must never be shown
for an address that will fail quietly half an hour later.

### What Canvas does now

1. **Every 30 minutes, automatically.** The extension's alarm fetches and
   caches the feed (`refreshMinutes` default 30, floor 15); `useCanvasAutoSync`
   folds the cached text into assignments on load and every 30 minutes while
   the app is open. Reconciling stays on the page because only the page knows
   what LockIn already has.
2. **On startup.** `chrome.runtime.onStartup` → `startupSync()` fetches
   immediately rather than waiting up to half an hour, then — if
   `openCanvasOnStartup` is on — opens the Canvas dashboard in a **background
   tab** so the content script can read submission status.
3. **Graded versus undone.** A calendar feed carries due dates and nothing
   else. Submission status comes from the Canvas page reader (Phase 3), which
   is why the background tab exists at all.

### Invariant 5 is now scoped, deliberately

It said LockIn never closes a tab. It now says **LockIn may close a tab it
opened itself, and only that tab.** The rule was about never fighting the
student for their own browser, and that still stands — but a background tab
LockIn opened unasked is the one case where *leaving* it is the ruder option.
`closeCanvasSyncTab()` records the id, re-checks the URL before closing, and
runs from the heartbeat rather than a `setTimeout` (a worker killed mid-timer
would strand the tab).

### `lib/workState.ts` — the file that fixed the list

"Done" meant four different things and the UI flattened them into a tick box:

| State | Means |
| --- | --- |
| `graded` | Canvas has marked it |
| `submitted` | handed in, not marked yet |
| `done` | the student ticked it off in LockIn |
| `missing` | Canvas says the deadline passed unhanded-in |

Plus `overdue` (LockIn inferring lateness from a clock — weaker than `missing`,
which is Canvas asserting it), `due_today`, `upcoming`, `undated`.

`urgency()` is now the **only** comparator in the app: a coarse band times
1e15, plus the due timestamp as the tiebreak. So "most urgent first" is
literally chronological inside a band, and **priority never beats a due date** —
a Normal worksheet due in an hour outranks an Urgent essay due next week, and a
test pins that.

`groupByClass()` powers the column layout, ordering columns by their most
urgent item so the column you need is the one on the left.

### Things that will bite you if you don't know them

- **Phase 16 shipped a bug I reported as working: the calendar and activity
  message handlers were never added to the service worker.** The replace that
  should have inserted them silently no-opped, and I verified the *bridge*
  live rather than the calendar messages. If you add a `case MSG.X` to
  `handlePageMessage`, grep for it in the file afterwards — the switch is long
  enough that a failed insert looks like success.
- **Canvas section names are unusable raw.** A real feed carries
  `E4007-PPer 2 (11:40 AM - 12:30 PM)-Emmett` and
  `Accelerated Math ORIENTATION [[Chopra] Period 1 & 4: ACC Math]`. The second
  one **nests brackets**, which the original regex-based `splitSummary` could
  not see — so those assignments got no course at all and filed under
  "General". It now scans for balanced brackets, and `prettyCourseName()`
  strips section codes and class-time ranges. That transform may only remove
  noise it recognised: anything unmatched is returned unchanged, and a test
  pins that.
- **The reconciler heals a stale class name**, but only when the stored one is
  the placeholder `General` or is literally the un-tidied form of the incoming
  name (`prettyCourseName(existing) === incoming`). A name the student typed is
  never overwritten.
- **`PROTECTED_SETTING_KEYS` is now `['blockingEnabled']`.** It guarded the
  Edgenuity proof mode; rather than leave the parent-lock mechanism guarding
  nothing, it now locks the master blocking switch, which is the setting a
  student in Strict mode reaches for first.
- **A `.ics` file import is IMPORTED, a fetched feed is LIVE, and the only
  difference is `isLive`.** `IMPORT_KINDS` is gone: any record whose source is
  not currently answering reads as an import.
- **`official` is gone from `PaceReport`.** With Canvas the only source and a
  calendar feed publishing no verdict, every status is LockIn's own reading,
  and a permanently-false flag is a lie waiting to be re-enabled.
- **Verification records from Edgenuity are kept.** The v10 migration drops the
  slice, the link and the setting, but never a `verificationRecords` entry: a
  removed integration must not take a student's completion history with it.
  Assignments on the dead `Edgenuity` platform are remapped to `Other`.

### Deliberately not built

- **Any Edgenuity path at all**, until something exists that is both ethical
  and current. Neither condition is met today, and half of one is worse than
  neither.
- **Auto-opening Canvas in the *school* profile.** Chrome profile isolation is
  still not bypassed. This works because the user keeps Canvas and LockIn in
  the same profile; if that changes, the feature stops, and the UI says so
  rather than pretending.

## Phase 16 — The product phase (done)

> **Read Phase 17 first.** Everything below about Edgenuity — the progress
> email, the course report, the merge, the Gmail adapter — and about the School
> Companion and the context bridge describes code that **no longer exists**. It
> is kept because the reasoning still explains why the remaining architecture
> has the shape it does.


Phase 16 turned a pile of working phases into one product. Six things changed
shape; everything else was kept.

### What was removed, and why

**Edgenuity page reading (Phases 11 and 14) is gone in full** — the content
scripts, the background reader, the AppleScript bridge, the `browser` source,
`browserBaseline`, and every test that guarded them. The decision was the
user's: reading Edgenuity's own markup is off the table however carefully it is
done. The legitimate channels below replace it.

Consequences to know:
- `EDGENUITY_SOURCES` is now `['camera']` — a shared-screen frame is the only
  live capture path left. `VERIFICATION_TRUSTS` still contains `browser`,
  deliberately: stored verification records from before Phase 16 carry it and
  must still render.
- Schema v9 migrates any `config.source === 'browser'` back to the screen path.
  Leaving it would strand the assignment on a code path that no longer exists —
  the same class of bug as the `enhanced` requirement Phase 15 had to defuse.
- `scripts/serve.mjs` kept its bridge *fence* (loopback binding, the
  `x-lockin-bridge` header, origin check) with an empty route set, because the
  new context bridge mounts behind exactly those rules.

### 1. Provenance (`types/source.ts`, `lib/sources/`)

Every externally-sourced record carries a `SourceRecord`: kind, sourceId,
externalId, timestamps, confidence, `isLive`, `syncError`, `rawDataRetained`.

**Freshness is derived, never stored.** `classify(record, now)` works out
LIVE / SYNCED / IMPORTED / VERIFIED / STALE / MANUAL / UNAVAILABLE every time it
is asked. There is deliberately no setter for `DataState` — a stored "LIVE" is a
lie the moment the clock moves.

Rules the model exists to enforce, each with a test:
- an erroring source is UNAVAILABLE however recent its last good sync;
- a source that never synced is UNAVAILABLE, not STALE;
- an import is never LIVE, however recent;
- `isLive` is forced `false` on load, always — a save file cannot assert that a
  connection is answering.

### 2. The Pace Engine (`lib/pace/`)

One place decides AHEAD / ON_TRACK / AT_RISK / BEHIND / UNKNOWN, and returns its
reasoning as sentences so two screens cannot describe the same state
differently. `UNKNOWN` is a first-class answer.

- A stale feed produces UNKNOWN with the source named, **never** BEHIND.
- Nothing is called overdue on a due date that cannot currently be believed —
  except a MANUAL one, which is the student's own claim being repeated back.
- `official` is only true when a source *published* a status. Everything LockIn
  works out itself is labelled an estimate, in the UI as well as the data.
- Product-aware: classic Edgenuity's actual-vs-target pair is compared inside a
  band (`ON_PACE_BAND`, LockIn's own number and documented as such); EdgeEX and
  UNKNOWN get the same comparison but are never presented as the vendor's
  verdict.

### 3. Canvas Calendar Feed

`lib/ics/parse.ts` (RFC 5545: folding, quoted parameters, TZID resolved through
`Intl`, bounded recurrence only) → `lib/canvas/calendarFeed.ts` (Canvas's
`Title [Course]` summaries and `event-assignment-<id>` UIDs) →
`lib/canvas/calendarReconcile.ts` (a pure diff).

**The extension does the fetching**, and this is not an implementation detail:

1. Canvas feeds carry no CORS headers, so a page physically cannot read one.
2. The feed URL is a bearer credential. It lives in extension storage, is never
   echoed back to the page, and therefore cannot reach `localStorage`, the
   export file, or a screenshot. `sanitizeCalendarView` has no field for it.

Reconciliation rules, all tested: identity is the UID; a moved date updates in
place; the student's status, logged minutes, estimate and priority survive every
sync; **absence means nothing** (only an explicit `STATUS:CANCELLED` marks
anything, and even that never completes it).

### 4. Edgenuity, legitimately

- `lib/edgenuity/progressEmail.ts` — parses a progress report the authorized
  recipient already has. Handles both published shapes (a table with positional
  cells, and labelled blocks). HTML becomes text **without ever building a
  node**, so an `onerror` image in a report body cannot run.
- `lib/edgenuity/courseReport.ts` — CSV/TSV/HTML activity schedules. Completion
  is tri-state: a blank cell is not a "no".
- `lib/edgenuity/merge.ts` — per-field provenance. Progress from this morning's
  email, schedule from a report three days ago, one course. `preferSource`
  resolves conflicts (live > imported, then newer, then confidence), so a stale
  re-import cannot overwrite fresh numbers.
- `lib/edgenuity/gmailAdapter.ts` — real architecture, honest refusal. No client
  id is shipped, because a shared one would let every install read mail through
  this project's identity.

**Honest limitation:** the fixtures are synthetic. The matchers are written
against the documented field names, and validating them against a real report is
the whole of the remaining work.

### 5. The Companion becomes a half of the product

- `background/activity.js` — tab **metadata** only: a hostname and a category,
  three buckets with NEUTRAL the default, day-scoped counters, and a 15-minute
  elapsed cap so a sleeping machine cannot report six hours of study. A test
  asserts the stored shape cannot reconstruct a browsing session.
- `background/reminders.js` — one delivery gate (`deliver()`) with a global
  cooldown, so five subsystems noticing the same assignment produce one buzz.
  Per-assignment snooze that comes back. Notification actions that open the app
  rather than starting a session behind the reducer's back. Presence
  suppression, with the last stage before a deadline always allowed to speak.
- Popup rebuilt; `options/` added.

### 6. School Companion and the context bridge

`school-companion/` is a separate MV3 package for a school profile. It is
structurally incapable of reading a page: no content script, no `scripting`
permission, one host permission pointing at `127.0.0.1`. It ships disabled and
refuses to send anything until somebody ticks a box saying their school allows
it — unticking it switches it off again.

`scripts/context-bridge.mjs` is the threat model written down: loopback binding,
a rotatable pairing secret compared in constant time, a non-simple header,
a two-minute clock window with nonce replay protection, whitelist schema
validation, a 4KB body cap, memory-only storage. There is no field for a URL, a
cookie, a course or a score.

**Chrome profile isolation is not bypassed anywhere.** The school profile sends,
the personal profile reads, and a person carries the pairing code across by hand.

### Things that will bite you if you don't know them

- **`dueTimestamp()` returns `Number.MAX_SAFE_INTEGER` for undated work**, and
  that assumption caused the same bug three times in one phase: undated work
  silently filed at the far end of "Upcoming", and two different screens
  claiming "everything due tomorrow is handled" while an undated assignment sat
  unfinished in view. Anywhere you compare a due date, decide explicitly what
  undated means. In LockIn it means *outstanding*.
- **The Assignments page lands on the first non-empty view**, not always Today.
  A student whose next deadline is Thursday would otherwise open the page to an
  empty screen and go looking for their own work.
- **`web/src/lib/context/client.ts` is the only file in `web/src` allowed to
  call `fetch`**, and `release.test.mjs` names it explicitly. It only ever calls
  same-origin relative paths; the test asserts that too.
- **The a11y and Canvas E2E suites both broke on this phase's UI**, and both
  were right to. The Canvas one pinned `CURRENT_SCHEMA_VERSION = 8` under a
  comment explaining why pinning it had already broken once; it now reads the
  constant out of `storage.ts`.
- **`chrome.notifications.create` may only be called from `deliver()`.** That
  single door is the entire mechanism behind the no-spam guarantee.
- **The phone bottom bar needs its own answer whenever the sidebar changes.**
  Parent, Settings, Help and Privacy became unreachable at 375px the moment the
  sidebar gained a secondary row; there is now a More sheet, and it closes on
  navigation.
- **`usePace` memoises on the minute, not the second.** The store's clock ticks
  every second, and computing pace in a render body would re-run the engine 60×
  a minute and re-render every consumer with a new object.

### Deliberately not built (and why)

- **PDF course reports.** No PDF text extractor is bundled, and OCR-ing a PDF
  that contains perfectly good text would be slow, lossy and confidently wrong
  about numbers. The import says so and asks for CSV.
- **Canvas OAuth.** The adapter boundary is real (`lib/canvas/api.ts`,
  `lib/sources/adapter.ts`); the authorization is not. A Developer Key needs a
  school administrator and a confidential client secret, which needs a backend.
- **Gmail sync.** See above — architecture yes, shipped client id no.
- **Trend charts.** `hasTrendData()` exists and is honest: fewer than five
  points across a fortnight is a scatter, not a trend, and drawing a line
  through it would invent a direction.
- **Cross-profile anything beyond context.** By design and by policy.

## Phase 15 — Camera and Enhanced Proof removed (done)

The camera assumed two machines — a school computer showing Edgenuity, the
student's own device holding the camera. On one Mac the camera faces the
student, so it could never photograph the screen beside it: the path was not
merely superseded, it never worked on this setup at all.

Enhanced Proof went with it, because it *was* the camera: a one-time code
written by hand and photographed in the same frame. A shared window cannot hold
up a piece of paper.

### What replaced them
Screen sharing (Phase 12) for an image, page reading (Phases 11 and 14) for the
numbers. Both are machine-read; neither can be satisfied by typing.

### Things that will bite you if you don't know them
- **`requiredTrustFor()` is now a constant `'standard'`** and deliberately
  ignores stored `requiredVerificationTrust` and `edgenuityProofMode`. A save
  file predating this still says `enhanced`; honouring it would strand the
  assignment forever. There is a test for exactly this.
- **`settings.edgenuityProofMode` and `parentControls.lockVerificationSettings`
  still exist but are inert.** Removing them means a storage sweep, and the
  reducer's locked-field mechanism is worth keeping for the next lockable
  setting. Nothing in the UI sets either any more.
- **Five of the ten security bypass tests went with the feature they guarded**
  (Enhanced satisfaction, challenge replay, cross-assignment codes). The other
  twelve pass unchanged. Do not read the smaller number as weaker coverage —
  read it as fewer things to bypass.
- **Deleting `AssignmentTrustRow` from `ParentControlsPanel` took the whole
  component with it, twice**, because a naive "delete from here to the next
  function" walked backwards into the main component's doc comment. The
  compiler caught it both times. Cut by explicit function boundaries.

---

## Phase 12 — Screen-capture proofs (done)

`getDisplayMedia` as a third `ProofCaptureSource` (`live_screen`), for the case
Phase 4 never anticipated: **Edgenuity and LockIn on the same Mac.** The camera
path assumed two machines — a school computer showing Edgenuity, the student's
own device holding the camera. On one iMac the camera faces the student, so no
amount of framing help makes a screen photograph itself. Before this, that
setup had no working verification at all.

It also solves the two-profile problem without touching the school profile:
capture happens entirely in the personal profile, so there is no extension to
install, no bookmark to sync, and nothing for a district to see.

### Things that will bite you if you don't know them

- **`getDisplayMedia` prompts on every single call.** Permission can never
  persist, by spec. Do not build anything that assumes a held stream between
  the before and after readings.
- **It needs transient user activation**, so `LiveScreenCapture.start()` must
  be called straight out of a click handler. `CameraCapture` can start its
  stream in an effect; `ScreenCapture` cannot, and that is the only structural
  difference between the two components.
- **A page cannot pre-select a window** — Chrome refuses on purpose.
  `monitorTypeSurfaces: 'exclude'` and `selfBrowserSurface: 'exclude'` are the
  most steering allowed.
- **macOS gates it twice.** Chrome needs Screen & System Audio Recording in
  System Settings, active only after a relaunch, and macOS 15+ re-prompts
  periodically. `describeScreenError` says so rather than leaving a dead button.
- **Enhanced Proof cannot use it,** and the reason is physical, not policy: a
  hand holding a written code does not appear inside a screen capture. So
  `proofTrust` caps `live_screen` at `standard`, and the guidance step disables
  the share button when Enhanced is in force. Invariant 13's logic, unchanged.
- **Both halves of a session must be the same source.** Mixing them would let a
  student photograph a real screen for the starting reading and share a
  doctored window for the final one.
- **Gate 1 in `checkProgress` is now "a live stream this tab opened"**, not "a
  camera". Files, fixtures and hand-edited save files are refused exactly as
  before — `coerceProof` in `storage.ts` still reads anything that is not
  literally `live_camera` or `live_screen` back as `fixture`.

---

## Phase 11 — Edgenuity browser reading (done)

Progress read off the Edgenuity page the student opened, instead of
photographed. Mirrors the Canvas pack file-for-file: `extension/edgenuity/`
(urls, detector, parser, messaging, main, connect) + `background/edgenuity.js`
+ `web/src/lib/edgenuity/{browserVerification,browserProvider}.ts`, feeding the
same `EDGENUITY_BROWSER_READING → recompute()` chain. The camera path is
untouched and still the default.

### Why it is built the way it is (the research answered this)

- **It never issues a request to Edgenuity.** No fetch, no background tab, no
  polling of the Course Report. Imagine Learning's Terms of Use (effective
  2019-11-19) prohibit using "automated agents or scripts … to generate
  automated searches, requests, or queries to (or to strip, scrape, or mine
  data from) our Sites". Reading what the student's own navigation already
  rendered generates no traffic; fetching the report in the background would be
  squarely inside that clause. `syncEdgenuityNow()` therefore asks open tabs to
  re-read and answers "no-edgenuity-tab" when there are none. **Do not add a
  fetch here.**
- **It is inert on assessments**, checked twice (URL keywords and page text).
  Progress doesn't move during a test, so this costs nothing, and it keeps
  LockIn away from Proctorio, which "will close any other extensions during
  assessments" anyway.
- **Two integers per course, never content.** `messaging.js` has no field for
  activity names, questions or scores, so no markup can push them into storage
  or the export.
- **The permission is Edgenuity-only** and optional, requested from
  `edgenuity/connect.html` like the Canvas one.

### Things that will bite you if you don't know them

- **The parser names no class selectors, on purpose.** Edgenuity's markup is
  unpublished and behind a login, so it reads only ARIA (`role="progressbar"`,
  `aria-valuenow`) and rendered text ("12 of 40 activities"). When the two
  disagree it reports the page unreadable rather than picking one.
- **Edgenuity's percentage is time-weighted** — "completed assignments versus
  total assignments weighted by the estimated time" — so it moves
  non-linearly and "+3%" means different work in different courses. The
  activity-count target is the honest default for this path.
- **`browserBaseline` is load-bearing and easy to lose.** It is rebuilt field
  by field in `storage.ts`; a field added to the type but not there is silently
  dropped on reload, which would reset the baseline and re-credit work. This
  already happened once with `lastVerifiedTrust` in Phase 5.
- **`VERIFICATION_TRUSTS` gained `browser`** between `standard` and `enhanced`,
  and `RequirableTrust` was introduced so a *requirement* stays "standard or
  enhanced" — `browser` is something a reading can be, never a bar a student
  can be asked to clear.
- **The suites carry no Edgenuity markup fixtures.** Inventing them would test
  the parser against itself. `edgenuity-browser.test.mjs` tests the behaviour
  that must hold whatever the markup is; the real page is validated by hand.

### Deliberately not built (and why)

- **Fetching the Course Report.** See above — the one approach that could
  actually get an account flagged.
- **Replacing the camera.** Edgenuity often runs on a school computer LockIn
  cannot see, and a district can disable the extension. Two paths means the
  feature degrades instead of dying.
- **Reading the student home page course cards.** The card shows a
  school-selected metric that may be a grade, not progress.

---

## Phase 10 — Canvas discoverability (done)

Built against `docs/research/2026-08-canvas-discoverability.md`.

The bug was structural rather than cosmetic, and it is worth stating precisely
because it is easy to reintroduce: **`CanvasSettings` was rendered from exactly
one place, and the import list was reachable from exactly one place — inside
it.** A student who connected Canvas and browsed their courses came back to an
app that looked identical, with the detections sitting unmentioned in
`state.canvas.detected`.

`components/features/CanvasCallout.tsx` is now the contextual surface, with
three states: offer (empty list, not connected), announce (connected, work
waiting), and render nothing. It is placed on the Dashboard and the Assignments
page.

### Things that will bite you if you don't know them

- **`importCandidates()` is the "is there anything to say" test.** It filters
  out anything already linked or ignored, so a banner driven by
  `canvas.detected.length` would nag forever about work already imported.
- **Every entry point lands on the import list after a successful connect,**
  including the one in Settings. "Connected." with no next step is what made
  the flow feel like it had gone nowhere.
- **`CanvasSetupModal` is exported from `CanvasSettings.tsx`** so the callout
  drives the same flow rather than growing a second copy. There is one connect
  path; keep it that way.
- **Canvas is deliberately not in first-run onboarding.** Setup should be
  triggered by behaviour, not by a step counter — and Phase 9 had just cut
  onboarding from seven steps to four for that reason.
- **The banner is dismissible per session only.** Deliberate: a permanent
  dismissal would need storage, and the case it protects against (work waiting
  that you keep ignoring) is one where a reminder next session is correct.

## Phase 9 — Focus Guard and consent (done)

Built against `docs/research/2026-08-ethical-self-control-design.md`. Read the
brief before changing anything here; the design choices are evidence-backed and
several of them are counter-intuitive.

**The constraint that shapes everything: a website cannot block websites.**
There is no permission for it. Blocking needs the extension, a system proxy, or
OS controls. So LockIn now offers both halves — enforced blocking via the
extension, and Focus Guard, which observes and admits it cannot obstruct.

### Things that will bite you if you don't know them

- **A `setState` updater must be pure — StrictMode will catch you.** The first
  Focus Guard hook dispatched to the store from *inside* `setPeriods(fn)`, and
  every trip away was counted **twice** in development, because StrictMode
  deliberately double-invokes updaters. The authoritative list now lives in a
  ref, mutated in the event handler, with React state only mirroring it for
  render. Found by driving the real UI, not by a unit test.
- **The Idle Detection API is forbidden.** Mozilla declared it harmful and
  WebKit refused it, both citing surveillance. The reason is written into
  `lib/focusGuard.ts` and asserted by `phase9.test.mjs` so it cannot quietly
  come back "for accuracy".
- **Focus Guard observes; it must never obstruct.** Nothing in it may end,
  extend, pause or unlock Focus Mode, and a test asserts `focusMode` is
  byte-identical after an away event. The moment it punishes, it becomes the
  paternalistic intervention the research says gets abandoned.
- **The wording is load-bearing.** Reactance is the documented failure mode of
  friction-based tools, and guilt is the fastest route to it. A test greps the
  Focus Guard strings for scolding language.
- **Hard and soft commitments fail in opposite directions.** Soft pledges get
  high take-up and modest effect; enforced restriction is stronger but few
  adopt it. That is *why* both ship, and why Focus Guard needs no setup.
- **"Not now" has to lead somewhere.** A refused permission that loops back to
  the same prompt is a dark pattern. Refusing turns `blockingEnabled` off
  rather than leaving it armed-but-broken, and `blockingAsked` records that the
  question was put so it stops being asked.
- **Quick-add never invents a due date.** Undated work is real work. Leftover
  text becomes the title, so an unrecognised word can never be swallowed, and
  everything parsed is shown back before anything is created.
- **A weekday name always means the *next* one.** "due friday" said on a Friday
  means the coming Friday — a deadline already in the past is a worse guess
  than one a week out.

### Capture: one field, nothing required

Built against `docs/research/2026-08-task-capture-ux.md`.

- **Seven fields was the bug.** Baymard puts 7+ fields at 67.8% abandonment,
  ~4.1% per field, and finds field reduction beats visual redesign. The old
  `AssignmentForm` asked for seven-plus, every time.
- **`estimateFor` is the interesting part.** The planner needs
  `estimatedMinutes`, and Motion — the app people call exhausting — *requires*
  duration, date and time. Sunsama never asks: it defaults, and learns from
  logged time. LockIn does the same, preferring the student's own median for
  that subject once there are three finished assignments, then a keyword guess,
  then 30 minutes.
- **`estimateSource` exists so the UI cannot lie.** Saying "based on your
  Science work" to someone with no finished Science work is a small lie about
  where a number came from, and those are expensive. Each explanation is only
  shown when it is true — caught in the browser, not by a test.
- **`spans` exist so the input can underline what it claimed.** Todoist's
  parser is trusted because it shows its work inline. Everything a span covers
  is removed from the title, so the two can never disagree.
- **`chapter` is not a work type.** It is a unit of material. With it in the
  60-minute bucket, "read chapter 4" matched before "read" could.
- **A weekday means the *next* one**, and a bare `1/5` already past means next
  year — school crosses a year boundary.

### Deliberately not built (and why)

- **Blocking from the page.** Impossible. Not a todo.
- **Requiring a duration to plan.** That is Motion's trade, and it is the one
  users name as exhausting. Guess, learn, and let it be corrected.
- **Idle/presence detection.** See above.
- **Streaks, points or a dying tree.** Forest's loss aversion works, but an
  invented score invites arguing about the score. The count and the minutes are
  the real cost, shown plainly.
- **Telling a parent where the student went.** Not collected, not collectable,
  and restrictive monitoring correlates with *worse* outcomes anyway.

## Phase 8 — Release readiness (done)

No new product features. Phase 8 turned a working developer build into
something that can be installed from a clean checkout, built reproducibly, run
as a production website with a packaged extension, and evaluated by somebody
who was not in the room.

### Things that will bite you if you don't know them

- **`import.meta.env.DEV` has to be literal at the point Rollup can see it.**
  Passing `devFixtures` as a prop into a child component defeats it: Rollup
  cannot prove the prop is false, so the branch — and the fixture paths inside
  it — survived into the production bundle. The guard is now repeated at the
  render site, and `test:release` fails the build if it regresses.
- **`web/public/` is copied verbatim into `dist/`.** The Edgenuity fixture
  images shipped that way until a Vite plugin started deleting `dist/fixtures`
  after each build.
- **A dialog's `autoFocus` field steals focus before any effect runs.** React
  applies `autoFocus` during the commit, so a Modal that records "what had focus
  before I opened" in an effect records *its own input*. The opener is captured
  during render instead. This was a real bug, found by the a11y suite.
- **Focus restore is deferred by a timeout, and claimable.** Several call sites
  swap which component renders an open dialog (`PinModal` between a PIN prompt
  and a form; `DataPanel` between a confirmation and a PIN prompt), and
  StrictMode double-invokes effects. Both look like "teardown, then setup", so
  the incoming dialog claims the pending restore instead of recording a control
  inside itself.
- **A grid item defaults to `min-width: auto`.** It refuses to shrink below its
  content, so `truncate` never engages. A long exam name pushed the Exams page
  into 332px of horizontal scrolling on a phone until the card got `min-w-0`.
  If a new grid renders user text, it needs the same.
- **`prettyDomain` used to strip a hard-coded list of suffixes** and then take
  the last label, which displayed `myschool.edu` as "Edu" and told a student
  they had tried to open "Test". It now drops the public suffix and takes the
  label in front of it. The block page shows the friendly name *and* the exact
  host, because the friendly name is a nicety and the host is the fact.
- **The activity log reserves room for accountability events.** A plain ring
  buffer lets a busy afternoon of ordinary edits evict every parent override and
  emergency exit — exactly the history the Parent Dashboard exists to show.
- **`load()` now reports what it repaired.** `loadWithRecovery()` returns the
  state and a `StorageRecovery`; the notice is only shown when records were
  actually lost, because "we trimmed your log" is not news.
- **Version lives in three files** — `package.json`, `extension/manifest.json`
  and `web/src/version.ts` — and `test:release` fails if they disagree.
- **The parent and Edgenuity E2E suites are genuinely flaky**, because they run
  real OCR over rendered fixtures. Re-run once before investigating.

### Deliberately not built (and why)

- **Import.** Export is enough. An importer is a path that turns a text file a
  student can edit into verified progress, and no amount of validation makes
  that a good trade.
- **Pointer drag-and-drop for planner ordering.** Up/down controls already work
  with a keyboard and on a phone, and they are the accessible path. Dragging is
  a nicety that would have cost half the phase.
- **Error telemetry.** No Sentry, no reporting endpoint. Technical detail goes
  to the console in development only.
- **A production origin.** None exists. The build refuses to invent one rather
  than shipping a dead default.

## Phase 7 — Smart Study Planner (done)

`/planner` (Today · This Week · Exams · Availability · Settings) plus a Today's
Plan card on the dashboard. A pure engine in `web/src/lib/planner/` turns
assignments, exams, estimates and availability into a deterministic daily
schedule. See the README section "Smart Study Planner".

### Things that will bite you if you don't know them
- **The plan is derived, and that is load-bearing.** Remaining work is
  `estimate − logged`, recomputed on every rebuild. Do not "optimise" this by
  storing remaining minutes on the plan — the no-work-is-lost guarantee comes
  entirely from the fact that nothing carries them.
- **Item status is derived too** (`annotatePlan`), from completed sessions and
  assignment status. The stored plan's `status` field is only what the
  generator last wrote; read plans through `livePlan()`.
- **`maybeReplan` compares the new plan to the old one and keeps the old object
  when they match.** Without that, every keystroke in a settings field would
  produce a new plan version, a storage write and a "your plan changed" story
  for an identical plan.
- **`PLANNER_UPDATE_SETTINGS` deliberately writes no activity entry.** It fires
  per keystroke; logging it would flush 300 entries of real history in a
  minute.
- **Overdue work is schedulable across the whole horizon**, not just up to its
  own past deadline — capping it there made late homework unschedulable the
  moment today filled up. Its urgency score is what pulls it early instead.
- **`lastRecovery` is the one planner fact that is stored rather than derived.**
  A rebuilt plan has no past days, so the "75 minutes from yesterday moved"
  note has to be measured during the rollover or not at all.
- **Exam study never lands on or after the exam day** (unless the exam is
  today), and the final review is reserved *before* the greedy fill runs.
- **A day allows at most two sessions of one task.** That is why a 100-minute
  day with 45-minute chunks plans 90, not 100 — raise the chunk size, not the
  session cap, if you want it fuller.
- **Day rollover happens in `TICK`,** guarded by comparing the plan's
  `planningHorizonStart` to today. It fires once a day, not once a second.

### Deliberately not built (and why)
- **Calendar sync.** Fixed commitments are recurring weekly blocks entered by
  hand. A real calendar integration means accounts and network calls, and
  LockIn has neither.
- **Semantic chunking.** LockIn does not know what part of an essay you are
  writing, so chunks are numbered sessions and the UI does not pretend
  otherwise.
- **Drag-and-drop reordering.** Reordering is done with up/down controls, which
  work with a keyboard and on a phone. Pointer-based dragging is a Phase 8
  polish item, not a planning capability.
- **Parent control of the schedule.** The Parent Dashboard may look at weekly
  planned load; it does not approve schedule changes. Phase 7 is not a
  surveillance surface.

## Phase 6 — Parent Accountability Dashboard (done)

`/parent`, gated by the existing PIN. Read-only review of verification and
Focus Mode history, plus the switches that raise proof requirements. See the
README section "Parent Accountability Dashboard".

### Things that will bite you if you don't know them
- **The parent session is React state, on purpose.** Do not "improve" it by
  persisting it — the reload/restart re-lock depends on it being ephemeral.
- **Selectors read typed fields, never log prose.** `selectOverrideHistory` is
  the one exception: it recovers the emergency-exit reason from the message,
  because that is where the existing code put it. If you reword that sentence,
  fix the selector.
- **`FocusRun` is written by the reducer as sessions happen.** History cannot
  be reconstructed for past sessions, which is why the v5 migration starts it
  empty rather than inventing entries.
- **Blocked counts are deltas.** The extension only reports running totals, so
  a run snapshots `blockBaseline` at the start and subtracts at the end.
- **`PARENT_CLEAR_HISTORY` has three scopes and none of them touch
  assignments,** exams, the PIN or the blocklists. Keep it that way.
- **The E2E waits must be scoped to `[role="dialog"]`.** The panel behind the
  dialog now says "Enhanced Proof required", which matched a looser body-text
  wait and made a check read the screen mid-OCR.

### Deliberately not built (and why)
- **Remote parent access** — accounts, email, SMS, push, a cloud dashboard.
  Phase 6 is entirely local and there is no server to add one to.
- **Any surveillance feature.** Browsing history, screenshots, webcam,
  location, keystrokes and message monitoring are all out, and most are
  impossible without first starting to collect data LockIn refuses to collect.
- **A productivity score.** No transparent formula exists for one, and an
  arbitrary number invites arguing about the number instead of the work.

## Phase 5 — Enhanced Proof (done)

A one-time code, issued seconds before the shutter, that has to appear in the
same frame as the Edgenuity progress. The point is narrow: **a photo taken
before the code existed cannot contain it.** See the README's "Enhanced Proof"
section for the flow.

### Things that will bite you if you don't know them
- **The alphabet is load-bearing.** Codes avoid every OCR-confusable character
  (`0/O`, `1/I/L`, `5/S`, `8/B`, `2/Z`, `6/G`, `U/V`) so matching can demand an
  *exact* string. If you widen the alphabet you will be forced into fuzzy
  matching, and fuzzy matching turns OCR noise into a passing grade.
- **Every code contains a letter and a digit**, which is what stops ordinary
  page words (`PROGRESS`, `MATH`) from ever being candidate tokens.
- **tesseract.js defaults to `SINGLE_BLOCK` segmentation**, which silently drops
  anything outside the main text column — including a code held beside the
  screen. `lib/edgenuity/ocr.ts` sets `PSM.AUTO`; the OCR test mirrors it. If
  codes stop being detected, check that first.
- **Fixtures print the code; real students write it by hand.** Handwriting is
  harder for OCR than anything in the test suite, so field reliability will be
  lower than the suite suggests. The UI leans on this: retakes are free and the
  same code stays valid for five minutes.
- **The E2E renders camera frames on demand** (`custom:<percent>:<code>` in
  `edgenuity-fixtures.mjs`) because the code is random and cannot be pre-baked.
  Swapping the frame while the camera is open does nothing — Chrome reads the
  file when the stream *starts*, so the helper closes the camera first.
- **Scope UI clicks to `[role="dialog"] button` in the E2E.** The assignment
  panel behind the dialog has its own "Cancel", which abandons the session.

## Phase 4 — Edgenuity live-camera verification (done)

Built and verified end to end: a live camera photo before working, local OCR, a
second photo after, a before/after comparison, and the existing Focus Mode
engine doing the unlocking. See the README section "Edgenuity live-camera
verification" for how it works.

### Things that will bite you if you don't know them
- **`web/public/ocr/` is generated**, not committed. `npm run vendor:ocr` (also
  run by `predev` / `prebuild`) copies the engine out of `node_modules`. If OCR
  fails with a bare `importScripts` network error, a core variant is missing —
  tesseract.js picks scalar / SIMD / relaxed-SIMD at runtime and all three are
  vendored for that reason.
- **A photo of an Edgenuity page is almost pure white.** The image-quality check
  therefore judges detail (Laplacian variance), not brightness; an earlier
  brightness threshold rejected every real capture as "washed out".
- **Word positions, not lines, decide which percentage is course progress.** A
  text-only parse cannot tell `43%` from `92%` on a two-column page.
- **The E2E always trips the "too fast" guard** and takes a confirming photo,
  because it verifies in seconds. That is the intended behaviour, not a flake.
- **Fixtures are generated**, into `extension/tests/fixtures/edgenuity/` and
  `web/public/fixtures/edgenuity/`: `npm run fixtures:edgenuity`.

### Deliberately not built (and why)
- **QR-code challenges.** `ChallengeType` includes `qr_code` and nothing
  implements it. Displaying a QR needs a second screen, and the common setup is
  two devices: the school computer and a phone. Do not design around three.
- **Activity counting is experimental** and says so in the UI; it needs the
  activity name read confidently in both photos or it refuses.
- Canvas OAuth / Developer Keys / access tokens, AI or vision services, mobile
  app blocking, parent cloud dashboard, accounts, cloud sync, analytics,
  anything paid, and anything that touches the school computer.

---

## Known rough edges (documented, not bugs to "fix" blindly)

- The extension holds broad host access (`http://*/*` + `https://*/*`, narrowed
  from `<all_urls>` in Phase 8) because Chrome requires it for DNR **redirect**
  rules against user-chosen sites — verified by removing it and watching
  blocking break. Consequence: Chrome shows **no new prompt** when connecting
  Canvas, and the UI says so honestly rather than faking consent.
- Reminders only fire while a LockIn tab is open (no server, no push).
- Canvas detection only sees pages the student actually opens.
- Canvas modules are `web_accessible_resources` (content scripts can't use
  static imports), so a site can detect LockIn is installed. No secrets in them.
- Two LockIn tabs are last-writer-wins; Canvas verification is idempotent so it
  can't double-count.
- Edgenuity verification needs a secure context for the camera:
  `http://localhost:5173` is fine, a plain LAN address like
  `http://192.168.1.5:5173` is not. Settings says so rather than showing a dead
  button.
- The first OCR of a session spends a few seconds starting the engine. It is
  bundled locally, so this is decompression, not a download.
- Photo verification makes casual lying harder. It cannot prove the
  photographed screen was genuine, and nothing in the UI claims otherwise.
  Enhanced Proof narrows this to *prepared* photos; someone standing in front
  of the right screen with a pen still satisfies it, by design and by necessity.
- Enhanced Proof costs the student a written code per capture. It is off by
  default for that reason — turning it on is a decision, not a default.
- A 100-minute day with 45-minute chunks plans 90, not 100. Two sessions per
  task per day is a deliberate cap; raise the chunk size, not the cap.
- The main JS bundle is ~590 KB (~171 KB gzipped), dominated by tesseract.js.
  Splitting it further was not attempted: the OCR engine is loaded lazily
  already, and the remaining size buys reliability that a smaller bundle would
  not.
- **The project is not a git repository.** There is no history, no branches and
  no undo. `git init` would be the single highest-value thing to do next.
- **No license has been selected.** The project is private; nobody has usage
  rights.
