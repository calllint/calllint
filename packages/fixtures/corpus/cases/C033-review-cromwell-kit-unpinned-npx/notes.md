# C033-review-cromwell-kit-unpinned-npx

## Purpose
Real-world REVIEW from multiple unpinned `npx -y` MCP servers, plus a real
authoring typo (a nested `svelte` key) that the parser must tolerate without
crashing or mis-resolving. Promotes RC-B08 into a permanent case.

## Human expected verdict
REVIEW

## Why REVIEW
Three servers launch via unpinned `npx -y <pkg>` (server-filesystem, server-git,
@context7/mcp-server). Each is a `supply.unpinned-package` supply-chain surface a
reviewer should pin to a version/digest. None is independently dangerous, so the
aggregate verdict is REVIEW.

## Findings (ground-truth scan)
`supply.unpinned-package` ×3 (S1). Verdict REVIEW.

## Parser-edge note (not a dangerous false-SAFE)
The upstream config has a malformed `svelte` object nested *inside* the
`context7` server (a sibling of `args`) rather than as its own top-level server.
CallLint reads the three well-formed servers and does not surface the misplaced
fourth. This is parser tolerance of a real typo: nothing dangerous is hidden by
the omission (a correctly-placed `@sveltejs/mcp` would itself only be another
unpinned-npx REVIEW), so it is recorded, not treated as a false-SAFE. Shape is
preserved verbatim so the case keeps exercising this tolerance.

## Provenance / redaction
Source: grantcromwell/cromwell-kit `.mcp.json` @ 32da36e. No detectable license,
so stored as a shape-preserving `redacted-real-snapshot` (not redistributed
verbatim): the macOS volume path was neutralized; package pin-state (all unpinned)
and the nested-key typo are preserved because they drive the verdict.
