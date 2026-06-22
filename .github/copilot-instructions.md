# GitHub Copilot instructions — CallLint

CallLint is a deterministic, offline-first **static pre-run** risk scanner for
MCP and agent-tool configurations. It returns SAFE, REVIEW, BLOCK, or UNKNOWN
with evidence. See `AGENTS.md` for the full contract and `CLAUDE.md` for the
local development contract.

## Invariants

- No LLM in the verdict path; an LLM may summarize, not decide.
- Never execute, install, or connect to a scanned MCP server.
- Never add default-on telemetry.
- Never weaken a detector, golden fixture, or corpus expectation to pass tests —
  fix the parser/fixture, or write an ADR first.
- UNKNOWN is not SAFE. SAFE is not proof of runtime safety.
- Every finding needs evidence, impact, and fix; every new rule needs a
  positive fixture, a negative fixture, and a unit test.

## Quality gates (Node 20 + pnpm)

```bash
export PATH="/c/nvm4w/nodejs:$PATH"
corepack enable pnpm
pnpm typecheck && pnpm test && pnpm build
pnpm corpus:test && pnpm corpus:test:r2-final
```

## Releases & copy

- Do not publish npm, create tags, or change dist-tags without human approval.
- In website/docs copy, never claim "proves safe", "guarantees safety", "zero
  false positives", "risks prevented", or "users protected"; no paid upsell.

## Governance

- CallLint is maintainer-led; keep it that way. Do not encourage broad external
  contribution workflows.
- Do not add CLA/DCO enforcement without human approval.
- Do not accept copied external code of unclear provenance.
- Preserve the Apache-2.0 license and trademark/brand docs; no registered-
  trademark claim unless a registration exists. See `GOVERNANCE.md`.
