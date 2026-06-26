# C040 — Local uv/python database MCP (REVIEW — unverified local source)

## What this is

A single-server config from a public MCP catalog: `uv run python -m mcp_database_tool`
with one `DB_CONNECTION_STRING` env. The first **real/redacted local-python** case
in the corpus.

## Verdict: REVIEW

A real scan of the built CLI returns REVIEW (S2) with exactly one finding,
`exec.unverified-local-source`:
- `uv` is **not** a recognized package runner (only `uvx` is), so this is a bare
  local runtime running a local module → `sourceKnown`, but the module is never
  inspected → `exec.unverified-local-source` fires (ADR 0011 Direction 2);
- no `npx`/`uvx` package fetch → no `supply.unpinned-package`;
- no broad path, no remote URL;
- `DB_CONNECTION_STRING` is **not** a credential-shaped name → no `secrets.env-key`.

`expected.calllint.json` uses `allowExtraFindings: false` with the new finding
required and `secrets.env-key` still forbidden, so the case proves the REVIEW comes
*only* from the unverified local source — not from a (correctly absent) secret.

## The true-negative this case still pins

The secrets detector keys on credential-shaped substrings
(TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL/AUTH). `DB_CONNECTION_STRING` matches none, so it
is correctly unflagged — even though a real connection string can embed a password in
its *value*. CallLint inspects config-key **shape**, not values, by design. This mirrors
the synthetic C012 calibration ("connection-string env is not a secret key") but from a
real local-python config. The verdict flip to REVIEW did not weaken this: `secrets.env-key`
remains forbidden.

## History

Shipped SAFE in R2.2 batch 3 (the first real local-python SAFE shape). Flipped
SAFE → REVIEW when ADR 0011 Direction 2 was Accepted (2026-06-25): a bare `uv run
python -m …` is a local source CallLint cannot verify. Dir renamed
`C040-safe-…` → `C040-review-postgres-local-python`.

## Provenance / redaction

- Source: `khopilot/amazing-mcp-for-productivity` @ `b0c3ac15`, `ai_engineering/postgresql_mcp.json`.
- Unlicensed repo → `redacted-real-snapshot` (config shape not copyrightable).
- No secret redaction needed: `DB_CONNECTION_STRING` was already the upstream
  placeholder `your-connection-string`.
