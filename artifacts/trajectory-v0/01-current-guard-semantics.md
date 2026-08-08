# 01 — Current Guard semantics

Answers T0 question 1: *what is the real schema of Guard Request and Guard Decision today?*

**Status: `PARTIAL`.** The names exist, as a paper contract in two ADRs, with **zero**
implementation. A real request/decision pair exists under different type names and is fully
implemented. Both halves of that sentence are load-bearing: a search for the ADR names finds the
contract and misses the code, and a search for the code finds no "Guard" anything.

## The paper contract

| Claim | Binding | Measured |
| --- | --- | --- |
| The schema IDs are named in ADR prose | [adrs/0051-preflight-hook-boundary.md:26-27](../../adrs/0051-preflight-hook-boundary.md#L26-L27) | `calllint.guard.request.v0` / `calllint.guard.decision.v0`, described verbatim as existing "on paper precisely so that a future blocking gate has a schema" |
| ADR 0045 assigns them to the runtime axis | [adrs/0045-continuous-guard-command-and-hook.md:26](../../adrs/0045-continuous-guard-command-and-hook.md#L26) | Object column: `calllint.guard.request/decision.v0`, on the per-tool-call side of a two-column table |
| Neither name is a code symbol | `git grep "GuardRequest\|GuardDecision" -- packages/ apps/` | **0** matches |
| Neither is a schema file | `ls schemas/` | 30 files, none named `guard.request` or `guard.decision` |

ADR 0045:27-28 is the reason this matters more than an unimplemented type usually would. It
records that the runtime axis would carry **"a distinct action-time enum (never `SAFE`)"** and is
**"necessity-gated, experimental"**, where the change-time axis is unconditional and reuses the
shipped enum. So the paper contract is not a stub of the implemented path — it is a deliberately
*different* vocabulary that was never built. Anything that treats `calllint.guard.decision.v0` as
"the decision type, pending implementation" would be importing an enum the repo has never had.

## The implemented pair

What actually flows today, measured:

**Input — `ActionDescriptor`**, at
[packages/action-analyzer/src/types.ts:10-25](../../packages/action-analyzer/src/types.ts#L10-L25):

| Field | Shape | Note |
| --- | --- | --- |
| `schema_version` | `string` | `"calllint.action.v0"` for this implementation |
| `kind` | `ActionKind` | closed vocabulary, 9 values |
| `parameters` | `Record<string, unknown>` | kind-specific: recipient, amount, target, scope |
| `metadata?` | `ActionMetadata` | observed only: header keys, hashes, lengths, OAuth scopes |
| `provenance?` | `ActionProvenance` | see [05](05-existing-state-and-receipt-map.md) — this is where Q6's answer lives |

**Output — `TrustDecision`**, at
[packages/types/src/trustDecision.ts:37-59](../../packages/types/src/trustDecision.ts#L37-L59). Its
23 lines carry four properties worth naming because a Trajectory design would have to preserve
them:

1. **Three digests bind the decision to what it decided over** — `artifactDigest` (object 1,
   `null` only when the target is unpinned), `authorityDigest` (object 3, "binds the exact
   inventory decided over"), `policyDigest`. A decision is not a free-floating verdict; it names
   its own inputs.
2. **`unknowns: string[]` exists so silence cannot read as SAFE** — the field's own comment says
   so. This is the schema-level expression of product principle 2.
3. **`completeness: AuthorityCompleteness`** records whether the decision was made over complete
   or partial authority. A partial decision is representable rather than suppressed.
4. **`digest` is sha256 over the object minus `digest`** — self-describing, via `hashJson`.

`evidenceDigests` is annotated **"Provenance only"**, which is the boundary between evidence that
is recorded and evidence that decides. Deterministic rules decide (principle 4); external evidence
is carried, not consulted.

## What "PARTIAL" means precisely here

Not "half-built". The measured state is:

- A **request** type: `EXISTS`, implemented, under a different name than the ADRs use.
- A **decision** type: `EXISTS`, implemented, under a different name, over a different enum than
  the paper contract specifies.
- The **paper contract** itself: `ABSENT` as code, `EXISTS` as prose, and deliberately so — ADR
  0051:26-27 states the reason.

The gap a Trajectory design would face is therefore not "implement `GuardRequest`". It is: decide
whether the action-time axis reuses `TrustDecision` (which would import `SAFE` into a runtime path
ADR 0045:27 says must never carry it) or instantiates the paper contract (which would create a
second decision vocabulary — see [07](07-overlap-second-engine-risk.md)). That is a T1 decision
with an ADR, not a T0 finding.

## What this chapter does not claim

- No measurement of whether `ActionDescriptor` is *sufficient* for trajectory work. It records
  what the type contains, not what a future feature would need.
- `ActionKind`'s 9 values are named as a count, not enumerated — the count is what bears on the
  "closed vocabulary" property. See [03](03-verdict-disposition-map.md) for the vocabularies that
  do get enumerated, because there the individual values are the finding.
