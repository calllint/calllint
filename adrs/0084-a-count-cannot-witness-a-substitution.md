# ADR 0084: A count cannot witness a substitution

**Status:** Accepted
**Date:** 2026-08-16
**Workstream:** S0 ratchet integrity — the identity axis
**Amends:** [0083](0083-a-ratchet-under-a-requirement-cannot-follow-the-cohort.md), which fixed the
same ratchet's *magnitude* axis and left this one unmeasured.

## Context

The re-ingest that closed S0-OPEN-4 moved the committed cohort 25 → 100. Regenerating
`artifacts/phase-2.4/gate-A-consistency.json` at the new cohort surfaced something the ingest was
not supposed to be able to do: a subject **left**.

`agency.goji/goji` was `status: active` in the 2026-08-10 snapshot and is absent from upstream in
the 2026-08-15 snapshot. Its six served files were removed by the bake.

**It is not a cap eviction, and that distinction is the whole finding.** The cohort comparator sorts
by name ascending, and `agency.goji/goji` sorts **second of 100**. A cap raised from 25 to 100 can
only ever evict from the *tail*; it cannot reach position 2. So this is a real upstream de-listing —
the publisher pulled it, or upstream unpublished it — not a selection artifact.

`pnpm gate:s0:regression` exits **0** with that record gone. Measured on this branch, not supposed.

## Why the ratchet cannot see it

`cohortRegressed` is a **count comparison**:

```ts
const cohortRegressed = censusRegistry < S0_REGRESSION_FLOOR   // gate-s0.ts:611
```

One record lost against 76 gained nets **+75**. The count rises, so the predicate is false, so the
gate is green. The arithmetic that hides a deletion is the same arithmetic that reports growth:

| | prev | now | net |
|---|---|---|---|
| cohort size | 25 | 100 | **+75** |
| names lost | — | 1 | invisible |
| names gained | — | 76 | reported |

A count-only ratchet reds only when `lost > gained`. Up to **76** de-listings could have hidden
behind this single ingest, and a mixed ingest — one that adds as many as it drops — is invisible at
any scale.

**Three other guards were positioned to catch this and did not**, each for its own reason. This is
the part worth recording, because "we have reproducibility gates" is exactly the reasoning that made
the gap feel covered:

1. **The reproducibility byte-comparison.** It re-renders the served tree from the committed snapshot
   and byte-compares. A de-listing removes the subject from *both* sides, so the two agree perfectly.
   The gate is working correctly and is structurally blind: it asks *"do the bytes match the
   snapshot"*, never *"is the snapshot missing something it used to have."*
2. **Git's own diff.** The bake's file removals were rendered as a **rename** into
   `ai.arketo-arketo` — a subject that entered in the same ingest. Nothing looked deleted; the file
   *set* stayed coherent, so no file-count or file-existence check moved.
3. **`INV-R5`'s reconciliation.** It reconciles `total = snapshot + fixtures` and passes at any
   cohort size, because it re-reads the same snapshot it is reconciling against
   ([[audit-keyed-on-its-own-subject]]).

## What already exists, and where it is wired

The machinery to do this correctly is already in the repo, is already correct, and is already
tested — it is simply on the wrong path:

- `refreshFromMirror` computes `absentFromSource` as a **set difference** over stored subjects
  (`refreshFromMirror.ts:275`), then tombstones via `planWithdrawal` / `applyWithdrawal`. Its
  docblock even states the reason a set difference is required: the store is append-only, so its
  memory of a withdrawn subject outlives the withdrawal and *"nothing else in the run can notice the
  absence."*
- That path is the **compiler/mirror** path. The ingest that produced this cohort took the
  `fetchRegistry` → snapshot → bake path, which has **no withdrawal concept at all**.

So the two ingest paths disagree about what a disappearance means, and only one of them is wired to
what we actually serve. This is [[assert-which-source-answered]] at the level of a whole subsystem:
the question *"was a subject withdrawn"* has two answers in this repo depending on which path you
ask, and the serving plane asks the one that cannot answer.

## Decision

### D1: The ratchet gains an identity assertion, keyed on names and not on counts

`--regression` compares the committed snapshot's **name set** against the name set in the
**previous revision of that same file**, and reds on any name present then and absent now. The
message names the lost subjects.

Counts stay exactly as they are. `cohortRegressed` is not replaced — a shrinking count and a
substituted identity are different faults with different messages, and collapsing them into one
boolean is the [[a-boolean-standing-in-for-a-reason]] shape. D1 adds a second, independent witness.

### D2: The record is git history, not a new state file

The snapshot is **committed**, so every cohort we ever served is already recorded in the history of
one file. The guard reads `git show <prev>:<snapshot>`; it does not introduce a
`previous-cohort.json` for the ratchet to compare against.

This is deliberate. A committed "names we served last time" file is a second copy of a fact the
repository already stores, and a second copy is a second thing that can be edited to make a red go
away. History cannot be edited by the commit under test.

### D3: The guard lives on the one job with full history, and stands down loudly

A history-reading check on a depth-1 clone sees no previous revision. ADRs 0081 and 0082 are this
repo's record of that exact hazard: absence of history read as evidence of a fault, then a refusal
mistakable for a pass.

So D1's git layer runs in **`ledger-authenticity`** — the single `fetch-depth: 0` job, already in
`build-and-test`'s `needs`. Where history is unreachable the check returns an explicit
**refusal** (0082's `{kind: "refused"}` shape), never a silent pass: a run that could not measure
must not print the same thing as a run that measured and found nothing.

`S0_REGRESSION_FLOOR` and `S0_REQUIRED_RECORDS` are untouched. No requirement or ratchet value moves
in this ADR; it adds a witness, it does not re-tune a threshold.

### D4: A de-listing is a REPORTABLE event, not automatically a failure

A publisher pulling their server is legitimate and will happen again. What is illegitimate is it
happening **unobserved**. So the red is a *demand for acknowledgement*, not a claim of wrongdoing:
an ingest that drops a subject must record which subject and why, and the ADR-0075 reserved-name
retention remains the separate, stronger rule for subjects that may never be dropped at all.

`agency.goji/goji` is acknowledged here as the first such event: **de-listed upstream between
2026-08-10 and 2026-08-15, six served files removed, no action required beyond this record.**

## Consequences

- A mixed ingest that adds 76 and drops 1 now reds, naming the dropped subject.
- The guard is only as good as its host job's history depth, which is why D3 pins it to the depth-0
  job and makes unreachable history a refusal. A future move of this check onto the matrix would
  silently disarm it — that is the failure mode to watch for, and it is the reason this paragraph
  exists.
- Counts and identities are now separate witnesses with separate messages. Neither subsumes the
  other: a same-size substitution is invisible to the count, and a shrink with no substitution is
  invisible to the name set only if nothing was renamed.
- The compiler/mirror path's withdrawal machinery is still not wired to the serving plane. D1 detects
  the event; it does not tombstone the subject. Unifying the two paths is a larger change and is
  **explicitly left open** rather than half-done here.

## Open

- **S0-OPEN-6 (new):** the `fetchRegistry` → snapshot → bake path has no withdrawal concept, so a
  de-listed subject is *detected* by D1 but never *tombstoned*. `refreshFromMirror`'s
  `absentFromSource` → `planWithdrawal` chain is the intended mechanism; wiring the serving plane to
  it means deciding whether a de-listed Trust Page should 410, tombstone in place, or vanish — a
  product judgement, not a mechanical one, and it is unanswered.

## Verification

Implemented in `scripts/cohort-identity.ts` (the witness) and `scripts/gate-s0.ts` (a third enforcing
mode, `--identity`), hosted on `ledger-authenticity` per D3. **Eleven controls, all behaving as
required.** Each red names its own subject, per this repo's standing rule
([[negative-control-validity-checklist]], [[green-negative-control-must-be-diagnosed]]).

Controls C1–C6 and C8 ran in an isolated fixture repo with a synthetic 10-name cohort; C7 and C9–C11
ran against **this** repository's real 100-record snapshot.

| # | mutation | required | observed |
|---|---|---|---|
| C1 | drop one name, add one — **count unchanged** | reds naming the lost name while `prev == cur` | ⚠ `LOST: pub.03/srv`, `prev=10 cur=10` |
| C2 | drop one, add none (count falls) | reds naming the lost name | ⚠ `LOST: pub.07/srv`, `10 → 9` |
| C3 | add names only | **green** — growth is never a fault | ✓ `lost=[] gained=[pub.aa/x, pub.bb/y]` |
| C4 | `entries` keyed `serverName` | **refuses** — a partial name set is vacuous | ◇ `2 entries but only 0 usable name values` |
| C5 | no `entries` array | **refuses**, naming the keys it did find | ◇ `found keys [schema, servers]` |
| C6 | substitute 5 of 10, count unchanged | reds naming all five | ⚠ 5 lost, `prev=10 cur=10` |
| C7 | depth-1 clone (D3) | refusal **textually distinct from a pass** | ◇ `SHALLOW CLONE… REFUSAL, not a pass`; tells the operator `fetch-depth: 0` |
| C8 | reserved name dropped (D4) | the **0075 retention rule**, not D1's message | D1 reports the loss; its output contains no `reserved`/`retention`/`0075`. `registry-cohort-retention.invariants.test.ts` — **9 passed** — owns that input |
| C9 | count-neutral substitution on the **real** cohort, unacknowledged | `--identity` **EXIT 2** | EXIT 2: `ag.hood/name-service` … `count is 100 and the floor is 100, so the ratchet is green and CANNOT see this` |
| C10 | same repo, `--regression` | prints the loss, **claims no enforcement** | prints ⚠ + `NOTE: reported, not enforced in this mode`; ratchet says `floor 100 (held)` |
| C11 | depth-1 clone, both modes | `--identity` EXIT 2; `--regression` EXIT 0 | as required — same measurement, different host, different verdict |

**C1 and C9 are the load-bearing pair.** Both hold the count constant, so `censusRegistry <
S0_REGRESSION_FLOOR` is false and the pre-0084 gate **cannot** red on either. C9 does it on the real
snapshot: cohort 100, floor 100, ratchet explicitly `(held)`, and `--identity` still exits 2 naming the
subject. That is what distinguishes "D1 added a witness" from "D1 is a second copy of the count".

### Three defects the controls found, and what each changed

1. **The controls first red for the wrong reason.** C1–C3 all refused with `at aa6c8b34: 2 entries but
   only 0 usable name values` — C4's malformed snapshot had been committed and became their *previous
   revision*. The controls were reading a poisoned baseline, not exercising their mutations. Fixed by
   giving every control its own branch off one pristine baseline. Inverse of
   [[green-negative-control-must-be-diagnosed]]: a red is not evidence until you read *why*.

2. **C9's first run was green, and was right to be.** The clone was made from `HEAD`, but the
   implementation was uncommitted working-tree state — so the control measured the **pre-0084** gate
   and correctly reproduced the blind spot this ADR exists to close. An accidental, faithful
   replication of the original fault.

3. **`--regression` enforced identity too, and the note that said otherwise never printed.** Enforcing
   in both modes gives one assertion two meanings by clone depth: unenforceable on the depth-1 matrix
   (where the check can only refuse), red on a developer's full clone — and one fault redding two jobs.
   Removed. The explanatory note then still didn't appear, because it sat after that branch's
   `if (!allOk)` early exit: an unrelated red (vitest failing to collect) suppressed it. **A report that
   depends on other assertions passing is not a report.** Moved to the unconditional print block.

Also measured, and it is why `--identity` is a separate mode rather than a step on the matrix: under
`--regression` on CI the check can *only* return `refused`, so wiring enforcement there would have been
a step with no failing mode — this ADR's own defect, reintroduced by its guard.
