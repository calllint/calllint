# ADR 0044: `TOXIC_FLOW_COMPOSITION` Reason Code (#13)

**Status**: Accepted
**Date**: 2026-07-15
**Phase**: F (Static Toxic-Flow Analysis, → v1.5.0) — Milestone F4
**Supersedes**: none
**Related**: [0040 Static Toxic-Flow Analysis](./0040-static-toxic-flow-analysis.md), [0041 Trust-Source Classification](./0041-trust-source-classification.md), [0020 Compact Decision & Reason Codes](../docs/adr/0020-compact-decision-and-reason-codes.md)

## Context

ADR 0040 §1 requires a flow's `decisionHint` to be folded into `calllint.decision.v0`
as **`reasons`** — a flow feeds the verdict, it is never a second verdict. But ADR 0020
froze a public vocabulary of **exactly 12 reason codes** ("frozen for v0"), and none of
them expresses a **cross-tool toxic-flow composition**. The closest, `EXTERNAL_MUTATION_UNKNOWN`,
is about a *single* capability's unknown external effect — it cannot distinguish "this one
tool mutates something external" from "an untrusted source in tool A can reach an external
sink in tool B", which is the entire point of Phase F.

Folding a flow into the decision under an existing code would make the flow's contribution
**indistinguishable** from an ordinary single-capability contribution — an agent, a CI gate,
or a human reading the decision could not tell that a *composition* drove the verdict. That
defeats the auditability the flow object exists to provide.

Extending the frozen 12-code vocabulary is a public-contract change, so per the CallLint
contract it requires an ADR.

## Decision

Add a **13th** public reason code:

```
TOXIC_FLOW_COMPOSITION
```

- **Meaning**: a static toxic-flow path (`calllint.flow.v0`) — an untrusted/sensitive data
  source reaching an external egress sink across one or more tools — contributed to this
  decision. It is the decision-layer projection of a flow whose `decisionHint` is `BLOCK`
  or `REVIEW` (an `ALLOW` flow contributes nothing, exactly as a benign capability does).
- **Backing**: `backedBy: ["flow:toxic-composition"]`, `status: "wired"`. Unlike the other
  12, it is **not** backed by a static detector `Finding` — it is backed by the flow object
  (`@calllint/flow-analyzer`). The synthetic backing id keeps `REASON_CODE_META` uniform
  (every wired code names its backing) without inventing a new `status` value.
- **Order**: appended **last** (index 12) so the existing frozen order (indices 0–11) is
  **unchanged** — no consumer that pins a code to a position drifts.

### Not a second verdict (ADR 0040 §1)

The scan/gateway verdict stays `SAFE/REVIEW/BLOCK/UNKNOWN`. A flow contributes a *reason*
carrying a `contributes` verdict (BLOCK/REVIEW), aggregated by the SAME `mostSevereVerdict`
rule as every other reason. A dangerous flow therefore raises the verdict to at least its
`contributes` level; it can never *lower* one (I-04), and an ALLOW flow never appears.

### `findingsToReasonCodes` is untouched

The detector→reason projection (`packages/core/src/rules/reasonCodes.ts`) iterates detector
`Finding`s; no detector emits `flow:toxic-composition`, so the scan path never fabricates
this code. It is produced only by the explicit flow-fold step (F4b), keeping the two paths
cleanly separated.

## Consequences

- **Positive**: a flow-driven verdict is now self-describing and auditable — the decision
  literally says a cross-tool composition drove it, cited to the flow's evidence.
- **Cost**: the frozen count moves 12 → 13; the `new4-contracts` vocabulary tests and the
  `decision.schema.json` reason enum update in lockstep. One synthetic backing id.
- **Risk**: over-firing → mitigated by only folding BLOCK/REVIEW flows (never ALLOW), and by
  the F3 rule catalog + the F4 corpus gate (`dangerous flow never resolves to SAFE`).

## Invariants preserved

`I-01` no LLM in verdict · `I-04` UNKNOWN/unknown↛SAFE (a flow can only raise the verdict) ·
`I-07` evidence mandatory (the folded reason cites the flow's evidence) · no second verdict
vocabulary · frozen order 0–11 unchanged (append-only).
