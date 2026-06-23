# C035-safe-game-assistant-local-node

## Purpose
Pins the current SAFE baseline for a bare local `node <script>.js` MCP server,
and documents RC-OBS-02 (the local-command under-call) on the case itself.
Promotes RC-B06 into a permanent case.

## Human expected verdict
SAFE (under current evidence and current detectors)

## Why SAFE today
A single server runs `node C:/.../server.js` with no env, no extra args, no broad
path, no remote, and no supply-chain surface. The source is *observable* (the
command and script path are right there), the resolver sets
`sourceKnown: true`, and no blocking finding fires — so the engine returns SAFE.
This uses the strict contract (`allowExtraFindings: false` + full
`forbiddenFindingIds`) so the case fails if *any* finding starts to fire.

## RC-OBS-02 (documented, not a dangerous false-SAFE)
A bare local node script does run arbitrary local code. Whether that alone should
be REVIEW ("runs arbitrary local code; source not independently verifiable") is an
open detector-calibration question tracked for its own ADR. It is NOT a dangerous
false-SAFE by the resolver's definition: the source is visible, not hidden —
contrast C031, where an *unrecognized* shape hid the source and correctly resolves
to UNKNOWN. `thisCaseMustNeverBeSafe` is left **false**: this case records the
current contract, it does not assert SAFE is the permanent right answer.

## Why this case is valuable
If a future detector pass (the RC-OBS-02 ADR) decides bare local executables
should be REVIEW, this case forces that change to be made deliberately — the gate
will flag the verdict flip, the calibration doc updates, and the decision is
recorded rather than slipping in silently.

## Decision record
The calibration question this case anchors (should an unrecognized-but-observable
local executable be REVIEW instead of SAFE?) is recorded in
[ADR 0011](../../../../../docs/adr/0011-unrecognized-local-command-calibration.md)
(Proposed — deferred). If that ADR is accepted with direction (2), this case flips
SAFE → REVIEW and is updated deliberately.

## Provenance / redaction
Source: JacquesGariepy/game-assistant-mcp `claude_desktop_config.json` @ 27df1b5.
No detectable license, so stored as a shape-preserving `redacted-real-snapshot`;
the identifying Windows username was neutralized to `example`.
