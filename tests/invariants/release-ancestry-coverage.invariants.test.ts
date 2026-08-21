/**
 * Every workflow that can publish irreversibly must gate on release ancestry.
 *
 * WHY THIS FILE EXISTS. AC-32 (`new18.md` §45) was closed by wiring
 * `scripts/verify-release-ancestry.mjs` into `publish-mcp.yml`. AC-32's own text names
 * `mcp-v*` tags, so closing it answered nothing about the OTHER publish path:
 * `release.yml` shipped the flagship `calllint` CLI to npm with **0** ancestry checks, and
 * a GitHub Release can be created against any target (`gh release create v9.9.9 --target
 * <side-branch-sha>`). Same property, larger blast radius, invisible to a guard keyed on
 * AC-32's wording. It was found by hand, and nothing would have caught the next one.
 *
 * SO THE GUARDED SET IS DERIVED FROM THE ENFORCER, NOT LISTED HERE. ADR 0089 D2 and
 * ADR 0090: a guard that names its subjects *is* the fault class it guards, because a
 * filename list cannot notice a sixth file. This test scans every workflow for publish
 * operations and demands an ancestry gate in whichever ones have them.
 *
 * THE ONE EXEMPTION IS STRUCTURAL, AND NARROWER THAN IT LOOKS. A workflow triggered ONLY by
 * `push: branches: [main]` cannot run on an unmerged commit, so ancestry holds by
 * construction. That is computed from the trigger, never granted by name — and writing this
 * guard is how the exemption's first claimed beneficiary turned out not to qualify:
 * `deploy-web.yml` also accepts `workflow_dispatch`, which can be run against ANY ref, and
 * it deploys with `--branch=main`, i.e. straight to production. The guard failed, the claim
 * was wrong, and the fix was to gate that workflow rather than widen the exemption.
 *
 * COVERAGE IS KEYED ON AN EXECUTED `run:` STEP, NEVER ON THE FILE'S TEXT. `deploy-web.yml`
 * matches /merge-base|is-ancestor/ in a *comment*; a text-keyed scan would have read it as
 * covered while it ran no gate at all. Counting prose as coverage is the vacuous green this
 * repo keeps producing.
 *
 * The premise block asserts the INSTRUMENT: that the scan still finds workflows, still
 * finds publish operations, and still finds the gate script. Without it, every assertion
 * below could pass for want of a subject — the shape that let a substitution through a
 * count ratchet (ADR 0084) and made nine audits vacuous.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, "..", "..")
const WORKFLOWS = resolve(ROOT, ".github", "workflows")
const GATE_SCRIPT = "scripts/verify-release-ancestry.mjs"

/**
 * Operations that put an artifact somewhere it cannot be taken back from: npm versions are
 * immutable, an MCP Registry entry is public, a Pages deploy replaces the live site.
 */
const PUBLISH_OP = /npm publish|mcp-publisher publish|wrangler\s+.*deploy|pages\s+deploy/

type Workflow = { file: string; text: string; doc: Record<string, unknown> }

function workflows(): Workflow[] {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => {
      const text = readFileSync(resolve(WORKFLOWS, file), "utf8")
      return { file, text, doc: parse(text) as Record<string, unknown> }
    })
}

/** Every `run:` string in a workflow, flattened across jobs and steps. */
function runSteps(doc: Record<string, unknown>): string[] {
  const out: string[] = []
  const jobs = (doc?.jobs ?? {}) as Record<string, { steps?: Array<{ run?: unknown }> }>
  for (const job of Object.values(jobs)) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.run === "string") out.push(step.run)
    }
  }
  return out
}

/** A workflow publishes if any EXECUTED step performs a publish op — not if the text mentions one. */
const publishes = (w: Workflow) => runSteps(w.doc).some((r) => PUBLISH_OP.test(r))

/** Covered means an executed step runs the gate script. A comment mentioning it is not coverage. */
const gated = (w: Workflow) => runSteps(w.doc).some((r) => r.includes(GATE_SCRIPT))

/**
 * `on: push: branches: [main]` and nothing else — such a workflow cannot fire on an
 * unmerged commit, so the property holds without a gate. Any additional trigger (a tag, a
 * release, `workflow_dispatch`, a fork PR) breaks that argument and revokes the exemption.
 */
function safeByTrigger(doc: Record<string, unknown>): boolean {
  const on = doc?.on as Record<string, unknown> | undefined
  if (!on || typeof on !== "object") return false
  const keys = Object.keys(on)
  if (keys.length !== 1 || keys[0] !== "push") return false
  const push = on.push as { branches?: unknown; tags?: unknown } | null
  if (!push || typeof push !== "object") return false
  if (push.tags) return false
  const branches = Array.isArray(push.branches) ? push.branches : []
  return branches.length > 0 && branches.every((b) => b === "main")
}

describe("the premise: this scan can still see its subjects (the instrument, not the behaviour)", () => {
  it("finds the workflow directory and a plausible number of workflows", () => {
    const all = workflows()
    expect(all.length).toBeGreaterThanOrEqual(10)
    expect(all.every((w) => w.doc && typeof w.doc === "object")).toBe(true)
  })

  it("still finds publish operations — a zero here would make every assertion below vacuous", () => {
    const publishing = workflows().filter(publishes).map((w) => w.file)
    expect(
      publishing.length,
      "no workflow appears to publish; PUBLISH_OP has gone stale and this guard is now blind",
    ).toBeGreaterThanOrEqual(2)
    // The two known irreversible publish paths must remain discoverable by shape.
    expect(publishing).toContain("publish-mcp.yml")
    expect(publishing).toContain("release.yml")
  })

  it("the gate script it demands actually exists", () => {
    expect(existsSync(resolve(ROOT, GATE_SCRIPT))).toBe(true)
  })
})

describe("release ancestry coverage over the derived publish set", () => {
  it("every publishing workflow either runs the gate or is safe by trigger construction", () => {
    const unguarded = workflows()
      .filter(publishes)
      .filter((w) => !gated(w) && !safeByTrigger(w.doc))
      .map((w) => w.file)
    expect(
      unguarded,
      `these workflows publish irreversibly with no ancestry gate — a tag or release pointing at an ` +
        `unreviewed commit would ship: ${unguarded.join(", ")}`,
    ).toEqual([])
  })

  it("the gate runs BEFORE any publish step in each workflow that has one", () => {
    for (const w of workflows().filter((x) => publishes(x) && gated(x))) {
      const steps = runSteps(w.doc)
      const gateAt = steps.findIndex((r) => r.includes(GATE_SCRIPT))
      const publishAt = steps.findIndex((r) => PUBLISH_OP.test(r))
      expect(gateAt, `${w.file}: gate step not found`).toBeGreaterThanOrEqual(0)
      expect(
        gateAt,
        `${w.file}: the ancestry gate runs at step ${gateAt} but a publish happens at ${publishAt} — ` +
          `a gate after the irreversible act is not a gate`,
      ).toBeLessThan(publishAt)
    }
  })

  it("deploy-web.yml is gated, because workflow_dispatch revokes its trigger exemption", () => {
    // This row exists because the exemption was FIRST CLAIMED FOR THIS FILE AND WAS WRONG.
    // `push: branches: [main]` cannot fire on an unmerged commit, but the workflow also
    // accepts `workflow_dispatch`, which can run against any ref — and it deploys with
    // `--branch=main`, i.e. to production. The guard caught the claim; the fix was to gate
    // the workflow, not to widen the exemption.
    const w = workflows().find((x) => x.file === "deploy-web.yml")
    if (!w) return
    expect(Object.keys((w.doc.on ?? {}) as object)).toContain("workflow_dispatch")
    expect(
      safeByTrigger(w.doc),
      "a workflow_dispatch-able workflow must NOT be treated as safe by construction",
    ).toBe(false)
    expect(gated(w), "deploy-web.yml deploys to production from any dispatched ref — it needs the gate").toBe(true)
  })

  it("the trigger exemption is real, but only for push-to-main-only workflows", () => {
    // Mutate the INSTRUMENT: the exemption must accept the shape it claims to accept and
    // reject every neighbouring one, or it is either dead code or a hole.
    const mk = (on: string) => parse(`on:\n${on}\njobs: {}`) as Record<string, unknown>
    expect(safeByTrigger(mk("  push:\n    branches: [main]"))).toBe(true)
    expect(safeByTrigger(mk("  push:\n    branches: [main]\n  workflow_dispatch:"))).toBe(false)
    expect(safeByTrigger(mk("  push:\n    branches: [main]\n    tags: ['v*']"))).toBe(false)
    expect(safeByTrigger(mk("  push:\n    branches: [main, dev]"))).toBe(false)
    expect(safeByTrigger(mk("  release:\n    types: [published]"))).toBe(false)
  })

  it("a publishing workflow cannot satisfy the gate with a comment (mutation of the instrument)", () => {
    // Mutate the INSTRUMENT, not the product: a doc whose only mention of the script is a
    // comment must read as UNGATED. Otherwise the assertions above could pass on prose.
    const commentOnly = parse(`
name: fake
on:
  release:
    types: [published]
jobs:
  publish:
    steps:
      # runs ${GATE_SCRIPT} eventually, honest
      - run: npm publish --access public
`) as Record<string, unknown>
    const fake: Workflow = { file: "fake.yml", text: `# ${GATE_SCRIPT}`, doc: commentOnly }
    expect(publishes(fake)).toBe(true)
    expect(gated(fake), "a comment must never count as coverage").toBe(false)
    expect(safeByTrigger(fake.doc), "a release-triggered workflow is not safe by construction").toBe(false)
  })
})
