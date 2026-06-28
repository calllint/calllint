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
  → 0.3.0         (published to `latest`; GitHub Release v0.3.0, not a pre-release)
  → 0.4.0         (published to `latest`; first post-stable: detectors + corpus 60 + prompt-surface)
  → 0.5.0         (published to `latest`; PR-gate trifecta: --markdown + scan --changed + GitHub Action)  ← we are here
```

The engine, brand, npm preview, Trusted Publishing, website V3, the R2.1 corpus
gate, and the SARIF dogfood are done. The RC window did its job: scanning real
third-party configs surfaced a dangerous false-SAFE (RC-BLK-01), which was fixed,
regression-locked, and shipped in `0.3.0-rc.1`. **Stable `0.3.0` is now published**
— promoted to the `latest` dist-tag with the engine byte-identical to rc.1 (a
promotion, not new capability).

Post-stable, the pre-platform work shipped in **`0.4.0`** (promoted to `latest`):
R2.2 reached the 60-case target (floor 60/38), R3 `calllint diagnostics --json`
shipped (ADR 0013), the two detector-calibration ADRs are accepted and implemented
(ADR 0011 `exec.unverified-local-source`; ADR 0012 docker bind-mount host paths), and
R4 prompt-surface **v0** + the local-document increment shipped (ADR 0014
`prompt.hidden-instructions`; ADR 0015 `--surface-dir`).

**`0.5.0`** (promoted to `latest`) then closed the pull-request gate end-to-end —
the `--markdown` renderer (S1), the `scan --changed` git-diff entry point (S-CH),
and the thin `calllint/calllint@v1` GitHub Action (S2) — without touching the
engine (no schema, exit-code, verdict, or detector change). What remains before any
platform work is the R4 network-surface plumbing (registry metadata + remote README,
an `--online` concern) and continued corpus growth toward 80 — everything
platform-shaped stays gated on real adoption signals below.

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
valid redacted real case from RC/field feedback becomes a case. Cadence
35 → 45 → **60 (reached)**: batch 1 (C031 lock + C032–C035), batch 2 (C036
92-server stress), batch 3 (C037–C040 real money/mutation/SAFE), batch 4 (C041 R4
seed + C042–C045 real gitlab/sqlite/google-maps/github-remote), batches 5–6
(C046–C060: R4 local-document prompt-surface seeds, four more real shapes, and the
docker mount/volume branch locks). Each batch updates
[R2_CALIBRATION.md](./R2_CALIBRATION.md), coverage, and the UNKNOWN trend. The
acceptance floor only ratchets up (now **60/38**; dangerous false-SAFE stays 0;
UNKNOWN ≤ 15%, currently 10.0%). Next target 80, from real/redacted field feedback.

### R3 — `calllint diagnostics --json` — done
A stable, editor-friendly machine protocol (file/line/column, severity, finding
id, jsonPath, observed value, remediation, verdict contribution) under its own
schema version — **without** changing scan verdict semantics or the report
schema. **Shipped** ([ADR 0013](./adr/0013-diagnostics-json.md);
`calllint.diagnostics.v0`), including real source line/column for config-mapped
evidence. This is the geology under any future IDE/agent-host integration, which
is why it comes *before* any plugin.

### Detector-calibration ADRs — done
Two documented-limitation calibration questions surfaced during R2.1/RC are now
resolved with fixture-backed, corpus-locked changes:
- [ADR 0012](./adr/0012-docker-mount-host-paths-not-inspected.md) (Accepted):
  the broad-path detector now extracts docker bind-mount host paths
  (`--mount type=bind,src=…`, `-v host:container`); C023 flipped SAFE → BLOCK.
- [ADR 0011](./adr/0011-unrecognized-local-command-calibration.md) (Accepted,
  Direction 2): new `exec.unverified-local-source` (REVIEW) for local executables
  that are not a recognized package/image/remote; C035 + C040 flipped SAFE → REVIEW.

### R4 — Prompt Surface expansion — v0 shipped
Extend prompt-surface risk beyond literal phrase matching. **v0 shipped**
([ADR 0014](./adr/0014-prompt-surface-hidden-instructions.md)): new detector
`prompt.hidden-instructions` (REVIEW) flags hidden/obfuscated content — zero-width
and invisible characters, Unicode bidi overrides, tag-character ASCII smuggling,
embedded HTML comments — in the model-visible surface the engine has today (server
instructions + provided tool metadata). Framed as **"flags prompt-surface risk"**,
never "detects prompt injection" — it is static shape detection, not a runtime
proof. Every finding carries a surface path and a false-positive note.

**R4 local-document surface increment — shipped**
([ADR 0015](./adr/0015-prompt-surface-local-documents.md)): an opt-in
`calllint scan --surface-dir <dir>` reads a bounded, offline allowlist of project
documents (`README.md`, `SKILL.md`, `AGENTS.md`, and `package.json` `description`)
and runs the prompt-surface scanners over them, emitting a project-level
`prompt.surface-instructions` (REVIEW) finding with a surface path and FP note.
Default behaviour is unchanged — with no flag, nothing beyond the config is read.

**Remaining R4 work:** extend to **registry metadata** (npm/PyPI description,
keywords) and a server's remote README. These are **network** input and therefore an
`--online` concern (advisory per ADR 0006), not the offline `--surface-dir` path —
the next R4 increment. A docker `-e` env-key secrets gap found while harvesting is
recorded as [ADR 0016](./adr/0016-docker-env-args-not-extracted-for-secrets.md)
(Proposed/deferred), the secrets-detector analogue of ADR 0012.

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
