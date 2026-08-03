# Current authority map — who is allowed to decide, and who is allowed to write

Workstream R Batch-0 reality audit (new15 Execution Plan §6.5). ADR **0061**.
Measured 2026-08-02 against `main` at `84f56c5`, clean tree. Every `path:line` below was
read from the file at that commit.

## The gate this artifact exists to satisfy

`docs/new15-execution-status.md:203` states R-0's gate verbatim:

> no code change; `ci:local` green; every blueprint path bound to a real file;
> **one-writer proven (`current-authority-map.md`)**; compiler-write count = 0

And the Batch-0 instruction adds: *"Stop if one writer cannot be identified."*

**The gate is MET, and it is met by resource class rather than by count.** That
distinction is not a convenience — it is the difference between a true pass and a false
stop. Read below.

## Result

| Authority | Owner | Duals? |
| --- | --- | --- |
| Verdict decision | `packages/risk-engine/src/computeVerdict.ts:21` `computeVerdict` | no — single |
| Policy decision | `packages/policy/src/applyPolicy.ts:24` `applyPolicy` | no — single |
| Scan (evidence production) | `packages/core/src/scanServer.ts:27` `scanServer` | no — single |
| **Live host-CONFIG write** | `packages/install-planner/src/applyEngine.ts:99` `applyPlan` | **yes — one OS-registration writer alongside** |
| Plan digest (sealing) | `packages/install-planner/src/buildPlan.ts:112` | **yes — one per plan kind** |
| Rollback | `packages/install-planner/src/applyEngine.ts:224-240` | **yes — one per resource class** |

Six authorities. Three are strictly single-owner. Three are **dual on exactly the same
axis**: host configuration versus OS registration. The axis is not an accident of
history; ADR 0057 introduced it deliberately and wrote down that it must be preserved.

## 1. Verdict — one engine, one function, no second path

`computeVerdict` at `packages/risk-engine/src/computeVerdict.ts:21` is the only verdict
producer. It is reached through exactly one wrapper, `assessServer`
(`packages/risk-engine/src/assessServer.ts:62`, calling `computeVerdict` at `:66`), and
that wrapper has **two call sites in the entire non-test tree**, both inside one file:

* `packages/core/src/scanServer.ts:36` — the live assessment
* `packages/core/src/scanServer.ts:44` — a deliberate **re-computation** of the
  offline-only verdict, compared at `:45` so that online enrichment can never *lower* a
  verdict. The second call is a guard, not a second decision.

Grep for `computeVerdict` across `packages/*/src` and `apps/*/src` outside `risk-engine`
returns exactly one hit, and it is a **comment** at
`packages/agent-triggers/src/recommend.ts:9` documenting that the module only translates
a verdict it did not decide. INV-01 holds: no second verdict engine.

**What this binds for Workstream R.** ADR 0061 §4 forecloses the graph from carrying a
verdict field of its own. The compiler decides *identity*; `computeVerdict` decides
*risk*. A compiler that emitted its own verdict would be the second engine INV-R2
rejects.

## 2. Policy — one applier

`applyPolicy` at `packages/policy/src/applyPolicy.ts:24`. Exactly one non-test call site:
`packages/core/src/scanServer.ts:53`. Loading is separate
(`packages/policy/src/loadPolicy.ts:14` `loadPolicyFile`, `:35` `loadPolicyOrDefault`) and
loading is not deciding. INV-R2's "no second policy engine" holds.

## 3. Scan — one entry per input shape, one evidence producer

`packages/core/src/scanServer.ts:27` `scanServer` is the pipeline that turns a resolved
binding into a `ScanReport`. `scanConfigFile`/`scanConfigText`
(`packages/core/src/scanConfig.ts:72`, `:77`) and `scanDocumentSurfaces`
(`packages/core/src/scanSurfaces.ts:14`) are input adapters that funnel into it, not
parallel scanners.

**The compiler is downstream of this, never a replacement for it** (ADR 0061 §2, §5).

## 4. Live configuration write — the gate line, and why a count would fail it

### The measurement

`packages/install-planner/src/applyEngine.ts:99` `applyPlan` is the **only** writer of
host configuration. Every filesystem write in the whole install/gateway surface is inside
that one function:

| Site | Purpose |
| --- | --- |
| `applyEngine.ts:202` | write the backup before touching anything |
| `applyEngine.ts:211` | write the new config to a temp file, then fsync + rename |
| `applyEngine.ts:235` | write the **original** bytes back during rollback |

(`packages/install-planner/src/nodeFsPort.ts:11,26` is the injected `fs` port — a
capability adapter, not a call site.)

`applyPlan` is never called directly by an edge. Adapters re-export it
(`packages/install-planner/src/adapters/claudeCode.ts:36`) and the edges go through the
adapter: `apps/cli/src/commands/trust.ts:756`,
`packages/calllint-mcp/src/tools.ts:668`. A Tier-A adapter is the only route in.

### The second writer, disclosed

`packages/core/src/gateway/urlHandlerWriter.ts:84` `applyUrlHandler` also writes — but it
writes **OS URI-scheme associations**, never host configuration. Its own docblock at
`:5-8` says so:

> `applyPlan` … remains the only writer of host CONFIG: … a registry value or an XDG
> mimeapps association is neither.

Measured, not taken on trust: grep for `mcp.json`, `settings.json`, or `mcpServers` in
`urlHandlerWriter.ts` returns **no hit**. Its capability interface is narrow by
construction — `:28` documents "there is no `exec`, no `spawn`", and `HandlerRegistry`
(`:32`) exposes only read/write/remove over a registry value or a
`scheme=desktopFile` association (`:76`).

### Why the class framing is the honest pass

A naive audit records `liveConfigWriters: 2` and trips *"Stop if one writer cannot be
identified"* — halting the workstream on a **false negative**, because the two writers do
not contend for a single resource. The opposite error is worse: recording
`liveConfigWriters: 1` and omitting `applyUrlHandler` would make this audit **less honest
than the ADR it audits**, since ADR 0057 put the second writer on the record itself.

ADR 0057:191 already settled the wording:

> "one writer" is now "one config writer plus one narrowly-scoped OS-registration
> writer", and that distinction has to be kept

So the recorded fact is:

```text
liveHostConfigWriters:    1   (applyPlan)
osRegistrationWriters:    1   (applyUrlHandler — disjoint resource class, disclosed)
contendingWriters:        0
```

**Gate line "exactly one live-config writer": MET.**

This is the same correction P-7 made when it replaced `bindingUnchanged: true` with a
measurement. A count is not a fact about authority; a resource class is.

### Compiler-write count

The gate's fourth clause is `compiler-write count = 0`. The compiler does not exist yet,
so the count is **0 by absence** — and ADR 0061 §3 fixes it at 0 by rule, with persistence
confined to `.var/calllint-adoption-index/`. R-1 is the first batch that could move this
number, and it may not.

## 5. Plan digest — one sealer per plan kind

| Plan kind | Sealer |
| --- | --- |
| Install plan | `packages/install-planner/src/buildPlan.ts:112` — `planDigest: hashJson(sealed)` |
| URL-handler plan | `packages/core/src/gateway/urlHandlerWriter.ts:42` `planDigest` |

Two sealers, one per plan kind, splitting on the **same** config-vs-registration axis as
§4. Neither can seal the other's plan. The install side also ships the inverse check —
`verifyPlanDigest` at `buildPlan.ts:115-118` recomputes and compares, which is what makes
a sealed plan tamper-evident rather than merely hashed.

## 6. Rollback — one per resource class, both restoring captured prior state

| Resource class | Rollback owner | Mechanism |
| --- | --- | --- |
| Host config | `packages/install-planner/src/applyEngine.ts:224-240` | backup-then-restore; writes the original bytes to a temp file, fsyncs, renames, then **re-digests the result and compares to the pre-apply digest** (`:238`). Mismatch ⇒ `ROLLBACK_REQUIRED`, stated plainly, never reported as success |
| OS registration | `packages/core/src/gateway/urlHandlerWriter.ts:139` `rollback` | restores captured prior values **in reverse order** and returns the labels it could not restore |

Both fail loudly rather than optimistically. Neither claims a removal it did not perform
(INV-2.4-08). The config side even handles the create-from-nothing case explicitly
(`applyEngine.ts:225-233`): with no original bytes to restore, it removes its own write
and verifies the absence.

## 7. Guard state has no package owner, and one nearby file is easy to mislabel

No module under `packages/*/src` owns persisted Guard state. The authority is split:

* edge: `apps/cli/src/commands/guard.ts:87` `guardCommand`
* drift logic: `packages/core/src/state/continuousGuard.ts:65` `assessGuardDrift`
* offer surface: `packages/core/src/gateway/continuousProtection.ts:243`
  `continuousProtectionOffer`
* agent surface: `packages/calllint-mcp/src/tools.ts:1326`
  `calllint_enable_continuous_guard`

**`packages/evidence/src/model/stateMachine.ts` is NOT the Guard state machine.** It is the
**resolution** state machine (`canTransition`, `isTerminal`, `stateFromResolverStatus`),
and ADR 0061 §10 names it as the file the compiler must **generalize** to cover INV-10's
seven terminal states. Labelling it as the Guard-state owner would do two kinds of damage
at once: it would send a batch to generalize the wrong file, and it would imply Guard
state is already modelled when it is not.

## What this map does not claim

It does not claim the authority *distribution* is ideal. It records who holds each
authority today, with the evidence, so that a later batch cannot introduce a second
verdict engine, a second policy engine, or a third writer by accident — and so that the
two legitimate duals are not mistaken for drift and "fixed" into a single owner that
cannot serve both resource classes.
