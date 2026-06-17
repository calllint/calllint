# Corpus curation (R2.1)

How to grow the CallLint verdict corpus from the R2.0 synthetic seed into a
credible, real-world calibration set — without ever compromising the safety
invariants or misrepresenting provenance.

Read [CORPUS.md](./CORPUS.md) first for the corpus structure and contract. This
document covers **adding new cases**, especially real and redacted ones.

## Honesty rules (non-negotiable)

1. **Never label synthetic data as real.** `curationStatus` and `origin.kind`
   must describe how the case was actually obtained. A fabricated config is
   `synthetic-contract-seed` / `origin.kind: synthetic` — always.
2. **Provenance is mandatory for real cases.** A `real-public-snapshot` records
   the source `url`, `commit` (if applicable), `license`, and `retrievedAt`. A
   `redacted-real-snapshot` additionally lists every `redactions[]` transform.
3. **Redaction must not change the verdict-relevant shape.** Replace secret
   *values* and identifying hosts with neutral placeholders, but keep the
   structure that drives the verdict (key names, command shape, transport kind).
   If redaction would alter the verdict, the case is not usable — pick another.
4. **The corpus never executes anything.** Every case keeps
   `executionPolicy: { executeTarget:false, allowNetwork:false, allowFilesystemMutation:false }`.
   Inputs are static config snapshots only.

## curationStatus ladder

| status | meaning | counts toward R2.1? |
|--------|---------|---------------------|
| `synthetic-contract-seed` | hand-written to pin one contract | no |
| `redacted-real-snapshot` | real config, secrets/hosts neutralized | yes |
| `real-public-snapshot` | unmodified config from a public source | yes |

R2.1 acceptance requires **≥ 30 total cases** with **≥ 20** in the bottom two
rows. Synthetic seeds stay (they pin detector contracts) but do not satisfy the
real-world bar on their own.

## Adding a case

Each case is a directory `cases/CNNN-<verdict>-<slug>/` with four parts:

```
cases/C011-review-... /
  source.json              # provenance + human label + execution policy
  expected.calllint.json   # the machine verdict contract the runner checks
  input/mcp.json           # the static config snapshot CallLint scans
  notes.md                 # human reasoning, edge cases, FP/FN discussion
```

Steps:

1. **Pick the next id.** `CNNN` is zero-padded and monotonic; the slug encodes
   the expected verdict, e.g. `C011-review-broad-network-egress`.
2. **Capture the input.** Save the config as `input/mcp.json` (or another
   supported `input.format`). For redacted cases, neutralize secret values and
   identifying hosts first; record each transform in `origin.redactions[]`.
3. **Write `source.json`** against `corpus.schema.json` — set `curationStatus`,
   `origin` (with url/commit/license/retrievedAt for real cases), `riskTheme`,
   and the human `verdict` + `rationale`.
4. **Write `expected.calllint.json`** — the contract: `expectedVerdict`,
   optional `expectedMaxRiskClass`, `requiredFindingIds`, `forbiddenFindingIds`,
   and `requirements` (evidence / falsePositiveNote / remediation). For any
   case that must never be SAFE, set
   `dangerousFalseSafePolicy.thisCaseMustNeverBeSafe: true`.
5. **Register it** in `index.json` (`caseId`, `path`, `expectedVerdict`,
   `riskTheme`) — the runner cross-checks index vs `expected.calllint.json`.
6. **Run the gate:** `pnpm build && pnpm corpus:test:verbose`. Calibrate the
   contract to the *shipped* detectors; if a case reveals a real detector gap,
   file it rather than weakening the case.

## Verifying composition

```bash
pnpm build
pnpm corpus:test                       # contracts only (R2.0 gate)
pnpm corpus:test:r2-final              # also enforce R2.1 size/mix thresholds
pnpm corpus:test -- --summary-json corpus-summary.json   # machine summary
```

`corpus:test:r2-final` is expected to FAIL today — the seed corpus is 10
synthetic cases. It passes only once curation reaches the thresholds above. The
machine summary feeds [R2_CALIBRATION.md](./R2_CALIBRATION.md) regeneration and
CI artifacts.

## Sourcing real cases responsibly

- Prefer permissively licensed public repositories and registries; record the
  license. Do not ingest configs that prohibit redistribution.
- Strip anything that identifies a private individual or org unless the source
  is already public and the content is non-sensitive.
- When in doubt, redact more and mark `redacted-real-snapshot`. A smaller, fully
  defensible corpus beats a larger one with questionable provenance.
