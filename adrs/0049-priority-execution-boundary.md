# ADR 0049 — Priority Execution Boundary (new11)

- Status: Accepted
- Date: 2026-07-20
- Supersedes: none
- Refines: 0034 (evidence envelope), 0038 (public trust index boundaries),
  0046/0047/0048 (Phase I + maintainer claim)

## Context

By v1.6.0 CallLint has shipped the full product spine: scan → authority →
Trust Gateway (prepare/approve/apply/verify) → static toxic-flow → continuous
guard → Public Trust Index + Partner API + embed + maintainer-claim mechanism.

An empirical audit of the baked Trust Pages (2026-07-20, PR-01) shows the real
gap is **not** detector coverage. On hand-authored golden fixtures the verdict
distribution is rich (7 BLOCK / 5 REVIEW / 5 SAFE / 2 UNKNOWN of 19). On the
first cohort of **real external objects** (Official MCP Registry, 18 entries)
it is **17 UNKNOWN / 1 SAFE / 0 BLOCK** — 94% uninformative UNKNOWN.

The directive `docs/new11.md` concludes from this that the next development
cycle must invest in **evidence resolution**, external trust repair, default
distribution, and real commercial validation — not more ordinary detectors.

## Decision

For the next major cycle (new11 P0–P5), the following boundaries are binding:

1. **No new ordinary detectors** during P0–P2 unless required to prevent a
   demonstrated false-SAFE. The engine has 13 deterministic detectors; the
   marginal UNKNOWN is fixed by evidence, not by rule #14.
2. **Evidence Resolver is the priority**, and it EXTENDS the existing packages —
   `@calllint/resolver` (identity), `@calllint/online` (fetch), and
   `@calllint/evidence` (model + envelope, ADR 0034). **No `evidence-model`
   package is created**; no parallel Trust/Policy/Telemetry/Resolver tree.
3. **CallLint does not build a general runtime gateway.** The Trust Gateway is a
   local install-decision state machine, not a runtime proxy. CallLint's runtime
   posture is to be the upstream deterministic evidence provider that gateways,
   SIEMs, and agent runtimes read.
4. **No composite reputation/trust score.** Verdict, publisher identity, artifact
   provenance, maintainer context, and runtime observation stay separate fields.
5. **The public deterministic verdict is immutable to maintainers.** A verified
   maintainer may attach context, correct metadata, dispute, and supply a fixed
   version — never lower severity, mark a global false-positive, or buy a higher
   status. (Extends 0047.)
6. **The Public Trust Index is not a software-distribution registry.** It is a
   read-only evidence surface; eligibility to publish requires resolvable
   identity + immutable digest + reproducible resolution (extends 0038).
7. **EU AI Act output is an evidence mapping only** — never a certification,
   compliance score, or legal conclusion. Forbidden-word lint enforces this.
8. **Public claims derive from one machine-readable source** (`project-facts.json`,
   guarded by `check:public-copy`). No second facts file.
9. **Phase gates are hard.** P3/P4/P5 build only after their human-dependent
   evidence gates (maintainer claims, paying pilots, partner confirmation) are
   met. Code cannot self-satisfy these.

## Canonical naming

- The single idempotent host installer command is **`calllint integrate`**
  (`init` is retired to an alias, not a parallel command). Settled here so PR-11
  does not reopen it.

## Consequences

- PR order is fixed: Sprint-0/PR-01 → P0 (02–04) → P1 (05–09) → P2 (10–12) →
  P3 (13) → P4 (14) → P5 (15). Each phase stops at its gate for review.
- The "17/18 UNKNOWN" figure is no longer an assumption; PR-01's audit
  (`docs/internal/evidence-gap-audit.md`) records the confirmed split.
- Reversibility: this ADR is docs-only and changes no runtime behavior; it can
  be superseded by a later ADR if the evidence-first thesis is falsified by the
  P1 benchmark.
