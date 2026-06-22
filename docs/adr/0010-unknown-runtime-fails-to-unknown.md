# ADR 0010: An unrecognized runtime fails to UNKNOWN, not SAFE

Status: Accepted (2026-06-22)

## Context

During the `0.3.0-rc.0` feedback window, scanning real third-party configs
surfaced a dangerous false-SAFE (`docs/RC_FEEDBACK_LOG.md` → RC-B04 / RC-BLK-01).

When the parser/resolver cannot recognize a server's runtime — e.g. a nested
`mcpServers.<name>.server.url`, an empty server object, or an unrecognized key
that hides a remote endpoint — `resolveRuntimeBinding`
(`packages/resolver/src/resolveRuntimeBinding.ts:96-108`) returns a binding with
`remoteUrl: undefined`, `runtimeExecutable: false`, `command: undefined`.

`computeVerdict` (`packages/risk-engine/src/computeVerdict.ts:28-30`) only routes
to UNKNOWN when `!sourceKnown && (remoteUrl || runtimeExecutable)`. With all three
falsy the guard is skipped, no findings exist, and the function falls through to
`return "SAFE"` (line 37).

Result (reproduced on published `@next` and local HEAD):

| input | verdict | correct? |
|-------|---------|----------|
| `{"mcpServers":{"x":{"url":"https://h/mcp"}}}` | UNKNOWN | ✓ |
| `{"mcpServers":{"x":{"server":{"url":"https://h/mcp"}}}}` | SAFE | ✗ |
| `{"mcpServers":{"x":{}}}` | SAFE | ✗ |
| `{"mcpServers":{"x":{"typo":"https://evil/mcp"}}}` | SAFE | ✗ |

A config CallLint understood *least* received the *safest* verdict, with
`autonomousUse: allow` and `sandbox: none`. This violates Product Principle #2
("UNKNOWN is not SAFE") and the safety floor ("Never mark an unknown source as
SAFE").

## Decision (proposed)

`SAFE` must require a **positively recognized, inspectable source with no
findings** — not merely the *absence* of findings. When a server entry has no
recognized runtime (no `url`, no `command`, no resolvable package/script) and no
findings, the verdict is **UNKNOWN**.

Concretely, extend the UNKNOWN guard so that a binding which is neither a
recognized remote nor a recognized executable nor a known source resolves to
UNKNOWN. Equivalent framing: SAFE is only reachable when `sourceKnown` is true.

### Addendum (2026-06-22): a config with no servers is UNKNOWN, not SAFE

The adversarial completeness sweep that verified the fix surfaced a second,
lower-severity instance of the same principle: a config that parses but contains
**zero servers** — an empty `{"mcpServers":{}}` or a wrong-schema file like
`{"foo":"bar"}` — aggregated to headline **SAFE** with zero reports
(`packages/core/src/scanConfig.ts`, `mostSevereVerdict([])` initializes to SAFE).
Nothing was examined, yet the user sees a green "no blockers observed."

This is **not** a dangerous false-SAFE by the corpus definition (no dangerous
*server* is mislabeled — there are no servers), so it is not the RC-BLK-01 hard
blocker. But it is the same failing-open principle: "we examined nothing" must not
read as "it's fine." Decision: when `reports.length === 0`, the config-level
verdict is **UNKNOWN** ("insufficient evidence"), handled in `aggregate()` in
`scanConfig.ts`. `mostSevereVerdict` is left unchanged (its SAFE-initialized fold
is correct for the non-empty case).

## Consequences / required work (none done yet)

- Parser: decide how nested/aliased `server.url` is normalized — recognize it (so
  it becomes a proper remote → UNKNOWN with `supply.unknown-remote`) or explicitly
  treat unrecognized shapes as unknown sources. Either way it must not be SAFE.
- Regression coverage (CLAUDE.md rule): a **positive** fixture (recognized SAFE
  source still SAFE), a **negative** fixture (unrecognized shape → UNKNOWN), a unit
  test on `computeVerdict`, and a **corpus** case (RC-B04 minimised).
- Re-run `pnpm test`, `pnpm typecheck`, `corpus:test`, and re-scan RC-B01..B10 on a
  fresh build to confirm dangerous false-SAFE returns to 0.
- This is a verdict-behaviour change (some previously-SAFE unrecognized configs
  become UNKNOWN). It tightens, never loosens, so it is safe-direction — but it is
  a `ScanReport` verdict change for those inputs and is recorded here per the
  "breaking change requires an ADR" rule.

## Reason

Failing open is the one failure mode a pre-run security linter cannot have. The
whole product premise is that UNKNOWN is a distinct, non-benign state; letting an
unparsed entry collapse into SAFE erases that premise exactly where it matters
most — on inputs the tool didn't understand.

## Status note

Accepted 2026-06-22. Implemented in `packages/risk-engine/src/computeVerdict.ts`
(SAFE now requires `binding.sourceKnown`), with regression coverage: golden
fixtures `unknown-empty-server.json` (→ UNKNOWN) and the existing SAFE goldens
(unchanged), a `computeVerdict` unit test for the no-url/no-command unknown shape,
and corpus case `C031-unknown-unrecognized-shape` (`thisCaseMustNeverBeSafe`).
