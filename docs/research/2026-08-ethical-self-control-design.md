# Research brief — ethical design for LockIn's blocking and accountability

**Date:** 2026-08-16 · **Mode:** brief-then-build · **Scope:** what replaces "go install
an extension", and how to be honest about what a website can and cannot do.

---

## Questions this had to answer

1. What can a web page legitimately do about focus, and what should it refuse to do?
2. Does hard blocking actually work, and how does it fail?
3. Soft (honor) vs hard (enforced) commitment — which, and for whom?
4. Where is the line between accountability and surveillance for a teenager?
5. What does ethical consent framing look like for a permission this invasive?

---

## Findings

### 1. A website cannot block websites. There is no permission for it.

Not a gap in LockIn — a browser security boundary. `navigator.permissions` covers camera,
microphone, geolocation, notifications, clipboard. Nothing reaches another origin. Real
blocking needs an extension (`declarativeNetRequest`), a system proxy/DNS, or OS controls.

**What a page *can* honestly use: the Page Visibility API.** No permission, universally
supported. It reports exactly two states — `visible` / `hidden` — and the MDN reference is
explicit that it does **not** tell you *why* the page is hidden or *what the user went to*.

> That limitation is the feature. LockIn can say "you left this tab for 4 minutes" and
> also say, truthfully, "I have no idea where you went." No other approach lets us make
> both statements.

### 2. The Idle Detection API is available in Chrome and must not be used.

Chrome shipped it in 94. **Mozilla declared it harmful** ("user-surveillance and
user-control concerns… can be used for monitoring a user's usage patterns, and manipulating
them accordingly") and will not implement it. **WebKit refused it too**, noting it lets a
site observe whether a person is physically near the device.

Two browser vendors independently classified it as a surveillance vector. An app whose
stated position is "accountability, not surveillance" cannot use the API that the people
who write browsers call surveillance. **Rejected.**

### 3. Hard blocking works — and is abandoned, because it provokes reactance.

The consistent finding across the digital-self-control-tools literature:

> "Hard" interventions such as technical blocking or app removal are effective at reducing
> screen time but are **frequently abandoned because users find them paternalistic and
> threatening to their autonomy."

Reactance is documented as the *universal* first response to friction — one study
participant called the barrier "really annoying." The design recommendation is direct:

> "It makes sense to give users a way to influence the strictness of interventions, and the
> results of those studies where users have a choice confirm a preference for interventions
> that allow negotiation."

### 4. Soft and hard commitments fail in opposite directions, so ship both.

From the commitment-device literature (Burke et al., savings behaviour, 6-month RCT):

| | Take-up | Effect once adopted |
| --- | --- | --- |
| **Soft** (pledge, no enforcement) | High | Significant; strongest for impatient people |
| **Hard** (enforced restriction) | **Low** | **Strongest at 6 months** |

Neither dominates. A hard-only product loses everyone who won't adopt it; a soft-only
product is weaker for the people who would have adopted the hard one. **Offering both, with
the soft one requiring zero setup, is the evidence-backed configuration** — and it happens
to be the only configuration a website can offer honestly.

### 5. Forest's mechanism is loss aversion, not restriction.

Forest cannot stop you leaving. It makes the cost *visible* — the tree dies — "making the
cost of distraction visible without removing user agency." Something to lose beats something
forbidden, when you have no power to forbid.

### 6. Restrictive parental monitoring correlates with *worse* outcomes.

- Restrictive monitoring of adolescents' digital media use is **positively associated with
  problematic internet use.** Active and deference monitoring are not.
- Monitoring that grants increasing autonomy has better outcomes than controlling monitoring,
  **especially as teens get older.**
- Parental control apps "may not only fail to achieve their intended protective effects but
  may also harm parent–teen relationships… fostering paranoia and fear."
- What predicts trust is **communication**: "If parents fail to communicate their reasons
  behind screen rules, adolescents may rebel; when reasons are explained, teens are more
  likely to respect them." Teen input into the rules is described as critical for buy-in.

LockIn's existing refusal to collect browsing history, screenshots or location is validated.
The gap: the student cannot currently *see* what the parent sees, and rules are not explained
to the person they bind.

---

## Recommendation

**Build both modes, present them as one honest choice, and let the student see everything.**

1. **Reframe the extension as a permission, not a chore.** Ask "Allow LockIn to block
   distracting websites?" State exactly what access is granted and why. *Not now* must lead
   somewhere real — never a dead end. (Finding 5, and ordinary consent ethics: specific,
   informed, revocable, and refusable without penalty.)

2. **Ship Focus Guard — honor mode on Page Visibility.** Zero setup, works immediately, and
   says plainly that it cannot block anything. It notices when you leave, times it, and
   records it. It states in the UI that it cannot see where you went, because it genuinely
   cannot. (Findings 1, 4.)

3. **Make the cost visible, never punitive.** Show elapsed away-time and a count. No guilt
   language, no undismissable modal, no dark pattern to come back. (Findings 3, 5.)

4. **Never use Idle Detection.** Write the reason in the code so nobody adds it later.
   (Finding 2.)

5. **Show the student what the parent sees.** A read-only "what a parent can see" view, plus
   the reason each active rule exists. (Finding 6.)

## What I could not establish

- No primary source found for how Freedom / Cold Turkey / Opal word their own bypass
  limitations; secondary comparisons only. Recommendation 1 rests on consent ethics and
  Finding 5, not on copying a competitor's copy.
- The ACM TOCHI meta-analysis (10.1145/3571810) returned 403; effect sizes for tool
  categories are therefore not quoted here. Findings 3 and 4 come from independent sources.
- No study found on honor-mode blockers specifically. The soft/hard split is generalised
  from savings-behaviour RCTs, which is a real extrapolation and is flagged as one.

## Sources

- [Page Visibility API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [Chrome 94's Idle Detection API rejected by Mozilla and Apple — gHacks](https://www.ghacks.net/2021/09/22/chrome-94s-idle-detection-api-can-be-abused-according-to-mozilla-and-apple/)
- [Chrome 94 released with controversial Idle Detection API — The Register](https://www.theregister.com/2021/09/22/google_emits_chrome_94_with/)
- [Restoring Engagement in Digital Self-Control Tools — JMIR Formative Research](https://formative.jmir.org/2026/1/e85349/PDF)
- [Digital self-control interventions for distracting media multitasking — Biedermann et al., J. Computer Assisted Learning 2021](https://onlinelibrary.wiley.com/doi/10.1111/jcal.12581)
- [Soft versus Hard Commitments: A Test on Savings Behaviors — Burke et al., J. Consumer Affairs](https://onlinelibrary.wiley.com/doi/10.1111/joca.12170)
- [Forest (application) — Wikipedia](https://en.wikipedia.org/wiki/Forest_(application))
- [Parental Monitoring of Early Adolescent Social Technology Use — PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12227363/)
- [Parental Monitoring, Communication, and Adolescents' Trust — PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4536221/)
- [Balancing Online Safety and Independence — American Academy of Pediatrics](https://www.aap.org/en/patient-care/media-and-children/center-of-excellence-on-social-media-and-youth-mental-health/qa-portal/qa-portal-library/qa-portal-library-questions/balancing-online-safety-and-independence-parental-monitoring-by-age/)
