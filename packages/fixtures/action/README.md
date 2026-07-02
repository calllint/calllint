# Action Fixtures

Golden test fixtures for `calllint action inspect` (ADR 0029, R4 / v0.9.x).

## Status (2026-07-02)

**24 fixtures** across **9 action kinds**, covering the full action taxonomy.

### Coverage Matrix

| Kind | Positive | Negative | Total | Status |
|------|----------|----------|-------|--------|
| `email.reply` | 1 | 2 | 3 | ✓ Complete |
| `email.forward` | 1 | 1 | 2 | ✓ Complete |
| `message.post` | 1 | 1 | 2 | ✓ Complete |
| `a2a.delegate` | 1 | 2 | 3 | ✓ Complete |
| `payment.authorize` | 1 | 1 | 2 | ✓ Complete |
| `account.register` | 1 | 2 | 3 | ✓ Complete |
| `github.write` | 1 | 2 | 3 | ✓ Complete |
| `npm.publish` | 1 | 2 | 3 | ✓ Complete |
| `cloud.modify` | 1 | 2 | 3 | ✓ Complete |

**Total: 9 positive + 15 negative = 24 fixtures**

All 9 kinds have at least one positive (clean) and one negative (trigger findings) fixture.

## Fixture Contract

Every action `kind` in `calllint.action.v0` requires:

### 1. Positive fixture
An action descriptor of that kind with **no risk signals** → expected verdict SAFE with no findings.

**Example (email.reply):** Clean reply with no secret headers, verified attachments → verdict SAFE.

**Format:** `<kind>/positive-<scenario>.json`

### 2. Negative fixture
An action descriptor with **clear risk signals** → expected verdict REVIEW or BLOCK with specific findings.

**Example (email.reply):** Reply with secret-shaped headers (`Authorization`, `X-API-Token`) → verdict REVIEW, finding `action.secret-shaped-headers`.

**Format:** `<kind>/negative-<scenario>.json`

### 3. Unit tests
Tests in `packages/action-analyzer/test/analyzeAction.test.ts` load fixtures, call `analyzeAction(descriptor)`, and assert expected verdicts/findings.

## Directory Structure

```
packages/fixtures/action/
├── README.md                   ← this file
├── email.reply/
│   ├── positive-clean-reply.json
│   ├── negative-secret-headers.json
│   └── negative-missing-attachment-hashes.json
├── email.forward/
│   ├── positive-clean-forward.json
│   └── negative-missing-attachment-hashes.json
├── message.post/
│   ├── positive-clean-message.json
│   └── negative-secret-headers.json
├── a2a.delegate/
│   ├── positive-secure-delegate.json
│   ├── negative-insecure-http.json
│   └── negative-missing-target.json
├── payment.authorize/
│   ├── positive-small-verified-payment.json
│   └── negative-high-amount.json
├── account.register/
│   ├── positive-clean-registration.json
│   ├── negative-excessive-scopes.json
│   └── negative-unverified-service.json
├── github.write/
│   ├── positive-create-pr.json
│   ├── negative-external-links.json
│   └── negative-unverified-repo-excessive-scopes.json
├── npm.publish/
│   ├── positive-clean-publish.json
│   ├── negative-name-squatting.json
│   └── negative-version-float.json
└── cloud.modify/
    ├── positive-create-small-instance.json
    ├── negative-expensive-instance.json
    └── negative-open-all-ports.json
```

## Fixture Authoring Rules

1. **No fabricated real-provider payloads.** Positive fixtures may reference real domains/repos but risk signals must be clearly synthetic.

2. **Negative fixtures use clear risk patterns.** Secret headers, large amounts, insecure protocols, missing verification.

3. **Expected verdicts are immutable.** Once committed, a fixture's expected verdict cannot be weakened to pass tests (per CLAUDE.md). Changes require an ADR.

4. **Offline-invariance.** Action fixtures must not require network access.

## Testing

All fixtures are tested in `packages/action-analyzer/test/analyzeAction.test.ts`:

```bash
pnpm --filter @calllint/action-analyzer test
```

Tests verify:
- Positive fixtures → SAFE verdict, no findings
- Negative fixtures → REVIEW/BLOCK verdict, expected finding IDs present

## Implementation Status

- ✓ ADR 0029 Accepted (2026-07-01)
- ✓ Schema: `calllint.action.v0` (schemas/action.schema.json)
- ✓ Analyzer: `@calllint/action-analyzer` package (13 detectors)
- ✓ CLI: `calllint action inspect` command
- ✓ Fixtures: 24 fixtures across 9 kinds
- ✓ Tests: 20 passing tests in analyzeAction.test.ts
- ✓ Receipt: `--receipt` flag integrated (ADR 0028 schema reuse)

## References

- ADR 0029: Unified External Action Preflight (`calllint action inspect`)
- ADR 0028: Receipt-first Trust Layer (receipt schema reuse)
- ADR 0020: Compact Decision + reason codes
- CLAUDE.md: never weaken a fixture's expected verdict to pass a test
- new5 master plan: R4 / v0.9.x action preflight
