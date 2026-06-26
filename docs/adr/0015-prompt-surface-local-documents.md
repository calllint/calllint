# ADR 0015: R4 prompt surface — local document surfaces (README / SKILL.md / AGENTS.md / package description)

Status: Accepted (recorded and implemented 2026-06-25)

## Context

[ADR 0014](./0014-prompt-surface-hidden-instructions.md) shipped R4 prompt-surface
**v0**: a detector (`prompt.hidden-instructions`) over the model-visible surface the
engine already had — the config's declared `x-calllint` tool metadata
(`server.instructions`, `providedTools[]`). ADR 0014 explicitly deferred the rest of
the ROADMAP R4 list — README / SKILL.md / tool schema descriptions / package
description / registry metadata — because surfacing them needs **new input
plumbing**: today nothing in `config-parser`, `resolver`, or `core` reads any file
beyond the config itself (`parseConfigFile` reads exactly one path;
`scanConfigText` takes one text blob).

This ADR is the next R4 increment: read **local document surfaces** that ship
alongside an MCP server and run the prompt-surface scanners over them. These
documents — a server's `README.md`, an agent-skill `SKILL.md`, an `AGENTS.md`, and a
`package.json` `description` — are exactly where a real-world prompt-surface attack
hides, because they are read by humans and increasingly by agents, yet they never
appear in the MCP config the engine scans today.

Three facts from the pipeline shape the decision:

1. **The engine is offline and reads only the config.** The contract (CLAUDE.md)
   and ADR 0006 keep analyzers pure and offline; network is opt-in behind `--online`
   and advisory-only. Reading sibling files on disk is new I/O, so it must be
   **explicitly opted into**, never a surprise default-on file read.
2. **`--online` already models "extra input → findings without schema change".**
   It keeps the network in the CLI layer and passes distilled findings into core via
   `ScanOptions.extraFindings`, flowing through the same assessment with a
   no-downgrade invariant (`scanServer.ts:43-51`). Local document surfaces follow the
   same shape: the **CLI reads the files**, core stays pure and is handed
   already-read text.
3. **The aggregate verdict is the most-severe child report** (`scanConfig.ts:28-29`).
   A project-level surface finding can therefore join `reports[]` as one more
   `ScanReport` and influence the verdict with **no change to `ScanReport` /
   `ConfigSummaryReport`** shape.

## Decision

Add an **opt-in** `--surface-dir <dir>` flag to `calllint scan`. When set, the CLI
reads a fixed, named allowlist of document surfaces from that directory, offline,
and hands their text to core, which runs the prompt-surface scanners over them and
emits a **project-level** `ScanReport` (`target.kind: "project-docs"`) appended to
`reports[]`.

**Surfaces read (exact allowlist, no globbing, no traversal):**
`README.md`, `SKILL.md`, `AGENTS.md`, and the `description` field of `package.json`
— each only if present directly in `<dir>`. Nothing else is read.

**New finding id `prompt.surface-instructions`** (PROMPT, S2, REVIEW, non-blocker,
OBSERVED): a project document contains model-directed instruction patterns
(reusing the `prompt.poisoning` phrase set) and/or hidden/obfuscated content
(reusing the `prompt.hidden-instructions` categories). It is **REVIEW, never a
blocker** — a project doc is advisory prompt surface, not the tool metadata the
model is guaranteed to read, so its presence warrants human eyes but must not
hard-stop. Every finding carries the **surface path** (the file it was found in,
e.g. `README.md`) and a false-positive note; evidence reports the phrase/category,
never raw hidden bytes (same discipline as ADR 0014).

**Shared scan primitives.** The phrase list and hidden-content categories — until
now duplicated inside `promptPoisoning.ts` and `hiddenInstructions.ts` — are
extracted into one module (`static-analyzer/src/promptScan.ts`:
`findPoisonPhrases`, `findHiddenContent`). The two existing detectors are
refactored to consume it (behaviour-preserving; the 36 existing detector tests
guard against drift), and the new surface analysis uses the same source of truth.
This guarantees the config-metadata surface and the document surface flag the same
patterns.

**Security boundary (stated and enforced):**
- Default behaviour is unchanged: with no `--surface-dir`, no file beyond the config
  is ever read.
- Only the four named files directly under `<dir>` are read — no globbing, no
  recursion, no symlink following, no path outside `<dir>`.
- Each file is read with a **size cap** (256 KiB); larger files are truncated for
  scanning and noted, so a hostile huge file cannot exhaust memory.
- Nothing is executed; `package.json` is parsed as JSON for its `description` only.
- A missing directory or missing files is not an error — the surface report is
  simply empty (UNKNOWN-free: an empty surface adds no finding and no report).

## Explicitly out of scope (still deferred)

- **Registry metadata as a surface** (npm/PyPI description, keywords, README via
  registry). This is an **`--online`** concern (it is network input, advisory per
  ADR 0006), and belongs with the existing online-enrichment layer, not the offline
  `--surface-dir` path. Recorded as the next R4 online increment; not built here so
  the offline determinism guarantee stays intact.
- **Fetching a server's README from its GitHub repo.** Same reason — network, and it
  would ride on the existing `github:` online path, not offline `--surface-dir`.

## Consequences / required work

- New type `DocumentSurface` (`{ path, kind, text, truncated }`) in
  `@calllint/types`; `ScanOptions.surfaces?: DocumentSurface[]` in core (a type-only
  addition; `ScanReport`/`ConfigSummaryReport` unchanged).
- `static-analyzer`: extract `promptScan.ts`; refactor `promptPoisoning` +
  `hiddenInstructions` to use it; add `analyzeDocumentSurfaces(surfaces) =>
  Finding[]` emitting `prompt.surface-instructions`.
- `core`: when `surfaces` is non-empty, build one project-level `ScanReport` and
  append it to `reports[]` in `scanConfig`.
- `apps/cli`: `--surface-dir <dir>` reads the allowlisted files (bounded, offline),
  passes `surfaces` into `scanConfigText`; documented in `help` and README.
- **Fixtures + tests (CLAUDE.md rule):** a **positive** golden surface fixture (a
  README with a model-directed instruction → finding) and a **negative** one (a
  clean README → none), plus unit tests for `analyzeDocumentSurfaces` and the shared
  primitives, and a CLI test for `--surface-dir`.
- **Corpus:** new cases pinning the project-docs surface verdict (synthetic, since
  these read docs that real config snapshots do not carry — same harvestability
  limit as `prompt.poisoning`/`prompt.hidden-instructions`).
- Docs: ADR (this), rule doc, README rule list, ROADMAP R4 (surface increment done;
  registry still the remaining online increment), CHANGELOG, R2_CALIBRATION.

## Reason

This extends prompt-surface coverage to where real prompt-injection payloads
actually live (project docs and skill files) while keeping every safety invariant:
offline, opt-in, bounded, no execution, no schema change, no default-on file reads,
and a REVIEW (not blocker) verdict that matches the advisory nature of a doc. It
reuses the `--online` architectural pattern (read input in the CLI, hand findings to
a pure core) and the existing prompt scanners (one source of truth), so it adds
surface without widening the trusted, deterministic core. Registry/network surfaces
stay deferred to the online layer, keeping the offline guarantee exact.

## Related

- ADR 0014 (R4 v0, the config-metadata prompt surface this extends).
- ADR 0006 (online enrichment is advisory) — why registry surface is an online, not
  offline, concern.
- `prompt.poisoning` / `prompt.hidden-instructions` — the scanners reused here.
- `apps/cli/src/online.ts` + `ScanOptions.extraFindings` — the precedent pattern for
  "extra input read at the edge, findings into a pure core".
