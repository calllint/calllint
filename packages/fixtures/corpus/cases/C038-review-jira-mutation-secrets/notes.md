# C038 — Jira MCP package (inferred external mutation)

## What this is

A single-server config from a public MCP catalog: `npx -y mcp-jira-server` with
`JIRA_BASE_URL` / `JIRA_API_TOKEN` / `JIRA_EMAIL` env. The second **real/redacted**
case for `action.external-mutation` (C019 Slack is the first), broadening that thin
shape with a different integration domain.

## Verdict: REVIEW

Findings (from a real scan of the built CLI):
- `action.external-mutation` (INFERRED, ACTION, S3) — package name `mcp-jira-server`
  matches a mutation-domain hint (jira).
- `secrets.env-key` — `JIRA_API_TOKEN` is credential-shaped.
- `supply.unpinned-package` — `npx -y mcp-jira-server` is unpinned.

Aggregate: REVIEW. None is a blocker.

## Calibration notes

- `action.external-mutation` is a name-based inference; a read-only Jira reporting
  integration would not actually mutate. The finding's false-positive note says so.
- Only `JIRA_API_TOKEN` trips `secrets.env-key`; `JIRA_BASE_URL` and `JIRA_EMAIL` are
  not credential-shaped names and are correctly not flagged — a small true-negative
  this case also documents.

## Provenance / redaction

- Source: `khopilot/amazing-mcp-for-productivity` @ `b0c3ac15`, `productivity/jira_mcp.json`.
- Unlicensed repo → `redacted-real-snapshot` (config shape not copyrightable).
- No secret redaction needed: env values were already upstream placeholders.
