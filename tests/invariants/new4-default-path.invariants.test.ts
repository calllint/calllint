import { describe, it } from "vitest"

// ---------------------------------------------------------------------------
// new4 default-path invariants (architecture §3, §9.4 / ADR 0018).
//
// These encode the "极小资源占用" contract: the default `check` / `scan-all`
// path must not touch the network, call an LLM, execute the scanned server,
// emit a long report, scan node_modules, or leak secret values; UNKNOWN must
// never render or aggregate to SAFE; and the same capability across hosts must
// hash identically.
//
// They are it.todo placeholders until Phase 1 (P1.1–P1.11) lands the default
// path. As each capability ships, the matching todo is replaced with a real
// assertion. The runner reports these as pending (not failing) so the scaffold
// gate stays green with zero behavior change.
// ---------------------------------------------------------------------------

describe("invariant: default path does not touch the network (P1.11)", () => {
  it.todo(
    "no socket / fetch is opened during `check` and `scan-all` on the default path",
  )
})

describe("invariant: default path does not call an LLM (P1.11)", () => {
  it.todo("no model client is constructed on the default path")
})

describe("invariant: default path never executes the scanned server (ADR 0003)", () => {
  it.todo("no child_process is spawned for the scanned server during a scan")
})

describe("invariant: compact output stays within budget (P1.7)", () => {
  it.todo("single-surface default terminal output is ≤ 30 lines")
})

describe("invariant: single-surface JSON budget (P1.8)", () => {
  it.todo("single-surface `--json` compact decision is < 1 KB")
})

describe("invariant: scan-all ignores node_modules (P1.9)", () => {
  it.todo("`scan-all` never descends into node_modules")
})

describe("invariant: secrets are redacted everywhere (P1.1)", () => {
  it.todo(
    "no secret VALUE appears in any output; authority carries env key names only",
  )
})

describe("invariant: cross-host fingerprint equality (P1.1 / ADR 0019)", () => {
  it.todo(
    "the same npx MCP server expressed in Cursor and VS Code yields the same fingerprint hash",
  )
})

describe("invariant: UNKNOWN never becomes SAFE (ADR 0002)", () => {
  it.todo(
    "UNKNOWN never renders or aggregates to SAFE, and never maps to nextAction continue",
  )
})
