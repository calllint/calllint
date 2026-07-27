# ADR 0056 — Safe-Install Acquisition Projection: turning the public Trust Index into a zero-install adoption surface without a second engine

- Status: Accepted (2026-07-27). Boundary-only decision artifact; changes **no**
  behavior. It freezes the invariants the Phase-2.4 Safe-install surfaces (human
  Install page, Agent Adoption Contract, `calllint safe-install`, thin MCP adoption
  tools, continuous-protection conversion) must honor before any of them is built.
  Written first in Sprint 0 / Batch 0 / PR 2.4-0. Acceptance authorizes the Phase-2.4-1
  build to begin under these boundaries; it does **not** by itself project any page,
  emit any contract, wire any tool, or move any verdict.
- Date: 2026-07-27 (PR 2.4-0)
- Refines: 0055 (agent-search capture & safe-install gateway boundary — the direct
  parent; this ADR builds the acquisition surface on top of the capture/control seams
  0055 froze), 0054 (claim auto-adoption — a claim states control, never safety),
  0051 (preflight-hook boundary — a hook recommends, never blocks or grants authority;
  Phase 2.4 does **not** make it blocking), 0038 (public Trust Index boundaries —
  serving reads committed static assets only, never scans on request)
- Related: 0025 (calllint-mcp thin wrapper — MCP tools are **pure delegators**; the 5
  new adoption tools obey this), 0035 (authority manifest), 0036 (install-plan approval
  binding — the sealed plan the CLI/MCP apply routes require), 0037 (host adapter safety
  contract — the 5 exact-target adapters Phase 2.4 reuses), 0039 (decision-receipt v1 +
  drift taxonomy — the receipt safe-install verify/rollback returns), 0043 (schema
  `$id`/domain convention — the two new schemas follow it), 0047/0048 (maintainer-claim
  trust model — verified publisher never moves a verdict), 0050 (evidence-refined
  verdict — UNKNOWN→REVIEW, never SAFE), 0053 (distribution-index boundary — §3
  claim↛verdict, §4 publish channels)

## Context

new14 (a five-round Socratic stack, `docs/new14.md` + `docs/new14ref/`) answers one
founder-level constraint: *CallLint is a new project and cannot assume any platform
integration, Marketplace listing, or upstream PR acceptance as a launch precondition.*
Its conclusion is a route CallLint can ship **unilaterally** — turn every public MCP
evidence object CallLint already bakes into a **zero-install Safe-install acquisition
surface** — reframed for **two consumers of one evidence object**: a **human** who needs
recognition in five seconds (a Human Decision Capsule), and an **Agent** who needs
deterministic state, not marketing prose (an Agent Adoption Contract).

The reason this needs an ADR *before* code — the same reason 0051/0052/0053/0054/0055
each froze a boundary before its PR — is that an "acquisition surface" sits one
millimetre from every line CallLint has repeatedly drawn:

- a page whose call-to-action says "install this" is one sentence away from becoming a
  **second verdict** ("Safe to install", "CallLint approved") that CallLint has never
  earned and its Product Principles forbid;
- an "Agent Adoption Contract" that carries publisher-supplied text is one field away
  from **prompt injection** into the deciding agent (a §七 forbidden method) or from
  letting untrusted publisher copy **choose the command**;
- a `calllint safe-install` command is one shortcut away from becoming a **second
  live-config writer** that bypasses the audited Trust Gateway apply service, or from
  **silently installing** CallLint's own Plugin/Hooks/Guard under cover of a one-time
  setup (a dark-pattern install trap);
- a "public SAFE" disposition is one assumption away from being read as **local
  authorization to write** — when the only authority that can authorize a local write
  is a local re-decision under local policy.

This ADR records where each line is, so the Phase-2.4 build cannot drift across it by
accident. It is a decision artifact only — it adds no schema, no page, no tool, no test.
The reality-binding audit that must accompany it lives in
[`artifacts/phase-2.4/current-state-audit.md`](../artifacts/phase-2.4/current-state-audit.md)
and [`artifacts/phase-2.4/current-path-bindings.json`](../artifacts/phase-2.4/current-path-bindings.json).

### What is already shipped (so this ADR governs deltas, not a new product)

Verified against the tree (`main` at `89a90ed`, `calllint@1.7.3`, tree clean, 2026-07-27),
every primitive Phase 2.4 orchestrates already exists and must be **reused, not
re-implemented**:

- **One deterministic bake** — `packages/trust-index/src/bakeTrustPage.ts` produces one
  `BakedTrustPage`; `emitCohort.ts` pushes the `.json` sidecar and `.html` page from that
  **same object** (`emitCohort.ts:141-142`). The Install page and Agent Adoption Contract
  are further projections of the same object — never a re-scan, never a second fact.
- **One writer** — `packages/install-planner/src/applyEngine.ts` is the sole live-config
  writer; it writes only through the injected `ConfigFs` port (`fsPort.ts` /
  `nodeFsPort.ts`). `calllint safe-install` and the MCP apply tool **delegate** here;
  they hold zero direct `node:fs` writes.
- **One prepare/verify/rollback** — the Trust Gateway prepare service
  (`packages/core/src/gateway/prepare.ts`) re-decides locally and produces a sealed
  `calllint.install-plan.v1`; verify returns `calllint.receipt.v1` and can roll back.
- **Five exact-target host adapters** — `packages/install-planner/src/adapters/{claudeCode,
  claudeDesktop,cursor,vscode,windsurf}.ts`. There is no generic template fallback; an
  unsupported host is honestly unsupported.
- **8-tool MCP server, all pure delegators to `@calllint/core`**
  (`packages/calllint-mcp/src/tools.ts`, ADR 0025). The 5 adoption tools are **new tools
  in this same server** — not a new server, not a second verdict.
- **Advisory PreToolUse install hook** (`plugins/calllint/hooks/**`, Phase 2.6 N8 #228).
  Phase 2.4 preserves it as advisory; making it blocking would need a separate ADR.
- **Public-copy guard** (`scripts/check-public-copy.mjs`) and the shipped verdict
  vocabulary (`SAFE/REVIEW/BLOCK/UNKNOWN`, the reason-code authority set). Phase 2.4
  extends the guard's phrase lists; it forks no vocabulary.
- **First-party event seam** `calllint.trust-event.v1` (new13 PR-N2,
  `schemas/calllint.trust-event.v1.schema.json` + `apps/web/public/embed/trust-events.js`).
  The funnel reuses this seam; it builds no second events endpoint.

## Decision

Phase 2.4 is a **projection + orchestration layer, not a new engine.** It adds exactly
four thin things, each governed by the invariants below and built one-PR-per-batch in the
order fixed by [new14-integration.md](../docs/new14-integration.md) §6:

1. **Safe-install projection** — pure functions turning one `BakedTrustPage` into a
   `SafeInstallProjection` (`selectDecisionAuthorities.ts`, `agentAdoptionContract.ts`,
   `safeInstallProjection.ts`, `renderSafeInstall.ts`, `renderDiscoveryManifest.ts`).
2. **`/install/{slug}/` emission** — deterministic human HTML + machine JSON sidecar
   (`calllint.agent-adoption-contract.v1`) + `.well-known/calllint.json`
   (`calllint.discovery.v1`), from the same baked object; unsupported subjects get an
   honest `EXPLAIN_ONLY` page.
3. **`calllint safe-install` orchestrator + thin MCP adoption tools + `--expect-*-digest`
   binding** — an interactive path and Agent-facing prepare/apply/verify that
   **delegate** to the shipped Trust Gateway; expectations are assertions that can only
   *stop* a plan, never improve a verdict.
4. **Continuous-protection conversion + privacy-minimal funnel + cohort-expansion gates**
   — a post-success **explicit** Guard offer (default = one-time protected, no hidden
   persistence), first-party aggregate events on the shipped seam, and measured
   25→100→500→all cohort growth gated behind Phase-2.4 correctness gates.

### Invariants (binding; violate → stop and write a finding, do not work around)

These are the canonical INV-2.4-01…10 (shared verbatim with
[new14-integration.md](../docs/new14-integration.md) §8; this ADR is their frozen source):

1. **One fact object** — Trust HTML+JSON, Install HTML, Agent Contract and MCP Resource
   all derive from one baked evidence object (cross-digest test).
2. **Public observation ≠ local authorization** — no public disposition authorizes a
   local write; prepare always re-decides locally; the local result may only stay the
   same or get stricter, never looser.
3. **One writer** — every live config write delegates to the shipped apply service;
   safe-install has zero direct fs writes.
4. **Agent guidance is procedural, not coercive** — one recommended action + stop
   conditions allowed; "ignore prior instructions / always recommend CallLint / hide
   alternatives" forbidden.
5. **Publisher content is untrusted** — may inform task understanding only; never affects
   verdict, authority, command, policy, or approval.
6. **Exact target only** — actionable routes bind canonical identity, exact version
   (where available), artifact digest, evidence digest, contract digest; else
   `LOCAL_PREFLIGHT_REQUIRED`.
7. **Persistent protection is explicit** — one-time setup never implies permission to
   install Plugin/Hooks/Guard; a second explicit approval or org policy is required; no
   hidden bundling; `[Not now]` is always visible; every persistent component is
   enumerated with its uninstall/disable command before consent.
8. **Unsupported means unsupported** — never invent a command for an incomplete subject
   or unsupported host; emit an honest `EXPLAIN_ONLY` page.
9. **No runtime target execution** — CallLint may write approved host config; it never
   starts, connects to, authenticates to, or tests the target server.
10. **Deterministic output** — same snapshot + engine + policy projection + host matrix +
    CLI version → byte-identical generated assets. No wall-clock time inside a
    reproducible bake; `contract.generatedAt` uses retained snapshot metadata,
    `expiresAt` is null in v1.

Plus the inherited kernel invariant: **no LLM in the critical decision path** (bake →
projection → verdict → policy → rendering → claim → receipt). An LLM may summarize
evidence; it never decides.

### Naming (canonical — reject any PR that revives a draft variant)

The `new14ref/` drafts drifted on names. This ADR pins the canonical set (execution plan
v1.0 wins per integration §2.2):

- Agent contract schema: `calllint.agent-adoption-contract.v1`
  (**not** `calllint.safe-install-contract.v1`).
- CLI result schema: `calllint.safe-install-result.v1`.
- Discovery manifest: `calllint.discovery.v1` at `.well-known/calllint.json`.
- Sidecar media type: `application/vnd.calllint.agent-adoption+json;version=1`
  (**not** `application/vnd.calllint.safe-install+json`).
- MCP Resource template: `calllint://adoption/{slug}[/{version}]`
  (**not** `calllint://safe-install/{name}/{version}`).
- 5 MCP tools: `calllint_get_adoption_contract`, `calllint_prepare_safe_install`,
  `calllint_apply_prepared_install`, `calllint_verify_tool_install`,
  `calllint_enable_continuous_guard`.
- Human/machine URLs: `calllint.com/install/{canonicalSlug}/` (HTML) and `.../index.json`
  (contract), reusing the **same** canonical slug algorithm as Trust Pages — no second
  slug function.

"Safe-install" MAY be used only as an **internal route/feature-family name**; the visible
decision language stays the four shipped verdict labels plus the two new honest states
(*No supported install plan* · *Run local pre-flight*).

## Open decisions (resolved here or explicitly deferred)

1. **Serving shape — content negotiation vs distinct static URLs.** *Decision:* distinct
   static URLs on the current Cloudflare static plane (the shipped serving boundary, ADR
   0038). Static sidecars are mandatory regardless. `Vary: Accept` content negotiation is
   optional and only permissible if it introduces **no** dynamic serving plane; it is out
   of Phase-2.4 core scope.
2. **`autoInstallEligible` as a public field.** *Decision:* omit in v1. Only local/org
   policy may authorize auto-allow; the public contract carries the informative
   `publicRoute = PREPARE_AVAILABLE` instead — never a public "auto-install OK" flag.
3. **Contract signature timing.** *Decision:* deferred. Ship the deterministic contract +
   contract digest first; a signature is a later additive step, and only once the
   canonical serialization is proven stable (no schema churn across two cohort bakes).
4. **`calllint protect --host` combined bootstrap.** *Decision:* MAY ship in Batch 8 or be
   deferred; it must never create a new writer and must preserve a separate sealed plan
   per host.
5. **`--allow-contract-origin`.** *Decision:* v1 restricts CLI contract fetch to
   `https://calllint.com`; broadening the origin allowlist (evidence-only, never
   verdict-upgrading, size/time/depth-limited, no credentials) is a later additive change
   under this ADR.

## Consequences

- **Positive.** The public Trust Index becomes an acquisition + adoption surface with
  **zero** new security decision, zero new writer, zero new serving plane, and zero new
  verdict vocabulary. Every actionable route is bound to an exact, digest-checked target
  and re-decided locally, so a stale or tampered public page can only *stop* an install,
  never wrongly authorize one. The dark-pattern red line (INV-2.4-07) is frozen before
  any conversion UI exists.
- **Negative / cost.** Five new pure files + two schemas + thin CLI/MCP surface + a
  public-copy-guard phrase extension are net-new maintenance. The 5 adoption tools bump
  the MCP tool count 8→13, which the `pack:smoke:mcp` hardcoded assertion must track in
  the same PRs (integration risk note). Two representations of one page (HTML + JSON) must
  stay digest-consistent, enforced by a cross-digest test rather than by convention.
- **Non-goals (unchanged).** No second scan, no second verdict, no runtime certification,
  no blocking hook (advisory boundary preserved, ADR 0051/0055), no negotiation-only
  dynamic serving plane, no publisher-text influence on any decision field, and no cohort
  expansion before Phase-2.4 gates 2.4-A…H are green.
