# ADR 0082: A refusal must not be mistakable for a pass

**Status:** Accepted
**Date:** 2026-08-15
**Workstream:** P Batch 8 follow-up — closing [0081](0081-absence-of-history-is-not-evidence-of-a-forgery.md)'s carried open item
**Amends:** [0081](0081-absence-of-history-is-not-evidence-of-a-forgery.md), which gave `findReseat`
a shallow-clone refusal and left the same question open for the rest of the git layer.

## Context

0081 closed with: *"What is **not** decided: whether `record` should also refuse on a shallow
clone. It reads only HEAD, so it is correct there today — but the same conflation would appear
the moment it consults an older commit, and nothing currently guards that."*

**That premise is false, and measuring it is what this ADR is for.** `record` does not read only
HEAD. It calls `validate(next)` before writing (`scripts/presentation-ledger.ts:502`), and
`validate` runs `gitFaultsForEntry` over **every** entry plus `gitFaultsForChain` over the whole
chain. Both key on ancestry. So the conflation 0081 fixed in one function was live in three callers
the whole time — the default CLI mode, `record`, and `reseat`'s write-time re-grading at line 651 —
not waiting on some future change.

Measured on a real `git clone --depth 1 --branch main` of `02288fd2`, ten authentic entries:

```
repositoryIsShallow()                → true
historyIsReachable(ledger)           → false
validateOffline(ledger, live)         → 0 faults
gitFaultsForChain(ledger)             → 9 faults
validate(ledger)  ← what record calls → 19 faults
pnpm ledger:presentation:validate     → EXIT 2, ten entries accused
```

Every one of those 19 is false. The text is *"deploys[N] (dc7c81c7): not an ancestor of HEAD — a
deploy record for a document this branch never had"*, printed about entries that are authentic
and reachable on a full clone. It is 0081's fault class in a different function: one boolean
standing in for both *truncated* and *forged* ([[a-boolean-standing-in-for-a-reason]]).

This half fails **closed**, which is why it never corrupted anything — no write happens, so it is
strictly less dangerous than `--reseat`'s wrong repair. But the sentence still accuses a human of
a forgery on evidence that cannot support it, and that is precisely what 0081 D1 forbids. It also
makes `record` unusable on any truncated checkout for a reason unrelated to the entry it is adding.

### The trap in the obvious fix

The obvious repair — return no faults when the clone is shallow — is **worse than the bug**.
`ledger-authenticity` is the git layer's only automated reader (0080), and its only protection is
one `fetch-depth: 0` line. Make `validate` silently pass on a truncated clone and deleting that
line leaves the job **green while verifying nothing**. A false accusation would become a false
reassurance, and the second is undetectable ([[absence-makes-a-gate-skip-itself]],
[[skip-on-absence-disarms-the-only-witness]]).

So this cannot be a two-way split between "faults" and "no faults". The refusal has to be a third
outcome that no caller can read as success.

## Decision

**D1. The git layer refuses at its chokepoint, `validate`, not in `record`.** Both git-layer
functions reach every caller through `validate`; guarding `record` alone would leave the default
CLI mode and `reseat`'s post-repair grading still accusing. One guard where the layer is entered,
not one per entry point.

**D2. The refusal is a distinct outcome, never an empty fault list.** `validate` returns a
discriminated result — `{ kind: "checked", faults }` or `{ kind: "refused", reason }` — so
"nothing was wrong" and "nothing was checked" cannot be spelled the same way. A caller that
ignores `kind` does not compile.

**D3. A refusal exits NON-ZERO (3), with a message naming the cause and the fix.** Exit 3 is
distinct from 2 (real faults) so CI, humans, and future scripts can tell "your ledger is broken"
from "this clone cannot answer the question". `ledger-authenticity` therefore still fails if its
`fetch-depth: 0` is ever removed — the guard cannot be disarmed by truncating the clone, which is
the property D2's shape exists to protect.

**D4. `--offline` keeps passing on a shallow clone, unchanged.** It is the mode that honestly
claims less: it prints *"ancestry and authenticity NOT checked"* and grades only recomputation
from stored bytes. A caller with a depth-1 checkout has a correct mode available, so D3 costs
nothing it should not cost. `deploy-web.yml` continues to use it.

**D5. `record` inherits the refusal rather than implementing one.** On a truncated clone it now
stops with the named reason instead of nineteen false accusations. It gains no shallow-specific
code, which is the point: 0081 fixed one function and the class survived in three callers, so
this fix goes where the reads happen.

**D6. Test branch guards ask an independent probe; `repositoryIsShallow` appears only as a
subject.** The tests decide which branch to run via `cloneIsShallow()`, which reads `.git/shallow`
and `git rev-parse --is-shallow-repository` directly, never via the function under test. The two
probes are tied together by exactly one assertion — `expect(repositoryIsShallow()).toBe(cloneIsShallow())`
— and it is the only test in the file that runs on both clone shapes. If the code's probe and the
tests' probe ever disagree, meaning the grader refuses on the wrong shape, that single test fails;
without it the disagreement is invisible, because each side would simply take its own branch and
pass. Control 2 below is the measurement that forced this decision, and 0081 D4 is the reason it
had to be stated as a rule rather than left as a habit.

## Verification

Measured on two real clones — this working tree (full) and a `git clone --depth 1 --branch main`
carrying `02288fd2` — not simulated.

- `packages/trust-index/test/safe-install/presentation-ledger.test.ts` — **28 passed** on the full
  clone, **28 passed** on the depth-1 clone (both re-measured after the D6 decoupling below).
- `pnpm typecheck` — EXIT 0.
- `pnpm ci:local` — EXIT 0, **226 files / 3801 passed / 3 skipped**. Two `✗` lines appear in that
  output and neither is a failure: `✗ CallLint receipt: signature INVALID` is printed by
  `apps/cli/src/commands/receipt.ts:259` on input a test tampered with on purpose, and
  `✗ detectorCount: facts=113 code=13` is `scripts/derive-facts.mjs:77` reporting drift inside
  `tests/facts/deriveFacts.test.ts:54`, which writes `13 + 100` into a temp copy specifically to
  assert the guard exits non-zero. Both are negative controls printing their own evidence
  ([[subprocess-negative-control-prints-fail]]).

CLI behaviour, both shapes:

| clone | command | before | after |
| --- | --- | --- | --- |
| depth-1 | `validate` | EXIT 2, 19 false accusations | EXIT 3, one named refusal |
| depth-1 | `validate --offline` | EXIT 0 | EXIT 0 (unchanged) |
| depth-1 | `record` | 19 false accusations, no write | refusal, no write |
| full | `validate` | EXIT 0, 10 entries | EXIT 0, 10 entries (unchanged) |

**Control 1 — the refusal removed, on the depth-1 clone.** Deleting the `repositoryIsShallow()`
branch from `validate` restores EXIT 2 with `deploys[0] … not an ancestor of HEAD` — the false
accusation this ADR exists to remove. Restored byte-identical.

**Control 2 — the refusal forced on the FULL clone. It failed the first time, and that is the
most useful measurement in this ADR.** Forcing `repositoryIsShallow()` to return `true` on a full
clone reded **1 of 28** tests. One red is what a working control looks like if you only ask
"did something go red", so the number is worth stating: 27 assertions had moved into a branch that
could no longer execute. Cause: writing these tests I keyed their branch guards on
`repositoryIsShallow()` — the function under test — so forcing the probe flipped the tests and the
code *together*, and each side quietly took the matching branch. That is 0081 D4's own fault class
reappearing one ADR later, in the file that was supposed to have learned it: D4 added an
independent probe, but only a single assertion ever used it
([[a-branch-guard-must-not-ask-its-own-subject]]).

After D6 below, the same forcing reds **8 of 28**, with four distinct assertion texts —
`expected 'refused' to be 'checked'`, `expected 3 to be +0`, `expected true to be false`,
`expected [] to deeply equal [ 9 ]` — across the committed-ledger git-layer test, the
`validate` ⊇ `validateOffline` superset test, five `--reseat` tests, and the CLI exit-status test.
Seven assertions that had been unreachable are reachable again.

**Control 3 — the silent-pass shape, rejected by measurement.** Implementing D2's alternative
(refusal spelled as `faults: []`) makes `pnpm ledger:presentation:validate` print *"deploy ledger
OK — 10 entries"* and **EXIT 0** on a depth-1 clone. That is the false reassurance in D1's
rationale, reproduced deliberately to show the discriminated result is load-bearing rather than
stylistic. Reverted.

## Consequences

The git layer can no longer accuse anyone on truncated history, and — the part that matters more
— it cannot go quiet either. Removing `fetch-depth: 0` from `ledger-authenticity` now fails that
job with exit 3 instead of passing it vacuously, so 0080's single-full-clone design is protected
by a check rather than by a comment.

0081's open item is closed, and its stated reason for leaving it open is recorded here as
falsified: the guard was needed at the time it was deferred.

What is **not** decided: `historyIsReachable` still exists and still answers "can I see every
commit this ledger names". Its remaining callers are the validation tests, where that genuinely is
the question. This ADR does not merge the two probes — 0081 D2's argument for keeping them
distinct stands.
