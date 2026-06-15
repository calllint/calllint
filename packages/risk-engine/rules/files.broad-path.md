# files.broad-path

Status: Accepted

Risk: Broad local filesystem access.

Verdict impact: Critical blocker → BLOCK when a configured path points to a home,
root, or user-profile directory.

Symbol: FILES · Risk class: S2 · Mode: OBSERVED

Observed evidence: MCP config `args`.

Why it matters: An agent-triggered tool may read sensitive local files outside the
project.

False positives: A developer may intentionally grant broad local access for a
local-only experiment.

Fix: Restrict to `${workspaceFolder}`.

Golden fixtures:
- block-filesystem.json must trigger
- safe-filesystem-workspace.json must not trigger
