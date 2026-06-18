# CallLint roadmap

The terminal goal of this phase is **not** a platform. It is to be the default
pre-flight safety check for agent tools:

> Before your agent runs a tool, run CallLint.

This file exists to keep scope honest — to make the next step obvious and the
things we are deliberately *not* doing explicit. It is a map, not a promise of
dates.

## Where we are

```text
v0.3.0-preview.1  (published, preview dist-tag)
  → 0.3.0-rc.0    (prepared in-repo; ships to `next` when tagged)   ← we are here
  → 0.3.0         (latest dist-tag; stable CLI contract)
```

The engine, brand, npm preview, Trusted Publishing, website V3, the R2.1 corpus
gate, and the SARIF dogfood are done. What remains before stable is **release
discipline and real-world confirmation**, not new capability.

## Phase: 0.3.0-rc.0 → stable

1. **Tag & publish `0.3.0-rc.0`** to the `next` dist-tag (human gate: tag +
   publish). The release workflow routes `*-rc.*` → `next`.
2. **RC feedback window** — [RC_FEEDBACK_PROTOCOL.md](./RC_FEEDBACK_PROTOCOL.md).
3. **Ship `0.3.0` to `latest`** — gated by
   [STABLE_RELEASE_GATE.md](./STABLE_RELEASE_GATE.md).

### Stable `0.3.0` exit criteria

- Every box in [STABLE_RELEASE_GATE.md](./STABLE_RELEASE_GATE.md) checked.
- RC window closed with **zero** unresolved dangerous false-SAFE.
- `latest` → `0.3.0`; `preview` → newest preview; `next` → newest rc (or cleared).
- Website default install flips `npx calllint@preview` → `npx calllint`
  (preview/next still documented).
- GitHub Release `v0.3.0`, **not** marked pre-release.
- README status moves from "public preview" to "stable 0.3.x" — limitations
  stay visible (static scanner, no runtime proof, heuristic, FP/FN possible).

"Stable" means the **CLI contract, verdict semantics, report schema v0, release
chain, and CI integration are stable** — not that any tool is proven safe.

## After stable

### R2.2 — continuous corpus
Turn the corpus from a one-time gate into a growing regression system; every
valid redacted real case from RC/field feedback becomes a case. Rough cadence
35 → 45 → 60 cases, each batch updating
[R2_CALIBRATION.md](./R2_CALIBRATION.md), coverage, and the UNKNOWN trend.
Thresholds only tighten (dangerous false-SAFE stays 0; UNKNOWN ≤ 15%).

### R3 — `calllint diagnostics --json`
A stable, editor-friendly machine protocol (file/line/column, severity, finding
id, jsonPath, observed value, remediation, verdict contribution) under its own
schema version — **without** changing scan verdict semantics or the report
schema. This is the geology under any future IDE/agent-host integration, which
is why it comes *before* any plugin.

### R4 — Prompt Surface expansion
Extend prompt-surface risk beyond tool metadata to README / SKILL.md / tool
schema descriptions / server instructions / package description / registry
metadata. Framed as **"flags prompt-surface risk"**, never "detects prompt
injection" — it is static shape detection, not a runtime proof. Every finding
carries a surface path and a false-positive note.

## Explicit non-goals (now)

These are out of scope until the decision gates below are met. Listing them is
the point — it is how scope stays narrow.

- AgentTrust / trust-layer **platform**
- SaaS dashboard
- gateway / proxy / registry
- IDE plugin (blocked on R3 diagnostics)
- runtime sandbox / Deep Scan
- host execution of scanned servers
- **live telemetry scan counter** (see [ADR 0009](./adr/0009-optional-telemetry.md))
- new detectors before stable (stable fixes bugs; it does not widen surface)

## Platform decision gates

Revisit platform-shaped work **only** once these adoption signals are real, not
anticipated:

- npm weekly downloads growing organically
- external GitHub issues / stars / PRs (not author-driven)
- real teams asking for shared/centralized policy
- CI / SARIF integration actually adopted by others
- `diagnostics --json` being consumed by an IDE / agent host
- R2 corpus continuing to grow from real feedback

Until then, platform work is dilution of a wedge that is working.
