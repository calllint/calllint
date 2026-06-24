# C040 — Local uv/python database MCP (SAFE true-negative)

## What this is

A single-server config from a public MCP catalog: `uv run python -m mcp_database_tool`
with one `DB_CONNECTION_STRING` env. The first **real/redacted local-python SAFE**
case — previously every real SAFE case was docker-based (C011–C013, C024).

## Verdict: SAFE

A real scan of the built CLI returns SAFE (S1, "read-only utility") with **zero**
findings:
- recognized local runtime (`uv run python -m <module>`) → sourceKnown, SAFE reachable;
- runs a local module, no `npx`/`uvx` package fetch → no `supply.unpinned-package`;
- no broad path, no remote URL;
- `DB_CONNECTION_STRING` is **not** a credential-shaped name → no `secrets.env-key`.

`expected.calllint.json` uses `allowExtraFindings: false` with a full
`forbiddenFindingIds` list so the case proves nothing fired — if any detector starts
flagging this shape, the case fails and forces a deliberate review.

## The true-negative this case pins

The secrets detector keys on credential-shaped substrings
(TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL/AUTH). `DB_CONNECTION_STRING` matches none, so it
is correctly unflagged — even though a real connection string can embed a password in
its *value*. CallLint inspects config-key **shape**, not values, by design (it never
reads secret values). That is a documented limitation, not a missed secret here: the
committed value is the placeholder `your-connection-string`. This mirrors the
synthetic C012 calibration ("connection-string env is not a secret key") but from a
real local-python config.

## Provenance / redaction

- Source: `khopilot/amazing-mcp-for-productivity` @ `b0c3ac15`, `ai_engineering/postgresql_mcp.json`.
- Unlicensed repo → `redacted-real-snapshot` (config shape not copyrightable).
- No secret redaction needed: `DB_CONNECTION_STRING` was already the upstream
  placeholder `your-connection-string`.
