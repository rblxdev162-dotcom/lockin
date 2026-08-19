# LockIn

**Finish what matters before distractions take over.**

A local-first study app for students who already know what they owe and still
don't do it. LockIn plans your schoolwork, verifies some of it, and — through a
companion Chrome extension — actually blocks distracting websites until the
required work is done.

Everything stays on the device. No accounts, no server, no analytics, no paid
APIs, no AI services.

---

## Get it running

**You need Node 22 or newer** (`node --version`). Node 24 is what it is
developed against. Anything that ships an npm ≥ 10 will do.

```bash
git clone <this repo> lockin      # or just use the folder you have
cd lockin
npm --prefix web install          # first run only
npm run dev
```

Open **http://localhost:5173**.

That is the whole website. It works with no extension — you just get no real
blocking, and the UI says so rather than pretending.

### Or: keep it running always

`npm run dev` lasts as long as the terminal does. To have LockIn simply *be
there* — at login, after a reboot, with no terminal open:

```bash
npm run service:install
```

That installs a macOS LaunchAgent that builds the site and serves it on
**http://localhost:5173** forever, restarting itself if it ever stops.

```bash
npm run service:status      # installed? responding? recent errors?
npm run service:restart     # rebuild and pick up code changes
npm run service:uninstall   # remove it entirely
```

Two things to know:

- It serves the **production build**, not the dev server, because a Vite dev
  server is built for an editing session and not for running for weeks. Source
  changes need `npm run service:restart` to appear.
- It binds to `127.0.0.1` only, so it is not reachable from the network.

Use `npm run dev` while you are editing code, and the service the rest of the
time. Don't run both — they want the same port.

### Add real website blocking

The extension has no build step in development; load the folder as-is.

1. Open `chrome://extensions` (Chrome won't let a page open this for you).
2. Turn on **Developer mode**, top right.
3. **Load unpacked** → select `lockin/extension` — the folder that directly
   contains `manifest.json`.
4. **Reload the LockIn tab.** A content script only attaches to pages loaded
   after the extension was installed.
5. **Settings → Browser protection → Test connection.**

To watch it work: add a site under **Blocked websites**, then press **Start
5-minute blocking test**.

> The dev port is fixed at **5173**. The extension's committed configuration
> names that origin. If something else is holding the port, free it rather than
> letting Vite pick 5174 — see [Origins](#origins-development-and-production).

### Screen-share note

Edgenuity screen proof needs a secure context for `getDisplayMedia`.
`http://localhost:5173` counts as secure; a LAN address like
`http://192.168.1.5:5173` does not, and Settings says so instead of showing a
dead button.

---

## What LockIn does

| | |
| --- | --- |
| **Assignments and exams** | Due dates, estimates, priorities, and time actually logged against each one. |
| **Smart Study Planner** | A deterministic daily schedule built from due dates, estimates, exams and the hours you said you were free. It reschedules when you fall behind and explains every decision in plain words. |
| **Focus sessions** | A timer that logs real minutes against real work. |
| **Focus Mode** | Blocks the sites you chose until the work you chose is done. |
| **Focus Guard** | With no extension at all, notices when you leave the LockIn tab during Focus Mode and times it. It cannot block, and cannot see where you went — and says both. |
| **Chrome extension** | Does the blocking for real, with `declarativeNetRequest`. Survives closing LockIn and restarting Chrome. |
| **Canvas calendar feed** | Assignments, courses and due dates imported from Canvas's own calendar feed, and kept up to date. It never says whether something was submitted, and LockIn never pretends otherwise. |
| **Canvas verification** | Reads submission status from Canvas pages you open yourself, and counts a verified submission as done. |
| **Edgenuity progress import** | A progress report email or a downloaded course report, parsed on this device. LockIn does not read the Edgenuity website. |
| **Pace** | Ahead / on track / at risk / behind — with reasons, and with "not enough data" as a real answer when a sync failed or a report went stale. |
| **Screen-capture proof** | When Edgenuity runs on the same computer as LockIn, share that window and one frame is read by local OCR. Chrome asks every time, and nothing is captured in the background. |
| **School Companion** | Optional, off by default, for a school Chrome profile where installing it is allowed. Says whether Canvas or Edgenuity is open; cannot read a page. |
| **Parent View** | A PIN-gated local dashboard of work, verification and Focus Mode history. |
| **Emergency exit** | Always available, no PIN, no progress required. |

---

## Architecture in five minutes

Two halves that talk over a small, versioned message protocol.

```
web/  (React + TypeScript + Vite + Tailwind)          extension/  (Manifest V3, no build step)
┌──────────────────────────────────────┐              ┌────────────────────────────────────┐
│  pages/ + components/   the UI       │              │  content/bridge.js   relay          │
│  store/reducer.ts       every state  │  window      │  background/         the worker     │
│                         transition   │◄─postMessage►│    service-worker.js messages       │
│  lib/planner/           pure engine  │              │    rules.js          DNR rules      │
│  lib/pace/              the verdict  │              │    calendar.js       feed + the URL │
│  lib/sources/           provenance   │              │    activity.js       tab metadata   │
│  lib/canvas/            what counts  │              │    reminders.js      one door       │
│  lib/edgenuity/         as verified  │              │    canvas.js         trust boundary │
│  lib/storage.ts         localStorage │              │  canvas/             page reader    │
└──────────────────────────────────────┘              └────────────────────────────────────┘

                    school-companion/  (separate, optional, off by default)
                             │  context only, never content
                             ▼
                    scripts/context-bridge.mjs  on 127.0.0.1
```

Five rules explain most of the code:

1. **One completion engine.** `recompute()` in `web/src/store/reducer.ts` is the
   only thing that recounts required work and ends Focus Mode. Every
   verification source produces a completed assignment and lets `recompute()`
   do the rest. There is no second unblock path.
2. **Asymmetric safety.** A false negative is fine; a false positive unlocks
   distractions on work that was never done. Anything ambiguous degrades to
   "couldn't verify", never to a pass.
3. **Page data is untrusted.** Everything crossing a trust boundary is rebuilt
   field by field with caps. No `eval`, no `innerHTML` with detected content.
4. **The planner is pure.** `lib/planner/` never reads the clock (`now` is an
   input), never generates ids, and never decides what is *finished* — it reads
   `assignment.status`. Remaining work is always `estimate − logged`, derived,
   never stored.
5. **Schema migrations, never wipes.** Bump `SCHEMA_VERSION` in
   `web/src/lib/storage.ts` and add a `MIGRATIONS[n]` step. Currently **v9**.
6. **Freshness is derived, never stored.** `lib/sources/freshness.ts` takes
   `now` and works out whether a record is live, synced, imported, stale or
   unavailable every time it is asked. Nothing persists that state, so nothing
   can go on claiming to be live after its source stops answering.
7. **A missing sync is never bad news about the student.** Stale data produces
   "not enough data" with the source named — never "behind". Nothing is called
   overdue on a due date LockIn cannot currently believe.

`HANDOFF.md` has the full list of invariants and the file-by-file map. Read it
before changing anything structural.

### Two hand-synced mirrors

The extension has no bundler, so two pairs of files are kept in step by hand.
**Change both together.**

- `web/src/lib/domains.ts` ↔ `extension/shared/domains.js`
- `web/src/lib/canvas/verification.ts` ↔ `extension/canvas/status.js`

---

## Origins: development and production

Three places have to agree about where the website lives: the extension's ES
module config, its classic-script twin (the content script can't `import`), and
`content_scripts.matches` in the manifest.

All three are generated from `lockin.config.json` by
`scripts/gen-extension-config.mjs`, and are committed with development values
so "Load unpacked" works straight from the repo.

```bash
npm run config:extension     # regenerate for development

# a production package, for an origin that exists
LOCKIN_ENV=production LOCKIN_APP_ORIGIN=https://lockin.example.com \
  npm run package:extension
```

A production build **refuses** to run without `LOCKIN_APP_ORIGIN` rather than
quietly shipping localhost, and refuses a plain-`http` non-loopback origin,
because the camera needs a secure context.

---

## Building a release

```bash
npm run build              # production website  → web/dist
npm run build:extension    # shipping extension  → release/extension
npm run package:extension  # + zip               → dist/lockin-extension-v1.1.0.zip
npm run build:release      # both
```

The packaging script copies an **allowlist** of directories, not everything
minus a denylist, then verifies the result: no tests, no fixtures, no keys, and
every file the manifest references actually present.

`RELEASE_CHECKLIST.md` is the full pre-ship list. `MANUAL_QA.md` is the human
test.

Phase 8 prepares a release; it does not publish one. Nothing here uploads to
the Chrome Web Store.

---

## Testing

```bash
npm test          # ~520 logic, state, security, storage, time and release checks (~6s)
npm run test:all  # everything, including 10 real-browser suites (~10 min)
```

The browser suites need **Chrome for Testing** — branded Chrome 137+ ignores
`--load-extension`. Install one from
[chrome-for-testing](https://googlechromelabs.github.io/chrome-for-testing/) and
either put it at `~/chrome/...` or set `CHROME_BIN`.

Every suite that drives the website also needs `npm run dev` running on `:5173`
in another terminal. The exception is `test:release-e2e`, which builds and
serves the production site itself on `:4173`.

| Suite | What it proves | Command |
| --- | --- | --- |
| Blocking, Canvas, Edgenuity, challenge, parent, planner logic | The rules are right | `npm test` |
| Provenance and the Pace Engine | Stale data never becomes "behind" | `npm run test:pace` |
| Canvas calendar feed | Parsing, time zones, and update-not-duplicate | `npm run test:canvas-ics` |
| Edgenuity import | Report parsing, tri-state completion, the merge | `npm run test:edgenuity-import` |
| Companion | Categorisation, cooldowns, snooze, presence | `npm run test:companion` |
| Context bridge | Every refusal: secret, replay, schema, smuggling | `npm run test:context-bridge` |
| Phase 16 state | The v9 migration, and screens' empty/stale/error states | `npm run test:phase16` |
| Screen-capture proofs | Trust ceiling, the live gate, source pairing | `npm run test:edgenuity-screen` |
| Storage recovery | Corrupt, partial and oversized saves recover | `npm run test:storage` |
| Security | The ten bypass paths stay closed | `npm run test:security` |
| Time boundaries | 23:59, midnight, DST, month and year ends | `npm run test:time` |
| Release safety | No fixture, no secret, no drifted version ships | `npm run test:release` |
| Performance | Budgets on a 100-assignment dataset | `npm run test:perf` |
| Focus Guard + quick-add | Away tracking stays honest; the parser never guesses | `npm run test:phase9` |
| Canvas parser | Real Canvas DOM | `npm run test:parser` |
| Blocking E2E | Real Chrome, real rules | `npm run test:e2e` |
| Canvas E2E | Detection → verification → unlock | `npm run test:canvas-e2e` |
| Edgenuity OCR | The real engine on real images | `npm run test:edgenuity-ocr` |
| Edgenuity E2E | Real camera API | `npm run test:edgenuity-e2e` |
| Parent E2E | PIN, controls, enforcement | `npm run test:parent-e2e` |
| Planner E2E | Plan → start → partial → recalculate | `npm run test:planner-e2e` |
| Release E2E | Production build + packaged zip | `npm run test:release-e2e` |
| Accessibility E2E | Names, focus, keyboard, 320–768px, 200% zoom | `npm run test:a11y-e2e` |

If a suite says the debug port is in use: `pkill -f "Chrome for Testing"`.

The Edgenuity and parent suites import `web/src/**/*.ts` directly — Node strips
the types and `extension/tests/ts-resolve.mjs` resolves the extensionless
imports — so they test the shipping modules, not copies.

Add `--headful` to any browser suite to watch it.

---

## Privacy

The claim is simple, and the tests check it: **LockIn sends nothing anywhere.**
No accounts, no sync, no analytics, no crash reporting, no AI services, and no
network requests of its own. `npm run test:release` fails the build if any
source file can reach the network, or if an analytics host appears in the
bundle.

**Stored on the device:** assignments, exams, the plan, focus history,
verification *summaries* (a status, a percentage, a timestamp), the activity
log, per-domain block counts, parent settings, and a salted SHA-256 hash of the
parent PIN.

**Never kept:** photographs, raw OCR text, Canvas passwords or tokens, browsing
history, webcam recordings, screenshots, keystrokes, or location.

The in-app `/privacy` page says the same thing to students. Keep them in step.

---

## Known limitations

**Phase 16 additions, stated plainly:**

- **Canvas submission state needs OAuth nobody has.** The calendar feed carries
  due dates and nothing else. A Developer Key needs a school administrator and
  a confidential client secret, which needs a backend LockIn does not have. The
  adapter boundary is real; the authorization is not.
- **Automatic Edgenuity sync needs your own Google OAuth client id.** LockIn
  ships none, because a shared one would let every install read mail through
  this project's identity. Until then, file import.
- **The Edgenuity parsers have never seen a real progress report.** They are
  written against the documented field names and tested against synthetic
  fixtures. The first real report may need the matchers adjusted.
- **PDF course reports are refused**, with an instruction to export CSV. No PDF
  text extractor is bundled, and OCR-ing a PDF that has perfectly good text
  would be slow, lossy and confidently wrong about numbers.
- **The School Companion needs the local service running**, and only makes
  sense where installing an extension on the school profile is permitted.

These are honest, and they are a product feature rather than an embarrassment —
a student told that blocking is unbreakable will find out otherwise in ten
minutes and stop trusting everything else the app says.

- **A website cannot block websites.** There is no browser permission for it.
  Without the extension LockIn can notice you left, not stop you. Focus Guard
  is that honest half.
- **Anyone who controls Chrome can disable the extension.** LockIn is
  accountability, not a lock.
- **Only this browser is affected.** Other browsers, phones and tablets are
  untouched.
- **Reminders need a LockIn tab open.** There is no server and no push.
- **Canvas detection only sees pages the student opens**, and can break if
  Canvas changes its interface — in which case LockIn reports that it could not
  read the page rather than guessing.
- **Edgenuity OCR can fail** on glare, unusual school themes, or handwriting.
  Fixtures print the code; real students write it, so field reliability is lower
  than the test suite suggests.
- **The parent PIN is accountability, not device security.**
- **The planner works from your estimates**, and cannot know about homework set
  an hour ago.
- **The extension holds broad host access** because Chrome requires it for
  `declarativeNetRequest` redirect rules against user-chosen sites. Consequence:
  Chrome shows no new prompt when connecting Canvas, and the UI says so rather
  than faking consent.
- **Two LockIn tabs are last-writer-wins.** Canvas verification is idempotent,
  so it cannot double-count.
- **Blocking statistics live in extension storage** and disappear with it.
- **A 100-minute day with 45-minute chunks plans 90, not 100.** Two sessions per
  task per day is a deliberate cap; raise the chunk size, not the cap.

---

## Project layout

```
lockin/
├── web/                    the website
│   ├── src/                see HANDOFF.md for the file-by-file map
│   ├── public/ocr/         generated: npm run vendor:ocr
│   └── vite.config.ts
├── extension/              the Chrome extension (no build step in dev)
│   ├── manifest.json
│   ├── shared/config.js    generated from lockin.config.json
│   └── tests/              every automated suite lives here
├── school-companion/       optional, separate package for a school profile
├── scripts/                config generation, release packaging, local service
│   └── context-bridge.mjs  the loopback bridge and its threat model
├── lockin.config.json      where the app lives, per environment
├── docs/research/          evidence briefs behind design decisions
├── HANDOFF.md              architecture, invariants, and why
├── CHANGELOG.md            user-visible changes
├── RELEASE_CHECKLIST.md    what must be true before shipping
└── MANUAL_QA.md            the human test
```

`docs-archive-README-phases.md` is the old development log, kept for the
reasoning behind decisions. It is history, not documentation.

## License

No license has been selected. This is a private project; there are no usage
rights granted to anyone.
