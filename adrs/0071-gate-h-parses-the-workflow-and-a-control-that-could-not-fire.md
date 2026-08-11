# ADR 0071 — Gate 2.4-H parses the workflow, and one of its negative controls could not fire

- **Status:** Accepted
- **Date:** 2026-08-11
- **Workstream:** S (Gate S0 / adoption-index status record)
- **Batch:** S batch 3
- **Supersedes:** nothing. **Amends:** nothing in ADR 0070; extends ADR 0069 §3 (two probes, two
  failure modes) to a second gate.
- **Closes:** S0-OPEN-5.
- **Leaves open:** S0-OPEN-1, S0-OPEN-4.

## §1 Numbering: 0071, and 0060 remains reserved

`ls adrs/` tops out at `0070`. **0060 is still not available** — its reservation is held by name for
the `propertyNames` defect in `artifacts/phase-2.4/presentation-plane-audit.json:135`, whose
`$comment` says so verbatim, and a gate in `pnpm ci:local` reads that reservation. Re-listed rather
than inferred from the ADR that says so, per `proposed-file-map.md`'s standing instruction.

## §2 Context: 18 claims resting on one text match

Gate 2.4-H graded whether each row of `REGRESSION_CHECKS` is "wired" to CI by two regexes over the
workflow's **bytes**:

```ts
const bound = new RegExp(`run: pnpm ${escapeRe(c.script)}\\s*$`, "m").test(wfSrc)
  && new RegExp(`^  ${escapeRe(c.job)}:$`, "m").test(wfSrc)
```

The subject and the claim were different propositions:

```
subject: the string `run: pnpm X` appears in ci.yml, and a line reads `  test:`
claim:   check X runs in CI
```

Everything between them was invisible. S batch 2 proved that is not hypothetical: `ci.yml` went in
with an unquoted `- name: Gate S0 (regression: …)`, the file became unparseable, and GitHub started
**zero jobs**. Applied to those exact bytes, Gate H reported all 18 rows bound and the required
aggregator present. ADR 0070 §10 recorded the general shape — an unparseable workflow contributes no
check runs, so a required check stops **existing** rather than going red. Gate H was the largest
remaining instance in the repository by row count.

## §3 Decision: two probes, and their disagreement is a third fault

`observeGateH` now parses each workflow **once** with the pinned root `yaml@2.8.2` devDependency
(`readWorkflowGraph`, `scripts/phase-2.4-gates.ts:733`, cached per file — 19 rows name the same
file) and resolves each binding structurally in `bindCheck` (`:783`):

| condition | `workflowBinding` |
|---|---|
| the file does not parse | `null`, fault names the **parser's message** |
| `jobs[c.job]` is not an object | `null`, fault names the missing job |
| no `jobs[c.job].steps[].run` contains `pnpm <script>` as a whole token | `null`, fault names the missing step |
| the two probes **disagree** | `null`, fault names **the disagreement itself** |
| both hold | `` `${c.workflow}#${c.job}` `` — byte-identical to before |

The text match is kept as a **precondition**, not replaced, for the reason ADR 0069 §3 gives: a
parse alone goes green when a step is renamed away; a scan alone goes green when the file cannot run.

The fourth row is the part S0-OPEN-5's own "shape of the fix" did not specify. When the two probes
differ, **neither answer may be adopted** — a disagreement means one probe is reading something the
runner does not, and that is an independent failure mode rather than a tie to be broken. Controls
#184 and #185 exercise both polarities, and both are real defects: a deleted step whose text
survives in a comment, and a step rewritten as a folded scalar so the literal disappears while the
runner's behaviour is unchanged.

## §4 `WiredCheck` gained a required field — a deviation, and why

The plan for this batch said leave `WiredCheck`'s shape alone so consumers need no change. It gained
`readonly bindingFault: string | null` (`packages/trust-index/src/phase24Gates.ts:493`) anyway.

**Required, not optional.** An optional field lets a construction site stay silent and still
typecheck ([[optional-field-defeats-source-guards]]), and silence is precisely the defect being
repaired: 18 rows recited *"bound to no workflow job — only `ci:local` runs it"*, a true sentence
that named the wrong cause, while the real cause was that the file contributed no jobs at all. A
fault that can be omitted will be omitted by the next producer, which is the failure this row exists
to close.

The cost is bounded and was measured: `workflowBinding`'s type is unchanged, its one decision-making
consumer (`:585`) is unchanged, and the artifact's **18 bound / 1 null** split is byte-identical
across the change — confirmed by digest (`574d0cd2a666de4b`, HEAD vs worktree), not by eye.

## §5 The aggregator is asserted by `needs`, because `if: always()` is deliberate

S0-OPEN-5's shape said *"the required aggregator must survive in `Object.keys(jobs)`"*. Measured, on
today's bytes:

```
test            runs-on="${{ matrix.os }}"  needs=null      job.if=null       steps=27  step-if=0
build-and-test  runs-on="ubuntu-latest"     needs=["test"]  job.if="always()" steps=1   step-if=0
```

`build-and-test` runs **even when `test` is red**, then fails itself by reading `needs.test.result`.
So asserting that it "runs unconditionally" would assert something false, and asserting mere presence
would miss the real hazard: a job that no required check waits on blocks nothing.
`wired/aggregator-reachable` (`phase24Gates.ts:553`) therefore asserts presence **plus** `needs`
covering every job any check binds to, with the aggregator itself carved out — it cannot need itself.
Control #187 (`needs: []`) reds on exactly that claim while the 18 bindings stay bound.

## §6 What the structural probe does NOT see, measured rather than assumed

The probe reads `jobs[job].steps[].run`. It does not evaluate `if:` expressions, `runs-on`
availability, matrix exclusions, or reusable-workflow indirection.

**Control #186 measured the largest of those gaps: adding `if: false` to `jobs.test` leaves Gate
2.4-H green.** The syntax is legal, `steps[].run` is untouched, so both probes remain satisfied while
no step would execute. This is recorded as a known, measured gap and not papered over. Closing it
would mean evaluating GitHub's expression language — a materially larger subject than this row, and
one where a partial evaluator would be worse than none, because it would license the belief that the
gap is closed.

What the batch *did* close is the failure mode that actually fired in production bytes: a file the
runner rejects outright. Between "the file parses and the step exists" and "the step will run" there
remains an `if:`-shaped hole, now named.

## §7 The denominator moved with the measure

`decideGate(measures, 4 + checks.length + served.length)` → `5 + …` (`phase24Gates.ts:711`).
`measures` went 30 → 31 (5 roll-up + 19 checks + 7 served).

A denominator feeding only `<` has no failing mode of its own
([[miscounted-denominator-is-a-false-green]], [[a-gate-that-cannot-pass-on-success]]), so it was
synced in the same edit that added the measure rather than in a follow-up. §8 records what happened
when the batch tried to give it a control.

## §8 Negative controls, and the one that could not fire

Applied to **source or artifact, never to a test**; backed up with `cp` to `/d/tmp/*.bak` and
restored from that copy, each verified byte-identical (never `git checkout --`). A positive control
ran first, so a red could not be a broken importer.

| # | mutation | required failure | result |
|---|---|---|---|
| 183 | `ci.yml` → `d825330`'s unparseable bytes | red **naming the parse failure**, not 18 generic faults | 19 blockers, **all 19** name the nested mapping at line 152; **0** recite the generic cause |
| 184 | delete the typecheck step, leave a comment containing `run: pnpm typecheck` | the structural probe must red | red, exactly 1 failing measure, on the **disagreement** arm |
| 185 | rewrite that step as a folded scalar (text precondition fails, structure holds) | red naming the **disagreement** | red, disagreement named with the polarity reversed from #184 |
| 186 | `if: false` on `jobs.test` | red, or **name** the guard | **stayed green** — see §6; kept as a measured gap |
| 187 | `build-and-test` `needs: []` | red naming the unreached bound job | red on `wired/aggregator-reachable`; 18 bindings stay bound |
| 188 | whole file → CRLF | must **stay green** | green, and the artifact is **byte-identical** under 180 CR bytes |
| 189 | denominator reverted to `4 +` | red | **stayed green — the control was invalid.** See below |
| 190 | a 20th `REGRESSION_CHECKS` row | counts red **before** pointers | count assertion red first, naming `now has 20`; no pointer fired ahead of it |

**#189 could not fire, and the reason is the same defect it was written to guard.** The denominator
feeds exactly one comparison, `measures.length < requireAtLeast`. Reverting `5 +` to `4 +` lowers the
floor from 31 to 30; on today's full list, `31 < 30` is false either way, so the verdict does not
move. Measured directly:

```
floor=31 (shipped)  31 measures -> PASSED   30 measures -> FAILED
floor=30 (#189)     31 measures -> PASSED   30 measures -> PASSED
```

The control tested the constant from outside, where it has no observable effect. What discriminates
is a **short measure list**: at the synced floor a dropped measure is refused; at `4 +` it passes
silently. That is now a test (`phase24-gates.test.ts`, *"refuses a SHORT measure list"*), asserting
both directions so the off-by-one has a failing mode of its own.

The transferable point is not "write a better control." It is that
[[miscounted-denominator-is-a-false-green]] applies to the *control* as much as to the code: a
mutation whose effect is invisible on current inputs proves nothing, and a green control must be
diagnosed rather than filed as a pass. #189 was predicted red in the plan and observed green; that
gap is what surfaced the invalid shape. Compare [[negative-control-validity-checklist]] — this is a
fifth way to build a control that proves nothing: mutate a bound that the present data never
approaches.

**#186 was predicted green and observed green.** The plan said so in advance and said what to do
about it: *"若绿，那是一个发现"* — record the weakness, do not pretend coverage. §6 is that record.

## §9 What closes S0-OPEN-5

Both halves of the row's own falsification condition, in its own order: `workflowBinding` resolved
from a parsed workflow graph, **plus** a control that applies the pushed unparseable bytes and
observes the gate red naming the parse failure. The control inlines `d825330`'s fragment rather than
fetching it — a depth-1 CI checkout makes an unknown-sha git command FATAL, not false
(`preview-snapshot.ts:565`) — and asserts the message's **content**, because a control satisfied by
any thrown error would also be satisfied by the wrong error.

**The row's own second reason for staying open was measured false.** It said a parse *"may
legitimately produce a different answer for a row (e.g. a step guarded by `if:`), and deciding what
that answer should be is a Phase 2.4 judgement."* On today's bytes it produces no different answer:
parse and regex agree on **all 19 rows** (`differing: 0`; only `ci:local` is false on both, by
design), because `jobs.test` has 27 steps and **zero** step-level `if:`. There was no judgement to
make, and the substitution is behaviour-equivalent.

That is the general lesson, and it is why the amendment records it rather than quietly omitting it: a
row's stated reason for deferral is a claim like any other, and it is measured, not trusted. ADR 0069
recorded two of S0-OPEN-3's sentences as false; this records a false reason for *waiting*. The cost
of trusting one is a batch that never runs, on grounds nobody re-checked.

## §10 What this batch deliberately did not do

- **No `if:` evaluation.** §6 names the gap and leaves it open rather than shipping a partial
  expression evaluator that would license a false sense of coverage.
- **No `eol=lf` pin on `.github/workflows/**`.** That is a cross-repository checkout-behaviour
  change, and control #188 measured that the parse path does not need it —
  `yaml@2.8.2` strips `\r` from scalars, so the structural probe is CRLF-immune by construction
  while the regex's tolerance was accidental ([[crlf-tolerance-is-accidental-under-regex-m]]).
  Normalize the reader, not the file — ADR 0064 §6.2.
- **No S0-OPEN-4 remedy.** Its three candidates are each an ingest-policy or served-bytes change and
  each needs its own authorization.
- **No S0-OPEN-1 movement.** Still 19/25, printed as census. **PR #234 untouched** — merging it is a
  served-bytes change needing its own authorization, and it was independently measured unsafe
  (`--gate` EXIT=0 with 37 tests red).
- **No verdict, schema, or served-byte movement.** Nothing under `apps/web/public/**`; the MCP
  surface (13 tools / 19 resources) and `packages/calllint-mcp` runtime `dependencies: {}` are
  untouched; `docs/` gains nothing.
- **`REGRESSION_CHECKS` keeps its 19 rows and its binding targets**, so the comments elsewhere that
  cite "all 19 rows bind `ci.yml`#`test`" remain true.
