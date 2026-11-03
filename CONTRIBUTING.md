# Contributing to CallLint

Thank you for your interest in CallLint.

CallLint is open source for transparency, auditability, and trust — so users can
audit it, agents can reference it, and developers can adopt it. The project is
**maintainer-led**: the roadmap and the official implementation are decided by
the maintainers, not by community vote. See [GOVERNANCE.md](GOVERNANCE.md) for the why.

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

## Local validation environment

Use Node 20.20.2 and pnpm 9.x as specified in `CLAUDE.md`. On Windows,
install Git for Windows with Git Bash and [jq from its official releases](https://github.com/jqlang/jq/releases).
Verify the download against the release's SHA-256 checksum. Put `jq.exe` on
PATH or in `%USERPROFILE%\.local\bin`.

Vitest locates Git Bash through the active Git installation and prepends its
shell utilities and the user-local tools directory to the test process PATH.
Child Node commands keep the version that started Vitest. This setup does not
change the system PATH, PowerShell profile, or WSL configuration. The credential
preflight tests execute the real workflow with real jq; missing tools fail with
an installation diagnostic rather than being skipped.

`pnpm check:security-semantics` defaults to `origin/main`, falling back to local
`main` only when the remote-tracking ref is absent. An existing ref without common
history fails rather than switching baselines. Refresh the remote
refs with `git fetch origin` before reviewing new work; the check itself performs
no network access. The output names the selected ref and merge-base. To measure
an intentional alternative, use
`pnpm check:security-semantics --base <ref>`; an explicit base remains authoritative
and a missing baseline fails closed. Do not reset a local branch or rewrite the
historical security artifact to silence a stale-baseline error.

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

See the corpus README (`packages/fixtures/corpus/README.md`) for the full honesty and
provenance rules that govern how submitted configs enter the corpus.
