# ADR 0010: Wire the Adoption Record in Its Own Change, After a Byte-Stability Baseline

**Status:** Decided (2026-08-27)
**Context:** J1 / `NEW19-21_OPEN_ITEMS` §1.1 — R-7 wrote the record and deliberately left the
projections unwired.
**Decides:** The wiring is authorized, in a dedicated change, with a stated ordering.

---

## Context

R-7 landed `calllint.adoption-record.v1` and did **not** rewire `emitCohort` / `bake` to read it.
The recorded reason: binding "is the record correct?" to "is the served tree unchanged?" in one PR
makes a red on either side undiagnosable.

`tests/invariants/open-judgements.invariants.test.ts` pins the premise on the **serving path's own
file** — `packages/trust-index/src/bake.ts`, with comments stripped, asserting neither
`adoption_records` nor `adoptionRecordDigest(` appears. The stripping is load-bearing: the most
likely honest edit to `bake.ts` is a note saying it deliberately does not read a compiled record,
and a raw-text scan would read that note as the wiring having happened — the opposite of the truth.

The scan is deliberately not run over `packages/adoption-index/src/**`, which mentions records
everywhere because it **defines** them.

The gap's cost is now real: a record that is written and never read is indistinguishable from a
record that is wrong. Every day it stays unread, the probability that it *is* wrong rises, and
nothing will report it.

## Decision

**Wire it, in a change that does nothing else, in this order:**

1. **Baseline first.** Capture the current served bytes for the full projection set *before* any
   wiring, as a committed fixture. Without it, step 3 has nothing to compare against and "the tree
   changed" cannot be distinguished from "the tree was always like that."
2. **Read the record in `bake.ts`**, with the projection output required to be **byte-identical**
   to the baseline. If the record is correct, wiring it changes nothing observable. A diff at this
   step is the record being wrong, and that is the whole point of ordering it this way.
3. **Only then** may a projection's *content* derive from the record. Any change to served bytes
   belongs in a third change, where a diff means "we intended this," not "something is broken."

Step 2 is the diagnostic that R-7 was protecting. Its value comes entirely from being alone in its
change: a PR that wires the record *and* changes output has a red that could be either, which is
the state R-7 declined to create.

### What closing this requires of the artifact

The invariant test reds when `bake.ts` reads the record — **by design**. That red is the signal to
update `NEW19-21_OPEN_ITEMS` §1.1 and the CHANGELOG's R-7 entry in the *same* change, since both
then describe a state that no longer exists. Silencing the test without rewriting those two is the
guard-and-prose divergence this repo keeps re-finding: the guard passes while the text it guards no
longer admits a guard exists.

## Consequences

The record starts being verified against reality, and the projections gain a single source for
adoption facts instead of a record and a serving path that agree only by coincidence.

Cost: three changes where one would "work." Accepted, because the middle change is the only one
that can tell us the record is correct, and it can only do that if it is the sole variable.

## Alternatives rejected

- **Wire and change output together.** Exactly what R-7 refused, for a reason that has not
  weakened.
- **Keep the record unread indefinitely.** An unread record's error rate is unbounded and
  unobservable; this is strictly worse than either wiring it or deleting it.
- **Delete `calllint.adoption-record.v1`.** Discards measured work and leaves the projections with
  no path to a compiled source of adoption facts.
