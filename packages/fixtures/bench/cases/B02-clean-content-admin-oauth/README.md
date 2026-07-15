# B02 — clean content, admin OAuth scope

**Complementarity:** the content scan is clean, but CallLint flags the broad admin
OAuth scope for human review.

| Tool | Question it answers | Result |
| --- | --- | --- |
| SkillSpector (content) | Is the code malicious? | clean (no findings) |
| CallLint (authority) | Is the granted authority acceptable? | **REVIEW** (`auth.oauth-scope`) |

Clean code can still request expansive authority — here, `admin` / `full_access` OAuth scopes.

## Reproduce (offline; the server is never executed)

```bash
export PATH="/c/nvm4w/nodejs:$PATH"
pnpm build
node apps/cli/dist/index.js scan \
  packages/fixtures/bench/cases/B02-clean-content-admin-oauth/input/mcp.json \
  --evidence packages/fixtures/bench/cases/B02-clean-content-admin-oauth/skillspector-report.json \
  --json --no-emoji --generated-at 2026-06-16T00:00:00.000Z
```

## Pinned versions

- CallLint: the CLI at `apps/cli` in this commit.
- SkillSpector: committed fixture, pinned to `git:2222…2222` (illustrative; not a live run).

## Files

- `input/mcp.json` · `skillspector-report.json` · `calllint-report.json` ·
  `authority-manifest.json` · `expected.json` (see B01 for descriptions).
