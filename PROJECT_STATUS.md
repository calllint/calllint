# CallLint Project Status

Current phase: v0.3-R0 Brand Transition (complete)

Product name: **CallLint** (CLI `calllint`, npm `calllint`, internal scope
`@calllint/*`). `MCPGuard` was the internal codename — see
[ADR 0008](docs/adr/0008-brand-transition-calllint.md). Historical planning docs
(`000.md`, ADRs 0001/0003/0004) retain the codename intentionally.

## Current milestone

v0.3-R0 Brand Transition — adopt the public product name **CallLint** across the
npm package, CLI binary, internal scope, cache directory, on-disk schema
identifiers, policy filename, report identity (SARIF/HTML/terminal), and
current-product docs. Zero scanner-semantics change: no detector, verdict,
golden expectation, or exit code altered; tests asserting brand/schema/input
literals were updated to track the rename, not weakened. Narratively R0 precedes
R1 (the distribution work below), which is already complete.

## Previous milestone (v0.3-R1 distribution readiness — complete)

Turn the hardened engine into an installable, runnable, publishable CLI without
changing any scanner semantics. The `workspace:*` + `private` blocker that
prevented a real `npm pack` / `npx calllint` flow is resolved: the published
package is a publishable single-bundle with an empty runtime dependency list and
a `files` allowlist, the real tarball is smoke-tested through an isolated global
install, and `npm publish --dry-run` passes. GitHub CI, SECURITY.md, and an MIT
LICENSE are in place.

## Previous milestone (v0.2.1 hardening)

Release credibility pass on the complete v0.2 engine: MONEY contract enforced
end-to-end, observed money-movers hard-block, online enrichment can never
downgrade a verdict, Windows behaviour pinned, shipped artifact smoke-tested,
docs carry a user-success path plus explicit limitations.

## Completed (v0.1 + v0.2 foundation)

- Phase 0/1: workspace bootstrap (pnpm workspace, tsconfig, vitest, CLAUDE.md, docs)
- Phase 3: @calllint/types — verdicts, findings, reports, drift, label maps
- Phase 4: @calllint/fixtures — golden configs + loader (verdict contract)
- Phase 5: @calllint/config-parser — normalize Cursor/Claude/VS Code configs
- Phase 6: @calllint/resolver — runtime binding (npx/node/remote/shell)
- Phase 7: @calllint/static-analyzer — detectors (incl. MONEY financial-action)
- Phase 8: @calllint/risk-engine — deterministic verdict/class/repro + rule cards
- Phase 9: @calllint/policy — policy-as-code, validated expiring overrides, CI gate
- Phase 10: @calllint/fingerprint — stable drift hashes
- Phase 11: @calllint/core — full scan pipeline, cache, baseline/drift, targets
- Phase 6b: @calllint/report-renderer — terminal/compact/no-emoji/explain/json/sarif/html
- Phase 12: @calllint/cli — scan/baseline/verify/explain/policy, exit codes, esbuild bundle
- Phase 13: tests/e2e — built-binary E2E
- Phase 14: opt-in self-guard script + examples/sample-mcp.json + README
- v0.2: drift detection, SARIF 2.1.0, HTML report, npm/github targets, opt-in --online

## Completed (v0.2.1 hardening)

- H1: MONEY golden coverage end-to-end — the built-binary contract is driven
  from GOLDEN_CASES (single source of truth); review-financial pins S5 + MONEY.
- H2: observed-payment risk split — `action.financial` (INFERRED → REVIEW) vs
  `action.financial-observed` (OBSERVED money-mover + capability → BLOCK);
  block-observed-payment golden added.
- H3: online no-downgrade invariant — Finding gains `source`/`fetchedAt`; online
  findings stamped + advisory; scanServer throws if enrichment lowers a verdict
  (ADR 0006).
- H4: README rewritten for developer onboarding (value line, is/is not, quick
  start, CI/SARIF/HTML/drift/policy/online, security model, limitations).
- H5: GitHub Actions + SARIF workflow example and integration walkthrough.
- H6: Windows path/shell regression pinned (C:\Users → BLOCK, powershell →
  BLOCK, ${workspaceFolder} → SAFE).
- H7: package smoke test on the shipped artifact (bin entry, shebang,
  self-contained bundle, --help, real scan, usage exit) + `pnpm smoke`.
- H8: this status.
- H9: LIMITATIONS.md (trust boundaries).
- H10: docs/release-checklist.md.

## Completed (v0.3-R0 brand transition)

- R0-1: ADR 0008 — public name CallLint, MCPGuard as historical codename, narrow
  positioning (lint agent tool-call risk before tools run), schemaVersion rename
  with no migration shim, keep-historical policy for 000.md and prior ADRs.
- R0-2: controlled rename — npm `calllint`, scope `@calllint/*`, bin `calllint`,
  cache `.calllint/`, schema `calllint.*.v0`, policy `calllint.policy.json`,
  input key `x-calllint`, SARIF/HTML/terminal identity, current-product docs;
  asserting tests updated to track literals. Full gate green; grep audit clean.
- R0-3: CHANGELOG.md added; README expanded to the full public section set
  (what is / checks / does-not-check / install / quick start / example report /
  rule list / security model / limitations / roadmap); this status.

## Completed (v0.3-R1 distribution readiness)

- R1-0: corrected test file count (18 files) across docs.
- R1-1: ADR 0007 — single bundled-CLI distribution strategy (why not
  multi-package; minimal, auditable artifact; npm = distribution, GitHub =
  source/CI/audit).
- R1-2: publish package boundary — `apps/cli` made publishable (dropped
  `private`, empty runtime `dependencies`, `workspace:*` moved to
  `devDependencies`, `files: ["dist"]` allowlist, npm metadata, `prepack`
  rebuild, npm-facing README).
- R1-3: `scripts/package-smoke.mjs` + `pnpm pack:smoke` — packs the real
  tarball and asserts the manifest, the bin/type/shebang, an empty runtime dep
  list, and a self-contained bundle.
- R1-4: isolated global-install smoke — installs the tarball into a throwaway
  prefix and runs the installed binary (`--help`, `scan`, `--json`, `--ci`
  exit 30 on BLOCK) from a clean cwd.
- R1-5: `npm publish --dry-run` passes; bin canonicalized to `dist/index.js`;
  release checklist updated (pack/dry-run steps + official-registry note).
- R1-6: `.github/workflows/ci.yml` — typecheck/test/build/smoke/pack:smoke,
  least-privilege token, never publishes, never executes a scanned server.
- R1-7: MIT LICENSE (ships in the tarball) + SECURITY.md (enforced safety
  boundaries, non-guarantees, minimal distribution surface, private reporting).
- R1-8: this status.

## Verification status (last run)

- typecheck: clean (tsc strict)
- tests: 174 passed across 18 files (unit + E2E against built binary; package
  smoke; network mocked — tests never touch the network)
- build: apps/cli/dist/index.js (self-contained esbuild bundle, node shebang)
- CLI smoke: scan/baseline/verify/sarif/html/npm targets confirmed
- pack:smoke: real npm tarball (4 files: package.json, README.md, LICENSE,
  dist/index.js), empty runtime deps, no `workspace:*`; isolated global install
  runs `calllint --help` / `scan` / `--json` / `--ci` (exit 30 on BLOCK)
- npm publish --dry-run: passes (no auth required for dry-run)

## Exit codes (CI)

- 0 SAFE · 10 REVIEW (if failOnReview) · 20 UNKNOWN · 30 BLOCK · 40 DRIFT (verify --ci) · 2 usage · 3 error

## Golden verdict contract (all passing through the built binary)

- safe-time → SAFE
- safe-filesystem-workspace → SAFE
- safe-windows-workspace → SAFE
- review-github → REVIEW
- review-unpinned-package → REVIEW
- review-financial → REVIEW (S5, MONEY, name-inferred)
- block-filesystem → BLOCK
- block-prompt-poison → BLOCK
- block-dangerous-command → BLOCK
- block-powershell-command → BLOCK
- block-windows-user-profile → BLOCK
- block-observed-payment → BLOCK (S5, MONEY, observed money-mover)
- unknown-remote → UNKNOWN
- malformed → parse error (exit 3)

## Design decisions of note

- UNKNOWN never auto-upgrades to SAFE.
- Risk engine is pure/deterministic; no LLM in the verdict path.
- JSON report is the stable, emoji-free contract; human views (terminal/sarif/html) derive from it.
- now/generatedAt are injected for deterministic, reproducible reports.
- Name-inferred and observed findings are never conflated (H2): inference is REVIEW, observed money movement is BLOCK.
- Online enrichment is advisory and code-enforced never to downgrade a verdict (H3, ADR 0006).
- Self-guard ships as an opt-in script, NOT an auto-installed hook (user decision).
- Network is opt-in (--online) and behind an injectable fetch interface; analyzers stay pure and offline. Tests never touch the network.
- Drift baseline stores only deterministic data; a pinned-version change is treated as a rug-pull signal.

## Open risks

- Detectors are heuristic by nature (documented `falsePositiveNote` on each
  finding); see LIMITATIONS.md.
- The package is verified through `npm pack` + isolated install + `npm publish
  --dry-run`, but has **not been published** to a public registry yet. A real
  publish requires `npm login` against the official registry
  (`https://registry.npmjs.org/`); the local default may point at a mirror.
- Validation is still primarily **fixture-proven**, not **corpus-proven** — the
  next milestone (v0.3-R2) calibrates against real-world configs.

## Next roadmap (v0.3)

- **v0.3-R2 — Real-world static corpus (next):** add
  `packages/fixtures/corpus/` with ~30 real MCP samples (filesystem, GitHub,
  browser, database, Slack/Notion/Google, Stripe/payment, Docker, uvx/python,
  remote SSE, Windows, read-only utility, prompt-heavy), each with
  config/expected/note; a corpus contract test; false-positive notes. Goal:
  calibrate false positives, expose parser edges, seed a future Trust Index.
- v0.3-R3 — `calllint diagnostics --json` (stable IDE protocol; no plugin yet).
- v0.3-R4 — Prompt Surface expansion (README/SKILL/tool/schema descriptions,
  hidden-instruction / exfiltration rules).
- v0.3-R5 — GitHub Actions + SARIF real-world verification (Code Scanning).
- (Then) public npm preview + public GitHub preview once corpus + diagnostics
  land.

## Non-goals (v0.3-R1)

- No gateway, payments, marketplace, SaaS dashboard.
- No host execution of unknown MCP servers, no real secret access, no destructive calls.
- --online reads public registry/repo metadata only; it never executes fetched code.
