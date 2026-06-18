# RC feedback log — 0.3.0-rc.0

Append-only record of redacted validation results for the `0.3.0-rc.0` feedback
window. Process, redaction rules, classification, and the stable-blocking
criteria live in [RC_FEEDBACK_PROTOCOL.md](./RC_FEEDBACK_PROTOCOL.md). This file
is only the log.

Install under test: `npx calllint@next` (currently `0.3.0-rc.0`).

## Window status

- RC version: `0.3.0-rc.0` (published to the `next` dist-tag, signed provenance)
- Target coverage: 5–10 real / semi-real MCP configs · 3–5 CI / SARIF runs ·
  ≥ 1 non-author input
- Coverage so far: **1** real-public non-author config + 30-golden artifact
  parity + SARIF/CI paths validated; **real-config coverage not yet met** (see
  runbook targets 3/4/6).
- Open stable blockers: **0**
- Unresolved dangerous false-SAFE: **0**

Promote to stable only when target coverage is met, every blocker is closed, and
the [stable gate](./STABLE_RELEASE_GATE.md) is fully checked.

## Release verification (pre-feedback baseline)

Recorded at publish time, before external feedback — these are the author's own
post-publish checks, not user feedback entries.

- `npm view calllint dist-tags` → `next: 0.3.0-rc.0`, `preview: 0.3.0-preview.1`,
  `latest: 0.3.0-preview.0` (latest drift fixed at stable, per RELEASE_VERIFICATION §1).
- `npx calllint@next --help` → exit 0.
- `npx calllint@next scan <safe-local mcp.json>` → SAFE; `--json` verdict `SAFE`.
- `npm audit signatures` (clean install) → 1 verified registry signature +
  1 verified attestation.

## Entries

<!-- Copy the block below for each scan. Redact BEFORE pasting (no secrets, no
     private paths, no internal URLs, no customer/person/repo names that are not
     already public). Never store an un-redactable config — record the gist in
     prose instead. -->

<!--
## <id> — <host kind> — <YYYY-MM-DD>
- source: real-public | redacted-real | semi-real | author-other-project
- redaction: done | n/a (what was masked)
- command: npx calllint@next scan <redacted target> [flags]
- verdict: SAFE | REVIEW | BLOCK | UNKNOWN  (findings: <ids>)
- classification: no-action | docs | parser-edge | false-positive |
  false-negative | corpus-candidate | policy-tuning
- dangerous false-SAFE? : NO | YES (→ stable blocker)
- notes: <what happened; did the user understand the verdict and the next step>
- follow-up: <issue link / corpus-candidate id / none>
-->

## Planned validation targets (runbook)

Concrete checklist for closing this window. Each target is scanned with the
**published** `npx calllint@next` (the artifact users actually get), never a
local build, and never by executing the server.

| # | Target | Source kind | Redaction | Command | Expected artifact | Stable blocker if fails | R2.2 candidate |
|---|--------|-------------|-----------|---------|-------------------|-------------------------|----------------|
| 1 | Published-artifact parity vs 30 goldens | author-fixture (integrity only) | n/a (public fixtures) | `scan <case>/input/mcp.json --json` ×30 | verdict == `expectedVerdict`, dangerous-false-SAFE=0 | YES (corpus gate) | no |
| 2 | Official MCP filesystem README config | real-public | n/a (already placeholder paths) | `scan public-mcp-fs.json` (+`--json`,`--sarif`,`--ci`) | BLOCK, valid SARIF 2.1.0, exit 30 | only if dangerous-false-SAFE | maybe |
| 3 | Local Cursor `.cursor/mcp.json` | redacted-real (**author to supply**) | required | `scan .cursor/mcp.json` | verdict + understandable evidence | only if dangerous-false-SAFE | yes if interesting |
| 4 | Claude Desktop `claude_desktop_config.json` | redacted-real (**author to supply**) | required | `scan claude_desktop_config.json` | verdict + understandable evidence | only if dangerous-false-SAFE | yes if interesting |
| 5 | `calllint-demo-risky-mcp` SARIF dogfood | real-public | n/a | CI `--sarif` → Code Scanning | alerts appear, repo red | YES (dogfood) | no |
| 6 | One friend/3rd-party redacted config | semi-real (**non-author**) | required | `scan <redacted>` | verdict + understandable evidence | only if dangerous-false-SAFE | yes if interesting |

Targets 1, 2 and the SARIF/CI paths are **done** below. Targets 3, 4, 6 need
real configs only the maintainer can provide (redaction is mandatory and cannot
be automated safely) — they are the remaining coverage to reach 5–10 real/
semi-real inputs with ≥1 non-author input.

## Entries

### RC-A01 — published-artifact parity (release integrity) — 2026-06-17
- source: author-fixture (release-integrity validation, **not** counted as real-config coverage)
- redaction: n/a (public seed/R2.1 corpus inputs)
- command: `npx calllint@next` installed (`0.3.0-rc.0`), `scan <case>/input/mcp.json --json` across all 30 corpus cases
- verdict: all 30 match golden `expectedVerdict` (SAFE/REVIEW/BLOCK/UNKNOWN distribution as designed)
- classification: no-action
- dangerous false-SAFE? : **NO** (0 / 30)
- notes: the shipped npm artifact reproduces local goldens exactly — confirms the
  published bundle, not just the source tree, holds the verdicts. Provenance: the
  registry serves 2 attestation bundles (npm publish + SLSA v1) and the signing
  key (`SHA256:DhQ8wR5…`, no expiry) is live. A local `npm audit signatures`
  `EMISSINGSIGNATUREKEY` is a stale local key-cache artifact, not a publish-chain
  failure (registry attestation verified out-of-band).
- follow-up: none

### RC-A02 — official MCP filesystem config (public, non-author) — 2026-06-17
- source: real-public (modelcontextprotocol/servers filesystem README example)
- redaction: n/a — upstream already ships placeholder paths (`/Users/username/Desktop`)
- command: `npx calllint@next scan public-mcp-fs.json` (+ `--json`, `--sarif`, `--ci`)
- verdict: BLOCK (findings: `files.broad-path`, `supply.unpinned-package`)
- classification: no-action (correct true-positive)
- dangerous false-SAFE? : **NO**
- notes: broad desktop path + unpinned `@modelcontextprotocol/server-filesystem`
  both flagged with evidence path, impact, and a concrete fix
  (`${workspaceFolder}`, pin a version). Verdict and next step are clear from the
  report alone. Pinning + workspace-scoping the same config flips it to SAFE.
- follow-up: none

### RC-A03 — output-path validation (SARIF / CI) — 2026-06-17
- source: derived from RC-A02 public config
- redaction: n/a
- command: `--json`, `--sarif`, `--ci` on the public config (BLOCK) and a pinned/scoped variant (SAFE)
- verdict: JSON valid; SARIF valid 2.1.0 (`$schema`, `version`, driver `CallLint`, rules with `level`, results); `--ci` exit 30 on BLOCK, exit 0 on SAFE
- classification: no-action
- dangerous false-SAFE? : **NO**
- notes: GitHub Code Scanning ingestion shape confirmed on the shipped artifact.
- follow-up: full `calllint-demo-risky-mcp` Code Scanning dogfood (target 5) still
  to be confirmed in CI by the maintainer.

## Interim summary (release-integrity pass; external coverage open)

- Configs scanned via published `@next`: **31** (30 fixture-parity + 1 real-public).
- Real / semi-real **non-author** inputs: **1** of the 5–10 target — **coverage not yet met**.
- Verdict parity vs goldens: **30 / 30**.
- FP / FN / parser-edge: **0 / 0 / 0** observed.
- **Dangerous false-SAFE: 0.**
- Release integrity (install, --help, JSON, SARIF 2.1.0, CI exit codes, provenance): **all pass**.
- Open stable blockers: **0**.
- R2.2 candidates: none yet (no novel redactable real case surfaced).
- **Recommendation: DO NOT promote to stable yet.** Not because of any failure —
  every integrity and parity check passed and there are zero blockers — but
  because the protocol requires 5–10 real/semi-real configs with ≥1 non-author
  input, and only 1 real config has been validated so far. Add targets 3/4/6
  (maintainer's own redacted Cursor + Claude Desktop configs, one third-party
  config) and confirm the `calllint-demo-risky-mcp` SARIF dogfood, then re-run
  this summary. If those stay clean, `0.3.0` is cleared for `latest`.
