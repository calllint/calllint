# MCPGuard Project Status

Current phase: COMPLETE (v0.1)

Completed:
- Phase 0/1: workspace bootstrap (pnpm workspace, tsconfig, vitest, CLAUDE.md, docs)
- Phase 3: @mcpguard/types — verdicts, findings, reports, label maps
- Phase 4: @mcpguard/fixtures — 9 golden configs + loader (verdict contract)
- Phase 5: @mcpguard/config-parser — normalize Cursor/Claude/VS Code configs
- Phase 6: @mcpguard/resolver — runtime binding (npx/node/remote/shell)
- Phase 7: @mcpguard/static-analyzer — 7 detectors
- Phase 8: @mcpguard/risk-engine — deterministic verdict/class/repro + rule cards
- Phase 9: @mcpguard/policy — policy-as-code, validated expiring overrides, CI gate
- Phase 10: @mcpguard/fingerprint — stable drift hashes
- Phase 11: @mcpguard/core — full scan pipeline + cache
- Phase 6b: @mcpguard/report-renderer — terminal/compact/no-emoji/explain/json
- Phase 12: @mcpguard/cli — scan/explain/policy, exit codes, esbuild bundle
- Phase 13: tests/e2e — built-binary E2E
- Phase 14: opt-in self-guard script + examples/sample-mcp.json + README

Verification status (last run):
- typecheck: clean (tsc strict)
- tests: 113 passed across 12 files (unit + E2E against built binary)
- build: apps/cli/dist/index.js (~49kb)
- CLI smoke + self-guard: verdicts and exit codes confirmed (SAFE=0, UNKNOWN=20, BLOCK=30)

Golden verdict contract (all passing through the built binary):
- safe-time → SAFE
- safe-filesystem-workspace → SAFE
- review-github → REVIEW
- review-unpinned-package → REVIEW
- block-filesystem → BLOCK
- block-prompt-poison → BLOCK
- block-dangerous-command → BLOCK
- unknown-remote → UNKNOWN
- malformed → parse error (exit 3)

Design decisions of note:
- UNKNOWN never auto-upgrades to SAFE.
- Risk engine is pure/deterministic; no LLM in the verdict path.
- JSON report is the stable, emoji-free contract; human views derive from it.
- now/generatedAt are injected for deterministic, reproducible reports.
- Self-guard ships as an opt-in script, NOT an auto-installed hook (user decision).

Open risks:
- None blocking. Detectors are heuristic (documented falsePositiveNote on each finding).

Non-goals (v0.1):
- No gateway, payments, marketplace, SaaS dashboard.
- No host execution of unknown MCP servers, no real secret access, no destructive calls.
