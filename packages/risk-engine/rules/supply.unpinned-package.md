# supply.unpinned-package

Status: Accepted

Risk: Supply-chain drift through an unpinned package (TOCTOU / rug pull).

Verdict impact: High severity, non-blocker → contributes to REVIEW when the package
version is `latest`, a range, or absent.

Symbol: SUPPLY · Risk class: S1 · Mode: OBSERVED

Observed evidence: resolved runtime binding (`package`).

Why it matters: The installed code can change between scans and runs, so the verdict
may not match what actually executes. Lowers reproducibility.

False positives: Intentional during local development; should be pinned before
autonomous or CI use.

Fix: Pin the package to an exact version, e.g. `pkg@1.0.0`.

Golden fixtures:
- review-unpinned-package.json must trigger
- safe-time.json must not trigger
