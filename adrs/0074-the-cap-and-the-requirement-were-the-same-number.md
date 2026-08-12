# ADR 0074 — The cap and the requirement were the same number

- **Status:** Accepted
- **Date:** 2026-08-11
- **Workstream:** S (adoption-index guards / Gate S0 ledger)
- **Batch:** S batch 5
- **Supersedes:** nothing. **Amends:** `artifacts/gate-s0/open-items.md` S0-OPEN-4 and S0-OPEN-1, and
  `artifacts/adoption-index-v1/current-gaps.md` §1.6 — all three by **append**.
- **Closes:** nothing on the S0 ledger. S0-OPEN-4 stays **OPEN**, and §7 is why.
- **Leaves open:** S0-OPEN-1, S0-OPEN-4, M-OPEN-1 (half 2), M-OPEN-3.
- **Authorizes:** the first expansion step ADR 0061 §11 declined to authorize — `25 → 100`, and only
  that one.

## §1 Numbering: 0074, and 0060 remains reserved

`ls adrs/` tops out at `0073`. **0060 is still not available.** Its reservation is held by name in
`artifacts/phase-2.4/presentation-plane-audit.json:135`, whose `$comment` reads verbatim *"the
`propertyNames` defect itself is RECORDED, NOT FIXED by PR P-5 — that is a schema change requiring an
ADR, and ADR 0060 is reserved for it."* Re-checked by listing the directory, not by trusting this
line's own history.

## §2 The decision

`packages/trust-index/src/fetchRegistry.ts` now declares:

```ts
export const DEFAULT_MAX_ENTRIES = 100   // was 25
```

`scripts/gate-s0.ts` is **unchanged**: `S0_REQUIRED_RECORDS` stays **25**. One number moved. The
requirement did not.

Nothing else in the ingest path changed — no re-ingest, no network action, no served bytes. The
committed snapshot still carries **19** entries at `fetchedAt: 2026-07-17T00:00:00.000Z`. This ADR
raises a ceiling; it does not fill it.

## §3 Why: the two constants being equal was the defect, not the values

`S0_REQUIRED_RECORDS` (Gate S0's cohort requirement) and `DEFAULT_MAX_ENTRIES` (the cap that selects
the cohort) were both **25**, for unrelated reasons, in unrelated files. That coincidence had a
consequence neither file stated:

```
cohort 19..24   gate SHORTFALL (red)    self present
cohort 25       gate MET      (green)   self present    ← the ONLY size satisfying both
cohort 26+      gate MET      (green)   self ** EVICTED **
```

`io.github.calllint/calllint` is the **only** `io.*` name in the cohort and upstream keys are
reverse-DNS, so it sorts after every `ac.` / `ag.` / `agency.` / `ai.` name — it is dead last, and
therefore the **first** entry an alphabetical cap reaches (`snapshotProjection.ts` step 3 caps *after*
the sort). So the action that closed Gate S0's shortfall by growing the cohort was the same action
that deleted this project's own trust page, **and the gate went green as it happened**.

That is not a slippery-slope argument. It is arithmetic over two constants that were the same number
by accident. It is recorded as S0-OPEN-4.

Raising the cap to 100 turns the single satisfying size into a 76-size interval `[25..100]`. The two
properties — *the gate is satisfied* and *the claimed subject survives* — are now independently
reachable. That, and only that, is what this ADR buys.

## §4 Why 100, and the honest limit of that number

100 is the first step of the `25 → 100 → 500 → all` ladder that ADR 0061 §11 and
`current-gaps.md` §1.6 already name. It was **not** chosen from a capacity measurement, and this ADR
declines to imply otherwise: §1.6's gap — *"Nothing measures the 25 → 100 → 500 step"* — is still
open, and this batch added no instrumentation. Ingest cost, mirror read volume, and bake time as
functions of cohort size remain unmeasured. 100 is a headroom choice sized to be obviously clear of
the requirement and obviously short of the 19_739 live names.

## §5 What the cap does NOT do, measured

**The cap cannot remove the eviction. It defers it.** The slice is still alphabetical and the claimed
subject still sorts last, so at **any** cap the subject is evicted at cohort `cap + 1`. Measured
through the production projection (`projectSnapshot`, the same function `refreshFromMirror` calls),
not argued:

| cap | last cohort size retaining the subject | first size evicting it |
| --- | --- | --- |
| 25  | 25  | 26  |
| 100 | 100 | 101 |
| 500 | 500 | 501 |

**Headroom was bought, not safety.** The only remedy that removes the hazard is the third candidate
in S0-OPEN-4 — replacing alphabetical slicing with a considered selection — and it remains
unauthorized. This ADR records that deliberately rather than presenting a deferral as a fix.

## §6 Why this was authorizable at all, given ADR 0061 §11

ADR 0061 §11 says, verbatim: *"The 25→100→500→all expansion is confirmed at PR R-9 and at Gate S0,
per the execution plan's O-5. **This ADR authorizes no expansion step.** … **Each expansion step
stays its own gated PR with its own artifact.**"*

The first clause is a refusal to pre-authorize. The last is the mechanism for authorizing one. §11
refuses *undecided* expansion, not expansion. This batch is that gated PR and this file is that
artifact, so §11 is **used**, not overridden. `current-gaps.md` §1.6 is amended to say so — its
sentence *"Recording it as a gap is not a request to close it"* stands; the request came from
elsewhere.

## §7 Why S0-OPEN-4 stays OPEN

Its closing condition, written before this batch, requires *"a recorded decision on which of the
three applies, **plus** a cohort at ≥26 on `main` with the claimed subject's served page still
present."* This ADR satisfies the first half. The second half needs an ingest run — a network action
on the sole scanner, which is its own authorization — and today's `main` carries 19.

The row's own note on why 25 does not count survives verbatim and is worth restating: *"25 is the
single size where the hazard is invisible, so passing there is the one outcome that proves nothing."*
Before this batch, a cohort at ≥26 evicted the page **by construction**, so the closing condition was
unreachable, not merely unmet. It is now reachable. That is the whole change in the row's status.

## §8 The five readers, and the shape every one of them was rewritten into

Five assertions across three files hardcoded a value derived from the cap. All five were rewritten to
assert the **relationship**. The two assertions that already asserted relationships
(`registry-cohort-retention`'s `out.count < cap`, and `gate-s0-claims`'s `floor <= required`) needed
no change — which is the argument for the shape.

| file | was | now |
| --- | --- | --- |
| `registry-cohort-retention.invariants.test.ts` | `headroom).toBe(6)` | `toBe(cap - names.length)`, plus `> 0` |
| ″ | `toEqual({cap: 25, required: 25})` | `cap).toBeGreaterThan(required)` |
| ″ | `for (extra = 0; extra <= 12)` + `both).toEqual([25])` | bound derived from cap; endpoints `[required, cap]` |
| `gate-s0-claims.invariants.test.ts` | `assertPointer(f, 19, "DEFAULT_MAX_ENTRIES = 25")` | `assertPointer(f, 34, "export const DEFAULT_MAX_ENTRIES")` |
| ″ | `expect(cap).toBe(required)` then both `.toBe("25")` | inequality first; **only** the requirement pinned to a literal |
| `expansion-eligibility.test.ts` | `"26"` as the smallest honoured ceiling | `String(DEFAULT_MAX_ENTRIES + 1)` |
| ″ | `"24"` as the below-boundary case | `String(DEFAULT_MAX_ENTRIES - 1)` |

**The cap's literal is deliberately not pinned anywhere.** It is the number this ADR expects to move
again (100 → 500 → all). A pin would red on a legitimate expansion while saying nothing about the
property that matters — [[prose-justified-constant-is-ungated]]. The requirement's literal **is**
pinned, because S0-OPEN-1's prose quotes it and a moved requirement makes that prose stale.

## §9 Two findings the edit produced that are larger than the edit

### 9.1 A hardcoded scan bound was accidentally correct, and would have silently truncated

`registry-cohort-retention`'s overlap test scanned `for (let extra = 0; extra <= 12; extra++)` and
expected `both).toEqual([25])`. At `cap == required` there is exactly one satisfying size and 12
reaches well past it, so the bound was **correct by accident**. At cap 100 the true interval is
`[25..100]` — 76 sizes — and that bound reports:

```
cap=25 : bound(<=12) => [25]                      true => [25]          (1 size)
cap=100: bound(<=12) => [25,26,27,28,29,30,31]    true => [25..100]     (76 sizes)
```

Seven of seventy-six. The assertion would have red — but on *"expected 7 sizes, got 1"*, sending the
next reader to the expectation instead of to the bound. **A truncated answer that reads as data is
worse than an absent one.** The bound is now `cap - names.length + 2`, and a separate assertion
requires it to reach past the cap, so a bound that collapsed could not pass vacuously. This is
[[hardcoded-range-stops-covering-its-tail]], third occurrence.

The derived bound then earned its keep under a control this batch ran deliberately. Negative control
**#209** moved the projection's `.slice()` to *before* the `.sort()` — mutating the production
projection, the one sentence §3's whole argument rests on — and the rewritten assertion reported:

```
Observed 78 sizes: 25..102        expected [25, 100]
```

It printed the drifted **upper endpoint**. The old hardcoded bound could not have: capped at 31, the
interval's top is outside what it scans, so the same mutation would have red with the top unchanged
and the reader pointed at the wrong end. A bound derived from the cap reports where the interval
actually stopped; a bound derived from a guess reports where the guess stopped.

The same control also red on the eviction assertion — *"at cohort 101 the cap evicts the claimed
subject"*, listing the surviving 100 names — which is the evidence that this file's central claim is
**measured through `projectSnapshot`**, not re-derived from the two constants. §5's table is an
observation, not arithmetic.

### 9.2 A preceding assertion hid the one that mattered

That same test red on its **first** assertion (`toEqual({cap: 25, required: 25})`), so the loop below
it never executed and §9.1's defect was invisible until probed in isolation. The equality pin was
*ahead of* the claim it supported. [[assertion-order-decides-falsifiability]], and the reason the
rewritten test asserts `cap > required` before touching any literal — and the reason
`gate-s0-claims`'s own load-bearing-order comment was preserved through the inversion rather than
rewritten.

## §10 Why the mirror inequality did not break

`resolveMirrorMaxEntries` (`refreshSnapshot.ts:173-188`) requires the mirror ceiling to be strictly
above the snapshot cap, and its fallback is:

```ts
const floor = Math.max(DEFAULT_MIRROR_MAX_ENTRIES, snapshotMaxEntries + 1)
```

Because the floor is **derived**, cap 100 needs no change there: `100 < 100_000`, and even a cap above
the mirror default would carry the inequality with it. A bare `return DEFAULT_MIRROR_MAX_ENTRIES`
would have broken at the first cap past 100_000. The only red was the **test's** hardcoded `"26"`,
whose own comment claimed *"the invariant is the inequality, not the constant"* — true of the code,
not yet true of the test. §8 made it true of both.

## §11 Deliberately left stale

`packages/adoption-index/src/projections/snapshotProjection.ts:15-19` reads *"the retained 25 are the
25 alphabetically first — NOT the 25 most recent."* The **mechanism** it describes is unchanged and
load-bearing; only its numeric example is now stale. It is left unedited: that file is
`packages/adoption-index/**`, which this workstream does not touch, and the sentence's claim survives
with any number substituted. Recorded here so the next reader knows it is known, not missed.

Also corrected in passing: S0-OPEN-4's prefix census reads `{ ac: 2, ag: 2, ai: 14, io: 1 }`; measured
it is `{ ac: 2, ag: 1, agency: 1, ai: 14, io: 1 }` — `agency.` was collapsed into `ag`. The
conclusion (one `io.*`, sorting last) is unaffected.

## §12 The general lesson

**Two constants that are equal for unrelated reasons will eventually be relied upon as if the
equality were a design.** Nothing in either file said "these must not be equal," so nothing objected
when a third property quietly depended on them being equal — and the property that depended on it was
a gate reporting success while deleting the thing it was gating.

The remedy is not the new value. It is that the **inequality is now asserted at three sites**, with
the value pinned at none of them, so the next reader who reaches for `= 25` reds on the reason rather
than on a number.

## §13 Scope: what this batch did not touch

Zero verdict movement · zero schema change · zero served bytes under `apps/web/public/**` · MCP stays
13 tools / 19 resources · `packages/calllint-mcp` runtime `dependencies` stays `{}` · `docs/` tracked
files stay 0 · `packages/adoption-index/**` unchanged · `scripts/gate-s0.ts` unchanged ·
**PR #234 untouched** · S0-OPEN-1 and M-OPEN-1/3 untouched · no ingest run, no network action.
