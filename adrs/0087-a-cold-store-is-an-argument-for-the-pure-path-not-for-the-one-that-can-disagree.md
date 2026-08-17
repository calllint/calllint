# ADR 0087 — a cold store is an argument for the pure path, not for the one that can disagree

- **Status:** Accepted
- **Date:** 2026-08-17
- **Relates to:** ADR 0061 §8.1 (the committed artifact stays a pure function of committed bytes),
  ADR 0046 §4 (the reproducibility diff gate), ADR 0038 §3 (ingestion is decoupled from serving).
- **Amends:** ADR 0061 §8.1's consequence line for `trust-ingest.yml`. See §5.

## Context

`trust-ingest.yml` ran `pnpm project-adoption-index:trust-index:store` — the variant that opens the
compiler's SQLite store — to produce a file that is committed and then served:
`packages/trust-index/snapshots/adoption-index.json`.

ADR 0061 §8.1 is titled *"The committed artifact stays a pure function of committed bytes (the
load-bearing half)"* and states that this file "is always produced by the `--from-snapshot` path,
never by a warm store." Its own consequence line then exempted the workflow:

> **Consequence for `trust-ingest.yml`:** unchanged. Its `project-adoption-index:trust-index:store`
> step (line 94) stays correct **because** Actions' store is cold and was just written by the ingest
> one step earlier.

So the ADR asserted a rule and, four paragraphs later, exempted the only place the rule had a live
subject. This ADR records that the exemption's stated premise is false, that the premise was never
the load-bearing half anyway, and that the step is now the pure one.

## What was measured

### 1. The step's justification defended a field the artifact does not carry

The reason given for `:store` was that `persistIdentity` had just written `firstSeenAt` history
"no derivation can reconstruct". The first clause is true. The conclusion does not follow, because
`firstSeenAt` never reaches the committed file.

| measured | value | where |
|---|---|---|
| entry key set | `subjectId, canonicalName, canonicalSlug, identityStatus, identityDigest, lastSeenAt` | `snapshots/adoption-index.json` |
| committed entries carrying `firstSeenAt` | **0 of 100** | same file |
| projection field list | no `firstSeenAt` | `adoptionIndexProjection.ts:70-75` |

`deriveSubjectsFromSnapshot.ts:19-21` already said so in prose: the only thing the derivation cannot
reproduce is `firstSeenAt` history, "and `firstSeenAt` is not [carried]". The step was defending a
column that never enters the artifact. It bought nothing, and it spent reproducibility: what it
actually did was make committed bytes depend on whichever rows that runner's database happened to
hold.

### 2. "Actions' store is cold" is false inside this job, and the repo already documented why

`projectAdoptionIndex.ts:13-16`, on the store-reading path:

> **IN THE WORKFLOW the store is full.** `trust-ingest.yml` runs `ingest:trust-index` —
> `refreshSnapshot.ts`, whose `refreshFromMirror` calls `persistIdentity` — before this step, so
> `canonical_subjects` holds the mirrored cohort.

`persistIdentity` is called at `refreshFromMirror.ts:366`, on the ingest path, in the same job, one
step earlier. The runner's *checkout* is cold; the *store at the moment of projection* is warm by
construction — the ingest warms it. ADR 0061 §8.1 and this docblock cannot both be right, and the
docblock is the one describing the actual step order.

The distinction matters because "cold" was doing the work of "empty", and it is only ever empty
*before* the step that fills it.

### 3. The two paths disagree by observation, not by degree

Already recorded at `projectAdoptionIndex.ts:81-86` and re-stated in ADR 0061 §8.1: against a warm
`.var/`, the store path emitted **298** subjects under a wall clock where the committed snapshot
beside it derived **19**, and the snapshot's own `io.github.calllint/calllint` was **absent** from
the 298. Not a superset and a subset — two different answers.

## The inversion

ADR 0061 §8.1 argued: *the store path stays correct because the store is cold, so the two paths
agree.*

Read as written, that is an argument **against** the store path. If the two paths agree whenever the
premise holds, then choosing the store path buys nothing when the premise holds and produces a
different artifact when it fails. A cold store is a reason the pure path is safe to adopt, never a
reason to keep the path that can disagree.

And the premise is a property of the environment, not of this repo: it fails the moment `.var/` is
cached between jobs, the moment a self-hosted runner is used, and — per §2 — it already fails within
the job as soon as `ingest` runs. A correctness argument resting on "the environment happens to be
empty" is an argument with an expiry date nobody is watching.

## Decision

**D1 — `trust-ingest.yml` runs `pnpm project-adoption-index:trust-index` (pure, `--from-snapshot`).**
The committed identity plane becomes a function of committed bytes on every leg — scheduled run,
CI re-bake, and developer machine alike — so anyone can re-derive it and byte-compare. This makes
the workflow obey ADR 0061 §8.1's rule instead of being exempted from it.

**D2 — the reason is recorded at the step, including that the old reason was false.** The step's
comment names the measurement (`firstSeenAt` absent from 100/100 entries, absent from the projection's
field set) rather than asserting a conclusion. A step whose comment states a false premise is worse
than an uncommented one: it answers the reviewer's question wrongly.

**D3 — ordering is no longer load-bearing for correctness, and the comment says so.** A pure
projection cannot read a previous run's identity, so this step can no longer be broken by step order.
It stays after the ingest because the snapshot it reads should be this run's.

**D4 — ADR 0061 §8.1's consequence line is amended in place, not rewritten.** See §5.

## §5 — the amendment to ADR 0061 §8.1

ADR 0061 §5 forbids rewriting history, so the falsified sentences stay legible and are struck
through with the correction beside them. Two edits, both in the §8.1 block:

1. The parenthetical **"In Actions the store is ephemeral, so it is always cold and the two paths
   agree"** — struck. The checkout is cold; the store at the moment of projection is warm, because
   `ingest:trust-index` calls `persistIdentity` one step earlier in the same job
   (`projectAdoptionIndex.ts:13-16`). The surviving claim — that a persistent store on a VPS is warm
   by definition — is unaffected and is what R-9 has to reckon with.
2. The **"Consequence for `trust-ingest.yml`: unchanged … stays correct because Actions' store is
   cold"** paragraph — struck and replaced: the step now runs the pure variant, per this ADR. The
   worker still does not inherit the step, which was the paragraph's other point and remains true.

What §8.1 gets *right* is the part this ADR leans on: the committed artifact must be a pure function
of committed bytes, and it is already gated by `committed-tree.test.ts` (control #117 byte-compare +
the `projectedAt === fetchedAt` pin). D1 does not add a gate. It removes the one place that was
exempt from the gate's premise.

## Consequences

- The scheduled ingest's committed identity plane no longer depends on runner-local database state.
  Before D1, a cached or self-hosted `.var/` would have silently changed committed bytes.
- No new gate, and no gate weakened. `committed-tree.test.ts` re-derives from the committed snapshot
  and byte-compares; that test's premise is now true of the workflow as well, rather than of every
  path except the workflow.
- `project-adoption-index:trust-index:store` remains in `package.json`. It is the correct tool for a
  warm-store operator on the R-9 worker, which is what it was written for; what changes is that the
  scheduled workflow no longer uses it to produce committed bytes.
- The `firstSeenAt` history remains store-only and out of committed bytes — unchanged by this ADR,
  and the measurement in §1 is what establishes that it was never at stake.

## Controls run

The switch is only as good as the evidence that the artifact does not move. Measured, in order:

| control | result |
|---|---|
| `pnpm project-adoption-index:trust-index` on the committed snapshot, then `git diff` | **no change** — the pure path reproduces the committed bytes exactly |
| `firstSeenAt` present in any committed entry? | **0 of 100** — the field the old step defended is absent |
| `pnpm test` (full suite) | see the checkpoint below |

The first control is the load-bearing one: it establishes that D1 is a change of *justification and
of guarantee*, not a change of output. Had the bytes moved, this would have needed a page-diff review
before it could land.
