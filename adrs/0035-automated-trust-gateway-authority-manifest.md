# ADR 0035: Automated Trust Gateway & Authority Manifest

**Status**: Accepted
**Date**: 2026-07-13
**Phase**: G (Automated Trust Gateway Core, v1.3.0) — Milestone G0
**Supersedes**: none
**Related**: [0034 Evidence Provider Envelope](./0034-evidence-provider-envelope.md), [0036 Install Plan & Approval Binding](./0036-install-plan-approval-binding.md), [0037 Host Adapter Safety Contract](./0037-host-adapter-safety-contract.md), [0038 Public Trust Index Boundaries](./0038-public-trust-index-boundaries.md)

## Context

CallLint is evolving from "a scanner you run" into an **Automated Trust Gateway**: the
deterministic step that decides whether *this* authority is acceptable under *this*
policy in *this* environment, at the moment a user grants an unfamiliar agent tool
permission. See `docs/new8-master-plan.md` (apex v4) and `docs/new8-packet-g-trust-gateway.md`.

The gateway is a **gated state machine**, not one command that does everything:

```
trust prepare <target>   READ-ONLY: resolve → evidence → authority → decide → plan
        ↓ one digest-bound approval
trust apply --plan <p> --approve <plan-digest>   revalidate → atomic apply → verify → monitor
```

Before any gateway code exists, the invariants that make it *safe to embed* must be
ADR-locked. This ADR locks the read-only preparation half and the Authority Manifest —
the normalized model of what capability an artifact *requests*. ADRs 0036/0037/0038 lock
the apply half, the host contract, and the public-index boundary respectively.

This is a new schema family (`calllint.artifact.v1`, `calllint.authority.v0`) and a new
user-facing command surface, so per the CallLint contract it requires an ADR.

## Decision

### 1. Default read-only; `trust prepare` never touches a live config

`calllint trust prepare <target>` performs `DISCOVERED → PLAN_READY` and **writes zero
bytes to any path except (optionally) the plan file** under `.calllint/plans/`. It
resolves the target, collects evidence, normalizes authority, decides, and emits a plan
preview. It is the read-only half of the gateway and the default entry point.

### 2. Never execute the target

Neither `trust prepare` nor any code it calls may execute the artifact under evaluation,
run a README/install command, start a language runtime (node/python/docker), or spawn the
MCP server. This extends the Quick-Scan non-execution guarantee (ADR 0033 §6) to the
gateway. **A test asserts zero target-code execution.** Fetching bytes for resolution
(git clone --depth / npm pack / file read) is permitted; running them is not.

### 3. Artifact Identity pins *what* is evaluated — `calllint.artifact.v1`

Every gateway run begins by resolving the target to an immutable, digest-pinned identity:

```
schema: "calllint.artifact.v1"
sourceType: git | dir | file | npm | mcp-config
source:      the user-supplied locator
requestedRef: what the user asked for (e.g. "main")   // may be mutable
resolvedRef:  the immutable ref (commit sha / exact version)  // REQUIRED before FETCHED
digest:       sha256 of fetched bytes (tree hash for git/dir)
resolvedAt:   ISO timestamp, passed in from the CLI edge (never Date.now() in core)
```

A mutable ref (branch/tag/`latest`/`^1.0.0`) **must** be pinned to an immutable
`resolvedRef` before the state machine may leave `RESOLVED`. This kills branch/version
drift and is the anchor every downstream object binds.

### 4. Authority Manifest normalizes *what capability is requested* — `calllint.authority.v0`

All inputs (MCP config, `server.json`, action descriptor, instruction files) normalize to
one small, fixed vocabulary — CallLint does **not** invent a per-host security language:

```
actions    read · write · execute · connect · send · mutate · spend · delegate · persist
resources  filesystem · secret · process · network · database · message · financial ·
           identity · agent · configuration
```

Each capability carries `action · resource · scope · destination · mutability ·
reversibility · monetaryLimit · approvalRequirement · evidenceSource · confidence ·
completeness`, plus manifest-level `limits` (Safety-Budget: spend-per-call / spend-total)
and `approval.required`. Every capability names its `evidenceSource` (e.g.
`server.args[2]`, `SKILL.md:42`) — **no capability without a source**, mirroring the
"evidence mandatory for every finding" product principle.

### 5. UNKNOWN never auto-allows; less evidence never lowers risk

If authority cannot be fully determined, the affected capability is `completeness:
partial|degraded` and its `confidence` reflects that. Missing or degraded evidence
**tightens** the manifest (more `unknowns`, lower confidence) and can only raise the
downstream verdict, never lower it. `UNKNOWN` never auto-upgrades to `SAFE` — this is the
universal invariant carried from every prior plan.

### 6. Determinism

Pure core (resolver → authority normalization) must not call `Date.now()`,
`Math.random()`, or `new Date()`. Timestamps and ids enter from the CLI edge. `trust
prepare` run twice on the same immutable artifact yields **byte-identical core output**
(digests included). This is asserted by test.

### 7. Digest chaining

Digests are computed with `@calllint/fingerprint` `hashJson` over the canonical object
**minus its own `digest` field** (the shipped Evidence Envelope convention). Object N
stores the digest of object N−1. No new hashing primitive is introduced.

## Non-negotiables locked by this ADR

- `trust prepare` is read-only; the only writable path is the plan file.
- The target is **never** executed; no README/install command is ever run or parsed here.
- `resolvedRef` is required before FETCHED; mutable refs are always pinned.
- Authority uses the fixed action/resource vocabulary; no per-host dialects.
- Every capability carries an `evidenceSource`.
- UNKNOWN never auto-allows; degraded evidence never lowers the verdict.
- Pure core is deterministic (no wall-clock / randomness); repeat runs are byte-identical.
- No LLM in the verdict path (an LLM may summarize, never decide).

## Consequences

### Positive
- The read-only half is safe to run anywhere, including inside a host/CI, with no risk of
  side effects — the precondition for the "presence at the install decision node" thesis.
- One normalized authority model lets the same skill produce *different* verdicts under
  different policies/environments deterministically — the core moat.
- Digest pinning makes every preparation reproducible and re-verifiable.

### Negative
- Resolving mutable refs to immutable ones requires network for remote targets; offline
  runs of a branch target degrade explicitly (cannot pin ⇒ cannot leave RESOLVED).
- The fixed vocabulary will occasionally need extension; each extension is an ADR.

### Trade-offs
- Chose a **small fixed vocabulary** over expressive per-host modelling (auditability and
  cross-host comparability beat fidelity to one host's config dialect).
- Chose to **extend `@calllint/resolver`** rather than fork a gateway-only resolver (one
  coherent resolution path; see repo architecture rule).

## Compliance / gate impact

Corpus floor unchanged: **0 dangerous false-SAFE**, UNKNOWN ≤ 15%, offline default
byte-identical. This ADR adds capability, weakens no rule. Any future change to
`calllint.artifact.v1` or `calllint.authority.v0` requires a new ADR.
