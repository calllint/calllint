# Limitations

CallLint is a heuristic, evidence-backed **pre-flight check** — not a proof of
safety. Read this before relying on it for a security decision.

See also [LIMITATIONS.md](../LIMITATIONS.md) for the full v0.1 trust-boundary
document (legacy MCPGuard naming; content applies to CallLint).

## What a verdict does and does not mean

- **`SAFE` means "no blockers observed"**, not "guaranteed safe".
- **`UNKNOWN` is a real verdict.** CallLint never upgrades `UNKNOWN` to `SAFE`.
- **`REVIEW` / `BLOCK`** are starting points for review, not a complete threat assessment.

## What CallLint does not do

- It does not execute, install, or run servers.
- It does not read or validate secret values.
- It does not fetch anything unless you pass `--online` (advisory only).
- It does not analyze server source code.

## Heuristic detectors have false positives and false negatives

A clean CallLint run is necessary, not sufficient. Pair it with code review,
least-privilege tokens, and runtime controls.
