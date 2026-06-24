# C037 — Stripe payments MCP package (inferred financial action)

## What this is

A single-server config from a public MCP catalog: `npx -y stripe-mcp-server` with a
`STRIPE_API_KEY` env. The first **real/redacted** case to exercise
`action.financial` (INFERRED) — previously only the synthetic C008 covered it.

## Verdict: REVIEW

Findings (from a real scan of the built CLI):
- `action.financial` (INFERRED, MONEY, S5, low confidence) — package name
  `stripe-mcp-server` matches a financial-domain hint.
- `action.external-mutation` (INFERRED) — the payments name also trips the broader
  mutation inference.
- `secrets.env-key` — `STRIPE_API_KEY` is credential-shaped.
- `supply.unpinned-package` — `npx -y stripe-mcp-server` is unpinned.

Aggregate: REVIEW. None of these is a blocker.

## Why not BLOCK (the key calibration this case pins)

The hard money blocker is `action.financial-observed` (OBSERVED → BLOCK), which
requires a *provided tool* that exposes a money-moving verb (e.g. `create_payment`,
`transfer_funds`). A static `command`/`args`/`env` config carries **no** provided-tool
metadata — the agent only discovers tools by connecting to the server, which CallLint
never does. So the observed finding correctly does **not** fire, and the honest
verdict is REVIEW on the name inference, not BLOCK. `action.financial-observed` is
listed in `forbiddenFindingIds` to lock that distinction.

This is exactly why C009 (`action.financial-observed`) and C010 (`prompt.poisoning`)
remain synthetic-only: those findings read inline tool metadata that real config
snapshots almost never declare. C037 covers the realistically-harvestable half of the
money surface (the name inference) honestly.

## Provenance / redaction

- Source: `khopilot/amazing-mcp-for-productivity` @ `b0c3ac15`, `web_development/stripe_mcp.json`.
- Unlicensed repo → stored as `redacted-real-snapshot` (config shape is not
  copyrightable; not redistributed verbatim).
- No secret redaction needed: `STRIPE_API_KEY` was already the upstream placeholder
  `your_stripe_api_key`.
