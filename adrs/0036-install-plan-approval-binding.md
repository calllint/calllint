# ADR 0036: Install Plan & Approval Binding

**Status**: Accepted
**Date**: 2026-07-13
**Phase**: G (Automated Trust Gateway Core, v1.3.0) — Milestone G0
**Related**: [0035 Automated Trust Gateway & Authority Manifest](./0035-automated-trust-gateway-authority-manifest.md), [0037 Host Adapter Safety Contract](./0037-host-adapter-safety-contract.md)

## Context

The gateway compresses friction to **exactly one approval**, then applies an exact,
reversible change. That approval must be impossible to satisfy against a state that has
since changed (a TOCTOU version swap, a policy bump, a config another process edited).
This ADR locks the Install Plan object and the binding semantics of an approval, before
`@calllint/install-planner` (G5) or `trust apply` (G6) exist.

## Decision

### 1. Install Plan is pure, typed data — `calllint.install-plan.v1`

```
schema: "calllint.install-plan.v1"
planId, planDigest
artifactDigest, authorityDigest, decisionDigest, policyDigest   // the upstream chain
host: e.g. "claude-code"
operations[]:  { type: "json-patch", target, preconditionDigest, patch: [RFC-6902] }
rollback[]:    inverse operations
backup:        { path: "<config>.calllint-backup-<receipt-id>" }
idempotencyKey: sha256
expiresAt:     ISO
```

Operations are **typed** (JSON-Patch RFC-6902 with a `preconditionDigest` of the target's
current bytes). An operation is **never** a shell string and **never** a command parsed
from a README. Generating a plan is pure: it changes nothing on disk except (optionally)
the plan file under `.calllint/plans/<plan-id>.json`.

### 2. An approval binds all six digests at once

`trust apply --plan <p> --approve <plan-digest>` is accepted only if the supplied
`plan-digest` matches the plan's `planDigest`, **and** every upstream digest
(`artifact/authority/decision/policy` + each operation's `preconditionDigest`) still
re-resolves identically. The approval authorizes *this exact chain of six objects*, not
"install this tool."

### 3. TOCTOU re-validation → `PLAN_STALE` (never auto-merge, never fall through)

`AWAITING_APPROVAL → REVALIDATING` re-resolves the artifact and re-computes **all six
digests**. Any mismatch terminates at `PLAN_STALE`. The gateway **never** silently
re-plans, merges, or proceeds. The user must run `trust prepare` again to get a fresh
plan and a fresh approval.

### 4. Plan expiry

A plan carries `expiresAt`. Applying an expired plan is rejected (terminal, treated as a
stale plan). Expiry is checked against a timestamp passed in from the CLI edge, not a
core wall-clock call.

### 5. Idempotency

A plan carries an `idempotencyKey`. Re-applying an already-applied plan is a no-op that
returns `already_applied` (exit 10), never a second write. This makes `trust apply`
safe to retry.

### 6. No failure state falls through to APPLIED

The state machine's failure states — `RESOLUTION_FAILED · FETCH_REJECTED ·
EVIDENCE_PARTIAL · EVIDENCE_FAILED · POLICY_UNKNOWN · PLAN_STALE · APPLY_CONFLICT ·
ROLLBACK_REQUIRED · VERIFICATION_FAILED` — are each terminal. None implies success; none
transitions to `APPLIED`. `POLICY_UNKNOWN` (an UNKNOWN/degraded decision) blocks apply.

## Non-negotiables locked by this ADR

- Operations are typed JSON-Patch with a precondition digest — never a shell string,
  never a parsed README command.
- One approval binds all six digests; it authorizes an exact object chain.
- Any digest mismatch at revalidation ⇒ `PLAN_STALE`; never auto-merge or fall through.
- Expired plans are rejected; idempotent re-apply returns `already_applied`, never a
  second write.
- No failure state transitions to `APPLIED`; `POLICY_UNKNOWN` blocks apply.

## Consequences

### Positive
- The single-approval UX stays low-friction *and* trustworthy: the approval cannot be
  replayed against drifted state.
- Idempotency + expiry make apply safe to automate (CI, agent) within a budget.

### Negative
- A benign upstream change (e.g. an unrelated policy edit) voids an approval and forces a
  re-prepare. This is intentional: correctness over convenience.

### Trade-offs
- Chose **re-resolve everything** at revalidation over caching (a few seconds of latency
  buys a guarantee against TOCTOU).
- Chose **JSON-Patch** as the single operation type for v1 (auditable, reversible,
  host-agnostic) over host-native mutation APIs.

## Compliance / gate impact

Property tests locked for G5/G6: *plan change ⇒ digest change · repeat apply ⇒ no double
write · rollback restores original digest · stale/expired plan never applies*. Any change
to `calllint.install-plan.v1` requires a new ADR.
