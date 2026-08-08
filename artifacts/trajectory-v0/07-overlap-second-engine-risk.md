# 07 — Overlap and second-engine risk

Satisfies the Exit Gate requirement *"no unidentified second policy-engine risk."* The gate asks for
the risk to be **identified**, not absent.

**Finding: there is no second policy engine today. There is one identified risk that a Trajectory
design would create, and one already-known duplication whose shape it would repeat.**

This chapter also carries T0-b's fixture work, as **designs in prose only** — zero executable
schema, zero fixture files, per the T0 prohibition on new schemas.

## What decides a verdict today

Two producers, both pure functions, both deterministic:

| Producer | Binding | Signature | Decides over |
| --- | --- | --- | --- |
| `computeVerdict` | [packages/risk-engine/src/computeVerdict.ts:21-24](../../packages/risk-engine/src/computeVerdict.ts#L21-L24) | `(findings: Finding[], binding: RuntimeBinding) → Verdict` | static findings + what would actually run |
| `decideOverAuthority` | [packages/policy/src/decideOverAuthority.ts:141](../../packages/policy/src/decideOverAuthority.ts#L141) | `(input: DecideInput) → TrustDecision` | an authority manifest + policy + optional evidence |

They are not two engines in competition — they operate on different objects at different times
(scan-time findings vs. authority-time capability inventory) and both emit the same four-member
`Verdict` from [03](03-verdict-disposition-map.md). `computeVerdict`'s first line is
`if (findings.some((f) => f.blocker)) return "BLOCK"`, and its second rule is recorded in a comment
as *"a source we cannot positively recognize is UNKNOWN, not SAFE"* — product principle 2 at the
top of the call stack.

`decideOverAuthority` composes per-capability contributions (`moreSevere(baseVerdict(c),
policyFloor(code, policy))`) rather than special-casing. Both are extensible by adding *inputs*, not
by adding branches.

**No third producer exists.** The 22 files that mention either name are callers, re-exports, or
projections.

## The identified risk

**A trajectory decision path would be the first thing in the repo that decides over a *sequence*
rather than a *state*.** That is the second-engine risk, and it is structural:

| Property | Both existing producers | A trajectory decider |
| --- | --- | --- |
| Input | a snapshot (findings, or an authority inventory) | an ordered sequence of observations |
| Purity | pure function of its input | needs history ⇒ needs state ([05](05-existing-state-and-receipt-map.md): none exists) |
| Re-derivable | yes, from digests | only if the sequence is stored and canonical |
| Verdict vocabulary | the shipped four | ADR 0045:27 says the runtime axis carries *"a distinct action-time enum (never `SAFE`)"* |

The last row is the sharp edge. Two documented options, and they are the whole risk:

1. **Reuse `TrustDecision`.** Then a runtime path emits `SAFE`, which
   [adrs/0045-continuous-guard-command-and-hook.md:27](../../adrs/0045-continuous-guard-command-and-hook.md#L27)
   explicitly forbids for that axis. It would also mean one verdict type whose meaning depends on
   which producer made it — the ambiguity a single closed enum exists to prevent.
2. **Instantiate `calllint.guard.decision.v0`** (the paper contract of [01](01-current-guard-semantics.md)).
   Then there are genuinely **two decision vocabularies**, and every consumer — renderer, receipt
   writer, MCP surface, policy — needs to know which it holds. That is a second engine in the sense
   the Exit Gate is asking about.

**Neither option is chosen here.** T0 measures; the choice is a T1 ADR. What T0 can say is that the
choice is *unavoidable*: there is no third path where trajectory decisions slot into the existing
types without either widening a stable enum or adding a parallel one.

## The precedent that shows how this goes wrong

The repo already contains one instance of exactly this shape, and it is instructive because it was
*measured* rather than predicted: two engines that were expected to agree were found to disagree
**19/19** on the same corpus. The resolution was not to pick a winner but to emit `UNKNOWN` for all
19 — honest, and blocked on a product judgement plus its own ADR rather than on code.

The transferable lesson: **two deciders over overlapping inputs do not converge by construction.**
If a trajectory decider and `decideOverAuthority` can both speak about the same tool call, their
disagreement rate is an empirical question that must be measured before either is trusted, and
`UNKNOWN` is the correct output while it is unmeasured.

## A duplication risk that is *not* a second engine

Worth separating, so the gate's answer is not muddied: the five confirmation vocabularies of
[03](03-verdict-disposition-map.md) are a **projection** risk, not an engine risk. They are kept
consistent by two committed total maps (`VERDICT_TO_RECOMMENDATION`, and the drift→action table).
Adding a sixth vocabulary for trajectory would be a maintenance cost and a consistency hazard, but it
would not be a second policy engine — nothing in vocabularies 2–5 decides anything.

## T0-b — fixture designs (prose only, zero executable schema)

The repository contract requires every detection rule to ship with a positive fixture, a negative
fixture, and a unit test. If trajectory work ever produces a rule, these are the fixtures it would
need. Recorded as **designs**; no file is created, no schema is written.

The existing fixture plane, for reference on where they would go:
[packages/fixtures/](../../packages/fixtures/) with `golden/`, `corpus/`, `surfaces/`, `action/`,
`evidence/`, `agent-inbox/`, `bench/`, loaded via `GOLDEN_DIR` / `GOLDEN_CASES`
([packages/fixtures/src/index.ts:8-46](../../packages/fixtures/src/index.ts#L8-L46)).

| Design | Positive case | Negative case | The property it would pin |
| --- | --- | --- | --- |
| **F-T1 partial-stream honesty** | An observation set from a run where the hook timed out mid-sequence | A complete set from a clean run | The two must be **distinguishable**. Today they are not ([04](04-host-evidence-capability-matrix.md) Gap 3) — this is the fixture that would make Q10's finding a gate |
| **F-T2 `[]` ≠ `unavailable`** | An empty list explicitly marked `complete` | An empty list marked `unavailable` | Serializing both to `[]` must be impossible. Directly pins boundary conclusion 4 |
| **F-T3 sequence order sensitivity** | Two runs, same actions, different order | The same run twice | Whether order changes the outcome must be **asserted either way**, not left to emerge |
| **F-T4 blind-tool baseline** | A sequence whose consequential step was a `Bash` call | The same sequence via `Write` | Makes the matcher gap of [04](04-host-evidence-capability-matrix.md) a measured fact rather than a comment |
| **F-T5 no-verdict-movement** | An existing golden case, replayed with trajectory inputs present | The same case with them absent | The verdict must not move. This is the fixture that protects product principle 4 and the stable enum |

**F-T5 is the load-bearing one.** It is the only fixture on this list that protects something that
already ships, and it is the one that would fail first if a trajectory path leaked into the verdict
path.

## Answer to the Exit Gate

> *"No unidentified second policy-engine risk."*

**Answered.** No second engine exists today (two producers, one enum, both pure). The risk is
identified and named: a trajectory decider must either widen a stable enum or instantiate a parallel
decision vocabulary, and the repo has one measured precedent showing two deciders over overlapping
inputs disagreed on every case. The decision is deferred to T1 with an ADR, which is what
[09](09-recommended-delta.md) recommends.

## What this chapter does not claim

- Not that either option is preferable. That is a product decision with its own ADR.
- Not that the 19/19 disagreement will recur. It is cited for its shape — that convergence must be
  measured, not assumed — not as a prediction.
- No fixture file exists. The table above is prose, deliberately, per T0's prohibition on new schemas
  and production code.
