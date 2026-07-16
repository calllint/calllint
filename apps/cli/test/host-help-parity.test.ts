import { describe, it, expect } from "vitest"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HOST_ADAPTERS } from "@calllint/install-planner"
import { run } from "../src/run.js"

// Guard: the `trust` help's `--host` line and the "Known hosts" usage errors
// must stay in sync with the install-planner adapter registry. The Cursor
// promotion (Tier B → A, #149) left the hardcoded help text saying
// "cursor (Tier B, plan-only)" long after `CURSOR_TIER` became "A" — a stale
// public-copy drift that check-public-copy.mjs does not cover (it guards the
// website/README, not CLI help). We now DERIVE the help from the registry, and
// this test binds the rendered text back to the code so it can never drift:
//  - every registered host id appears in the help
//  - a Tier-A host (ships applyPlan) is never described as "plan-only"
//  - a non-apply host (no applyPlan) is described as "plan-only"
// See memory: docs-bind-to-release; sibling test: help-parity.test.ts.

const HELP_DEPS = {
  cwd: process.cwd(),
  readStdin: () => "",
  now: Date.parse("2026-07-16T00:00:00Z"),
  generatedAt: "2026-07-16T00:00:00.000Z",
}

function trustHelpText(): string {
  const r = run(["trust", "help"], HELP_DEPS)
  expect(r.exitCode, "trust help must exit 0").toBe(0)
  return r.stdout
}

describe("trust --host help ↔ adapter registry parity", () => {
  const help = trustHelpText()
  const adapters = Object.values(HOST_ADAPTERS)

  it("registry is non-empty (sanity)", () => {
    expect(adapters.length).toBeGreaterThan(0)
  })

  it("every registered host id appears in the trust help", () => {
    for (const a of adapters) {
      expect(help, `host "${a.id}" missing from trust help`).toContain(a.id)
    }
  })

  it("every registered host is described with its actual tier", () => {
    for (const a of adapters) {
      expect(help, `host "${a.id}" tier not shown in help`).toContain(`Tier ${a.tier}`)
    }
  })

  it("a Tier-A host (ships applyPlan) is never labelled plan-only", () => {
    // Render each host's own description slice and assert the capability text
    // matches whether it can actually apply. We check the invariant per host by
    // reconstructing the exact phrase the help uses.
    for (const a of adapters) {
      if (a.applyPlan) {
        // Must be described as applying, not plan-only.
        expect(help, `Tier-A host "${a.id}" must show "applies"`).toContain(`${a.id} (Tier ${a.tier}, applies)`)
      } else {
        expect(help, `non-apply host "${a.id}" must show "plan-only"`).toMatch(
          new RegExp(`${a.id} \\(Tier ${a.tier}, plan-only`),
        )
      }
    }
  })
})

describe("trust apply — unknown-host error lists the registry", () => {
  it("a plan naming an unregistered host fails with a Known-hosts list built from the registry", () => {
    // Write a syntactically valid install-plan.v1 whose host is not registered.
    // The command must fail-closed and enumerate the live registry, not a
    // hardcoded pair — proving knownHostList() drives the error.
    const planPath = join(mkdtempSync(join(tmpdir(), "cl-hosthelp-")), "plan.json")
    const plan = {
      schema: "calllint.install-plan.v1",
      host: "definitely-not-a-host",
      operations: [{ op: "add", target: "/tmp/x.json", path: "/mcpServers/x", value: {} }],
    }
    writeFileSync(planPath, JSON.stringify(plan), "utf8")
    const r = run(["trust", "apply", "--plan", planPath, "--approve", "sha256:x"], HELP_DEPS)

    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain("Unknown host")
    for (const id of Object.keys(HOST_ADAPTERS)) {
      expect(r.stderr, `Known-hosts error must list "${id}"`).toContain(id)
    }
  })
})
