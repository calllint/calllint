# Authority Model v2 — Repository Reality Mapping

`docs/new21.md` proposes an architecture freeze around a five-layer authority model:

```
Identity → Trigger → Execution → Tool → Effect
```

Its own closing paragraph says not to implement it directly, and to first map the real
tree onto the model so an architecture upgrade does not damage a working baseline. That is
what this file is. `docs/` is gitignored (`.gitignore:44`), so the proposal itself is not
in version control and a reviewer cloning this repo cannot read it — this file is tracked
and states the conclusions it produced.

Measured 2026-08-25 against `HEAD`. Every "already exists" claim below names the file.

## The headline: v2 is an alignment job, not a build job

The proposal reads as if the five layers are new vocabulary to introduce. Measured against
the tree, **three of the five already ship**, one ships under a colliding name, and one is
genuinely absent. So the risk this freeze actually carries is not under-building — it is
introducing a second vocabulary beside a shipped one.

| v2 layer | Status in this repo | Where |
|---|---|---|
| Identity | **Ships, unnamed as such** | `TRUST_SOURCES` (12 values) in [authority.ts](../packages/types/src/authority.ts) — `trusted.user_explicit`, `sensitive.secret`, `untrusted.peer_agent`, … This *is* provenance-of-authority. ADR 0041. |
| Trigger | **Name collision — see below** | [`packages/agent-triggers/`](../packages/agent-triggers/src/taxonomy.ts), 10 `TRIGGER_IDS`, wired into `apps/cli/src/commands/integrate.ts` |
| Execution | **Ships, as resources** | `AUTHORITY_RESOURCES` includes `process`, `filesystem`, `configuration`; `AuthorityCapability.scope` carries the where |
| Tool | **Ships, and is the mature layer** | `AuthorityCapability` = `action × resource`; 9 `AUTHORITY_ACTIONS` × 10 `AUTHORITY_RESOURCES` |
| Effect | **Absent, correctly** | Nothing normalizes "different tools, same consequence". §5 marks it `RESERVED` / `DEFERRED`; it is the one layer where the proposal and the tree agree. |

## The finding that changes the freeze: `Trigger` already means something else

`packages/agent-triggers/src/taxonomy.ts` defines `TRIGGER_IDS` — ten entries, stable
strings, explicitly "part of the contract and must not be renamed without an ADR", and
consumed by `calllint integrate`.

Its `Trigger` and new21's `Trigger` are **not the same concept**:

| | `agent-triggers` (shipped) | new21 §Layer 2 |
|---|---|---|
| Answers | *When should CallLint surface a preflight?* | *What event started the agent?* |
| Examples | `grant-shell-exec`, `expose-secrets`, `financial-action` | GitHub PR event, Slack message, cron timer |
| Nature | An authority-**expanding operation** | An **execution entry point** |

Both are legitimate. But adopting new21's word as-is puts two incompatible meanings on one
term in one product, in a repo whose dominant fault class is a guard that cannot observe
its subject — and a reader who resolves `Trigger` to the wrong one of these does not get
an error, they get a wrong mental model that survives review.

**Recommendation, if this freeze proceeds:** new21's Layer 2 is named `Entrypoint`, and
`Trigger` keeps its shipped meaning. This costs one word in a doc and preserves an
ADR-protected contract. It is a naming decision, so it is the user's to make — recorded
here rather than acted on.

## What §9's three phases actually cost

**Phase A — vocabulary alignment.** Cheap only if it does not duplicate. `AuthorityLayer`
as a 5-value enum is additive and harmless. `AuthorityObservation` overlaps
`AuthorityCapability` heavily — same evidence discipline, same confidence field, same
completeness field. Adding it as a *second* record type risks two inventories of the same
facts.

> **Correction, same day.** This section first proposed the smaller change as "a `layer`
> field on the existing `AuthorityCapability`, derived deterministically from
> `(action, resource)`". That does not work, and the check that killed it was working five
> concrete rows by hand: `read × secret`, `execute × process`, `delegate × agent`,
> `send × message`, `spend × financial` — **all five derive `tool`**. They must, because the
> table above already found that `AuthorityCapability` *is* the Tool layer. A field that is
> always `"tool"` carries no information, which makes it the very defect the next section
> warns about. The other four layers are aspects *of* a capability that neighbouring fields
> already carry (`trustSource` = Identity, `scope` = Execution) or that nothing carries
> (Effect). So Phase A reduces to **the exported enum and nothing else** — no field, no
> record, no schema change. Sequenced in
> [NEW21_SEQUENCING_PLAN.md](../architecture/NEW21_SEQUENCING_PLAN.md) Step 1.


**Phase B — mapping tests.** Real work, low risk, and the highest-value part of the
proposal: it pins the mapping table above so it cannot silently drift. Acceptance criterion
A ("existing scans produce identical verdicts") is already enforceable by the golden
fixtures — a mapping that changes any verdict fails `pnpm test` today.

**Phase C — boundary regression.** This is where the proposal is strongest and the tree is
weakest. §6 mandates `UNKNOWN != SAFE`, and the repo agrees — `VERDICT_SEVERITY` puts
`UNKNOWN` (2) above `REVIEW` (1) precisely so insufficient evidence cannot read as merely
needing review. But §5's `state` vocabulary is `OBSERVED | UNKNOWN | UNSUPPORTED`, and
**`UNSUPPORTED` does not exist anywhere in `packages/types/src`** (grepped: zero hits).
The nearest shipped thing is `supportClass`
(`NATIVE | CONFIG_SCAN | DISCOVERY_ONLY | DEFERRED`) in
`apps/web/data/distribution-surfaces.schema.json` — which describes *host distribution
support*, not authority observability. So `UNSUPPORTED` is genuinely new, and it is the
only genuinely new state in the proposal.

## What must not happen

The proposal's §8 constraints match this repo's existing rules, with one addition measured
here: **do not let `AuthorityObservation` become a parallel schema.** `AuthorityManifest`
is consumed by 14 non-test modules (`policy/decideOverAuthority.ts`,
`core/gateway/prepare.ts`, `flow-analyzer/buildFlows.ts`, `trust-index/evidenceManifest.ts`,
…). A second observation record that those modules do not read is documentation wearing a
type signature — the same defect class as `scan --config` being advertised on 8 surfaces
while nothing read it.

## Verdict on the freeze

Acceptance criteria A–F are all satisfiable, and D ("Cursor Cloud Agent support boundary
accurately represented") is worth having: Cursor's cloud triggers are real authority this
product cannot statically observe, and saying so as `UNSUPPORTED` is more honest than the
current silence. The proposal's judgment is sound.

Its cost is lower than it looks (three layers exist) and its risk is different from what it
states (the danger is vocabulary duplication, not scope creep). Nothing in it is urgent:
no shipped behavior is wrong today, and §10.A requires that no verdict change. So this is
a P0 *alignment* item, not a P0 *build* item — and it should land as its own ADR after the
naming question above is settled, not folded into distribution work.
