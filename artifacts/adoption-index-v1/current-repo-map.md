# Current repo map — the 21 named subsystems, bound to real code

Workstream R Batch-0 reality audit (new15 Execution Plan §6.1). ADR **0061**.
Measured 2026-08-02 against `main` at `84f56c5`, clean tree. Every `path:line` in this
document was read from the file at that commit, not copied from a planning document.

**Why this artifact is authoritative over the blueprint.** Blueprint v1.4 §2 states it
directly: *"If current file paths differ from the blueprint, Phase 0/current-state
artifacts are authoritative."* Every later R batch reads this file to decide what to
build. A compiler batch that started from blueprint prose would build against paths
that moved three phases ago.

## Result

| | |
| --- | --- |
| Subsystems named by §6.1 | **21** |
| `EXISTS` | **20** |
| `PARTIAL` | **1** (#4 — see below) |
| `ABSENT` | **0** |
| Genuine forks (one capability, two real owners) | **5** (#4, #11, #14, #20, #21) |

**Nothing in §6.1 is vapour.** The headline finding of this audit is not a gap list —
it is that all 21 subsystems the plan names already exist in committed code. What the
plan calls "build" is, for §6.1, largely "bind and generalize".

The five forks are the second finding, and they are the reason
`current-symbol-bindings.json` extends §6.2's example schema with an optional
`bindings[]` array. §6.2's example gives one scalar `path` and one scalar `symbol` per
row. For these five, naming one owner would lose the fact that a second exists, and
inventing a composite path would be fiction. Both failure modes point every later
batch at the wrong file, so the schema was extended rather than the truth flattened.

## Layer 1 — Registry ingestion

| # | Subsystem | Binding | Status |
| --- | --- | --- | --- |
| 1 | Registry fetch | `packages/trust-index/src/fetchRegistry.ts:90` `fetchRegistrySnapshot` | EXISTS |
| 2 | Snapshot schema | `packages/trust-index/src/snapshot.ts:43` `RegistrySnapshot` (parser `:62` `parseSnapshot`, namespace `:54` `REGISTRY_NAMESPACE`) | EXISTS |
| 3 | Registry → cohort conversion | `packages/trust-index/src/registryCohort.ts:49` `registryCohort` | EXISTS |

## Layer 2 — Evidence resolution

| # | Subsystem | Binding | Status |
| --- | --- | --- | --- |
| 4 | Evidence resolution | **FORK** — script `packages/trust-index/src/resolveEvidence.ts:40` `remoteSubjects` · engine `packages/resolver/src/evidence/resolveSubject.ts:17` `resolveSubject` + `packages/resolver/src/evidence/index.ts:32` `P1_RESOLVERS` | **PARTIAL** |

**#4 is the one PARTIAL, and the distinction is load-bearing.**
`resolveEvidence.ts` is a *script*, wired as an npm script in
`packages/trust-index/package.json:19` and run with `tsx`. Its only export is
`remoteSubjects`; the orchestration lives in a **non-exported** `main()` at `:48`.

The reusable engine is elsewhere: `resolveSubject` behind ADR 0034's provider
interface, with `P1_RESOLVERS` as its registry. A later batch that bound "evidence
resolution" to `resolveEvidence.ts` alone would be pointing at a `main()` it cannot
import — the binding would look correct and fail at the first `import`. `PARTIAL`
records that the capability exists but is not yet reachable as a schedulable unit,
which is exactly what the rolling compiler needs it to become.

## Layer 3 — Baking and rendering

| # | Subsystem | Binding | Status |
| --- | --- | --- | --- |
| 5 | Baked Trust object | `packages/trust-index/src/bakeTrustPage.ts:118` `bakeTrustPage` (type `:66` `BakedTrustPage`) | EXISTS |
| 6 | Trust HTML / JSON rendering | `packages/trust-index/src/renderPage.ts:256` `renderHtml` · `:146` `renderSidecar` | EXISTS |
| 7 | Install HTML / contract rendering | `packages/trust-index/src/renderSafeInstall.ts:559` `renderSafeInstall` · `:643` `renderSafeInstallContract` | EXISTS |
| 8 | Lookup index | `packages/trust-index/src/renderLookup.ts:72` `renderLookupIndex` (page `:154` `renderLookupPage`) | EXISTS |

## Layer 4 — Agent-facing surfaces

| # | Subsystem | Binding | Status |
| --- | --- | --- | --- |
| 9 | Safe Search committed index | `packages/calllint-mcp/src/committedLookup.ts:43` `COMMITTED_LOOKUP_ENTRIES` | EXISTS |
| 10 | MCP tool registry | `packages/calllint-mcp/src/tools.ts:939` `TOOLS` (lookup `:1350` `TOOLS_BY_NAME`) | EXISTS |

**#10 is a held invariant, not a growth surface.** The shipped surface is **13 tools
and 19 resources**, asserted by `pnpm pack:smoke:mcp`. new15 adds **zero** MCP tools
of its own. A compiler batch that adds a tool has changed a number a distribution
smoke test pins.

## Layer 5 — The Trust Gateway (the write path)

| # | Subsystem | Binding | Status |
| --- | --- | --- | --- |
| 11 | Gateway prepare | **FORK** — general `packages/core/src/gateway/prepare.ts:134` `prepare` · safe-install `packages/core/src/gateway/prepareSafeInstall.ts:137` `prepareSafeInstall` | EXISTS |
| 12 | Gateway apply writer | `packages/install-planner/src/applyEngine.ts:99` `applyPlan` | EXISTS |
| 13 | Install-plan schema | `packages/types/src/installPlan.ts:65` `InstallPlan` (version `:98` `INSTALL_PLAN_SCHEMA_VERSION`; JSON Schema `schemas/install-plan.schema.json`) | EXISTS |
| 14 | Receipt schema | **FORK** — v1 `packages/types/src/decisionReceipt.ts:89` `DECISION_RECEIPT_SCHEMA = "calllint.receipt.v1"` (built by `packages/install-planner/src/decisionReceipt.ts:61` `buildDecisionReceipt`) · v0 `packages/core/src/receipt/types.ts:17` `"calllint.receipt.v0"` (`createReceipt.ts:55`) | EXISTS |
| 15 | Host adapter registry | `packages/install-planner/src/index.ts:82` `HOST_ADAPTERS` (accessor `:91` `getHostAdapter`) | EXISTS |

**#11's fork is a delegation, not a duplication.** Both return `TrustPreparation`
(`packages/types/src/trustGateway.ts:75`). `prepareSafeInstall` is the path the CLI
and MCP `calllint_prepare_safe_install` both delegate to (re-exported at
`packages/core/src/index.ts:173`) — one source, two surfaces. Recording only `prepare`
would point a batch at the general path when the safe-install path is the one under
test.

**#12 is never called directly by an edge.** The adapters re-export it (e.g.
`packages/install-planner/src/adapters/claudeCode.ts:36`) and the call sites go
through the adapter (`apps/cli/src/commands/trust.ts:756`,
`packages/calllint-mcp/src/tools.ts:668`). A Tier-A adapter is the only writer.

**#14's fork is two live schemas, not a migration in progress.** v1 is the install
decision receipt; **v0 still ships** for `scan --receipt`. Two JSON Schemas exist:
`schemas/decision-receipt.schema.json` and `schemas/receipt.schema.json`. Flattening
this row to "one receipt schema" would license deleting a live surface.

**#15 is declared in the barrel, not in the interface file.**
`packages/install-planner/src/hostAdapter.ts:78` holds only the `HostAdapter`
interface. Five adapters are registered: claudeCode, claudeDesktop, cursor, vscode,
windsurf.

## Layer 6 — CLI commands and host integration

| # | Subsystem | Binding | Status |
| --- | --- | --- | --- |
| 16 | Guard | `apps/cli/src/commands/guard.ts:87` `guardCommand` · drift `packages/core/src/state/continuousGuard.ts:65` `assessGuardDrift` · offer `packages/core/src/gateway/continuousProtection.ts:243` `continuousProtectionOffer` · MCP `tools.ts:1326` `calllint_enable_continuous_guard` | EXISTS |
| 17 | Integrate | `apps/cli/src/commands/integrate.ts:89` `integrateCommand` | EXISTS |
| 18 | Plugin hook | `plugins/calllint/hooks/preflight-core.mjs:119` `preflightFor` (wired via `plugins/calllint/hooks/hooks.json:9` → `preflight.mjs`) | EXISTS |

**Guard state does not live in a package, and one nearby file is easy to mislabel.**
No `packages/*/src` module owns persisted Guard state — the edge is the CLI command,
the drift logic and offer surface are in `@calllint/core`.

`packages/evidence/src/model/stateMachine.ts` is **not** Guard's state machine. It is
the **resolution** state machine (`canTransition`, `isTerminal`,
`stateFromResolverStatus`), and it is the file ADR 0061 §10 says the compiler should
*generalize* to cover INV-10's seven terminal states. Labelling it as the Guard-state
owner would send a batch to generalize the wrong file and, worse, would suggest Guard
state is already modelled when it is not.

**#18 has a hand-authored `.d.mts` sidecar.** `tsc` reads it, so a new export from
`preflight-core.mjs` must be declared there too.

## Layer 7 — Publication and observability

| # | Subsystem | Binding | Status |
| --- | --- | --- | --- |
| 19 | Public-copy guard | `scripts/check-public-copy.mjs` — top-level script, **no export** (enforced at `.github/workflows/public-facts-consistency.yml:46`) | EXISTS |
| 20 | Generated static deployment | **FORK** — producers `packages/trust-index/src/bake.ts:121` `DEFAULT_OUT` + `apps/web/scripts/sync-assets.mjs` · deployer `.github/workflows/deploy-web.yml:85` `wrangler pages deploy public` | EXISTS |
| 21 | Telemetry event contracts | **FORK** — `packages/telemetry-contract/src/events.ts:11` `ALLOWED_EVENTS` (`EVENT_VERSION:56`, `sanitizeEvent`) · `packages/trust-event-contract/src/events.ts:31` `TRUST_EVENTS` (`TRUST_EVENT_VERSION:21`) | EXISTS |

**#20's fork is produce-vs-deploy, and both halves matter.** The producers write into
`apps/web/public/`; the workflow deploys that directory. `deploy-web.yml` also gates
on `pnpm ledger:presentation:validate:offline` at `:114`. Binding only the producer
would hide the deploy gate; binding only the workflow would hide who writes the bytes.

**#21 is two independent closed vocabularies, not one contract in two files.**
`ALLOWED_EVENTS` and `TRUST_EVENTS` have separate version constants and separate
allow-lists. Emission is a *third* package: `packages/telemetry-emit/src/emitter.ts:70`
`createEmitter`. Recording one would make a later batch believe an event name is
allowed when its vocabulary does not contain it.

## What this map does not do

It does not grade whether each subsystem is *sufficient* for the rolling compiler —
that is `current-capability-matrix.json` (§6.4) and `current-gaps.md` (§6.6). It does
not assign authority; that is `current-authority-map.md` (§6.5). It states only what
exists, where, and under which symbol, so that no later batch has to guess.
