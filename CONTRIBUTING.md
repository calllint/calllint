# Contributing to CallLint

Thank you for your interest in CallLint.

CallLint is in early development. Contributions are welcome, but please keep changes
focused, evidence-backed, and aligned with the project's stated principles.

## Before you open a PR

1. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
2. Run `pnpm hooks:install` once per clone (strips AI tool lines from commit messages).
3. Do not weaken golden fixtures to make tests pass.
4. Every new detection rule needs a positive fixture, a negative fixture, and a unit test.
5. Do not add `Co-Authored-By: Claude/Cursor` or `Made-with: Cursor` to commits.

## Security reports

Do not open public issues for security-sensitive reports. Email security@calllint.com instead.
