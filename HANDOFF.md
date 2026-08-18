# LockIn — handoff for the next session

**Read this file first, then `README.md`.** Phases 1–8 are complete, tested,
and must not be rebuilt. `README.md` is the developer guide; this file is the
architecture, the invariants, and the reasoning behind them.

Project root: `/Users/arjun/lockin` (not a git repo — no remote, no commits)

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
| 4 | **Edgenuity live-camera verification** — camera capture, local OCR, before/after progress comparison, cumulative progress, Focus Mode unlock | **Done** |
| 5 | **Enhanced Proof** — one-time challenge codes issued per capture, machine-detected in the photo, trust levels, anti-replay | **Done** |
| 6 | **Parent Accountability Dashboard** — PIN-gated `/parent`, verification review, focus history, parent-controlled proof requirements, local export | **Done** |
| 7 | **Smart Study Planner** — deterministic daily schedule from due dates, estimates, exams and availability; adaptive rescheduling; `/planner` | **Done** |
| 9 | **Focus Guard + consent + capture** — Page Visibility honor mode, permission-style blocking consent, one-field assignment capture with learned estimates, four-step onboarding | **Done** |
| 12 | **Screen-capture proofs** — share the Edgenuity window instead of photographing it; for Edgenuity and LockIn on one machine, and across two Chrome profiles | **Done** |
| 11 | **Edgenuity browser reading** — read course progress off the Edgenuity page the student opens, no camera; assessment-inert; activity-count targets | **Done** |
| 8 | **Release readiness** — environment-configurable origins, extension packaging, protocol versioning, privacy page, data export, storage recovery, retention caps, accessibility audit, security review, release + a11y + performance suites | **Done** |

### Test counts (all passing, all local fixtures — no real Canvas or Edgenuity account)

**Pure logic and reducer state** — `npm test`, ~3 seconds, no browser:

| Suite | Checks | Command |
| --- | --- | --- |
| Blocking, Canvas, Edgenuity, challenges, Enhanced Proof, parent, planner | 291 | (the ten suites `npm test` chains) |
| Storage recovery: corruption, migration, retention, quota | 18 | `npm run test:storage` |
| Security: the ten bypass paths | 22 | `npm run test:security` |
| Date/time boundaries and clock changes | 19 | `npm run test:time` |
| Release safety: packaging, versions, export secrets, no-network | 17 | `npm run test:release` |
| Performance budgets on a 100-assignment dataset | 7 | `npm run test:perf` |

**Real browser** — needs Chrome for Testing, and (except the release suite) the
dev server on `:5173`:

| Suite | Checks | Command |
| --- | --- | --- |
| Canvas parser (real DOM, in Node) | 28 | `npm run test:parser` |
| Phase 2 blocking e2e | 26 | `npm run test:e2e` |
| Canvas e2e | 57 | `npm run test:canvas-e2e` |
| Edgenuity OCR (real engine, real images) | 42 | `npm run test:edgenuity-ocr` |
| Edgenuity e2e (real camera API) | 31 | `npm run test:edgenuity-e2e` |
| Enhanced Proof e2e (real camera + codes) | 34 | `npm run test:edgenuity-enhanced-e2e` |
| Parent Dashboard e2e (PIN, controls, enforcement) | 51 | `npm run test:parent-e2e` |
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
5. **Never** `chrome.tabs.remove()`, never close tabs, never fight the browser,
   never hide `chrome://extensions`, never trap the user (emergency exit always
   works).
6. **Page data is untrusted.** Everything crossing a trust boundary is rebuilt
   field-by-field with caps; unknown keys are dropped. No `eval`, no `innerHTML`
   with detected content.
7. **Local only.** No network calls in either half of the project. No analytics,
   no tracking, no browsing history — block stats are per-domain counts only.
8. **Schema migrations, never wipes.** Bump `SCHEMA_VERSION` in
   `web/src/lib/storage.ts` and add a `MIGRATIONS[n]` step. Currently **v6**.
9. **Only a machine-read measurement can verify Edgenuity progress** — a live
   camera frame (Phase 4), a frame from a window the student shared with
   `getDisplayMedia` (Phase 12), or a DOM read from their own authenticated
   Edgenuity session (Phase 11). Anything else — a typed correction, a test
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
13. **An Enhanced requirement refuses a Standard capture outright** rather than
    banking the progress — otherwise a target could be filled at Standard
    strength and finished with one Enhanced photo under an Enhanced badge.
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

---

## Key files

### Web (`web/src/`)
| Concern | File |
| --- | --- |
| All data models | `types/index.ts`, `types/canvas.ts`, `types/edgenuity.ts` |
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
| Camera + MediaStream lifecycle | `lib/edgenuity/capture.ts` |
| Image work + quality checks | `lib/edgenuity/preprocess.ts` |
| OCR engine lifecycle | `lib/edgenuity/ocr.ts` |
| Capture → OCR → parse orchestration | `lib/edgenuity/pipeline.ts` |
| **Which number is course progress** | `lib/edgenuity/parser.ts` |
| **Whether progress counts as verified** | `lib/edgenuity/verification.ts` |
| **Challenge codes: generation, life, detection** | `lib/edgenuity/challenge.ts` |
| Challenge validation and spending | `store/reducer.ts` → `consumeChallenge()` |
| **Everything the Parent Dashboard shows** | `lib/parent/selectors.ts` |
| Parent controls + focus-run models | `types/parent.ts` |
| Parent session (in-memory only) | `hooks/useParentSession.ts` |
| Parent UI | `pages/Parent.tsx`, `components/features/parent/*` |
| Local OCR engine assets (generated) | `web/public/ocr/`, built by `web/scripts/vendor-ocr.mjs` |
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
| **App version (one of three copies)** | `version.ts` |
| **Retention caps and log trimming** | `lib/retention.ts` |
| **What an export may contain** | `lib/export.ts` |
| Dev-only seed profile (DEV branch only) | `lib/devSeed.ts` |
| Dev-only fixture capture (DEV branch only) | `lib/edgenuity/capture.dev.ts` |
| Extension status, versions, setup | `components/features/BrowserProtectionSetup.tsx` |
| "We repaired your data" notice | `components/layout/RecoveryNotice.tsx` |
| Per-page crash recovery | `components/layout/ErrorBoundary.tsx` → `RouteErrorBoundary` |
| Export / clear / reset | `components/features/DataPanel.tsx` |
| Privacy and Help pages | `pages/Privacy.tsx`, `pages/Help.tsx` |

### Extension (`extension/`)
| Concern | File |
| --- | --- |
| Rule generation | `background/rules.js` |
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
| Shipping-file allowlist, packaging, zip, verification | `build-extension.mjs` |

⚠️ `web/src/lib/domains.ts` ↔ `extension/shared/domains.js` and
`web/src/lib/canvas/verification.ts` ↔ `extension/canvas/status.js` are
hand-synced mirrors (the extension has no build step). Change both together.

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
