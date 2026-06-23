# ADR 0013: `calllint diagnostics --json` — an editor/agent-host output, key-path-scoped in v0

Status: Proposed (recorded 2026-06-24; no code change yet)

## Context

ROADMAP R3 calls for `calllint diagnostics --json`: a stable, editor- and
agent-host-friendly machine protocol that surfaces each finding as a structured
diagnostic an IDE or agent runtime can render inline — finding id, severity,
location, observed value, remediation, and how the finding contributed to the
verdict. It is the prerequisite for any future IDE plugin (ROADMAP lists the
plugin as blocked on this command).

Two facts about today's pipeline shape this decision:

1. **The verdict contract is already stable and must not move.** `ScanReport`
   (`packages/types/src/report.ts`, `schemaVersion: "calllint.report.v0"`) is the
   single source of truth for verdicts; ADR 0010 fixed the rule that any breaking
   change to it requires an ADR. `diagnostics` must therefore be a *view* of an
   existing `ScanReport`, not a new analysis or a verdict path — exactly as the
   SARIF renderer already is (`packages/report-renderer/src/renderSarif.ts`).

2. **The pipeline has a config *key-path*, but not real source line/column.**
   `Evidence` (`packages/types/src/finding.ts:34-43`) carries `path?` (the source
   config file), `key?` (the config property, e.g. `args`), and `value?` — but
   `line?`/`column?`, while present as optional fields, are essentially never
   populated: no stage maps a config key back to a byte/line offset in the source
   file. The SARIF renderer reflects this honestly —
   `renderSarif.ts:69` does `const region = ev?.line ? { startLine: ev.line } :
   undefined`, i.e. it emits a region *only if* the analyzer already set a line,
   which in practice it does not. So a diagnostics protocol can honestly emit
   **file + config key-path + observed value** today, but **not** true editor
   line/column without new work.

The roadmap's wishlist phrase "file/line/column" is therefore aspirational against
the current engine. This ADR picks the honest v0 scope rather than shipping a
field the pipeline cannot truthfully fill.

## Decision

Introduce a new command `calllint diagnostics [--json] <path>` whose JSON output is
a **new sibling schema** `calllint.diagnostics.v0`, derived *purely* from an
existing `ScanReport` by a new pure renderer `renderDiagnostics(summary)` — the
same shape of component as `renderSarif`. No new analysis, no network, no change to
`ScanReport`, verdict logic, exit codes, or the corpus.

**v0 is key-path-scoped.** Each diagnostic carries the location data the pipeline
can truthfully produce: the source `file` and a `keyPath` synthesized from
`evidence.path` + `evidence.key`. `line` and `column` are part of the entry shape
but are emitted as `null` in v0 (honestly unfilled), so a later enrichment can
populate them **without a schema bump**.

Per-diagnostic entry (one per finding, in `ScanReport.findings` order):

| field | source | notes |
|-------|--------|-------|
| `ruleId` | `finding.id` | e.g. `files.broad-path` |
| `title` | `finding.title` | |
| `severity` | `finding.severity` | info/low/medium/high/critical |
| `file` | `evidence[0].path` ?? `configPath` | source config file |
| `keyPath` | `evidence[0].path`+`key` | e.g. `mcpServers.fs.args` (config pointer, not a source offset) |
| `line` / `column` | `evidence[0].line/column` ?? `null` | **null in v0**; reserved for future enrichment |
| `observed` | `evidence[0].value` ?? `snippet` | the flagged value |
| `remediation` | `finding.fix` | |
| `mode` | `finding.mode` | OBSERVED / INFERRED |
| `confidence` | `finding.confidence` | |
| `verdictContribution` | derived | `blocker` if `finding.blocker`; else `review`/`inferred`/`unknown-source` per the finding's role in the verdict |

Top level: `schemaVersion: "calllint.diagnostics.v0"`, `verdict`,
`publicVerdictLabel`, `file`, `target`, `generatedAt`, `diagnostics: [...]`.
For a multi-server config summary, diagnostics from all servers are flattened with
a per-entry `server` field (mirroring how SARIF flattens results).

The command reuses the centralized exit-code map (`apps/cli/src/exitCode.ts`):
plain mode exits 0; `--ci` maps verdict → code exactly as `scan` does.

## Consequences / required work (none done yet — separate impl PR)

When this ADR is Accepted and scheduled:

- New `packages/types` type `DiagnosticsReport` (`calllint.diagnostics.v0`) +
  per-entry type. A type-only addition; `ScanReport` is untouched.
- New `renderDiagnostics(summary: ConfigSummaryReport): string` in
  `packages/report-renderer`, exported from its index — a pure
  `(report) => string` like the other renderers.
- New `apps/cli/src/commands/diagnostics.ts` + a `case "diagnostics":` in
  `apps/cli/src/run.ts`'s dispatch switch; `--json` selects the renderer (plain
  output can be a compact human form or simply require `--json` in v0).
- **Fixtures + tests (CLAUDE.md rule):** a positive fixture (a config that emits
  ≥1 finding → diagnostics with populated `keyPath`/`observed`) and a negative
  fixture (a SAFE config → empty `diagnostics[]`, valid envelope), plus a CLI test
  asserting parseable JSON, schema version, exit codes, and that
  `line`/`column` are `null`.
- Docs: a line in `llms.txt` / `llms-full.txt` / agent pages once shipped.
- Explicitly **out of scope**: any change to `ScanReport`, verdict semantics,
  detectors, or the corpus.

## Deferred follow-up: real line/column

Populating real `line`/`column` requires a key→source-position map computed in the
config parse step (`packages/config-parser`), threaded into `Evidence`. This
benefits SARIF too (`renderSarif.ts` would then emit real `region.startLine`). It
is a separate, fixture-backed change with its own deterministic-position tests, and
is **not** in diagnostics v0. The v0 schema reserves `line`/`column` so adding them
later is additive, not breaking.

## Reason

Deriving diagnostics purely from `ScanReport` keeps the deterministic verdict
engine the single source of truth and makes the command as auditable as SARIF:
same inputs, same verdict, a different projection. Shipping the key-path scope now
is honest about what the engine actually knows (a config pointer, not a source
offset) and unblocks IDE/agent-host integration without overpromising line/column
the pipeline cannot yet produce. Reserving the location fields keeps the door open
for the enrichment without a v1 break.

## Related

- ADR 0010 (`ScanReport` is the stable verdict contract; breaking changes need an
  ADR) — diagnostics is a view of it, not a change to it.
- `packages/report-renderer/src/renderSarif.ts` — the precedent pure renderer and
  the existing evidence of the line/column limitation (`:69`).
- `packages/types/src/finding.ts:34-43` — the `Evidence` shape diagnostics reads.
- ROADMAP R3 (`docs/ROADMAP.md`) — the phase this command belongs to; the IDE
  plugin is gated on it.
