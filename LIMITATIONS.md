# Limitations & trust boundaries

MCPGuard is a heuristic, evidence-backed **pre-flight check** — not a proof of
safety. Read this before relying on it for a security decision.

## What a verdict does and does not mean

- **`SAFE` means "no blockers observed"**, not "guaranteed safe". It is the
  absence of evidence of a blocking risk in the surface MCPGuard can see — never
  a guarantee that a server is benign. The public label is deliberately worded
  "No blockers observed".
- **`UNKNOWN` is a real verdict.** When MCPGuard cannot verify what a server will
  do (e.g. an opaque remote URL), it says so. It never upgrades `UNKNOWN` to
  `SAFE`.
- **`REVIEW` / `BLOCK`** flag a surface that needs a human decision or is
  disallowed by policy. They are starting points for review, not a complete
  threat assessment.

## What MCPGuard does not do

- **It does not execute, install, or run servers.** No host execution of unknown
  code, no install scripts, no live tool calls — by design. Risks that only
  manifest at runtime are out of scope.
- **It does not read or validate secrets.** It flags credential-shaped env keys
  by name only; it never reads values and cannot tell whether a token is
  over-scoped.
- **It does not fetch anything unless you pass `--online`**, and even then it
  only reads public registry/repo metadata — it never executes fetched code.
  Online findings are advisory and can only add risk, never lower a verdict
  ([ADR 0006](docs/adr/0006-online-enrichment-advisory.md)).
- **It does not analyze server source code.** It reasons about the config, the
  resolved runtime binding, and the model-visible tool metadata you provide —
  not the implementation behind the tool.

## Heuristic detectors have false positives and false negatives

- Detection is pattern- and name-based in places. Every finding carries a
  `falsePositiveNote` explaining how it can misfire.
  - A package named like a payments integration is flagged `MONEY` (REVIEW) even
    if it is read-only.
  - A tool exposing a money-moving verb is flagged `MONEY` (BLOCK) only when a
    corroborating capability (credentials / network) is present — a bare mock
    will not block, and a cleverly renamed money-mover may not be detected.
  - Prompt-poisoning detection matches known phrasing; novel phrasings can slip
    past, and innocent documentation can trip it.
- **A clean MCPGuard run is necessary, not sufficient.** Pair it with code
  review, least-privilege tokens, and runtime controls.

## Coverage boundaries

- MCPGuard sees the tool metadata **you provide** (e.g. `x-mcpguard.tools`). It
  does not introspect a live server's advertised tools. Metadata that never
  reaches your config is invisible to it.
- Results reflect the **config at scan time**. Drift detection (`baseline` /
  `verify`) exists precisely because what a package resolves to can change after
  approval (rug-pull / TOCTOU) — use it in CI.

## Reporting

If you find a false negative (a real risk MCPGuard missed) or a false positive,
it is a detector-quality issue worth filing — the golden fixtures are the
regression floor, and new cases are how coverage grows.
