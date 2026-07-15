# ADR 0041: Trust-Source Classification (`trustSource` on `calllint.authority.v0`)

**Status**: Accepted
**Date**: 2026-07-15
**Phase**: F (Static Toxic-Flow Analysis, → v1.5.0) — Milestone F0/F1
**Supersedes**: none
**Related**: [0035 Automated Trust Gateway & Authority Manifest](./0035-automated-trust-gateway-authority-manifest.md), [0040 Static Toxic-Flow Analysis](./0040-static-toxic-flow-analysis.md)

## Context

Toxic-Flow analysis (ADR 0040) needs to know the **trust class of the data source** at
the head of a path — "did this instruction/content come from the user, from local
project files, from a signed component, or from *untrusted public content / tool output /
another agent*?" The shipped `calllint.authority.v0` records `evidenceSource` (a
provenance *string*, e.g. `"SKILL.md:42"`) but has **no first-class, enumerated trust
classification.** Without it, a flow cannot distinguish `untrusted.public_content → send`
(a blocker) from `trusted.user_explicit → send` (routine).

This is new9's one genuinely-additive contribution to the *authority* object. Adding a
field to a shipped schema is a schema change, so per the CallLint contract it requires an
ADR.

## Decision

### 1. Optional, additive `trustSource` — non-breaking

Add an **optional** `trustSource` to each capability (and to each flow node). Because it
is optional and defaults to `unknown`, existing `calllint.authority.v0` manifests remain
valid — the schema id stays `calllint.authority.v0` (additive, not a bump). Closed
12-value vocabulary (unifies the two lists in new9):

```
trusted.policy            trusted.user_explicit     trusted.local_project
trusted.signed_component  unverified.component      untrusted.public_content
untrusted.tool_output     untrusted.peer_agent      untrusted.memory
sensitive.secret          sensitive.private_data    unknown
```

### 2. `unknown` never reads as trusted (I-04)

Absence of classification, or `unknown`, MUST be treated as *not trusted* by the policy
and by flow rules — it never silently enables an ALLOW/SAFE. Trust attaches to **data
provenance**, not to a whole tool forever (a tool that reads a public issue this call is
`untrusted.public_content` for that data, regardless of the tool's own trust).

### 3. Deterministic compiler mapping — derive what is derivable, default `unknown`

`@calllint/static-analyzer` maps each capability to a `trustSource` as a **deterministic
function of the already-captured `(action, resource, scope, destination, evidenceSource,
pattern)`** — same input → byte-identical classification. Any non-`unknown` class MUST be
justified by the evidence that already grants the capability (I-07); a class that cannot
be *deterministically* established from the shipped signals is left `unknown` (fail-safe,
§2). Concretely, against the shipped compilers today:

- `read × secret` (secret-shaped env key / `sensitive-file-read` pattern) → `sensitive.secret`.
- config-derived capability cited to `server.command` / a local project path → `trusted.local_project`.
- capability granted by an explicit user/policy configuration surface → `trusted.user_explicit` / `trusted.policy`.
- everything not deterministically establishable → **`unknown`**.

**Scope boundary (calibration, not a v1.5.0 blocker).** The shipped Authority Manifest
models *capabilities* (`connect × network` to an external host, `read × secret`), not a
first-class **inbound-untrusted-content read** (e.g. "the body this tool reads is a public
GitHub issue"). So `untrusted.public_content` / `untrusted.tool_output` /
`untrusted.peer_agent` cannot yet be produced with full precision from the shipped
signals; capabilities that would carry them default to `unknown` until a dedicated
inbound-provenance signal is calibrated. This is an explicit **F1 calibration item**, not a
release blocker: because `unknown ↛ trusted` (§2), a flow rule whose source cannot be
classified stays out of the dangerous class — it neither false-BLOCKs nor false-SAFEs. The
corpus fixtures that exercise `untrusted.*` sources supply the classification directly (as
the manifest already may), so CL-FLOW rules are testable at F3 before the inbound signal
lands.

## Consequences

- **Positive**: unlocks Toxic-Flow (ADR 0040) with a small, closed, auditable field;
  aligns with OpenAI/Anthropic source-sink guidance and MCP token-provenance rules.
- **Cost**: one optional field + compiler mapping + fixtures; no verdict change. A follow-on
  inbound-untrusted-content signal (F1 calibration) sharpens the `untrusted.*` classes.
- **Risk**: mis-classification → mitigated by defaulting to `unknown` (fail-safe) and
  requiring evidence for any non-`unknown` classification.

## Invariants preserved

`I-04` unknown-trustSource↛SAFE · `I-07` evidence mandatory for a non-unknown class ·
additive schema field (existing manifests still validate) · no new action/resource enum ·
determinism: unclassifiable → `unknown`, never a guess.
