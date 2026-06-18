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
