# LockIn — start here for the next session

Paste the block at the bottom into a fresh conversation, then add your task
underneath it.

## Running the website

```bash
cd /Users/arjun/lockin && npm run dev
```

Then open <http://localhost:5173> in Chrome.

Port 5173 is fixed in development. Since Phase 8 it is *configuration*:
`lockin.config.json` is the source of truth, and `npm run config:extension`
regenerates the extension's copies of it. Don't let a dev server pick 5174 —
free 5173 instead.

First run only: `npm --prefix web install` (it vendors the local OCR engine
automatically via `predev`).

The site works with no extension — you just get no real blocking, and the UI
says so.

## Loading the Chrome extension

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `/Users/arjun/lockin/extension`
3. Reload the LockIn tab → **Settings → Browser protection → Test connection**

## The pages

| URL | What it is |
| --- | --- |
| `/` | Welcome / onboarding (first run) |
| `/home` | Dashboard — Focus Mode, Today's Plan, due soon, exams |
| `/planner` | Smart Study Planner |
| `/assignments` | Assignment list |
| `/exams` | Exams |
| `/focus` | Focus timer + Focus Mode controls |
| `/activity` | Activity log |
| `/grades` | Class grades read off your Canvas Grades page |
| `/settings` | Blocking, Canvas, **Canvas checks (school hours)**, parent PIN, **your data** |
| `/help` | Help, known limits, About + versions |
| `/privacy` | What is stored, what is discarded, what is sent |
| `/parent` | Parent Dashboard (PIN-gated, no student shell) |

Canvas note: LockIn reads the Canvas **Grades** page you have open when you
press **Check Canvas**, and nothing else. It makes no request to Canvas, and
every path is behind the school-hours gate in `web/src/lib/canvas/checkWindow.ts`
(mirrored into the extension and the local service). It ships manual-only.

Dev shortcut (dev builds only): `lockinSeed()` in the browser console writes a
realistic test profile; `lockinSeed.clear()` wipes it.

## Running the tests

```bash
cd /Users/arjun/lockin
npm test            # ~374 logic/state/security/storage/time/release checks, ~3s
npm run test:all    # everything, including 10 real-browser suites
```

Browser suites need Chrome for Testing (branded Chrome 137+ ignores
`--load-extension`), at `~/chrome/mac_arm-152.0.7977.42/...` or `CHROME_BIN`.
Every suite that drives the website also needs the dev server on 5173 in
another terminal — except `test:release-e2e`, which builds and serves the
production site itself on 4173.

If a suite says the debug port is in use: `pkill -f "Chrome for Testing"`.

The Edgenuity and parent E2E suites run real OCR over rendered fixtures and are
genuinely flaky. Re-run once before investigating.

## Building a release

```bash
npm run build:release      # website → web/dist, extension → dist/*.zip

LOCKIN_ENV=production LOCKIN_APP_ORIGIN=https://your.origin \
  npm run package:extension
```

---

## Paste this into a new chat

Continue the existing LockIn project at `/Users/arjun/lockin`.

Read `/Users/arjun/lockin/README.md` first, then `HANDOFF.md`. Both are current
as of the end of Phase 8.

Phases 1–8 are complete, tested, and must not be rebuilt:

1. React/TS website — assignments, exams, focus timer, Focus Mode, parent PIN
2. Chrome extension — real `declarativeNetRequest` website blocking
3. Canvas browser verification
4. Edgenuity live-camera OCR verification (local Tesseract, no cloud)
5. Enhanced Proof — one-time challenge codes, trust levels, anti-replay
6. Parent Accountability Dashboard — PIN-gated `/parent`, local only
7. Smart Study Planner — deterministic scheduler in `web/src/lib/planner/`
8. Release readiness — configurable origins, extension packaging, protocol
   versioning, privacy page, data export, storage recovery, retention caps,
   accessibility audit, security review, and the release/a11y/performance suites

Before changing anything, inspect the existing architecture. Do not create a
second verification system, a second unblock path, a second timer, a second
parent system, or a second planner. Extend what exists.

All 24 architecture invariants in `HANDOFF.md` still apply. The ones people
break most often:

- `recompute()` in `web/src/store/reducer.ts` is the only completion engine.
- `web/src/lib/planner/` is pure and deterministic: `now` is an input, no
  `uid()`, no clock reads, and it reads `assignment.status`.
- Remaining work is always derived as `estimate − logged`; never stored.
- Schema changes are migrations, never wipes. Currently **v7**.
- Local only: no network calls, no accounts, no analytics, no AI APIs.
- `web/src/lib/domains.ts` ↔ `extension/shared/domains.js` and
  `web/src/lib/canvas/verification.ts` ↔ `extension/canvas/status.js` are
  hand-synced mirrors — change both together.
- Test-only code is *eliminated* from production builds, not hidden; the
  release suite fails the build if it reappears.
- Three files carry the version (`package.json`, `extension/manifest.json`,
  `web/src/version.ts`) and must agree.

Run `npm run test:all` before finishing.

Here is the task:

[PASTE YOUR TASK HERE]
