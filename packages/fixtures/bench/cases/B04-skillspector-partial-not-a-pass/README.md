# B04 — an incomplete content scan is never a pass

**Complementarity:** the SkillSpector scan only partially completed, so its low score is
**not** a pass; CallLint independently returns UNKNOWN for the unverifiable remote.

| Tool | Question it answers | Result |
| --- | --- | --- |
| SkillSpector (content) | Is the code malicious? | **partial** (incomplete — 1 low finding) |
| CallLint (authority) | Is the granted authority acceptable? | **UNKNOWN** (`supply.unknown-remote`) |

Neither tool clears the artifact. A degraded/partial content scan must never round up to
safe (ADR 0034 fail-closed), and an unverifiable remote is never SAFE (UNKNOWN ≠ SAFE).

## Reproduce (offline; the server is never executed)

```bash
export PATH="/c/nvm4w/nodejs:$PATH"
pnpm build
node apps/cli/dist/index.js scan \
  packages/fixtures/bench/cases/B04-skillspector-partial-not-a-pass/input/mcp.json \
  --evidence packages/fixtures/bench/cases/B04-skillspector-partial-not-a-pass/skillspector-report.json \
  --json --no-emoji --generated-at 2026-06-16T00:00:00.000Z
```

## Pinned versions

- CallLint: the CLI at `apps/cli` in this commit.
- SkillSpector: committed fixture, pinned to `git:4444…4444` (illustrative; not a live run),
  `status: partial`.

## Files

- `input/mcp.json` · `skillspector-report.json` · `calllint-report.json` ·
  `authority-manifest.json` · `expected.json` (see B01 for descriptions).
