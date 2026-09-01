# ADR 0094 — A writer called on every run, and refused on every run

- **Status**: Accepted
- **Date**: 2026-09-01
- **Supersedes**: nothing
- **Amends**: `runReportPath` / `casManifestPath` (`packages/adoption-index/src/storage/paths.ts`),
  whose id validation rejected the only id shape the minter has ever produced; the `RUNNING`
  refusal in `assertUsableCheckpoint` (`packages/adoption-index/src/domain/checkpoint.ts`), which
  named no remedy because none existed; and ADR 0093's consequence claim that building the manifest
  writer moved `cas-dedup-rate` from *unbuildable* to *unrun* — it moved it to **unrunnable**

## Context

The three defects here were found by one act: running `pnpm ingest:trust-index` on a machine with a
persistent store, having just shipped a gate (`scripts/gate-s2.ts`) whose central measure reads a run
report. The ingest exited 1 in forty seconds, and the first line of its output was a defect nobody had
reported in the months the code had been live.

**1. Both artifact writers were structurally dead.** `compilerRunId` is `hashJson(...)`
(`domain/job.ts:266`), so every run id the store has ever minted is `sha256:<64 hex>`. Both path
helpers validated ids against `/^[0-9a-zA-Z][0-9a-zA-Z._-]{0,127}$/`, which forbids `:`. So
`writeRunReport` and `writeCasManifest` threw on **every** production run, for every run there has
ever been. Both callers catch and log — deliberately, and the reasoning is sound in isolation (ADR
0093: "the manifest is evidence about a run, not a step of it") — so the failure printed one line to
stderr inside a several-minute log and never touched an exit code.

The consequence is that `reports/` and `cas/manifests/` were **empty on every machine**, while:

- `scripts/gate-s1.ts` censused both and printed `reports=0`, `cas/manifests=0` every run;
- `scripts/gate-s1.ts`'s `cas-dedup-rate` REFUSED for want of a denominator;
- `scripts/gate-s2.ts`'s `cohort-completeness` globbed `reports/` for its newest source-aware report
  and found none — the measure landed on its "no run report exists in any candidate store" branch,
  which reads as *nobody has run an ingest yet* and was in fact *the writer cannot write*.

This is the fault class `storage/paths.ts:reportsRoot` names, in its worst dress so far. The previous
instances were **absent writers**: a directory declared with nothing behind it, which at least has
the honesty of being obviously unbuilt. Here the writer existed, was wired, was called on every run,
was covered by tests — and could not succeed. An absent writer is a gap; a refused writer is a gap
that answers "yes" when you ask whether it was built.

**What let it ship** was a guard whose title named a subject its body never called:

```ts
it("accepts the shapes `beginCompilerRun` actually mints", () => {
  for (const ok of ["r-0001", "abc123", "run_2026-08-31T00.00.00.000Z", "A1"]) { … }
})
```

Four hand-written strings, none of which `beginCompilerRun` has ever produced, asserted to be the
shapes it mints. The test could not fail for the reason its title claimed to cover, because the
minter was never in the room. `runReportPath`'s own docblock made the same move in prose — "Run ids
are internal (`beginCompilerRun` mints them), so a malformed one is a programming error" — naming the
minter as the authority on the shape while the regex never asked it.

**2. A crashed run wedged the store permanently.** `beginRun` writes `RUNNING` before any fetch, so a
hard kill leaves it, and `assertUsableCheckpoint` then refuses to resume: "resume would skip records
that run fetched but may not have persisted". That refusal is right, and its message named **no way
out** — because there was none. No script, no doc, no ADR cleared `RUNNING`. `syncSource`'s catch
writes `FAILED` and covers an error *inside* the read; nothing covered the process dying. Measured
2026-09-01: this machine's store had been wedged since a kill weeks earlier, and every local ingest
since had exited 1 at the same line.

CI never saw it. `.var/` is gitignored and never cached, so a runner's checkpoint is always `IDLE` —
resumable. Only a persistent store (a developer machine, the R-9 worker) can inherit a crash. The
same asymmetry `pruneCas.ts` documents for CAS growth, with the same shape of conclusion: the
persistent path needs an operator step that CI does not.

**3. A pinned instant makes a failed run un-retryable.** `compilerRunId` hashes
`{runType, inputManifestDigest, startedAt}`, and `trust-ingest.yml` pins one `TRUST_INGEST_NOW` for
the whole ingest so four modules stamp one instant (correctly — cross-artifact comparison depends on
it). But `compiler_runs.run_id` is a PRIMARY KEY, so re-running after a failure **at the same pinned
instant** mints the identical id and dies on `SQLITE_CONSTRAINT_PRIMARYKEY` with a bare stack trace.

## Decision

**D1. The path helpers accept what the minter mints, through one shared encoder.** `runIdSegment`
maps `sha256:<hex>` → `sha256-<hex>` for the filename and passes plain filename-safe ids through
unchanged. The colon must not reach the filename: legal on POSIX, illegal on Windows, and this repo
runs on both.

The encoder is **shared** where the two validators were duplicated on purpose. That duplication was
argued on the grounds that a shared helper would turn a future divergence into a silent path change
rather than a type error. The trade is the other way round: the two names must match *because the two
projections of one run join on their filename*, so a divergence in the **encoding** breaks that join
silently — the worse of the two failures. Duplicating a validator is cheap; duplicating an encoder
makes the join hold by coincidence.

**D2. The guard test calls the minter.** Renaming the old test would not have been enough — a title
is not an observation. `compilerRunId` is now invoked, its output asserted to still be a digest (so
the test fails loudly if its own premise moves rather than silently stopping to cover anything), and
its result fed to the real writer. A second test pins that both projections still share a filename.

**D3. `RUNNING` has a runnable remedy, and the refusal names it.**
`pnpm recover-checkpoint:trust-index` performs exactly one transition, `RUNNING` → `FAILED`, via the
store's own `failRun`.

- `FAILED` is terminal, which is all the guard requires, and is precisely what `syncSource`'s catch
  would have written had the process lived. The store lands in a state the normal path already
  produces rather than a new one.
- `cursor` and `updatedSince` are **left alone**. The wedge is a status problem. Clearing the
  watermark would convert the next incremental into a full read; advancing it would open the §9.4
  gap the refusal exists to prevent.
- A terminal checkpoint is reported and left unchanged (re-runnable, and it must not overwrite the
  diagnosis of a run that failed for a real reason). `IDLE` is left alone too: not terminal, but it
  means *never ran*, and forcing `FAILED` would fabricate a failure.

The message change is the load-bearing half. A refusal that states no way out is one an operator
cannot act on — the standard ADR 0087 set ("the remedy for a guard has to be runnable"). Its test
asserts the named command **exists in `package.json`**, so a message naming an unwired script reds in
CI rather than at an operator's prompt.

**D4. ADR 0093's "unrun" is corrected to "unrunnable", in place and struck rather than deleted.** It
recorded that building the writer moved `cas-dedup-rate` from *unbuildable* to *unrun*, and that
"both stores still print `cas/manifests=0` … and will until an ingest runs." An ingest had run, many
times; the write was refused each time. The claim was written from the code's intent rather than from
a run, which is the same error in miniature as the test in D2.

## Consequences

**A first-ever run report and CAS manifest.** After D1 the next completed ingest writes both, so
`gate-s1`'s `reports=`/`cas/manifests=` census leaves 0 for the first time and `cas-dedup-rate` moves
from *refused for want of a denominator* to *measurable*. `gate-s2`'s `cohort-completeness` gets the
subject it was written to read — including the `snapshotMaxEntries` field whose absence from the
attribution logic was the defect fixed in `fc237ad`. Those two commits are one finding seen from both
ends: the reader was attributing from the wrong field, and the file it read had never existed.

**Write failure still never fails the run**, unchanged from ADR 0093 §"Write failure never fails the
run". That decision is not the defect and is not being revisited; a projection that can abort its own
subject is worse than a missing denominator. What made it costly was pairing it with a refusal that
fired every time, so the log line was noise rather than news. With D1 the line means what it says.

**A retry after a failed pinned run needs a fresh instant.** Not fixed in code, and stated rather
than hidden: the collision is *correct* under the id's own semantics — same run type, same input
digest, same start instant is the same run, and a concluded run may not be re-graded
(`concludeCompilerRun`). The operator's step is to re-pin `TRUST_INGEST_NOW`. What is genuinely
unhandled is the **error surface**: a `SQLITE_CONSTRAINT_PRIMARYKEY` stack trace explains none of
that. Recorded as open rather than closed quietly.

**Non-negotiable rules touched: none weakened.** No security rule moved, no golden fixture's verdict
changed, no `ScanReport` or policy-schema field changed. D1 widens an accepted-input set at a path
helper, and the previously-refused shapes (`../escape`, `a/b`, `""`, `.hidden`, 129 chars) all still
refuse — asserted by the untouched control #R4 block.

## What this does not do

It does not make the run report or the CAS manifest a step of a run; both remain evidence about one.
It does not give `assertUsableCheckpoint` the power to recover a store itself — the refusal stays a
refusal, and recovery stays an explicit operator act, because a guard that repairs its own subject
cannot also be trusted to report on it. It does not change what a run id is, or add a second id
shape: the store's id is unchanged, and only its *filename encoding* is defined here.
