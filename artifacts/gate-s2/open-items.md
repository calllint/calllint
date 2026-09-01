# Gate S2 — open items

**Gate:** `scripts/gate-s2.ts` · `pnpm gate:s2` / `gate:s2:gate` / `gate:s2:regression`
**Threshold:** 500 served registry records (`CUMULATIVE_COVERAGE_CEILING`)
**Cohort at creation:** **150** — the gate existed **350 records before its threshold**
**Cohort now:** **200** — **300 records before its threshold**
**Created:** 2026-08-31, closing S1-OPEN-2
**Reader:** `tests/invariants/gate-s2-claims.invariants.test.ts` — **31 `it` blocks, three layers**

That count is **derived** by the suite itself (`^\s*it\(`), not typed here. The S1 record described its
reader as 19 `it` blocks while the suite held 28 — stale by nine, in the flattering direction. A record
understating its own coverage invites someone to add tests that already exist; one overstating it
vouches for tests nobody wrote.

This file is **tracked**, unlike `docs/`, which is gitignored (`.gitignore:44`). That is the whole
reason it exists as a file rather than as prose in a spec: S1's status lived on exactly one machine
until `artifacts/gate-s1/open-items.md` was written, and a gate whose status no second clone can read
is a gate that cannot be handed over.

## Why this gate is RED today, and why that is correct

`pnpm gate:s2:gate` exits **2**. One measure is REFUSED: `cohort-completeness`, because the cohort is
150 and the shortfall is **not attributable** from anything currently on disk.

That is the designed state. S1 was written *after* its threshold was crossed, so nothing redded when
the cohort passed 100 — there was nothing to red. A gate that only appears once its threshold is met
can never have been the thing that measured it. S2 is the same guard arriving 350 records early, and
its redness is the evidence it is watching.

`gate:s2:regression` exits **0**: the four measures with a committed source pass, and the served floor
holds. That is the mode CI would run.

## The distinction this gate is built around

A cohort under 500 has **three causes needing different actions**, and nothing in this repo records which:

| cause | is it a defect? | remedy |
|---|---|---|
| **our cohort cap bound the emitted set** | no — but it is **ours**, and it binds today | wait for auto-growth, or `TRUST_INGEST_MAX_ENTRIES` |
| our mirror read was truncated | **yes** | raise the named mirror knob |
| upstream holds fewer than 500 live records | **no** | none — no local change raises the cohort |

The snapshot's `count` is what **we** emitted (150), never what upstream held. So a naive
`served < 500 → FAIL` would pin CI red on a fact about the MCP registry's size, and a reader would
"fix" it by raising a cap that was never binding.

**The middle row was originally missing, and its absence was a shipped defect — corrected 2026-08-31.**
The gate attributed the shortfall from `source.capReached` alone. But `capReached` describes the
**mirror read** — raw records in arrival order against `mirrorMaxEntries` (100,000) — while this measure's
subject is the **served cohort**, bounded by `snapshotMaxEntries`, which `resolveMaxEntries` auto-grows
+50 per run. Two different quantities, two different caps, the mirror's ~500x larger. So `capReached`
reads `false` on every run for years while the cohort sits at a cap that *did* bind.

Fed the values the next real ingest will write (`recordsRead: 65235`, `capReached: false`,
`snapshotMaxEntries: 200`), the gate printed:

> read the source TO ITS END — 65235 record(s) with caps snapshot=200 … **neither of which bound it**.
> So **upstream held fewer than 500 live records**

Every clause false, and refuted by numbers in its own sentence: 65,235 is not "fewer than 500", and the
cap that bound the cohort was printed beside the claim that no cap bound it. This is the fault class
one level up — not a guard that cannot see its subject, but a guard reading **the wrong subject** and
reporting confidently about it. `snapshotMaxEntries` was already validated and already printed; it was
simply never branched on.

The suite was green throughout, because its fixtures all carried `snapshotMaxEntries: 200` — under the
threshold — so the cohort-cap branch (once added) intercepts every one, and each mirror-attribution test
passed only by checking that a message *named* something, never that the branch under test had run. A
fixture whose cohort cap already bounds the cohort cannot isolate a question about the mirror read; the
suite now asserts its own fixture's validity so this cannot recur silently.

`cohort-completeness` therefore **REFUSES rather than fails**, and the refusal attributes the shortfall
from `source.snapshotMaxEntries` **first**, then `source.capReached` / `source.truncationReason`. Four
outcomes, and the last is a real answer rather than a fallback:

- `snapshotMaxEntries < 500` ⇒ **our cohort cap bound it**, whatever upstream held, and upstream
  exhaustion is left explicitly unclaimed. Checked first because it is the cap that binds today. The knob
  is `TRUST_INGEST_MAX_ENTRIES`; a mirror knob is *useless* here, and offering one is the wrong advice
  that made the old message dangerous rather than merely imprecise.
- `capReached: true` ⇒ **our mirror read was truncated.** The refusal names the binding cap and its
  environment knob per exit (`record-cap` → `TRUST_INGEST_MIRROR_MAX_ENTRIES`, `page-cap` →
  `TRUST_INGEST_MIRROR_MAX_PAGES`, `cursor-repeat` → **no local knob exists**).
- `capReached: false` **and** the cohort cap ≥ 500 ⇒ **upstream's shortfall.** Both conditions, because
  the mirror alone cannot support the claim. Conservative by construction: `syncSource` reports a source
  holding *exactly* `maxEntries` as capped, so `false` is strong evidence of exhaustion.
- no usable v2 report ⇒ **UNKNOWN, and it says so.** UNKNOWN is not SAFE — the product's own principle
  applied to its own gate. Claiming "upstream must be small" without evidence would be the
  confidently-wrong reason: consumed and acted on, sending someone to accept a shortfall our own cap
  in fact caused.

**`capReached: true` is currently unreachable in a successful report, and that is worth knowing before
trusting the second branch.** `assertMirrorComplete` throws inside `refreshFromMirror` (`:292`) *before*
it returns, and `mirrored` is assigned only from a successful call — so a run whose mirror was truncated
never reaches the report writer, and the crash path writes `source: null`. There is exactly one
production writer (`refreshSnapshot.ts:511`) and one caller of `refreshFromMirror`. The branch is
therefore reachable today only by a hand-written report, which is what the suite feeds it. Not a defect —
fail-closed is correct — but it means the mirror-truncation branch is **untested against real output**,
and a future caller that catches `MirrorIncompleteError` would be its first real exercise.

---

## S2-OPEN-1 — the 500 threshold is unreachable-or-unknown, and nothing records which

**Status:** **OPEN.** This is the row that matters.

Upstream's live total is **unrecorded anywhere in the repo**. The compiler's store holds 298 canonical
subjects and the served cohort is 150; whether upstream has 500 to give is not a fact this checkout
contains. So the gate refuses the measure instead of failing it.

Today the refusal reads `UPSTREAM EXHAUSTION UNKNOWN — no run report exists in any candidate store`,
because **no ingest has been run against this checkout**. That was deliberate and is not a gap in the
work: `pnpm ingest:trust-index` opens sockets, rewrites tracked bytes, and advances Gate S0's ratchet
floor, none of which belong in the same change as building a gate. The honest state is recorded here
rather than performed as a side effect.

**What would close this row** — either of:

1. a v2 run report with `source.capReached: false` **and** `source.snapshotMaxEntries >= 500`, which
   attributes the shortfall **upstream** and turns S2's threshold into a wait rather than a task; or
2. the cohort reaching 500, at which point `cohort-completeness` becomes MEASURED and passes.

Condition 1 was originally written as `capReached: false` alone — **which every run from here to the
ceiling will satisfy while proving nothing**, because the mirror cap (100,000) cannot bind against
upstream's ~65,000 records and the *cohort* cap is what holds the number down. Closing this row on that
signal would have recorded "upstream is short" as an established fact about a registry observed to hold
65,235 records. Both halves are required because the shortfall has two candidate owners and one signal
cannot separate them.

**Falsification:** a v2 report with `capReached: true`. That would mean **our mirror read** has been
ending early all along, and every "the cohort is just growing" reading of the last several runs was wrong.
The remedy would be the named mirror knob, not patience. Note this is currently unreachable in a
successful report — `assertMirrorComplete` fails the run closed before the report is written — so its
arrival would itself mean something changed about how truncation is handled.

**Do NOT close this row by editing the threshold.** 500 is imported from
`CUMULATIVE_COVERAGE_CEILING`, not written here, exactly so that lowering it to match reality requires
touching the mechanism the pipeline actually uses.

**Nor by raising `TRUST_INGEST_MAX_ENTRIES` to 500 in one jump.** That would make the cohort cap stop
binding and let the gate reach its upstream verdict — a real answer, but obtained by overriding the
auto-growth curve rather than by learning anything, and it discards the sticky-retention path the +50
step exists to exercise (ADR 0086). If it is done deliberately, it is a decision that belongs in this
row, not a side effect of wanting a green gate.

---

## S2-OPEN-2 — S2 is deliberately NOT in `ci:local`

**Status:** **OPEN (by design; recorded so it is a decision rather than an omission).**

`gate:s2:regression` is green today and would be safe to wire in. It is not wired in because CI time
is metered and S2's four passing measures are, at this cohort size, re-reading the same committed bytes
S1 already reads — the same assertion at 150 records, twice per CI run.

The value of a scale gate is at its own scale. Adding it now buys duplicate coverage; adding it as the
cohort approaches 500 buys the thing it was written for.

**What would close this row:** the served cohort passing ~400 (one growth step from the threshold), at
which point `gate:s2:regression` joins `ci:local` alongside S0's and S1's.

**Falsification:** if the cohort reaches 500 and S2 still runs only when someone types it by hand,
this row has become the excuse it was written to avoid being.

---

## S2-OPEN-3 — S3 (all records) and S4 (second source) are the same shape, two rungs up

**Status:** **OPEN.** Recorded now, because this is the pattern's **third** occurrence and the ladder's
remaining rungs are already known.

S1 arrived late. S2 arrived early, but only because S1-OPEN-2 was written down. S3 and S4 have no such
row yet, and the ladder ends `… → S3(all) → S4(second source)`.

Both differ from S2 in a way that matters, and neither is a copy of this gate:

- **S3 ("all records")** has *no numeric threshold at all* — "all" is defined by upstream, which is the
  quantity S2-OPEN-1 establishes we do not record. S3 cannot be written as `censusSource >= N`. It needs
  the `capReached: false` signal as its **primary** measure, not as an attribution for a shortfall.
- **S4 ("second source")** is not a scale rung at all; it is a *generality* claim. Everything in this
  gate joins through `REGISTRY_NAMESPACE` and `registryCanonicalName`, both single-source by
  construction. S4's real work is finding what breaks when `canonicalName` has two possible namespaces.

**What would close this row:** S3 and S4 each having a tracked artifact plus an executable gate before
their conditions are met — the same test S1-OPEN-2 set and this gate passed.

**Falsification:** if either arrives after its threshold, the lesson recorded three times did not
transfer, and the *pattern* is what needs a guard rather than the individual rungs.

---

## What S2 does not measure, deliberately

S1's four **runtime** measures — adapter failure rate, processing time mean/p95, CAS dedup rate, disk
growth — are **not repeated here**. Three are blocked on SCHEMA / a missing writer / elapsed time
against **the same store** S1 reads, so duplicating them would produce a second gate that cannot pass
for reasons S1 already owns and reports. Two gates refusing the same measure for the same reason is not
twice the coverage; it is one finding printed twice, and a reader who fixes it must then find both.
They remain S1-OPEN-1's.

The three measures S2 *does* share with S1 (`source-completeness`, `artifact-resolution`,
`page-quality`) are not duplication: S1 asks "did correctness survive 100?", S2 asks "did it survive
500?", and the same assertion at a different cohort size is the point of a scale ladder.

`scale-retention` is S2's own, and its **first specification was a restatement** worth recording. It
was planned as "no subject in the committed snapshot is absent from the served tree" — which is
`source-completeness`'s join, in the same direction. Measured: the two sets are exactly equal (150/150,
zero either way), so the measure would have been a second copy of a passing assertion. It now asserts
the **other** direction: every *served* name is still in the committed snapshot, because a served page
whose name has left the snapshot is one the next `selectCohortEntries` cannot retain — eviction in
progress rather than eviction already shipped. Proven distinct: appending an orphan to the served index
reds `scale-retention` while `source-completeness` stays green.
