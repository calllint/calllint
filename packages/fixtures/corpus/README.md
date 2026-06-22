# CallLint Corpus

An auditable set of MCP configurations with pinned, machine-checkable verdict
contracts. The corpus is CallLint's calibration and anti-regression gate: it proves
the scanner produces the right verdict, at the right risk class, for the right reason.

## Hard guarantees

The runner (`scripts/run-corpus.mjs`) enforces these for every case:

- **Never executes** the scanned MCP server — CallLint reads config statically.
- **Never touches the network** — the CLI is offline unless `--online` is passed; the runner never passes it.
- **Never mutates** corpus files or the filesystem.
- **Deterministic** — `--generated-at` is pinned, so report output is reproducible.

Each `source.json` carries an `executionPolicy` of `executeTarget: false`,
`allowNetwork: false`, `allowFilesystemMutation: false`. The runner refuses to run a
case that declares otherwise.

## Anatomy of a case

```
cases/<CaseId>/
  input/mcp.json          # the configuration under test (scanned, never run)
  source.json             # provenance, human labelling, execution policy (schema: corpus.schema.json)
  expected.calllint.json  # the machine verdict contract (stable fields only)
  notes.md                # human rationale, limitations, and any blueprint divergences
```

`index.json` lists every case and its expected verdict; the runner cross-checks it
against each `expected.calllint.json` to prevent silent drift.

## The contract (`expected.calllint.json`)

Only **stable safety fields** are compared — never human-readable report text:

| Field | Meaning |
|-------|---------|
| `expectedVerdict` | SAFE / REVIEW / BLOCK / UNKNOWN |
| `expectedMaxRiskClass` | Highest S-class (S0–S5) across server reports |
| `allowExtraFindings` | If `false`, no finding id outside `requiredFindingIds` may appear |
| `requiredFindingIds` | Finding ids that must appear (`"id"` or `{id, minCount}`) |
| `forbiddenFindingIds` | Finding ids that must NOT appear |
| `requirements.mustHaveEvidenceForEveryFinding` | Every finding carries evidence |
| `requirements.mustHaveFalsePositiveNoteForReviewOrBlock` | REVIEW/BLOCK findings carry a false-positive note |
| `requirements.mustHaveRemediationForReviewOrBlock` | REVIEW/BLOCK findings carry a `fix` |
| `dangerousFalseSafePolicy.thisCaseMustNeverBeSafe` | A dangerous case that must never report SAFE |

## Curation status

**R2.1 is shipped: 30 cases, 20 of them real.** The mix is 10
`synthetic-contract-seed` (deterministic detector anchors) + 19
`real-public-snapshot` + 1 `redacted-real-snapshot`, every real case carrying
`origin` metadata (url, commit, license). The R2.1 thresholds (≥ 30 cases, ≥ 20
real/redacted, UNKNOWN ≤ 15%, dangerous false-SAFE = 0) are enforced by
`pnpm corpus:test:r2-final` — see [docs/CORPUS.md](../../../docs/CORPUS.md).

## Running

```bash
pnpm build          # the runner scans the BUILT CLI (apps/cli/dist/index.js)
pnpm corpus:test    # run the gate
pnpm corpus:test:verbose
node scripts/run-corpus.mjs --case C009-block-money-observed --verbose
```

Exit codes: `0` all contracts hold · `1` contract failure · `2` malformed corpus or
missing CLI build.
