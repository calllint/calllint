# Phase 2.6 — Signoff: the install action is captured, and the capture was executed

**Status: SIGNED OFF 2026-08-28.** Phase 2.6 (Sentinel → Search → Hook) shipped on
2026-07-27 via PRs #226–#228 and then sat for a month with **no signoff artifact**, unlike
Phase 2.5 (`artifacts/phase-2.5-signoff/`). This document closes that gap and, with it, the
ADR 0055 §7 hard-block on Phase 3+.

## Why this artifact exists at all

ADR 0055 §7 states:

> Phase 3+ does **not** start until Phase 2.6 ships **and** a real agent-install interception
> is exercised end-to-end.

The *ships* half was satisfied on 2026-07-27. The *exercised* half had **no recorded
evidence** — and the absence was itself invisible, because nothing reads a missing directory.
So the gate on the entire Phase 3+ route was in an indeterminate state: not obviously open,
not demonstrably closed. That is the same fault class this repo keeps finding
(`maps/guards.md`): a condition whose satisfaction has no reader.

**Passing invariant tests were not enough to sign this off.** `preflight-hook-non-blocking.
invariants.test.ts` is 28/28 green, but its subject is the hook's *shape* — that it never
exits 2, never emits `permissionDecision`, never asserts SAFE. A hook can satisfy every
shape invariant and still never fire. So each leg below was **executed** with a real payload
and its output recorded verbatim.

## Landing record

| PR | commit | leg |
|---|---|---|
| #226 | `e50a8b8` | Sentinel — `calllint_guard_external_tools` (ADR 0055 §3) |
| #227 | `b7c7bfd` | Safe Search — `calllint_search_agent_tools` (ADR 0055 §4) |
| #228 | `95587aa` | Install Hook — capture + re-adjudicate via Trust Gateway (ADR 0055 §4) |

## Leg 1 — Install Hook: executed, both hosts, with negative controls

Run against `plugins/calllint/hooks/` on 2026-08-28, Node v20.20.2, by piping real
`PreToolUse` JSON to the shipped entrypoints.

| case | host | input | result |
|---|---|---|---|
| recommend fires | Claude | `Write` → `/proj/.mcp.json` | `systemMessage` + `hookSpecificOutput.additionalContext`, **EXIT 0** |
| stays silent | Claude | `Write` → `/proj/README.md` | no output, **EXIT 0** |
| recommend fires | Cursor | `Write` → `/proj/.cursor/mcp.json` | `user_message` + `agent_message`, **EXIT 0** |
| stays silent | Cursor | `Write` → `/proj/notes.txt` | no output, **EXIT 0** |
| malformed stdin | Claude | `not json at all` | no output, **EXIT 0** |
| empty stdin | Claude | `` (empty) | no output, **EXIT 0** |

Three things this measurement confirms that the invariant suite cannot:

1. **The interception really happens** — a config-surface write produces a recommendation,
   an unrelated write produces nothing. Both are observable behaviours, not assertions
   about source text.
2. **The two hosts emit different envelopes**, as they must. Claude gets
   `systemMessage` / `hookSpecificOutput`; Cursor gets `user_message` / `agent_message`.
   Cursor ignores unknown top-level fields, so shipping Claude's envelope to Cursor would be
   a **silent** drop — the failure mode recorded in the Cursor blocks of the invariant suite.
3. **Non-blocking holds on the error paths too.** Malformed and empty stdin both exit 0
   silently. A preflight recommender that breaks the agent loop on bad input is worse than
   one that never fires.

The recommendation text routes to the human-in-the-loop Trust Gateway
(`calllint trust prepare` → review → `calllint trust apply --approve <digest>`), and states
inline that it does not block the edit and that CallLint never executes what it judges.

## Leg 2 — Sentinel: executed over the real MCP wire, inside its byte ceiling

Driven as a real JSON-RPC session against `packages/calllint-mcp/dist/index.js`
(`initialize` → `notifications/initialized` → `tools/call`), not via a unit harness.

- `calllint_guard_external_tools` returns `present: true`, the four verdict labels,
  `unknownIsNeverSafe: true`, a tool catalogue, and `"This tool reports presence only. It
  changes no verdict and performs no action."`
- **Payload measured at 1097 bytes against ADR 0055 §3's 2500-byte ceiling.** Recorded as a
  number, because §3 is explicit that if honest presence cannot fit, the answer is to cut
  copy, never to raise the ceiling silently. There is 56% headroom.

## Leg 3 — Safe Search: executed, and proven NON-VACUOUS

The first query (`"filesystem"`) returned `matchCount: 0`. **A zero from a search is not
evidence the search works** — it is equally consistent with a broken index, a wrong key
form, or a dead code path. So the measurement was repeated with a term known to exist in
`packages/calllint-mcp/src/data/lookup-index.json` (149 entries).

`query: "docs"` returned real records, each carrying:

- `canonicalName`, e.g. `mcp-registry/ai.auteng-docs`
- `verdict: "REVIEW"` + `verdictLabel: "Review required"`
- a full `artifactDigest` (`sha256:836cd562…`)
- `observedAt: "2026-08-27T11:02:09.000Z"` — **the #349 trust-ingest run**, so the search is
  serving the live cohort, not a fixture
- `installability: "REVIEW_REQUIRED"`, plus `installUrl` / `contractUrl`

Determinism holds (lexical lookup, no LLM, per ADR 0055 §4), and the note shipped with every
response states that a result is an observation at a digest and time — *not* a certification —
that the URLs authorize nothing because a local prepare always re-decides, and that a resource
with no Trust Page simply does not appear: **absence is not a verdict.**

## What this signoff does NOT claim

- It does **not** claim adoption. Every leg here was exercised by the maintainer. The usage
  report's first 4 preflights / 1 active installation are a self-test floor
  (see `NEW19-21_OPEN_ITEMS.md` O-1), and nothing in Phase 2.6 changes that.
- It does **not** claim the two remaining deferred tools shipped.
  `compare_tool_authority` and `check_tool_update` are still absent; two of the four
  ADR 0055 §6 deferred tools *did* ship, which is recorded as an amendment on §6 itself.
- It does **not** claim the hook fires inside a real third-party host's live install flow.
  What is measured is the shipped hook's behaviour on the exact payload shape those hosts
  send. The separate `claude` 2.1.195 install probe
  (`scripts/probe-claude-plugin-install.mjs`, ADR 0007) covers the marketplace-install path.

## Consequence

**ADR 0055 §7's hard block on Phase 3+ is satisfied.** Phase 2.6 shipped (#226–#228) and the
interception is exercised end-to-end with negative controls on every leg. Phase 3+ has no
ADR defining it, so the next step there is a scoping decision, not a build — but it is no
longer *gated*.
