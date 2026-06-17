# ADR 0006: Online Enrichment is Advisory and Never Downgrades

Status: Accepted

## Context

`--online` enrichment reads public registry/repo metadata (npm install scripts,
deprecation, missing versions, a GitHub repo's MCP config) and merges the
resulting findings into the same deterministic assessment as the offline
analyzers. Because the network is involved, these findings are:

- non-deterministic across time (a registry can change),
- dependent on an external party we do not control,
- a different trust class than the pure, offline, config-derived findings.

A security tool must never let a softer or stale network signal *reduce* the
risk it would otherwise report from the config alone.

## Decision

1. **Provenance is explicit.** `Finding` carries two optional fields:
   - `source: "offline" | "online"` — defaults to offline; online enrichment
     stamps `"online"`.
   - `fetchedAt: string` — the ISO timestamp the online metadata was fetched
     (injected from the run's `generatedAt`, so a report is internally
     consistent and reproducible in tests).

   These are **additive, backward-compatible** fields on the report schema.

2. **Online is advisory.** Online findings may add risk (raise a verdict) but
   may never lower it. This is enforced in code, not by convention:
   `scanServer` recomputes the offline-only verdict and throws if the enriched
   verdict is *less* severe than the offline verdict (per `VERDICT_SEVERITY`).

3. **Offline remains the floor.** `UNKNOWN` never becomes `SAFE`, and a config
   that is `BLOCK` offline stays `BLOCK` regardless of any online metadata.

## Rules

- Online findings MUST set `source: "online"` and `fetchedAt`.
- The no-downgrade invariant MUST stay code-enforced and covered by tests.
- The analyzers MUST stay pure and offline; the network lives only in the
  `online` package behind an injectable fetch. Tests never touch the network.

## Reason

Auditability by design: a third-party reviewer can see exactly which findings
depend on network metadata, when they were fetched, and can rely on the
guarantee that turning `--online` on can only ever surface *more* risk.
