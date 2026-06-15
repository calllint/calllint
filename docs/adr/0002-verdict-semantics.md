# ADR 0002: Verdict Semantics

Status: Accepted

## Decision

There are exactly four verdicts: `SAFE`, `REVIEW`, `BLOCK`, `UNKNOWN`.

Each carries a public-report label that is more legally careful than the CLI symbol:

| Verdict | Public label          |
| ------- | --------------------- |
| SAFE    | No blockers observed  |
| REVIEW  | Review required       |
| BLOCK   | Blocked by policy     |
| UNKNOWN | Insufficient evidence |

## Rules

- `SAFE` means "no blockers observed under current evidence." It is never a guarantee.
- `UNKNOWN` must never auto-upgrade to `SAFE`.
- A config with multiple servers gets an aggregate verdict equal to its most severe
  server verdict, with severity order BLOCK > UNKNOWN > REVIEW > SAFE.

## Reason

Saying "safe" unconditionally is a legal and trust liability for a security product.
The two-layer naming keeps the CLI sharp while keeping public output defensible.
