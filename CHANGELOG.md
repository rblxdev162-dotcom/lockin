# Changelog

User-visible changes only. Internal architecture and phase history live in
`HANDOFF.md`.

## 1.2.1

### LockIn can now just always be there

`npm run service:install` sets up a login service that serves LockIn at
http://localhost:5173 permanently — starting at login, surviving reboots, and
restarting itself if it ever stops. No terminal to keep open, nothing to
restart by hand.

It serves the built site rather than the development server, which is the part
that kept dying. Remove it any time with `npm run service:uninstall`; your data
is in the browser, not the server, so nothing is lost either way.

## 1.2.0

### Canvas is no longer hidden in Settings

Connecting Canvas used to be a thing you had to already know about: the setup
lived in Settings, and — worse — the list of assignments Canvas had *found* was
reachable only from inside that same panel. You could connect it, browse your
courses, come back, and see an app that looked identical.

Now there are three ways in, and connecting lands you on what you gained:

- **An empty assignments list offers Canvas directly**, with a button, instead
  of mentioning it in a sentence that goes nowhere.
- **Found work announces itself** on the dashboard and the assignments list —
  "3 assignments found on Canvas" — with a Review button. Nothing is ever added
  without you choosing it, and the banner can be dismissed.
- **Connecting opens the import list**, from any of the three entry points,
  rather than returning you to the settings panel you started in.

Canvas is deliberately still absent from first-run setup: it belongs at the
moment it's relevant, not as a fifth step before you've seen an assignment list.

## 1.1.0

### Focus Guard — the honest half

A website cannot block websites. There is no browser permission for it, and no
browser gives a page that power. So LockIn now does the thing a page genuinely
can do: while Focus Mode is running, it notices when you leave the LockIn tab
and times how long you're gone.

It says what it can't do, out loud. It cannot stop you, and it cannot see where
you went — the browser only reports "visible" or "hidden", and LockIn does not
use any other feature that could find a destination. Trips under five seconds
aren't counted. It's off outside Focus Mode, and you can turn it off entirely.

### Blocking is now a question, not a chore

The extension used to be presented as setup homework. It's now a permission
request: what access is granted, what LockIn still won't be able to see, and
what happens if you say no — which is a real answer that leads to Focus Guard
rather than a dead end.

### Adding work is one field now

The old form asked seven things every time. Now you type it the way you'd say
it — `bio lab report next tuesday 5pm` — and that's the whole interaction.

- **The input shows its own work.** The bits LockIn understood are underlined
  as you type, so you never have to wonder what it did with your words.
- **It never asks how long something will take.** It guesses from the kind of
  work, then learns from how long your work in that subject actually takes you
  — and tells you which of those it did rather than pretending.
- **Corrections are one tap.** Due date, length and priority sit under the box
  as chips; tap one to change it. The full form is still there under "More
  options" for the rare case.
- **Nothing is required but the words.** No due date, no estimate, no subject.
  Undated work is real work.
- **Onboarding is four steps instead of seven.**

### Fixed

- A long exam name pushed the Exams page sideways on a phone.
- Site names were wrong for any domain outside a hard-coded list — a school
  `.edu` address displayed as "Edu". The block page now shows the friendly name
  *and* the exact domain.

## 1.0.0

The first release-candidate build of LockIn: a local-first study app with a
Chrome extension that can plan your schoolwork, verify some of it, and block
distracting websites while you finish it.

### Plan and track

- **Assignments and exams** with due dates, time estimates and priorities.
- **Smart Study Planner** — a daily schedule built from your due dates,
  estimates, exams and the hours you said you were free. It reschedules itself
  when you fall behind and explains, in plain words, why each day looks the way
  it does. Unfinished minutes are never lost.
- **Focus sessions** with a timer that logs real minutes against real work.

### Stay off the distractions

- **Focus Mode** blocks the websites you chose until the work you chose is
  done. School sites and Google are protected in code and can never be blocked.
- **A Chrome extension** does the blocking for real, and keeps working if you
  close LockIn or restart Chrome.
- **Emergency exit** always works, with no PIN and no progress required.
- **Temporary unlock** for the times you genuinely need a blocked site.

### Prove the work got done

- **Canvas** — LockIn reads submission status from Canvas pages you open, and
  counts a verified submission as done.
- **Edgenuity** — take a live photo of the progress screen before and after;
  LockIn reads it on your device and credits the progress it can actually see.
- **Enhanced Proof** — a one-time code, written by hand and photographed with
  the screen, so a screenshot taken yesterday cannot be reused today.

### For parents

- **Parent View** — a PIN-gated, local dashboard of schoolwork, verification
  and Focus Mode history, plus switches to raise the proof requirements. It
  shows no browsing, no messages, no location and no camera, because LockIn
  collects none of those.

### Privacy

- Everything stays on your device. No accounts, no sync, no analytics, no AI
  services, and no network requests of LockIn's own.
- Photos are read and discarded, never stored. Blocked sites are counted, never
  logged.
- Export everything, clear individual histories, or erase it all, from
  Settings → Your data. A new Privacy page spells out exactly what is kept.

### Known limits

Listed honestly in the app under Help, and in `README.md`. The short version:
anyone who controls Chrome can switch the extension off, only this browser is
affected, and photo verification makes lying harder rather than impossible.
