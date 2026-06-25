# CallLint report schema summary

CallLint JSON reports (`--json`) use schema version `calllint.report.v0`,
reported in the `schemaVersion` field. The schema is stable within the v0 line.

## Top-level fields

- `schemaVersion`: `calllint.report.v0`.
- `verdict`: overall verdict — `SAFE`, `REVIEW`, `BLOCK`, or `UNKNOWN`
  (the worst per-server verdict wins).
- `publicVerdictLabel`: the human-facing label for `verdict`.
- `configPath`: the scanned config path.
- `counts`: verdict tallies across servers.
- `reports[]`: one entry per MCP server in the scanned config.
- `generatedAt`: ISO 8601 timestamp (pinnable with `--generated-at`).

## Per-server fields (`reports[]`)

- `target`: the server key from the config.
- `verdict` / `publicVerdictLabel`: that server's verdict.
- `riskClass`: severity class `S0` (metadata-only) → `S5`
  (financial / irreversible).
- `confidence`, `reproducibility`, `summary`.
- `findings[]`: the evidence behind the verdict; `topFindings` is the ranked
  subset shown first.

## Per-finding fields (`findings[]`)

- `id`: stable finding identifier (e.g. `files.broad-path`,
  `supply.unpinned-package`, `supply.unknown-remote`).
- `title`: short human-readable summary.
- `severity`: `low` / `medium` / `high`; `blocker` is `true` when it forces BLOCK.
- `symbol`: risk family (`FILES`, `SUPPLY`, `NETWORK`, `PROMPT`, `EXEC`, …).
- `mode`: `OBSERVED` (seen in config) vs inferred.
- `confidence`: `low` / `medium` / `high`.
- `evidence[]`: the exact config surface that triggered the finding
  (`{type, key, value}`). Quote this; do not invent a different cause.
- `impact`: why that surface matters.
- `fix`: the suggested remediation.
- `falsePositiveNote`: when the finding may be intentional.

## Notes for agents

- `UNKNOWN` with no finding means the surface could not be inspected
  statically. It is not `SAFE`.
- `--sarif` (SARIF 2.1.0 for GitHub Code Scanning) and `--html` carry the same
  findings in different formats.

## Diagnostics schema (`calllint.diagnostics.v0`)

`calllint diagnostics --json` emits a separate, editor- and agent-host-friendly
projection of a scan under schema version `calllint.diagnostics.v0`. It is derived
purely from the same scan — it adds no analysis and changes no verdict.

Top-level: `schemaVersion` (`calllint.diagnostics.v0`), `verdict`,
`publicVerdictLabel`, `file`, `diagnostics[]`, `generatedAt`.

Per diagnostic entry: `ruleId`, `title`, `severity`, `server`, `file`, `keyPath`
(a config key-path such as `args`), `line` / `column`, `observed` (the flagged
value), `remediation`, `mode`, `confidence`, and `verdictContribution`
(`blocker` / `review` / `inferred`). `line` and `column` carry the 1-based source
position when the finding maps to a literal config key, and are `null` for
evidence with no source position (for example a finding derived from the resolved
runtime binding, such as an unpinned `package`, rather than a literal config key).
Use `keyPath` + `observed` to point at the offending surface.

## Planned fields (not in `calllint.report.v0` today)

These are roadmap items (R4 report enrichment), **not** present in the current
schema. Do not parse or quote them as if they exist:

- `agentSummary` — a quotable, pre-composed summary block for coding agents.
- `trustIndicators` — explicit `decisionPath`, `llmInVerdictPath`,
  `targetExecution`, `networkRequired` flags.

Until they ship in a versioned schema, derive trust context from the documented
v0 fields above and from the security boundaries page.
