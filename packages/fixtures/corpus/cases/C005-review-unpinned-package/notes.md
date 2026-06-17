# C005-review-unpinned-package

## Purpose
Verifies that an unpinned package version (`@latest`) raises a review.

## Human expected verdict
REVIEW

## Why this is REVIEW
`some-mcp-server@latest` has no pinned version. The supply-chain detector emits
`supply.unpinned-package` (S1, high, non-blocker). A high-severity, non-blocking
finding maps to REVIEW.

## Required evidence
`supply.unpinned-package` referencing the unpinned spec.

## Offline guarantee
The scan reads the version spec statically. It does not run `npx` and does not query
the npm registry.

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
