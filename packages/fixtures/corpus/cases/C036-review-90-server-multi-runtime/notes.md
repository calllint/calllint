# C036-review-90-server-multi-runtime

## Purpose
The corpus's multi-server stress shape: a single real config declaring **92** MCP
servers across npx / uvx / python / remote runtimes. Promotes RC-B10 into a
permanent case, and exercises aggregate-verdict behaviour over a large server set.

## Human expected verdict
UNKNOWN

## Why UNKNOWN (not REVIEW)
The per-server breakdown is **90 REVIEW · 1 UNKNOWN · 1 SAFE**:
- 89 servers carry `supply.unpinned-package` (unpinned `npx`/`uvx` specifiers).
- `apple-calendar` adds `action.external-mutation` (a calendar write surface).
- the redacted `odoo ERP` server adds `secrets.env-key` (credential-shaped env).
- `gitmcp` is an unverifiable remote (`https://gitmcp.io/<owner>/<repo>`) →
  `supply.unknown-remote`, verdict UNKNOWN for that server.

Per ADR 0006/0010, UNKNOWN never downgrades, so the **config-level** verdict is the
most cautious of the set: UNKNOWN. A reviewer cannot get a clean bill while one
declared server's source can't be verified — even though 90 of 92 are "merely"
REVIEW. This is the honest aggregation: the headline reflects the weakest link.

## Findings (ground-truth scan, current engine)
`supply.unpinned-package` ×89, `action.external-mutation` ×1 (apple-calendar),
`supply.unknown-remote` ×1 (gitmcp), `secrets.env-key` ×1 (odoo ERP).
maxRiskClass S3. Aggregate verdict UNKNOWN.

## Why locked (thisCaseMustNeverBeSafe = true)
A 92-server config containing an unverifiable remote, an external-mutation tool,
and a credential env must never silently aggregate to SAFE. The gate fails if it
ever does.

## Secret handling (the reason this case was deferred to batch 2)
The upstream `odoo ERP` server had a **real committed credential set**: a live
employer Odoo URL, database name, a real person's email, and a 40-char password.
Per the redaction rules those four values were replaced with neutral placeholders
(`erp.example.com` / `example_db` / `user@example.com` /
`REDACTED_EXAMPLE_PASSWORD`) **before** the input was written into this repo. The
live values were never stored in the corpus, this notes file, or any log; the only
copy was a scratch file outside the repo, scrubbed immediately after redaction. A
post-write leak check (grep for the original host/email/password fragments) ran
clean. The verdict-driving shape — a `secrets.env-key` finding on a credential-named
env — is preserved by the placeholder.

## Ratio note
Adding this UNKNOWN case raised the corpus UNKNOWN ratio from 11.4% to **13.9%**
(5 / 36), still under the ≤ 15% floor. It is the single largest UNKNOWN
contributor; further UNKNOWN-heavy cases should be balanced against this headroom.

## Provenance / redaction
Source: uengine-oss/process-gpt-completion `mcp.json` @ 2c80ede. No clear
redistribution license, so stored as a shape-preserving `redacted-real-snapshot`.
