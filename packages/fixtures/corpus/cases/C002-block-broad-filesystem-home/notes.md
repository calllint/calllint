# C002-block-broad-filesystem-home

## Purpose
Verifies that broad home-directory filesystem access is treated as a hard blocker.

## Human expected verdict
BLOCK

## Note on the original blueprint
The R2 blueprint pencilled this case in as REVIEW. The shipped CallLint engine
classifies `files.broad-path` as a **critical blocker** (`blocker: true`), so the
honest, secure verdict is **BLOCK**. We calibrate the corpus to the engine's real,
secure behaviour rather than weakening the rule to match a draft expectation.

## Why this is BLOCK
`/Users/example` is a home root. The detector matches it against its broad-path set
and emits `files.broad-path` (S2, critical, blocker), which forces BLOCK.

## Required evidence
`files.broad-path` pointing at the broad `args` value.

## Known false-positive path
A developer may intentionally grant broad access in a private local sandbox; the
finding's falsePositiveNote records this.

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
