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
  → 0.3.0-rc.0    (published to `next`; RC window found RC-BLK-01)
  → 0.3.0-rc.1    (published to `next`; RC-BLK-01 fixed + re-validated)
  → 0.3.0         (published to `latest`; GitHub Release v0.3.0, not a pre-release)  ← we are here
```

The engine, brand, npm preview, Trusted Publishing, website V3, the R2.1 corpus
gate, and the SARIF dogfood are done. The RC window did its job: scanning real
third-party configs surfaced a dangerous false-SAFE (RC-BLK-01), which was fixed,
regression-locked, and shipped in `0.3.0-rc.1`. **Stable `0.3.0` is now published**
— promoted to the `latest` dist-tag with the engine byte-identical to rc.1 (a
promotion, not new capability). What comes next is **continuous corpus breadth
(R2.2) and the post-stable phases**, not the stable mechanics.

## Phase: 0.3.0-rc.1 → stable — done

1. **Done — `0.3.0-rc.0` then `0.3.0-rc.1` published** to the `next` dist-tag
   (human-gated tag + publish; release workflow routes `*-rc.*` → `next`).
   `rc.1` carries the RC-BLK-01 fix, re-validated on the published artifact.
2. **Done — RC feedback window closed** — [RC_FEEDBACK_PROTOCOL.md](./RC_FEEDBACK_PROTOCOL.md);
   coverage met (11 non-author configs), dangerous false-SAFE = 0 on rc.1.
3. **Done — `0.3.0` shipped to `latest`** — gated by
   [STABLE_RELEASE_GATE.md](./STABLE_RELEASE_GATE.md).

### Stable `0.3.0` exit criteria — met

- Every box in [STABLE_RELEASE_GATE.md](./STABLE_RELEASE_GATE.md) checked.
- RC window closed with **zero** unresolved dangerous false-SAFE.
- `latest` → `0.3.0`; `preview` → `0.3.0-preview.1`; `next` → `0.3.0-rc.1`.
- Website + README default install flipped `npx calllint@preview` → `npx calllint`
  (preview/next still documented).
- GitHub Release `v0.3.0`, **not** marked pre-release.
- README status moved from "public preview" to "stable 0.3.x" — limitations
  stay visible (static scanner, no runtime proof, heuristic, FP/FN possible).

"Stable" means the **CLI contract, verdict semantics, report schema v0, release
chain, and CI integration are stable** — not that any tool is proven safe.

## After stable

### R2.2 — continuous corpus
Turn the corpus from a one-time gate into a growing regression system; every
valid redacted real case from RC/field feedback becomes a case. Rough cadence
35 → 45 → 60 cases (batch 1 reached 35: C031 lock + C032–C035), each batch
updating [R2_CALIBRATION.md](./R2_CALIBRATION.md), coverage, and the UNKNOWN
trend. The acceptance floor only ratchets up (dangerous false-SAFE stays 0;
UNKNOWN ≤ 15%).

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
