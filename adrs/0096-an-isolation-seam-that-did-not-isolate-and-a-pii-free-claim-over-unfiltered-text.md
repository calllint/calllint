# ADR 0096 — An isolation seam that did not isolate, and a "PII-free" claim over unfiltered text

- Status: Accepted
- Date: 2026-09-01
- Supersedes: nothing. Amends `scripts/gate-s1.ts`, `scripts/gate-s2.ts`,
  `packages/trust-index/src/fetchRegistry.ts`, and two pointer pins.

## Context

Fixing ADR 0094 — both run-artifact writers refused every write for the whole life of the
project — created the project's first `reports/` and `cas/manifests/` files. That immediately
redded **11** tests in the two gate invariant suites.

None of the 11 were testing the new writers. They redded because writing a run report was the
first event in the project's history that made three latent claims observable.

## Decision

### D1 — `ADOPTION_INDEX_CWD` is an exclusive override, not a preferred candidate

Both gates enumerate candidate store roots, because `.var/`'s location follows `cwd` and the
worker's `cwd` is not the repo root. Both *prepended* `ADOPTION_INDEX_CWD` to that list and then
picked the newest report **across all candidates**.

So a caller that named a store could be answered by a different store — whenever the other
store's report was newer. That is the same mis-rooted read the seam's own docblock was written
about, one level up: S1's first version read only the repo root and reported "the rolling
compiler has not run against this checkout" while a 2.5 MB database sat in
`packages/trust-index/.var/`.

The docblock cited `pruneCas.ts:59` and `backupAdoptionIndex.ts:52` as its authority and then
diverged from them. All four production seams read:

```ts
const cwd = (process.env.ADOPTION_INDEX_CWD ?? "").trim() || process.cwd()
```

`||` — exclusive. `pruneCas` sweeps one directory and cannot be redirected by a second store
existing elsewhere. The gates now match the convention they cite.

**Nine of the 11 reds were this.** Nine tests built a fixture store, pointed
`ADOPTION_INDEX_CWD` at it, and asserted against it. Their comments claimed isolation —

> `ADOPTION_INDEX_CWD` points the gate at a store this test creates, so the only input is the fixture

— and that sentence was false from the day it was written. It could not be observed to be
false, because every `reports/` on every machine was empty (ADR 0094), so there was nothing to
leak. **A guard whose isolation is never tested by contact with a competing input is not
isolated; it is merely unchallenged.** CI will never catch this class: `.var/` is gitignored and
every runner is cold.

### D2 — a PII-free field set is not a PII-free value

`toSnapshotEntry` has claimed "normalize to the PII-free subset" since commit one, and
`fetchRegistry.ts:10` says it drops "publisher contact". Both are true of the **fields** it
selects and false of their **contents**: `description` is upstream free text, copied verbatim.

`ai.byteray/byteray-mcp` published `"… Hosted, OAuth + SSO, invite: hi@byteray.ai"`. It entered
the cohort among the 50 newly admitted this run, and the address reached
`apps/web/public/install/mcp-registry/ai.byteray-byteray-mcp/index.html` and `index.json`.

`check:public-copy` #17 caught it — the last guard before publication, and by then the only one
that could still see it. Every upstream-facing layer had already declared the value PII-free.

The boundary now redacts email-like tokens (`[contact redacted]`) at the point where the
PII-free claim is made. **Redacted, not dropped:** the description is a page's only
human-readable summary, and discarding the field to remove one token would degrade 199 clean
pages to defend against a rare one. The marker is visible, so the redaction is auditable rather
than silent.

The regex is byte-identical to `claim.ts:79` and `check-public-copy.mjs:439`. Three copies is
deliberate — each defends a different plane (store, boundary, served bytes), and a shared import
would let one edit retire all three at once.

Positive and negative fixtures per the contract, and **the negative is the load-bearing one**: a
redactor that ate `@scope/pkg@1.2.3` or `@maintainer` would quietly damage ordinary text. The
negative control confirmed only the positive test reds when the redactor is neutered.

### D3 — the remaining reds were an unfinished pipeline, and stay red until it finishes

Two reds said committed source records had no served page — 50 of them for S1, 5 for S2. Not
test defects: the ingest advanced the snapshot 150 → 200 while the served tree was still at 150.
The fix was to run the rest of the chain, not to touch the expectation. After
`project` → `bake` → `sync`, `source-completeness` reads 200/200 and both gates hold.

A gate that reds on a half-finished pipeline is the gate working. Recording it here because the
temptation at 3 remaining failures is to treat the number as the target.

### D4 — two more coincidences the cohort separated

Growing the cohort 150 → 200 split two further pairs of quantities that had been equal since the
corpus existed. Both are the same mistake as D1/D2 in miniature: an assertion that named one
quantity and measured another, correct only while the two could not differ.

**A per-package count standing in for a per-subject population.**
`refresh-artifacts-e2e` partitioned compiled records by `CORPUS_FETCHABLE` — the number of
fetchable npm *packages* (37). But the record layer publishes one record per *subject* and selects
**one** artifact for it: `persistAll` takes `artifacts.find(a => a.subjectId === …)`, the first
stored row, and `artifact_versions` holds a row per declared package **in declaration order**. So a
subject gets bytes only when its *first* declared package is fetchable.

Cohort 200 admitted `ai.bourdon/bourdon` and `ai.bowmark/bowmark`, both declaring `pypi` first and
`npm` second — the first subjects ever to declare a non-npm package ahead of an npm one. 37 packages,
35 subjects with bytes. `CORPUS_FETCHABLE` stays as it was and remains right for all ~30
artifact-plane assertions (37 tarball calls, 37 CAS blobs, 37 FETCHED rows), which is the evidence
that the constant was not simply wrong: it was correct about packages and was being asked about
subjects. The new constant derives the selection rule instead of restating the fetch rule, and the
test now also asserts the two **differ**, so a corpus that reverts to one package per subject cannot
silently stop discriminating.

The file's own docblock says *"THERE ARE THREE NUMBERS HERE, NOT TWO, AND AT COHORT 25 THAT WAS
INVISIBLE"* — written when cohort 100 split declared from fetchable. There were four.

**A substring scan standing in for a field check.** `committed-install-tree` asserted the discovery
manifest `not.toContain("score")` — meaning "carries no score *field*", implemented as a raw-text
scan. Cohort 200 admitted `ai.certscore/mcp`, and the vendor's own name redded a closed-projection
test while the projection was closed. Now asserted over recursed keys plus an exact key set per
resource entry, which states the rule and cannot be tripped by a canonical name.

**A dated figure asserted as a live one.** The S2 record's `**Cohort at creation:** **150**` was
re-derived from the current snapshot and required to match it. The only way to satisfy that after
the cohort moved was to rewrite the record's own history. Creation is now pinned as a literal — if
it changes, someone edited history and it should red — and `**Cohort now:**` carries the derived
figure.

### D5 — the pointer pins drifted, as designed

Three content-anchored pointers moved when these docblocks grew (`gate-s1.ts:203→214`;
`gate-s2.ts:186→187`, `483→484`, `348→349`; `fetchRegistry.ts:268→297` and `263→292` in the S0 suite,
both from `redactPii`'s +29 lines). Twelfth recorded drift for the S-suites, tenth for S0. Each red named the line it
actually read (`"  readonly status: string"`, `" */"`), which is the whole difference between a
content anchor and an `existsSync` check that a blank line satisfies.

## Consequences

- A gate invocation that names a store reads **only** that store. Isolation in the nine tests is
  now real rather than incidental.
- No email-like token can reach a served page through an upstream description. The claim in
  `toSnapshotEntry`'s docblock is now implemented rather than asserted.
- `cas-dedup-rate` and `adapter-failure-rate` are **MEASURED for the first time in the project's
  history**, from run `sha256:6a931d6a50b9…`. ADR 0093 predicted the first would be "unrun"; ADR
  0094 corrected that to "unrunnable"; this run is where it became measured.
- The cohort ratchet advanced `S0_REGRESSION_FLOOR` 150 → 200, written by the ingest. The floor
  matches the cohort rather than leading it, which is what keeps it a record of achievement.
- `ai.buywhere/buywhere-mcp` left the cohort as **1 withdrawn upstream** — ADR 0095's decision
  executing against real data, on the success path, with the run committing.

## What this pair has in common

Both defects are a claim that outran its implementation, and both were invisible for the same
reason: **nothing had ever supplied the input that would contradict them.** An empty `reports/`
made nine isolation claims untestable. A cohort with no address in any description made a
PII-free claim look enforced. Neither guard was wrong about its subject — each was simply never
handed the case it existed to refuse.

The repo's standing fault class is "a guard that cannot observe its subject." This is its
sibling: a guard whose subject had never yet occurred. The remedy is the same — supply the input
deliberately, in a test, rather than waiting for production to supply it.
