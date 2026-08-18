# Cline Native Presence Submission

## Status

**State:** SUBMITTABLE → DRAFT_PR_OPENED

## Official Sources

- Marketplace: https://github.com/cline/marketplace
- CONTRIBUTING: https://github.com/cline/marketplace/blob/main/CONTRIBUTING.md
- Schema: https://github.com/cline/marketplace/blob/main/schemas/mcp.schema.json
- Current HEAD: commit e59b03e (Jun 20, 2026)

## Submission

- **PR:** https://github.com/cline/marketplace/pull/49 (draft)
- **Branch:** add-calllint-mcp
- **Entry:** registry/mcps/calllint/entry.json
- **Icon:** registry/mcps/calllint/icon.png
- **Validation:** PASSED (203 entries including CallLint)

## Install Command

```bash
cline mcp install calllint -- npx -y calllint-mcp
```

## Metadata

- **ID:** calllint
- **Type:** mcp
- **Tags:** security, software
- **Verified:** false (as per contribution rules)
- **License:** Apache-2.0

## Fit Gate

- ✅ calllint-mcp published and usable
- ✅ MCP stdio command works: `npx -y calllint-mcp`
- ✅ MCP smoke test passed (initialize + tools/list + resources)
- ✅ No API key required
- ✅ No Cline capabilities claimed that don't exist

## Validation

Local validation passed:
```
> npm run validate
Validation passed: 203 entries.
```

CI validation will run on upstream when PR is ready for review.

## Next Steps

PR is currently **draft**. Will be marked ready for review after:
1. Upstream CI validates on Linux
2. Any feedback from initial draft review is addressed

## Deviations

None. Followed official contribution guidelines exactly.

## Blocked

No blocks. Submission complete per H9.6.4.
