# ADR 0011: Treatment of an unrecognized local command (RC-OBS-02)

Status: Proposed — deferred (recorded 2026-06-23; no code change yet)

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

## Decision (proposed — NOT yet accepted)

Record the question; do not change the verdict yet. Two candidate directions, to
be decided in a follow-up:

1. **Keep SAFE (status quo), document the limit.** A bare local command is
   observable and low-signal; treating every `node dist/server.js` as REVIEW would
   re-verdict a large number of entirely legitimate configs and erode the
   usefulness of SAFE. The limitation is recorded on C035 and here.
2. **Introduce a REVIEW finding for unrecognized local executables.** A new
   detector emits `exec.unverified-local-source` (REVIEW, S-class TBD) when the
   runtime is a local executable that is neither a recognized package nor a
   recognized interpreter-with-known-script. SAFE stays reachable only for
   recognized, inspectable sources.

This ADR does not pick (1) or (2). It fixes the **scope**: whichever is chosen is
a deliberate, fixture-backed change, not a silent drift.

## Why deferred

Direction (2) is a verdict-behaviour change that would re-verdict many legitimate
`node`/`python` local-script configs from SAFE to REVIEW — a broad blast radius
that the contract (`Any breaking change to ScanReport ... requires an ADR`; "stable
fixes bugs; it does not widen surface") says must be decided deliberately, with
positive + negative fixtures and a corpus impact pass, never rushed. Stable `0.3.0`
shipped with this behaviour; changing it is an R2.2/R3-era detector decision, not a
bug fix.

## Consequences / required work (none done yet)

If direction (2) is later accepted:

- New detector + finding id `exec.unverified-local-source`, with a **positive** and
  a **negative** fixture and a unit test (CLAUDE.md rule).
- Corpus impact pass: C035 (and any other bare-local-command case) flips SAFE →
  REVIEW; `R2_CALIBRATION.md` and the `thisCaseMustNeverBeSafe` posture for C035 are
  revisited; the UNKNOWN/REVIEW ratios are re-measured against the ≤ 15% UNKNOWN
  floor.
- Re-run `pnpm test`, `pnpm typecheck`, `corpus:test:r2-final`.

If direction (1) is confirmed: no code change; this ADR is marked Accepted as
"documented limitation," and C035 remains the SAFE baseline.

## Reason

The honest position today is that this is a known, observable-source SAFE — not a
hidden-source false-SAFE. That distinction is exactly what separates RC-OBS-02 from
RC-BLK-01, and conflating them would either (a) overstate a real risk or (b)
trivialise the genuine RC-BLK-01 class. Recording the question with its anchor case
keeps the decision visible without shipping an under-considered verdict change.

## Related

- ADR 0010 (the hidden-source RC-BLK-01 fix this is explicitly *not*).
- `docs/RC_FEEDBACK_LOG.md` → RC-OBS-02, RC-B06.
- Corpus case `C035-safe-game-assistant-local-node` (the SAFE baseline this ADR
  governs).
- ADR 0012 (a sibling documented-limitation calibration question).
