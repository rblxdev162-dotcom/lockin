# LockIn release checklist

Work top to bottom. Anything unticked is a reason not to ship, not a note for
later.

Most of this is automated — the point of the checklist is the handful of things
a test cannot judge, and the discipline of looking at the automated results
rather than assuming them.

```bash
npm run test:all      # everything, ~10 minutes, needs the dev server on :5173
```

---

## Before you start

- [ ] Working tree is clean, and the version in `package.json`,
      `extension/manifest.json` and `web/src/version.ts` all match.
      (`npm run test:release` fails if they don't.)
- [ ] `CHANGELOG.md` has an entry for this version, written for students rather
      than for developers.
- [ ] `npm ci --prefix web` from a clean `node_modules` succeeds.
- [ ] `npm --prefix web audit` reports nothing you have not investigated.

---

## Website

- [ ] `npm run build` succeeds with no TypeScript errors.
- [ ] `npm --prefix web run lint` shows nothing new.
- [ ] **No localhost assumption.** The built site works from any origin — it
      derives its own URL at runtime. Nothing in `web/src` hard-codes a port.
- [ ] **No test bypass.** `npm run test:release` proves `web/dist` contains no
      fixture image, no `TestFixtureCapture`, and no dev seed.
- [ ] **No developer UI.** There is no "load demo data", no "force verified",
      no "skip challenge" reachable in a production build.
- [ ] Privacy page loads at `/privacy` and matches what the code actually does.
- [ ] Help page loads at `/help` and its limitations section is still true.
- [ ] Responsive: no horizontal scrolling at 320 / 375 / 430 / 768px.
- [ ] Accessible: `npm run test:a11y-e2e` passes, and someone has actually
      driven the app with a keyboard (see `MANUAL_QA.md`).

## Extension

- [ ] `extension/manifest.json` requests only permissions that are used.
      `npm run test:release` checks each one against the shipping source.
- [ ] `host_permissions` is `http://*/*` + `https://*/*`, not `<all_urls>`.
      Narrower is not possible while `declarativeNetRequest` redirect rules
      point at user-chosen sites; if that changes, narrow it.
- [ ] Version bumped, icons present at 16/32/48/128.
- [ ] **Production origin configured.** Build with
      `LOCKIN_ENV=production LOCKIN_APP_ORIGIN=https://your.origin`. The
      packaging script refuses to produce a production build without one.
- [ ] No test code in the package: `npm run test:release` walks the output.
- [ ] `npm run package:extension` produces `dist/lockin-extension-v<version>.zip`.
- [ ] The zip has been unpacked into a clean directory and loaded into Chrome —
      `npm run test:release-e2e` does exactly this, end to end.

## Verification

- [ ] Camera requires a secure context, and Settings says so on an insecure one.
- [ ] OCR assets are packaged with the site (`web/dist/ocr`) and load from our
      own origin, never a CDN.
- [ ] No photograph and no raw OCR text is written to storage — the parent E2E
      asserts this against the real store.
- [ ] No fixture capture path exists in the production build.
- [ ] A Standard photo still cannot satisfy an Enhanced requirement, and a spent
      challenge cannot be replayed (`npm run test:security`).

## Planner

- [ ] Timezone and boundary tests pass (`npm run test:time`): 23:59, midnight,
      DST in both directions, month and year ends, missing due time.
- [ ] Overload is reported rather than silently dropped.
- [ ] Capacity respects availability, the buffer and the day ceilings.
- [ ] Missed work carries forward with nothing lost.

## Parent

- [ ] PIN gate works, and the session does not survive a reload.
- [ ] Protected settings are refused by the reducer, not merely hidden.
- [ ] Requirement changes are prospective — they never re-open finished work.

## Reliability

- [ ] Malformed, partial, stale-schema and oversized storage all recover
      (`npm run test:storage`), and the student is told when records were lost.
- [ ] A forward or backward system-clock jump neither corrupts the store nor
      unlocks Focus Mode.
- [ ] Chrome restart with Focus Mode active still blocks.
- [ ] Closing the LockIn tab leaves blocking in place.

## Tests

- [ ] `npm run test:all` — every suite green.
- [ ] Console: zero unexpected errors across every main screen
      (checked by `npm run test:release-e2e`).
- [ ] Performance budgets met (`npm run test:perf`).

## Phase 17 additions

- [ ] `npm run test:pace`, `test:worklist`, `test:canvas-ics`,
      `test:companion` and `test:phase16` all pass.
- [ ] The packaged zip contains `options/`, `background/calendar.js` and
      `background/activity.js`, and contains nothing named `edgenuity`.
- [ ] No `tesseract`, no `web/public/ocr`, no `eng.traineddata` anywhere.
- [ ] The background Canvas tab opens at startup, closes itself, and does not
      steal focus. Turning the toggle off really stops it.
- [ ] A real save file from the previous version opens without losing an
      assignment, and its schema reads 9.
- [ ] The Canvas feed URL appears nowhere in `localStorage`, in an export, or
      in any error message shown to the student.


## Publishing

Phase 8 prepares; it does not publish.

- [ ] Store listing copy written, and honest: not "unblockable", not "parental
      control software", not an official Canvas or Edgenuity integration.
- [ ] Privacy disclosures for the store match `/privacy` in the app.
- [ ] Screenshots taken from a real build.
- [ ] Someone has decided where — or whether — the website is hosted. Staying
      local is a valid answer, and the current one.
- [ ] A decision has been recorded about the license. There is none today.

**Do not upload the extension, register a developer account, buy anything, or
deploy to a paid host as part of a release build.** Those are decisions for the
project owner.
