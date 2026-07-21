# Changelog

All notable changes to CallLint are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0.0
onward. While pre-1.0, minor versions may include breaking changes.

`MCPGuard` was the internal codename for this project; the public product is
**CallLint** (see ADR 0008).

## [Unreleased]

## [1.7.2] — 2026-07-21 — Distribution breadth, telemetry wiring & release hygiene

A hardening + plumbing patch. It cuts what accumulated on `main` after 1.7.1 — two more
Tier-A install hosts, single-sourced install commands, a formal claim-lifecycle state
machine, and signed maintainer context — and adds three internal advances: the telemetry
emit layer is now **wired into the CLI but dark by default** (byte-identical output, no
network sink), three previously-missing **CI gate workflows** are stood up, and the Trust
Index gains a **publish-eligibility gate for future scale-out** with no change to the
served pages. **No change to scan behaviour, the `ScanReport` schema, or the verdict
vocabulary** — the deterministic engine is unchanged, and telemetry stays fully decoupled
from the verdict path.

### Added

- **Two more Tier-A install hosts (new11 A2, PR #194).** Claude Desktop and VS Code now
  ship audited apply adapters (five Tier-A hosts total: Claude Code, Cursor, Windsurf,
  Claude Desktop, VS Code). Both delegate to the same single audited write engine (atomic
  write → verify → rollback); `calllint integrate` picks them up automatically.
- **Single-sourced install commands (new11 A5, PR #195).** CallLint's own
  install/invocation commands now live in one authoritative `install` block in
  `project-facts.json`, and `check:public-copy` fails on any drift between that source and
  the served site/status copy.
- **Signed maintainer context + drift notification (new11 C-4/C-5, PR #191, ADR 0047).**
- **Telemetry emit layer wired into the CLI, dark by default (new11 §3.5, M1, PR #197).**
  The `@calllint/telemetry-emit` layer is now threaded into the CLI dispatch through one
  central emit site, but the local `cli` tier stays **default-off** (no consent) with the
  default `noopSink` — so CLI output is byte-for-byte identical and **no network sink
  ships**. An additive `TelemetrySignal` a command attaches to its own result drives an
  accurate `decision_*` event (the exit code is not a proxy for the verdict). Turning the
  local tier on requires an explicit first-run consent decision, deliberately not made here.
- **Three CI gate workflows (new11 §9/§14, PR #196).** `schema-compatibility` (a
  consolidated compat + malformed-input gate over the ~10 previously-untested committed
  schemas, every instance a committed fixture or production-builder output),
  `agent-integration-smoke` (wraps the detect→prepare→apply→verify→rollback→idempotence
  tests), and `distribution-smoke` (wraps the npm-pack + MCP stdio smokes). No product code.
- **Trust Index publish-eligibility gate for scale-out (new11 I1, PR #198).**
  `emitAllCohorts` gains an optional expansion cohort: each candidate must clear the §4.7
  publish-eligibility check (eligible ⇒ baked, ineligible ⇒ recorded `incomplete` with the
  failing criteria) before it becomes a public Trust Page. The ADR-locked seed (fixtures +
  the committed registry seed) is grandfathered, and an empty expansion list emits
  byte-identically — the reproducibility gate is unaffected (still 37 pages). The ingestion
  cap (ADR 0038 §6) is now parameterized via `TRUST_INGEST_MAX_ENTRIES`, fail-safe.

### Changed

- Claim lifecycle is now a formal state machine (9 states + 7 re-verify triggers, new11 C-3,
  PR #193), projected fail-closed onto the served publisher flag (only an ACTIVE claim
  serves it).
- The Claude Desktop + VS Code apply adapters and single-sourced install block land the
  five-Tier-A-host distribution surface (new11 A2/A5, PRs #194/#195).

## [1.7.1] — 2026-07-20 — Evidence-refined verdicts, agent-native distribution & 7-host Guard

Beyond the R3 evidence refinement, this patch also ships the **new11 P2
agent-native distribution** layer (agent trigger taxonomy, the `calllint
integrate` command, and a Claude plugin with a recommend-only PreToolUse hook)
and **Wave 3–4** (Guard host breadth 2→7 and full registry-manifest coverage).
None of these change the verdict vocabulary, the `ScanReport` schema, or the
deterministic engine; the hook is advisory-only and never blocks a tool call.

### Added

- **Evidence-refined Trust Page verdicts (new11 R3, ADR 0050).** The Evidence
  Resolution spine is now wired into the bake: resolved remote-endpoint evidence
  closes the *identity* gap that left registry pages UNKNOWN, and the **unchanged**
  deterministic rules re-derive the verdict. A verified-but-unanalyzed remote moves
  **UNKNOWN → REVIEW**, never SAFE (verifying *who* an endpoint is does not analyze
  *what* its tools do — INV1 still holds, nothing is executed). An automated
  invariant asserts no evidence bundle can ever drive a page to SAFE. Network stays
  workflow-only: a new `resolve-evidence` step freezes a committed, PII-free
  evidence snapshot that the bake reads **purely** (byte-identical when absent), so
  the reproducibility gate is unaffected. On the live registry cohort this moved
  **17 of 18 pages from UNKNOWN to REVIEW** (the remaining SAFE page is a
  package-based npm entry, untouched); `false_safe = 0` holds.

- **Agent trigger taxonomy + recommend policy + platform overlays (new11 P2,
  PR-10, ADR 0051).** New `@calllint/agent-triggers` package: a deterministic
  classifier that recognizes config-surface touch points (MCP server lists,
  skill manifests) and maps them to a *recommend* action, with per-platform
  overlays. No LLM, no verdict — it only decides *whether to suggest* running
  `calllint`.
- **`calllint integrate` command (new11 P2, PR-11, ADR 0049/0051).** Detect →
  plan → approve → atomic apply → verify → rollback for wiring CallLint into a
  host, reusing the audited `install-planner` writer and `discovery` host
  detection (no second writer). `integrate` is the canonical name; `init` is a
  retained alias.
- **Claude plugin + recommend-only PreToolUse hook (new11 P2, PR-12, ADR
  0051).** `plugins/calllint/` — a self-contained Claude Code plugin (plugin
  manifest + `secure-agent-install` skill compiled from the canonical skill +
  a pinned `calllint-mcp` dependency) and a `preflight` PreToolUse hook. The
  hook is **advisory / non-blocking by contract**: it always exits 0, never
  emits `permissionDecision`, and stays silent on any parse error — it surfaces
  a recommendation, never alters the agent's control flow. Includes fork-safe
  PR review (no secrets exposed to fork PRs).
- **Guard host breadth 2 → 7 (new11 Wave 3, ADR 0052, refines ADR 0045).**
  `calllint guard` now installs authority-change watchers across seven hosts —
  `git`, `git-pre-push`, `github`, `claude-code`, `copilot`, `gemini`,
  `vscode` — with session-start renderers. ADR 0052 freezes the hook
  event/write-safety contract for the expanded host set.
- **Registry manifest completed to §3.2 coverage + auto-update matrix (new11
  Wave 4, PR #187).** `distribution/registries/registry-manifest.json` now
  covers the full platform set with per-platform ownership method, read-back
  URL, and automated-submission/read-back flags, feeding the release read-back
  workflow.

### Fixed

- **Web: agent-card code examples legibility (#188).** Dark ink on the light
  code block so the examples are readable.

## [1.7.0] — 2026-07-20 — Verified Publisher & the Evidence Resolution spine

**Resolve the evidence, then publish the verdict.** This minor release ships two
things that were designed but unshipped at 1.6.0. First, **I2c — Verified Publisher**:
a maintainer can now *claim* a Trust Page through a least-privilege GitHub App and a
pure, fail-closed Actions reconcile job — a claim adds an *additive* `verifiedPublisher`
overlay and **never** modifies a verdict, severity, or receipt (ADR 0047 + ADR 0048).
Second, the **new11 Evidence Resolution system** (the "spine"): a central evidence model
(Subject / Bundle / Gap with 16 machine-readable gap reason codes) and six read-only
resolvers (npm, GitHub, MCP Registry, domain ownership, tool metadata, remote endpoint)
that turn "we couldn't tell" into a specific, maintainer-actionable reason — enforced by
a 100-object benchmark gate that holds `false_safe = 0`. Around the spine: code-derived
public facts that cannot drift from the engine, a release read-back workflow, and a
privacy-minimizing telemetry *contract* (schema + structural sanitizer + 4-tier defaults;
no emission wired into the offline CLI). **No change to scan behaviour, the `ScanReport`
schema, or the verdict vocabulary** — the deterministic engine is unchanged. Resolvers
**never execute, probe, or vuln-scan** a target (INV1, automated). Trust Pages still say
*"observed at digest D at time T"*, never "certified/verified safe."

### Added — Verified Publisher (I2c; ADR 0047 §2, ADR 0048)

- **Pure maintainer-claim core** (#162) — claim verification + store parsing that fails
  closed on any malformed or unverifiable input; no network in the pure core.
- **Claim store threaded through bake** (#163) — an *additive* `verifiedPublisher`
  overlay on baked Trust Pages; the underlying verdict/evidence bytes are untouched.
- **Serving surface** (#164) — Partner API + `<calllint-trust>` embed + baked HTML expose
  the claim overlay, guarded by the public-copy word lint (no "trusted publisher"/
  "certified" affirmatives leak onto a page).
- **GitHub App + one-click setup** (#165, #166) — least-privilege App manifest (created,
  ID 4322539); human-gated install; no unsupported lifecycle events.
- **Claim-verify Actions job** (#167) — a pure reconcile job (RS256 App-JWT) that closes
  the loop daily; zero-diff and no-op until the App is installed on a matching org/repo.

### Added — new11 P0: Public Trust Foundation (ADR 0049)

- **Priority-execution boundary — ADR 0049** (#168) — records the evidence-first P0–P5
  ordering, the "extend, don't fork" reuse map, and the canonical `integrate` name; plus
  `docs/internal/{current-system-map,evidence-gap-audit}.md`. The gap audit **measured**
  the live Trust Index UNKNOWN split (registry 17 UNKNOWN / 1 SAFE / 0 BLOCK of 18) and
  confirmed the root cause of all 18 external UNKNOWNs is "remote endpoint could not be
  verified" — which set the resolver priority (R6/R4 lead, not npm).
- **Code-derived public facts** (#169) — `project-facts.json` `capabilities.{detectorCount,
  tierAHosts}` are now machine-derived by `scripts/derive-facts.mjs` (`facts:check` /
  `facts:write`) and guarded by `public-facts-consistency.yml`, so a published claim
  cannot drift from the code (INV9). No second facts file.
- **Release read-back** (#170) — `registry-manifest.json` + a pure reconcile core
  (fetch-fail ⇒ `UNREACHABLE`, never a false-clean) + a weekly `release-readback.yml`
  that opens a single deduped issue on drift; least-privilege `issues:write`.
- **Telemetry contract** (#171) — `@calllint/telemetry-contract` (events / tiers /
  structural allowlist sanitizer / resettable non-fingerprint anon-id) +
  `telemetry-event.schema.json` (`additionalProperties:false`) + `docs/privacy/telemetry.md`
  + a `security-boundary.yml` guard. **4-tier defaults**: server-observed + attributed
  install always-on; CI on-with-notice; local interactive CLI opt-in / default-off. This
  is a *contract only* — no emission is wired into the CLI, and it is verdict-decoupled.

### Added — new11 P1: Evidence Resolution system, the spine (ADR 0049 §2, §4)

- **Evidence model** (#172) — `@calllint/evidence` gains Subject / Bundle / Gap types and
  a central enum of **16 gap reason codes** (each `{category, severity, userMessage,
  maintainerAction, retryable}`), extending ADR 0034. Schema-compat tested.
- **npm + GitHub resolvers** (#173) — read-only `evidence/{npm,github}Resolver.ts` plus
  the resolver dispatch/memoize seam; fixtures + a no-exec boundary.
- **MCP Registry + domain-ownership resolvers** (#174) — `evidence/{registry,domain}Resolver.ts`
  with conflict handling and the evidence priority ladder (artifact-bound > registry >
  publisher-signed > repo > inferred; low never overrides high). No WHOIS PII.
- **Tool-metadata + remote-endpoint resolvers** (#175) — `evidence/{tool,remote}Resolver.ts`
  (identity/TLS only; no business calls, probing, or vuln-scan) + the **INV1 no-exec /
  no-probe** automated suite.
- **Trust Index publish eligibility + completeness report** (#176) — extends
  `@calllint/trust-index` with the 6-condition expansion eligibility check, a completeness
  report, and a human-readable UNKNOWN explanation. (Bake→resolver wiring is a follow-up.)
- **100-object benchmark gate** (#177) — `packages/resolver/test/evidence/{corpus,benchmark}.ts`
  + `evidence-fixtures.yml` (`pnpm bench:fixtures`). Enforces ≥90% artifact identity,
  ≥80% repo mapping, ≥70% completeness, every UNKNOWN carries a reason, deterministic
  replay, no secrets/PII/local paths, and **`false_safe = 0`**. Green on 3-OS CI.

### Changed

- Living trackers and the requirements-traceability matrix are reconciled to `main`
  (Sprint 0 + P0 + P1 closed); the documentation index and `new8-execution-status.md`
  now record `calllint@1.6.0` as npm `latest` and I2c as shipped (prior snapshots said
  1.5.1 / "I2c NOT implemented").

### Notes

- The Evidence Resolution spine exists as libraries + a benchmark gate; **wiring it into
  `trust-index` bake** (so the live 17/18 UNKNOWN Trust Pages actually resolve) is the
  next step and is not in this release.

## [1.6.0] — 2026-07-17 — Public Trust Index & Partner Surface

**Publish the verdict, safely.** This minor release ships Phase I: the offline
ingestion plane that bakes reproducible, digest-addressed Trust Pages; those pages
served same-origin at `calllint.com/trust/…`; the first *external* source (the
Official MCP Registry, ingested by a scheduled workflow that opens a PR and never
auto-deploys); a read-only Partner API over the baked pages under `/v1/public/*`;
and a self-contained `<calllint-trust>` web-component embed. The serving plane
carries **no scanner in the deployable by construction** — every dynamic surface
reads only committed static bytes, and the boundary is locked by dep-graph and
src-import tests. Trust Pages state a verdict *"observed at digest D at time T"* and
never "certified/verified safe." No new CLI command, scan behaviour, schema, or
verdict vocabulary — the engine is unchanged. Maintainer claim / Verified Publisher
(I2c) is designed (ADR 0047, Accepted) but not yet implemented.

### Added

- **Phase I / I1a — `@calllint/trust-index` (fixtures-only ingestion)** — the
  offline ingestion plane that bakes reproducible, digest-addressed Trust Pages by
  orchestrating the shipped scan + authority + `prepare` engines (no new verdict
  logic, no new scan). The first cohort is the ADR-locked `GOLDEN_CASES` fixture set
  under the reserved `calllint-fixtures/` namespace; each resource bakes to a JSON
  sidecar + an HTML page under `packages/trust-index/baked/`, plus a
  `calllint.trust-index.v0` index. Pages state a verdict **"observed at digest D at
  time T"** and never "certified/verified safe" (ADR 0038 §2). Malformed configs are
  recorded as `incomplete`, never silently dropped (ADR 0038 completeness).
  Reproducibility is enforced two ways: the whole reuse chain is clock/RNG-free so a
  re-bake is byte-identical, and a committed-tree test fails if the baked artifacts
  drift from a fresh emit (ADR 0046 §4). Serving is a later milestone — this
  milestone is the *only scanner* and touches no request path (ADR 0046 §1/§3).
- **Phase I / I1b-1 — serve baked Trust Pages same-origin (ADR 0046 §4, ADR 0038 §2)** —
  the bake output root moves from `packages/trust-index/baked` to
  `apps/web/public/trust`, the directory the web deploy ships to Cloudflare Pages. The
  committed pages **are** the served pages at `calllint.com/trust/…` — one store, no
  second copy, no scan at serve time. A new `language.ts` becomes the single source of
  truth for the Trust-page forbidden phrases (the affirmative overclaims
  certified/verified/approved/guaranteed safe); `project-facts.json` mirrors it as data
  for the `.mjs` public-copy guard, and a test binds the mirror to the constant so they
  cannot drift. `check:public-copy` gains serving-side checks over the committed bytes.
- **Phase I / I1b-2 — Official MCP Registry ingestion (ADR 0038)** — the first *external*
  Trust Index source. A PII-free, retained Registry snapshot plus a scheduled Actions
  workflow (`trust-ingest.yml`, weekly) that fetches, re-bakes, and **opens a PR** —
  merging is what deploys, so a human reviews before the public sees it (structural
  decoupling, ADR 0038 §3). The network edge (`fetchRegistry.ts`) is workflow-only, keeps
  only active+latest entries, caps at 25 (ADR 0038 §6 — not a crawl), and strips
  contact/keywords. Unmappable or duplicate entries are recorded as `incomplete`, never
  silently dropped. Registry and fixtures bake through one shared baker; the index lists
  both cohorts. Seed snapshot: 18 active → 17 UNKNOWN / 1 SAFE / 0 BLOCK (honest
  UNKNOWN for unresolvable remotes/packages). Two new public-copy checks: no email/PII,
  and completeness (no silent drops).
- **Phase I / I2a — read-only Partner API (`@calllint/partner-api`, ADR 0046 §4-§5,
  ADR 0038 §3-§4)** — the first *dynamic* surface of the serving plane: a pure request
  router over the pre-baked, digest-addressed Trust Pages, deployed as a Cloudflare Pages
  Function at the same origin under `/v1/public/*`. Routes (all GET, read-only):
  `/artifacts/{digest}` (resource by immutable digest), `/resources/{ns}/{name}`
  (resource by canonical name), and `/resources/{ns}/{name}/authority` (the authority
  slice only). Responses use a versioned envelope (`calllint.partner-api.v0`), a strong
  ETag from the page digest with 304 on `If-None-Match`, a CDN cache posture, first-party
  CORS, and uniform JSON errors that leak nothing. The safety invariant is structural,
  not disciplinary: the router's only capability is an `AssetReader` over committed static
  files — it cannot resolve, fetch, or scan, so no scanner is in the deployable by
  construction (locked by a dep-graph test and a src-import test).
- **Phase I / I2b — `<calllint-trust>` web component + reference embed (design §3.2)** —
  a single self-contained browser ESM file (`/embed/calllint-trust.js`, no build step, no
  dependencies, node-import-safe via `typeof` guards) that consumes the Partner API by
  `resource` or `digest`. It renders green only for SAFE, always shows the boundary note,
  and degrades to a no-JS fallback; it imports no scanner. Tests assert the shipped bytes
  (zero drift). Ships with an `example.html` reference embed.
- **Comm-1 — Team Beta landing page + design-partner intake** — the commercialization
  Comm-1 surface, buildable now with no backend. `apps/web/public/team.html` states the
  prescribed free-vs-paid boundary (local CLI stays free forever; Team centralizes shared
  org policy, approvals, receipts, drift evidence, cross-repo inventory) with a $99/org/mo
  willingness-signal price range (not a checkout), and states plainly that Team never
  changes a verdict (the engine stays deterministic and local). A `design-partner.yml`
  issue template doubles as the interview outline; the CTA links to it (triaged in GitHub
  Issues, no backend). Comm-2..4 (Stripe/tiers/credits) stay gate-locked.

## [1.5.1] — 2026-07-16 — Cross-OS Apply E2E & Tier-A Host Expansion

**Prove the writer, then add hosts.** This patch cuts what had accumulated on
`main` after 1.5.0: the single audited config writer is now proven on a real
filesystem across Windows/macOS/Linux, and both Cursor and Windsurf join Claude
Code as Tier-A install hosts on the strength of that gate — reaching the **3
Tier-A hosts** that unblock Phase I. No new command, schema, or verdict
vocabulary — the apply engine and plan format are unchanged.

### Added

- **Cross-OS CI matrix + real-filesystem apply E2E (ADR 0037 §6)** — the single audited
  config writer (`applyPlan` via the production node fs port) is now proven on a real
  filesystem by `tests/e2e/test/apply-engine.e2e.test.ts`: **20 positive + 20
  broken/conflict** cases asserting the on-disk effect (atomic write, backup bytes, O_EXCL
  lock, and no partial write on any fail-closed branch), plus a **measured** corruption-rate
  assertion (0% < 1% — the §6 kill gate computed from the run, not claimed). CI
  (`.github/workflows/ci.yml`) now runs the whole suite on a
  `[ubuntu-latest, macos-latest, windows-latest]` matrix — the literal Win/macOS/Linux E2E
  the Tier-A gate requires. Because the writer is host-agnostic, this makes every Tier-A
  host's apply path honestly gated (Claude Code retroactively covered).
- **Cursor host adapter — Tier A (C5 host expansion, host #2 of Phase I's ≥3)** — `calllint
  trust prepare --host cursor` resolves a target, decides over it, and emits a reversible
  `calllint.install-plan.v1` for Cursor's `.cursor/mcp.json` (project-scoped; `--host-config`
  overrides); `calllint trust apply` then writes the approved change atomically with backup +
  rollback. The adapter delegates apply to the same audited host-agnostic engine as Claude
  Code (no bespoke write logic). Tier A is earned by the real cross-OS apply E2E parametrized
  over the Tier-A hosts (20 positive + 20 broken/conflict each, ubuntu/macOS/windows,
  measured 0% corruption — ADR 0037 §6). (It shipped first at Tier B / plan-only within an
  earlier cycle, then was promoted once the §6 gate was met.)
- **Windsurf host adapter — Tier A (C5 host expansion, host #3 of Phase I's ≥3)** — `calllint
  trust prepare --host windsurf` resolves a target, decides over it, and emits a reversible
  `calllint.install-plan.v1` for Windsurf's `~/.codeium/mcp_config.json` (a single home-relative
  file on every OS, verified against the official Cascade MCP docs; `--host-config` overrides);
  `calllint trust apply` then writes the approved change atomically with backup + rollback,
  delegating to the same audited host-agnostic engine (no bespoke write logic). The one
  Windsurf-specific detail: a remote server is written under `serverUrl` (the Cascade field),
  not `url`. Tier A is earned by the same real cross-OS apply E2E, now parametrized over
  `[claude-code, cursor, windsurf]` (20 positive + 20 broken/conflict each). This also corrects
  the Windsurf discovery path, which previously guessed `%APPDATA%\Windsurf\mcp.json`.
  **Tier-A hosts: 3** (Claude Code + Cursor + Windsurf) — the Phase I gate (≥3) is now met.

### Fixed

- **`trust prepare --host` help + "Known hosts" errors now derive from the adapter
  registry** — the help text hardcoded "cursor (Tier B, plan-only)" and stayed stale
  after Cursor was promoted to Tier A; it now renders each host's tier/capability from
  `HOST_ADAPTERS` (a Tier-A adapter ships `applyPlan` → "applies"), and a new
  `host-help-parity` test binds the rendered help back to the registry so it cannot drift
  again. Copy-only; no behavior change to planning or apply.

## [1.5.0] — 2026-07-16 — Static Toxic-Flow Analysis & Continuous Guard

**See the composition, then keep watching it.** This release ships two layers on
top of the Trust Gateway: Phase F makes a cross-tool toxic *path* a first-class,
evidence-backed object folded into the verdict; Phase H turns a one-off decision
into a standing one with a Continuous Guard that re-decides the authority surface
whenever it changes. Both are pure-static and offline — the target is never
executed. No second verdict vocabulary and no new action/resource enum are
introduced.

### Added — Phase H: Install Guard & Growth

- **`calllint guard` — Continuous Guard (authority-change watch, ADR 0045)** — runs
  the gateway automatically at an authority-*change* moment and is **silent when
  nothing changed** (the retention promise). It reuses the shipped approved-state
  drift (`verify --approved`, ADR 0024) and the `SAFE/REVIEW/BLOCK/UNKNOWN`
  vocabulary — no new drift engine, no new verdict. A changed surface maps onto the
  stable exit codes (`REVIEW=10`, `UNKNOWN=20`, `BLOCK=30`); the guard's *own*
  failure fails closed (non-zero, never a pass). This is distinct from the
  necessity-gated per-call action guard (ADR 0042 / H3), which remains design-only.
- **`calllint guard install --host git|github`** — writes a declarative shim that
  only shells out to `calllint guard`: a git `pre-commit` hook, or the shipped
  drift-gate GitHub Actions workflow. No risk logic is copied into a host artifact.
- **`calllint guard status` / `disable` / `enable`** — one-key disable via
  `CALLLINT_GUARD=0` or `.calllint/guard.json`; a disabled guard exits 0 with a
  visible note (never a silent pass). The roadmap kill gate (noise → authority-delta
  only) is satisfied by construction: delta-only is the default.
- **One-use → persistent conversion prompt on `trust prepare`** — after a *usable*
  (non-BLOCK/UNKNOWN) preparation, the human-readable output offers the exact
  persistence commands (approve · guard install · CI gate · agent rule). It persists
  nothing by default, emits no telemetry, and never appears on `--json`.

### Added — Phase F: Static Toxic-Flow Analysis

**The path is the blocker.** A per-tool scan sees each tool in isolation, but the real
danger is a composition across tools: an untrusted/sensitive source reaching an external
sink. Phase F expresses that path as a first-class, evidence-backed, digest-sealed object
and folds it into the gateway verdict — pure-static, offline, deterministic, target never
executed. It is layered onto the shipped Authority Manifest; it introduces no second
verdict vocabulary and no new top-level command.

- **`trustSource` on `calllint.authority.v0` (ADR 0041)** — an optional, additive 12-value
  trust classification of the data at the head of a capability, derived deterministically
  from the already-captured signals (`read × secret → sensitive.secret`; a config
  `server.command` exec → `trusted.local_project`; anything not establishable → `unknown`).
  Absent or `unknown` reads as *not trusted* (I-04); an `unknown`-classified capability is
  byte-identical to a pre-F manifest.
- **`calllint.flow.v0` + `@calllint/flow-analyzer` (ADR 0040)** — a new sibling object and a
  pure analyzer that builds cross-capability toxic-flow paths (a trust-classified source,
  ordered steps, a terminal sink) over sealed Authority Manifest(s). `steps`/`sink` use the
  shipped closed 9-action × 10-resource authority vocabulary only. Each flow is digest-sealed.
- **CL-FLOW rule catalog (ADR 0040)** — an ordered, first-match rule table: untrusted/
  sensitive → external network (pinned) or financial spend = BLOCK; → unpinned network or
  messaging = REVIEW; an established trusted source → egress = ALLOW; a fail-safe REVIEW
  catch-all closes it so no dangerous composition can fall through to ALLOW. Each BLOCK/ALLOW
  rule ships paired ± fixtures.
- **`TOXIC_FLOW_COMPOSITION` reason code (#13, ADR 0044)** — a flow's `decisionHint` is
  folded into `calllint.decision.v0` as a `reasons` entry, aggregated by the same
  most-severe-verdict rule as every capability reason. A dangerous flow **raises** the
  verdict, never lowers it; an ALLOW flow contributes nothing. The frozen order of the
  original 12 codes (indices 0–11) is unchanged (append-only).
- **`calllint trust prepare --flows`** — surfaces the `calllint.flow.v0` objects behind a
  decision's `TOXIC_FLOW_COMPOSITION` reasons. With `--json`, emits `{ preparation, flows }`.
  No new top-level command — a `prepare` output switch. A remote MCP server with a secret
  env key now composes `sensitive.secret → connect × network` and resolves **BLOCK** end to
  end.
- **Release gate: a dangerous flow never resolves to SAFE (ADR 0040 §4)** — a new corpus
  gate step drives the built CLI over toxic/benign compositions, plus a `tests/invariants`
  property over ≥10 multi-tool snapshots. The 60-case offline corpus (38 real/redacted, 0
  dangerous-false-SAFE, UNKNOWN 10.0%) and its verdict distribution are unchanged.

## [1.4.0] — 2026-07-15 — Evidence Interoperability

**Aggregate, don't impersonate.** CallLint can now attach another scanner's report
to a scan and show it beside its own verdict in a joint Trust Packet — content risk
(the external scanner) and authority risk (CallLint) side-by-side, unmerged, with one
line explaining why they differ. External evidence is provenance-preserved and never
re-scored: it can never move the CallLint verdict, and a degraded or partial content
scan is never treated as a pass. This closes the v1.2.0 Evidence-Interoperability
milestone (B3 + B4); the schema and `evidence import` adapter shipped in 1.3.0-era work
(ADR 0034).

### Added

- **`calllint scan <target> --evidence <file>` (ADR 0034)** — attach an external
  content-scanner report (e.g. SkillSpector JSON/SARIF) to a scan. The envelope is
  imported via `@calllint/evidence` (fail-closed; a missing file is a usage error, an
  unparseable report imports as `completeness: failed`) and attached to the report as an
  optional projection (`evidence?` on `calllint.report.v0` — additive, no schema break).
  `--evidence-format json|sarif` forces the format when auto-detection is ambiguous.
  - **Joint Trust Packet** — the human-readable output gains a *Content scan* vs
    *Authority scan* block plus a "why they differ" line. Machine formats
    (`--json`/`--sarif`) carry the evidence in the report projection.
  - The scan verdict path is byte-identical without `--evidence`; the offline corpus
    (60 / 38 real-redacted / 0 dangerous-false-SAFE / UNKNOWN 10.0%) is unchanged.
- **`agent-trust-bench`** (`packages/fixtures/bench/`) — a reproducible benchmark proving
  SkillSpector (content) and CallLint (authority) are complementary. Four seed cases
  (clean content + broad `$HOME`; clean content + admin OAuth; safe content + auto-payment;
  a partial content scan that is never a pass). Run with `pnpm bench:test` (offline, drives
  the built CLI over committed fixtures; SkillSpector is never executed). Wired into CI and
  the release gate.
- **`secure-agent-install` skill** (`skills/secure-agent-install/`) — an open, neutral,
  installs-nothing-by-default workflow: run SkillSpector on the content, ask CallLint
  whether the requested authority is acceptable (`trust prepare --evidence`), read the
  joint Trust Packet, and install only after approval. Ships host manifests for Claude
  Code / Cursor / Codex and a thin runner. No partnership or "verified" language.
- **`EVIDENCE.md`** — the evidence-interoperability user guide.

## [1.3.0] — 2026-07-14 — Trust Gateway Core

**From scanning to acting — safely.** CallLint gains a read-only Trust Gateway:
resolve an agent-tool target, judge it deterministically, and emit a reversible
install plan. Applying that plan is the *only* thing that ever writes live
config — it re-validates, writes atomically, verifies, and rolls back on
failure — and every approval produces a signed, tamper-evident decision receipt.
The gateway never executes, installs, or connects to the target it judges.

### Added

- **Trust Gateway (Phase G, ADR 0035–0039)** — a deterministic, fail-closed
  pipeline over six sealed digests (artifact → evidence → authority →
  decision/policy → install-plan → receipt). `UNKNOWN` never becomes `SAFE`;
  external evidence can tighten a verdict but never set it alone.
  - `calllint trust prepare <target> [--host <id>] [--evidence <f>] [--write-plan]`
    — read-only: resolve a target (Git URL / dir / SKILL.md / MCP config, branch
    pinned to an immutable commit), judge it, and optionally emit a reversible
    JSON-Patch install plan (`calllint.install-plan.v1`). Never touches live config.
  - `calllint trust show <plan>` / `trust explain <plan>` — inspect a plan.
  - New schemas: `calllint.artifact.v1`, `calllint.authority.v0`,
    `calllint.decision.v0`, `calllint.install-plan.v1`, `calllint.apply-result.v1`.
  - New package `@calllint/install-planner` — plan assembly + the apply engine.
- **Verified Apply Gateway** — `calllint trust apply --plan <file> --approve <plan-digest>`
  is the only writer of live config. TOCTOU re-validation (drift → `PLAN_STALE`),
  config locking, atomic temp→fsync→rename write, backup, idempotency
  (`already_applied`), and automatic rollback on verification failure. Claude
  Code ships at Tier A (the audited write surface).
- **Decision Receipt v1 + gateway drift taxonomy (G7)** — durable proof of an
  approval and a way to detect when the approved state later drifts.
  - New schema `calllint.receipt.v1` (the *decision receipt*): binds the full
    six-digest chain plus the approval, apply result, and expiration. Distinct
    from the scan receipt `calllint.receipt.v0`. See ADR 0039.
  - `calllint trust apply --receipt <file>` writes a decision receipt after an
    apply; `--sign --key <keyfile>` signs it with a local ed25519 keypair
    (reusing `receipt keygen`); `--approver <name>` sets attribution.
  - `calllint trust verify <receipt> [--public-key <keyfile>]` validates a
    receipt read-only: structure, the six digests, the approval binding, expiry,
    and (with a key) the ed25519 signature. It never re-judges, re-scans, or
    executes the target. Exit 0 = valid, 1 = invalid/tampered.
  - Deterministic receipt builder: identical inputs produce byte-identical
    receipts (timestamps and versions are injected, `receiptId` is derived).
  - Gateway drift taxonomy: 9 signals labeled into 4 change classes (artifact,
    authority, evidence, policy) plus `expired` / `signatureChainBroken`
    integrity flags — all classification is pure.

## [1.1.0] — 2026-07-04 — Stream 1: Auto-Discovery

**Zero-config scanning.** CallLint now automatically discovers agent configurations across your system — no manual path configuration required.

### Added

- **Auto-Discovery (Stream 1)** — Zero-config scanning via `calllint scan --auto`
  - New command: `calllint inventory` — list all discovered agent configs
  - New flag: `calllint scan --auto` — discover and scan all agents automatically
  - New flag: `calllint scan --agent <type>` — scan a specific agent type
  - **Supported agents**: Cursor (P0), Claude Code (P0), Claude Desktop (P0), VS Code (P1), Windsurf (P1)
  - Cross-platform path resolution (Windows, macOS, Linux)
  - No manual path configuration required — agents are discovered automatically
  - See ADR 0033 for architecture details
- Example MCP configs for VS Code and Windsurf added to `examples/mcp-configs/`

### Changed

- README Quick Start now shows `scan --auto` as the primary example
- Help text updated to list all 5 supported agent types

## [1.0.1] — 2026-07-02 — Fix: synchronous receipt signing

### Fixed

- **`receipt keygen` / `sign` / signed `verify` no longer hang.** The R6 CLI
  bridged async ed25519 calls to the synchronous command layer with a
  busy-wait spin loop, which starved the event loop so the crypto Promise
  could never resolve — these commands hit their 5s timeout 100% of the time
  in 1.0.0. ed25519 over a fixed 32-byte hash is a pure CPU operation with no
  I/O, so `@calllint/signature` is now fully synchronous (`@noble/ed25519`
  sync API backed by Node's `crypto` sha512) and the CLI calls it directly.
  No receipt schema change (ADR 0032); implementation-only fix.

### Added

- E2E coverage for the signing flow (`keygen → sign → verify`, tamper
  detection, missing-key, double-sign) using a real child process, plus
  synchronous-contract guards in the signature unit tests.

## [1.0.0] — 2026-07-02 — R6: Cloud Signed Receipt Infrastructure

**First 1.0 release.** Activates the signature infrastructure for CallLint receipts,
enabling cryptographically signed receipts that prove provenance and integrity.
Local scan and local receipts remain 100% free. Cloud signing infrastructure is
ready for future service deployment.

### Added

- **Receipt Signature Support (ADR 0032)**
  - Signature field activated in `calllint.receipt.v0` schema
  - `algorithm`, `key_id`, `value`, `signed_at`, `public_key_url` fields
  - Ed25519 deterministic signatures (64 bytes, fast, industry-standard)
  
- **@calllint/signature Package**
  - `generateKeypair()` — generate test ed25519 keypairs
  - `signReceipt()` — sign receipt hash with ed25519
  - `verifyReceipt()` — verify signature cryptographically
  - `exportKeypair()` / `importKeypair()` — JSON serialization
  - 18 tests covering round-trip, tampering detection, edge cases

- **CLI Receipt Commands**
  - `calllint receipt sign <receipt.json> --key <keyfile>` — local signing (dev/test only)
  - `calllint receipt keygen --out <file>` — generate test keypair
  - `calllint receipt verify <receipt.json>` — now includes crypto validation when signature present
  - `--public-key <keyfile>` flag for offline verification

- **@calllint/credits Package (Internal)**
  - `calculateCredits()` — internal metering for signed receipts
  - Formula: base + findings × per_finding × verdict_multiplier
  - 13 tests covering all verdicts, batch calculation, determinism
  - **No public pricing documentation** (infrastructure only)

- **API Design Documentation**
  - `CLOUD_VERIFICATION_API.md` — complete cloud service specification
  - `POST /v1/receipts/sign` — sign receipt endpoint
  - `GET /.well-known/receipt-keys.json` — public key distribution
  - Security model, privacy guarantees, key rotation procedures
  - **Design only** — service deployment out of v1.0.0 scope

### Changed

- Receipt signature field fully specified (was placeholder in v0.8.0)
- `CallLintReceipt` type now includes `signed_at` and `public_key_url` in signature

### Security

- **What signatures prove:** Provenance (CallLint issued this) + Integrity (not modified)
- **What signatures do NOT prove:** Safety, completeness, future/runtime behavior
- **Privacy:** Receipt hash prevents cloud from indexing findings
- **Offline verification:** Anyone can verify with public key from `.well-known/`
- **Key rotation:** 6-month cadence (H1/H2), old keys kept for historical verification

## [0.10.1] — 2026-07-02 — R5 Runtime: Agent Inbox Inspect
- `calllint inbox inspect <normalized-event.json>` command (ADR 0031)
  - Reads normalized agent inbox events (`calllint.agent-inbox-event.v0`)
  - Extracts optional `action_candidate` field
  - Delegates to R4 action analyzer for verdict + findings
  - Supports `--receipt` / `--receipt-out` flags (reuses ADR 0028 receipt schema)
  - Tested against all 12 fixture pairs (6 providers × 2 examples)
- Composition layer only: NO OAuth, NO provider SDKs, NO webhook server, NO mailbox polling
- Closes the inbox → action preflight loop (R5 design → R5 runtime)

## [0.10.0] — 2026-07-02 — R5 Design: Provider-Agnostic Agent Inbox Spec

**Design-only release.** Establishes the schema, adapter contract, and fixture corpus
for normalizing inbox events (email, Slack, Discord) into the unified
`calllint.agent-inbox-event.v0` format. **Zero runtime code** — no CLI command, no
SDK, no OAuth/webhook/mailbox/sending. Future adapter implementations validate
against these fixtures.

### Added

- **Agent Inbox Schema** (`calllint.agent-inbox-event.v0`)
  - `schemas/agent-inbox-event.schema.json` — normalized inbox event from any provider
  - Required fields: `schema_version`, `event_type`, `timestamp`, `source`, `normalized_content`
  - Five `event_type` values: `email.received`, `message.posted`, `mention.detected`,
    `direct_message.received`, `thread.replied`
  - Optional `action_candidate` field embeds a `calllint.action.v0` descriptor,
    enabling inbox events to flow into the R4 action preflight engine

- **Adapter Contract** (`docs/AGENT_INBOX_ADAPTER_CONTRACT.md`)
  - Transformation rules: provider-specific event → normalized schema
  - Required field extraction (timestamp, from, to, attachment hashes)
  - Secret-stripping rules (header keys only, never values)
  - Error handling (malformed events, missing fields)

- **Usage Guide** (`docs/AGENT_INBOX_PREFLIGHT.md`)
  - 3-stage chain: normalize → extract `action_candidate` → `calllint action inspect`
  - Two worked examples: email reply with secret headers → REVIEW verdict;
    invoice → payment candidate → financial action detected
  - When to run preflight, out-of-scope list

- **Fixture Corpus** (6 providers × 2 examples = 12 pairs)
  - Resend, SendGrid, Gmail API, Slack, Discord, SMTP/IMAP
  - Each provider: 1 clean baseline + 1 `action_candidate` chain
  - All 5 `event_type` values exercised across corpus
  - Six `action_candidate` chains proven through R4 analyzer:
    - 2 surface findings (`secrets.env-key`, `action.financial-observed`)
    - 4 are clean (SAFE)

- **Test Suite** (`packages/fixtures/test/agent-inbox.test.ts`)
  - 7 tests: schema invariants, no-secret-leak, raw/normalized pairing,
    event_type coverage, `action_candidate` structural validity
  - Asserts ≥12 normalized fixtures, all 5 event_types present, ≥6 candidates

### Design Decision

- **ADR 0030**: Provider-Agnostic Agent Inbox Spec (Proposed)
  - Reuses `action_candidate` field to embed `calllint.action.v0` descriptors
  - No new verdict logic, no new risk symbols — inbox events are carriers
  - Adapter is a pure function (stateless, idempotent, language-agnostic)

### References

- PR #99: R5 schema + adapter contract + initial fixtures (7c649af)
- PR #101: Expand fixtures to 2/provider + preflight guide (acfc6f7)
- ADR 0030 (Proposed), ADR 0029 (action_candidate reuse), ADR 0028 (receipt schema)
- new5 master plan: R5 / v0.10.0 scope

## [0.9.3] — 2026-07-02 — R4 Complete: Receipt Integration + Full Coverage

### Added

- **R4 Complete: Action receipt generation** via `calllint action inspect --receipt`
  - Integrated ADR 0028 receipt schema for action verdicts
  - Added `--receipt` and `--receipt-out` flags to action command
  - Receipt subject type now supports both `"scan"` and `"action"`
  - Default output: `calllint-action-receipt.json`

- **Complete fixture coverage for all 9 action kinds** (+5 fixtures, 24 total)
  - `email.forward`: positive-clean-forward.json + negative-missing-attachment-hashes.json (was 0, now 2)
  - `message.post`: negative-secret-headers.json (was 1, now 2)
  - `payment.authorize`: positive-small-verified-payment.json (was 1, now 2)
  - `a2a.delegate`: positive-secure-delegate.json (was 2, now 3)
  - All 9 kinds now have ≥1 positive + ≥1 negative fixture

### Changed

- Updated `packages/fixtures/action/README.md` to reflect actual implementation status
  - Removed stale "design phase, no real fixtures yet" text
  - Added coverage matrix: 9 positive + 15 negative = 24 fixtures
  - Documented full directory structure with all fixture names
- Receipt schema (`calllint.receipt.v0`) subject.type enum expanded from `["scan"]` to `["scan", "action"]`
- Action command help text now documents `--receipt` and `--receipt-out` options

### Fixed

- R4 DoD compliance: all action kinds now meet "≥1 positive + ≥1 negative" fixture requirement

## [0.9.2] — 2026-07-02 — R4 Enhanced: Complete Detectors + Fixtures

### Added

- **Complete fixture coverage for all 9 action kinds** (+12 fixtures, 19 total).
  - `github.write`: 3 fixtures (positive create-pr, negative unverified-repo with excessive scopes, negative external-links)
  - `npm.publish`: 3 fixtures (positive clean-publish, negative name-squatting, negative version-float)
  - `cloud.modify`: 3 fixtures (positive small-instance, negative expensive-instance, negative open-all-ports)
  - `account.register`: 3 fixtures (positive clean-registration, negative unverified-service, negative excessive-scopes)

- **Enhanced detectors for all 9 action kinds** (+8 detectors, 13 total).
  - `supply.name-squatting` — Detect npm package name typosquatting (similar to popular packages)
  - `supply.version-float` — Detect unpinned npm versions (^/~ ranges instead of exact)
  - `action.unverified-repository` — GitHub write to unverified repository
  - `action.excessive-github-scopes` — Dangerous GitHub OAuth scopes (delete_repo, admin:org)
  - `action.external-links` — External links in GitHub PR/issues
  - `action.expensive-cloud-resource` — Cloud resource cost detection (>$1000/month)
  - `action.insecure-security-group` — Cloud security group opens all ports (0.0.0.0/0)
  - `action.unverified-service` — Account registration on unverified service
  - `action.excessive-oauth-scopes` — Excessive OAuth scopes for account registration

**Tests:** +9 new tests (529 total, was 520)

**Coverage Matrix:**
- email.reply: 3 fixtures, 3 detectors ✓
- message.post: 1 fixture, 1 detector ✓
- a2a.delegate: 2 fixtures, 2 detectors ✓
- payment.authorize: 1 fixture, 1 detector ✓
- account.register: 3 fixtures, 2 detectors ✓
- github.write: 3 fixtures, 3 detectors ✓
- npm.publish: 3 fixtures, 2 detectors ✓
- cloud.modify: 3 fixtures, 2 detectors ✓
- email.forward: 0 fixtures (shares detectors with email.reply)

## [0.9.1] — 2026-07-02 — R4 Runtime: Action Inspect Command

### Added

- **`calllint action inspect` — Unified External Action Preflight (R4 runtime, ADR 0029).**
  Inspect planned external actions before execution. Takes a `calllint.action.v0` JSON
  descriptor and returns SAFE / REVIEW / BLOCK / UNKNOWN with findings, applying the same
  risk symbols (PROMPT / SUPPLY / FILES / NETWORK / EXEC / ACTION / MONEY / SECRETS) and
  verdict engine as MCP scans. Supports 9 action kinds: `email.reply`, `email.forward`,
  `message.post`, `a2a.delegate`, `payment.authorize`, `account.register`, `github.write`,
  `npm.publish`, `cloud.modify`. Implemented detectors: `action.unverified-attachment`
  (email attachments without SHA-256 hashes), `action.missing-delegate-target` (a2a
  delegation without target), `action.insecure-delegate-target` (HTTP not HTTPS),
  `action.financial-observed` (payment with monetary amount), `secrets.env-key`
  (secret-shaped header keys). Terminal and JSON output modes. Policy support via
  `--policy`. See ADR 0029.

**Usage:**
```bash
calllint action inspect payment.json
calllint action inspect email-reply.json --json
calllint action help
```

**Package:** New `@calllint/action-analyzer` package implements the core analysis logic.

## [0.9.0] — 2026-07-02 — R4 Design Checkpoint (Unified External Action Preflight)

### Added (Design-only, no runtime implementation)

- **`calllint.action.v0` schema — Unified External Action Preflight (ADR 0029).**
  Design checkpoint for R4. Schema defines 9 action kinds (email.reply/forward,
  message.post, a2a.delegate, payment.authorize, account.register, github.write,
  npm.publish, cloud.modify) with kind-specific parameters and metadata. Reuses
  existing risk symbols (PROMPT / SUPPLY / FILES / NETWORK / EXEC / ACTION /
  MONEY / SECRETS) and verdict engine. This release contains the schema
  (`schemas/action.schema.json`), fixture contract (`packages/fixtures/action/`
  with 9 stub directories), and design ADR (local docs) — the `calllint action
  inspect` command implementation is a future release. See ADR 0029.

**Note:** This is a design checkpoint release. The `action inspect` command is
not yet implemented. The schema and fixture structure are provided for review
and integration planning. This version will not be published to npm — use
v0.8.1 for the latest runtime features.

## [0.8.1] — 2026-07-02 — Online registry surface (邻接校准)

### Added

- **Registry-metadata prompt surface under `--online` (ADR 0027).** With
  `--online`, the npm registry's own model-visible text — the resolved version's
  published `description`, and the registry document's `readme` when it already
  carries one — is routed through the *existing* prompt-surface detectors
  (`prompt.poisoning` / `prompt.hidden-instructions`) via the same
  `analyzeDocumentSurfaces` path a local `README`/`SKILL.md` uses (ADR 0015). A
  package whose local config is clean but whose published `description` hides a
  model-directed or obfuscated instruction now surfaces the existing
  `prompt.surface-instructions` finding (PROMPT, S2, REVIEW, non-blocker),
  stamped `source:"online"` + `fetchedAt`, with the surface origin recorded in
  evidence (`registry:<name>#description` / `#readme`). No new detector, reason
  code, or `ScanReport` schema change — only the evidence's surface origin and
  online provenance stamp are new. Per ADR 0006 this online-derived text is
  advisory: it may raise a verdict to REVIEW and never downgrades one or
  manufactures SAFE. **Offline default is unchanged** — with no `--online`,
  nothing here runs and the deterministic verdict is byte-identical. The offline
  60/38 corpus gate (never passes `--online`) is the standing proof of that
  invariance; the online surface is covered by replay fixtures (a real benign
  `description` ⇒ no finding; a real base with a clearly-labelled synthetic poison
  payload ⇒ REVIEW) with no live network in CI. See ADR 0027.

## [0.8.0] — 2026-07-01 — Receipt-first trust layer (new5 R3)

### Added

- **Local receipts — `scan --receipt` + `receipt verify` (new5 R3, ADR 0028).**
  A receipt (`calllint.receipt.v0`) is a small local JSON file that records the
  outcome of a scan: which CallLint version produced which verdict, over which
  input, under which policy/ruleset context, with per-finding references
  (`rule_id`, `severity`, `evidence_path` — never an evidence value). It is a
  pure *reporting layer* over the existing `calllint.report.v0` scan report:
  `verdict`, `risk_counts`, and `finding_refs` are read straight from that
  report — a receipt never re-scans, re-judges, executes a target, contacts the
  network, or reads a secret value (the `trust_boundaries` block is type-locked
  to encode this). `scan --receipt [--receipt-out <file>]` writes the receipt
  *after* the normal scan (unchanged output and exit code; absent flag ⇒
  byte-identical behavior); `receipt verify <file>` structurally validates it
  offline (exit 0 valid / 1 invalid). Hashes reuse `@calllint/fingerprint`. The
  receipt is unsigned — the `signature` field is reserved for a future release
  and never populated. A receipt is not a proof of runtime safety and never
  certifies a tool. Author guide: [`RECEIPTS.md`](RECEIPTS.md). See ADR 0028.
- **GitHub Action — optional `receipt` artifact (new5 R3).** The `calllint`
  Action gains `receipt` (default `false`) and `receipt-file` inputs. When
  `receipt: true` it runs `scan --receipt --receipt-out <file>` and uploads the
  receipt as a build artifact. `receipt: false` leaves the Action's SARIF
  upload, Markdown step summary, and `--ci` gate behavior unchanged — the
  receipt is additional evidence, never a new gate.

### Fixed

- **Receipt schema cites ADR 0028 by number.** `schemas/receipt.schema.json`
  previously referenced `docs/adr/0028-…md`, a path under the gitignored `docs/`
  tree; it now cites "ADR 0028" like the rest of the tracked docs. The
  public-copy guard also now verifies the README corpus numbers against
  `project-facts.json` (previously only the homepage was checked).

## [0.7.0] — 2026-07-01 — Trust badge (Phase 6) + docker inline secret keys

### Added

- **`calllint scan --badge` — Trust badge (Phase 6, ADR 0026).** Emits a
  shields.io *endpoint* JSON badge (`{schemaVersion, label:"CallLint", message,
  color}`) for the aggregate verdict. Like `--sarif`/`--markdown`, it is a new
  projection of the existing `calllint.report.v0` verdict — no `ScanReport`
  schema change, no verdict decision of its own. An MCP author commits
  `calllint-badge.json`, points a shields.io endpoint badge at it, and refreshes
  it in CI. Transparency over false comfort: only `SAFE` is green; `REVIEW`,
  `UNKNOWN`, and `BLOCK` each carry a distinct non-green colour (a `no-green-only`
  test locks this). Author guide: [`badge.md`](badge.md).

### Changed

- **Docker inline `-e` secret keys are now inspected (ADR 0016).** The secret
  detector reads the `env` block *and*, for a `docker` runtime, the env-var keys
  passed inline via `-e KEY[=value]` / `--env KEY[=value]` (never a value;
  `--env-file` is ignored). A credential-shaped var passed inline with no `env`
  block — e.g. `-e GDRIVE_CREDENTIALS_PATH=…` — now emits `secrets.env-key`
  (SECRETS, S2, REVIEW, non-blocker), the secrets-detector analogue of ADR 0012's
  docker bind-mount host-path extraction. Same finding id; no schema change. Only
  verdict delta: corpus `C049` docker inline-cred SAFE → REVIEW (deliberate,
  safe-direction, pre-recorded in the case provenance). Keys are matched by shape,
  so a non-credential inline var (`-e DOCKER_CONTAINER=true`) stays unflagged. See
  ADR 0016.
- **`calllint-mcp@0.1.1` — MCP Registry readiness.** Adds `mcpName`
  (`io.github.calllint/calllint`) to the package so the official MCP Registry can
  verify npm package ownership, and aligns `server.json` to the live registry
  schema (`2025-12-11`, camelCase fields). Published via OIDC + provenance by a
  new dedicated `publish-mcp.yml` workflow (triggered by a `mcp-v*` tag), which
  also submits the entry to the MCP Registry using GitHub OIDC (no stored token).
  `calllint-mcp` is no longer published by `release.yml` — one package per
  workflow. No tool, verdict, or engine change.

## [0.6.0] — 2026-06-29 — Agent rules, approved-state drift gate (L4), and the `calllint-mcp` safety gate

The distribution release. It carries the new4 Layer S–Phase 3 capability core
(capability fingerprint + compact decision + surface extractors) onto the stable
line and builds three layers on top of it, without weakening a single verdict
(corpus floor unchanged: 0 dangerous false-SAFE, UNKNOWN 10.0%).

### Added

- **Agent distribution rules (Phase 3).** `calllint gen-rule --host <h>` emits a
  token-frugal CallLint safety rule for Claude, Cursor, Copilot, Codex, Gemini,
  Windsurf, Cline, and a generic `AGENTS.md` host, from a single source of truth.
- **Approved state + drift gate (Phase 4, L4 — ADR 0024).** `calllint approve`
  records the repo-wide capability surface as `.calllint/approved.json`
  (`calllint.approved.v0`, keyed on the capability fingerprint — distinct from the
  Evidence-layer baseline). `calllint verify --approved` diffs the current surface
  against it; drift never collapses to SAFE. A path-filtered
  `.github/workflows/calllint.yml` runs the gate (`verify --approved --ci`).
- **`calllint-mcp` (Phase 5 — ADR 0025).** A new, separately published MCP server
  exposing CallLint as a static preflight safety gate: tools `scan_mcp_config_path`,
  `scan_mcp_config_json`, `verify_baseline`, `explain_finding`,
  `generate_agent_rule`, `generate_ci_gate_snippet`. Thin wrapper — every tool
  delegates to the engine; zero runtime dependencies; never executes a scanned
  server. First published as `calllint-mcp@0.1.0`.

### Notes

- No `ScanReport` schema, exit-code, verdict, or detector change in this release —
  SAFE is exactly as hard to reach as in 0.5.0. The additions are distribution and
  workflow layers around the existing engine.

## [0.5.0] — 2026-06-29 — PR-gate trifecta + policy guide & override `owner`

The decision-point release. Its core closes the pull-request gate end-to-end
without touching the engine: a `--markdown` renderer, a `scan --changed` git-diff
entry point, and a thin `calllint/calllint@v1` GitHub Action compose the existing
CLI into a PR check. It also ships a policy authoring guide and one additive,
ADR-backed policy-schema field (`owner` on `PolicyOverride`). No `ScanReport`
schema, exit-code, verdict, or detector change — SAFE is exactly as hard to reach
as in `0.4.0`; the only schema movement is the additive `calllint.policy.v0`
`owner` field, which leaves the set of verdicts an override can produce unchanged.

### Added
- **Policy guide (`policy.md`)** + ready-to-copy examples in `examples/policies/`
  (`ci-block-only`, `ci-strict`, `override-timeboxed`), with a validation test
  asserting every shipped example is valid `calllint.policy.v0` (S5). The guide
  describes only verified behavior (CI exit codes and the `BLOCK → REVIEW`
  override); declared-not-read fields are called out as such.
- **`owner` on `PolicyOverride`** — an optional, validated-if-present accountable
  identity (handle/team/email) for a security exception. Recorded and echoed in
  the `policy.applied` diagnostic, never interpreted. Additive, non-breaking
  (ADR 0017-B, `adrs/0017-override-owner-accountability.md`). Schema-additive
  MINOR; the set of verdicts an override can produce is unchanged.
- **`calllint scan --markdown`** — a deterministic, emoji-free Markdown renderer
  for the `ScanReport` (verdict, per-server findings with evidence/impact/fix,
  exit-code legend), derived from the same `calllint.report.v0` the other
  renderers consume. Designed for a PR Step Summary; pipe-safe (table cells are
  escaped). No schema change — it is a view, like `--sarif`/`--html`.
- **CallLint GitHub Action** (`uses: calllint/calllint@v1`) — a thin composite
  action wrapping the published CLI: installs `calllint`, scans the config,
  captures the aggregate verdict as an output, uploads SARIF to Code Scanning,
  writes a Markdown report to the PR Step Summary, and gates the build on the
  verdict. It invents no new gate semantics — the pass/fail decision is the CLI's
  own `--ci` exit code driven by the policy's `ci.failOn` set. Inputs: `target`,
  `version`, `policy`, `online`, `surface-dir`, `sarif`, `step-summary`, `gate`.
  Exercised by an in-repo self-test workflow (`action-selftest.yml`) over SAFE,
  BLOCK report-only, and BLOCK-gates fixtures. Never executes the scanned server.
- **`calllint scan --changed`** — scans only the agent-tool configs that appear
  in the git diff (`git diff --name-only HEAD`), filtered to the known config
  locations (`.cursor/mcp.json`, `.mcp.json`, `mcp.json`, `.claude/settings.json`,
  `.vscode/mcp.json`). The git-diff PR-gate decision point: it cuts reviewer noise
  by skipping unchanged configs and composes with every existing flag (`--ci`,
  `--markdown`, `--json`, `--policy`, `--surface-dir`). No relevant change → a
  no-op exit 0. One changed config behaves exactly like `scan <path>`. For
  multiple, the process exit code is the worst child verdict; `--json` emits a
  JSON array of unchanged `calllint.report.v0` summaries and other formats are
  concatenated. No `ScanReport` schema change. The git diff source is best-effort
  (a non-repo or missing git yields "nothing to scan", never a crash).

## [0.4.0] — Post-stable detector + corpus + prompt-surface

Post-stable detector and corpus work (R2.2 batches 4–6, R3 `diagnostics --json`,
R3-adjacent calibration ADRs, and R4 prompt-surface v0 + local-document increment).
These change verdict behaviour for specific config shapes in the **safe direction**
(they add findings the engine previously missed) and are gated by ADRs, positive +
negative fixtures, unit tests, and a corpus impact pass per the development
contract. No `ScanReport` schema, exit-code, or policy change — SAFE is only
harder to reach.

### Added
- **R3 `calllint diagnostics --json`** — a stable, editor/agent-host-friendly
  machine protocol under its own schema version `calllint.diagnostics.v0`,
  derived purely from an existing `ScanReport` (no new analysis, no verdict
  change, no network). Emits one diagnostic per finding with finding id,
  severity, file + config key-path, observed value, remediation, and verdict
  contribution — including real source line/column for config-mapped evidence.
  This is the geology under any future IDE/agent-host integration, which is why
  it precedes any plugin. See ADR 0013
  (Accepted, implemented).
- **R4 local-document prompt surface** — opt-in `calllint scan --surface-dir <dir>`
  reads a bounded, offline allowlist of project documents (`README.md`, `SKILL.md`,
  `AGENTS.md`, and `package.json` `description`) and runs the prompt-surface scanners
  over them, emitting a project-level `prompt.surface-instructions` (PROMPT, S2,
  REVIEW, non-blocker) finding with a surface path and FP note. Default behaviour is
  unchanged — with no flag, nothing beyond the config is read. Bounded (256 KiB/file,
  named allowlist, no globbing/recursion/symlinks), offline, never executes. The
  `prompt.poisoning` / `prompt.hidden-instructions` scanners were extracted to one
  shared module so the config-metadata and document surfaces flag identically. See
  ADR 0015.
- **R4 prompt-surface v0** — new detector `prompt.hidden-instructions` (PROMPT, S2,
  REVIEW, non-blocker) flags hidden/obfuscated content in the model-visible surface
  (server instructions + provided tool name/description/schema text): zero-width and
  invisible characters, Unicode bidirectional overrides (Trojan-Source class),
  tag-character ASCII smuggling, and embedded HTML/XML comments. Complements the
  existing `prompt.poisoning` literal-phrase blocker by catching its evasion. Static
  shape detection only — never a prompt-injection claim.
  See ADR 0014.
- **`exec.unverified-local-source`** (EXEC, S2, REVIEW, non-blocker) — flags a
  runtime that executes a local script/binary CallLint never inspects (`node
  ./server.js`, `uv run python -m …`, an unrecognized local binary) and that is
  neither a recognized package, a docker image, nor a remote. SAFE is now reachable
  only for recognized, inspectable sources. See
  ADR 0011 (Accepted,
  Direction 2).

### Changed
- **Docker bind-mount host paths are now inspected.** The broad-path detector
  extracts the host side of `--mount type=bind,src=…`/`source=…`, `-v host:container`,
  `--volume`, and inline `--mount=…` forms (drive-letter aware) and runs the
  broad-path check on it (never the container `dst`, never a named volume). A config
  that binds a broad host directory into a container now emits `files.broad-path` →
  BLOCK. Same finding id; no schema change. See
  ADR 0012 (Accepted).
- **Corpus re-verdicts (deliberate, ADR-gated):** `C023` docker bind-mount
  SAFE → BLOCK (ADR 0012); `C035` bare-node and `C040` local-uv-python SAFE → REVIEW
  (ADR 0011 Direction 2). Each case's contract, notes, and `index.json` updated;
  `thisCaseMustNeverBeSafe` set where a blocker now applies.
- **R2.2 corpus → 60 cases** (real/redacted floor 38). Batch 4 (C041–C045): R4
  hidden-instructions seed + real gitlab/sqlite/google-maps/github-remote shapes.
  Batches 5–6 (C046–C060): R4 local-document surface seeds (README/SKILL.md/
  package.json/AGENTS.md via `--surface-dir`) + a clean-surface negative; four more
  real shapes (redis docker-url SAFE, sentry uvx arg-token, gdrive docker-volume SAFE,
  everart docker-secret); and docker mount/volume branch locks
  (`-v`/`--volume`/`--mount=`/`source=` alias/`type=volume`). Acceptance floor
  ratcheted 40/30 → 60/38; dangerous false-SAFE stays 0; UNKNOWN ratio 10.0% (≤ 15%).

### Deferred (recorded, not yet implemented)
- **ADR 0016** — docker `-e KEY[=value]` env keys are not extracted by the secret
  detector (it reads the `env` block, not docker args), so a credential-named var
  passed inline via `-e` with no `env` block is not flagged. A non-blocker
  (REVIEW-class) under-call, the secrets-detector analogue of ADR 0012; anchored by
  corpus case C049. See
  ADR 0016. **(Resolved: implemented in `[Unreleased]` — the extractor now inspects
  docker `-e`/`--env` keys; C049 flips SAFE → REVIEW accordingly.)**


## [0.3.0] — First stable release

First stable release of CallLint, published to the `latest` dist-tag. **No
scanner-semantics change since `0.3.0-rc.1`**: the engine, detectors, verdict
rules, golden expectations, and exit codes are byte-identical — this release
promotes the validated rc.1 to stable and corrects the dist-tag drift. "Stable"
means the **CLI contract, verdict semantics, report schema v0, release chain, and
CI integration are stable** — not that any scanned tool is proven safe (CallLint
is a static, offline, heuristic pre-flight scanner; see `SECURITY.md` /
`LIMITATIONS.md`).

### Changed
- Promoted to the `latest` dist-tag and corrected the known dist-tag drift:
  `latest` now points at `0.3.0` (it had pointed at `0.3.0-preview.0`, published
  before the release workflow derived dist-tags from the version). See
  RELEASE_VERIFICATION.md §1.
- Documented install path moves from `npx calllint@preview` to `npx calllint`
  (the `latest` tag now serves stable).

### Included since the preview line (no behaviour change at promotion)
- **RC-BLK-01 fix** (shipped in `0.3.0-rc.1`): unrecognized or empty MCP server
  shapes resolve to `UNKNOWN`, never a dangerous false-`SAFE`
  (ADR 0010; golden +
  corpus `C031`).
- R2.1 corpus (31 cases, 21 real/redacted), SARIF dogfood, website V3, Trusted
  Publishing with provenance.

## [0.3.0-rc.1] — Stable candidate (RC-BLK-01 fix)

Second release candidate. Fixes a **dangerous false-SAFE** found during the
`0.3.0-rc.0` feedback window while scanning real third-party MCP configs from
public repositories. Published to the **`next`** dist-tag (`npx calllint@next`);
`latest` stays on `0.3.0-preview.0` until stable.

### Fixed
- **Unrecognized / empty server shapes are now UNKNOWN, not SAFE** (RC-BLK-01).
  A server config whose runtime the parser could not recognize — a nested
  `mcpServers.<name>.server.url`, a typo'd key hiding a remote URL, or an empty
  server object — previously resolved to `SAFE` ("no blockers observed") with
  `autonomousUse: allow`. The verdict engine now requires a positively recognized
  source for `SAFE`: any unverifiable source resolves to `UNKNOWN`
  (`packages/risk-engine/src/computeVerdict.ts`). Separately, a config that parses
  but contains **zero servers** (empty `mcpServers`, or a wrong-schema file) now
  aggregates to `UNKNOWN` rather than `SAFE` (`packages/core/src/scanConfig.ts`) —
  "nothing was examined" must not read as "no blockers observed". See
  ADR 0010.

### Added
- Regression coverage for RC-BLK-01: golden fixture
  `unknown-unrecognized-shape.json` (→ UNKNOWN), corpus case
  `C031-unknown-unrecognized-shape` (`thisCaseMustNeverBeSafe`), and unit tests in
  `@calllint/risk-engine` and `@calllint/core`. Corpus is now **31 cases**
  (21 real/redacted), still 0 dangerous false-SAFE.

### Notes
- No detector, exit code, or pre-existing golden verdict changed. The only verdict
  delta is unrecognized/empty shapes moving `SAFE → UNKNOWN` (safe direction).
- The parser does not yet positively recognize a nested/aliased `server.url` as a
  remote; it reaches `UNKNOWN` via the unknown-source path. A pre-existing,
  non-blocking calibration item (an unrecognized local `command` resolving to
  `SAFE`, RC-OBS-02) is recorded for R2.2 and deliberately not changed here.

## [0.3.0-rc.0] — Stable candidate

First release candidate for the stable `0.3.0` line. **No scanner-semantics
change** since preview.1: no detector, verdict, golden expectation, or exit code
was altered. The rc validates the release path end-to-end before `0.3.0` claims
the `latest` dist-tag — release workflow, the dedicated `next` dist-tag, build
provenance, and the `npx` install path. Published to the **`next`** dist-tag
(`npx calllint@next`); `latest` is left on `0.3.0-preview.0` until stable, when
the drift is corrected.

### Added
- **R2.1 corpus** — expanded the calibration corpus to 30 cases, 20 of them
  real-public or redacted-real snapshots with per-case origin metadata, plus a
  `corpus:test:r2-final` gate asserting the R2.1 thresholds (≥30 cases, ≥20
  real/redacted, UNKNOWN ≤ 15%, dangerous false-SAFE = 0).
- **SARIF dogfood** — [`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
  runs CallLint in GitHub Actions; findings appear in Code Scanning. Linked from
  the README and the GitHub Actions integration doc.
- **Website V3** — agent-readable surface (`/llms.txt`, `/agent-instructions.md`,
  `/report-schema.md`, `/security-boundaries.md`), a "For agents" section, and
  corpus-status + release-integrity sections.
- Calibration issue templates and a release-verification doc for the preview
  feedback loop.

### Fixed
- `exec` detector no longer treats an inline `-e` value flag (e.g. `docker run
  -e KEY=val`) as an interpreter inline-eval; precision fix with golden cases.

### Changed
- Release workflow derives the dist-tag in three lanes so a tag can never claim
  the wrong channel: `*-rc.*` → `next`, any other prerelease → `preview`, clean
  semver → `latest`. Release candidates stay off `preview` so preview testers
  are not auto-moved onto an rc.
- `--sarif` exit-code note corrected: it exits 0 on its own (only `--ci` gates),
  so the example workflow drops the unnecessary `|| true`.

## [0.3.0-preview.1] — Interactive polish

### Added
- Tiny "breathing" brand mark on interactive runs — a small CallLint shield with
  a gentle fade pulse, printed to **stderr only**. Strictly suppressed on
  machine output (`--json`/`--sarif`/`--html`/`--compact`), when piped
  (non-TTY), and under `NO_COLOR`, `CI`, `--no-color`, `--no-emoji`, or
  `--stdin`. Purely cosmetic and time-boxed; never delays or fails a command.

## [0.3.0-preview.0] — First public preview

First public preview of CallLint on npm. Static configuration scanner only; does
not execute MCP servers and does not prove runtime safety. Published before the
release workflow derived dist-tags from the version, so it landed on the default
`latest` tag — the dist-tag drift tracked in PROJECT_STATUS "Known issues",
corrected at the first stable release.

### Added
- Public npm preview release (`calllint@0.3.0-preview.0`), installable via
  `npx calllint scan .cursor/mcp.json`.
- **R2.0 seed corpus gate** — `packages/fixtures/corpus/` with 10 calibrated
  cases covering the current finding families, plus a `corpus:test` release gate
  asserting verdict, max risk level, required/forbidden finding kinds, evidence,
  false-positive notes, remediation, and a "dangerous never SAFE" policy.
- Deterministic `--generated-at` support and offline-enforcing corpus run mode.
- Trusted Publishing release workflow (OIDC + provenance; no long-lived
  NPM_TOKEN), publishing the bundled CLI on GitHub Release.
- calllint.com public website (Cloudflare Pages, auto-deployed from `main`).
- GitHub issue templates for false-positive / false-negative / parser edge-case
  reports.

### Changed
- Project license changed from MIT to **Apache-2.0**; added `NOTICE` and
  `TRADEMARKS.md`. The npm tarball ships `LICENSE` and `NOTICE`.
- **Brand transition: MCPGuard → CallLint (v0.3-R0).** The public product is now
  CallLint. This renamed, with no change to scanner semantics:
  - npm package `mcpguard` → `calllint` (unscoped, single bundled CLI)
  - internal workspace scope `@mcpguard/*` → `@calllint/*`
  - CLI binary `mcpguard` → `calllint`
  - cache/baseline directory `.mcpguard/` → `.calllint/`
  - on-disk schema identifiers `mcpguard.{report,baseline,drift,policy}.v0` →
    `calllint.*.v0`
  - policy file `mcpguard.policy.json` → `calllint.policy.json`
  - config input key `x-mcpguard` → `x-calllint`
  - SARIF tool driver name `MCPGuard` → `CallLint`; report titles updated
  - No migration shim: no public release wrote the old paths, so the rename is a
    clean cut.
- README expanded to the full public section set (what it is / checks / does not
  check / install / quick start / example report / rule list / security model /
  limitations / roadmap).
- `CHANGELOG.md` added.

## [0.3-R1] — Distribution readiness

### Added
- Single bundled-CLI distribution: publishable package with an empty runtime
  dependency list, `files: ["dist"]` allowlist, `prepack` rebuild, and npm
  metadata (ADR 0007).
- `scripts/package-smoke.mjs` + `pnpm pack:smoke`: packs the real tarball and
  asserts the manifest, bin/type/shebang, an empty runtime dep list, and a
  self-contained bundle; then installs into an isolated global prefix and runs
  the installed binary.
- `.github/workflows/ci.yml`: typecheck/test/build/smoke/pack:smoke with a
  least-privilege token; never publishes, never executes a scanned server.
- Apache-2.0 `LICENSE` and `NOTICE` (ship in the tarball) and `SECURITY.md`.

### Changed
- `apps/cli` made publishable: dropped `private`, moved `workspace:*` to
  `devDependencies`, bin canonicalized to `dist/index.js`.

## [0.2.1] — Hardening

### Added
- MONEY golden coverage driven end-to-end from a single source of truth.
- `block-observed-payment` golden: observed money-mover + capability → BLOCK.
- Online no-downgrade invariant: findings carry `source`/`fetchedAt`; enrichment
  is advisory and code-enforced never to lower a verdict
  (ADR 0006).
- Windows path/shell regression coverage.
- `LIMITATIONS.md` (trust boundaries) and the release checklist.

### Changed
- Split name-inferred financial risk (`action.financial`, INFERRED → REVIEW)
  from observed money movement (`action.financial-observed`, OBSERVED → BLOCK).

## [0.2.0] — Engine completion

### Added
- Drift detection (`baseline` / `verify`) with rug-pull signal on
  pinned-version changes.
- SARIF 2.1.0 output (GitHub Code Scanning) and a self-contained HTML report.
- `npm:` and `github:` scan targets; opt-in `--online` advisory enrichment.

## [0.1.0] — Foundation

### Added
- pnpm monorepo: config parser, resolver, static analyzer (eight detectors),
  deterministic risk engine (S0–S5 classes, SAFE/REVIEW/BLOCK/UNKNOWN verdicts),
  policy-as-code with a CI gate, stable drift fingerprints, scan pipeline, and a
  terminal/compact/JSON report renderer.
- Golden verdict contract enforced through the built binary.
- CLI: `scan` / `baseline` / `verify` / `explain` / `policy` with documented
  exit codes (0 SAFE · 10 REVIEW · 20 UNKNOWN · 30 BLOCK · 40 DRIFT · 2 usage ·
  3 error).
