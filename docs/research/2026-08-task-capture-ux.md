# Research brief — how other apps capture a task without exhausting you

**Date:** 2026-08-16 · **Mode:** brief-then-build · **Scope:** assignment entry.

---

## Questions

1. How many fields is too many, and what does each extra one cost?
2. How do the best task apps capture a task in one action?
3. Does anyone ask for a **time estimate** at capture? LockIn's planner needs one.
4. Is a due date required anywhere, and should it be?

---

## Findings

### 1. LockIn's form is squarely in the abandonment zone

Baymard's form research, applied to any multi-field entry:

- **7+ fields → 67.8% abandonment.**
- **Each extra field costs ~4.1% conversion.**
- Most flows need **≤8 fields**; the average uses 11.3 — i.e. teams routinely ask
  for ~3 fields they do not need.
- **"Optional" labelling out-converts asterisk-marked required fields by 25%.**
- "Field reduction returns more lift than visual redesign for most teams."

LockIn's `AssignmentForm` asks for **title, subject, platform, due date, due time,
estimate, priority**, plus a reminders block. Seven-plus fields, every time, for a
thing a student can say in six words.

### 2. Todoist's Quick Add: one field, parsed live, highlighted inline

The mechanism worth copying is not the parsing — it is the **feedback**. Todoist
"parses your input in real time with a preview showing recognized dates and
priorities", highlighting the parts it understood **inside the input as you type**.

That solves the trust problem a parser creates. The student never has to wonder
what it did, because the sentence itself shows which words were consumed.

### 3. Nobody asks for a duration at capture — except the app people call exhausting

This is the finding that matters most for LockIn, because the planner genuinely
needs `estimatedMinutes`.

| App | Duration at capture | How it plans |
| --- | --- | --- |
| **Motion** | **Required** — "you need to fill in the task duration, due date, and due time" | Aggressive auto-scheduling |
| **Sunsama** | **Never asked.** "If you do not have a planned time on a task, Sunsama will use the **default duration** per your account settings." | Manual timeboxing |
| Todoist / Apple Reminders / Google Tasks | Not a concept | No scheduling |

Sunsama also "tracks how long you actually spend on each task and compares it
against your estimates" — the estimate is *learned*, not demanded.

Motion is the one described as the high-friction option. Requiring three fields
to make scheduling work is exactly the trade LockIn should not repeat.

### 4. A required due date is the outlier

Google Tasks requires one and is noted as the app you avoid when you want a
dateless nudge. Todoist and Apple Reminders keep undated work in an Inbox.
LockIn already treats undated work as real work; keep it.

---

## Recommendation

**One field. Everything else inferred, shown, and correctable.**

1. **Capture asks for exactly one thing: what the work is.** Anything else the
   student happens to type — a day, a duration, a subject — is parsed out. Nothing
   is ever required beyond the title.
2. **Highlight what was understood, inside the input, as it is typed** (Todoist).
   A parser the student cannot see is a parser they cannot trust.
3. **Never ask for the estimate.** Default it, and *learn* it: LockIn already logs
   real minutes per assignment and already has per-subject speed factors in the
   planner. Use the student's own history for that subject, falling back to a
   sensible default by work type ("essay" ≠ "worksheet"). (Sunsama, finding 3.)
4. **Correction is one tap, not a form.** What was inferred appears as chips under
   the input; tapping one changes it. The full form stays for the rare case, and
   stops being the default path.
5. **Mark the remaining optional fields "optional"**, not the required one with an
   asterisk (+25%, finding 1).

## What I could not establish

- No primary Doist documentation on the *highlighting* behaviour; the description
  comes from third-party guides consistently enough to build on, but it is not a
  spec.
- Baymard's numbers are from e-commerce checkout. The direction (fewer fields,
  much lower abandonment) is robust and widely replicated; the exact percentages
  should not be treated as predictions for a study app.
- No study found on estimate accuracy in student self-report specifically. The
  learned-estimate design is taken from Sunsama's shipped behaviour, not from a
  controlled result.

## Sources

- [Checkout Optimization: Minimize Form Fields — Baymard](https://baymard.com/blog/checkout-flow-average-form-fields)
- [The Baymard Report Series: Too many fields, too little time — Amazon Pay](https://pay.amazon.com/blog/the-baymard-report-series-too-many-fields-too-little-time)
- [Form Conversion Rate Benchmarks 2026](https://www.digitalapplied.com/blog/form-conversion-rate-benchmarks-2026-data-points)
- [How to Use Todoist Natural Language Input](https://calmevo.com/todoist-natural-language-input-guide/)
- [Using Natural Language with Todoist — The Sweet Setup](https://thesweetsetup.com/using-natural-language-with-todoist/)
- [Sunsama — timeboxing concepts and principles](https://help.sunsama.com/docs/timeboxing-concepts-and-principles)
- [Sunsama vs Motion (2026)](https://blog.saner.ai/sunsama-vs-motion/)
- [Google Tasks Reminders Guide](https://tasksboard.com/blog/google-tasks-reminders)
