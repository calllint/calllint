# ADR 0005: Golden Fixtures

Status: Accepted

## Decision

A fixed set of golden fixtures defines the project's verdict contract:

| Fixture                      | Expected verdict |
| ---------------------------- | ---------------- |
| safe-time.json               | SAFE             |
| safe-filesystem-workspace.json | SAFE           |
| review-github.json           | REVIEW           |
| review-unpinned-package.json | REVIEW           |
| review-financial.json        | REVIEW (S5, MONEY, name-inferred) |
| block-filesystem.json        | BLOCK            |
| block-prompt-poison.json     | BLOCK            |
| block-dangerous-command.json | BLOCK            |
| block-observed-payment.json  | BLOCK (S5, MONEY, observed money-mover) |
| unknown-remote.json          | UNKNOWN          |
| malformed.json               | parse error      |

## Rules

- These fixtures and their expected verdicts may only change via a new ADR.
- Tests assert each fixture produces its expected verdict.
- Changing an expected verdict to make a test pass is forbidden; fix the rule instead.

## Reason

Golden fixtures are the safety floor. They make regressions in the risk engine
immediately visible and prevent silent drift in what counts as BLOCK.
