# Security Policy

CallLint is a security tool, so its own posture and boundaries must be explicit
and auditable. This document states what CallLint does and does not do, how to
report a vulnerability, and the guarantees you may and may not rely on.

## What CallLint is

CallLint is a **deterministic, offline, static** pre-flight scanner for MCP
server configurations and agent-tool metadata. It reads a config, resolves what
each server would actually run, and returns an evidence-backed verdict — `SAFE`,
`REVIEW`, `BLOCK`, or `UNKNOWN`.

## Safety boundaries (by design)

These are invariants, not aspirations. They are enforced in code and covered by
tests and ADRs.

- **Never executes the server it judges.** Quick Scan does not run, install, or
  sandbox any MCP server, and runs no install scripts on the host. See
  [ADR 0003](docs/adr/0003-no-host-execution.md).
- **Never reads real secrets.** CallLint inspects configuration shape, not
  credential values; it does not pass secrets to any probe or test.
- **The analysis core is offline.** The detection pipeline is pure and
  deterministic with no network access. The only network path is the opt-in
  `--online` enrichment, isolated in one package behind an injectable fetch.
- **Online enrichment is advisory and never downgrades a verdict.** Online
  findings may add risk but can never lower one; this is code-enforced. See
  [ADR 0006](docs/adr/0006-online-enrichment-advisory.md). `--online` reads
  public registry/repo metadata only and never executes fetched code.
- **`UNKNOWN` never auto-upgrades to `SAFE`.** Absence of evidence is not
  evidence of safety.
- **No LLM in the verdict path.** Verdicts come from deterministic rules; an LLM
  may only summarize evidence, never decide a verdict.

## What CallLint does NOT guarantee

- A `SAFE` / "No blockers observed" verdict is **not a proof of safety**. It
  means no blocker was observed under the current evidence. Detectors are
  heuristic by nature. See [LIMITATIONS.md](LIMITATIONS.md).
- CallLint does not observe runtime behavior (what a server reads, writes,
  spawns, or sends when actually run). Runtime/deep-scan analysis is out of
  scope for this release.
- CallLint is not a gateway, proxy, marketplace, or policy-enforcement runtime.
  It informs a decision; it does not stand between an agent and a tool at
  runtime.

## Distribution & supply chain

- The published package is a single self-contained bundle with an **empty
  runtime dependency list** and a `files` allowlist (`dist/` only) — the
  smallest installable surface. See
  [ADR 0007](docs/adr/0007-cli-distribution-strategy.md).
- The published artifact is verified by `pnpm pack:smoke`: it asserts the
  tarball manifest, checks for no `workspace:*` leakage, and runs the binary
  from an isolated install.
- Releases use **npm Trusted Publishing through GitHub OIDC** — no long-lived
  `NPM_TOKEN` is stored. The release workflow is permission-scoped
  (`id-token: write` only), publishes solely from a tagged GitHub Release event,
  and attaches build provenance (SLSA attestation). See
  [ADR 0007](docs/adr/0007-cli-distribution-strategy.md) and
  [`.github/workflows/release.yml`](.github/workflows/release.yml).
- The continuous-integration workflow (push / PR) runs the full gate with a
  read-only token and never publishes.

## Reporting a vulnerability

If you believe you have found a security issue in CallLint itself — for example
a way to make it report `SAFE` for a config that should block, a path that
causes it to execute scanned code, or a packaging/supply-chain weakness —
please report it privately:

- Open a [GitHub Security Advisory](https://github.com/calllint/calllint/security/advisories/new)
  (preferred), or
- email security@calllint.com.

Please do **not** open a public issue for an unfixed vulnerability. Include a
minimal reproduction (a config and the observed vs. expected verdict is ideal),
the version/commit, and your environment. We aim to acknowledge reports within
a few days.

## Supported versions

CallLint is pre-1.0 and under active hardening. Security fixes target the latest
`main`. Pin a version for reproducibility, and re-scan after upgrades.
