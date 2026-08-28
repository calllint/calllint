# ADR 0091 — A guard written for a hand-moved input breaks when the input starts moving itself

- **Status**: Accepted
- **Date**: 2026-08-28
- **Supersedes**: nothing
- **Amends**: ADR 0083 (D1/D2 — how the ratchet floor advances), ADR 0074 (the cap's identity)

## Context

PR #349 was a scheduled snapshot refresh — the ordinary weekly output of `trust-ingest.yml`. It
committed 150 registry entries where the previous snapshot held 100, which is exactly what the
Cumulative Coverage Amendment's auto-growth (`+50` per run, ceiling 500) is designed to produce.

Seven assertions red across three files. None of them was wrong about its own arithmetic.

| # | Assertion | What it reported |
| --- | --- | --- |
| A | `gate-s0-claims`: `snap.count === cap` | `expected 150 to be 100` |
| B | `gate-s0-claims`: floor equals cohort | `{floor: 100, upstreamRegistry: 150}` |
| C | `registry-cohort-retention`: re-projection count | `expected 100 to be 150` |
| D | `registry-cohort-retention`: `headroom >= 0` | `expected -50 to be >= 0` |
| E | `registry-cohort-retention`: overlap size count | `expected 0 to be > 1` |
| F | `resolution-wiring`: deadline is in the past | `expected …329000 to be < …400000` |
| G | `resolution-wiring`: oldest entry is AGING | `expected 'FRESH' to be 'AGING'` |

**A, C, D and E share one cause and it is not "four stale literals."** All four ask for "today's
cohort cap." Before the Amendment, `DEFAULT_MAX_ENTRIES` **was** that cap, and reading the constant
was the correct, non-restating way to get it. The Amendment made the cap a function of the previous
run — `resolveMaxEntries` returns `min(CEILING, max(DEFAULT, prev + STEP))` — and demoted the
constant to the growth curve's **starting point**. The constant's own definition site records this
(`// bootstrap`), and the Amendment's plan records the intended progression (`100 → 150 → … → 500
(HOLD)`). So the four readers kept reading a number that had stopped being their subject, and each
faithfully reported that the cap it was handed could not have produced the cohort it was measuring.

Two of the four were **failing safely**, which is worth recording because it is the argument against
"just relax the assertion":

- **D**'s own comment states that a negative `headroom` makes the filler-based probes below construct
  cohorts *smaller* than the committed one and "silently test nothing." At `-50` it was refusing to
  run a vacuous test.
- **E**'s scan bound `cap - names.length + 2` went to `-48`, so its loop body never executed and
  `both.length` was `0`. Same shape: a probe that had lost its ability to probe.

Editing either threshold would have produced a green suite that measured nothing.

**B is a different defect.** ADR 0083 already named the route by which the floor advances: "ingest,
then the test's derived pin reds until the floor follows. The ordering is deliberate — the floor may
never lead the cohort." That is correct and this ADR does not change it. What ADR 0083 could not know
is that #312 would make ingest **automatic and weekly**. A one-off human keystroke after an
authorized expansion became a chore recurring every Sunday, red on a bot PR nobody watches. The gate
file's own docblock claims "**THE FLOOR IS DERIVED, NEVER WRITTEN DOWN**" — but the derivation was a
human reading a failing test and typing a number.

**F and G are the same class in the time dimension, with the direction inverted from the obvious
reading.** `resolution-wiring.test.ts` pinned `NOW = "2026-08-31T00:00:00.000Z"`, chosen because it
sat more than one cadence past the instants committed at the time. The refresh moved `fetchedAt`
*forward* to `2026-08-27T11:02:09Z` — **the snapshot caught up with the clock**, the age fell to 3.54
days under `CADENCE_DAYS = 7`, and the status became FRESH. The same file's other derivations already
carry the reason (":67 — a snapshot refresh moves `fetchedAt` and would red this test over arithmetic
it is not about"); the clock was the one input that stayed pinned.

**The class.** Every one of these guards was written against a snapshot that moved only when a human
moved it. #312 made it a continuously moving input, and no guard was re-examined against that. This
is `[[guard-blind-to-its-subject]]` — the repo's dominant fault class — with the automation, not a
code edit, as the thing that moved the subject away.

## Decision

### D1 — The served cohort cap is a derivation, not a constant

`servedCohortCap(count)` in `fetchRegistry.ts` returns the smallest growth-curve point at or above
`count`. Ingestion only ever commits a cohort produced by exactly such a cap, so that point **is**
the cap that produced it. A, C, D and E call it; the constant is no longer read for this purpose.

`servedCohortCap(DEFAULT_MAX_ENTRIES) === DEFAULT_MAX_ENTRIES`. In the pre-Amendment regime every
caller therefore reads exactly what it read before: **this generalizes the reader, it does not relax
the assertions.** That equality is asserted directly, at that boundary, and is the safety argument
for the whole batch.

Above the ceiling it returns `count` unchanged. A manual override may commit more than 500 (Amendment
Case 4) and clamping there would hand a guard a cap *below* the cohort — the exact defect this
removes, reintroduced at the one boundary a human reaches by hand.

**Not a snapshot field.** A `maxEntries` key would have been more direct, and is rejected: it moves
the snapshot bytes, and those bytes feed `artifactDigest`/`pageDigest`. A schema change to record a
number that is already recoverable from `count` is not worth touching the digest chain for.

### D2 — What A now proves, stated rather than hidden

`snap.count === servedCohortCap(snap.count)` says **the cohort lands exactly on a growth-curve
point**. That is still the truncation claim, and it still reds for a cohort that fell *off* the curve
(upstream running dry mid-fill — a real event this must not absorb silently).

It is weaker in one direction: before the Amendment there was one legal count, now there are nine. A
cohort at 200 following a run that committed 100 satisfies this while having skipped a step. That gap
is closed by D3's monotone advance, not by this assertion pretending to a precision it lost when the
cap became a function.

### D3 — Ingest advances the ratchet, and the advance cannot lower it

`refreshSnapshot.ts` calls `advanceRatchetFloor(GATE_S0_PATH, committed.count)` on the line after it
writes the snapshot. Same act, because the floor and the cohort are a **coherent pair**: `gate-s0.ts`
exits 2 at load time when the floor exceeds the committed cohort, so a run that wrote one without the
other would leave the repo in a state its own gate refuses to load. A separate workflow step could be
skipped, reordered, or omitted from a local `pnpm ingest:trust-index`; a call on that line cannot.

**The advance is `Math.max`.** It is structurally incapable of lowering a floor. This is the entire
safety argument for automating a ratchet, and it is asserted over the full growth curve rather than
argued in prose.

ADR 0083's two protections are both intact:

- A **shrunken** cohort leaves the floor at its high-water mark → the gate's coherence check exits 2
  **and** the derived pin reds. A lost record still stops CI.
- A floor **edited downward** by hand still reds against the derived pin, which demands exact
  equality with the committed cohort.

Both protections survive, but they are not both *doubly* covered: the second bullet has exactly one
reader, because the gate is one-directional. See D4 for the measured split — do not read this list as
defence in depth on the edit direction.

What is removed is the manual step on the **growth** direction — never the direction a ratchet
defends. The run log prints `ratchet: S0_REGRESSION_FLOOR 100 -> 150`, and prints the hold case too:
"did not move" and "was not considered" are different facts about a run.

### D4 — The floor's pointer anchor drops its value

`assertPointer(GATE, 130, "S0_REGRESSION_FLOOR = 100", …)` becomes
`assertPointer(GATE, 130, "S0_REGRESSION_FLOOR", …)`. The reason it kept a value — "a ratchet's whole
failure mode is being edited downward quietly" — is served by the derived equality in
`gate-s0-claims.invariants.test.ts`, which demands the floor **equal** the committed cohort and so
reds on any hand edit in either direction.

It is served by that reader **alone**, and this ADR states so rather than implying depth that is not
there. The gate's own load-time checks are both one-directional: coherence fires on
`S0_REGRESSION_FLOOR > committedCohort`, and the regression check on `censusRegistry <
S0_REGRESSION_FLOOR`. A floor edited *downward* satisfies neither — measured, not assumed: with the
floor hand-set to 100 against the committed 150 cohort, `pnpm gate:s0:regression` printed
"✓ All assertions passed" while the invariants suite red. That is correct by design — a low floor is
*slack*, not incoherence, and a gate that treats slack as failure cannot ratchet at all — but it means
the division of labour is a split, not a redundancy:

| direction | who catches it |
| --- | --- |
| cohort **shrinks** under a high floor | the gate (coherence exits 2) **and** the derived pin |
| floor **edited down** by hand | the derived pin **only** — the gate is silent |

Deleting or weakening that one assertion therefore removes the only guard on the edit direction.
Keeping the pointer's literal value would
have made this pointer red on every scheduled ingest: the same recurring-red defect, reintroduced by
a second reader that only ever checked that a literal had not moved.

### D5 — ADR 0074's inequality is asserted against the constant, explicitly

D1 opened a hole. `cap > required` was the guard on `DEFAULT_MAX_ENTRIES`, and with `cap` now derived
from a 150-cohort it passes on `150 > 25` even if the constant were edited back to 25 — after which a
**bootstrap** run (no previous snapshot) would rebuild the cohort at the requirement and re-arm
S0-OPEN-4's eviction. The retention suite therefore asserts the inequality **twice**: once for
today's served cap, once for the bootstrap cap read directly from the constant. Strictly stronger
than before.

### D6 — The bake clock is derived from the committed instants

`NOW` is computed as `min(resolvedAt, fetchedAt) + CADENCE_DAYS * 2`. Anchored to the **older** axis
because that is the axis the status is a function of (`nextRequired = older + CADENCE_DAYS`). Two
cadences, not one plus a day: the AGING band is `(7, 21]` days and `14` is its midpoint, a full
cadence from either edge, so the clock stays in the band it was chosen for rather than merely
entering it.

### D7 — A control that simulates the NEXT ingest

`tests/invariants/cohort-cap-derivation.invariants.test.ts` computes next week's cohort
(`count + STEP`) and next week's instants (`+7 days`) and asserts all three families stay coherent:
`headroom >= 0`, the scan bound stays positive, the cohort lands on the curve, the advanced floor
equals the cohort without leading it, and the derived clock still reads AGING. It also asserts the
clock **is** a derivation, by shape — a literal ISO instant at that declaration reds.

This is the decision that makes the class non-recurring rather than merely fixed. Nothing in the repo
asked "would this still hold after the next ingest?"; the only thing that ever asked was the ingest
itself, a week later, in a bot PR. Now a PR that re-pins any of them reds on itself.

## Consequences

- The floor advances without human involvement. Reviewers of a bot PR see `S0_REGRESSION_FLOOR`
  change in the diff, which is the intended visibility — it is a gate edit and must be in a diff.
- Ingest now writes a file under `scripts/`. `trust-ingest.yml` already commits whatever the bake
  produced, so no workflow change was needed; the new file simply appears in the same commit.
- A cohort that lands **off** the growth curve reds A. That is a genuine event (upstream shrank
  mid-fill) and the red is correct — it must be diagnosed, never absorbed by widening A.
- `DEFAULT_MAX_ENTRIES` keeps exactly one job: the bootstrap target, guarded by D5. If a future batch
  wants the curve to start elsewhere, that is now a single, explicitly-guarded decision.
- The nine assertions that changed in this batch are all recorded in place, with what they proved
  before and what they prove now, per the repo's amend-don't-rewrite convention.
