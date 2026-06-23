# CallLint Corpus — Methodology

This document explains *how* the corpus is built and *why* it is trustworthy. The
mechanics live in [packages/fixtures/corpus/README.md](../packages/fixtures/corpus/README.md).

## Why a corpus

A security scanner is only as credible as the evidence that it works. The corpus is a
fixed set of MCP configurations, each with a pinned, machine-checkable verdict
contract, run against the **built CLI** exactly as a CI user would run it. It serves
three purposes:

1. **Calibration** — proves the verdict, risk class, and findings are right *for the right reason*.
2. **Anti-regression** — a rule change that breaks a contract fails the gate.
3. **Honesty ledger** — every case records its provenance, known limitations, and any divergence from the original design.

## Core principle: the engine decides, the corpus records

Verdicts come from CallLint's deterministic rules. We **calibrate the corpus to the
engine's real, secure behaviour** — we never weaken a rule to make a case pass, and we
never write an expectation we wish were true. The workflow is empirical:

1. Author a realistic `input/mcp.json` that exercises a specific detector.
2. Scan it with the built CLI and read the actual JSON.
3. Record the *observed, secure* verdict as the contract.
4. If the observed verdict is wrong/unsafe, that is a **scanner bug** — fix the engine, not the expectation.

## Divergences from the R2 blueprint (and why)

The R2 blueprint sketched sample configs before the detectors were pinned down. Three
were reconciled to the shipped engine:

| Case | Blueprint | Engine reality | Resolution |
|------|-----------|----------------|------------|
| Broad filesystem path | REVIEW | `files.broad-path` is a critical **blocker** | C002 → **BLOCK** |
| Prompt injection | REVIEW, in a `--description` flag | `prompt.poisoning` is a critical **blocker**; scans **tool metadata**, not CLI flags | C010 → **BLOCK**, text in `x-calllint.tools[].description` |
| Observed money transfer | `sh -c 'stripe refunds …'` | that blocks via `exec.dangerous-command` (shell), not money | C009 modeled on observed **tool verbs** + credential → `action.financial-observed` |

The detectors are name/metadata-based, not CLI-flag-based, so `external-mutation` and
`money-inferred` cases encode their signal in package/tool names. These choices are
recorded in each case's `notes.md`.

## What the contract checks (and deliberately does not)

**Checked:** verdict, max risk class, required/forbidden finding ids, evidence
presence, and — for REVIEW/BLOCK — a false-positive note and a remediation (`fix`).
Plus a `thisCaseMustNeverBeSafe` guard on every dangerous case.

**Not checked:** human-readable summaries, ordering, timestamps (pinned), or any
field that may legitimately change wording without changing the security meaning.
This keeps the gate strict on safety and tolerant of presentation.

## The inferred vs observed boundary

The corpus pins the most consequential distinction in the engine:

- **INFERRED** (name-based heuristic) → at most REVIEW. E.g. C008 `action.financial`.
- **OBSERVED** (a capability visible in metadata) → may BLOCK. E.g. C009 `action.financial-observed`.

C008 and C009 are a matched pair so this boundary can never silently collapse.

## Curation status (R2.1 shipped, R2.2 ongoing)

**R2.1 shipped at 30/20; R2.2 has grown the corpus to 35.** It currently contains:

- 35 calibrated cases
- 25 real-public or redacted-real snapshots, each with per-case `origin`
  metadata (url, commit, license, retrievedAt, redactions)
- dangerous false-SAFE = 0
- UNKNOWN ratio = 11.4% (target ≤ 15%)
- `pnpm corpus:test:r2-final` passing (floor ratcheted to 35/25)

The 10 `synthetic-contract-seed` cases remain as deterministic detector anchors;
the 25 `real-public-snapshot` / `redacted-real-snapshot` cases provide broader
ecosystem coverage. The corpus still does **not** represent the full MCP
ecosystem — see [R2_CALIBRATION.md](./R2_CALIBRATION.md) for the per-case results
and provenance, and R2.2 (PROJECT_STATUS.md) for continued expansion.

The mechanics — how to add a case, redact responsibly, and check composition —
are in [CORPUS_CURATION.md](./CORPUS_CURATION.md). The acceptance floor (currently
≥ 35 cases, ≥ 25 real/redacted, UNKNOWN ≤ 15%, dangerous false-SAFE = 0) is
enforced by `pnpm corpus:test:r2-final` and ratchets up monotonically as R2.2
adds cases.

## Offline & no-execution, by construction

CallLint performs static analysis only. The runner spawns the CLI without `--online`
and the CLI never spawns the scanned server. The corpus therefore carries no risk of
running attacker-controlled commands, even though several inputs *describe* dangerous
commands. This is the whole point: we reason about a config's capabilities without
incurring them.
