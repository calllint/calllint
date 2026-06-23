# C034-block-openclaw-filesystem-broad-home

## Purpose
Real-world BLOCK from a filesystem server granted broad absolute home paths,
launched unpinned. Promotes RC-B09 into a permanent case and locks it as a case
that must never be SAFE.

## Human expected verdict
BLOCK

## Why BLOCK
`@modelcontextprotocol/server-filesystem` is given two absolute home-directory
roots (`/home/openclaw/docs/operations`, `/home/openclaw/docs/specs`). Broad
filesystem reach handed to an autonomous tool is the blocking condition
(`files.broad-path`); the package is also launched unpinned via `npx -y`
(`supply.unpinned-package`).

## Findings (ground-truth scan)
`files.broad-path`, `supply.unpinned-package` (S2). Verdict BLOCK.

## Why this is locked (thisCaseMustNeverBeSafe = true)
A broad-filesystem grant to an autonomous tool must never silently resolve to
SAFE. The release gate fails if this case ever returns SAFE.

## FP/FN notes
Scoping the roots to a workspace-relative subpath and pinning the package would
move the verdict toward REVIEW/SAFE — the detector is reacting to the breadth of
the grant, not to the package identity alone.

## Provenance / redaction
Source: WinshipWheatley/openclaw-eyes `.mcp.json` @ 7ca644d. No detectable
license, so stored as a shape-preserving `redacted-real-snapshot`. The paths use
the project's own public org name and were left as-is (RC log: no personal
identifiers present); only the license-bearing verbatim redistribution is avoided.
