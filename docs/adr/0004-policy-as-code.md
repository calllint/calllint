# ADR 0004: Policy-as-Code in v0.1

Status: Accepted

## Decision

A policy file (`mcpguard.policy.json`, schema `mcpguard.policy.v0`) is part of v0.1, not a
later enterprise feature. The policy can downgrade or escalate verdicts, and a verdict
changed by policy must be labeled "Policy decision" in the report.

## Override rules

- An override without a `reason` is invalid.
- An override without an `expiresAt` is invalid.
- An override may not allow `EXEC` or `MONEY` symbols unless it is an explicit
  `dangerousOverride: true`.

## Reason

The real enterprise question is "which servers may enter production?" — that is a policy
question. Modeling policy late forces a schema rewrite. Modeling it now keeps the
`ScanReport` and policy schemas coherent from day one.
