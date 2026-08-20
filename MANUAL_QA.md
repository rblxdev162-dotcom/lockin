# LockIn manual QA

A human test from zero. The automated suites prove the logic; this proves the
*experience* — the parts a machine cannot judge, like whether an error message
tells you what to do next.

Budget about 45 minutes. Work through in order; the steps build on each other.

## Setup

```bash
cd /Users/arjun/lockin
npm --prefix web install     # first time only
npm run dev
```

Use a **fresh Chrome profile**, or clear site data for `localhost:5173` first —
half of what is being tested here is the first-run experience, and you only get
one of those per profile.

> Developer shortcut, dev builds only: `lockinSeed()` in the console writes a
> realistic profile, `lockinSeed.clear()` wipes it. Do **not** use it for steps
> 1–3; those are about the empty state.

---

### 1 · Clean profile

- [ ] Open `http://localhost:5173`. The welcome screen explains what LockIn is
      without jargon.
- [ ] Nothing is pre-filled. No sample assignments, no demo data.

### 2 · Onboarding

- [ ] **Name.** Continue is disabled until you type something.
- [ ] **Schoolwork.** You can skip it. Do skip it — the app must be usable with
      no assignments.
- [ ] **Study time.** The three presets are understandable without explanation.
      Change the times; the summary line updates.
- [ ] Workload (Light / Balanced / Intensive) explains what it changes, and says
      it does not change what matters most.
- [ ] **Reminders.** Each mode has a one-sentence explanation.
- [ ] **Distractions.** Nothing is preselected.
- [ ] **Blocking.** It says clearly that the extension is not installed, and
      that everything else still works.
- [ ] **Parent PIN.** You can skip it.
- [ ] You land on the dashboard, and it does not look broken with no work in it.

### 3 · Add work

- [ ] Add an assignment due tomorrow. It appears on the dashboard.
- [ ] Add an exam two weeks out.
- [ ] Open `/planner`. A plan exists — onboarding configured availability, so
      this is **not** an empty "set this up first" screen.
- [ ] Each planned item explains why it is there, in plain words.

### 4 · Extension

- [ ] `chrome://extensions` → Developer mode → Load unpacked → `lockin/extension`.
- [ ] Reload the LockIn tab. Settings → Browser protection shows **Connected**,
      with a version and a message-format version.
- [ ] "What would be blocked" reflects your actual settings.
- [ ] Press **Test connection**. It confirms.

### 5 · Blocking

- [ ] Add `youtube.com` to blocked sites.
- [ ] Run the 5-minute blocking test from Settings.
- [ ] Open `youtube.com`. You reach the block page.
- [ ] The block page shows the friendly name **and** the exact domain.
- [ ] It shows what work is required, and offers **Open LockIn**.
- [ ] It does not shame you. Read it as a 14-year-old would.
- [ ] Open `docs.google.com`. It opens. School sites are never blocked.

### 6 · Focus Mode

- [ ] Start Focus Mode with one required assignment.
- [ ] The banner appears on every screen.
- [ ] `youtube.com` is blocked.
- [ ] Complete the assignment. Focus Mode ends and the site unblocks.

### 7 · Canvas (optional, needs a real Canvas)

- [ ] Settings → Canvas → connect your school domain, grant access.
- [ ] Open a Canvas assignment page. LockIn detects it.
- [ ] Import it, submit something in Canvas, return to LockIn: it verifies.
- [ ] Disconnect. Nothing about Canvas remains except assignments you chose to
      keep.

### 8 · Edgenuity verification (needs a second screen and a camera)

- [ ] Configure an Edgenuity assignment with a progress target.
- [ ] Start verification. The guidance explains what to photograph.
- [ ] **First OCR is slow.** It should say what it is doing — not sit blank.
- [ ] Take a deliberately bad photo (angled, or covered). It refuses and tells
      you *why*, with something to try.
- [ ] Take a good photo. It reads the percentage.
- [ ] Do some work, verify again. Only new progress is credited.
- [ ] Cover the camera and try. The error names the problem, not an exception.

### 9 · Enhanced Proof

- [ ] Turn on Enhanced Proof in Settings.
- [ ] Start a verification. A code is issued.
- [ ] Photograph the screen **without** the code. It is refused.
- [ ] Write the code down, photograph both together. Accepted.
- [ ] Try to reuse the same code for the final photo. Refused.

### 10 · Parent View

- [ ] Set a parent PIN. Open `/parent`.
- [ ] The wrong PIN is refused; the right one gets in.
- [ ] It shows work, verification and Focus Mode history — and nothing about
      browsing, messages or location.
- [ ] Lock verification settings. As the student, try to change the proof mode:
      it asks for the PIN.
- [ ] Exit Parent View. Reload `/parent`. It asks for the PIN again.

### 11 · Planner under pressure

- [ ] Add enough work to overload the week. The planner warns rather than
      silently dropping it.
- [ ] Skip an item ("can't do this today"). No PIN needed, no minutes lost.
- [ ] Reorder a day with the up/down controls, using only the keyboard.

### 12 · Unlocks and exits

- [ ] Start a Strict Focus Mode session.
- [ ] Temporary unlock: blocking pauses, then returns on its own.
- [ ] Parent override: unlocks immediately.
- [ ] Emergency exit: always available, needs a 3-second hold and a reason,
      and is recorded.

### 13 · Restart and refresh

- [ ] With Focus Mode active, quit Chrome completely and reopen it. Blocking is
      still on before you open LockIn.
- [ ] Refresh LockIn mid-session. The timer and Focus Mode survive.
- [ ] Disable the extension while Focus Mode is running. LockIn says
      **Browser Protection isn't responding** rather than pretending.
- [ ] Re-enable it. The banner clears.

### 14 · Data

- [ ] Settings → Your data → Export. Open the file. Check with your own eyes
      that there is no PIN, no hash, no salt, no challenge code.
- [ ] Clear activity history. It asks for the PIN, and assignments survive.
- [ ] Reset LockIn. It warns properly, and you land back at the welcome screen.

### 15 · Keyboard and zoom

Do these with the mouse **unplugged**, or your hands off it.

- [ ] Complete onboarding.
- [ ] Add an assignment.
- [ ] Open the planner.
- [ ] Start and end a focus session.
- [ ] Enter and exit Parent View.
- [ ] Open a dialog: focus lands inside it, Tab stays inside, Escape closes it,
      and focus comes back to the button you opened it from.
- [ ] Set browser zoom to 200%. Every core action is still reachable.
- [ ] Turn on your OS screen reader for five minutes on the dashboard and the
      focus timer. Note anything that reads as gibberish.

### 16 · Themes

- [ ] Switch between light and dark on: dashboard, planner, parent dashboard,
      the OCR dialog, the challenge code card, warnings, the privacy page, the
      block page, and the extension popup.
- [ ] Nothing is unreadable in either theme.

### 17 · Canvas: the feed, and what it keeps up to date

Needs a real Canvas account and the Companion installed.

- [ ] Integrations → Canvas → **Connect Canvas Calendar**. Paste the feed
      address from Canvas → Calendar → Calendar Feed.
- [ ] The review screen lists real assignments before anything is added.
- [ ] Apply. The assignments appear with the right due dates *in your own time
      zone* — check one that is due at 11:59pm.
- [ ] **Sync again immediately.** It says everything is up to date and creates
      no duplicates.
- [ ] Move an assignment's due date in Canvas, wait for the feed, sync again.
      The existing assignment moves; a second copy is not created; any logged
      time survives.
- [ ] Search `localStorage` in DevTools for a fragment of the feed URL. It must
      not be there. Export your data and search that too.
- [ ] Disconnect. The assignments stay.

### 17b · Canvas: automatic, and graded status

- [ ] Leave LockIn open for half an hour with the feed connected. It syncs on
      its own — check Activity for the entry, with no button pressed.
- [ ] Quit Chrome entirely and reopen it. A Canvas tab opens in the background
      and closes itself within a minute or two; the assignment list is current.
- [ ] Assignments page: work Canvas has marked reads **Graded**, work you have
      handed in but is unmarked reads **Submitted**, work you ticked off here
      reads **Done**, and anything Canvas flags reads **Missing**.
- [ ] Integrations → Canvas → turn the background-tab toggle off. Restart
      Chrome: no tab opens, and the feed still syncs.
- [ ] Sort check: something overdue sits above something due today, which sits
      above next week — regardless of priority.
- [ ] **By class**: the columns are one per class, and the class with the most
      urgent work is leftmost.

### 18 · Reminders and the popup

- [ ] Close every LockIn tab. A reminder still arrives.
- [ ] It has **Start Focus** and **Snooze 20m** buttons.
- [ ] Start Focus opens LockIn at that assignment.
- [ ] Snooze silences that assignment only, and it returns ~20 minutes later.
- [ ] Two assignments due at once produce **one** notification, not two.
- [ ] Open the extension popup while a session runs: the task and countdown.
      Idle: the next assignment and a Start Focus button.
- [ ] Extension options page opens and reports today's counters.


---

## Reporting

For each problem, write down: what you did, what happened, what you expected.
If it is a wrong *message* rather than a wrong behaviour, say what you would
have wanted it to say — that is usually the more valuable bug.
