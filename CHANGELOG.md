# Changelog

User-visible changes only. Internal architecture and phase history live in
`HANDOFF.md`.

## 1.5.0

### LockIn can finally tell what you've already handed in

Your Canvas connection is a **calendar feed**, and a calendar feed carries a
title and a due date and nothing else — no submission status, no scores. So
everything looked permanently undone, however much you'd handed in.

Now: open Canvas, go to **Grades** — either the all-classes list or one class —
and press **Check Canvas**. LockIn reads the page that is already on your
screen and fills in what's *submitted*, *graded*, *missing*, *excused*, and the
actual scores.

It does that by reading the page you opened. It does **not** call the Canvas
API, use an access token, poll anything, or open Canvas in a background tab.
Nothing is sent anywhere.

### Grades for every class

A new **Grades** page: each class with the grade Canvas publishes for it,
oldest-first by need (the class that wants attention is at the top), and the
marked work behind each one with its score out of the points possible.

Where your teacher has totals switched off, LockIn says *"Canvas isn't
publishing a total for this class"* rather than working one out. It never
computes a grade — every number here was printed on a page you opened.

Your class grade also shows on the Assignments class columns, and there's a
one-line grades strip on Home.

### Nothing touches Canvas during your school hours

There is now a single rule in front of **everything** Canvas-shaped: reading a
page, refreshing your calendar, the startup catch-up, all of it.

- **Automatic checks are off out of the box.** LockIn reads Canvas when you
  press the button, and at no other time.
- **Automatic Canvas checks are disabled during your configured school hours** —
  set in onboarding and changeable in Settings → Canvas checks. This applies to
  the local service too, which keeps running with Chrome closed.
- Not at school on a weekday? A refused check offers **"I'm not at school —
  check anyway"**, and that override is written to your activity log.
- **Pause for an hour / until tomorrow**, whenever you want.
- Every decision — allowed or refused — is logged, so you can show exactly when
  LockIn did and did not read Canvas.

The background Canvas tab from 1.4.0 is **gone**, not switched off.

### A calmer layout

- Five things in the nav instead of six: Home, Assignments, **Grades**, Plan,
  Focus. Progress and Integrations moved one tap away; every old link still
  works.
- Assignment tabs now use the words Canvas and Google Classroom already use:
  **To do · Missing · Upcoming · Done**.
- Home lost the Connections card — connection state is one quiet line at the
  bottom, and the banner still shouts when something is actually wrong.

## 1.4.1

### Connecting Canvas actually works now

The connect button needed the Companion extension, which meant it did nothing
if you hadn't installed one. It no longer does: **LockIn's own local service
fetches the feed**, so connecting works with nothing else installed — and it
keeps checking every 30 minutes even while Chrome is closed.

Connecting now also proves the address works before saying "Connected", instead
of accepting it and failing quietly later.

### Your class names are readable

Canvas hands out section names like `E4007-PPer 2 (11:40 AM - 12:30 PM)-Emmett`.
Those are now shown as **Per 2 — Emmett**. Two of your classes were also filed
under "General" because their names contain brackets that the parser couldn't
read; both are fixed, and existing assignments correct themselves on the next
sync.

## 1.4.0

### Canvas keeps itself up to date

LockIn now checks your Canvas calendar **every 30 minutes** on its own, and
again the moment you start your computer — so the list is already right when
you open it, rather than right after you remember to press sync.

### It knows what's graded

A calendar feed says when work is due. It never says whether you handed it in.
So if you let it, LockIn opens Canvas in a background tab at startup and reads
the status from your own session — and now tells four things apart that used to
look identical:

- **Graded** — marked, done, nothing to think about.
- **Submitted** — handed in, not marked yet.
- **Done** — you ticked it off here.
- **Missing** — Canvas says the deadline passed with nothing handed in.

The background tab is one page load, on the site you were about to open anyway,
and it closes itself. One toggle in Integrations turns it off.

### One order, and it's the right one

Everything is sorted the same way now: missing first, then overdue, then today,
then what's coming — and strictly by due time inside each. **Priority never
beats a deadline**, so a "Normal" worksheet due in an hour sits above an
"Urgent" essay due next week.

### Your classes as columns

A **By class** switch on the assignments page lays the same work out one column
per class, with the class that needs you most on the left.

### Edgenuity is gone

Both legitimate ways in turned out not to work for a real setup: the course
report can't cross Chrome profiles, and the progress email only arrives weekly
— useless for knowing where you stand today. An integration that's right one
day in seven is worse than none, because the app quotes it as if it were
current.

So all of it is out: verification, screen sharing, on-device OCR, the report
and email import, and the optional School Companion that existed to support it.
LockIn is a Canvas app now, and about **500KB lighter** for it.

Nothing you finished was lost. Old Edgenuity work keeps its title, its due
date, its logged minutes and its completion history — only the integration went.

## 1.3.0

### Your Canvas assignments, without typing them in

Connect your Canvas calendar feed once and your work appears — titles, courses
and due dates, kept up to date on its own. When Canvas moves a deadline, the
assignment you already started moves with it: your logged time, your notes and
your progress stay exactly where they were. Nothing is ever added without you
seeing it first.

- **The feed address is treated like a password**, because it is one — anyone
  holding it can read your calendar without logging in. It is kept inside the
  Companion extension, never by the website, and never included in an export.
- **No Companion?** Download the `.ics` file from Canvas and drop it in. Same
  import, same review screen.
- **Canvas never says whether you handed something in**, so LockIn does not
  pretend otherwise. An assignment disappearing from the feed is never treated
  as finished.

### Edgenuity progress, from the reports you already get

Save the progress report Edgenuity emails, or download a course report, and drop
the file in. LockIn reads it on your device and shows where each course actually
stands: how far through you are, where the pacing schedule says you should be,
and which of those came from where.

LockIn no longer reads the Edgenuity website at all. The progress email and the
course report are the two things you are meant to have, and they are enough.

### It tells you where you stand — or admits it doesn't know

A new Progress page answers one question honestly. Ahead, on track, at risk,
behind — with the reasons written out, not a score.

And a fourth answer that matters more than the others: **not enough data**. If a
sync failed or a report is three weeks old, LockIn says so instead of telling
you that you are behind. It will not call something overdue on a due date it has
reason to doubt.

### Reminders that behave like a person

- **One at a time.** However many things notice the same deadline, you get one
  notification.
- **Snooze actually works** — twenty minutes, that assignment only, and it comes
  back rather than disappearing.
- **Start Focus straight from the notification.**
- **It stays quiet while you are visibly working**, except for the last warning
  before a deadline.

### The rest of it

- **Home is one screen with one obvious next thing** instead of a dozen cards
  competing for attention.
- **Assignments has four views** — Today, Overdue, Upcoming, Completed — and
  opens on the one that has something in it.
- **A focus session now fills the screen**: the work, the time, and an honest
  line about whether anything is actually being blocked.
- **A new Integrations page** where every connection says what it can see, what
  it cannot, when it last worked, and how to disconnect.
- **LockIn notices when things go well** — and says so rarely enough that it
  still means something.

### For a managed school computer

There is now an optional **School Companion** for a school Chrome profile. It
does one thing: tells LockIn on the same computer whether Canvas or Edgenuity is
open, so a reminder can hold its tongue while you are already working. It cannot
read a page — not by policy, but because it has no ability to. It is off until
you turn it on, and it asks you to confirm your school allows it first.

LockIn does not get around Chrome profile separation, and it will not help you
work around anything your school has set up. Everything else works without it.

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
