# C031-unknown-unrecognized-shape

## Purpose
Locks the RC-BLK-01 regression: a server shape CallLint cannot resolve into a
recognized runtime must resolve to UNKNOWN, never SAFE.

## Human expected verdict
UNKNOWN

## Why this is UNKNOWN
The endpoint is nested as `mcpServers.<name>.server.url` instead of the recognized
`mcpServers.<name>.url`. The parser therefore finds no `url` and no `command` at
the recognized depth, the resolver sets `binding.sourceKnown = false`, and (per
ADR 0010) `computeVerdict` returns UNKNOWN.

## Why not SAFE
Before ADR 0010 this exact shape returned SAFE / "S0 Metadata only" / high
confidence / `autonomousUse: allow` — a dangerous false-SAFE. A config the tool
understood the *least* must not receive the *safest* verdict. The corpus pins
`thisCaseMustNeverBeSafe: true` so any re-introduction fails the release gate.

## Provenance
Minimised from a real committed `.cursor/mcp.json` in a public GitHub repo,
observed during the 0.3.0-rc.0 feedback window (RC-B04). The host was masked to an example domain; the original
carried no secrets.

## Note on REVIEW/BLOCK contract requirements
falsePositiveNote / remediation presence checks apply only to REVIEW and BLOCK
cases. UNKNOWN findings (if any) still carry evidence.
