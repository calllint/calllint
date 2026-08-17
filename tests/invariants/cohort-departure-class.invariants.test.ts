/**
 * ADR 0085 D2 — a departure must be classified before it is reported as a loss.
 *
 * ADR 0084 shipped the identity witness, and it worked: it saw `agency.goji/goji` leave the cohort
 * and said so. Then ADR 0085 measured WHAT it said, and the label was wrong. The subject was `active`
 * + `isLatest` upstream and had shipped 1.0.1 two days before the snapshot that "lost" it. It was a
 * version bump this system mis-projected, and the witness printed `LOST: agency.goji/goji` under a
 * heading about publishers pulling their servers.
 *
 * The defect was not the diff. It was that ONE LABEL served four causes with opposite meanings:
 *
 *   - `superseded` — our bug. The subject never left.
 *   - `de-listed`  — the publisher's act. Legitimate, and the only class the old text described.
 *   - `evicted`    — our ceiling. Also not a withdrawal.
 *   - `unknown`    — we did not look.
 *
 * So these tests are about DISCRIMINATION, not detection. Detection is ADR 0084's suite and it still
 * passes. Every test here asks "does the classifier separate two causes that a reader would act on
 * differently?", and two of them exist because getting the answer wrong yields a green that means
 * nothing:
 *
 *   1. `unknown` MUST NOT COLLAPSE INTO `evicted`. Sorting outside the served window is consistent
 *      with the cap and does not establish it — `evicted` also claims the subject is live upstream,
 *      which is a fact about the source. Inferring it from committed bytes is precisely how a version
 *      bump became a de-listing. ADR 0082 is the general form: a refusal must not read as a pass.
 *   2. `superseded` MUST BE STATED AS OUR DEFECT. It is the class D1 fixed; if it recurs, an operator
 *      who acknowledges it as a de-listing publishes a false claim about a named third party.
 */
import { describe, it, expect } from "vitest"
import {
  acknowledgementClears,
  classifyDeparture,
  formatIdentityOutcome,
  type Departure,
  type SourceObservation,
  type SourceView,
} from "../../scripts/cohort-identity.js"
import { RESERVED_COHORT_NAMES } from "../../packages/trust-index/src/fetchRegistry.js"

/**
 * The served window used throughout: a cohort whose largest COMPETING name is `d.example/last-competing`.
 *
 * THE SORT SHAPE IS THE FIXTURE. Sorted, this corpus is `a.example/first` < `b.example/second` <
 * `d.example/last-competing` < `io.github.calllint/calllint` — the reserved name LAST, which is the
 * shape of the real cohort (where it is `sorted.at(-1)` of 100). An earlier version of this corpus
 * used `m.example/mid` as the largest competing name, and `i` < `m`, so the reserved name was not the
 * maximum: `sort().at(-1)` and the competing-only max were the SAME string, the two ceiling forms were
 * indistinguishable, and a control restoring the defective form stayed green (measured — 22 passed).
 * The corpus has to place the reserved name past every competing name or it cannot witness anything.
 *
 * `io.github.calllint/calllint` is in it deliberately, and it sorts LAST. A reserved name (ADR 0075)
 * is admitted regardless of where it sorts, so it is not the cap's edge — and until 2026-08-17 this
 * corpus omitted it, which is exactly why the corpus could not witness the defect it was written to
 * guard. `beyondCeiling` used `sort().at(-1)`, so on the real cohort (where the reserved name sorts
 * last of 100) NO name could ever read as beyond the ceiling: 13 ordinary capped evictions were
 * reported as sorting inside the window, and with a source view would have been classified
 * `superseded` — a class whose own text calls the departure a bug in this system rather than an act
 * by the publisher. A fixture set that avoids the key space cannot fail on it.
 */
const SERVED = [
  "a.example/first",
  "d.example/last-competing",
  "b.example/second",
  ...RESERVED_COHORT_NAMES,
]

/**
 * The corpus shape, asserted rather than assumed.
 *
 * Every ceiling case below is only a witness while the reserved name sorts PAST every competing name
 * and a sample exists strictly between them. Both properties are invisible at the call sites, and
 * losing either one turns the whole ceiling group green-but-blind — which is not hypothetical: the
 * `m.example/mid` corpus did exactly that, and the negative control for the `sort().at(-1)` defect
 * passed 22/22 against it. Asserting the shape means a future edit to `SERVED` fails HERE, naming the
 * property it broke, instead of silently retiring the tests that depend on it.
 */
describe("the corpus can witness the ceiling defect at all (premise, not behaviour)", () => {
  const sorted = [...SERVED].sort()
  const competing = SERVED.filter((n) => !RESERVED_COHORT_NAMES.includes(n))
  const reserved = SERVED.filter((n) => RESERVED_COHORT_NAMES.includes(n))

  it("holds a reserved name, otherwise the two ceiling forms cannot differ", () => {
    expect(reserved.length, "no reserved name in SERVED — `sort().at(-1)` and the competing-only max would agree").toBeGreaterThan(0)
  })

  it("sorts the reserved name LAST, the shape of the real cohort", () => {
    // On the 2026-08-17 cohort `io.github.calllint/calllint` was `sorted.at(-1)` of 100, which is why
    // `sort().at(-1)` could never attribute any departure to the cap.
    expect(RESERVED_COHORT_NAMES).toContain(sorted.at(-1))
    expect(sorted.at(-1), "the reserved name must not also be the largest competing name").not.toBe(
      [...competing].sort().at(-1),
    )
  })

  it("leaves a non-empty interval between the last competing name and the reserved one", () => {
    // `e.example/between` lives here. An empty interval means no sample can distinguish the forms.
    const edge = [...competing].sort().at(-1)!
    const gate = sorted.at(-1)!
    expect("e.example/between" > edge, `the sample must sort past ${edge}`).toBe(true)
    expect("e.example/between" < gate, `the sample must sort before ${gate}`).toBe(true)
  })
})

function view(entries: Record<string, SourceObservation>): SourceView {
  return new Map(Object.entries(entries))
}

/** Build a `checked` outcome around a set of departures, so the renderer can be measured. */
function outcomeWith(departures: readonly Departure[]) {
  return {
    kind: "checked" as const,
    lost: departures.map((d) => d.name),
    departures,
    gained: ["z.example/new"],
    previousRevision: "0123456789abcdef",
    previousCount: 4,
    currentCount: 3,
  }
}

describe("the four classes are separated by what was actually observed (ADR 0085 D2)", () => {
  it("calls a subject absent from the source DE-LISTED", () => {
    const d = classifyDeparture("gone.example/pulled", SERVED, view({}))
    expect(d.class).toBe("de-listed")
    expect(d.why).toMatch(/absent from the source/)
  })

  it("calls a subject present but not `active` DE-LISTED, naming the status it saw", () => {
    // Not folded into the case above: "absent" and "present and deprecated" are different upstream
    // events that happen to share a verdict, and the `why` has to say which one occurred.
    const d = classifyDeparture(
      "dep.example/frozen",
      SERVED,
      view({ "dep.example/frozen": { status: "deprecated", isLatest: true } }),
    )
    expect(d.class).toBe("de-listed")
    expect(d.why).toMatch(/`deprecated`/)
    expect(d.why).toMatch(/not `active`/)
  })

  it("calls a live subject outside the served window EVICTED, not withdrawn", () => {
    // `z.` sorts after `d.example/last-competing`, and the source says it is live. BOTH halves are required.
    const d = classifyDeparture(
      "z.example/beyond",
      SERVED,
      view({ "z.example/beyond": { status: "active", isLatest: true, version: "2.0.0" } }),
    )
    expect(d.class).toBe("evicted")
    expect(d.why).toMatch(/still `active` upstream/)
    expect(d.why).toMatch(/ADR 0074/)
    expect(d.why).toMatch(/not withdrawn/)
  })

  it("calls a live subject INSIDE the window SUPERSEDED — the class D1 fixed", () => {
    // The `agency.goji/goji` shape exactly: live upstream, sorts inside the window, gone anyway.
    // Nothing outside this system explains it.
    const d = classifyDeparture(
      "c.example/bumped",
      SERVED,
      view({ "c.example/bumped": { status: "active", isLatest: true, version: "1.0.1" } }),
    )
    expect(d.class).toBe("superseded")
    expect(d.why).toMatch(/1\.0\.1/)
    expect(d.why).toMatch(/isLatest/)
    // THE LOAD-BEARING PHRASE. An operator who reads this as a publisher's act acknowledges a
    // de-listing that never happened, which is the durable false claim ADR 0085 D3 refuses to publish.
    expect(d.why).toMatch(/BUG IN THIS SYSTEM/)
    expect(d.why).toMatch(/not an act by the publisher/)
  })
})

describe("an unconsulted source yields UNKNOWN, never an inferred class (ADR 0082 + 0085 D2)", () => {
  it("does not report EVICTED from committed bytes alone, even when the name sorts past the window", () => {
    // THE LOAD-BEARING ASSERTION OF THIS FILE. `z.example/beyond` sorts after the last served name, so
    // the cap is a plausible story — and `evicted` additionally claims the subject is LIVE UPSTREAM,
    // which no committed byte can establish. Letting the structural half imply the whole class is the
    // same error as letting a hash decide a fact (D1).
    const d = classifyDeparture("z.example/beyond", SERVED, null)
    expect(d.class).toBe("unknown")
    expect(d.class).not.toBe("evicted")
    // The ceiling is still REPORTED — it is a lead worth handing the operator — but as a consistency
    // note, explicitly not as a verdict.
    expect(d.why).toMatch(/CONSISTENT with ADR 0074's cap but does not establish it/)
    expect(d.why).toMatch(/fact about the source, not about our bytes/)
  })

  it("says the cap does NOT explain a departure sorting inside the window", () => {
    // Same `unknown` class, different actionable content: here the ceiling is ruled out from bytes
    // alone, which narrows the operator's next step rather than leaving it open.
    const d = classifyDeparture("c.example/inside", SERVED, null)
    expect(d.class).toBe("unknown")
    expect(d.why).toMatch(/INSIDE the served window/)
    expect(d.why).toMatch(/the cap does not explain it/)
  })

  it("measures the ceiling against the last COMPETING name, never a reserved one (ADR 0075)", () => {
    // The regression that made this file's corpus load-bearing. `io.github.calllint/calllint` is in
    // SERVED and sorts after `d.example/last-competing`, but it was admitted without competing for a slot, so
    // it is NOT the cap's edge. A name between the two must therefore read as BEYOND the ceiling.
    //
    // With the old `sort().at(-1)` form this returned "INSIDE the served window", and on the real
    // 2026-08-17 cohort that verdict covered all 13 departures at once.
    //
    // THE SAMPLE MUST SORT BETWEEN THE TWO. `z.example/*` cannot witness this: it sorts past the
    // reserved name too, so both the old and the new ceiling call it beyond, and a control that
    // restores the old form stays green (measured — it did). The defect lives strictly in the
    // interval `(last competing name, reserved name]`, which on the real cohort was
    // `(ai.b77/chess-results, io.github.calllint/calllint]` — where all 13 `ai.b77/*` departures sat.
    // Here that interval is `(d.example/last-competing, io.github.calllint/calllint]`, so the sample is
    // `e.example/*`: past the last competing name, but BEFORE the reserved one.
    const d = classifyDeparture("e.example/between", SERVED, null)
    expect(d.class).toBe("unknown")
    expect(d.why, "a name past the last competing slot must not read as inside the window").toMatch(
      /CONSISTENT with ADR 0074's cap/,
    )
    expect(d.why).toContain("d.example/last-competing")
    expect(d.why, "the reserved name is not the ceiling and must not be named as it").not.toContain(
      "io.github.calllint/calllint",
    )

    // And the same input WITH a source view that says the subject is live must land on `evicted` —
    // the class that attributes the departure to our ceiling — not on `superseded`, which attributes
    // it to a bug in this system.
    const live = classifyDeparture(
      "z.example/beyond",
      SERVED,
      view({ "z.example/beyond": { status: "active", isLatest: true, version: "1.0.0" } }),
    )
    expect(live.class, "a live subject past the competing edge is EVICTED, not our defect").toBe("evicted")
    expect(live.why).toContain("COMPETED for a slot")
  })

  it("treats an empty cohort as no window at all rather than a ceiling of nothing", () => {
    // A cohort of zero has no largest name, so `beyondCeiling` is false and every departure is
    // window-inside. The alternative — treating "no names" as "everything is past the ceiling" —
    // would attribute a total projection failure to the cap, which is a guard excusing the fault it
    // exists to catch.
    const d = classifyDeparture("a.example/any", [], null)
    expect(d.class).toBe("unknown")
    expect(d.why).toMatch(/INSIDE the served window/)
  })

  it("still classifies from a source view that is EMPTY but present — absent is a measurement", () => {
    // The distinction a nullable map would destroy: `null` means "did not look", `new Map()` means
    // "looked and the source lists nothing". The second is a de-listing; the first is not a class.
    expect(classifyDeparture("x.example/y", SERVED, null).class).toBe("unknown")
    expect(classifyDeparture("x.example/y", SERVED, view({})).class).toBe("de-listed")
  })
})

describe("the rendering states the class, and never launders one into another", () => {
  it("prints the class before the name, with the reason on every row", () => {
    const text = formatIdentityOutcome(
      outcomeWith([
        { name: "gone.example/pulled", class: "de-listed", why: "absent from the source entirely" },
      ]),
    )
    expect(text).toMatch(/DE-LISTED: gone\.example\/pulled — absent from the source entirely/)
    // The pre-D2 label asserted a cause the check had not established. It must not survive anywhere.
    expect(text).not.toMatch(/LOST: gone\.example/)
  })

  it("tallies the classes so a reader sees the mix before the rows", () => {
    const text = formatIdentityOutcome(
      outcomeWith([
        { name: "a.example/one", class: "de-listed", why: "absent" },
        { name: "b.example/two", class: "unknown", why: "not consulted" },
        { name: "c.example/three", class: "unknown", why: "not consulted" },
      ]),
    )
    expect(text).toMatch(/Classified \(ADR 0085 D2\): 1 de-listed, 2 unknown/)
  })

  it("escalates SUPERSEDED as our defect and warns against acknowledging it", () => {
    const text = formatIdentityOutcome(
      outcomeWith([{ name: "c.example/bumped", class: "superseded", why: "live upstream, inside the window" }]),
    )
    expect(text).toMatch(/DEFECT IN THIS SYSTEM/)
    expect(text).toMatch(/ADR 0085 D1 removed the mechanism/)
    expect(text).toMatch(/58 of 293/)
    // `gate-s0.ts` acknowledges a loss by finding the name next to "de-listed" in an ADR. For this
    // class that would publish a false claim about a third party, so the text says not to.
    expect(text).toMatch(/do NOT acknowledge it as a de-listing/)
  })

  it("marks UNKNOWN as unclassified — neither cleared nor confirmed (ADR 0082)", () => {
    const text = formatIdentityOutcome(
      outcomeWith([{ name: "z.example/beyond", class: "unknown", why: "the source was not consulted" }]),
    )
    expect(text).toMatch(/UNCLASSIFIED, not/)
    expect(text).toMatch(/cleared and not confirmed/)
    expect(text).toMatch(/not a flavour of the other three/)
  })

  it("keeps ADR 0084's ratchet-blindness note and D4's reportable framing", () => {
    // D2 adds a classification; it does not repeal the reason the witness exists. Both must survive,
    // or a future reader loses why a count cannot substitute for this check.
    const text = formatIdentityOutcome(
      outcomeWith([{ name: "a.example/one", class: "de-listed", why: "absent" }]),
    )
    expect(text).toMatch(/A count cannot see this/)
    expect(text).toMatch(/ratchet stays green/)
    expect(text).toMatch(/REPORTABLE, not automatically a fault/)
  })

  it("says nothing about classes when no subject left", () => {
    const text = formatIdentityOutcome({
      kind: "checked",
      lost: [],
      departures: [],
      gained: ["z.example/new"],
      previousRevision: "0123456789abcdef",
      previousCount: 2,
      currentCount: 3,
    })
    expect(text).toMatch(/no subject left the cohort/)
    expect(text).not.toMatch(/Classified/)
    expect(text).not.toMatch(/UNKNOWN/)
  })

  it("a REFUSED outcome is still not a pass and carries no classification (ADR 0082)", () => {
    // The ADR 0082 shape this module already had, re-asserted because D2 added a second three-valued
    // vocabulary next to it and the two must not blur: `refused` is about the COMPARISON being
    // impossible, `unknown` is about one DEPARTURE being unclassifiable.
    const text = formatIdentityOutcome({ kind: "refused", reason: "SHALLOW CLONE: no previous revision" })
    expect(text).toMatch(/REFUSED/)
    expect(text).toMatch(/SHALLOW CLONE/)
    expect(text).not.toMatch(/no subject left/)
    expect(text).not.toMatch(/Classified/)
  })
})

/**
 * An ADR acknowledgement is a statement about ONE class, and may only clear that class.
 *
 * This describe block exists because of a defect found on `main` while wiring D2, not from reading
 * the ADR. `gate-s0.ts` cleared a red by finding the subject's name next to the word `de-listed`
 * anywhere in the corpus — keyed on the NAME, because a name was all ADR 0084's witness reported. Run
 * against the real tree, that produced a report contradicting itself three lines apart:
 *
 *     ◇ 1 UNKNOWN — … UNCLASSIFIED, not cleared and not confirmed …
 *       ACKNOWLEDGED in adrs/: agency.goji/goji — reported, not failing
 *
 * ADR 0085 keeps goji's acknowledgement in place and annotates it — "the loss was real, the stated
 * cause was wrong" — so the corpus permanently holds an acknowledgement whose stated cause this
 * system has DISPROVED. Keyed on the name, that sentence would clear goji's next departure whatever
 * caused it, including a D1 regression. Which is the original bug's own shape: a claim about a cause
 * the check never established.
 */
describe("an acknowledgement clears only the class it is about (ADR 0084 D4 + 0085 D2)", () => {
  /** The corpus fact, measured: ADR 0084 acknowledges exactly this name. */
  const ACK = new Set(["agency.goji/goji"])
  const SUBJECT = "agency.goji/goji"

  it("clears a DE-LISTED departure — the class the acknowledgement is written about", () => {
    const d = classifyDeparture(SUBJECT, SERVED, view({}))
    expect(d.class).toBe("de-listed")
    expect(acknowledgementClears(d, ACK)).toBe(true)
  })

  it("REFUSES to clear a SUPERSEDED departure of the very subject the ADR names", () => {
    // THE TEST THIS BLOCK EXISTS FOR. If D1 regresses, goji drops again while `active` + `isLatest`
    // upstream — and the 2026-08 acknowledgement would silence it forever under the name-keyed rule.
    // A guard that a two-year-old sentence can permanently disarm is not a guard.
    const d = classifyDeparture(
      SUBJECT,
      SERVED,
      view({ [SUBJECT]: { status: "active", isLatest: true, version: "1.0.1" } }),
    )
    expect(d.class).toBe("superseded")
    expect(acknowledgementClears(d, ACK)).toBe(false)
  })

  it("REFUSES to clear an EVICTED departure — the cap is not a withdrawal", () => {
    // Accepting this would write a false claim about a third party into the corpus: the publisher did
    // nothing, ADR 0074's ceiling did.
    const d = classifyDeparture(
      "z.example/beyond",
      SERVED,
      view({ "z.example/beyond": { status: "active", isLatest: true } }),
    )
    expect(d.class).toBe("evicted")
    expect(acknowledgementClears(d, new Set(["z.example/beyond"]))).toBe(false)
  })

  it("DOES clear an UNKNOWN departure, because refusing would leave no reachable green", () => {
    // Deliberately NOT symmetrical with the two above, and the asymmetry is the decision. `source`
    // defaults to `null`, so on a network-free CI leg every departure is `unknown`; refusing here
    // would wedge the gate — red forever while printing a remedy (write an ADR) that cannot work.
    // ADR 0082 requires the refusal be VISIBLE, not inconsolable, and it is: the renderer prints
    // UNCLASSIFIED and the gate prints NOT ESTABLISHED beside the pass.
    const d = classifyDeparture(SUBJECT, SERVED, null)
    expect(d.class).toBe("unknown")
    expect(acknowledgementClears(d, ACK)).toBe(true)
  })

  it("clears nothing at all when the corpus does not name the subject", () => {
    // The base case, so a green above cannot come from the function ignoring the set. All four
    // classes must fail to clear when the name is absent.
    const empty = new Set<string>()
    const classes: Departure[] = [
      { name: SUBJECT, class: "de-listed", why: "x" },
      { name: SUBJECT, class: "unknown", why: "x" },
      { name: SUBJECT, class: "superseded", why: "x" },
      { name: SUBJECT, class: "evicted", why: "x" },
    ]
    for (const d of classes) expect(acknowledgementClears(d, empty)).toBe(false)
  })

  it("is keyed on the class and the name together, never on either alone", () => {
    // A different subject's acknowledgement must not clear this one's de-listing — otherwise the
    // corpus becomes a blanket amnesty rather than a per-subject record.
    const d = classifyDeparture("other.example/thing", SERVED, view({}))
    expect(d.class).toBe("de-listed")
    expect(acknowledgementClears(d, ACK)).toBe(false)
  })
})
