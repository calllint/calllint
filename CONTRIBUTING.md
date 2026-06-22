# Contributing to CallLint

Thank you for your interest in CallLint.

CallLint is open source for transparency, auditability, and trust — so users can
audit it, agents can reference it, and developers can adopt it. The project is
**maintainer-led**: the roadmap and the official implementation are decided by
the maintainers, not by community vote. See [GOVERNANCE.md](GOVERNANCE.md) and
[docs/CONTRIBUTION_BOUNDARY.md](docs/CONTRIBUTION_BOUNDARY.md) for the why.

## What we welcome

- Reproducible bug reports.
- Security reports through [SECURITY.md](SECURITY.md).
- Documentation corrections.
- Calibration feedback (false positives / negatives) and corpus candidates.
- Small test fixtures, when a maintainer asks for one.
- Clearly scoped issues and discussions.

## What we do not actively solicit

We do not actively solicit broad feature PRs, detector rewrites, roadmap changes,
platform work, or speculative integrations. Maintainers decide whether to accept,
close, defer, or reimplement any contribution. Opening a PR is not a commitment
that it will be merged — for non-trivial code, prefer an issue first.

Non-trivial external code contributions may require maintainer approval, a DCO
`Signed-off-by`, or a separate contributor agreement before merge. There is no
CLA or DCO bot today; a maintainer will ask if one becomes necessary.

## Do not submit

- Secrets, tokens, or credentials.
- Private MCP configs, internal hostnames, or customer data.
- Proprietary code you do not have the right to submit.
- Code copied from unknown or license-incompatible sources.
- Generated code without review and clear ownership.

## Before you open a PR

1. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm corpus:test`, and
   `pnpm corpus:test:r2-final` (or explain why a gate was not run).
2. Do not weaken golden fixtures or corpus expectations to make tests pass.
3. Every new detection rule needs a positive fixture, a negative fixture, and a unit test.
4. Do not weaken security semantics: no LLM in the verdict path, no runtime
   execution of scanned servers, no default-on telemetry. UNKNOWN is not SAFE;
   SAFE is not proof of runtime safety.

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
