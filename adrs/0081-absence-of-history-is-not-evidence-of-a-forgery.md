# ADR 0081: Absence of history is not evidence of a forgery

**Status:** Accepted
**Date:** 2026-08-14
**Workstream:** P Batch 8 follow-up (the deploy ledger's `--reseat` mode)
**Supersedes:** nothing. **Amends:** [0080](0080-a-squash-rewrites-the-key-and-the-layer-that-notices-runs-nowhere.md)'s
`findReseat`, which 0080 introduced and which this ADR gives a refusal it lacked.

## Context

0080 shipped `--reseat`: the repair for a squash-merge rewriting the sha a ledger entry
recorded. Its safety argument is that it only re-points an entry at a commit whose catalog
is **byte-identical** to the bytes that entry already stores. That argument is sound, and it
is not what failed.

`findReseat` decides an entry needs repair by `!isAncestorOfHead(entry.commit)`. That
predicate is false for a dangling entry — and equally false for a commit that was simply
**never fetched**. One boolean standing in for two causes that want opposite responses
([[a-boolean-standing-in-for-a-reason]]).

PR #295 measured the difference. `ledger-authenticity` (which 0080 gave `fetch-depth: 0`)
passed, while all three `test` matrix legs failed — a divergence that only exists because
the two jobs clone differently. Reproduced locally on a real `git clone --depth 1` of this
repo:

```
git rev-list HEAD                                    → 1
git rev-list HEAD -- <catalog>                       → 1 candidate
git merge-base --is-ancestor <historical sha> HEAD   → NOT-ANCESTOR (unknown object)
findReseat(committed ledger)                         → 9 refusals + 1 reseat
```

Both halves of that last line are wrong, and the second is the dangerous one:

- **Nine false accusations.** Entries 0–8 are authentic. The refusal text says *"its stored
  document matches NO commit on HEAD's history — this is not a squash artifact… find the
  commit that carries these bytes, or the entry is wrong."* On a shallow clone that sentence
  is false about every one of them, and it accuses a human of a forgery the evidence cannot
  support.
- **One wrong repair.** Entry 9 was **reseated** — re-pointed onto HEAD. It byte-matched
  because `record` *guarantees* the newest entry's document equals HEAD's catalog, so on a
  truncated clone the comparison always succeeds for it. The command would have rewritten an
  **authentic** pointer and called it a repair. The byte check did its job; it was asked the
  wrong question.

So `--reseat` was unsafe to run on a shallow clone, and the tests hid it: two assertions sat
*above* the `historyIsReachable` gate their own comments promised, which is the only reason
this surfaced as red CI rather than as a corrupted ledger.

## Decision

**D1. `findReseat` refuses wholesale on a shallow clone.** Not per entry, and not a
best-effort subset: when history is truncated the command returns zero reseats and one
refusal naming the cause and the fix (`git fetch --unshallow` / `fetch-depth: 0`). Absence of
evidence is neither "repair" nor "accuse" ([[absence-must-not-become-a-category]]).

**D2. The probe is `git rev-parse --is-shallow-repository`, exported as
`repositoryIsShallow()`, and is deliberately NOT `historyIsReachable()`.** The existing
helper asks "can I see every commit this ledger names", which is false under both causes.
Asking git directly about truncation is what separates them. Both are kept: they answer
different questions, and 0077's lesson was precisely that one absence read by two mechanisms
produces the wrong diagnosis.

**D3. The suite asserts the refusal on a shallow clone rather than skipping.** A skip would
leave these tests proving nothing on the only clone shape CI's matrix ever has
([[skip-on-absence-disarms-the-only-witness]]).

**D4. The branch guard gets an independent witness.** One test compares
`repositoryIsShallow()` against a probe that does not call it, and runs on both clone
shapes. See Verification for why this is not ceremony.

**D5. The matrix stays shallow.** 0080's reasoning is unchanged — one job, one full clone,
one obligation. This ADR makes the *command* honest on a shallow clone; it does not buy
history the matrix does not need.

## Verification

Measured on two real clones: this working tree (full) and a `git clone --depth 1` carrying
the same bytes. Not simulated — the depth-1 clone was created, installed, and run.

- `packages/trust-index/test/safe-install/presentation-ledger.test.ts` — **25 passed** on the
  full clone and **25 passed** on the depth-1 clone.
- `pnpm typecheck` — clean.
- `pnpm ci:local` — EXIT 0, **226 files / 3798 passed / 3 skipped**. (`✗ CallLint receipt:
  signature INVALID` appears in that output and is a tamper-detection test's own expected
  stdout, not a failure.)

**Control 1 — the shallow guard, disabled on the depth-1 clone.** `if (false && repositoryIsShallow())`:

| test | assertion that fired |
| --- | --- |
| is a no-op on the committed ledger | `expected [ { index: 9, …(2) } ] to deeply equal []` |
| re-points a dangling entry | `expected [ { index: 9, …(2) } ] to deeply equal []` |
| REFUSES an entry whose stored document exists on no commit | `expected [ …(10) ] to have a length of 1 but got 10` |

The first two print the fault this ADR exists to remove: `index: 9`, the authentic newest
entry, being reseated. Restored byte-identical (`7b4fd916d199f4cd`).

**Control 2 — and it is why D4 exists.** Forcing `repositoryIsShallow()` to `return true` on
the **full** clone left all 24 tests **GREEN**. That is a green negative control, and a green
control must be diagnosed rather than accepted ([[green-negative-control-must-be-diagnosed]]):
every full-clone assertion had quietly moved into the branch that no longer ran, so a single
wrong boolean could disarm the entire describe with nothing red. The suite was measuring the
guard's opinion of the clone instead of the clone. D4's independent witness is the repair —
re-running the same control now fails with `expected true to be false`, and the count moved
24 → 25.

That second control is the finding here. The first only confirmed the bug I had already
measured; the second found a second, quieter one in the fix itself.

## Consequences

`--reseat` can no longer corrupt a ledger when run from a CI checkout, a `--depth 1` clone,
or any truncated working copy, and it says why instead of accusing. The `test` matrix goes
green without gaining a full clone, so 0080's cost argument survives intact.

`historyIsReachable` keeps its remaining callers: the *validation* tests still branch on it,
where "can I see these commits" genuinely is the question. This ADR narrows where a single
boolean is allowed to stand for a cause, it does not delete the helper.

What is **not** decided: whether `record` should also refuse on a shallow clone. It reads
only HEAD, so it is correct there today — but the same conflation would appear the moment it
consults an older commit, and nothing currently guards that.
