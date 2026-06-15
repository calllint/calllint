# MCPGuard Project Status

Current phase: Phase 0 (workspace bootstrap)

Completed:
- Repo discovery
- git init
- Root workspace config (pnpm-workspace, package.json, tsconfig, vitest)

Open risks:
- None

Non-goals (v0.1):
- No gateway
- No payment
- No marketplace
- No SaaS dashboard
- No host execution of unknown MCP servers
- No real secret access
- No destructive tool calls

Golden fixtures (verdict contract):
- safe-time → SAFE
- review-github → REVIEW
- block-filesystem → BLOCK
- unknown-remote → UNKNOWN
- block-prompt-poison → BLOCK
- review-unpinned-package → REVIEW
- block-dangerous-command → BLOCK
- malformed → parse error

Last test status:
- Not run

Next phase:
- Phase 3: types package
