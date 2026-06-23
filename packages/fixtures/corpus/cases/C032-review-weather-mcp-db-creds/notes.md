# C032-review-weather-mcp-db-creds

## Purpose
Real-world REVIEW from a credential-shaped env key on a local node MCP server.
Promotes RC-B07 (0.3.0-rc.0 feedback window) into a permanent regression case.

## Human expected verdict
REVIEW

## Why REVIEW (not SAFE, not BLOCK)
`WEATHER_API_KEY` is a credential-shaped env name, so `secrets.env-key` fires and
the verdict is REVIEW: a reviewer must confirm the key is sourced from a secret
store, not committed. It is not BLOCK because there is no observed dangerous
command, broad path, or observed money movement — just a secret surface to verify.

## Findings (ground-truth scan)
`secrets.env-key` (S2). Verdict REVIEW.

## FP/FN notes
- The detector keys on the name shape (`*_API_KEY`), not the value, so the
  upstream placeholder still (correctly) triggers REVIEW — the surface is real
  regardless of whether this committed value is live.
- `DATABASE_URL` embeds `mcp_user:mcp_pass` inline but is a localhost dev string
  and is not a credential-named env key, so it is not separately flagged. Recorded
  as a known limitation, not hidden.

## Provenance / redaction
Source: glaucia86/weather-mcp-server `claude_desktop_config.json.text` @ c688791
(MIT). Values are upstream placeholders; the install path was normalized to
`C:/Users/example`. real-public-snapshot.
