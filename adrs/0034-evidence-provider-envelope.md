# ADR 0034: Evidence Provider Envelope

**Status**: Accepted
**Date**: 2026-07-13
**Phase**: B (Evidence Interoperability, v1.2.0) — B1
**Implemented by**: #122 (`@calllint/evidence`, `schemas/evidence-provider.schema.json`, `calllint evidence import`)
**Related**: [0035 Automated Trust Gateway & Authority Manifest](./0035-automated-trust-gateway-authority-manifest.md), [0038 Public Trust Index Boundaries](./0038-public-trust-index-boundaries.md)

> **Retroactive record.** This decision was accepted and shipped in #122; the ADR file
> was authored afterward (2026-07-13) to close the "documented-but-fileless ADR" drift and
> to give the Phase-G ADRs (0035/0038) a resolvable reference. The code and
> `docs/new7-packet-a-evidence.md` are the primary source; this file records the decision
> faithfully, it does not change it.

## Context

Other tools (SkillSpector, OSV, Semgrep, …) already scan agent skills and MCP packages.
CallLint's job is **not** to re-implement them (master-plan §12 anti-scope) but to
*aggregate* their output as evidence into its deterministic authority decision — without
impersonating them or re-judging their findings. That requires a normalized, provenance-
preserving envelope with a strict trust boundary.

## Decision

### 1. One normalized envelope — `calllint.evidence-provider.v0`

A third-party report is imported into `EvidenceEnvelope`:
`provider · providerVersion · artifactDigest · scanMode · coverage · completeness ·
findings[] · rawReportDigest · degradedReasons[]`. The envelope is a schema under
`schemas/` and a TS type in `@calllint/evidence`.

### 2. Never re-score, never rename

Provider findings are kept **verbatim** — `providerRuleId` and `providerSeverity` are the
provider's own strings, never remapped to CallLint's severity scale or verdict labels.
CallLint records what the provider said; it does not re-grade it.

### 3. Evidence ≠ Decision (enforced at the consumer boundary)

External evidence may **add reasons** or **tighten completeness**; it can never set a
CallLint verdict alone, and a provider `SAFE`/clean run never upgrades a CallLint `BLOCK`.
This "no upgrade" invariant lives at the verdict boundary (the decision consumer), not in
the importer.

### 4. Fail closed

Malformed input, an unknown provider, or an adapter error yields a `completeness:
"failed"` envelope — **emitted, never dropped, and never readable as a pass**. `importEvidence`
never throws on bad input; it returns a fail-closed envelope so a caller cannot mistake an
error for a clean scan.

### 5. Never silently ignore; pin the version

Absent/empty evidence surfaces as `degraded` (not omitted). A missing provider version
becomes `"unknown"` and forces completeness to at least `degraded` — an unpinned scanner
version can never read as `complete`. `rawReportDigest` is computed over the raw text as
received, before any parse, so provenance survives even a parse failure.

## Non-negotiables locked by this ADR

- Provider findings kept verbatim; no re-score, no rename.
- Evidence can tighten completeness / add reasons; it can never set the verdict alone or
  upgrade a BLOCK.
- Malformed/unknown/failed input ⇒ `completeness:"failed"`, surfaced, never a pass.
- Missing provider version ⇒ `unknown` + at least `degraded`.
- `rawReportDigest` preserves provenance regardless of parse outcome.

## Consequences

### Positive
- CallLint borrows other scanners' "scan before install" demand without re-fighting them
  on detector count (the aggregation moat, Engine 3).
- The strict boundary means importing evidence can only ever *raise* caution.

### Negative
- CallLint depends on providers reporting a pinnable version for `complete` evidence; many
  don't, so much imported evidence is `degraded` by design.

### Trade-offs
- Chose **verbatim preservation** over normalization to a common severity scale
  (auditability + honesty about provenance beat a prettier unified score).

## Compliance / gate impact

Corpus floor unchanged. This is additive. G2 reuses this envelope verbatim inside `trust
prepare` (wiring, not a rebuild). Any change to `calllint.evidence-provider.v0` requires a
new ADR.
