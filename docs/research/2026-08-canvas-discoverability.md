# Research brief — making the Canvas connection findable

**Date:** 2026-08-17 · **Mode:** brief-then-build · **Scope:** where Canvas setup
lives, and what happens the moment it succeeds.

---

## Questions

1. Where should setup for an external service live?
2. What should an empty screen do about a feature that would fill it?
3. After connecting, how does the user find what changed?

---

## What the codebase already says

The diagnosis is not a hypothesis; it is in the wiring:

- `CanvasSettings` is rendered from exactly one place — `Settings.tsx:326`.
- The import list opens from exactly one place — `onOpenImport`, passed into
  `CanvasSettings` and handled in `Settings.tsx:327`. **The only door to the
  import list is inside the panel you already had to find.**
- `importCandidates()` — the selector that knows how many detected assignments
  are waiting — is called only in `CanvasSettings` and `CanvasLinkModal`. No
  page ever asks.
- The Assignments empty state *mentions* Canvas in prose ("Add what you owe —
  Canvas, Edgenuity, or anything else") and offers **no way to connect it**.

So a student connects Canvas, browses their courses, and returns to an app that
looks exactly the same. The detections are in `state.canvas.detected`, and
nothing says so outside Settings.

## Findings

### 1. Burying a primary action is a named failure mode

The progressive-disclosure literature calls this **over-hiding**: "critical
information or primary actions are buried so deep that users cannot find them,
leading to frustration and support calls." The rule given is that functionality
"must be discoverable at the right moment" — not merely present somewhere.

Progressive disclosure is not an argument for hiding setup in Settings. It is an
argument for **contextual disclosure**: options appear "only when a preceding
choice makes them relevant".

### 2. An empty screen is onboarding, and needs a path, not a mention

> "The first empty screen should be treated as onboarding."

The prescribed structure is a headline, a short description, an icon, **and a
call-to-action**. Empty states exist to "communicate system status, increase
learnability, and deliver direct pathways for key tasks."

An empty assignments list on a device with an unconnected Canvas is the single
best place in the app to offer Canvas. It currently spends that space on a
sentence that names Canvas and does nothing about it.

### 3. Layered onboarding is triggered by behaviour, not by a step counter

Progressive onboarding works in layers "triggered by different user behaviour
signals rather than arbitrary timelines" — first-session orientation, then
contextual hints as new screens are reached.

Canvas fits layer 2 exactly. It does not belong in the four-step first run: a
student who has not yet seen an assignment list has no reason to care. It
belongs at the moment the list is empty, and at the moment detections arrive.

---

## Recommendation

**Three doors instead of one, and land on the payoff.**

1. **The empty assignments list offers Canvas directly** — a real CTA that opens
   the connect flow, not prose that names it. (Finding 2.)
2. **Detected-but-unimported work announces itself** where the student already
   is — the dashboard and the assignments list — as a dismissible line: "12
   assignments found on Canvas · Review". This is the fix for "do all that and
   then find it": the app tells you, instead of waiting to be asked.
   (Findings 1, 2 — communicating system status.)
3. **Connecting opens the import list immediately.** Success should land on what
   was gained, not return you to the settings panel you started in. (Finding 1,
   contextual disclosure.)

Settings → Canvas stays as the management surface. It just stops being the only
way in.

**Not doing:** adding Canvas to the four-step onboarding. Finding 3 says setup
should be behaviour-triggered, and Phase 9 just cut onboarding from seven steps
to four for exactly that reason.

## What I could not establish

- No quantified effect size for empty-state CTAs. The sources are design
  guidance and design-system documentation, not experiments — the direction is
  well agreed, the magnitude is not evidenced.
- No primary NN/g article was retrievable; its position is quoted second-hand
  and is consistent with the design-system sources, but treat it as secondary.
- Nothing found specifically on LMS-integration onboarding, so the
  recommendation is general integration practice applied to Canvas.

## Sources

- [Progressive Disclosure — UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/)
- [Progressive disclosure in onboarding — userTourKit](https://usertourkit.com/blog/progressive-disclosure-onboarding)
- [What is Progressive Disclosure? — Interaction Design Foundation](https://ixdf.org/literature/topics/progressive-disclosure)
- [Empty states — Carbon Design System](https://v10.carbondesignsystem.com/patterns/empty-states-pattern/)
- [Empty state UI design — Setproduct](https://www.setproduct.com/blog/empty-state-ui-design)
- [Onboarding UX Patterns: Empty States — UserOnboard](https://www.useronboard.com/onboarding-ux-patterns/empty-states/)
