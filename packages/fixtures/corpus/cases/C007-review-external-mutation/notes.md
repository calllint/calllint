# C007-review-external-mutation

## Purpose
Verifies that an inferred external-side-effect capability raises a review.

## Human expected verdict
REVIEW

## Why this is REVIEW
The package name `linear-tasks-mcp` matches the external-mutation hint set, so the
detector emits `action.external-mutation` (S3, medium, INFERRED, non-blocker). A
non-blocking finding maps to REVIEW.

## How the engine actually detects this
The detector inspects **package and tool names**, not CLI `--flags`. The blueprint's
original `--can-create-issues`-style flags would not fire this detector; encoding the
signal in the package name reflects the real, shipped detection path.

## Inferred, not observed
This is a name-based heuristic. A read-only integration with the same name would not
mutate anything — recorded in the finding's falsePositiveNote. It is deliberately
weaker (REVIEW) than an observed money-mover (C009 BLOCK).

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
