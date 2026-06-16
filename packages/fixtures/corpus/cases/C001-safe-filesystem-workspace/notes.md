# C001-safe-filesystem-workspace

## Purpose
Verifies CallLint does not over-alarm on a correctly-scoped local configuration.

## Human expected verdict
SAFE

## Why this is SAFE
The path is `${workspaceFolder}` (workspace-scoped, not a broad home/root path), the
package is version-pinned, there are no credentials, and the source is a known npm
package. No detector fires.

## Required evidence
None — this case asserts the *absence* of findings (`allowExtraFindings: false`).

## Why this matters
A scanner that flags everything is useless. C001 is the anchor that keeps the corpus
honest: if a future detector change starts flagging this benign config, the contract
fails and forces a deliberate decision.

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
