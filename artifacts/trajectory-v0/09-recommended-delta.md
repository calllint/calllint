# 09 — Recommended delta

The one chapter permitted a forward-looking sentence, scoped to what **T1** would have to decide.
Nothing here is a design; each row names a decision, the measurement that forces it, and what would
be wrong to assume.

This chapter also carries the **RG-1…RG-5 running score**, per the O-T1 decision that assigns the
scoreboard to `09-recommended-delta.md` and creates no separate tracker.

## The restart gate — RG-1…RG-5

T1 may not begin until **at least two** are true, each with recorded evidence.

| # | Condition | Score | Evidence from this audit |
| :--: | --- | :--: | --- |
| RG-1 | 3 independent users request pre-action gating | **0** | Not measurable from committed bytes. Unchanged |
| RG-2 | 2 Hosts with stable, testable enforcement hooks | **1 candidate, and now with a measured gap** | [04](04-host-evidence-capability-matrix.md): Claude Code registers **one** event behind matcher `Write\|Edit\|MultiEdit` ([hooks.json:5](../../plugins/calllint/hooks/hooks.json#L5)); non-blocking by three independent locks; **guaranteed incomplete** three ways |
| RG-3 | 1 real user incident static Flow cannot stop | **0** | Not measurable from committed bytes. Unchanged |
| RG-4 | 50+ report-only real action decisions | **0** | H3 per-call remains design-only (ADR 0042). No producer exists |
| RG-5 | A defined acceptable false-block rate | **undefined** | Definitional; no budget agreed |

**Score: 0 of 5. Unchanged by this audit, and that is the correct outcome.**

T0 was never able to move the score — it can only make the reasons *checkable*. It did that for
RG-2. The claim "no Host emits complete trajectory facts" was previously an assertion in planning
prose; it is now bound to a matcher string, a missing `permissionDecision` field, and three silent
exit-0 paths in committed code. Anyone can now falsify it by pointing at a line.

Two of the five (RG-1, RG-3) are observations about the world and cannot be measured in a
repository. RG-4 needs a producer that ADR 0042 froze. RG-5 needs a number nobody has agreed. **So
the gate is not close, and no amount of further auditing moves it.** That is the honest conclusion.

## The decisions T1 must make, and what forces each

| # | Decision | Forced by | Wrong assumption it prevents |
| --: | --- | --- | --- |
| **D-1** | Reuse `TrustDecision` for the action-time axis, or instantiate `calllint.guard.decision.v0` | [07](07-overlap-second-engine-risk.md) — the two options are exhaustive; [adrs/0045:27](../../adrs/0045-continuous-guard-command-and-hook.md#L27) forbids `SAFE` on the runtime axis | That trajectory decisions slot into existing types for free. They do not; one enum must widen or a second must appear |
| **D-2** | Where trajectory state lives | [05](05-existing-state-and-receipt-map.md) — session/task/principal/delegation are **all four absent**; no session store; `workflow_step?: string` is the nearest primitive and has no ordering | That `agent_session` is an identifier. It is an optional unvalidated string with no store and no index |
| **D-3** | How trajectory state is bounded | [06](06-privacy-retention-map.md) — `DELETE FROM`/`VACUUM` have **0** occurrences in the store; all retention is filesystem sweeps on a timer | That "retention" is a config knob. A trajectory table would be the **first** table growing with time rather than corpus size, so row-level retention is a new capability |
| **D-4** | Whether it can ship disabled | [06](06-privacy-retention-map.md) — **0** flag-framework symbols; 8 bare `process.env` reads | That "land it behind a flag" is available. The flag system would have to be built first |
| **D-5** | How partial observation is represented | [04](04-host-evidence-capability-matrix.md) Gap 3 — a dropped event is byte-identical to "nothing to report" | That an empty observation list means nothing happened. Boundary conclusion 4: `[]` is not `unavailable` |
| **D-6** | Whether a trajectory finding needs a disposition `REVIEW` cannot express | [03](03-verdict-disposition-map.md) — five closed vocabularies already carry "human confirmation needed" | That `REQUIRE_CONFIRMATION` fills a gap. It would be a **sixth** vocabulary, and only vocabulary 3 (`GUARD_ACTIONS`) can currently say "the analysis itself failed" |

**D-5 is the prerequisite for all the others.** Until partial observation is representable, a
trajectory decision cannot state its own completeness — and per product principle 2 and the
`unknowns` field that already exists on `TrustDecision`
([trustDecision.ts:53-56](../../packages/types/src/trustDecision.ts#L53-L56)), a decision that cannot
state its gaps must emit `UNKNOWN`. A feature that always emits `UNKNOWN` is not worth shipping.

## Projected conclusions from the local boundary analysis (§19)

Projected as conclusions; the source text stays local and unpublished. They are the design invariants
a T1 ADR would need to adopt or explicitly reject:

1. **Host Fact vs Derived Signal must not share a field.** What the Host emitted and what CallLint
   inferred are different kinds of claim. [04](04-host-evidence-capability-matrix.md)'s matrix is
   entirely Host Fact; a trajectory inference is not, and must be labelled.
2. **Trust ordering: a Derived Signal never outranks a Host Fact,** and the absence of a Host Fact is
   not evidence that the event did not occur — which is exactly the situation
   [04](04-host-evidence-capability-matrix.md) measures for `Bash` and every MCP call.
3. **Completeness is three-state: `complete | partial | unavailable`.** Two states cannot describe
   the current hook stream, which is *partial by construction* — neither available nor unavailable.
4. **`[]` is not `unavailable`.** The producer states its completeness; the consumer never infers it
   from an empty list.
5. **Five invariants, one shape:** the producer is responsible for describing the quality of what it
   produced. Nothing downstream can recover information the producer discarded.

Conclusion 3 is the one that connects to something already shipped: `TrustDecision.completeness` is
typed `AuthorityCompleteness` and already distinguishes complete from partial authority
([trustDecision.ts:57-58](../../packages/types/src/trustDecision.ts#L57-L58)). Whether that type has
the third state, and whether it is the right vehicle, is a T1 measurement — this audit did not read
its members and does not claim them.

## What T1 should *not* do

Each is a measured constraint, not a preference:

- **Do not add a field to a receipt or a decision schema.** 29 of 30 schemas are closed and a gate
  asserts unknown keys are rejected ([02](02-schema-and-type-map.md)). The gate reds; the change needs
  an ADR.
- **Do not implement `calllint.guard.request/decision.v0` as though it were a stub.**
  [adrs/0051:26-27](../../adrs/0051-preflight-hook-boundary.md#L26-L27) records it as a paper contract
  for a future gate; ADR 0042 froze runtime blocking behind an unmet necessity test.
- **Do not make the hook blocking.** Three independent locks, one of them an ADR invariant
  ([04](04-host-evidence-capability-matrix.md) Q9).
- **Do not touch `computeVerdict`.** Committed as the sole adjudicator and a forbidden path
  ([08](08-v1.4-adoption-conflict-map.md)).
- **Do not execute, import, start, connect to, or authenticate against a target.** Forbidden for both
  M and T, stated for both explicitly in `non-goals.md`.
- **Do not widen `packages/calllint-mcp` runtime `dependencies`** or move the 13-tool / 19-resource
  counts. Frozen and gated.

## The smallest useful next step, if the gate ever opens

Stated as one item rather than a plan, because the gate is 0/5 and a plan would be speculation:

**Make the hook's failure modes distinguishable from its silence.** That is fixture F-T1 and F-T2 of
[07](07-overlap-second-engine-risk.md), it is decision D-5, and it is the only item on this page that
is (a) independent of the restart gate, (b) implementable without a new schema, and (c) required by
every other decision. Until a consumer can tell "no config surface" from "the hook timed out at 2000
ms", every downstream trajectory claim is ungrounded.

Whether even that is worth doing at 0/5 is a product judgement, not a T0 finding.

## What this chapter does not claim

- No recommendation on D-1 through D-6. Each is named with its forcing measurement; the choices are
  T1's, with ADRs.
- No claim that the RG score will change. Two of the five are unmeasurable from a repository, and this
  audit did not attempt to measure them.
- `AuthorityCompleteness`'s members were not read. Conclusion 3's connection to it is flagged as a T1
  measurement, not asserted as a finding.
