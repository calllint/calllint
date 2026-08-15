# ADR 0083: A ratchet placed under a requirement cannot follow the cohort

**Status:** Accepted
**Date:** 2026-08-16
**Workstream:** S0-OPEN-4 closure — the re-ingest that restores this project's own Trust Page
**Amends:** [0074](0074-the-cap-and-the-requirement-were-the-same-number.md), which raised
`DEFAULT_MAX_ENTRIES` 25 → 100 and left `S0_REQUIRED_RECORDS` at 25.

## Context

The re-ingest closing S0-OPEN-4 moved the committed registry cohort from 25 to **100** (the cap,
exactly — `DEFAULT_MAX_ENTRIES` binds, and 0075's reserved-retention rule is what keeps
`mcp-registry/io.github.calllint-calllint` inside the slice at that boundary). Two assertions in
`tests/invariants/gate-s0-claims.invariants.test.ts` red on it, and they are not the same kind of
failure.

**The first is simply stale.** It pins `snapshot.count` to `25` with the message *"the committed
snapshot must stay at 25 (the S0 cohort requirement)"* and pins `fetchedAt` to the 2026-08-10
fetch. Both describe the PR #234 merge event this assertion was written to verify. The cohort has
since moved by an authorized ingest, so the pin now asserts that an intended change did not happen.
Its sibling assertion — `snap.entries.length === snap.count`, the one that actually catches a
hand-edited `count` — is untouched and stays.

**The second is a real rule conflict**, and it is unsatisfiable:

| rule | where | states |
|---|---|---|
| A | `scripts/gate-s0.ts:112` (load time, `process.exit(2)`) | `S0_REGRESSION_FLOOR <= S0_REQUIRED_RECORDS` |
| B | the test at `:719` | `S0_REGRESSION_FLOOR === upstream cohort` |

With the requirement at 25 and the cohort at 100, B demands a floor of 100 and A forbids any floor
above 25. No value satisfies both. This is the [[two-constants-equal-by-accident]] shape: each rule
is defensible alone, and they were consistent only while the cohort sat at or below the requirement.

## What each constant is for

The two numbers answer different questions, and the gate already keeps their **effects** separate
(`registryShort` vs `cohortRegressed`, `:568`/`:572`, with only the latter deciding `--regression`'s
exit code):

- `S0_REQUIRED_RECORDS = 25` is a **requirement** — traceability §26.2's vertical-slice size. It is
  a floor on ambition, enforced by `--gate`.
- `S0_REGRESSION_FLOOR` is a **ratchet** — "the cohort must not shrink." It is a floor on what has
  already been achieved, enforced by `--regression`, the mode CI runs on every PR.

Rule A's stated justification is *"a floor above the requirement would mean the ratchet could red
while the real gate was satisfiable, which inverts the relationship the two modes are supposed to
have."* That reasoning holds only while the requirement is the larger number. Once achievement
passes ambition, A stops protecting the relationship and starts capping the ratchet at a value the
cohort left behind.

**The cost is measurable, and it is a security cost.** With the floor pinned at 25 against a
100-entry cohort, 75 committed records can be lost and `pnpm gate:s0:regression` still exits 0. The
guard whose entire purpose is detecting a lost record goes blind to a 75-record loss — a ratchet
that no longer ratchets. That is strictly worse than the inversion A was written to prevent, because
A's failure mode is a noisy red and this one is a silent green.

## Decision

### D1: Rule A is replaced by the relationship it was trying to express

The load-time check becomes: the floor may not exceed the cohort **actually committed**, and may not
fall below `min(requirement, cohort)`. Expressed against the snapshot the gate already reads, so the
coherence check no longer references `S0_REQUIRED_RECORDS` at all — the requirement and the ratchet
stop being ordered against each other, which is what made them conflict.

A floor above the committed cohort is still incoherent (it reds CI for growth that has not
happened) and still exits 2 at load time. What is now permitted is exactly the case that arose: a
ratchet **above** a requirement, because the cohort passed the requirement.

### D2: The ratchet floor advances to 100, and stays derived

`S0_REGRESSION_FLOOR = 100`. The test at `:719` keeps pinning it to the upstream snapshot's entry
count, which is what makes the literal un-editable downward: lowering it fails an assertion whose
message says why it exists. That assertion's `toBeLessThanOrEqual(required)` clause is removed as
part of D1 — it encoded rule A.

`S0_REQUIRED_RECORDS` **stays 25**. It is a traceability figure, not a tracker of the cohort; raising
it because the cohort grew is what would make it a second, softer ratchet. `--gate` is now
satisfiable (100 >= 25) and is the mode that says so, exactly as its docblock predicted.

### D3: The stale count/fetchedAt pins state the ingest, not the merge event

`snapshot.count === 25` → pinned to the same upstream count the ratchet reads, so one authorized
ingest updates one place. `fetchedAt` is asserted to be a well-formed ISO-8601 instant rather than a
specific one: it changes on every legitimate ingest, so a literal there measures the last fetch's
timestamp and nothing else. The entry-count-equals-`count` assertion is untouched.

## Consequences

- `--regression` now reds if the cohort falls below 100, closing the 75-record blind spot.
- A future expansion (100 → 500, `current-gaps.md`) advances the floor by the same route: ingest,
  then the test's derived pin reds until the floor follows. The ordering is deliberate — the floor
  may never lead the cohort.
- Rule A's protection is not lost, only re-anchored: a floor above the committed cohort still exits
  2 at load time.
- `S0_REQUIRED_RECORDS` is untouched, so no requirement was weakened to make a test pass. The
  requirement is now *met* rather than *lowered*.

## Verification

All measured on the ADR 0083 branch, cohort 100.

- `pnpm gate:s0:regression` — **EXIT 0**, floor 100 held.
- `pnpm gate:s0:gate` — **EXIT 0**, requirement met (100 >= 25). It had never exited 0 before; the
  gate prints `cohort meets the requirement` where it used to print the shortfall.
- `pnpm typecheck` clean. `pnpm test` — **226/226 files, 4186 passed, 1 skipped, 0 failed.**

### Negative controls

Each was required to red *by its own assertion, naming its own subject*. Two did not on the first
attempt, and both fixes are part of this ADR's diff:

| control | mutation | result |
|---|---|---|
| D1 | `S0_REGRESSION_FLOOR = 101` (above the committed cohort) | load-time check **exit 2**, message names the cohort |
| D1 | `S0_REGRESSION_FLOOR = 24` (slack) | gate alone still **exit 0** — the derived test pin is the only guard, and it reds |
| D2 | cohort truncated to 99, floor left at 100 | reds: *"the committed cohort (99) fell below the ratchet floor (100) — that is a LOST RECORD, not an ingest"* |
| D3 | `fetchedAt` → `2026-08-32T99:99:99.999Z` | reds naming the value |
| D3 | `fetchedAt` → a *different valid* instant | stays **green** — proves the check pins shape, not a value |
| D3 | reserved entry renamed, count held at 100 | reds: the ADR 0075 retention cross-check |

Two controls falsified their own first drafts, which is the reason they are listed rather than
summarized:

1. **The invalid-instant control red with `RangeError: Invalid time value`**, thrown from inside
   `.toISOString()` — not from an assertion. The test went red for the right input with no message
   and no value printed. A `Number.isNaN(new Date(...).getTime())` clause now runs *before* the
   round-trip, so the red comes from an assertion that names the offending string.
2. **The eviction control initially also dropped `count` to 99**, so the lost-record assertion fired
   first and the retention cross-check was never reached — a control that appears to pass while
   measuring a different assertion than intended
   ([[green-negative-control-must-be-diagnosed]]). Re-run by *renaming* the reserved entry with the
   count held at 100, which isolates it.

### Pointer drift

`assertPointer` red on this batch (`90→95`, `108→123`, `124→163`, `568→607`) because the new
`committedRegistryCohort` helper and its docblocks moved every constant below them. Harmless drift,
caught the intended way — the failure quoted the docblock prose now sitting at `:90`. The
`S0_REGRESSION_FLOOR` anchor also changed *value* (`= 25` → `= 100`), which is a decision, not
drift, and it stays value-pinned because editing a ratchet downward quietly is the failure mode.
