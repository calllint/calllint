# ADR 0097 — A pinned parameter cannot measure elapsed time

- Status: Accepted
- Date: 2026-09-01
- Supersedes: nothing. **Retracts a stated blocker** that had shipped in
  `scripts/gate-s1.ts`, `artifacts/gate-s1/open-items.md` and
  `artifacts/gate-s0/open-items.md` since Gate S1's first commit, and amends
  `packages/adoption-index/src/operations/resolveArtifacts.ts`,
  `packages/adoption-index/src/storage/runReport.ts`,
  `packages/trust-index/src/refreshSnapshot.ts` and `scripts/gate-s1.ts`.

## Context

Gate S1's `processing-time-mean-p95` measure has REFUSED since the gate existed, and its
refusal named a specific remedy:

> blocked on SCHEMA, not on a missing driver: `compiler_jobs` has `created_at`/`updated_at`/
> `available_at` and no `started_at`/`finished_at` … Adding the columns breaks the 14-column ↔
> 14-property equality `domain/job.ts:13` documents, so it needs a migration and an ADR —
> running the compiler cannot unblock this (S1-OPEN-1).

That text was written to be a precise, actionable blocker, and it was also the reason nobody
looked further for three weeks: it named a table, a migration, a documented equality it would
break, and an ADR. It reads like a completed diagnosis. It was asked to be executed, and
executing it would have been a mistake.

## Decision

**The migration is refused.** `processing-time-mean-p95` is instead given a real observable:
a monotonic per-attempt duration, recorded in the run report, over the unit of work that
actually exists.

### D1 — The named remedy would have produced a perfect score from zero observations

`compiler_jobs` holds **0 rows**, measured on the live store, and it always has:

```
compiler_jobs = 0        compiler_runs = 3
canonical_subjects = 26062   artifact_versions = 13422
```

`enqueueJobs` — the table's only writer (`store.ts:573`) — has **no non-test caller anywhere in
the repository**. `src/index.ts:356` re-exports it; nothing calls it. The queue is a library
with no driver, which `gate-s1.ts`'s own docblock has said since its first commit.

So adding `started_at`/`finished_at` to `compiler_jobs` yields two columns that are NULL in
every row of an empty table. The measure would then compute a mean and a p95 over **zero
samples**. This repository has already closed that fault four times, and named it in
`maps/guards.md`: *a rate over an empty denominator renders as a perfect score.* The remedy
would have broken a documented 14↔14 equality in order to build a fifth instance of the fault
the gate exists to catch.

### D2 — The blocker's central factual claim was false

"No duration is recorded anywhere" is wrong. `compiler_runs` has carried both endpoints since
the canonical DDL:

```sql
CREATE TABLE compiler_runs (
  …  started_at TEXT NOT NULL,  completed_at TEXT,  metrics_json TEXT NOT NULL
);
```

— `migrations/001-canonical-adoption-graph.sql:136-137`. It has a real production writer
(`refreshSnapshot.ts:476` / `:673` / `:685`) and **3 rows on disk**. The blocker searched the
wrong table and reported about the right measure with confidence, which is the fault class ADR
0096 closed twice on 2026-09-01. Two consecutive ADRs, same shape: **a correct verdict
immunises a wrong reason from review.** The verdict "REFUSED" was right the whole time, so
nobody re-derived the reason.

### D3 — And the recorded duration is structurally zero, which is the real blocker

Reading those columns does not close the measure either. All three rows:

```
FAILED     2026-09-01T00:16:06.000Z -> 2026-09-01T00:16:06.000Z
FAILED     2026-09-01T00:39:00.000Z -> 2026-09-01T00:39:00.000Z
SUCCEEDED  2026-09-01T01:15:00.000Z -> 2026-09-01T01:15:00.000Z
```

`completed_at - started_at = 0 ms`, every row, and not by accident. `refreshSnapshot.ts` passes
`startedAt: now, completedAt: now` — one `TRUST_INGEST_NOW`, pinned **once for the whole chain**
because four modules would otherwise stamp four different instants and break the
`projectedAt == fetchedAt` invariant the reproducibility gate pins.

So the two facts are in direct tension, and the tension is the finding:

> **A single pinned instant is required for reproducibility, and a single pinned instant cannot
> measure elapsed time.** `0 ms` is not a fast run; it is the absence of a measurement wearing a
> fast run's clothes.

This is why no migration could have closed the measure. The missing thing was never a column.
It was a **second, independent observable** — a monotonic clock, which this repository did not
use anywhere (`grep hrtime|performance.now` over all `src` returned nothing).

### D4 — The unit of work is the artifact attempt, not the job and not the run

`mean/p95` needs a distribution. The plan (Execution Plan §27) says only
`mean/p95 processing time`, with no granularity, so the granularity is a decision:

| candidate | n available | verdict |
|---|---|---|
| per `compiler_jobs` row | **0** | no rows, ever |
| per `compiler_runs` row | **3** (1 SUCCEEDED) | a p95 over 3 samples is not a p95 |
| per artifact attempt | **36 attempted** of 64 considered | a real distribution |

`resolveArtifacts.ts:120`'s `for (const artifact of considered) { await resolveOne(…) }` is one
unit of compiler work per iteration — a metadata fetch, a download, a digest verification, a tar
inspection, a CAS write. That is what "processing time" means for this compiler, and it is
already the loop every other S1 attempt-shaped measure counts.

`NO_ADAPTER` attempts are **excluded from the distribution**, for the same reason
`adapter-failure-rate` excludes them from both halves: nothing was attempted, so their duration
measures the loop's overhead, not processing. Including them would drag the mean toward zero
with samples that represent no work — the same category error as counting an unattempted
artifact as a success.

### D5 — The duration goes in the run report, not into a committed schema

`calllint.compiler-run-report.v2` → **v3**, adding one optional `processing` block. The cost is
bounded, and each bound was checked rather than assumed:

- the report lives under `.var/` (`.gitignore:64`), so it is **not a committed artifact** and
  enters **no fingerprint** — a non-deterministic duration cannot make a tracked byte
  non-reproducible. No test asserts its bytes or its digest.
- it is a **projection**, not a source of truth (`runReport.ts:28`): the `compiler_runs` row is
  the record. So a new field cannot make the database and the report disagree about anything the
  database holds.
- `metrics_json` is **untouched**. The committed `calllint.compiler-run.v1` document declares
  `metrics` as a closed object of six integers with `additionalProperties: false`; adding a
  seventh would invalidate every document. The duration is therefore a **sibling** of `metrics`,
  not a member of it.
- the schema constant already moved v1 → v2 once, so versioning it is the established path.

### D6 — The measure still REFUSES until a run produces samples, and that is the design

Reports already on disk are v2 and carry no `processing` block. The gate refuses a v2 report
with "this run predates the observable" — distinct from "no run has executed" and from "the run
attempted nothing". Three states, three messages. This is the discipline ADR 0093 set: build
the source, refuse honestly, and let a real run close it. **No measure is closed by computing a
`0/0`, and none is closed by subtracting two copies of one pinned parameter.**

## Consequences

- `compiler_jobs` keeps its 14↔14 equality. No migration, no NULL columns, no new dead surface.
- The repository gains its first monotonic clock, as an **injected seam**
  (`monotonicMs?: () => number`) so tests supply a fake and assert real numbers rather than
  tolerating jitter. Wall-clock `now` stays a parameter — INV-R6 is untouched, and a *duration*
  is not a timestamp.
- Three artifacts that carried the false blocker are corrected: `gate-s1.ts`'s refusal text,
  `artifacts/gate-s1/open-items.md`'s S1-OPEN-1 row, and the `gate-s0` cross-reference.
- **A guard is added for the defect itself**, not only for its symptom: an invariant asserts that
  the gate's processing measure never derives a duration from `startedAt`/`completedAt`, because
  the next person to "fix" this measure cheaply will subtract those two fields, get `0`, and ship
  a perfect score. The trap that caught this one is left armed.

## What this ADR does not claim

It does not claim the compiler is fast, or that 36 samples is a large distribution. p95 over 36
attempts is a real percentile computed from real observations, and the gate prints `n` beside it
so a reader can judge it. It also does not close S1-OPEN-5 (`withCompilerRun` cannot record a
crash in an async body) or `disk-growth`, which still needs a second measurement separated by
real elapsed time — the one blocker in this family that was correctly stated all along.
