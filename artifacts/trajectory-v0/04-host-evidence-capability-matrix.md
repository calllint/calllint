# 04 — Host evidence capability matrix

Answers T0 questions 8, 9, and 10 for the one candidate Host that is actually wired: **Claude Code**.
This chapter satisfies the Exit Gate requirement *"at least one candidate Host's evidence gap is
clear"*.

**Status: Q8 `PARTIAL` · Q9 non-blocking, structurally · Q10 `CONTRADICTED` — completeness is
guaranteed *not* to hold.**

Q10 is the highest-value measurement in this audit. "No Host emits complete trajectory facts" has
until now been an assertion in planning prose. It is now bound to a matcher string and three named
failure paths in committed code.

## Q8 — which events can the Hook observe?

**One event, behind one matcher.** The registration is 15 lines and is quoted in full because every
line of it bounds the answer:

[plugins/calllint/hooks/hooks.json](../../plugins/calllint/hooks/hooks.json) —

```json
{ "hooks": { "PreToolUse": [ {
      "matcher": "Write|Edit|MultiEdit",
      "hooks": [ { "type": "command",
                   "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/preflight.mjs\"" } ]
} ] } }
```

| Claim | Binding | Measured |
| --- | --- | --- |
| Exactly one event type is registered | [hooks.json:3](../../plugins/calllint/hooks/hooks.json#L3) | `PreToolUse`. No `PostToolUse`, no `SessionStart`, no `Stop`, no `UserPromptSubmit` |
| The matcher admits three tools | [hooks.json:5](../../plugins/calllint/hooks/hooks.json#L5) | `Write\|Edit\|MultiEdit` |

**What therefore never reaches CallLint, ever:** `Bash`, `Read`, `WebFetch`, `WebSearch`, `Glob`,
`Grep`, `Task`, and **every MCP tool call**. Not "is not currently handled" — the matcher is the
host's filter, so the process is never started for those calls. A trajectory is a sequence of
actions; the observable subset is three file-mutating tools.

The gap is not marginal for this use case. `Bash` and the MCP tools are where an agent takes
consequential action; they are exactly the calls a trajectory model would care about, and they are
exactly the ones the current registration cannot see.

## Q9 — is the Hook blocking?

**No, and it is locked non-blocking in three independent places.** This is a structural invariant,
not a default that a config change could flip:

| Lock | Binding | Measured |
| --- | --- | --- |
| ADR | [adrs/0051-preflight-hook-boundary.md:41-46](../../adrs/0051-preflight-hook-boundary.md#L41-L46) | *"preflight recommend / display-only, non-blocking … does **not** veto, cancel, or gate the pending tool call … the hook never returns a non-zero 'deny'"* |
| Code — the success path | [preflight.mjs:56](../../plugins/calllint/hooks/preflight.mjs#L56) | `process.exit(0) // recommend-only, never blocking (ADR 0051)` |
| Payload shape | [preflight.mjs:11-12](../../plugins/calllint/hooks/preflight.mjs#L11-L12) | *"Never exits 2 (which would block the call) and never emits `permissionDecision`"* — the field the host would read to deny is deliberately never produced |

The third lock is the one that would be easiest to lose accidentally, and it is the one that
matters: exit code 0 alone would not be enough if the payload carried `permissionDecision`. The
absence of that field is what makes the hook incapable of blocking rather than merely declining to.

ADR 0042 froze runtime blocking as design-only behind an H3 necessity test that has not been met
([adrs/0051…:25-29](../../adrs/0051-preflight-hook-boundary.md#L25-L29)). So "make the hook
blocking" is not a code change — it is a gated product decision with a prior ADR standing against it.

## Q10 — is the Hook complete?

**`CONTRADICTED`.** The repo does not merely fail to guarantee completeness; the code guarantees
the opposite, on three independent axes. And the failure mode is the same in all three: **a dropped
event is byte-for-byte indistinguishable from "there was nothing to report."**

### Gap 1 — the tool surface (3 of many)

From Q8: the matcher admits three tools. Everything else is invisible.

### Gap 2 — the path surface (8 patterns, one of them narrowed)

Even for `Write`/`Edit`/`MultiEdit`, the hook only reports on paths matching
[`CONFIG_PATTERNS`](../../plugins/calllint/hooks/preflight-core.mjs#L12-L21) — **8** regexes:
`.mcp.json`, `mcp.json`, `mcp_config.json`, `claude_desktop_config.json`, `.claude.json`,
`.claude/**/settings.json`, bare `settings.json`, `SKILL.md`.

The bare `settings.json` pattern is then **narrowed at runtime**
([preflight-core.mjs:29-31](../../plugins/calllint/hooks/preflight-core.mjs#L29-L31)): it returns
`false` unless the path is under a `.claude` directory, with the reason given verbatim — *"too broad
to flag on name alone; require the .claude dir so we do not nag on every settings.json in a repo."*
That is a correct product judgement and simultaneously a widening of the blind spot.

Any edit to any other file — source, lockfile, CI config, `.env` — produces no observation.

### Gap 3 — the failure surface (three paths, all silent, all exit 0)

This is the axis that makes Q10 `CONTRADICTED` rather than merely `PARTIAL`:

| Failure | Binding | Behaviour |
| --- | --- | --- |
| stdin is not parsable JSON | [preflight.mjs:52](../../plugins/calllint/hooks/preflight.mjs#L52) | `process.exit(0) // no parsable event → stay silent, never block` |
| any thrown error, anywhere | [preflight.mjs:59](../../plugins/calllint/hooks/preflight.mjs#L59) | `main().catch(() => process.exit(0))` |
| stdin does not close within 2000 ms | [preflight.mjs:39](../../plugins/calllint/hooks/preflight.mjs#L39) | `setTimeout(done, 2000).unref?.()` — resolves with **whatever partial `data` arrived**, which then fails to parse and takes path 1 |

The docblock states the intent plainly ([preflight.mjs:17-18](../../plugins/calllint/hooks/preflight.mjs#L17-L18)):
*"On any parse/logic error it still exits 0 silently — a preflight recommender must never break the
agent loop."*

That is the right design for a non-blocking recommender. It is also, exactly, why the hook cannot be
a **trajectory evidence source**: a consumer receiving nothing cannot distinguish

- the tool call was not a config surface (normal, expected), from
- the event was truncated at 2000 ms, from
- the hook threw.

There is no error channel, no counter, no sequence number. A trajectory built on this stream would
have silent holes it could not detect — and per product principles 3 and 8, evidence with
undetectable gaps cannot ground a verdict.

## The matrix

| Capability a trajectory model would need | Claude Code today | Binding |
| --- | --- | --- |
| Observe tool calls | **3 tools only** (`Write`/`Edit`/`MultiEdit`) | hooks.json:5 |
| Observe `Bash` | **No** | hooks.json:5 |
| Observe MCP tool calls | **No** | hooks.json:5 |
| Observe reads (`Read`/`Grep`/`WebFetch`) | **No** | hooks.json:5 |
| Post-execution outcome | **No** — no `PostToolUse` registered | hooks.json:3 |
| Session boundaries | **No** — no `SessionStart`/`Stop` registered | hooks.json:3 |
| Block / gate an action | **No**, three independent locks | ADR 0051:41-46 · preflight.mjs:56 · no `permissionDecision` |
| Detect its own dropped events | **No** — silence is overloaded | preflight.mjs:39,52,59 |
| Stable session identifier | Only a free-form `agent_session?: string` | [action-analyzer/src/types.ts:61](../../packages/action-analyzer/src/types.ts#L61) — see [05](05-existing-state-and-receipt-map.md) |

## Projected conclusions from the local boundary analysis (§19)

These are conclusions from an unpublished local planning document, projected here as conclusions —
its text is not moved, and `docs/` publishes nothing. They are recorded because they name the
distinction this matrix is evidence for:

1. **Host Fact vs Derived Signal.** What a Host actually emitted, and what CallLint inferred, are
   different kinds of claim and must never share a field. The matrix above is entirely Host Fact.
2. **Trust ordering.** A Derived Signal never outranks a Host Fact; absence of a Host Fact is not
   evidence of absence of the event.
3. **Three-state completeness — `complete | partial | unavailable`.** Two states cannot express
   this matrix: the hook's stream is not "available" and not "unavailable" but *partial by
   construction*.
4. **`[]` is not `unavailable`.** An empty observation list must never be serialized in a way a
   consumer can read as "nothing happened." This is precisely Gap 3.
5. Completeness must be **stated by the producer**, never inferred by the consumer from an empty
   list.

Point 4 is the one this chapter measured independently: the current stream violates it, because
"no payload written" is the encoding for both "not a config surface" and "the hook failed."

## What this chapter does not claim

- Nothing about Hosts other than Claude Code. Cursor, Windsurf, and Codex appear in
  `CONFIG_PATTERNS` as *paths CallLint recognizes*, not as Hosts that emit events to CallLint.
- No claim that the three gaps are defects. Each is a correct consequence of ADR 0051's
  non-blocking, never-break-the-loop mandate. They are recorded as capability limits, because a
  trajectory design that assumed otherwise would be assuming a Host capability that does not exist —
  the specific failure T0 was written to prevent.
- No measurement of whether Claude Code *could* emit more (its hook API may well support more
  events). What is measured is what this repository registers and consumes.
