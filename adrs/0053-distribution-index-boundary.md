# ADR 0053 — Embedded-Distribution & Autonomous-Evidence-Index Boundary

- Status: Accepted
- Date: 2026-07-22
- Refines: 0046 (Phase I architecture — serving decoupled from scanning),
  0034 (evidence provider envelope — the schema the Evidence Manifest projects),
  0047 (maintainer-claim trust model), 0048 (I2c claim mechanism — GitHub App),
  0050 (evidence-refined verdict — remote UNKNOWN→REVIEW, never SAFE),
  0051 (preflight hook boundary — recommend-only, never a judge)
- Related: 0038 (Trust Page language boundary), 0049 (priority-execution boundary)

## Context

The `new12` directive (Round 4 normative, "CallLint Trust Index + Publisher
Verification") asks CallLint to grow from a scanner that *can* publish evidence
into a **distribution system** that autonomously indexes evidence and lets
maintainers verify namespace ownership — with adoption measured as a falsifiable
experiment (feasibility gates A–E + a K-factor kill gate) before any scale-out.

A verified audit of the repository (2026-07-22, `main` `30e616e`) established that
**~85% of that machinery is already shipped**:

| new12 blueprint component | Shipped reality |
|---|---|
| autonomous rolling index | `.github/workflows/trust-ingest.yml` (cron + dispatch → ingest → resolve-evidence → bake → `check:public-copy` → **human-gated PR**, never deploys) |
| evidence resolution | `@calllint/evidence` (Subject/Bundle/Gap, 16 gap codes) + `@calllint/resolver` (6 resolvers) |
| read-only serving | `@calllint/partner-api` (`GET /v1/public/resources/{ns}/{name}[/authority]`, never scans on the request path) |
| publisher verification | ADR 0047/0048 claim (9-state lifecycle, 7 re-verify triggers), `trust-verify-claims.yml`, Verified Publisher serving |
| agent-native trigger | `@calllint/agent-triggers` + `calllint integrate` + Claude plugin + recommend-only `PreToolUse` hook (new11 P2, ADR 0051) |

The dominant risk is therefore **rebuilding** shipped code under a new name, or
letting a "distribution/index" framing quietly erode the invariants that make the
evidence worth distributing. This ADR freezes the boundary **once**, before any
Gate-A build lands, exactly as ADR 0051 settled the preflight-hook boundary before
its PR and ADR 0052 settled guard-host safety before its renderers.

This ADR changes **no behavior**: it is the Sprint-0 (Phase-0) signoff artifact.
No production file is deleted, moved, renamed, or refactored; no public output,
schema, or workflow changes. It records the decisions that gate Gates A–E.

## Decision

### 1. The index stays non-LLM, human-gated, and never executes a target

The autonomous evidence index is `trust-ingest.yml` scaled **in place** (ADR 0046
serving-decoupled-from-scanning). Every property below is preserved verbatim and a
reviewer MUST reject any distribution PR that weakens one:

- **No target execution** (INV1 / `I-06`): ingestion resolves *identity* only
  (digest, config, tool surface). It never runs a scanned server or probe.
- **No LLM in the verdict path** (product principle 5): deterministic rules decide
  verdicts; an LLM may only summarize existing evidence. Ingestion adds no model.
- **Human-gated publication**: the pipeline opens a PR and **never deploys**. The
  three publish channels in §4 are the only paths, and two of them stop on a human.
- **UNKNOWN never auto-upgrades to SAFE** (`I-04`, ADR 0050): a remote artifact's
  UNKNOWN may be refined to REVIEW under stated evidence — never to SAFE.

### 2. The Evidence Manifest is a PROJECTION onto ADR 0034 — never a new receipt or verdict

The `calllint.evidence-manifest.v1` surface (Gate C / D4) is a **read-only
projection** of already-decided data (verdict, authority, scope, completeness,
digest) onto the ADR 0034 evidence-provider envelope. It introduces **no** new
score, receipt, verdict vocabulary, or authority model. It carries the verdict and
authority **verbatim** from the baked page; if it cannot, it is a bug, not a new
judgment. Signing (ed25519 / OIDC) attests *who emitted the projection*, never that
the artifact is safe.

### 3. A namespace claim states control — it NEVER alters a verdict

Extending ADR 0047/0048 to namespace inheritance + DNS-TXT / `.well-known`
verification (Gate D / D6) changes **only** the `verifiedPublisher` overlay, which
is not part of `pageDigest` and states namespace control, not safety (ADR 0048 §2,
ADR 0038 §2). A claimed page and an unclaimed page with the same artifact digest
carry the **same verdict**. "Maintainer cannot take over CallLint's facts or
verdicts" is binding: a claim can never move a verdict toward SAFE, suppress a
finding, or remove a page.

### 4. Publication has exactly three channels; two of them stop on a human

Every published/updated page flows through one of three channels (directive line
3161), and this set is closed:

| channel | when | gate |
|---|---|---|
| `AUTO_PUBLISH` | verdict unchanged OR UNKNOWN→REVIEW under the same evidence, no negative claim | still opens a PR; a positive/neutral, byte-reproducible page may land on merge |
| `REVIEW_HOLD` | any *new negative* conclusion (first BLOCK / high-sev REVIEW for an artifact) | **blocked** until Gate-B dual human review (§6.1 thresholds) |
| `SECURITY_HOLD` | suspected exploit / active-harm signal | **blocked**; escalates out-of-band, never auto-served |

No page bypasses these. The kill-gate thresholds (dangerous false-SAFE = 0,
blocker precision ≥ 90%, byte-identical repeat = 100%) are the `REVIEW_HOLD` exit
condition, not advisory.

### 5. The four status dimensions never collapse into one number

A Trust Page states four **independent** dimensions, already present in the baked
data — never a single composite "trust score":

1. **Verdict** — `page.verdict` (`SAFE`/`REVIEW`/`BLOCK`/`UNKNOWN`), public label.
2. **Evidence completeness** — `preparation.authority.completeness`
   (`complete`/`partial`), i.e. how much was actually observed.
3. **Authority** — `verifiedPublisher` present/absent (namespace control only).
4. **Reproducibility** — `pageDigest` + `observedAt` (same input → byte-identical).

The E0–E6 display (Gate A / D2) renders these dimensions; it MUST NOT multiply or
average them into a rating. Collapsing them would recreate the mass-rating posture
§6 forbids.

### 6. Scale-out is feasibility-gated; anti-mass-rating is the posture

Page growth past the shipped cap (`TRUST_INGEST_MAX_ENTRIES`, default 25;
`fetchRegistry.ts`) is **gated behind Gate E** (K-factor, §6.1 kill gate). CallLint
does not rate every server on the registry to inflate coverage. It publishes
**fewer, higher-quality, evidence-backed** pages and grows only when the loop is
proven (≥1 external platform consuming the API, secondary adoption ≥ 20%). If the
K signal fails, new12 is "an automated scanner, not a distribution system" → stop
growing pages and re-validate the value prop. Report honestly.

### 7. Route shape: one router, no second API

The directive references `/v1/evidence/{ns}/{server}` (line 2296); the shipped
canonical route is `/v1/public/resources/{ns}/{name}[/authority]`
(`@calllint/partner-api`). The decision: keep `resources` canonical, and if an
`evidence` path is wanted it is an **alias in the same router** over the same
read-only `AssetReader` — never a second API, never a scanner on the request path.

## Consequences

- **Positive**: the shipped index/evidence/claim/agent-trigger machinery is
  productionized, not forked. Every Gate-A build extends an existing package
  (`trust-index`, `partner-api`, `evidence`, `resolver`) with a positive/negative
  fixture, per project discipline. Zero new scanner, verdict, authority model,
  receipt, or deployable service.
- **The invariants are reinforced, not eroded.** Reviewers may reject any
  distribution PR that: executes a target, puts an LLM in the verdict path, lets a
  claim move a verdict, collapses the four dimensions into a score, auto-serves a
  new negative page without human review, or scales page count before Gate E.
- **Cost**: a boundary doc (this ADR) + a local, gitignored audit map
  (`docs/internal/distribution-system-map.md`) that *measures* the current
  pipeline. No committed behavior change; `pnpm ci:local` is byte-for-byte
  identical before and after (proof the audit changed nothing).
- **Deferred**: Cloudflare D1/R2/OCI/`app.` infra stays behind the feasibility
  gate; the pipeline remains Git-backed + PR-gated (stronger provenance for a trust
  product) until a measured ceiling forces a cutover ADR.

## Invariants preserved

`I-04` UNKNOWN/drift never becomes SAFE (index reuses evidence-refined verdict) ·
`I-06` never executes the target (identity-only ingestion) · no second verdict
vocabulary · no second scanner or evidence model · a claim states control, never
safety, and never alters a verdict · the four status dimensions never collapse into
a rating · every new negative page stops on a human (`REVIEW_HOLD`/`SECURITY_HOLD`)
· scale-out is K-factor-gated · the Evidence Manifest is a projection, never a new
receipt.
