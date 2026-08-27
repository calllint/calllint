# ADR 0009: Instrumentation Precedes the Cohort Cap — 100 Stays Until the Step Is Measured

**Status:** Decided (2026-08-27)
**Context:** J3 / `NEW19-21_OPEN_ITEMS` §1.6 — the 100 → 500 expansion has no evidence behind it.
**Decides:** The cap does not move until three quantities are measured; what must be measured.

---

## Context

`DEFAULT_MAX_ENTRIES` in `packages/trust-index/src/fetchRegistry.ts` is the compiled cohort cap.
The cumulative-coverage amendment proposes 100 → 500 with `+50/run` auto-growth. Nothing in the
repo measures ingest cost, mirror read volume, or bake time **as a function of cohort size**, so
the proposal rests on an assumption that scaling is linear and cheap.

Two premises are pinned by `tests/invariants/open-judgements.invariants.test.ts`:

- `fetchRegistry.ts` contains none of `cursor`, `updated_since`, `updatedSince`, `watermark`
  (comments stripped). Ingestion is **single-shot with no incremental sync** — the mechanism whose
  absence §1.2 and §1.6 both assert.
- The cap the artifact reasons about is the cap that is actually compiled. The test reads
  `DEFAULT_MAX_ENTRIES` from source and requires §1.6 to discuss *that* value, rather than pinning
  a literal — so a cap that moves without its artifact reds as the gate being bypassed.

ADR 0061 §11 already requires an expansion step to arrive with its own artifact. This ADR makes
the requirement concrete instead of procedural.

## Decision

**The cap stays at its compiled value until all three are measured, at 100 and at one larger
cohort, with the numbers committed:**

1. **Ingest wall-clock and request count** as a function of cohort size. A single-shot fetch that
   works at 100 may exceed a platform timeout at 500; that is a cliff, not a slope, and it cannot
   be extrapolated from one data point.
2. **Mirror read volume** per run, in bytes and requests. This is the quantity that turns into
   someone else's rate limit — a limit reached by our expansion is an external harm, not a
   local slowdown.
3. **Bake time** and output size for the projections. Generation feeds a byte-compared drift
   gate; a bake that grows past CI's budget converts an expansion into a red gate on unrelated PRs.

**Two data points minimum.** One measurement at 100 establishes nothing about scaling; the claim
being tested is a *shape*, and a shape needs at least two points plus a stated expectation.

### Ordering, and why auto-growth is separately gated

`+50/run` auto-growth is **not** authorized by satisfying the three measurements. A measured
static cap says "500 is affordable once." Auto-growth says "every future value is affordable,"
which is an unbounded claim no finite measurement supports. Auto-growth requires, additionally, a
**hard ceiling** and a **stop condition on the measured quantities** — growth must halt on its own
evidence, not on a number chosen in advance.

Incremental sync (a cursor or watermark) is the mechanism that would make large cohorts cheap. It
is **not** required by this ADR — but if it lands, J3's first premise moves and §1.2/§1.6 must be
rewritten in the same change.

## Consequences

Cumulative coverage stays blocked, and the eviction behaviour at the current cap remains the
user-visible ceiling. Accepted: an unmeasured 5× expansion of a step that reads someone else's
service is the kind of change whose failure mode is discovered by the party being read.

**A correction this ADR carries forward:** §1.6's last paragraph (2026-08-11, ADR 0074) says the
cap "cannot remove the eviction, only defer it — the claimed subject is evicted at cohort
`cap + 1` at every cap." **ADR 0075 landed the next day** and removed exactly that: 
`selectCohortEntries` retains every reserved name whenever `max >= 1`. The eviction half of §1.6
is stale; only the **instrumentation** half is open, which is why the invariant test pins the
retention rule and deliberately does not pin the `cap + 1` claim — pinning it would have gone
green for an unrelated reason (`.slice(0, max)` appears at the line capping the reserved
partition), a probe agreeing with a sentence instead of measuring a mechanism.

## Alternatives rejected

- **Move to 500 now, measure after.** The failure is observed by the mirror operator first.
- **Move to 200 as a compromise.** Halves the step without adding evidence; the objection is
  the absence of measurement, not the magnitude.
- **Measure in CI on every run.** Turns a one-time question into recurring spend against an
  external service, and makes an unrelated PR's red depend on a third party's latency.
