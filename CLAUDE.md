# CallLint Development Contract

CallLint is a CLI-first, IDE-friendly, JSON-native security **verdict** engine for
MCP servers and agent skills.

> **Evidence-backed verdicts for agent tools.**
> Scan MCP servers before your agent runs them.

## Product Principles (non-negotiable)

1. Verdict first, score second.
2. UNKNOWN is not SAFE.
3. Evidence is mandatory for every finding.
4. Deterministic rules decide verdicts.
5. An LLM may summarize evidence, but must not decide security verdicts.
6. Quick Scan must NOT execute unknown MCP servers.
7. Deep Scan requires a sandbox and is out of scope for v0.1.
8. Every finding must distinguish Observed vs Inferred risk.
9. Every verdict must be reproducible or explicitly marked non-reproducible.
10. Policy-as-code is part of v0.1, not a later enterprise add-on.
11. Golden fixtures cannot be weakened to pass tests.
12. Every phase must end with tests, typecheck, and a checkpoint summary.

## The Agency Risk Model

```
Agency Risk = Agency × Authority × Data Sensitivity × Side Effect × Observability × Reproducibility
```

A tool is risky not because it has a CVE, but because an autonomous agent may invoke
it. See `docs/threat-model.md`.

## Architecture (monorepo)

- `apps/cli` — the command-line product (`calllint`)
- `packages/types` — shared schema; the single source of truth for all output
- `packages/config-parser` — parse `.cursor/mcp.json`, `.claude/settings.json`, inline JSON
- `packages/resolver` — resolve a server config into a RuntimeBinding (what actually runs)
- `packages/static-analyzer` — deterministic detectors → Finding[]
- `packages/risk-engine` — agency risk, risk class, verdict, recommended policy
- `packages/policy` — policy-as-code: load, validate, apply, explain
- `packages/fingerprint` — config/target/package/risk-surface hashes + reproducibility
- `packages/core` — the scan pipeline that wires everything into a ScanReport
- `packages/report-renderer` — terminal / compact / no-emoji / explain / JSON renderers
- `packages/fixtures` — golden configs + loader (the project's safety floor)

All UI (CLI, JSON, IDE, Web) consumes the same `ScanReport` schema from `@calllint/types`.

## Non-negotiable Safety Rules

- Never run untrusted install scripts in host mode.
- Never execute an unknown MCP server during Quick Scan.
- Never pass real secrets to a probe or test.
- Never call destructive MCP tools.
- Never mark an unknown source as SAFE.
- Never produce a finding without evidence, impact, and fix.
- Never introduce a rule without a positive and negative fixture.

## Developer (and Agent) Discipline

- Never weaken a security rule to make a test pass. Fix the parser, the fixture, or
  the test expectation — and if a rule is genuinely wrong, write an ADR first.
- Never edit a golden fixture's expected verdict to make tests pass.
- Any breaking change to `ScanReport` or the policy schema requires an ADR.
- Every new detection rule needs: implementation + a positive fixture + a negative
  fixture + a unit test.

## Verdict Semantics

| CLI       | Public report label   | Meaning                              |
| --------- | --------------------- | ------------------------------------ |
| 🛡 SAFE   | No blockers observed  | No blockers under current evidence   |
| ⚠ REVIEW  | Review required       | Human confirmation needed            |
| ⛔ BLOCK   | Blocked by policy     | Policy/rule blocked it               |
| ◇ UNKNOWN | Insufficient evidence | Source/behavior could not be verified|

`SAFE` only means "no blockers observed under current evidence." It is never a
guarantee. UNKNOWN never auto-upgrades to SAFE.

## Toolchain

This machine's default shell `node` is v16 (too old). Use Node 20 + pnpm:

```bash
export PATH="/c/nvm4w/nodejs:$PATH"   # Node v20.20.2
corepack enable pnpm                  # one-time; gives pnpm 9.x
pnpm install
pnpm test && pnpm typecheck
```
