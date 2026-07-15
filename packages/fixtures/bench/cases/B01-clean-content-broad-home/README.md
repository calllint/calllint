# B01 — clean content, broad `$HOME` filesystem authority

**Complementarity:** the content scan finds nothing malicious, but CallLint blocks
the authority the config requests — a filesystem server scoped to the whole home
directory.

| Tool | Question it answers | Result |
| --- | --- | --- |
| SkillSpector (content) | Is the code malicious? | clean (no findings) |
| CallLint (authority) | Is the granted authority acceptable? | **BLOCK** (`files.broad-path`) |

The two disagree because they answer different questions. Clean code can still
request unsafe authority.

## Reproduce (offline; the server is never executed)

```bash
export PATH="/c/nvm4w/nodejs:$PATH"
pnpm build
node apps/cli/dist/index.js scan \
  packages/fixtures/bench/cases/B01-clean-content-broad-home/input/mcp.json \
  --evidence packages/fixtures/bench/cases/B01-clean-content-broad-home/skillspector-report.json \
  --json --no-emoji --generated-at 2026-06-16T00:00:00.000Z
```

## Pinned versions

- CallLint: the CLI at `apps/cli` in this commit.
- SkillSpector: report is a committed fixture, pinned to `git:1111…1111` (illustrative
  commit; SkillSpector has no formal release, so version is pinned to a commit per ADR 0034).
  It is **not** produced by a live SkillSpector run.

## Files

- `input/mcp.json` — the config under test.
- `skillspector-report.json` — the committed content-scan evidence.
- `calllint-report.json` — the CallLint report (regenerate with `pnpm bench:test --write-artifacts`).
- `authority-manifest.json` — the read-only `trust prepare` output (artifact + authority + decision).
- `expected.json` — the asserted contract (checked by `pnpm bench:test`).
