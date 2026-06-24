# C039 — Google Ads MCP package (mixed credential env shape)

## What this is

A single-server config from a public MCP catalog: `npx -y google-ads-mcp-server`
with five `GOOGLE_ADS_*` env keys. Its calibration value is the **mixed** env shape —
some keys are credential-shaped, some are not.

## Verdict: REVIEW

Findings (from a real scan of the built CLI):
- `secrets.env-key` — one finding carrying **3 evidence entries**, for the
  credential-shaped names `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`,
  `GOOGLE_ADS_REFRESH_TOKEN`. (The detector emits one finding per server with
  per-key evidence, not one finding per key — so the contract requires the finding,
  and the multiplicity lives in its evidence.)
- `supply.unpinned-package` — `npx -y google-ads-mcp-server` is unpinned.

It does **not** fire on `GOOGLE_ADS_CLIENT_ID` or `GOOGLE_ADS_CUSTOMER_ID` (identifiers,
not secrets) — the intended true-negative this case pins.

Aggregate: REVIEW.

## Calibration notes

- The secrets detector is name-shape only (SECRET / TOKEN / KEY / PASSWORD / CRED / AUTH).
  An OAuth client *id* is an identifier and is correctly unflagged; the real risk of an
  OAuth pair depends on the id+secret combination, which name-shape detection does not
  model — noted honestly, not "fixed" here.
- No financial or external-mutation inference: `google-ads-mcp-server` is not in either
  hint list, so the env + supply-chain surfaces alone drive the verdict.

## Provenance / redaction

- Source: `khopilot/amazing-mcp-for-productivity` @ `b0c3ac15`, `productivity/google_ads_mcp.json`.
- Unlicensed repo → `redacted-real-snapshot` (config shape not copyrightable).
- No secret redaction needed: all five values were already upstream placeholders.
