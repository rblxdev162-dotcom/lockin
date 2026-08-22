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

> By default LockIn blocks **after school and only after school**: nothing is
> blocked between your configured first and last bell, and your blocked sites
> are blocked from the last bell until midnight with no Focus session running.
> Both halves are toggles under **Settings → Browser Protection**, which name
> the exact hours they derived. The 5-minute test above ignores the schedule
> on purpose, so it works whenever you press it.

> The dev port is fixed at **5173**. The extension's committed configuration
> names that origin. If something else is holding the port, free it rather than
> letting Vite pick 5174 — see [Origins](#origins-development-and-production).

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
| **Canvas calendar feed** | Assignments, courses and due dates from Canvas's own calendar feed — by LockIn's local service (no extension needed, keeps running with Chrome closed) or by the Companion. Refreshed on a timer only if you switch that on, and never during your school hours. |
| **Canvas status and grades** | Graded, submitted, missing, excused, scores, and each class's current grade — read off the Canvas **Grades** page you opened yourself, when you press **Check Canvas**. LockIn makes no request to Canvas: no API call, no token, no polling, no background tab. |
| **Honest Canvas coverage** | Every check says whether it read a class gradebook, class totals only, dates only, a limited page, or an unrecognised layout. A tab answering is never treated as proof that its rows parsed. |
| **The check gate** | One rule in front of every Canvas path, in the app, the extension and the local service. Manual-only by default; automatic checks are disabled during your configured school hours; every decision, allowed or refused, is logged. |
| **What to do next** | One ordering everywhere: missing, then overdue, then dates that need a fresh sync, then today and upcoming — strictly by due time inside each. Priority never beats a deadline. |
| **By class** | Home summarises each class in one compact card; Assignments has a generated class switcher (including short teacher labels such as Chopra or Emmett) and opens grouped by class. |
| **Pace** | Ahead / on track / at risk / behind — with reasons, and "not enough data" as a real answer when a sync failed. |
| **Parent View** | A PIN-gated local dashboard of work, verification and Focus Mode history. |
| **Transparent accountability** | Student View states exactly what Parent View can and cannot see, with the same weekly headline numbers. |
| **Weekly review** | A local seven-day recap of completed work, focused minutes, blocked attempts and estimate accuracy, followed by one deterministic adjustment — never a score or comparison. |
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
│  lib/workState.ts       state+order  │              │    activity.js       tab metadata   │
│  lib/sources/           provenance   │              │    reminders.js      one door       │
│  lib/canvas/            what counts  │              │    canvas.js         trust boundary │
│  lib/storage.ts         localStorage │              │  canvas/             page reader    │
└──────────────────────────────────────┘              └────────────────────────────────────┘
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
   `web/src/lib/storage.ts` and add a `MIGRATIONS[n]` step. Currently **v16**.
6. **Freshness is derived, never stored.** `lib/sources/freshness.ts` takes
   `now` and works out whether a record is live, synced, imported, stale or
   unavailable every time it is asked. Nothing persists that state, so nothing
   can go on claiming to be live after its source stops answering.
7. **A missing sync is never bad news about the student.** Stale data produces
   "not enough data" with the source named — never "behind". Nothing is called
   overdue on a due date LockIn cannot currently believe.
8. **One comparator.** `lib/workState.ts` decides both what state a piece of
   work is in and what order it comes in. Missing, overdue, dates needing a
   fresh sync, today, upcoming — then strictly by due time. Priority never
   beats a deadline, and stale external dates are never called overdue.

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

The production origin is the published site,
`https://rblxdev162-dotcom.github.io`, committed in `lockin.config.json`.

```bash
npm run config:extension     # regenerate for development

# a production package, using the committed production origin
LOCKIN_ENV=production npm run package:extension

# or an extra origin — a staging build, or a custom domain
LOCKIN_ENV=production LOCKIN_APP_ORIGIN=https://lockin.example.com \
  npm run package:extension
```

A production build **refuses** to run with no origin configured at all rather
than quietly shipping localhost, and refuses a plain-`http` non-loopback
origin, because a secure context is required. `npm run test:release` pins that
every production origin is `https` and none is loopback.

---

## Publishing the site

```bash
npm run build        # web/dist
npm run deploy:site  # copy web/dist into the public Pages repo and push
```

The site is served from the **root** of a GitHub user site, so there is no base
path and no router basename: `/home` live is `/home` in development, which is
what lets one `appPath` describe both. `scripts/deploy-site.mjs` replaces the
published tree wholesale (a deleted file must disappear from the site), writes
`.nojekyll`, and copies `index.html` to `404.html` so a reload on `/assignments`
still reaches the router.

Only the built site is published. This repository is not.

To move to a custom domain later: buy it, add a `CNAME` file to the Pages repo
(or set the domain in its Pages settings), point DNS at GitHub, then add the new
origin to `lockin.config.json` and repackage the extension so its bridge still
recognises the site.

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

`npm run deploy:site` publishes the website. Nothing here uploads to the Chrome
Web Store — that needs a paid developer account and a review.

---

## Testing

```bash
npm test          # ~410 logic, state, security, storage, time and release checks (~5s)
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
| Blocking, Canvas, parent, planner logic | The rules are right | `npm test` |
| Provenance and the Pace Engine | Stale data never becomes "behind" | `npm run test:pace` |
| Canvas calendar feed | Parsing, time zones, and update-not-duplicate | `npm run test:canvas-ics` |
| Companion | Categorisation, cooldowns, snooze, calendar cadence | `npm run test:companion` |
| Work states and ordering | Graded vs submitted vs done, urgency, class columns | `npm run test:worklist` |
| Phase 16 state | The v9 migration, and screens' empty/stale/error states | `npm run test:phase16` |
| Storage recovery | Corrupt, partial and oversized saves recover | `npm run test:storage` |
| Security | The ten bypass paths stay closed | `npm run test:security` |
| Time boundaries | 23:59, midnight, DST, month and year ends | `npm run test:time` |
| Release safety | No fixture, no secret, no drifted version ships | `npm run test:release` |
| Performance | Budgets on a 100-assignment dataset | `npm run test:perf` |
| Focus Guard + quick-add | Away tracking stays honest; the parser never guesses | `npm run test:phase9` |
| Canvas parser | Real Canvas DOM, incl. Grades pages | `npm run test:parser` |
| The Canvas gate | Its three mirrors, over ~1,000 cases | `npm run test:canvas-grades` |
| Blocking E2E | Real Chrome, real rules | `npm run test:e2e` |
| Canvas E2E | Detection → verification → unlock | `npm run test:canvas-e2e` |
| Parent E2E | PIN, controls, enforcement | `npm run test:parent-e2e` |
| Planner E2E | Plan → start → partial → recalculate | `npm run test:planner-e2e` |
| Release E2E | Production build + packaged zip | `npm run test:release-e2e` |
| Accessibility E2E | Names, focus, keyboard, 320–768px, 200% zoom | `npm run test:a11y-e2e` |

If a suite says the debug port is in use: `pkill -f "Chrome for Testing"`.

The parent, pace and planner suites import `web/src/**/*.ts` directly — Node strips
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

**Stated plainly:**

- **There is no Edgenuity integration.** Removed in Phase 17: the course report
  cannot cross Chrome profiles, and the progress email arrives weekly, which is
  useless for live data. An integration that is right one day in seven is worse
  than none, because the app quotes it as current.
- **A Canvas feed cannot be fetched by the page.** Canvas serves it with no
  `Access-Control-Allow-Origin` header — measured against a real feed. Either
  LockIn's local service or the Companion extension has to do it; with neither,
  the `.ics` file import still works.
- **Graded status needs you to open the Canvas Grades page, in the same Chrome
  profile as the extension, and press Check Canvas.** That is the deal, and it
  is deliberate: a calendar feed does not carry submission state, and every
  automatic alternative either needs credentials a student cannot issue or
  amounts to a program contacting the school's systems on its own. LockIn reads
  the page you opened. If Canvas lives in a different profile, LockIn shows due
  dates only and says so.
- **Nothing is read during your configured school hours**, including the
  calendar refresh, including while every browser is closed. A refusal can be
  overridden by an explicit second press, and that override is logged.
- **LockIn never computes a grade.** A class whose total Canvas hides is shown
  as "Canvas isn't publishing a total for this class".
- **Canvas submission state via OAuth** would need a school administrator and a
  backend for the client secret. Neither exists, and student access-token
  generation is disabled on the Canvas instance this was built against.

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
├── scripts/                config generation, release packaging, local service
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
