# ADR 0040: Static Toxic-Flow Analysis (`calllint.flow.v0`)

**Status**: Accepted
**Date**: 2026-07-15
**Phase**: F (Static Toxic-Flow Analysis, → v1.5.0) — Milestone F0
**Supersedes**: none
**Related**: [0035 Automated Trust Gateway & Authority Manifest](./0035-automated-trust-gateway-authority-manifest.md), [0041 Trust-Source Classification](./0041-trust-source-classification.md), [0020 Compact Decision & Reason Codes](../docs/adr/0020-compact-decision-and-reason-codes.md)

## Context

A per-tool scan (the shipped 13 detectors + `calllint.authority.v0`) evaluates each tool
in isolation. But the incident that motivated `new9.md` — an indirect prompt injection —
is not dangerous because any single tool is dangerous. It is dangerous because of a
**composition across tools**:

```
untrusted public content  →  read a private/secret resource  →  send it to an external sink
```

Each step, alone, may be REVIEW-or-lower. The **path** is the blocker. No shipped object
expresses a cross-tool path, so this danger is currently invisible.

This is the highest-value idea in new9 and the natural extension of CallLint's "blast
radius" thesis: it is pure-static, offline, deterministic, and needs no runtime adoption —
the same class of work as the Authority Manifest. Per `docs/new9-integration.md` §7 it is
**unconditional** and sequenced **before** the (gated) runtime Guard.

A new sibling object + a new analyzer is a schema/architecture change, so per the CallLint
contract it requires an ADR.

## Decision

### 1. New sibling object `calllint.flow.v0` — feeds the verdict, never a second verdict

```
schema:        "calllint.flow.v0"
flowId:        stable id for the path (e.g. "flow:public-read-to-external-send")
source:        { trustSource, evidence[] }            // trustSource from ADR 0041
steps:         [ { action, resource, scope } ... ]    // shipped authority.v0 enums ONLY
sink:          { action, resource, destination }      // shipped authority.v0 enums ONLY
risk:          { class, severity }
decisionHint:  ALLOW | REVIEW | BLOCK                  // a HINT
evidence:      [ ... ]                                 // exact bytes, mandatory
authorityDigests: [ sha256:... ]                       // binds the manifest(s) analyzed
digest:        sha256 over this object minus its digest field
```

A flow's `decisionHint` is folded into `calllint.decision.v0` as **`reasons`** — it does
**not** introduce a new verdict enum. The scan/gateway verdict stays `SAFE/REVIEW/BLOCK/UNKNOWN`.

### 2. No new capability vocabulary

`steps[]`/`sink` MUST use the shipped closed `action` (9) × `resource` (10) enums from
`authority-manifest.schema.json`. new9's draft names (`data.read`, `money.transfer`, …)
are prose aliases only; the binding crosswalk is `docs/new9-integration.md` §3.1. Extending
the action/resource enums remains separately ADR-gated.

### 3. Determinism & non-execution

The analyzer is pure: no network, no LLM, no clock. Same input manifests → byte-identical
flows (digest stable). The target is never executed (I-06 extends to Flow).

### 4. Release gate: a dangerous flow never resolves to SAFE

Phase F adds the property test *dangerous flow never resolves to SAFE* to the corpus gate,
mirroring the existing "dangerous input never SAFE" rule. UNKNOWN is measured separately
and never auto-upgrades.

### 5. Package boundary

Before adding `@calllint/flow-analyzer`, prove the responsibility cannot stay in
`@calllint/static-analyzer` (single-tool) or `@calllint/policy` (verdict) without mixing
concerns or creating a cycle. If it can, extend the existing package instead. (Phase F2
resolves this against the shipped package graph before any package is created.)

## Consequences

- **Positive**: expresses the real threat (composition) with mandatory evidence; deepens
  the shipped thesis at zero runtime cost; every rule gets ±fixtures like every detector.
- **Cost**: a new object + analyzer + ≥5 CL-FLOW rules + ≥10 multi-tool corpus snapshots.
- **Risk**: false-BLOCK on benign compositions → mitigated by the "benign read-only
  composition never BLOCK" acceptance criterion and paired fixtures.

## Invariants preserved

`I-01` no LLM in verdict · `I-04` UNKNOWN↛SAFE · `I-06` never execute target · `I-07`
evidence mandatory · new: dangerous-flow-never-SAFE · no second verdict vocabulary.
