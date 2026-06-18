# Contributing to CallLint

Thank you for your interest in CallLint.

CallLint is in early development. Contributions are welcome, but please keep changes
focused, evidence-backed, and aligned with the project's stated principles.

## Before you open a PR

1. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
2. Do not weaken golden fixtures to make tests pass.
3. Every new detection rule needs a positive fixture, a negative fixture, and a unit test.

## Security reports

Do not open public issues for security-sensitive reports. Email security@calllint.com instead.

## Reporting calibration feedback (false positives / negatives)

CallLint improves through real configs. We provide issue templates for false
positives, false negatives, parser edge cases, corpus candidates, and CI
integration. High-quality reports often become corpus cases.

**Redaction is mandatory.** Before pasting any config:

- Remove secret *values* (tokens, keys, passwords) — replace with a neutral
  placeholder such as `REDACTED` or `${ENV_VAR}`.
- Remove private filesystem paths, internal hostnames/URLs, and personal or
  customer names.
- **Keep the verdict-relevant shape**: key names, command form, and transport
  kind drive the verdict, so preserve them. If redaction would change the
  verdict, the config is not safe to submit — pick another.

See [docs/CORPUS_CURATION.md](docs/CORPUS_CURATION.md) for the full honesty and
provenance rules that govern how submitted configs enter the corpus.
