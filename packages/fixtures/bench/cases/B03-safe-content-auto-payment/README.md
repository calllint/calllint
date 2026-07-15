# B03 — safe content, auto-payment capability

**Complementarity:** the content scan (even LLM-assisted) finds nothing malicious, but
CallLint blocks the observed auto-payment capability.

| Tool | Question it answers | Result |
| --- | --- | --- |
| SkillSpector (content) | Is the code malicious? | clean (no findings, `llm_used: true`) |
| CallLint (authority) | Is the granted authority acceptable? | **BLOCK** (`action.financial-observed`) |

Charging a card is a high-authority side effect regardless of code quality.

## Reproduce (offline; the server is never executed)

```bash
export PATH="/c/nvm4w/nodejs:$PATH"
pnpm build
node apps/cli/dist/index.js scan \
  packages/fixtures/bench/cases/B03-safe-content-auto-payment/input/mcp.json \
  --evidence packages/fixtures/bench/cases/B03-safe-content-auto-payment/skillspector-report.json \
  --json --no-emoji --generated-at 2026-06-16T00:00:00.000Z
```

## Pinned versions

- CallLint: the CLI at `apps/cli` in this commit.
- SkillSpector: committed fixture, pinned to `git:3333…3333` (illustrative; not a live run).

## Files

- `input/mcp.json` · `skillspector-report.json` · `calllint-report.json` ·
  `authority-manifest.json` · `expected.json` (see B01 for descriptions).
