# ADR 0095 — An upstream deprecation removes a subject from the cohort

- **Status**: Accepted
- **Date**: 2026-09-01
- **Supersedes**: nothing
- **Amends**: ADR 0085's deliberate non-decision. `assertCohortConservation` refused to project a
  subject holding both an `active`/`isLatest` row and a newer `deprecated`/`isLatest` row, on the
  stated grounds that whether such a subject belongs in a trust cohort "is a product judgement" the
  system "must not resolve on its own". This ADR resolves it: the subject leaves the cohort.

## Context

ADR 0085 fixed a projection that dropped 58 of 293 live subjects because a content hash chose which
version represented a subject. Its fix ordered `isLatest` first, and it left one shape deliberately
unresolved. From the guard's own docblock:

> it stays REACHABLE: D1 orders `isLatest` first, so a subject holding both an `active`/`isLatest`
> row and a *newer* `deprecated`/`isLatest` row resolves to the deprecated one and drops. The real
> store holds 4 `deprecated`/`isLatest=true` rows today, so the shape exists upstream even though no
> subject currently combines them.
>
> That is precisely the state this system must not resolve on its own. Whether a subject with two
> latest-marked versions — one active, one deprecated — belongs in a trust cohort is a product
> judgement, and ADR 0085 was written because this code answered a product question (withdrawal vs
> version bump) by accident and got it backwards.

**The shape has now materialized**, and it did so on the first real ingest this store completed in
weeks — the one unblocked by ADR 0094. `pnpm ingest:trust-index` exited 1 with
`CohortConservationError`, naming `ai.buywhere/buywhere-mcp`. The mirror holds four rows for it, and
the two that matter are:

| row | `isLatest` | `status` | `publishedAt` | `last_seen_at` |
| --- | --- | --- | --- | --- |
| v0.3.1 | `1` | `deprecated` | 2026-05-03T21:45:08Z | **2026-09-01** |
| v0.3.1 | `1` | `active` | 2026-05-03T21:45:08Z | 2026-08-04 |

Upstream served this server as active in August and serves it as deprecated now. `isLatest` and
`publishedAt` tie, `last_seen_at` breaks it, and the deprecated row wins — which is correct, it is
what upstream serves today. `isLiveCohort` then rejects it, the subject drops, and `liveInMirror`
still counts it because *some* row in history is live. Hence the refusal.

**The refusal was never defending a different policy.** Measured on the store the day it first fired:

| population | count |
| --- | --- |
| subjects whose chosen row is `active`/`isLatest` — the cohort | 25,765 |
| subjects whose chosen row is `deprecated`/`isLatest` | 291 |
| …of those, with a live row in history — **trip the guard** | **1** |
| …of those, with no live row in history — **already leaving silently** | **290** |

290 of 291 subjects in the identical product situation were *already* being dropped without comment,
because they were first mirrored after their deprecation and so never had a live row for
`liveInMirror` to see. The guard could only ever fire on the sliver that had been mirrored while
active and deprecated later. So the pipeline's *de facto* answer has always been "a deprecated
subject leaves the cohort"; the refusal was an inconsistency, not an alternative.

It is also invisible to CI by construction. `.var/` is gitignored and never cached, so a runner's
mirror is always cold: one walk sees only today's rows, all deprecated, no live row in history, no
refusal. Only a persistent store can hold history spanning a deprecation. Same asymmetry ADR 0094
recorded for the `RUNNING` wedge, from the same cause.

The docblock's own count is worth stating: it said **4** `deprecated`/`isLatest` rows existed. There
are now **292** rows across 291 subjects. The shape went from marginal to structural in four weeks,
which is why leaving the question open was no longer cheap.

## Decision

**D1. A subject whose chosen row is the source's latest and is not `active` has been withdrawn, and
leaves the cohort.** It is measured as `droppedByUpstreamWithdrawal`, counted in the partition
identity, named in the run log, and not thrown on.

The trust argument is the deciding one, and it runs the same direction as the product principle that
`SAFE` is never a guarantee: the cohort exists to tell an agent which servers are worth trusting, and
a server whose publisher has marked its current version deprecated is not one this index should keep
recommending. Serving it because we once saw it active would be this index asserting a currency the
source has withdrawn.

**D2. The discriminator is the source's own `isLatest` on the chosen row, and it is total.** A subject
only reaches this partition by holding an `active`/`isLatest` row somewhere, so its chosen row is one
of exactly two things:

- also `isLatest` — the source says *this* version is current and says it is deprecated. Withdrawal.
- not `isLatest` — the ordering seated a non-current row while a current one existed. That is ADR
  0085's defect and nothing else. **Still fails closed.**

`isLatest` is used rather than a recomputed "which row is most current" because ADR 0085 D1 made it
the primary sort key. A guard that re-derived currency would be a second copy of the ordering, which
is `a-guard-importing-one-of-two-copies` with the same ending.

A subject with no chosen row at all is classified **stale**, not withdrawn. That is unreachable
through the real reads — the current row is one of the rows — and the fail-closed side is the right
home for a state that means the two reads disagree.

**D3. Withdrawals are named in the run log, not merely subtracted.** `describeCohortConservation` now
prints `live = served + capped + withdrawn + stale`, with up to five subject names. `withdrawn` earns
its clause for the opposite reason to `capped`: it moves the cohort **down**, and a shrink is the
delta most easily misread as a defect. ADR 0083's ratchet measures magnitude and will see the dip;
magnitude is not a cause. Naming the subject at the point the cohort loses it is what makes an
upstream deprecation legible as one.

**D4. The test that pinned the refusal is rewritten to pin the decision, not deleted.** Its comment
records that the old expectation was a *placeholder for an unanswered question* rather than a rule
that turned out wrong — the distinction the repo's own convention about struck-not-deleted reasoning
exists to preserve. Two tests were added that the old shape could not express: one separating a
withdrawal from a stale row **in a single measurement**, and one asserting a withdrawal-shrunk run
**commits** (checkpoint digest advanced, identity persisted).

## Consequences

**The cohort can now shrink on a completed run**, for the first time. Today that is 1 subject of
25,766. It will grow: every subject mirrored while active and deprecated later crosses this path, and
the mirror only gets older. A dip in the cohort count is now a legible event with a named cause
rather than an unexplained one.

**The ADR 0085 refusal is unreachable through a well-formed store** — `isLatest DESC` seats an
`isLatest` row whenever the subject has one, and a subject with no `isLatest` row is not live in the
mirror either. That is a property of the ordering, not of this change, and it was equally true before.
It has a testing consequence worth stating plainly: the placement test for this guard now **injects**
the pre-D1 read (overriding `listLatestSourceRecordPayloads` and leaving every other store method
real) rather than constructing a shape a real store can reach. The alternative was a placement test
whose only refusal vehicle was the shape D1 just exempted — that is, a guard whose fail-closed branch
had no test that could red, which is the fault class this repo keeps finding.

**Two negative controls were run.** Flipping the discriminator to treat any non-live chosen row as a
withdrawal redded 5 tests including ADR 0085's own refusal — so the exemption cannot swallow the
defect class it was carved out of. Dropping `withdrawn` from the partition identity redded 3,
including a run that must commit. Both restored byte-identical.

## What this does not do

It does not remove the subject from the **mirror**. The mirror is append-only, there is no DELETE in
this package, and the rows remain as evidence — a withdrawal is a fact about what upstream serves, not
a reason to forget what it served. It does not change `isLiveCohort`, the projection, the ordering, or
the cap. It does not let a deprecated subject re-enter the cohort by any path other than upstream
publishing an `active`/`isLatest` row again, which is the source's statement to make and not this
index's. And it does not weaken the fail-closed branch: the ADR 0085 class still refuses, still names
its subjects, and still advances nothing.
