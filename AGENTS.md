# CallLint — agent instructions

Repository-level guidance for IDE and coding agents working in this repo
(GitHub Copilot, Cursor, Claude, and similar). It mirrors the project's
non-negotiable invariants so an agent contributing here stays inside them.
The full development contract lives in `CLAUDE.md`; this file must never
contradict it or `PROJECT_STATUS.md`.

## What CallLint is

CallLint is a deterministic, offline-first **static pre-run** risk scanner for
MCP and agent-tool configurations. It returns SAFE, REVIEW, BLOCK, or UNKNOWN
with evidence before an agent loads the tool server.

## Core invariants (do not violate)

- No LLM in the verdict path. An LLM may summarize evidence; it must not decide
  a verdict.
- Never execute, install, or connect to a scanned MCP server.
- Never add default-on telemetry (telemetry stays opt-in by ADR).
- Never weaken a detector, golden fixture, or corpus expectation to make a test
  pass. Fix the parser/fixture, or write an ADR if a rule is genuinely wrong.
- UNKNOWN is not SAFE, and never auto-upgrades to SAFE.
- SAFE means "no blockers observed under current evidence" — not a proof of
  runtime safety.
- Every finding needs evidence, impact, and fix. Every new rule needs a
  positive fixture, a negative fixture, and a unit test.
- Any breaking change to `ScanReport` or the policy schema requires an ADR.

## Quality gates (run before any checkpoint)

This machine's default `node` is too old; use Node 20 + pnpm:

```bash
export PATH="/c/nvm4w/nodejs:$PATH"   # Node v20.20.2
corepack enable pnpm                  # gives pnpm 9.x
pnpm typecheck
pnpm test
pnpm build
pnpm corpus:test
pnpm corpus:test:r2-final
```

## Releases (human approval required)

- Do not publish to npm, create git tags, or change dist-tags without explicit
  human approval.
- Release candidates publish to the `next` dist-tag; previews to `preview`;
  clean semver to `latest`.

## When editing website or docs copy

Do not introduce unsupported claims. Forbidden phrasing includes:

- "proves safe" / "guarantees safety"
- "zero false positives" / "zero false negatives"
- "risks prevented" / "users protected" / "threats blocked"
- paid / pricing / subscribe / purchase upsell language

Keep limitations visible (README and homepage). Agent recommendation rules and
wording live in `apps/web/public/agent-instructions.md`, not in human-facing
homepage copy.

## Governance (maintainer-led)

CallLint is maintainer-led — open source for trust and adoption, not
community-driven development. See `GOVERNANCE.md` and `CONTRIBUTING.md`.

- Keep the project maintainer-led; do not encourage broad external contribution
  workflows in docs or copy.
- Do not add CLA or DCO enforcement (bots, checks, required sign-off) without
  explicit human approval.
- Do not accept or merge copied external code of unclear or incompatible
  provenance.
- Preserve the Apache-2.0 license and the trademark/brand boundary
  (`TRADEMARKS.md`); do not claim a registered
  trademark unless a registration exists.
