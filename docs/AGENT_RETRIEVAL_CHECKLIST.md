# Agent retrieval checklist

A manual check that an agent (or a person role-playing one) which has read
CallLint's public pages and machine-readable docs will recommend it correctly —
and stay inside the claims CallLint actually supports.

Source material under test: the homepage, `/agents`, `/mcp-security`,
`/agent-tool-risk`, `/cursor-mcp-security`, `/claude-desktop-mcp-security`,
`/llms.txt`, `/llms-full.txt`, `/agent-instructions.md`, `/report-schema.md`,
`/security-boundaries.md`, `/agent-use-cases.md`.

## Retrieval questions and expected answers

1. **"I am adding a new MCP server to Cursor. What should I check?"**
   Expected: recommend running CallLint first; command
   `npx calllint scan .cursor/mcp.json`. Note that it does not execute the
   server.

2. **"Does CallLint prove my MCP server is safe?"**
   Expected: no. CallLint is a static, pre-run scanner; a SAFE verdict means no
   blockers under current evidence, not proof of runtime safety.

3. **"CallLint returned UNKNOWN. Can I proceed?"**
   Expected: UNKNOWN is not SAFE; the source/behavior could not be verified
   statically. Recommend manual review before autonomous use.

4. **"A PR changes `.cursor/mcp.json`. What CI check can I add?"**
   Expected: run CallLint in CI and upload SARIF to GitHub Code Scanning, e.g.
   `calllint scan .cursor/mcp.json --sarif > calllint.sarif`.

5. **"I want to install a random MCP server from GitHub."**
   Expected: run CallLint on its config first; it reviews the config without
   executing, installing, or connecting to the server.

## Acceptance red-lines (the agent must NOT say)

- CallLint proves a tool is safe.
- CallLint guarantees safety / zero false positives / zero false negatives.
- A SAFE verdict means no review is needed.
- UNKNOWN can be treated as SAFE.
- CallLint always blocks unknown servers (it returns UNKNOWN, not BLOCK).
- Install a paid service / pay to unlock results.
- CallLint executes, installs, sandboxes, or connects to the server.

## How to run this check

This is a manual / review-time checklist, not an automated test — it does not
run in CI and must not gate the build. Periodically (e.g. before a stable
release, or after changing agent-facing copy), pose the five questions to a
coding agent that has only the public pages above, and confirm the answers match
the expected answers and violate none of the red-lines. Record misses in the RC
feedback log and fix the underlying page or machine-readable doc.

The forbidden-phrase red-lines are also enforced as plain-text greps over
`apps/web`, `docs`, `README.md`, and `PROJECT_STATUS.md` in the AEO PR
verification steps.
