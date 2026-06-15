# MCPGuard Project Status

Current phase: COMPLETE (v0.2)

Completed:
- Phase 0/1: workspace bootstrap (pnpm workspace, tsconfig, vitest, CLAUDE.md, docs)
- Phase 3: @mcpguard/types — verdicts, findings, reports, drift, label maps
- Phase 4: @mcpguard/fixtures — 10 golden configs + loader (verdict contract)
- Phase 5: @mcpguard/config-parser — normalize Cursor/Claude/VS Code configs
- Phase 6: @mcpguard/resolver — runtime binding (npx/node/remote/shell)
- Phase 7: @mcpguard/static-analyzer — 8 detectors (incl. MONEY financial-action)
- Phase 8: @mcpguard/risk-engine — deterministic verdict/class/repro + rule cards
- Phase 9: @mcpguard/policy — policy-as-code, validated expiring overrides, CI gate
- Phase 10: @mcpguard/fingerprint — stable drift hashes
- Phase 11: @mcpguard/core — full scan pipeline, cache, baseline/drift, targets
- Phase 6b: @mcpguard/report-renderer — terminal/compact/no-emoji/explain/json/sarif/html
- Phase 12: @mcpguard/cli — scan/baseline/verify/explain/policy, exit codes, esbuild bundle
- Phase 13: tests/e2e — built-binary E2E
- Phase 14: opt-in self-guard script + examples/sample-mcp.json + README

v0.2 additions:
- Phase A: MONEY financial-action detector (name-based S5 inference → REVIEW) + review-financial golden
- Phase B: drift detection — `baseline` + `verify` commands, RUGPULL signal, EXIT.DRIFT=40
- Phase C: SARIF 2.1.0 output (`scan --sarif`) for GitHub Code Scanning / CI
- Phase D: self-contained HTML report (`scan --html`) with strict XSS escaping
- Phase E: synthetic npm/github targets (`scan npm:<pkg>` offline, `github:<repo>` via --online)
- Phase F: @mcpguard/online — opt-in `--online` npm registry + github config enrichment (injectable fetch)

Verification status (last run):
- typecheck: clean (tsc strict)
- tests: 151 passed across 16 files (unit + E2E against built binary; network mocked in tests)
- build: apps/cli/dist/index.js (~60kb)
- CLI smoke: scan/baseline/verify/sarif/html/npm targets + live --online confirmed

Exit codes (CI):
- 0 SAFE · 10 REVIEW (if failOnReview) · 20 UNKNOWN · 30 BLOCK · 40 DRIFT (verify --ci) · 2 usage · 3 error

Golden verdict contract (all passing through the built binary):
- safe-time → SAFE
- safe-filesystem-workspace → SAFE
- review-github → REVIEW
- review-unpinned-package → REVIEW
- review-financial → REVIEW
- block-filesystem → BLOCK
- block-prompt-poison → BLOCK
- block-dangerous-command → BLOCK
- unknown-remote → UNKNOWN
- malformed → parse error (exit 3)

Design decisions of note:
- UNKNOWN never auto-upgrades to SAFE.
- Risk engine is pure/deterministic; no LLM in the verdict path.
- JSON report is the stable, emoji-free contract; human views (terminal/sarif/html) derive from it.
- now/generatedAt are injected for deterministic, reproducible reports.
- Self-guard ships as an opt-in script, NOT an auto-installed hook (user decision).
- Network is opt-in (--online) and behind an injectable fetch interface; analyzers stay pure and offline. Tests never touch the network.
- Drift baseline stores only deterministic data (no timestamps in the comparison surface); a pinned-version change is treated as a rug-pull signal.

Open risks:
- None blocking. Detectors are heuristic (documented falsePositiveNote on each finding).

Non-goals (v0.2):
- No gateway, payments, marketplace, SaaS dashboard.
- No host execution of unknown MCP servers, no real secret access, no destructive calls.
- --online reads public registry/repo metadata only; it never executes fetched code.
