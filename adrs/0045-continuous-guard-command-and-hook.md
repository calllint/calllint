# ADR 0045: Continuous Guard Command & Hook Safety Contract (`calllint guard`)

**Status**: Accepted
**Date**: 2026-07-16
**Phase**: H (Install Guard & Growth, → v1.5.0) — Milestone H1
**Supersedes**: none
**Related**: [0024 Approved State & Verify Repositioning](../docs/adr/0024-approved-state-and-verify-repositioning.md), [0037 Host Adapter Safety Contract](./0037-host-adapter-safety-contract.md), [0042 Guard Action-Decision Contract](../docs/adr/0042-guard-action-decision-contract.md), [0040 Static Toxic-Flow Analysis](./0040-static-toxic-flow-analysis.md)
**Drives**: [../new8-execution-roadmap.md](../new8-execution-roadmap.md) Phase H1, [../new9-integration.md](../new9-integration.md) §5

## Context

new8 Engine 2 is **Continuous Guard**: *"turns one use into persistent use (retention)."*
The roadmap (Phase H1) states its meaning precisely — *"run the gateway automatically at
authority-**change** moments; be silent when nothing changed."* It watches
`mcp.json · server.json · SKILL.md · CLAUDE.md · AGENTS.md · .cursor/rules/** · package.json ·
OAuth scopes · tool metadata` and re-decides only when the authority surface moves.

This is **not** the per-call action guard. new9 added a second, deeper Guard —
evaluating an *individual tool call* at runtime through a host hook such as
`PreToolUse` — which is **ADR 0042 / Milestone H3**, necessity-gated and design-only.
The two are different depths of Phase H (see [new9-integration.md](../new9-integration.md) §5):

| | H1 — this ADR | H3 — ADR 0042 |
|---|---|---|
| Trigger | authority-surface **change** (a file/config edit) | an individual **tool call** at runtime |
| Object | reuses `calllint.approved.v0` drift | `calllint.guard.request/decision.v0` |
| Verdict enum | the shipped `SAFE/REVIEW/BLOCK/UNKNOWN` | a distinct action-time enum (never `SAFE`) |
| Gate | **unconditional** (pure-static, zero adoption risk) | **necessity-gated**, experimental |
| Ships in | v1.5.0 | only when its necessity gate opens |

H1 is unconditional because it adds **no new engine and no new verdict vocabulary** —
it is a thin command over primitives that already shipped in v1.3.0. This ADR freezes
the safety contract for that command and its host hooks **before** the code, because a
guard that fails open, fires on noise, or invents a second drift engine would erode the
exact trust it exists to build.

## Decision

### 1. Reuse the shipped approved-state engine — no second drift engine, no new verdict

`calllint guard` computes its result **only** from the primitives already shipped and
ADR-gated:

- `decideRepoSurfaces` (walk the repo's agent-tool surfaces → `CompactDecision[]`),
- `verifyApproved` (ADR 0024: diff the current surface against `.calllint/approved.json`;
  a moved surface never collapses to SAFE; BLOCK/UNKNOWN dominate),
- the shipped `SAFE/REVIEW/BLOCK/UNKNOWN` verdict vocabulary and `mostSevereVerdict`.

Guard introduces **no** `calllint.guard.*.v0` schema (that vocabulary is ADR 0042/H3),
**no** parallel drift computation, and **no** new reason code. It is a *presentation and
lifecycle* layer over `verify --approved`, adding only what a retention hook needs:
silence-when-unchanged, a change-severity gate, verdict-aware exit codes, and
install/status/disable.

### 2. Silent when nothing changed; loud only on *new* authority

The retention promise is *"no new authority → silent."* Guard emits nothing on stdout and
exits `0` when the approved surface is byte-identical (no drift). It surfaces output only
when the authority surface **changed**, and its severity is driven by the drifted verdict:

```
no drift                         → silent, exit 0
drift, worst new verdict SAFE    → informational note, exit 0
drift, worst new verdict REVIEW  → prompt (human confirmation needed), exit 10
drift, worst new verdict UNKNOWN → request evidence/approval,          exit 20
drift, worst new verdict BLOCK   → refuse,                             exit 30
```

Exit codes are the **already-stable** CLI codes (`args.ts` `EXIT`): `0/10/20/30`. Guard
does not reuse `40 (DRIFT)` — `40` is `verify`'s "surface changed" signal that says
nothing about severity; Guard's contract is severity-aware, so it maps the drifted
verdict onto the same verdict codes every other command uses. UNKNOWN never rounds down
to SAFE (I-04).

### 3. Fail-closed on the guard's *own* failure

If Guard cannot compute the surface — an unreadable config, a parse failure it cannot
localize, a missing/corrupt approved file, an internal error — it **must not** read as a
pass. It emits a diagnostic and exits non-zero (`EXIT.ERROR = 3` for an internal failure;
a missing approved baseline is a usage error `EXIT.USAGE = 2` telling the user to run
`calllint approve`). A hook self-failure (timeout, crash, non-zero) MUST likewise never be
interpreted by the host as "safe to proceed." This is the config-change analogue of ADR
0042 §6's fail-closed posture: the guard's silence must mean *"verified unchanged,"* never
*"the guard broke."*

### 4. Hooks are declarative shims — no risk logic in host artifacts

`guard install --host <host>` writes a host artifact (a git `pre-commit`/`pre-push` hook,
a GitHub Actions workflow, a Claude Code hook snippet) that **only shells out to
`calllint guard`**. The artifact carries no detection or decision logic — identical in
spirit to how `gen-rule` (ADR 0025) and `renderCiGate` emit pure, deterministic text with
no embedded risk logic. The generated GitHub workflow reuses the shipped `renderCiGate`
surface; the local git hook is a thin `npx -y calllint guard` wrapper. This keeps the
single source of truth for the decision inside the audited engine, never copied into a
host file that can drift.

### 5. One-key disable + status; disable is explicit and honoured

- `calllint guard status` reports whether a local approved baseline exists, whether a
  disable flag is set, and the installed hooks it can detect.
- `CALLLINT_GUARD=0` (env) and a `.calllint/guard.json` `{ "enabled": false }` flag both
  disable Guard. When disabled, `calllint guard` exits `0` with a one-line note that it is
  disabled — it never silently *passes* while pretending to have run; the note makes the
  disabled state visible.
- **Kill gate (roadmap H1)**: if noise drives >10% disable, the fallback is
  *authority-delta-only* mode — which is already the default here (Guard only fires on a
  changed surface), so the kill gate is satisfied by construction.

### 6. Static and offline; never executes the target (I-06)

Guard walks and parses files. It never executes a scanned MCP server or agent tool, never
touches the network in the verdict path, and is deterministic given the same repo state
and clock — the same invariants the shipped `scan`/`verify` hold.

## Consequences

- **Positive**: retention (Engine 2) ships with zero new schema surface and zero adoption
  risk; a repo gets automatic re-decision at every authority change through a hook it can
  disable in one step. The decision logic lives in one audited place.
- **Cost**: one new top-level command (`guard`) with three sub-verbs
  (`guard` / `guard install` / `guard status`) and a small `.calllint/guard.json` flag file.
- **Risk**: hook noise → mitigated by silence-when-unchanged (the default *is* the kill
  gate's fallback) and one-key disable. A misread "guard broke = safe" → mitigated by §3
  fail-closed. Confusion with the per-call guard → mitigated by §Context's H1/H3 table and
  public copy that says "authority-change guard," never "runtime protection" (which stays
  reserved for the gated H3).

## Invariants preserved

`I-04` UNKNOWN/drift never silently becomes SAFE (Guard reuses `verifyApproved`, which
floors a moved surface to REVIEW and never collapses to SAFE) · `I-06` never executes the
target · no second verdict vocabulary (reuses `SAFE/REVIEW/BLOCK/UNKNOWN`) · no second
drift engine (reuses `verifyApproved`) · no `calllint.guard.*.v0` schema (that is ADR
0042/H3) · a guard self-failure never reads as a pass.
