# MCPGuard Project Status

Current phase: HARDENED (v0.2.1)

## Current milestone

v0.2.1 Hardening — release credibility pass on top of the complete v0.2 engine.
The detection engine, verdict semantics, and pipeline are unchanged in spirit;
this milestone closes the gaps between "works" and "trustworthy to ship": the
MONEY contract is enforced end-to-end, observed money-movers hard-block, online
enrichment can never downgrade a verdict, Windows behaviour is pinned, the
shipped artifact is smoke-tested, and the docs carry a user-success path plus
explicit limitations.

## Completed (v0.1 + v0.2 foundation)

- Phase 0/1: workspace bootstrap (pnpm workspace, tsconfig, vitest, CLAUDE.md, docs)
- Phase 3: @mcpguard/types — verdicts, findings, reports, drift, label maps
- Phase 4: @mcpguard/fixtures — golden configs + loader (verdict contract)
- Phase 5: @mcpguard/config-parser — normalize Cursor/Claude/VS Code configs
- Phase 6: @mcpguard/resolver — runtime binding (npx/node/remote/shell)
- Phase 7: @mcpguard/static-analyzer — detectors (incl. MONEY financial-action)
- Phase 8: @mcpguard/risk-engine — deterministic verdict/class/repro + rule cards
- Phase 9: @mcpguard/policy — policy-as-code, validated expiring overrides, CI gate
- Phase 10: @mcpguard/fingerprint — stable drift hashes
- Phase 11: @mcpguard/core — full scan pipeline, cache, baseline/drift, targets
- Phase 6b: @mcpguard/report-renderer — terminal/compact/no-emoji/explain/json/sarif/html
- Phase 12: @mcpguard/cli — scan/baseline/verify/explain/policy, exit codes, esbuild bundle
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

## Verification status (last run)

- typecheck: clean (tsc strict)
- tests: 174 passed across 18 files (unit + E2E against built binary; package
  smoke; network mocked — tests never touch the network)
- build: apps/cli/dist/index.js (self-contained esbuild bundle, node shebang)
- CLI smoke: scan/baseline/verify/sarif/html/npm targets confirmed

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

- Detectors are heuristic by nature (documented `falsePositiveNote` on each finding); see LIMITATIONS.md.
- A true `npm pack` / publish of the workspace package is not yet wired — the
  bundle is the shipped artifact and is smoke-tested, but publishing is a
  documented manual release step (docs/release-checklist.md).

## Next roadmap (v0.3 candidates)

- Publishable distribution: resolve workspace deps for a real `npm pack` /
  `npx mcpguard` flow (or a single published bundle package).
- Broaden observed-action coverage beyond payments (destructive external
  mutations) with the same INFERRED/OBSERVED split.
- Richer online sources (advisory databases) — still advisory, still no-downgrade.
- Config auto-discovery across more hosts; multi-config workspace scan.

## Non-goals (v0.2.x)

- No gateway, payments, marketplace, SaaS dashboard.
- No host execution of unknown MCP servers, no real secret access, no destructive calls.
- --online reads public registry/repo metadata only; it never executes fetched code.
