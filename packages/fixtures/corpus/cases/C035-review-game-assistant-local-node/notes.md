# C035-review-game-assistant-local-node

## Purpose
Pins that a bare local `node <script>.js` MCP server is **REVIEW** via
`exec.unverified-local-source`, and records RC-OBS-02 resolved by ADR 0011
Direction 2. Promotes RC-B06 into a permanent case.

## Human expected verdict
REVIEW (the local source is observable but not independently verifiable)

## Why REVIEW
A single server runs `node C:/.../server.js` with no env, no extra args, no broad
path, no remote, and no supply-chain surface. The source is *observable* (the
command and script path are right there) and the resolver sets
`sourceKnown: true`, so this is not UNKNOWN. But the script itself is never
inspected and is neither a recognized package nor a pinned image, so
`exec.unverified-local-source` fires (medium, EXEC, S2, non-blocker) → REVIEW.
The case uses the strict contract (`allowExtraFindings: false`) so it fails if
*any other* finding starts to fire, and requires the new finding explicitly.

## RC-OBS-02 — resolved (ADR 0011 Direction 2)
A bare local node script does run code CallLint cannot verify. ADR 0011 was
Accepted with Direction 2: an unrecognized-but-observable local executable is
REVIEW, not SAFE — SAFE stays reachable only for recognized, inspectable sources.
This is **not** a dangerous false-SAFE either way: the source was never hidden
(contrast C031, where an *unrecognized* shape hid the source and resolves to
UNKNOWN). `thisCaseMustNeverBeSafe` stays **false**: REVIEW is a confirmation
prompt, not an assertion that the source is malicious.

## Why this case is valuable
It anchors the verdict for the most common local-dev MCP shape (`node ./x.js`),
proving the new detector fires on exactly this surface and that the verdict is a
deliberate, fixture-backed REVIEW rather than a silent SAFE.

## Decision record
The calibration question this case anchored (should an unrecognized-but-observable
local executable be REVIEW instead of SAFE?) is recorded in
[ADR 0011](../../../../../docs/adr/0011-unrecognized-local-command-calibration.md),
**Accepted — Direction 2** (2026-06-25). This case flipped SAFE → REVIEW as part
of that acceptance, with positive (`review-unverified-local-source.json`) and
negative (`safe-time.json`, a recognized pinned package) golden fixtures.

## Provenance / redaction
Source: JacquesGariepy/game-assistant-mcp `claude_desktop_config.json` @ 27df1b5.
No detectable license, so stored as a shape-preserving `redacted-real-snapshot`;
the identifying Windows username was neutralized to `example`.
