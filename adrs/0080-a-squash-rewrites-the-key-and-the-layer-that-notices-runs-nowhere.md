# ADR 0080: A squash rewrites the ledger's key, and the layer that notices runs nowhere

**Status:** Accepted
**Date:** 2026-08-14
**Workstream:** P Batch 8 (the deploy ledger's two trust layers)
**Supersedes:** nothing. **Amends:** the `## S0-OPEN-2` and `## S0-OPEN-5` rows of
`artifacts/gate-s0/open-items.md` (by append; both stay CLOSED).

## Context

`artifacts/phase-2.4/presentation-deploy-ledger.json` answers new15 §14 可回滚性 line 2 —
*每次 deploy 记录 presentationDigest* — with a committed store. Each entry records five
values plus the document those values were computed from, keyed by the `commit` that
served it.

`scripts/presentation-ledger.ts` grades it in two layers, and the split is deliberate:

| layer | reads git? | what it can prove |
|---|---|---|
| `validateOffline` | no | every recorded digest recomputes from the entry's OWN stored document |
| `validate` | yes | the above, **plus** each `commit` is an ancestor of HEAD and the stored document is byte-identical to the document at that commit |

Only the git layer decides **authenticity**. The offline layer, by construction, reports
zero faults for a self-consistent forgery — a fabricated document stored together with
that document's correctly-computed digests. `packages/trust-index/test/safe-install/presentation-ledger.test.ts`
asserts that boundary plainly rather than implying CI proves more than it can.

### The fault

A squash-merge rewrites the sha. An entry recorded against the pre-squash commit becomes
an ancestor of nothing, `validate`'s git layer names it, and the repair was a hand-edit of
a JSON file whose digests must not change while one of its keys does.

This has fired **twice**: #249 and #293. Both times a human found it by running the suite
on a full clone.

### Why nothing caught it

`ci.yml`'s `test` matrix checks out with bare `actions/checkout@v6`, so `fetch-depth`
defaults to 1. Historical shas are then unknown objects, and `git merge-base --is-ancestor`
*fatals* rather than answering. `historyIsReachable(ledger)` measures exactly this and
stands the git layer down, which is what keeps the suite honest on a shallow clone — and
also means **the git layer had no automated reader anywhere in the repository.** The only
thing standing between a squash and an unnoticed dangling key was somebody choosing to run
the command locally.

## Decision

### D1: A `ledger-authenticity` job, at `fetch-depth: 0`

A second job in `ci.yml` that checks out full history and runs
`pnpm ledger:presentation:validate`. It is wired into `build-and-test`'s `needs`, with an
explicit `needs.ledger-authenticity.result` check whose failure message points at
`pnpm ledger:presentation:reseat`.

`fetch-depth: 0` is confined to this one job on purpose. The `test` matrix stays depth-1 —
making the whole matrix deep to serve one assertion would pay full-history clone cost on
three OSes for a check that needs it once.

### D2: `--reseat`, and what it may never do

`findReseat` searches `git rev-list HEAD -- <catalog>` for a commit whose catalog is
**byte-identical to the bytes the entry already stores**, then re-points only `commit`.

It never computes a new digest, never reads the working tree, and never invents a
document. A squash preserves the tree, so the bytes are found. A rebase that *edited* the
catalog does not, so the entry is **refused and reported** — with a message telling the
human not to reseat it, because an entry whose document exists on no commit is either a
forgery or a lost commit, and those want opposite responses.

The result is graded by the FULL `validate()` before anything is written. That is what
makes this a repair rather than an assertion: if re-pointing made any recorded digest stop
recomputing against its own commit, it refuses.

### D3: The refusal check runs BEFORE `validate()`, and that ordering is load-bearing

An unexplained entry is never an ancestor of HEAD, so `validate()` is guaranteed to fail
on it first. With the checks in the other order the prepared "some entries could be
reseated but others are unexplained" message was **unreachable**, and a partial repair
reported itself as a digest fault — hiding the real reason. Both branches were then
verified to have reachable inputs: EXIT 2 for the mixed case, EXIT 1 for a reseatable sha
carrying a back-dated `at`.

### D4: A `REGRESSION_CHECKS` row, because the job was a status and not a gate

This is the decision this ADR exists to record, and it was **measured, not predicted.**

With the job present in `ci.yml` and wired into `build-and-test`'s `needs`, deleting it
from that `needs` list left Gate 2.4-H **PASSED**.

`aggregatorMeasure` (ADR 0071 §3) computes `boundJobs` from the `REGRESSION_CHECKS` rows.
A job that no row names contributes nothing to `unreached` — so the new job was *a status
the required check happened to wait on*, indistinguishable from one it did not. Adding

```ts
{ id: "ledger:presentation:validate", script: "ledger:presentation:validate",
  remoteOnly: false, role: "check", workflow: "ci.yml", job: "ledger-authenticity" },
```

is what puts `ledger-authenticity` into `boundJobs`, which is what makes dropping it from
`needs` a FAILING measure. Three controls now red with three distinct messages: dropped
from `needs`, job deleted, removed from `ci:local`.

**This is ADR 0071 §3 reaching its second instance.** That section replaced "the aggregator
must survive in `Object.keys(jobs)`" with "presence **plus** `needs` covering every job any
check binds to." Until this batch every row bound to the same job, so the coverage half had
exactly one job to cover and could not distinguish a real answer from a vacuous one. The
measure was right; its **domain** was supplied by the list, and an unnamed job is outside
the quantifier rather than uncovered by it.

### D5: `remoteOnly: false`, which is what forces `ci:local` 20 → 21

The row could have been marked `remoteOnly` — the job it binds to *is* remote, and that
would have left `ci:local` at 20 steps and S0-OPEN-2's figure untouched.

It would also have been false. `remoteOnly` means a local run genuinely **cannot** prove
the check (CRLF checkout, isolated install). This fault class is fully local-reproducible:
both times it fired, a local run is exactly what proved it. So the row is `remoteOnly:
false`, membership in `ci:local` follows, and the count moves as a consequence.

The number moved because the honest value of a different field required it. Recording the
direction matters, because the tempting edit was the one that kept a count stable by
mislabelling a check.

### D6: Three count assertions were green against frozen history

`tests/invariants/gate-s0-claims.invariants.test.ts` asserts S0-OPEN-5's row count,
`remoteOnly` count, and bound count with `toContain` over the **whole row**. That row
carries this artifact's append-never-edit history, and the pre-close 2026-08-11 text says
`**19 rows**`, `of which **2** are` and `**18 bound**` verbatim, frozen there by design.

Measured on today's bytes: **all three needles are satisfied by the pre-close text alone.**
So from S batch 3 until this batch those assertions were green against preserved history,
never against the current claim — they could not have observed the live counts drifting,
because the frozen sentence kept answering for them. Adding the 20th row is what exposed
it: `**20 rows**` appears nowhere in the historical text, so the needle finally had to be
satisfied by something current.

All three are now scoped to the row's **latest** amendment.

This is [[a-pointer-rots-faster-than-its-claim]] inverted. There, the addresses expired
while the sentences stayed true. Here the sentences are deliberately immortal, so a
`toContain` over all of them measures whether a number was **ever** correct — never whether
it is correct now.

### D7: The heading loses its count, and keeps its subject

S0-OPEN-5's heading reads `Gate 2.4-H asserts 18 checks are "wired" by matching text`.
Both halves are now historical: the row CLOSED by replacing the text match with a
structural parse, so "by matching text" describes code that no longer exists, and 18 was
the bound count at the time.

The old assertion pinned the LIVE bound count into that dead clause, which had two failure
modes and no success mode — leave the heading alone and it reds on every new row, or update
it and the heading asserts a live number about a mechanism the row itself refuted. Updating
18 → 19 was the tempting edit; it would have produced a heading false in a **new** way: a
current figure certifying a superseded description.

A heading is an index entry. It names which defect the row is about, and that never
changes. The live count is asserted against the newest amendment, where it belongs; the
heading is asserted to still name its subject.

### D8: What is NOT decided here

- **`boundJobs` is still derived from a hand-maintained list.** A future `ci.yml` job that
  no `REGRESSION_CHECKS` row names will be invisible to `wired/aggregator-reachable` in
  exactly the way `ledger-authenticity` was before D4. Closing that means enumerating the
  workflow's jobs and asserting each is either needed or deliberately excluded — a
  different gate than this one.
- **The git layer still stands down on a shallow clone.** D1 gives it one deep reader; it
  does not make the depth-1 matrix able to run it.
- **`--reseat` does not decide forgery vs lost commit.** It refuses and reports. That
  judgement is a human's.

## Verification

- `pnpm typecheck` — clean.
- `tests/invariants/gate-s0-claims.invariants.test.ts` — 25/25.
- The three suites this batch touches — **106/106**.
- `pnpm eval:phase-2.4:gates:write` — regenerated; `measures` 32 → **33**, all PASSED,
  `regressionChecks` 20 with **19 bound / 1 null** (`ci:local`, by design). Re-running
  `--write` after the fact produced a **byte-identical** artifact, and `--gate` EXIT 0.
- **`--reseat` end-to-end against the real fault.** A positive control reproduced #293's
  exact dangling sha (`4774b9f3`); `--reseat` recovered `3eeb9677` unaided. `--dry-run`
  wrote nothing. The real write restored bytes **identical** to the pristine ledger. The
  refusal path named an unexplained entry and wrote nothing.
- **Negative controls, nine, each red with an accurate message:** the ledger job dropped
  from `needs`; the job deleted; the step removed from `ci:local`; the 21st `ci:local` step
  dropped (red **2** assertions — the step count and Gate H's verbatim record); the newest
  amendment's row count, `remoteOnly` count and bound count each reverted to their stale
  historical values; the newest amendment deleted outright; the defect clause stripped from
  the heading.
- **Two of my own probes were broken and are recorded as such.** A `grep -cE "^\s+→"`
  fault counter read 0 on a genuinely red run, briefly making four controls look green; and
  control A's `.replace()` changed only the first of **two** occurrences of `**20 rows**`
  in the newest amendment, so the assertion stayed satisfied by the second. Both were probe
  defects, not weak assertions — but a control that "passes" is a result to diagnose, never
  to file ([[green-negative-control-must-be-diagnosed]]).
- **One negative control's honest reading.** Replacing `findReseat`'s byte comparison with
  `candidates[0]` reds the **refusal** test but not the re-points test, because
  `candidates[0]` happens to be the correct commit today. The protective property is held
  by the refusal test alone.

## Consequences

- The squash/dangling-key class now has an automated reader for the first time. It cost one
  deep-clone job, not three.
- `ci:local` is 21 steps; S0-OPEN-2's amendment records 20 → 21 and why.
- A repair that was a hand-edit of digest-bearing JSON is now one command that refuses
  rather than guesses.
- Three previously-vacuous count assertions now read the current claim, and the pattern —
  *a `toContain` over an append-only record measures history, not state* — is worth
  checking wherever else this repository asserts prose against a value.
