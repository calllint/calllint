# RC feedback log — 0.3.0-rc.0

Append-only record of redacted validation results for the `0.3.0-rc.0` feedback
window. Process, redaction rules, classification, and the stable-blocking
criteria live in [RC_FEEDBACK_PROTOCOL.md](./RC_FEEDBACK_PROTOCOL.md). This file
is only the log.

Install under test: `npx calllint@next` (now `0.3.0-rc.1`, published 2026-06-22).

## Window status

- RC version: **`0.3.0-rc.1`** (published to the `next` dist-tag, signed
  provenance via OIDC Trusted Publishing). Supersedes `0.3.0-rc.0`, which carried
  the RC-BLK-01 bug.
- Target coverage: 5–10 real / semi-real MCP configs · 3–5 CI / SARIF runs ·
  ≥ 1 non-author input
- Coverage so far: **11** real-public non-author configs (RC-A02 + B01–B10) +
  30-golden artifact parity + SARIF/CI paths validated; **real-config coverage
  target met** (≥1 non-author input satisfied many times over).
- Open stable blockers: **0** — RC-BLK-01 (dangerous false-SAFE) was found in the
  rc.0 window and is **resolved, regression-locked, merged to `main`, and
  re-validated on the published `0.3.0-rc.1` artifact** (B04 + 4 synthetic shapes
  + B01–B10 all correct on `npx calllint@next` = rc.1; dangerous false-SAFE = 0).
- Unresolved dangerous false-SAFE: **0** (on the published rc.1 artifact and in the
  corpus).

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

### RC-B01..B10 — third-party public-repo configs (non-author input) — 2026-06-22

Ten MCP configs **committed by other people** to public GitHub repos, harvested
with `gh` (commit SHA recorded per file for provenance), redacted per the rules
below, and scanned with the **published** `npx calllint@next` (`0.3.0-rc.0`).
These are non-author *inputs*, scanned by the maintainer — **not** independent
tester feedback. Redaction was shape-preserving (paths keep depth, packages keep
pin state, key names intact) so verdicts are unchanged by redaction.

Provenance (repo · path · commit):
- B01 `un-pany/v3-admin-vite` · `.cursor/mcp.json` · `28fb401`
- B02 `c15t/c15t` · `.cursor/mcp.json` · `229310d`
- B03 `aperoc/toolkami` · `.cursor/mcp.json` · `2fddfb3`
- B04 `phumblot-gs/story-gs-react` · `.cursor/mcp.json` · `264c2ce`
- B05 `theailanguage/terminal_server` · `claude_desktop_config.json` · `4c0130a`
- B06 `JacquesGariepy/game-assistant-mcp` · `claude_desktop_config.json` · `27df1b5`
- B07 `glaucia86/weather-mcp-server` · `claude_desktop_config.json.text` · `c688791`
- B08 `grantcromwell/cromwell-kit` · `.mcp.json` · `32da36e`
- B09 `WinshipWheatley/openclaw-eyes` · `.mcp.json` · `7ca644d`
- B10 `uengine-oss/process-gpt-completion` · `mcp.json` · `2c80ede`

| id | host shape | redaction | verdict | findings | dangerous false-SAFE? | class |
|----|-----------|-----------|---------|----------|-----------------------|-------|
| B01 | cursor, local SSE `url` | n/a (localhost) | UNKNOWN | `supply.unknown-remote` | NO | no-action |
| B02 | cursor, public remote `url` (vercel) | n/a (public) | UNKNOWN | `supply.unknown-remote` | NO | no-action |
| B03 | cursor, remote `url` + `headers.API_KEY` | n/a (author placeholder `"value"`) | UNKNOWN | `supply.unknown-remote` | NO | no-action |
| B04 | cursor, **nested `server.url`** | masked internal host | **SAFE** | (none) | **YES → BLOCKER** | **false-negative** |
| B05 | claude, multi-block commented JSON (uv + docker `-v`) | masked home path | parse error, `--ci` exit 3 | n/a | NO (fails closed) | parser-edge |
| B06 | claude, local `node` script | masked home path | SAFE | (none) | review (see notes) | false-negative? |
| B07 | claude, local `node` + DB/API creds in `env` | author placeholders | REVIEW | `secrets.env-key` | NO | no-action |
| B08 | mcp, three unpinned `npx` pkgs (+ nested-key typo) | masked volume path | REVIEW | `supply.unpinned-package` ×3 | NO | no-action |
| B09 | mcp, `server-filesystem` broad paths | n/a (already generic) | BLOCK | `files.broad-path`, `supply.unpinned-package` | NO | no-action |
| B10 | mcp, **90 servers** (npx/uvx/python), one carried a **real committed secret** | **`ODOO_PASSWORD` + email + employer host REDACTED** before storage | UNKNOWN (mix of REVIEW/SAFE per server) | many `unpinned-package`, one SAFE server | see B04 root cause | corpus-candidate |

Detail on the entries that matter:

- **B04 — dangerous false-SAFE (STABLE BLOCKER).** This config nests the endpoint
  one level deeper than the recognized shape:
  `mcpServers.<name>.server.url` instead of `mcpServers.<name>.url`. CallLint
  returned **SAFE · "S0 Metadata only" · confidence high · reproducibility HIGH ·
  0 findings · `autonomousUse: allow` · `sandbox: none`** — for a remote server it
  could not actually see. Compare B01/B02/B03, where the URL sits at the
  recognized depth and correctly resolve to UNKNOWN. A config CallLint understood
  *less* got the *safer* verdict. This violates Product Principle #2 ("UNKNOWN is
  not SAFE") and the safety floor ("Never mark an unknown source as SAFE"). See
  blocker **RC-BLK-01** below for the synthetic minimisation and root cause.
- **B06 — likely under-call (recorded, not the blocker).** A bare local `node`
  script with a recognized `command` is `sourceKnown:true`, so it resolves SAFE
  with no findings. This is *not* a dangerous false-SAFE by the resolver logic
  (the path is observable), but "runs an arbitrary local script → SAFE, allow,
  no sandbox" is a calibration question worth an issue. Classified
  false-negative? pending; **not** a stable blocker on its own.
- **B05 — correct fail-closed.** A reference file with `//` comments and two JSON
  objects is invalid JSON; CallLint reports a parse error and `--ci` exits 3
  (error), never SAFE. Good.
- **B10 — secret hygiene.** One of 90 servers had a live-looking
  `ODOO_PASSWORD`, a real username/email, and an employer subdomain committed in
  a public repo. Per redaction rules the value + identity were replaced with
  `REDACTED`/`example.*` **before** the file was stored or scanned; the live
  value was never written to this log or the corpus. Good R2.2 candidate (90-way
  multi-server stress shape) once fully sanitised.

### RC-BLK-01 — dangerous false-SAFE on unrecognized runtime shape — 2026-06-22 — **RESOLVED**

- severity: was a **stable blocker** (dangerous false-SAFE; RC_FEEDBACK_PROTOCOL.md
  "Blockers for stable"). **Resolved 2026-06-22** on branch `fix/rc-blk-01-unknown-runtime`.
- discovered via: B04 (real non-author config), confirmed with synthetic minimisation
- synthetic evidence (published `@next`):
  | input | verdict |
  |-------|---------|
  | `{"mcpServers":{"x":{"url":"https://h/mcp"}}}` (recognized) | UNKNOWN ✓ |
  | `{"mcpServers":{"x":{"server":{"url":"https://h/mcp"}}}}` (nested, = B04) | **SAFE ✗** |
  | `{"mcpServers":{"x":{}}}` (empty server) | **SAFE ✗** |
  | `{"mcpServers":{"x":{"typo":"https://evil/mcp"}}}` (unknown key → hidden remote) | **SAFE ✗** |
- root cause: `packages/risk-engine/src/computeVerdict.ts` lines 28–30. The UNKNOWN
  guard is `!sourceKnown && (remoteUrl || runtimeExecutable)`. When the parser
  cannot recognize a server's runtime, the resolver
  (`packages/resolver/src/resolveRuntimeBinding.ts` lines 96–108) returns
  `remoteUrl: undefined`, `runtimeExecutable: false`, `command: undefined` — so
  the guard is skipped, there are no findings, and `computeVerdict` falls through
  to `return "SAFE"` (line 37). An entry CallLint failed to understand is scored
  as benign metadata.
- impact: a typo'd or non-standard key that hides a remote endpoint (incl. an
  attacker URL) resolves to SAFE with `autonomousUse: allow`, `sandbox: none`.
- fix applied (ADR 0010, Accepted): SAFE now requires a positively recognized
  source. `packages/risk-engine/src/computeVerdict.ts` gates the final SAFE on
  `binding.sourceKnown` (any unparsed/unrecognized shape → UNKNOWN); a follow-up in
  `packages/core/src/scanConfig.ts` makes a config with **zero servers** (empty
  `mcpServers` or wrong-schema file) aggregate to UNKNOWN, not SAFE.
- regression lock (proven to fail on revert): risk-engine unit test "unrecognized
  shape (no url, no command) is UNKNOWN" (the prior unknown-source test set
  `remoteUrl` and so passed under the old buggy guard — it did not lock this bug;
  the new test does), core unit test "a config with no servers is UNKNOWN", golden
  `unknown-unrecognized-shape.json` (asserted UNKNOWN by the running engine via
  GOLDEN_CASES), and corpus case `C031-unknown-unrecognized-shape`
  (`thisCaseMustNeverBeSafe`, fails the release gate if it ever returns SAFE).
- verification (fresh build): typecheck clean; **193 tests pass** (×2 runs, no
  flake); corpus **31 cases, 0 dangerous false-SAFE**, UNKNOWN ratio 12.9% (≤15%),
  R2.1 thresholds met; B04 → UNKNOWN; the 4 synthetic minimisation cases → UNKNOWN;
  B01–B10 re-scanned on the fresh binary all verdicts as expected (only B04 changed,
  SAFE→UNKNOWN); the 30 pre-existing corpus verdicts unchanged.
- scope note (honest): "resolved" = the *verdict engine* no longer fails an
  unrecognized/empty shape open to SAFE. The *parser* still does not positively
  recognize a nested/aliased `server.url` as a remote — it reaches UNKNOWN via the
  `sourceKnown=false` fallthrough, which is the safe direction but not full remote
  detection (recorded in ADR 0010 and C031 knownLimitations). See RC-OBS-02 for a
  separate, pre-existing local-command gap that this fix deliberately did **not**
  change.
- classification: false-negative (dangerous) — resolved
- dangerous false-SAFE? : **was YES — now NO** (B04 and all four synthetic shapes
  resolve to UNKNOWN on the fixed build; corpus dangerous-false-SAFE = 0).
- follow-up: ADR 0010 Accepted; golden + corpus C031 in place. Parser-level
  recognition of nested/aliased `server.url` (so it becomes a recognized remote with
  `supply.unknown-remote` rather than a fallthrough UNKNOWN) is a non-blocking R2.2
  enhancement, not required for this resolution.

- follow-up (process): the RC window's dangerous-false-SAFE blocker is **closed**.
  Stable promotion remains gated on the full stable gate and the outward release
  steps (merge, tag `0.3.0-rc.1`, re-scan on the published artifact) — see the
  handoff in the run summary.

### RC-OBS-02 — local `command` source treated as SAFE (pre-existing, non-blocking) — 2026-06-22

- found by: adversarial completeness sweep while verifying the RC-BLK-01 fix.
- observation: a server with a local `command` that is not a recognized package
  runner — e.g. `{"command":"./my-local-binary","args":["--serve"]}` or
  `{"command":"/opt/unknown/bin/thing"}` — resolves to **SAFE** with no findings.
  The resolver sets `sourceKnown: Boolean(command)`
  (`packages/resolver/src/resolveRuntimeBinding.ts:107`), so the source is treated
  as "observable" and SAFE is reachable.
- why this is **not** RC-BLK-01 and **not** a dangerous false-SAFE (corpus sense):
  the source *is* visible (the command string is right there), so it is not an
  unknown source by the resolver's definition; and no *dangerous* server is being
  mislabeled — this is the same family as B06 (a plain local script). The resolver
  was **not** changed by the RC-BLK-01 fix (its diff is empty), so this behaviour
  **predates** this window.
- classification: false-negative? (calibration) — **recorded, non-blocking**.
- dangerous false-SAFE? : **NO** (by the corpus/protocol definition).
- follow-up: a detector-calibration question (should an unrecognized local
  executable be REVIEW with a "source not verifiable / runs arbitrary local code"
  finding?). This touches detector tuning and would re-verdict many legitimate
  `node dist/server.js` configs, so it needs its own ADR/issue and is explicitly
  out of scope for the RC-BLK-01 fix. Tracked here + with B06 as an R2.2 calibration
  candidate.

## Interim summary (real non-author coverage met; **RC-BLK-01 resolved** on a fix branch)

- Configs scanned via published `@next`: **41** (30 fixture-parity + 1 RC-A02
  public + 10 RC-B real non-author + synthetic minimisation cases). The 10 RC-B
  configs + 4 synthetic cases were then **re-scanned on the fixed local build** to
  confirm the fix.
- Real / semi-real **non-author** inputs: **11** (RC-A02 + B01–B10) of the 5–10
  target — **coverage target met**.
- Verdict parity vs goldens: **30 / 30** unchanged; **+1** new golden
  (`unknown-unrecognized-shape.json` → UNKNOWN).
- Host-shape coverage added: cursor SSE/remote, claude local-script, docker `-v`,
  commented multi-block JSON, unpinned npx, broad-path filesystem, 90-server
  stress, **nested `server.url`**.
- FP / FN / parser-edge observed: **0 FP / 2 FN / 1 parser-edge** —
  - FN: **B04 = dangerous false-SAFE (RC-BLK-01) — RESOLVED** (now UNKNOWN, with
    regression lock); RC-OBS-02 local-command under-call (pre-existing,
    non-blocking, R2.2 calibration candidate; same family as B06).
  - parser-edge: B05 commented multi-block JSON (correctly fails closed).
- **Dangerous false-SAFE: 0** on the fixed build (was 1; B04 + 4 synthetic shapes
  now UNKNOWN; corpus 31 cases report 0).
- Release integrity (install, --help, JSON, SARIF 2.1.0, CI exit codes, provenance): **all still pass**.
- Open stable blockers: **0** (RC-BLK-01 closed). *Caveat: the fix currently lives
  on branch `fix/rc-blk-01-unknown-runtime` and the published `@next` artifact still
  has the bug — stable promotion requires merging, cutting `0.3.0-rc.1`, and
  re-confirming on the published artifact.*
- R2.2 candidates: B10 (90-server multi-runtime stress, once fully sanitised);
  RC-OBS-02 / B06 (local-command calibration).
- **Recommendation: a new RC is required before stable.** The dangerous false-SAFE
  hard blocker is closed and regression-locked locally, but the artifact users
  currently get (`@next` = `0.3.0-rc.0`) still contains the bug. Promote by:
  merge the fix → publish `0.3.0-rc.1` to `next` → re-scan B04 + the synthetic
  cases on the **published** `rc.1` artifact → confirm dangerous false-SAFE = 0 →
  then run the stable gate. Do **not** ship `0.3.0` directly from `rc.0`.
