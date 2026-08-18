# LockIn

**Finish what matters before distractions take over.**

A local-first study tool for students who already know what they owe and still
don't do it. LockIn tracks Canvas / Edgenuity / other assignments, runs focus
sessions, and — through a companion Chrome extension — actually blocks
distracting websites until the required work is done.

Everything is stored on the device. No accounts, no server, no analytics, no
paid APIs, no AI services.

---

## Quick start

### 1. Run the website

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5173**.

The port matters: the extension only talks to `localhost:5173` (and
`127.0.0.1:5173`). See [Changing the app origin](#changing-the-app-origin) if
you need a different one.

### 2. Load the Chrome extension

1. There is **nothing to build** — the extension is plain Manifest V3
   JavaScript.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top right).
4. Click **Load unpacked**.
5. Select the **`lockin/extension`** folder — the folder that directly contains
   `manifest.json`. Not `lockin/`, not `lockin/extension/background`.
6. Go back to the LockIn tab and **reload it** (a content script only attaches
   to pages loaded after the extension was installed).
7. Go to **Settings → Browser protection** and press **Test connection**. You
   should see **Chrome Extension Connected ✅**.

To see blocking work immediately: add a site under **Settings → Blocked
websites**, then press **Start 5-minute blocking test**.

---

## What actually works

Verified by the automated suites and by hand (see [Testing](#testing)):

| Area | Status |
| --- | --- |
| Onboarding (name → assignments → study time → reminder mode → distractions → parent PIN) | Works, saves per step |
| Assignments: add / edit / delete / search / filter by platform, status, priority | Works, delete is confirmed |
| Exams with automatic day countdown | Works |
| Dashboard: greeting, due-soon, progress bar, exams, Focus Mode panel | Works |
| Focus sessions: 15/25/45/60/custom, start / pause / resume / end, time logged | Works, survives refresh |
| Focus Mode with required-task gating and auto-unlock on completion | Works |
| Real website blocking via the extension | Works (declarativeNetRequest) |
| Allowlist always beats blocklist; Google & school domains never blocked | Works |
| Custom domain input normalisation and validation | Works |
| Block page with live progress and current task | Works |
| Extension popup with live status | Works |
| Connection status + Test connection + 5-minute blocking test | Works |
| Parent PIN (salted SHA-256), override, temporary unlock (10/15/30 min) | Works |
| Emergency exit (reason + 3-second hold) | Works |
| Activity log + aggregate block counts | Works |
| Cross-tab sync (BroadcastChannel + storage events) | Works |
| Blocking survives a Chrome restart | Works |
| Light / dark / auto theme, desktop sidebar, mobile bottom nav | Works |

### Canvas Browser Connection (Phase 3)

| Area | Status |
| --- | --- |
| Configure any school Canvas domain (self-hosted or `*.instructure.com`) | Works |
| Canvas reader loaded only on that one domain | Works |
| Detect assignments from dashboard, to-do, course, assignments index, assignment and quiz pages | Works |
| Import detected assignments (one at a time or Import All, always confirmed) | Works |
| Re-visiting Canvas never duplicates an assignment | Works |
| Link an existing manual assignment to a Canvas assignment (suggested, never automatic) | Works |
| Verify completion from `submitted`, `graded`, `late_submitted` | Works |
| Refuse to complete on `not_submitted`, `missing`, `unknown`, `verification_unavailable` | Works |
| Canvas verification feeds Focus Mode and unlocks blocked sites | Works |
| Detections cached while LockIn is closed, reconciled on reopen | Works |
| Idempotent: repeat detections make one record and one activity event | Works |
| Configured Canvas domain can never be blocked | Works |
| Course display-name mapping (`MATH-7-P3-26-27-SMITH` → `Math`) | Works |
| Disconnect: clears domain, cache, and asks before deleting imported work | Works |

### Edgenuity live-camera verification (Phase 4)

| Area | Status |
| --- | --- |
| Configure a target: +N% course progress, N activities, or focus time + proof | Works |
| Live camera capture with framing overlay, rear camera preferred, switchable | Works |
| Local OCR (Tesseract via WebAssembly), bundled — no CDN, no API, no upload | Works |
| Reads course name, activity name and course-progress percentage | Works |
| Picks Course Progress out of a page also showing Overall / Relative Grade | Works |
| Refuses a screen it can't recognise as Edgenuity, rather than guessing | Works |
| Refuses when two progress values are equally plausible | Works |
| Before/after comparison inside one verification session | Works |
| Cumulative progress that can't be double-counted | Works |
| Partial progress kept and carried toward the target | Works |
| Same-course check between the two photos | Works |
| Large-jump and near-instant claims ask for a confirming photo | Works |
| Starting photo expires after 12 hours and is never silently reused | Works |
| Verified progress completes the assignment and unlocks blocked sites | Works |
| Typed corrections recorded as "Manual / unverified", never as verified | Works |
| Camera stops on capture, cancel, close, and when the tab is hidden | Works |
| Photos discarded after reading; no image or raw OCR text is ever stored | Works |

### Enhanced Proof — one-time challenge codes (Phase 5)

| Area | Status |
| --- | --- |
| Two proof modes: Standard (Phase 4) and Enhanced, chosen in Settings | Works |
| Per-assignment "require Enhanced Proof", which the global setting can only raise | Works |
| Cryptographically random codes over an OCR-safe alphabet | Works |
| A *different* code for the before and after captures | Works |
| The final code is issued only when the student asks to verify | Works |
| The code is machine-detected in the photo — never confirmed by the student | Works |
| Code and Edgenuity screen must appear in the same frame | Works |
| A code found on top of the progress reading doesn't count | Works |
| Codes expire after 5 minutes, and are single-use | Works |
| Retakes reuse the same unexpired code; failures never lock anyone out | Works |
| Higher screen-evidence bar for Enhanced than for Standard | Works |
| Trust levels: Manual / Standard Verified / Enhanced Verified | Works |
| A Standard capture cannot satisfy an Enhanced requirement | Works |
| Enhanced verification feeds the same Focus Mode engine and unlocks sites | Works |
| Spent codes are discarded, leaving only a digest | Works |

### Parent Accountability Dashboard (Phase 6)

| Area | Status |
| --- | --- |
| `/parent` route gated by the existing parent PIN — nothing shown before it | Works |
| Parent session idles out, and re-locks on reload, restart and Exit Parent View | Works |
| Weekly summary: completions, verified vs manual, focus time, overrides, exits | Works |
| Verification breakdown: Canvas / Edgenuity Standard / Edgenuity Enhanced / Manual | Works |
| Recent work with per-item verification detail | Works |
| Refused verification attempts, with repeats collapsed and no accusatory wording | Works |
| Focus Mode history: required vs completed, outcome, per-domain block counts | Works |
| Overrides, emergency exits and temporary unlocks kept as three distinct things | Works |
| Approve a temporary unlock, or end Focus Mode, using the existing engines | Works |
| Raise the Edgenuity proof requirement globally or per assignment | Works |
| Lock verification settings, blocklist and allowlist behind the PIN | Works |
| "Managed by Parent Controls" on the student side, with a PIN prompt | Works |
| Export the weekly summary as JSON or CSV, built from an allowlist of fields | Works |
| Clear verification / activity / focus history separately, with confirmation | Works |
| Viewing the dashboard writes nothing to the activity log | Works |

## What is NOT built yet (deliberately)

- **Canvas official API / OAuth** — `CanvasApiProvider` is an interface stub
  only. No OAuth flow, no Developer Key, no access tokens. See
  `web/src/lib/canvas/api.ts` for exactly what a real implementation would need.
- **AI verification of any kind.**
- **Mobile app blocking** — browser only, and only the browser the extension is
  installed in.
- **Accounts / sync between devices** — data lives in one browser profile.
- **YouTube-granular blocking** (Shorts only, homepage only, approved videos).
  Whole-domain blocking only, as specified.
- **QR-code challenges** — the type exists in the model, but only the visual
  code is implemented. A QR challenge needs a second screen to display it, and
  most students have exactly two devices: the school computer and a phone.
- **Automatic Edgenuity reading on the school computer** — LockIn never touches
  the school device. The photo is the whole mechanism.
- **Any claim that a photographed screen is genuine.** Enhanced Proof makes a
  *prepared* photo much harder to reuse. It says nothing about whose screen it
  is or whether the screen is real.
- **Remote parent access** — no accounts, no email, no SMS, no cloud dashboard,
  no push notifications. The Parent Dashboard is a page on the device the
  student uses, and there is no server for it to talk to.
- **Surveillance of any kind** — no browsing history, no screenshots, no webcam
  monitoring, no location, no keystrokes, no message or login monitoring. A
  parent sees work and verification events; there is nothing else stored to
  see.

---

## Chrome permissions, and why each one exists

| Permission | Why |
| --- | --- |
| `declarativeNetRequest` | The blocking engine. |
| `storage` | `chrome.storage.local` — blocking state, block counts, Canvas config and detection cache. |
| `alarms` | Temporary-unlock and test-mode expiry survive the service worker being killed. |
| `tabs` | Reuse an existing LockIn tab for "Open LockIn", find open Canvas tabs to re-parse, and open a Canvas assignment. |
| `scripting` | **Added in Phase 3.** The Canvas domain is chosen by the student at runtime, so it cannot be listed in the manifest. `chrome.scripting.registerContentScripts` injects the Canvas reader into that one origin, and unregisters it on disconnect. |
| `host_permissions: <all_urls>` | Required by Chrome for `declarativeNetRequest` **redirect** rules against user-chosen blocked sites, which cannot be enumerated at build time. Verified by experiment: with it removed, blocking silently stops working. |
| `optional_host_permissions: https://*/*` | Declared so a specific Canvas origin can be requested at runtime. Only one concrete origin is ever requested. |

**An honest note about the Canvas permission.** Because the blocker already
requires `<all_urls>`, Chrome will *not* show a new prompt when you connect
Canvas — the access is already held. The consent screen says so rather than
implying otherwise. What connecting actually controls is the **scope of Canvas
reading**, and LockIn enforces that itself: the Canvas reader is registered for
exactly one origin, and every detection is re-checked against it. Narrowing
`<all_urls>` would mean moving website blocking to per-site optional
permissions too — a Phase 2 redesign, deliberately not attempted here.

## Browser limitations you should know about

These are real constraints, not bugs:

1. **Reminders only fire while a LockIn tab is open.** There is no server and no
   push subscription, so the reminder scheduler is an interval in the page.
   Chrome also throttles timers in background tabs to roughly once a minute, so
   a reminder can land up to a minute late. The escalation logic is written as
   "what is overdue right now" rather than "wake me at exactly 6:10 PM", and
   each stage fires at most once per assignment.
2. **Notifications need permission**, are never requested on first load (only
   after onboarding or from Settings), and are silently skipped if denied — the
   in-app toast still appears.
3. **The extension only blocks in the browser it is installed in.** Another
   browser, another Chrome profile, incognito (unless you allow it), or a phone
   are all unaffected. This is by design: LockIn does not try to defeat the
   operating system or a school-managed device.
4. **A Manifest V3 service worker is not always running.** All state lives in
   `chrome.storage.local` and expiries use `chrome.alarms`, so blocking survives
   the worker being killed and Chrome being restarted.
5. **The extension can be disabled or removed from `chrome://extensions`.**
   That is a deliberate, unavoidable property of Chrome, and LockIn does not
   attempt to hide or block that page.
6. **Blocking applies to top-level page loads (`main_frame`) only.** Embedded
   content (for example a YouTube video inside a school page) is not blocked, so
   legitimate coursework keeps working.
7. **Chrome 137+ refuses `--load-extension` from the command line**, which is
   why the end-to-end suite needs a Chrome for Testing build.
8. **Canvas detection only sees pages the student actually opens.** LockIn does
   not fetch Canvas in the background — there is no API access. If Canvas is
   never opened, nothing is detected, and Sync says so plainly.
9. **Canvas markup can change.** Instructure can restyle a page at any time.
   Identifiers come from URLs (far more stable than markup), and every parser
   has several fallbacks, but a redesign can still make a page unreadable. The
   failure mode is deliberate: *Verification unavailable*, never a false pass.
10. **Quizzes and external tools often expose no reliable status.** Those report
    `verification_unavailable` and must be completed another way.
11. **The Canvas modules are web-accessible resources.** Content scripts cannot
    use static imports, so the reader is imported at runtime, which requires
    listing those files. A site could therefore detect that LockIn is installed.
    They contain no secrets and read nothing on their own.

---

## Testing

Everything runs against **local fixtures**. No real Canvas account, no
credentials, and no request ever leaves the machine.

```bash
npm run test:all      # every suite in order
```

### 1. Logic suites (fast, no browser)

```bash
npm test
```

**291 checks** against the real shipped modules — 21 blocking, 25 Canvas,
38 Edgenuity logic, 21 Edgenuity state, 28 challenge logic, 18 Enhanced Proof
state, 21 parent selectors, 23 parent state, 71 planner logic, 25 planner
state.

Blocking: domain normalisation, invalid-domain rejection, allowlist precedence,
protected Google domains, rule priorities and ids, expiry, hostile payloads.
Canvas: domain handling for self-hosted schools, URL→identifier extraction,
the submission-status policy (including late+submitted and missing), status
precedence, and message-schema validation.
Edgenuity logic: percentage parsing in every shape, column layouts resolved by
word position, OCR character confusion, 0–100 validation, screen recognition,
course matching, the whole before/after comparison, double-count prevention,
session expiry, and the rule that manual or fixture values can never verify.
Edgenuity state: the same policy driven through the real reducer, plus the
migration of a full Phase 3 save file and the Focus Mode unlock.
Challenge logic: the code alphabet and its exclusion of every OCR-confusable
character, unbiased generation, expiry, single use, cross-session and
cross-assignment refusal, exact matching, split and spaced codes, ambiguity,
the progress-region rule, and how trust is computed from a frame.
Enhanced Proof state: all six replay attacks driven through the real reducer,
Standard mode still working, and Standard never satisfying an Enhanced
requirement.
Parent selectors: a hand-checkable seeded week (2 Canvas, 1 Standard, 2
Enhanced, 3 manual) whose every total is asserted exactly, week boundaries at
local midnight, refusals collapsed, overrides kept apart from temporary
unlocks, and an export that provably carries no PIN hash, challenge value or
OCR text.
Parent state: the PIN path, session expiry, locked settings actually refused by
the reducer, requirement changes staying prospective, focus runs recorded from
start to finish with blocked-count deltas, the three history-clearing scopes,
and the v4 → v5 migration of a realistic Phase 5 save file.
Planner logic: the whole scheduler as a pure function — capacity with buffers,
daily caps, unavailable days, fixed blocks and rest days; chunking minimums and
maximums; exam defaults, spacing and the reserved final review; conflicts
between assignments and exams; missed, partial and redistributed work;
completion from every verification source; determinism under shuffled input and
tied scores; subject speed factors with too few samples, slow and fast subjects
and a clamped outlier; deadline safety; the midnight and DST boundaries; and a
100-assignment, 20-exam, 30-day performance ceiling.
Planner state: settings persistence and repair, replan triggers, the no-op
guard that stops a rebuild loop, exam sessions crediting exams, skips and
manual ordering, day rollover with recovery measurement, Focus Mode requiring
assignments but never exam timers, and the v5 → v6 migration of a realistic
Phase 6 save file.

The Edgenuity suites import the website's TypeScript directly (Node 24 strips
the types; see `extension/tests/ts-resolve.mjs`), so they test the shipping
modules rather than a copy that could drift.

### 2. Canvas parser suite (real DOM, fixture pages)

```bash
npm run test:parser
```

**28 checks.** The parser works on documents, so it runs in a real browser:
each sanitized fixture page is served over HTTPS from a fake Canvas hostname,
and the extension's own parser modules are imported into that page. Covers
detection vs rejection, ids/titles/due dates/points, all five submission
states, quizzes (reliable and ambiguous), external tools, malformed pages,
hostile markup rendered inert, and a custom Canvas domain.

### 3. Blocking end-to-end (real Chrome + extension)

```bash
npm run test:e2e
```

**26 checks**: YouTube blocked, subdomains blocked, Google Search/Docs/Drive,
Canvas and Edgenuity reachable, allowlist beating blocklist, temporary unlock
expiring, block counting, Chrome restart persistence, the page↔extension
bridge, spoofed messages ignored, blocking surviving the LockIn tab closing.
Add `--headful` to watch it happen.

### 4. Canvas end-to-end (real Chrome + extension + fixtures)

```bash
npm run test:canvas-e2e     # needs the dev server running on :5173
```

**57 checks**, including the one that matters most: *a Canvas submission is
detected, verified, and the blocked site opens again.* Also covers the migration
of a Phase 2 dataset, connect/disconnect, detection, import, duplicate
prevention, every submission state, spoofing, Canvas-can't-be-blocked,
idempotency, multiple tabs, and reconciliation after LockIn was closed.

### 5. Edgenuity OCR (real engine, real images)

```bash
npm run test:edgenuity-ocr
```

**42 checks.** Tesseract really reads generated Edgenuity screens and the
shipping parser turns them into values: clear pages at 0%, 43%, 46%, 47% and
100%; a page also showing Overall Grade 92% and Relative Grade 87%; glare,
rotation and a shrunken far-away shot; a different course; a page with no
percentage; a non-Edgenuity page that happens to say 47%; and a black frame.
Difficult images must either read the right number or refuse — a confident
wrong number is the only failing outcome.

The Phase 5 half runs the real challenge detector over the same engine: a code
beside the screen, a code OCR split into `K 7 M 4`, a low-contrast code, a
partly covered code, decoy codes around the right one, a code sitting on top of
the progress reading (refused), a code on a page that isn't Edgenuity (readable,
but the screen check still refuses), and no code at all.

Fixtures are drawn from scratch in a headless Chrome
(`npm run fixtures:edgenuity`); no real student screenshot is in the repo.

### 6. Edgenuity end-to-end (real Chrome, real camera API)

```bash
npm run test:edgenuity-e2e   # needs the dev server running on :5173
```

**31 checks**, and the one the phase exists for: *a live camera shows 43%, then
47%, and YouTube unblocks.* Chrome's fake video device is pointed at a generated
Edgenuity screen, so `getUserMedia` is the real API returning real frames — the
test swaps the file between captures. It also covers a denied camera and the
recovery from it, blocking staying on until the requirement is genuinely met,
the confirming photo a suspiciously fast claim is asked for, the starting proof
surviving a refresh, the verification record carrying no image data, and no
camera track being left live.

### 7. Enhanced Proof end-to-end (real Chrome, real camera, real codes)

```bash
npm run test:edgenuity-enhanced-e2e   # needs the dev server running on :5173
```

**34 checks**, and the pair that decide whether the feature is worth having:
*a photo carrying the wrong code is refused*, and *the photo that just completed
a session is refused in the next one*.

The codes are generated by the app and are unknowable in advance, so this suite
**renders the camera frame at capture time** to show whichever code LockIn just
issued, then serves it through Chrome's fake video device — the real
`getUserMedia`, the real OCR, the real reducer. It also checks that the second
code does not exist until the student asks to verify, that a failed read does
not burn the code, that spent codes keep no value, and that Focus Mode unlocks
only at the end.

Because reading four characters off a photographed card is not deterministic,
captures that are *meant* to succeed get up to three attempts, each re-framed
slightly — the same thing a student does. Refusals are never retried: a wrong
code has to fail on the first attempt and stay failed.

### 8. Parent Dashboard end-to-end (real Chrome, real PIN, real enforcement)

```bash
npm run test:parent-e2e   # needs the dev server running on :5173
```

**51 checks**, and the chain that proves parent controls are wired to the real
engine rather than to a settings display: *the dashboard is opened with the
real PIN → an assignment is raised to require Enhanced Proof → Parent View is
exited → the student's next verification demands a one-time code → a capture
without one is refused → an Enhanced capture completes the work → Focus Mode
ends → YouTube unblocks → the new Enhanced verification is visible to the
parent.*

It also covers the gate showing nothing before the PIN, a wrong PIN being
rejected, the dashboard re-locking on exit and on reload, a parent-approved
temporary unlock pausing blocking while Focus Mode stays on, and the absence of
photos, OCR text and spent challenge values from storage.

### 9. Smart Study Planner end-to-end (real Chrome + extension + Canvas fixtures)

```bash
npm run test:planner-e2e
```

**54 checks** covering the flows a unit test cannot prove:

*availability → build a plan → today shows the assignment and the exam study →
Start hands the item to the **existing** focus timer, pre-filled → 30 of 45
planned minutes are logged → exactly the remaining 30 stay planned.*

Then: a whole missed day rolls over and every unfinished minute reappears
inside capacity; 300 minutes of work against 100 minutes of capacity schedules
exactly 100 and states the shortfall on screen; "can't do this today" moves
work with no PIN and keeps every minute either scheduled or reported;
**Canvas reporting Submitted completes the assignment through the existing
verification chain and its future sessions disappear**; Start today's plan
arms the existing Focus Mode with assignment ids only; the planner page's five
tabs render; the layout survives a 390px phone and a 1280px desktop without
horizontal overflow; and rebuilding an unchanged plan previews *"nothing would
change"*.

Suites 2–9 need a **Chrome for Testing** build, because branded Chrome 137+
ignores `--load-extension`. Get one from
<https://googlechromelabs.github.io/chrome-for-testing/> and point `CHROME_BIN`
at it if it is not auto-detected:

```bash
CHROME_BIN="/path/to/Google Chrome for Testing" npm run test:canvas-e2e
```

> **One test-only accommodation.** Chrome's host-permission prompt is native UI
> that cannot be accepted headlessly, so the Canvas e2e harness copies the
> extension to a temp directory and adds the fixture Canvas host to
> `host_permissions` in that copy. This simulates the state *after* a grant;
> shipped code is untouched and every code path under test runs normally. The
> grant UX itself is in the manual checklist below.

If a suite ever reports that the debug port is in use, a previous Chrome is
stuck:

```bash
pkill -f "Chrome for Testing"
```

### Optional: trying it on your own Canvas

Automated tests never touch a real account. If you want to check your own
school's Canvas by hand, nothing here needs your username, password, cookies or
tokens — just browse Canvas while logged in as usual:

1. Load the extension, start the web app, and finish onboarding.
2. Settings → Canvas → Set Up Canvas → enter your school's Canvas address.
3. Confirm on the LockIn consent tab.
4. Open your Canvas dashboard, then press **Sync Canvas** in LockIn.
   Expect: *"N assignments found"*, and a **Review N found in Canvas** button.
5. Import one assignment you have **not** submitted. It should show
   `Canvas · Not submitted`, with *Open in Canvas* and *Check Canvas Status*
   instead of a Mark Complete checkbox.
6. Open one you **have** submitted, then press **Check Canvas Status**. It
   should flip to `Submitted ✓` or `Graded ✓` and complete itself.
7. Start Focus Mode requiring that assignment, block a site you actually use,
   and confirm it unlocks when Canvas verification lands.
8. Settings → Canvas → **Disconnect Canvas**, and choose to keep your work.

If a page cannot be read, LockIn says *"Verification unavailable"* rather than
guessing — that is the intended behaviour, not a failure.

---

## Project structure

```text
lockin/
├── package.json                  # test + dev scripts for the whole repo
├── README.md
│
├── web/                          # React + TypeScript + Vite + Tailwind v4
│   ├── index.html
│   ├── vite.config.ts            # pinned to port 5173 (the extension's origin)
│   └── src/
│       ├── main.tsx              # providers + error boundary
│       ├── App.tsx               # routes and the onboarding guard
│       ├── index.css             # design tokens, light/dark, animations
│       ├── types/
│       │   ├── index.ts          # every data model in one place
│       │   └── canvas.ts         # Canvas models + status union
│       ├── lib/
│       │   ├── storage.ts        # versioned localStorage + migrations (v2)
│       │   ├── domains.ts        # normalise / validate / shouldBlock
│       │   ├── pin.ts            # salted SHA-256 PIN hashing
│       │   ├── protocol.ts       # typed message schema for the bridge
│       │   ├── extensionBridge.ts# page side of the bridge
│       │   ├── selectors.ts      # derived views (due soon, blockingActive…)
│       │   ├── canvas/
│       │   │   ├── provider.ts     # the CanvasProvider interface
│       │   │   ├── pageProvider.ts # CanvasPageProvider (shipping)
│       │   │   ├── api.ts          # CanvasApiProvider (stub only)
│       │   │   ├── verification.ts # what counts as verified — the policy
│       │   │   ├── matching.ts     # identity + link suggestions
│       │   │   ├── reconcile.ts    # extension view → store actions
│       │   │   └── domain.ts       # Canvas domain normalisation
│       │   ├── time.ts           # dates, countdowns, clock formatting
│       │   ├── text.ts
│       │   └── cx.ts
│       ├── store/
│       │   ├── reducer.ts        # every state transition
│       │   ├── AppStore.tsx      # persistence, cross-tab sync, extension sync
│       │   ├── context.ts
│       │   └── factories.ts      # schema-complete record builders
│       ├── hooks/
│       │   ├── useTheme.ts
│       │   ├── useCanvas.ts      # connect / sync / check / disconnect
│       │   └── useReminders.ts   # reminder escalation + Strict auto-arm
│       ├── components/
│       │   ├── ui/               # Button, Card, Modal, Field, Progress, …
│       │   ├── layout/           # Shell (sidebar + bottom nav), ErrorBoundary
│       │   └── features/         # AssignmentCard/Form, PIN dialog,
│       │                         # EmergencyExit, DomainListEditor,
│       │                         # CanvasSettings, CanvasImportModal,
│       │                         # CanvasLinkModal, CanvasStatusBadge
│       └── pages/                # Welcome, Onboarding, Dashboard, Assignments,
│                                 # Exams, Focus, Activity, Settings
│
└── extension/                    # Manifest V3, no build step
    ├── manifest.json
    ├── background/
    │   ├── service-worker.js     # message handling, lifecycle, alarms
    │   ├── rules.js              # state → declarativeNetRequest rules
    │   ├── canvas.js             # Canvas config, permission, cache, trust boundary
    │   └── storage.js            # chrome.storage.local + block counters
    ├── content/
    │   └── bridge.js             # the page↔extension relay (trust boundary)
    ├── canvas/                   # the Canvas reader — separate from the bridge
    │   ├── content.js            # classic loader Chrome injects
    │   ├── main.js               # wiring: detect → parse → report
    │   ├── detector.js           # "is this really Canvas?"
    │   ├── parser.js             # DOM → structured assignments
    │   ├── observer.js           # debounced MutationObserver + SPA nav
    │   ├── messaging.js          # schema validation + caps
    │   ├── status.js             # submission-status policy
    │   ├── urls.js               # routes → identifiers
    │   ├── types.js              # constants and hard limits
    │   └── connect.html/.css/.js # the consent page
    ├── popup/                    # popup.html / .css / .js
    ├── blocked/                  # the block page
    ├── shared/                   # protocol.js, domains.js, config.js, theme.css
    ├── assets/                   # generated PNG icons
    └── tests/
        ├── blocking.test.mjs     # Phase 2 logic
        ├── canvas-logic.test.mjs # Canvas pure logic
        ├── canvas-parser.test.mjs# Canvas parsing, real DOM
        ├── e2e.mjs               # Phase 2 end-to-end
        ├── canvas-e2e.mjs        # Canvas end-to-end
        ├── canvas-server.mjs     # local HTTPS Canvas stand-in
        ├── chrome-harness.mjs    # Chrome lifecycle helpers
        └── fixtures/canvas/      # 13 sanitized fixture pages
```

### Routes

`/` Welcome · `/onboarding` · `/home` · `/assignments` · `/exams` · `/focus` ·
`/activity` · `/settings`

---

## How the website and extension talk

A page cannot message a service worker directly, and Chrome's
`externally_connectable` does **not** accept `localhost` origins — so LockIn
uses a **content-script bridge**:

```text
page  --window.postMessage-->  content/bridge.js  --chrome.runtime-->  service worker
page  <--window.postMessage--  content/bridge.js  <----sendResponse--  service worker
```

Security properties:

- The content script is injected **only** on origins listed in
  `manifest.json → content_scripts.matches`.
- It re-checks `event.source === window` and the origin before forwarding.
- The service worker checks `sender.origin` against
  `extension/shared/config.js → ALLOWED_APP_ORIGINS` again.
- Every payload passes `validateBridgeState()`, which rebuilds a known-shape
  object and drops unknown fields, caps list lengths and clamps strings.
- Unknown message types are ignored. Nothing is ever `eval`'d.
- **The PIN never reaches the extension.** The website verifies it and then
  sends `focusModeActive: false`.

The extension receives exactly: `focusModeActive`, `requiredTaskCount`,
`completedTaskCount`, `currentTaskTitle`, `blockedDomains`, `allowedDomains`,
`focusStartedAt`, `temporaryUnlockUntil`, `blockingEnabled`, `reminderMode`,
`isTest`, `testExpiresAt`, `appUrl`.

### Changing the app origin

For a deployed build, add the origin in **both** places:

1. `extension/shared/config.js` → `ALLOWED_APP_ORIGINS`
2. `extension/manifest.json` → `content_scripts[0].matches`

---

## How blocking works

`extension/background/rules.js` turns state into dynamic
`declarativeNetRequest` rules in two bands:

| Priority | Action | Applies to |
| --- | --- | --- |
| 2 | `allow` | school allowlist + protected domains (Google, localhost) + **the configured Canvas domain** |
| 1 | `redirect` | every blocked domain |

Chrome picks the highest-priority match, and `allow` beats `redirect`, so **the
allowlist can never lose**. Blocked navigations are *redirected* to the
extension's own block page — tabs are never closed and `chrome.tabs.remove()` is
never called anywhere in this codebase.

Only the matched **domain** is passed to the block page (`?d=youtube.com`).
The full URL is never handed over, logged, or stored. Block statistics are
aggregate counts per domain only.

The Canvas domain is carried to the extension as its own `canvasDomain` field,
separate from `allowedDomains`, so deleting Canvas from the school allowlist by
mistake still cannot lock a student out of their homework site.

---

## Canvas Browser Connection

**This is browser detection, not an official Canvas integration.** LockIn reads
Canvas pages the student already opened. It never asks for a Canvas password,
never uses an API key or OAuth, and never sends anything anywhere.

### Setting it up

1. Settings → **Canvas** → **Set Up Canvas**
2. Read what it does, press Continue
3. Enter your school's Canvas address — `myschool.instructure.com`,
   `https://canvas.schooldistrict.org`, anything. It is normalised to a domain.
4. A LockIn consent tab opens. Confirm there.
5. Open Canvas in Chrome and browse normally, or press **Sync Canvas**.

### Provider architecture

Everything above the provider interface — the reducer, Focus Mode, the UI — is
written against `CanvasProvider` and knows nothing about *how* Canvas data was
obtained:

```text
web/src/lib/canvas/provider.ts     the interface
web/src/lib/canvas/pageProvider.ts CanvasPageProvider  — SHIPPING
web/src/lib/canvas/api.ts          CanvasApiProvider   — STUB, deliberately unimplemented
```

`CanvasApiProvider` returns `verification_unavailable` for everything and
documents what a real institution-approved implementation would need (a
school-issued Developer Key, a registered redirect URI, and a backend to hold
the client secret — none of which a local-first app has). Swapping providers
requires no change to Focus Mode, the reducer, or any screen, because the
submission → completion policy lives in one shared place:
`web/src/lib/canvas/verification.ts`.

### What counts as verified

| Canvas status | Completes the assignment? |
| --- | --- |
| `submitted` | **Yes** |
| `graded` | **Yes** (no score needed) |
| `late_submitted` (Canvas showing both *Late* and *Submitted*) | **Yes** |
| `not_submitted` | No |
| `missing` | No — shown clearly as Missing |
| `unknown` | No |
| `verification_unavailable` | No |

A false negative is acceptable; a false positive is not. Ambiguous quizzes,
external-tool assignments and changed markup all degrade to
`verification_unavailable`, which never completes anything. A weaker later
reading also never downgrades a stronger one.

### How verification reaches the blocker

Canvas does **not** get its own unblocking path. It produces a verification
result, and the existing Phase 2 engine does the rest:

```text
Canvas page parsed (content script)
  → validated at the extension trust boundary
  → CANVAS_DETECTED in the reducer
  → VerificationRecord + assignment marked Completed
  → recompute() recounts required work            ← existing Phase 2 code
  → Focus Mode ends when the goal is met          ← existing Phase 2 code
  → state syncs to the extension
  → declarativeNetRequest rules removed           ← existing Phase 2 code
  → blocked sites open again
```

### Security: why a page cannot fake a submission

A detection is accepted only when **all** of these hold:

1. it arrived from a tab (not a page script, not another extension),
2. that tab's URL is on the configured Canvas origin, over **https**,
3. Chrome grants that origin right now (`permissions.contains`),
4. the payload passes strict schema validation — every field rebuilt, unknown
   keys dropped, lists and strings capped,
5. identifiers are well-formed, and
6. the assignment is already linked/imported before completion can affect
   LockIn.

Canvas page data never travels through the web-app bridge. `window.postMessage`
from any page — including the LockIn app — cannot deliver a detection: the
bridge does not relay `CANVAS_DETECTION` at all. Nothing is ever `eval`'d, and
detected text is only ever rendered as text.

### Privacy

Stored: assignment id, course id, title, due date, points, status, URL, and
timestamps. **Not** stored: Canvas passwords, cookies, tokens, page HTML,
gradebook data, messages, discussions, or browsing history. Verification
evidence is a single field like `{ canvasStatus: 'submitted' }`.

---

## Edgenuity live-camera verification

Edgenuity usually runs on a school-managed computer LockIn cannot touch, so
there is nothing to read. The evidence is instead a **photograph of that
screen**, taken on the student's own device and read locally.

### The flow

```
Pick a target (+3% course progress)
        ↓
Start work → live camera → local OCR → starting proof (43%)
        ↓
… the student actually works …
        ↓
Verify progress → live camera → local OCR → final proof (47%)
        ↓
+4% ≥ +3%  →  VerificationRecord  →  assignment Completed
        ↓
recompute()  →  Focus Mode ends  →  DNR rules removed  →  sites unlock
```

The last two lines are the existing Phase 2/3 engine, untouched. Edgenuity has
no unblocking path of its own.

### Three ways to measure progress

| Target | Evidence | Label |
| --- | --- | --- |
| `progress_percent` | Course-progress percentage rose by N points | Course Progress Verified |
| `activities` | The activity name changed, read confidently both times | Activity Change Verified (experimental) |
| `session_progress` | N minutes of focus time **plus** matching before/after screens | Focus + Screen Proof |

The third is the weakest and is labelled as such — never as verified progress.

### OCR

Tesseract compiled to WebAssembly, running in a Web Worker. The engine, its
wasm core and the English model are copied out of `node_modules` into
`web/public/ocr/` by `web/scripts/vendor-ocr.mjs` (run automatically before
`dev` and `build`) and served from LockIn's own origin, because tesseract.js
otherwise fetches all three from a CDN — which would break the project's
no-network rule. Nothing is downloaded and no image is uploaded, ever.

The engine loads on first use, is shared for the duration of a verification,
and shuts down after 90 seconds idle.

### Picking the right number

An Edgenuity page shows several percentages — Overall Grade, Relative Grade,
Course Progress. Plain OCR text flattens the two columns into
`Course Progress Overall Grade` above `43% 92%`, where the pairing is lost, so
the parser uses **word positions**: each percentage is scored by the words
physically beside and above it. `43%` sits under `Course Progress`, `92%` under
`Overall Grade`. Grade words score negatively; ties are reported as ambiguous
rather than guessed.

### Enhanced Proof: the one-time code (Phase 5)

Standard Proof establishes that a live photo showed an Edgenuity screen with
these values. It cannot tell that photo apart from one taken yesterday, or from
a photo of somebody else's screen taken at lunch. Enhanced Proof closes that
gap with a code the photo could not have contained in advance.

```
Start work
      ↓
LockIn issues code A (e.g. K7M4), valid 5 minutes
      ↓
student writes it down, puts it beside the monitor
      ↓
one photo: Edgenuity 43%  +  K7M4     → code A spent
      ↓
… the student actually works …
      ↓
Verify progress  →  LockIn issues code B (e.g. R9C2) — not before now
      ↓
one photo: Edgenuity 47%  +  R9C2     → code B spent
      ↓
existing Phase 4 delta policy → VerificationRecord (enhanced) → Focus Mode
```

Two codes, not one, and the second is generated only when the student taps
**Verify progress**. If both existed at the start, both photos could be staged
in a single sitting and the whole exercise would be decorative.

**The alphabet is the design.** Codes are drawn from `ACEFHJKMNPRTWXY` and
`34679` — every character that OCR confuses with another (`0/O`, `1/I/L`,
`5/S`, `8/B`, `2/Z`, `6/G`, `U/V`) is excluded. That costs a little entropy and
buys the thing that makes the feature real: matching demands an **exact**
string. A matcher that guessed through a table of OCR errors would be a matcher
that votes for a pass on noise. Every code also contains at least one letter
and one digit, so ordinary page words like `PROGRESS` can never be candidates.

**The code is machine-detected, never confirmed.** There is no "yes, it was
there" button anywhere in the flow. If OCR cannot find the code, the only route
forward is a better photo — and the same code keeps working until it expires,
so a failed read costs nothing.

**Where the code may sit.** It has to be in the same frame as the progress
reading, and *outside* the region the progress was read from: something
code-shaped recognised on top of the percentage is far more likely to be misread
page text than a card held up beside the screen.

### Trust levels

| Level | What it means | Can unlock Strict Mode |
| --- | --- | --- |
| `manual` | The student typed it, or it wasn't a live capture | Never |
| `standard` | Live camera + OCR read an Edgenuity screen (Phase 4) | Yes, unless Enhanced is required |
| `enhanced` | The same, plus a one-time code in both captures (Phase 5) | Yes |

A session is worth the **weaker** of its two captures. A code on the final photo
alone would leave the starting reading replayable, which is the attack this
exists to close. An assignment that requires Enhanced refuses a Standard capture
outright rather than banking the progress — otherwise a student could accumulate
their whole target at Standard strength and top it off with one Enhanced photo,
and the badge would be lying.

### What stops casual cheating, and what doesn't

Stopped: pressing "I did it"; typing a number (recorded as *Manual /
unverified*, never verified); uploading a saved screenshot (there is no file
picker in the flow); reusing Monday's starting photo on Friday (sessions expire
after 12 hours); claiming the same progress twice (new progress is measured
from `lastVerifiedProgress`); showing a different course; showing a random page
with a percentage on it; a wild jump or a claim seconds after starting (both
ask for a confirming photo).

With Enhanced Proof, also stopped: a photo taken before the code existed —
yesterday's screenshot, a classmate's screen photographed earlier, an image
saved for later; the same photo used for both halves of a session; a photo
reused in a *later* session; and a code borrowed from another assignment,
another session, or an earlier step.

**Not stopped**, and the UI says so: someone standing in front of the right
screen with a pen. Enhanced Proof establishes that a live photo showed an
Edgenuity screen, these values, and a code issued moments earlier. It does not
establish *whose* screen it is, who took the photo, or that the screen is
genuine. Nothing in the product is allowed to say "tamper proof", "cheat proof"
or "100% verified", because none of those would be true.

### Privacy

The captured frame lives in a canvas, is read, and is released. What survives
is course name, activity name, progress percentage, confidence, a timestamp,
and — for Enhanced Proof — whether the expected code was found. The code itself
is dropped once spent.
Raw OCR text is discarded after parsing (kept only during processing, and only
in developer mode). No photo, thumbnail or OCR text is ever written to storage,
to the activity log, or into an extension message. The camera stops on capture,
on cancel, on close, and when the tab is hidden.

---

## Parent Accountability Dashboard

Open `/parent`, enter the existing parent PIN, and get a read-only review of
what was required, what was verified, and how. The design brief was
*accountability, not surveillance*, and the difference shows up as a hard limit
on what the page is even able to display.

### What a parent can see

- **This week** — assignments completed, how many had real evidence behind
  them, focus time, focus sessions, parent overrides, emergency exits.
- **How work was verified** — Canvas, Edgenuity Enhanced, Edgenuity Standard
  and Manual counted separately, each with an honest one-line explanation.
- **Recent work**, and behind each item the evidence: the Canvas status that
  was read, or the before → after progress reading, whether each challenge half
  was verified, and how confident the screen recognition was.
- **Verification attempts that were not accepted**, with the reason and
  repeats collapsed.
- **Focus Mode history** — required vs completed, how each session ended, any
  temporary unlocks, and per-domain blocked-attempt counts.
- **Overrides, emergency exits and temporary unlocks**, kept apart.
- **Assignments** filtered by verification kind, and **upcoming exams**.

### What a parent cannot see, because it does not exist

No browsing history. No page titles or URLs — the extension reports
`{ domain, count }` and nothing else. No photos: Edgenuity captures are read and
released, and no thumbnail is ever persisted. No OCR text. No challenge codes
after use. No webcam access, no screen recording, no location, no keystrokes,
no messages, no school logins. There is no network code in either half of the
project, so nothing reaches a parent remotely either.

### What a parent can change

| Control | Effect |
| --- | --- |
| Edgenuity proof requirement | Sets `settings.edgenuityProofMode` — the same Phase 5 floor the verification policy already reads |
| Per-assignment requirement | Sets `requiredVerificationTrust`, raising the bar for one piece of work |
| Lock verification settings | The student needs the PIN to change either of the above |
| Protect blocked sites in Strict Mode | Removing a blocked site mid-session needs the PIN; adding one never does |
| Protect the school allowlist in Strict Mode | Widening the allowlist mid-session needs the PIN |
| Approve a temporary unlock | The existing `TEMPORARY_UNLOCK` — blocking pauses, Focus Mode stays on, blocking returns by itself |
| End Focus Mode | The existing parent override, logged once |

Requirement changes are **prospective**. Work already completed under the rule
that applied at the time stays completed — raising the bar does not reach back
and re-open finished assignments.

The reducer, not just the UI, enforces the lock: `UPDATE_SETTINGS` drops a
protected field unless the action carries `parentApproved`. Hiding a control is
a suggestion; refusing the action is the rule.

### What the PIN actually does

It keeps the dashboard and the protected settings behind a deliberate step, and
every override is recorded. It is **not** a security boundary against someone
who controls the browser: anyone who can open developer tools or edit local
storage can change what is stored. LockIn says so on the Privacy panel, and it
makes no attempt to detect or disable developer tools, because that would be
theatre.

The parent session lives in React state only — never in `localStorage`, never
in the reducer — so a reload, a browser restart, an idle timeout or Exit Parent
View all re-lock it.

---

### Smart Study Planner (Phase 7)

| Area | Status |
| --- | --- |
| Deterministic daily plan from due dates, estimates, exams and availability | Works |
| Per-weekday availability, maximum daily minutes, rest days, fixed commitments | Works |
| Daily buffer, workload preference, focus/break lengths, chunk sizes | Works |
| Assignments split into sessions; tiny work never over-split | Works |
| Exam study spread across days with a reserved final review | Works |
| Capacity never exceeded; shortfalls stated with numbers | Works |
| Overdue work stays schedulable and outranks everything else | Works |
| Missed and partial work redistributed without losing a minute | Works |
| Completion (manual, timer, Canvas, Edgenuity) removes future sessions | Works |
| "Why this?" explains every item from the numbers used to schedule it | Works |
| Start hands the item to the existing focus timer; no second timer | Works |
| Start today's plan uses the existing Focus Mode; no second blocker | Works |
| Manual reorder, day lock, "can't do this today" (no PIN) | Works |
| Rebuild preview with Apply / Cancel | Works |
| Subject speed factors from finished work, opt-in only | Works |
| Week view with per-day load and overload marking | Works |

---

## Smart Study Planner

Phase 7 answers one question — **what should I work on today?** — with a
schedule, not a to-do list. The planner decides *what should be done*; Focus
Mode still decides *what is blocked*. Those stay separate on purpose.

There is **no AI in it**, and it never claims otherwise. The planner is a
deterministic function of your assignments, exams, estimates, logged minutes
and availability: the same state and settings always produce the same plan, and
every scheduled session can explain itself with the numbers that put it there.

### How a plan is built

1. **Capacity per day.** Your availability for that weekday, minus fixed
   commitments, minus a buffer (15% by default), capped by the daily maximum
   and scaled by the workload preference. Today is clipped to the time that is
   actually left, so opening LockIn at 8:30 PM does not produce a plan that
   started at 4:00.
2. **Work to do.** Each unfinished assignment contributes
   `estimate − logged` minutes (zero if it is completed, whatever completed
   it). Each upcoming exam contributes `study estimate − studied`.
3. **Reserved reviews.** Each exam's final review is placed on the last study
   day before it, so a greedy fill cannot eat it.
4. **A greedy day-by-day fill.** For each day in the horizon, the
   highest-scoring eligible task gets one session, then the next, until the
   day's capacity or the eligible work runs out. A second pass tops days up so
   two sessions of one subject in an evening are allowed — a third is not.
5. **Leftovers are reported, never dropped.** Anything that will not fit
   becomes a warning with real numbers.

Complexity is `O(D² · T)` for `D` days and `T` tasks, which for 100
assignments, 20 exams and a 30-day horizon measures at about **70 ms**. There
is no search and no backtracking: an explainable schedule beats an optimal one
nobody can argue with.

### The priority score

Every constant lives in `web/src/lib/planner/priorities.ts` with its reasoning
next to it, and the score is a plain sum:

| Factor | Value |
| --- | --- |
| Overdue | 110, +5 per day late (capped at +30) |
| Due today | 100 |
| Due tomorrow | 70 |
| Later | 60, falling 6 per day, floor 5 |
| Marked Urgent / Important | +25 / +12 |
| Workload pressure (`remaining ÷ capacity before the deadline`) | up to +40 |
| Two or fewer study days left before the deadline | +12 |
| Exam inside its study window | +8 |

Ties break on opportunities, then deadline, then priority, then creation time,
then id — so shuffling the input arrays cannot change the schedule.

Note what is **absent**: how the work will be verified. A Canvas or Edgenuity
assignment gets no bonus for having stronger proof attached. School urgency
decides the schedule; verification decides what counts as finished. Mixing them
would quietly teach students to do the easiest-to-prove work first.

### Exams

`Light / Medium / Heavy` seed a study estimate of **90 / 180 / 300 minutes**,
editable per exam. These are reasonable starting points, not measurements, and
the UI says so. Study is divided into up to six sittings across the days
available, capped so no single day swallows a subject, and ends with a reserved
final review (20% of the total, up to 30 minutes) on the day before. Study is
never scheduled on or after the exam day unless the exam is today.

If an exam is tomorrow and the material needs five hours you do not have, the
plan schedules what fits and says the rest does not:

```
Not enough study time before Biology Exam
Estimated 5h, scheduled 2h — short by 3h.
```

### Missed, partial and completed work

Nothing is "moved" in the sense of editing yesterday's list. Remaining work is
recomputed from the assignment's own logged minutes, so anything unfinished is
still remaining and is scheduled again by the normal algorithm. **That is why
work cannot be silently lost: there is no code path that carries minutes, so
there is none that can drop them.** Every remaining minute is either scheduled
somewhere in the horizon or reported as not fitting.

Completion works the same way in reverse. The planner reads
`assignment.status`, so a task finished by the timer, a checkbox, a Canvas
submission or an Edgenuity photo all remove their future sessions identically —
there is no planner-specific verification path, and there is no second
completion engine.

### Capacity and overload

The planner never overbooks. When demand exceeds what a day can hold it says
so, with the arithmetic:

```
Wednesday is overloaded
3h 30m needed, 1h 40m available — 1h 50m cannot fit.
```

Rest days are never used silently either. If work cannot fit and a rest day
sits inside the window, the plan reports that instead of quietly filling it.

### "Why this?"

Every planned session carries reason *codes* and the numbers behind them, not
prose; `explanations.ts` renders them. A typical answer:

```
LockIn scheduled this because:
• Due tomorrow
• About 45 min of work left
• Marked Important
• Only 2 days with study time remain before the deadline
```

### Estimate correction

After **three or more finished assignments** in a subject, LockIn computes the
median of `logged ÷ estimated`, clamps each sample to 0.25–4× and the result to
0.5–2×, and *offers* it:

> Your Math assignments usually take about 25% longer than your estimates.

Nothing is applied until you accept it, per subject or globally. One abandoned
timer cannot move anything — that is what the median and the sample minimum are
for.

### Integration, not duplication

- **Start** on a planned session starts the existing focus timer, pre-filled
  with the assignment (or exam) and the planned length.
- **Start today's plan** starts the existing Focus Mode with today's assignment
  ids. Exam study is deliberately excluded: it is measured in minutes and
  cannot be "completed", so counting it would create an unlock you could sit
  through.
- Planned start times feed the **existing** reminder scheduler. The browser
  limitation is unchanged — reminders only fire while a LockIn tab is open.
- **"Can't do this today"** needs no PIN. This is planning, not restriction
  avoidance, and treating it as an escape hatch would teach students to lie to
  the planner.

### What the planner cannot know

It plans from due dates, your estimates, your availability and the time you
have actually logged. It cannot know how hard something will feel, what
homework has not been set yet, what is really on an exam, or what your school
changes after you enter it. It recalculates when any of those facts change —
that is the whole mechanism, and there is nothing cleverer underneath.

---

## Which files control what

| Concern | Files |
| --- | --- |
| **Website blocking** | `extension/background/rules.js` (rule generation), `extension/background/service-worker.js` (applies them), `extension/shared/domains.js` (the block/allow decision), `web/src/lib/domains.ts` (the same rules, web side) |
| **Focus Mode** | `web/src/store/reducer.ts` (`START_FOCUS_MODE`, `END_FOCUS_MODE`, `TEMPORARY_UNLOCK`, `recompute`), `web/src/pages/Focus.tsx`, `web/src/lib/selectors.ts` (`blockingActive`), `extension/background/rules.js` (`isBlockingActive`) |
| **Parent PIN** | `web/src/lib/pin.ts` (hashing + verification — no UI), `web/src/components/features/ParentPinDialog.tsx`, `web/src/pages/Settings.tsx` (set/change/remove) |
| **Emergency exit** | `web/src/components/features/EmergencyExit.tsx` |
| **Reminders** | `web/src/hooks/useReminders.ts` |
| **Persistence & migrations** | `web/src/lib/storage.ts` (`SCHEMA_VERSION`, `MIGRATIONS`) |
| **Bridge / messaging** | `web/src/lib/protocol.ts`, `web/src/lib/extensionBridge.ts`, `extension/shared/protocol.js`, `extension/content/bridge.js` |
| **Canvas detection** | `extension/canvas/*` (reader), `extension/background/canvas.js` (config, permission, cache, trust boundary) |
| **Canvas verification policy** | `web/src/lib/canvas/verification.ts` and its mirror `extension/canvas/status.js` — the only places that decide what counts |
| **Canvas → Focus Mode** | `web/src/store/reducer.ts` → `CANVAS_DETECTED` → `recompute()` |
| **Canvas providers** | `web/src/lib/canvas/provider.ts`, `pageProvider.ts` (shipping), `api.ts` (stub) |
| **Edgenuity capture** | `web/src/lib/edgenuity/capture.ts` (camera + MediaStream lifecycle), `web/src/components/features/CameraCapture.tsx` |
| **Edgenuity OCR** | `web/src/lib/edgenuity/ocr.ts` (engine lifecycle), `preprocess.ts` (image work + quality), `pipeline.ts` (how many passes to run), `web/scripts/vendor-ocr.mjs` (local engine assets) |
| **Edgenuity reading policy** | `web/src/lib/edgenuity/parser.ts` — the only place that decides which number is course progress |
| **Edgenuity verification policy** | `web/src/lib/edgenuity/verification.ts` — the only place that decides whether progress counts, and what trust it earns |
| **Challenge codes** | `web/src/lib/edgenuity/challenge.ts` — generation, lifetime, and the *only* place a code is matched in a photo |
| **Challenge consumption** | `web/src/store/reducer.ts` → `consumeChallenge()` — re-validates everything rather than trusting the caller |
| **Edgenuity → Focus Mode** | `web/src/store/reducer.ts` → `EDGENUITY_SUBMIT_PROOF` → `applyEdgenuityProgress()` → `recompute()` |
| **Edgenuity UI** | `EdgenuityPanel.tsx` (status + actions), `EdgenuityVerifyModal.tsx` (the flow), `EdgenuitySetup.tsx` (targets), `EdgenuitySettings.tsx` (camera/OCR/proof strength) |
| **Enhanced Proof UI** | `EdgenuityChallengeCard.tsx` (the code), `VerificationTrustBadge.tsx` (badge + honest detail panel) |
| **Parent Dashboard data** | `web/src/lib/parent/selectors.ts` — every number a parent sees, derived from structured state |
| **Parent session** | `web/src/hooks/useParentSession.ts` (in-memory only, so restarts re-lock) |
| **Parent controls model** | `web/src/types/parent.ts` (`ParentControls`, `FocusRun`) |
| **Parent enforcement** | `web/src/store/reducer.ts` → `UPDATE_SETTINGS` guard, `PARENT_SET_CONTROLS`, `PARENT_SET_ASSIGNMENT_TRUST` |
| **Parent UI** | `pages/Parent.tsx` and `components/features/parent/*` |

---

## Data, schema and privacy

State lives in `localStorage` under `lockin.state.v1` with a
`schemaVersion`. `web/src/lib/storage.ts` runs migrations on load, coerces every
record into a complete shape, and — if the blob is unparseable — moves it to
`lockin.state.corrupt` and starts fresh instead of crashing.

LockIn stores **no browsing history** and **no photographs**. The extension
keeps only `{ domain, count, lastBlockedAt }` per blocked domain, capped at 100
entries. Nothing is transmitted anywhere: there is no network code in either
half of the project, and the OCR engine is served from LockIn's own origin
precisely so that stays true.

Current schema: **v6**. `v1 → v2` added the Canvas slice; `v2 → v3` added the
Edgenuity slice; `v3 → v4` added the challenge ledger and the proof-mode
setting; `v4 → v5` added parent controls and the Focus Mode run history;
`v5 → v6` added the planner slice and the two exam planner fields.
Migrations only ever add — no user has been wiped, and the Phase 6 controls
default to *off* so an upgrade never starts demanding a PIN for something the
student could change yesterday.

Challenge codes are not secrets — the student is shown them — but a spent code
is still dropped from storage, leaving only a short non-cryptographic digest so
a record stays tied to the challenge that proved it. The digest is an audit aid
and the code comments say so; a four-character code would fall to a brute-force
search whatever hash were used.

---

## Known issues

- **Blocking statistics reset if you remove the extension**, since they live in
  extension storage rather than the website's. The same applies to the Canvas
  detection cache — imported assignments live in the web app and survive.
- **Canvas import defaults an undated assignment's due date to today**, so it
  stays visible rather than sorting to the bottom. Edit it if that's wrong.
- **Two LockIn tabs use last-writer-wins.** Canvas verification is idempotent so
  it cannot double-count, but an unrelated edit made in two tabs at the same
  instant can still lose one side. This predates Phase 3.
- **Study-time totals round to whole minutes**, so a session shorter than 30
  seconds logs as 0 minutes.
- **Reminder timing is best-effort** while a tab is open (see limitations).
- The two copies of the domain logic (`web/src/lib/domains.ts` and
  `extension/shared/domains.js`) are kept in sync by hand — the extension has no
  build step on purpose. The e2e suite exercises both.
