# ADR 0008: Brand Transition — MCPGuard → CallLint

Status: Accepted

## Context

The product was built under the internal name **MCPGuard**. As it approaches a
public, installable release (see [ADR 0007](0007-cli-distribution-strategy.md)),
it needs a deliberate public brand rather than an internal codename leaking into
the npm name, CLI binary, and user-facing reports.

Naming was checked before deciding:

- **npm (official `registry.npmjs.org`)**: `calllint`, `@calllint/cli`, and
  `@calllint/core` all return 404 — available.
- **Public search**: the `*lint` agent-security space is already populated —
  `AgentLint` (GitHub + a Marketplace Action + PyPI `agentlint`), `cclint`,
  `agent-lint`. `calllint` itself surfaced no direct collision, but the
  adjacency is real and shapes positioning (below).
- **Trademark (USPTO/EUIPO/WIPO)**: not machine-verifiable here; flagged to the
  owner as a manual pre-launch check. This ADR records the engineering
  transition, not legal clearance.

## Decision

1. **Public product name is `CallLint`.** Stylized CallLint; lowercase
   `calllint` for the binary, npm name, and scope.

2. **`MCPGuard` is the historical internal codename.** It remains in historical
   documents (`000.md`, prior ADRs' decision text, commit history) for an honest
   audit trail. It is not used in any user-facing surface going forward.

3. **Positioning is deliberately narrow: *lint agent tool-call risk before tools
   run*.** We do not market CallLint as a generic "agent linter" or "agent
   config linter" — that would invite confusion with AgentLint/cclint and
   overclaim. CallLint gives evidence-backed verdicts for what an agent's tools
   can read, write, execute, and send, before they run.

4. **CallLint is the CLI / developer-tool brand.** A future hosted/platform
   layer may carry a separate brand (e.g. **AgentTrust**); that is out of scope
   here and not implied by this rename.

5. **Concrete identifiers:**
   - CLI binary: `calllint`
   - public npm package: `calllint` (the bundled CLI; published surface per ADR 0007)
   - internal workspace scope: `@calllint/*` (renamed from `@mcpguard/*` in one
     atomic change — the monorepo stays an auditable 12-package graph; packages
     are **not** merged or restructured by this ADR)
   - cache/baseline directory: `.calllint/` (was `.mcpguard/`)
   - policy file: `calllint.policy.json` (was `mcpguard.policy.json`)
   - on-disk schema identifiers: `calllint.baseline.v0`, `calllint.drift.v0`,
     `calllint.policy.v0` (was `mcpguard.*`)
   - SARIF tool driver name: `CallLint`; `informationUri`
     `https://github.com/calllint/calllint`
   - GitHub repo: `calllint/calllint` (CallLint organization; canonical source)

6. **No migration shim.** No public release ever wrote `.mcpguard/` paths or
   `mcpguard.*` schema strings, so there are no existing artifacts to migrate.
   The rename is a clean cut; a backward-compat reader would add complexity for
   zero real users and is explicitly declined.

## Non-goals (this ADR)

- **No scanner-semantics change.** No detector, verdict rule, golden expectation,
  risk class, or exit code is altered by the rename. Tests that assert a brand
  or schema literal are updated to the new literal — that tracks the rename, it
  does not weaken a test.
- **No package restructure.** A proposed `packages/{cli,core,rules}` collapse is
  a separate re-architecture decision, not part of this brand transition.

## Consequences

- A single atomic rename commit touches package names, imports, alias maps, CLI
  strings, report identity, cache paths, schema literals, docs, and examples.
  The full gate (typecheck/test/build/smoke/pack:smoke) plus a grep audit
  (`@mcpguard`→none, `.mcpguard`→none, `mcpguard`→historical-only) guards it.
- Historical documents intentionally still say MCPGuard; `000.md` carries a
  one-line note pointing here so the codename↔brand mapping is explicit.
- The owner must still complete trademark/domain due diligence before any public
  launch; this ADR does not assert legal availability.
