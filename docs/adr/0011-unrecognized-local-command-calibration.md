# ADR 0011: Treatment of an unrecognized local command (RC-OBS-02)

Status: Accepted — Direction 2 (recorded 2026-06-23 as Proposed — deferred; **accepted and implemented 2026-06-25**)

## Context

While adversarially verifying the RC-BLK-01 fix (ADR 0010) during the
`0.3.0-rc.0` window, the completeness sweep surfaced a separate, lower-severity
observation, logged as **RC-OBS-02** in `docs/RC_FEEDBACK_LOG.md` and now
baselined as corpus case **C035-safe-game-assistant-local-node**.

A server launched by a local command that is *not* a recognized package runner,
shell, or remote — e.g. a bare `node /path/to/server.js`, or
`{"command":"/opt/unknown/bin/thing"}` — resolves to **SAFE** with no findings.

The mechanism is in `resolveRuntimeBinding`
(`packages/resolver/src/resolveRuntimeBinding.ts:96-108`, the node/python/docker/
other-local-command branch):

```js
sourceKnown: Boolean(command),     // line 105
runtimeExecutable: Boolean(command),
```

Any non-empty command string sets `sourceKnown: true`. Per ADR 0010,
`computeVerdict` reaches SAFE only when `sourceKnown` is true — which it is here —
so a bare local executable with no broad path, secret, remote, or supply-chain
finding aggregates to SAFE / `autonomousUse: allow` / `sandbox: none`.

Observed (current engine, reproduced via C035 and B06):

| input | verdict |
|-------|---------|
| `{"mcpServers":{"x":{"command":"node","args":["./server.js"]}}}` | SAFE |
| `{"mcpServers":{"x":{"command":"/opt/unknown/bin/thing"}}}` | SAFE |

## Why this is NOT RC-BLK-01 and NOT a dangerous false-SAFE

RC-BLK-01 (ADR 0010) was about a *hidden/unrecognized* source — the config shape
concealed a runtime CallLint could not see, so SAFE was a lie about what was
present. RC-OBS-02 is different: the source **is** observable. The command string
and script path are right there in the config; nothing is hidden. By the resolver's
own definition (`sourceKnown` = "we can see the source"), this is a *known* source,
so it is **not** a dangerous false-SAFE under the corpus/protocol definition. The
RC-BLK-01 fix deliberately did **not** change the resolver (its diff is empty), so
this behaviour predates that window.

It is, instead, a **calibration question**: should "runs an arbitrary local
executable whose contents CallLint has not inspected" be surfaced as REVIEW with a
finding like `exec.unverified-local-source` ("runs arbitrary local code; the
binary/script is not independently verifiable"), rather than SAFE?

## Decision (Accepted 2026-06-25 — Direction 2)

**Direction 2 is adopted.** A new detector emits `exec.unverified-local-source`
(REVIEW, medium severity, EXEC, S2, non-blocker, OBSERVED) when the runtime is a
local executable that is neither a recognized package (with a parsed package name)
nor a docker image nor a remote. SAFE stays reachable only for recognized,
inspectable sources. The two candidate directions originally recorded were:

1. **Keep SAFE (status quo), document the limit.** A bare local command is
   observable and low-signal; treating every `node dist/server.js` as REVIEW would
   re-verdict a large number of entirely legitimate configs and erode the
   usefulness of SAFE. The limitation is recorded on C035 and here.
2. **Introduce a REVIEW finding for unrecognized local executables.** A new
   detector emits `exec.unverified-local-source` (REVIEW) when the
   runtime is a local executable that is neither a recognized package nor a
   recognized interpreter-with-known-script. SAFE stays reachable only for
   recognized, inspectable sources. ← **chosen**

The deciding rationale: CallLint is a *pre-flight* check for agent tools. An agent
about to autonomously run a local script CallLint never inspected should see a
confirmation prompt (REVIEW), not a green SAFE — SAFE meaning "we identified the
source and found no blockers", not "we saw a command string". The alert-fatigue
risk is mitigated by a narrow firing condition (only bare local executables, never
recognized packages/images/remotes/shells) and an explicit `falsePositiveNote`
that frames the finding as "source not independently verifiable", not "malicious".

### Firing condition (exact)

The detector fires iff: `binding.sourceKnown` AND `binding.runtimeExecutable` AND
`binding.runtimeKind !== "docker"` AND `!binding.packageName`. This excludes
recognized package runners (npx/uvx with a parsed package → `packageName` set),
docker images, remotes (`runtimeExecutable` false), and shells (`sourceKnown`
false — already UNKNOWN, the dangerous-command detector's surface).

## Consequences / required work — DONE (2026-06-25)

Implemented:

- New detector `packages/static-analyzer/src/detectors/unverifiedLocalSource.ts`
  emitting finding id `exec.unverified-local-source`, registered in `DETECTORS` and
  exported from the analyzer index. **Positive** fixture
  `golden/review-unverified-local-source.json` (bare `node ./dist/server.js` →
  REVIEW, EXEC) and **negative** fixture `golden/safe-time.json` (recognized pinned
  `npx @scope/pkg@1.0.0` → SAFE, no finding), plus unit tests in
  `packages/static-analyzer/test/detectors.test.ts` covering the positive and four
  negatives (recognized package, docker image, remote, shell).
- Corpus impact pass: **C035 and C040 flipped SAFE → REVIEW** (dirs renamed
  `C035-review-game-assistant-local-node`, `C040-review-postgres-local-python`);
  their four files + `index.json` updated. No other case changed verdict — C032
  (already REVIEW via secrets) and C036 (already UNKNOWN) gained the finding under
  `allowExtraFindings: true` without a verdict change. C040 keeps `secrets.env-key`
  forbidden, so its connection-string true-negative is preserved. UNKNOWN ratio
  unchanged at 12.5% (the flips are SAFE → REVIEW, not toward UNKNOWN), well under
  the ≤ 15% floor.
- `pnpm test`, `pnpm typecheck`, `corpus:test:r2-final` all green.

## Related

- ADR 0010 (the hidden-source RC-BLK-01 fix this is explicitly *not*).
- `docs/RC_FEEDBACK_LOG.md` → RC-OBS-02, RC-B06.
- Corpus case `C035-safe-game-assistant-local-node` (the SAFE baseline this ADR
  governs).
- ADR 0012 (a sibling documented-limitation calibration question).
