# C003-block-dangerous-shell-rm

## Purpose
Verifies that an arbitrary destructive shell command is a hard blocker.

## Human expected verdict
BLOCK

## Why this is BLOCK
The command is `sh -c '...'`. The dangerous-command detector recognizes shell
invocations and emits `exec.dangerous-command` (S4, critical, blocker), forcing BLOCK.
The verdict never depends on executing the command.

## Required evidence
`exec.dangerous-command` referencing the shell command.

## Why not UNKNOWN
A recognized shell with an inline destructive command is not "insufficient evidence";
it is an observed, blockable capability.

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
