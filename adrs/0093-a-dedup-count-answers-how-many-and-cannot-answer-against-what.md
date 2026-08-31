# ADR 0093 — A dedup count answers "how many", and cannot answer "against what"

- **Status**: Accepted
- **Date**: 2026-08-31
- **Supersedes**: nothing
- **Amends**: `INDEX_SUBDIRS`' `cas/manifests` declaration (`packages/adoption-index/src/storage/paths.ts:25`),
  which has existed since the first commit of that file with no writer and no format; and the
  `cas-dedup-rate` refusal in `scripts/gate-s1.ts`, whose blocker this changes from **MISSING WRITER**
  to *no run yet in this checkout*

## Context

`scripts/gate-s1.ts` has counted the files under `cas/manifests` for as long as that gate has
existed. The census printed `cas/manifests=0` on every run, and the `cas-dedup-rate` measure REFUSED
with a blocker it named precisely: a dedup rate is `distinct blobs ÷ manifest references`, and with
zero manifests there was nothing the 45 blobs were deduplicated *against*.

That refusal was correct, and it was **permanent**. The denominator had never been produced by any
run, past or future, because nothing anywhere wrote a manifest. This is the fourth instance in this
store of the fault class `storage/paths.ts:reportsRoot` names — a reader whose subject does not exist
reads a benign value forever and never says so — and the pattern of the fix is the same as the third
(`storage/runReport.ts`): the fact was already known at the moment of the write and was persisted
nowhere a gate could reach.

What made this one need a decision rather than a patch: **no manifest format existed**. The blueprint
(`docs/new15ref/…Execution_Plan_v1.0.md` §11.1, §10.4) specifies only that the directory exists. So
"write the writer" had no schema to write against, and picking one silently would have set the shape
of a gate's denominator by accident.

## Decision

Define `calllint.cas-manifest.v1` and write one manifest per compiler run at
`cas/manifests/run-<runId>.json`, recording **which** digests the run referenced — not how many times
deduplication hit.

```ts
interface CasManifestReference {
  readonly artifactVersionId: string   // the join key back to `artifact_versions`
  readonly digest: string              // `sha256:<hex>`, verifyAndStore's own value
  readonly deduplicated: boolean       // the bytes were already on disk
}
```

with `totals: { references, distinctDigests, deduplicated }` derived from that list by
`summarizeReferences`, never hand-counted.

## §4 — Why a manifest and not a counter

The cheap option was considered and rejected. `verifyAndStore` already returns `deduplicated: boolean`
per call; summing those into a running total would have closed the measure with **one integer and no
new directory**.

It cannot answer the question the measure asks. A count answers *how many hits*; a rate needs to know
*against what*. Two stores in opposite conditions produce the same counter:

| store | references | distinct blobs | counter says |
|---|---|---|---|
| nine requests for one blob | 9 | 1 | 8 deduplicated |
| nine distinct blobs, each sharing one prior | 9 | 9 | 8 deduplicated |

The first is a store doing almost nothing new; the second is a store that grew by nine. A single
"dedup rate" over that counter reports them identically, and a reader would be right to conclude
whichever they already believed.

Recording *which* digests were referenced makes both numbers a rate needs re-derivable from disk, and
makes them **two numbers rather than one**:

- `references − distinctDigests` — reuse **within** the run.
- `deduplicated` — references whose bytes were already on disk when the run reached them, which
  includes reuse **across** runs.

Both are recorded because they answer different questions. Collapsing them is how a number starts
being read as the other one, so `gate-s1.ts` prints them as two counts over a stated denominator and
the invariant suite asserts that it does.

## §5 — The projection must be catchable lying about itself

`totals` ships beside `references` in the same file, so a reader that trusts `totals` is trusting the
thing it is checking. `scripts/gate-s1.ts` therefore **recounts** the list and refuses a manifest
whose stated totals disagree with it (`the projection disagrees with itself`).

The recount in the gate is deliberately a restatement of `summarizeReferences` rather than a call to
it. The script imports nothing from the workspace (ABI reasons recorded in its header), and more to
the point: an independent recount that calls the same function is worth nothing.

`schema` is matched against an enumerated `READABLE_MANIFEST_SCHEMAS`, exactly and never by prefix,
for the reason `runReport.ts:54` records — a prefix match accepts every future version sight unseen,
which is the defect an exact check exists to prevent. A `v2` that renamed `deduplicated` would
otherwise be read with v1 semantics and produce a confident wrong number.

## Consequences

**The refusal does not retire.** A present manifest with zero references still REFUSES, because a
zero denominator is not a rate. Building the writer moved `cas-dedup-rate` from *unbuildable* to
*unrun*; both stores still print `cas/manifests=0`, and will until an ingest runs. That the census is
unchanged while the blocker changed is why S1-OPEN-1 records the move in the refusal text rather than
in a number.

**Not-run stays distinguishable from ran-and-counted-zero**, at both ends: the writer self-suppresses
when the artifact stage did not run (`mirrored.artifacts` null), and the reader refuses an absent
manifest rather than reading it as `0/0`.

**A run that crashes after resolving artifacts still writes.** `projectCasManifest` is called on the
catch path too, so the CAS never holds bytes no manifest accounts for. A manifest naming a digest no
blob exists at is then a *visible* bug — the manifest's, not the CAS's — which it could not be while
only one side was on disk.

**Write failure never fails the run.** It logs loudly. The manifest is evidence about a run, not a
step of it, and a projection that can abort its own subject is a worse failure than a missing
denominator.

**Manifests are ordered by `artifactVersionId`** so two runs over an unchanged store produce
byte-identical files. An unordered list would make every manifest differ from the last for reasons
that are not facts about the store, and a diff nobody can read is a diff nobody checks.

## What this does not do

It does not make `cas/blobs` any less the source of truth about the CAS; a manifest records what one
run asked of it. It does not add a rate to any artifact — every field is a raw count or a list,
denominators included, because the empty-denominator defect this repo keeps finding can only be caught
downstream if the counts arrive unaggregated. Here that is not hypothetical: `45 blobs / 0 manifests`
rendered as `100%` is the exact defect that kept this measure refused, and it is the harder variant, a
non-zero numerator over a zero denominator.
