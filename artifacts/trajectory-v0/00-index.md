# T0 — Repository and Semantic Audit (trajectory v0)

**What this is.** A measurement of what CallLint already contains, taken before any Trajectory
work is designed. Its purpose is negative: to stop a second Guard, a duplicate schema, a moved
verdict, or a Host capability that was assumed rather than observed. The spec is `new16.md` §12
(T0), and the nine chapter names below are its list, verbatim.

**What this is not.** Not a design, not a proposal, not an ADR. Where a chapter records a gap it
records the gap only — the recommended delta in `09` is the single place any forward-looking
sentence is allowed, and even there it is scoped to what T1 would need to decide.

## Status vocabulary

The spec fixes five words. They are used here with these meanings, and no others:

| Word | Meaning |
| --- | --- |
| `EXISTS` | Measured present, and reachable by the code path that would need it. |
| `PARTIAL` | Present in part. The chapter states which part, and which part is absent. |
| `ABSENT` | Measured not present. Not "not found" — searched for by more than its name. |
| `CONTRADICTED` | Present in a form that refutes the question's premise. Stronger than `ABSENT`. |
| `UNKNOWN` | Could not be measured from committed bytes. Never used to mean "probably fine". |

`CONTRADICTED` carries the most information and appears twice (Q4, Q10). Both times the finding
is that the repo does not merely lack a capability — it actively forbids it, with a gate.

## Where these files live, and why not where the spec says

The spec names `docs/audits/trajectory/`. That directory is inside `docs/`, which is gitignored in
this repository (`git ls-files docs/` returns 0 for 150+ local files) and, by the maintainer's
standing constraint, is not published. A chapter written there is unreachable from a PR, from CI,
and from any other machine — so the spec's own delivery requirement could not be met at the path
the spec names.

The landing site is therefore `artifacts/trajectory-v0/`, recorded as a decision in
**ADR 0062**. Two measurements make it the right site rather than merely an available one:

- `artifacts/` is tracked (5 subtrees, 31 files before this one) and `git check-ignore
  artifacts/trajectory-v0/` does not match, so these bytes reach PRs, CI, and other machines.
- No general scanner walks `artifacts/*` — every existing subtree is read by one named script,
  and the fixtures gate never reads `artifacts/`. So this audit carries **zero** gate cost, which
  was the stated reason O-T2 rejected `packages/fixtures/` in the first place. That reason does
  not migrate to `artifacts/`; ADR 0062 records why.

**No byte of `docs/` is published by this batch.** Where a chapter draws on a local planning
document, it projects that document's *conclusions* and cites them as conclusions. It does not
move the text.

## The 12 questions, and which chapter answers each

| # | Question | Status | Chapter |
| --: | --- | --- | --- |
| 1 | Real schema of Guard Request / Guard Decision | `PARTIAL` | [01](01-current-guard-semantics.md), [02](02-schema-and-type-map.md) |
| 2 | Is `REQUIRE_CONFIRMATION` a verdict, a disposition, or absent | name `ABSENT`, capability `EXISTS` | [03](03-verdict-disposition-map.md) |
| 3 | Is there a prior-decision reference | `EXISTS`, receipt layer only | [05](05-existing-state-and-receipt-map.md) |
| 4 | Does the Receipt support extension | `CONTRADICTED` | [05](05-existing-state-and-receipt-map.md), [02](02-schema-and-type-map.md) |
| 5 | Is there canonical serialization | `PARTIAL` | [02](02-schema-and-type-map.md) |
| 6 | session / task / principal / delegation types | all four `ABSENT` | [05](05-existing-state-and-receipt-map.md) |
| 7 | The Feature Flag system | `ABSENT` | [06](06-privacy-retention-map.md) |
| 8 | Which events the Hook can observe | `PARTIAL` — one event, matcher-bound | [04](04-host-evidence-capability-matrix.md) |
| 9 | Is the Hook blocking | non-blocking, structurally | [04](04-host-evidence-capability-matrix.md) |
| 10 | Is the Hook complete | `CONTRADICTED` — guaranteed incomplete | [04](04-host-evidence-capability-matrix.md) |
| 11 | Which shared files the Adoption mainline is editing | `EXISTS`, measured | [08](08-v1.4-adoption-conflict-map.md) |
| 12 | Which files the Trajectory branch must not touch | `PARTIAL` — inferred, not enumerated upstream | [08](08-v1.4-adoption-conflict-map.md) |

Chapters `07` and `09` answer no single question: `07` is the second-engine risk assessment the
Exit Gate requires, and `09` is the recommended delta.

## The five findings a name-based search would get wrong

Recorded here because they are the audit's substance, and because each one is a case where
searching for the *name* of a thing returns the opposite of the truth about the thing.

1. **Q1** — `GuardRequest` / `GuardDecision` exist as names in ADR prose (`adrs/0051…:26-27`,
   `adrs/0045…:26`) with **zero implementation**. The real input type is `ActionDescriptor` and
   the real output is `TrustDecision`. Searching for the ADR names finds the contract and misses
   the code.
2. **Q2** — `REQUIRE_CONFIRMATION` has **0** occurrences in tracked files, which reads as "the
   capability is missing". The capability is present, spread across five independent closed
   vocabularies. Absent name, present capability.
3. **Q4** — "Does the Receipt support extension" invites the answer "no, not yet". The measured
   answer is that extension is **forbidden and gated**: `additionalProperties: false` in 29 of 30
   schema files, with a test asserting unknown keys are rejected.
4. **Q8/Q10** — the Hook looks complete because it is registered and works. It observes exactly
   one event behind one matcher, and its failure modes are indistinguishable from "nothing to
   report". A dropped event and a clean run produce the same output.
5. **Q5** — `canonicalize` / `stableStringify` exist, so "canonical serialization: EXISTS" is the
   tempting answer. Key ordering is canonical; nothing else is. `04`/`02` state what that leaves
   open.

Q10 is the most load-bearing of the five. "No Host emits complete trajectory facts" has until now
been an assertion; it is now bound to a matcher string at
[hooks.json:5](../../plugins/calllint/hooks/hooks.json#L5) and three named failure paths.

## Exit Gate

The spec requires a Reviewer to confirm four things. Where each is answered:

| Exit Gate requirement | Chapter | Answer |
| --- | --- | --- |
| No unidentified second policy-engine risk | [07](07-overlap-second-engine-risk.md) | One risk identified and named; it is a *design* risk, not an existing engine |
| verdict / disposition semantics are clear | [03](03-verdict-disposition-map.md) | Five vocabularies mapped; one verdict authority named |
| File conflicts with v1.4 Adoption are clear | [08](08-v1.4-adoption-conflict-map.md) | Measured from the last 6 adoption commits |
| At least one candidate Host's evidence gap is clear | [04](04-host-evidence-capability-matrix.md) | Claude Code, three named gaps |

This audit does not itself pass the gate — the spec assigns that to a Reviewer. It supplies the
measurements the confirmation needs.

## Prohibitions this audit observed

The spec's T0 forbids production code, new schemas, package changes, public-copy changes, verdict
changes, and adapter implementations. None occurred: this batch adds Markdown under `artifacts/`,
one ADR, and (for reasons unrelated to T0) the R-9 deployment half. Chapter `07` carries fixture
**designs** in prose and **zero** executable schema, which is the same boundary.
