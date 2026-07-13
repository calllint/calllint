# ADR 0037: Host Adapter Safety Contract

**Status**: Accepted
**Date**: 2026-07-13
**Phase**: G (Automated Trust Gateway Core, v1.3.0) — Milestone G0
**Related**: [0036 Install Plan & Approval Binding](./0036-install-plan-approval-binding.md)

## Context

A `HostAdapter` is the only code that translates an approved Install Plan into a real edit
of a host's config (Claude Code `~/.claude.json`, Cursor `mcp.json`, …). It is the single
most dangerous surface in CallLint: a bug here corrupts a user's live agent
configuration. This ADR locks the contract every adapter must satisfy, before any adapter
is written (G5 plan-only, G6 apply).

## Decision

### 1. The interface

```ts
interface HostAdapter {
  id: string
  detect(ctx: HostContext): Promise<HostDetection[]>
  createPlan(target: ResolvedArtifact, decision: PolicyDecision, ctx: HostContext): Promise<InstallPlan>
  validatePlan(plan: InstallPlan): Promise<ValidationResult>
  applyPlan(plan: InstallPlan, approval: ApprovalToken): Promise<ApplyResult>
  rollback(result: ApplyResult): Promise<RollbackResult>
}
```

### 2. Absolute prohibitions (every adapter, no exceptions)

- **No target execution.** An adapter never runs the artifact, a runtime, or an installer
  binary.
- **No README-command parsing.** An adapter never reads free-text install instructions
  and turns them into commands.
- **Arg-arrays only.** Any subprocess an adapter *does* run (e.g. a native host CLI) is
  invoked with an argument array, never a shell string — no `sh -c`, no interpolation.
- **Known-schema writes only.** An adapter writes only fields it understands in the host's
  config schema, via the plan's typed JSON-Patch. No blind passthrough of unknown content.

### 3. Every write is atomic, locked, precondition-checked, reversible

`applyPlan` must, in order:
1. Take a config lock: `.calllint/locks/<config-digest>.lock`.
2. Re-check each operation's `preconditionDigest` against the target's current bytes;
   mismatch ⇒ `APPLY_CONFLICT` (no write).
3. Back up the original: `<config>.calllint-backup-<receipt-id>`.
4. Write atomically: temp file → `fsync` → atomic `rename` over the target. Never a
   partial in-place write.
5. Re-parse the result (`VERIFIED`); on failure ⇒ `ROLLBACK_REQUIRED` → restore the
   backup and confirm the original digest.

### 4. No unrelated churn

An adapter changes only the bytes the plan's patch touches. It must not reformat,
re-order keys, rewrite unrelated fields, or normalize whitespace elsewhere in the config.
A test asserts the diff is limited to the planned operations.

### 5. Cross-platform path safety

Adapters must handle: Windows drive letters / UNC paths / WSL, macOS/Linux symlinks,
case-insensitive filesystems, path-escape / traversal (`../`), and home expansion (`~`).
A resolved config path that escapes its expected host directory is rejected. This carries
the auto-discovery path-safety posture (ADR 0033) into the writable path.

### 6. Host tiers

- **Tier A** — detect + analyze + plan + apply + rollback. Requires full E2E (20 positive
  + 20 broken/conflict fixtures) on Windows/macOS/Linux and **< 1% corruption /
  rollback-needed** rate. First Tier-A target: **Claude Code**.
- **Tier B** — detect + analyze + plan only. The user applies the emitted patch / native
  command themselves. A host stays Tier B until it clears the Tier-A E2E + kill gate.
- **Tier C** — detect + analyze only.

**Kill gate**: if a host's corruption / rollback-needed rate exceeds 1%, it cannot be
Tier A and drops to Tier B.

## Non-negotiables locked by this ADR

- No target execution; no README-command parsing; arg-arrays only; known-schema writes only.
- Lock → precondition-check → backup → atomic (temp+fsync+rename) → verify → rollback.
- No formatting/ordering churn outside the planned patch.
- Full cross-platform path safety; path-escape rejected.
- Tier A requires passing E2E + <1% corruption kill gate; otherwise Tier B.

## Consequences

### Positive
- The blast radius of a host bug is bounded: atomic write + backup + verify + rollback
  means a failed apply leaves the original config intact.
- The tier system lets CallLint support many hosts safely (plan-only) while only promoting
  a host to auto-apply once it is proven.

### Negative
- Atomic-write + lock + backup adds per-apply latency and a backup file. Acceptable for a
  config-change operation that happens rarely and must never corrupt.

### Trade-offs
- Chose **backup + verify + rollback** over transactional FS features (portable across
  every platform; no dependency on FS-specific transactions).
- Chose a **strict tier ladder** over "best-effort apply everywhere" (a corrupted config
  is a worse outcome than asking the user to paste a patch).

## Compliance / gate impact

G6 acceptance is bound to this ADR: per Tier-A host, 20 positive + 20 broken/conflict
fixtures, Win/macOS/Linux E2E, idempotent repeat apply, `PLAN_STALE` on external edit,
post-apply re-parse, rollback restores original digest, no unrelated churn. Any change to
the `HostAdapter` contract requires a new ADR.
