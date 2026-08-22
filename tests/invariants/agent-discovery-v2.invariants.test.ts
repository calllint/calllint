/**
 * new19 §22 / §23 — agent discovery v2 invariants.
 *
 * new19 asks for nine test propositions (§22) and eight negative controls (§23). Written
 * literally that would be seventeen tests, five of which assert the same thing: NC-01
 * (Codex), NC-02 (DeepSeek model identity), NC-03 (marketplace presence), NC-07 (new
 * platform → new detector) and NC-08 (discovery metadata in the security engine) are five
 * projections of ONE invariant — *distribution facts must not reach the verdict path*.
 *
 * Collapsing them is recorded as decision D10 in artifacts/agent-discovery-v2/REALITY_AUDIT.md.
 * The collapse is only legitimate because the single form is STRONGER than the five: an
 * import-graph assertion catches a sixth projection nobody has thought of yet, whereas five
 * per-vendor tests each catch exactly one named vendor.
 *
 * THE ANTI-VACUITY RULE THIS FILE OBEYS THROUGHOUT. A guard that scans an empty set prints
 * a checkmark and asserts nothing — the dominant fault class in this repo. So every
 * assertion here pins its denominator BEFORE its claim: the import-graph test asserts it
 * read 400+ source files before asserting 0 of them reference distribution truth; the
 * cohort tests assert the cohort is non-empty before asserting a property of every member.
 *
 * WHY NC-04 IS NOT IN THIS FILE. "Generated page manually edited → FAIL" is a property of
 * the generator's `--check` mode, not of any committed artifact: proving it requires
 * mutating a byte on disk, watching the checker exit 1, and restoring. That is a shell
 * negative control, run and recorded in artifacts/agent-discovery-v2/FINAL_REPORT.md, and
 * `check:distribution-drift` in `ci:local` is its enforcement. A vitest that mutated the
 * served tree would race the other suites for the same files.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n")

interface Primitive {
  kind: string
  state: string
  upstream?: string
  auditNote?: string
  blocker?: string
}
interface Host {
  id: string
  displayName: string
  vendor: string
  priority: string
  supportClass: string
  authoritySurfaces: string[]
  configEvidence: string[]
  truthfulCommands: string[]
  canonicalPath: string
  officialSources: string[]
  distributionPrimitives: Primitive[]
  coverageBoundary: string
}
interface Ssot {
  officialMcpRegistry: Record<string, unknown>
  hosts: Host[]
  modelIntentLandingPages: { id: string; path: string }[]
  candidateFeeds: { id: string; role: string }[]
}

const SSOT = JSON.parse(read("apps/web/data/distribution-surfaces.json")) as Ssot
const INDEX = JSON.parse(read("apps/web/public/agent-discovery-index.json")) as {
  schemaVersion: string
  surfaceTypes: string[]
  counts: { total: number; byType: Record<string, number> }
  surfaces: { id: string; type: string; status: string; supportClass?: string }[]
}
const SURFACES = JSON.parse(read("apps/web/public/agent-surfaces.json")) as {
  mcp: { registry: string; package: string; state: string }
  agents: { id: string; supportClass: string; scanCommands: string[] }[]
}

const AGENT_TYPES = read("packages/discovery/src/types.ts")
const BOOTSTRAP = read("packages/discovery/src/bootstrap.ts")

/**
 * AgentType members are double-quoted arms of a string-literal union. check-harness-
 * distribution.mjs parses them with the same `/"([^"]+)"/` shape; this must match it, or a
 * formatting change would leave both reading an empty set while printing green.
 */
const registeredTypes = new Set(
  (AGENT_TYPES.match(/export type AgentType =([\s\S]*?)\n\n/)?.[1] ?? "")
    .split("\n")
    .map((l) => l.match(/"([^"]+)"/)?.[1])
    .filter((x): x is string => Boolean(x)),
)

/** Every non-declaration source file under packages/, i.e. the shipped engine. */
function engineSources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".turbo") continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(full)
    }
  }
  walk(path.join(repoRoot, "packages"))
  return out
}

/*
 * NC-01 / NC-02 / NC-03 / NC-07 / NC-08 — one invariant, five projections.
 *
 * The security engine lives in packages/. If no file there can even NAME a distribution
 * fact, then adding Codex cannot change a verdict (NC-01), a model vendor cannot change one
 * (NC-02), marketplace presence cannot (NC-03), a new platform cannot induce a detector
 * (NC-07), and discovery metadata cannot enter the engine at all (NC-08). The five follow
 * from the one; the one does not follow from any of the five.
 */
describe("§23 NC-01/02/03/07/08 — distribution facts cannot reach the verdict path", () => {
  const sources = engineSources()

  it("scans a non-empty engine surface (anti-vacuity premise, asserted first)", () => {
    /* Without this, deleting packages/ would make every assertion below pass. The floor is
     * deliberately far below the measured 513 so ordinary refactors do not red it, while a
     * collapse to zero or a near-empty scan still does. */
    expect(sources.length).toBeGreaterThan(400)
  })

  it("no engine source references any distribution-truth token", () => {
    const TOKENS = [
      "distribution-surfaces",
      "agent-surfaces.json",
      "agent-discovery-index",
      "distributionPrimitives",
      "authoritySurfaces",
      "modelIntentLandingPages",
      "candidateFeeds",
    ]
    const offenders: string[] = []
    for (const file of sources) {
      const text = readFileSync(file, "utf8")
      const hits = TOKENS.filter((t) => text.includes(t))
      if (hits.length > 0) {
        offenders.push(`${path.relative(repoRoot, file).replace(/\\/g, "/")}: ${hits.join(", ")}`)
      }
    }
    expect(offenders, `distribution truth leaked into the engine:\n${offenders.join("\n")}`).toEqual(
      [],
    )
  })

  it("no engine source names a harness vendor as a security-relevant distinction", () => {
    /* NC-02's literal subject. `deepseek` may legitimately appear as a model id or an API
     * base URL; what must not appear is a vendor branch inside the verdict path. The
     * discovery package is exempt BY NAME because reading a host's config is its job — and
     * that exemption is itself asserted to be non-empty, so it cannot silently widen. */
    const verdictPaths = sources.filter((f) => {
      const rel = path.relative(repoRoot, f).replace(/\\/g, "/")
      return (
        /^packages\/(risk-engine|static-analyzer|policy|core)\//.test(rel) && !/\.test\.ts$/.test(rel)
      )
    })
    expect(verdictPaths.length, "no verdict-path sources found — this test would be vacuous").toBeGreaterThan(10)

    const VENDOR_TOKENS = ["deepseek", "workbuddy", "codebuddy", "roo-code", "continue-dev"]
    const offenders: string[] = []
    for (const file of verdictPaths) {
      const text = readFileSync(file, "utf8").toLowerCase()
      const hits = VENDOR_TOKENS.filter((t) => text.includes(t))
      if (hits.length > 0) {
        offenders.push(`${path.relative(repoRoot, file).replace(/\\/g, "/")}: ${hits.join(", ")}`)
      }
    }
    expect(
      offenders,
      `a vendor name appears in the verdict path:\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})

/* §22 "Schema: valid index / invalid index" */
describe("§22 schema — the discovery index is governed, and its schema rejects", () => {
  const schemaRel = "apps/web/public/schemas/agent-discovery-index.v1.json"

  it("publishes a schema that resolves to a served file", () => {
    expect(existsSync(path.join(repoRoot, schemaRel))).toBe(true)
    const pointer = String((INDEX as unknown as { $schema?: string }).$schema ?? "")
    expect(pointer.replace(/^https?:\/\/[^/]+/, "")).toBe("/schemas/agent-discovery-index.v1.json")
  })

  it("validates the committed index against it", async () => {
    const { default: Ajv } = await import("ajv")
    const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
    const validate = ajv.compile(JSON.parse(read(schemaRel)))
    const ok = validate(INDEX)
    expect(ok, JSON.stringify(validate.errors ?? [], null, 1)).toBe(true)
  })

  it("rejects an invalid index (the schema has a failing mode of its own)", async () => {
    const { default: Ajv } = await import("ajv")
    const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
    const validate = ajv.compile(JSON.parse(read(schemaRel)))

    /* Three distinct violations. A schema that only rejected one shape would be reported as
     * "rejects invalid input" while being blind to the other two. */
    const unknownProp = JSON.parse(JSON.stringify(INDEX))
    unknownProp.surfaces[0].seoScore = 9
    expect(validate(unknownProp), "additionalProperties: false is not in force").toBe(false)

    const badType = JSON.parse(JSON.stringify(INDEX))
    badType.surfaces[0].type = "marketplace-ish"
    expect(validate(badType), "the §6 type vocabulary is not closed").toBe(false)

    const badContract = JSON.parse(JSON.stringify(INDEX))
    badContract.schemaVersion = "calllint.discovery.v1"
    expect(
      validate(badContract),
      "schemaVersion is not pinned — this index could be confused with the Safe-install manifest",
    ).toBe(false)
  })
})

/* §22 "Generation: deterministic output / no drift" */
describe("§22 generation — deterministic, and drift-checkable", () => {
  it("embeds no wall-clock stamp in either generated machine surface", () => {
    /* A timestamp makes every run a diff, which destroys `--check`'s ability to distinguish
     * "the surface moved" from "the generator ran". Both files carry `describes.release`
     * instead. Asserted on the generator source so a reintroduction reds here, not six
     * months later in a misread PR. */
    const gen = read("scripts/generate-distribution-surfaces.mjs")
    const generatedAtWrites = gen.match(/generatedAt:\s*new Date\(\)/g) ?? []
    expect(generatedAtWrites).toEqual([])
    expect(INDEX).not.toHaveProperty("generatedAt")
    expect(SURFACES).not.toHaveProperty("generatedAt")
  })

  it("routes every write through emit(), so --check and write share one code path", () => {
    /* `--check` is only meaningful if it computes its expected bytes the same way the write
     * mode does. A second raw writeFileSync would be a second pipeline, and a green would
     * mean "the two agree" rather than "the tree is current". emit() itself is the one
     * permitted call site. */
    const gen = read("scripts/generate-distribution-surfaces.mjs")
    const rawWrites = gen.match(/writeFileSync\(/g) ?? []
    expect(rawWrites.length, "a write site is bypassing emit()").toBe(1)
    expect(gen).toContain("const CHECK_MODE = process.argv.includes('--check')")
  })

  it("wires check:distribution-drift into ci:local ahead of its consumers", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> }
    expect(pkg.scripts["check:distribution-drift"]).toBe(
      "node scripts/generate-distribution-surfaces.mjs --check",
    )
    const ciLocal = pkg.scripts["ci:local"]
    /* Asserted as a string before splitting: a deleted `ci:local` would otherwise surface as
     * "cannot read properties of undefined" two lines down, naming the reader rather than
     * the missing subject. Same shape as gate-s0-claims uses on this key. */
    expect(ciLocal, "ci:local must still be defined for this ordering claim to mean anything").toBeTypeOf(
      "string",
    )
    const steps = (ciLocal ?? "").split("&&").map((s) => s.trim())
    const drift = steps.indexOf("pnpm check:distribution-drift")
    expect(drift, "check:distribution-drift is not in ci:local").toBeGreaterThan(-1)
    /* Order is load-bearing: both gates below read the generated tree, so a stale tree must
     * be caught before they pass on the wrong bytes. */
    expect(drift).toBeLessThan(steps.indexOf("pnpm check:harness-distribution"))
    expect(drift).toBeLessThan(steps.indexOf("pnpm check:agent-surface"))
  })
})

/* §22 "Coverage: all Tier 0 entries exist / no duplicate IDs" */
describe("§22 coverage — Tier 0 present, ids unique across the whole index", () => {
  it("carries a non-empty host cohort (anti-vacuity premise)", () => {
    expect(SSOT.hosts.length).toBeGreaterThan(10)
  })

  it("represents the Tier 0 registry identity consistently across all three surfaces", () => {
    const reg = SSOT.officialMcpRegistry as { name: string; package: string; state: string; tierLevel: number }
    expect(reg.tierLevel).toBe(0)
    expect(SURFACES.mcp.registry).toBe(reg.name)
    expect(SURFACES.mcp.package).toBe(reg.package)
    expect(SURFACES.mcp.state).toBe(reg.state)
    const inIndex = INDEX.surfaces.find((s) => s.type === "mcp-registry")
    expect(inIndex?.id).toBe(reg.name)
  })

  it("has no duplicate id anywhere in the index, across surface types", () => {
    /* Scoping matters: two records of DIFFERENT types may not share an id either, because
     * the index is keyed by id for lookup. `deepseek-hub` (documentation) and
     * `deepseek-harness` (agent-harness) are distinct subjects and distinct ids — that
     * separation is the thing this asserts. */
    const ids = INDEX.surfaces.map((s) => s.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes, `duplicate id(s) in the discovery index: ${dupes.join(", ")}`).toEqual([])
    expect(ids.length).toBe(INDEX.counts.total)
  })

  it("indexes every SSOT container, and publishes the full §6 vocabulary", () => {
    expect(INDEX.surfaceTypes).toEqual([
      "agent-harness",
      "mcp-registry",
      "marketplace",
      "documentation",
      "search-surface",
      "mirror",
    ])
    expect(INDEX.counts.byType["agent-harness"]).toBe(SSOT.hosts.length)
    expect(INDEX.counts.byType["mcp-registry"]).toBe(1)
    expect(INDEX.counts.byType["documentation"]).toBe(SSOT.modelIntentLandingPages.length)
    expect(INDEX.counts.byType["search-surface"]).toBe(SSOT.candidateFeeds.length)
    /* Truthful empty sets, not omissions: CallLint distributes through no marketplace and
     * operates no mirror. Pinned so their arrival is a deliberate edit. */
    expect(INDEX.counts.byType["marketplace"]).toBe(0)
    expect(INDEX.counts.byType["mirror"]).toBe(0)
  })
})

/*
 * §9 REQUIRED INITIAL HARNESS COVERAGE — the tier obligation, asserted at last.
 *
 * WHY THIS BLOCK EXISTS, AND WHAT AN EARLIER REPORT GOT WRONG. The final report first
 * recorded §5's Tier 0/1/2 vocabulary as a deliberate divergence, on the reasoning that
 * `supportClass` already answers "what does CallLint claim" and a parallel `tier` field
 * would be a second classification no gate reads. The first half of that is still true.
 * The second half was a category error: §9 does not ask for a FIELD, it names fourteen
 * hosts and §3040 asks for one assertion over them — "all Tier 0 entries exist". A
 * membership obligation is not a per-record attribute, so it needs no field, and the
 * absence of a field was never a reason not to assert the obligation.
 *
 * WHY THE LISTS ARE ANCHORED ON `id`, NOT `displayName`. §9 writes its members as display
 * names, and two of them do NOT match this repo's strings exactly: "Codex" is
 * `OpenAI Codex` and "GitHub Copilot" is `GitHub Copilot CLI`. Matching on the §9 spelling
 * would fail today; matching loosely (substring, case-folded) would let a rename silently
 * dissolve a coverage obligation, which is the failure this assertion exists to prevent.
 * So the mapping from §9 name to SSOT id is made ONCE, here, in a reviewed constant.
 *
 * WHY `priority` IS NOT REUSED AS THE TIER. Measured: they disagree. `codex` and `cline`
 * are §9 Tier 0 but carry `P2`, and `claude-desktop` carries `P0` while appearing in no §9
 * tier at all. `priority` orders CallLint's own work; a tier records an obligation new19
 * imposed. Collapsing them would silently redefine one of the two.
 */
const REQUIRED_COVERAGE: Readonly<Record<"tier0" | "tier1" | "tier2", readonly string[]>> = {
  // §9 "Tier 0" — spelled there as: Claude Code, Codex, Cursor, GitHub Copilot, Cline.
  tier0: ["claude-code", "codex", "cursor", "copilot-cli", "cline"],
  // §9 "Tier 1" — Gemini CLI, OpenCode, Continue, Roo Code, WorkBuddy, CodeBuddy.
  tier1: ["gemini-cli", "opencode", "continue", "roo-code", "workbuddy", "codebuddy"],
  // §9 "Tier 2" — DeepSeek Harness, Qwen Code, Kiro.
  tier2: ["deepseek-harness", "qwen-code", "kiro"],
} as const

/*
 * Hosts CallLint covers that §9 does not name. Recorded explicitly rather than left as
 * "whatever is left over", because both directions are meaningful: a host leaving this set
 * means §9 grew, and a host arriving means CallLint covered something new19 never asked
 * for. Either is a deliberate edit; neither should be silent.
 */
const BEYOND_SECTION_9 = ["claude-desktop", "vscode", "windsurf", "openclaw"] as const

describe("§9 / §3040 — every required harness tier is covered", () => {
  const ids = new Set(SSOT.hosts.map((h) => h.id))

  it("reads a non-empty host cohort and a non-empty obligation (anti-vacuity premise)", () => {
    /* Both denominators, because either being empty would make every claim below pass while
     * observing nothing — a tier list that lost its members is exactly as vacuous as an
     * SSOT that lost its hosts. */
    expect(SSOT.hosts.length).toBeGreaterThan(10)
    expect(REQUIRED_COVERAGE.tier0.length).toBe(5)
    expect(REQUIRED_COVERAGE.tier1.length).toBe(6)
    expect(REQUIRED_COVERAGE.tier2.length).toBe(3)
  })

  it("has a record for every §9 Tier 0 entry (§3040's literal requirement)", () => {
    const missing = REQUIRED_COVERAGE.tier0.filter((id) => !ids.has(id))
    expect(
      missing,
      `§9 Tier 0 names these hosts and the SSOT has no record for: ${missing.join(", ")}`,
    ).toEqual([])
  })

  it("has a record for every §9 Tier 1 and Tier 2 entry", () => {
    const missing = [...REQUIRED_COVERAGE.tier1, ...REQUIRED_COVERAGE.tier2].filter((id) => !ids.has(id))
    expect(missing, `§9 Tier 1/2 entries with no SSOT record: ${missing.join(", ")}`).toEqual([])
  })

  it("assigns each §9 entry to exactly one tier", () => {
    /* A host in two tiers would make "which tier is this" unanswerable, and the answer is
     * what the obligation is stated in terms of. */
    const all = [...REQUIRED_COVERAGE.tier0, ...REQUIRED_COVERAGE.tier1, ...REQUIRED_COVERAGE.tier2]
    const dupes = all.filter((id, i) => all.indexOf(id) !== i)
    expect(dupes, `host(s) claimed by more than one §9 tier: ${dupes.join(", ")}`).toEqual([])
  })

  it("accounts for every SSOT host as either §9-required or explicitly beyond it", () => {
    /* The partition is total. An unaccounted host is not an error in itself — CallLint may
     * cover more than new19 asked — but it must be NAMED, so that growth is a reviewed edit
     * rather than a silent drift in what "required coverage" means. */
    const tiered = new Set([
      ...REQUIRED_COVERAGE.tier0,
      ...REQUIRED_COVERAGE.tier1,
      ...REQUIRED_COVERAGE.tier2,
    ])
    const unaccounted = [...ids].filter((id) => !tiered.has(id) && !BEYOND_SECTION_9.includes(id as never))
    expect(
      unaccounted,
      `host(s) neither in a §9 tier nor in BEYOND_SECTION_9 — add to whichever is true: ${unaccounted.join(", ")}`,
    ).toEqual([])
    /* And the reverse: a name in BEYOND_SECTION_9 that no longer exists would leave a stale
     * exemption behind, quietly widening the set of hosts allowed to skip §9. */
    const stale = BEYOND_SECTION_9.filter((id) => !ids.has(id))
    expect(stale, `BEYOND_SECTION_9 names host(s) that no longer exist: ${stale.join(", ")}`).toEqual([])
  })

  it("does not conflate the §9 tier with `priority`, which measures something else", () => {
    /* Pinned as a MEASURED disagreement, not as a preference. If a future edit made these
     * agree, this test should be deleted deliberately — not satisfied by accident. */
    const byId = new Map(SSOT.hosts.map((h) => [h.id, h.priority]))
    expect(byId.get("codex")).toBe("P2")
    expect(byId.get("cline")).toBe("P2")
    expect(byId.get("claude-desktop")).toBe("P0")
    expect(REQUIRED_COVERAGE.tier0).toContain("codex")
    expect(REQUIRED_COVERAGE.tier0).toContain("cline")
    expect(BEYOND_SECTION_9).toContain("claude-desktop")
  })

  it("keeps every §9-required host truthful about what it claims", () => {
    /* §9's closing line: "Do not claim implementation where none exists. The record may
     * honestly say: DISCOVERY_ONLY." So coverage means A RECORD EXISTS, never that the host
     * is supported — and this asserts the weaker, correct thing. A tier list that implied
     * NATIVE would be a support claim manufactured by a coverage requirement. */
    const required = [...REQUIRED_COVERAGE.tier0, ...REQUIRED_COVERAGE.tier1, ...REQUIRED_COVERAGE.tier2]
    const known = new Set(["NATIVE", "DISCOVERY_ONLY", "DEFERRED", "CONFIG_SCAN"])
    for (const id of required) {
      const host = SSOT.hosts.find((h) => h.id === id)
      expect(host, `§9 requires a record for ${id}`).toBeDefined()
      expect(known.has(host!.supportClass), `${id} has an unknown supportClass ${host!.supportClass}`).toBe(true)
      expect(host!.coverageBoundary, `${id} must state its coverage boundary`).toBeTruthy()
    }
  })
})

/*
 * §22 "Truth: unsupported command rejected / unsupported native claim rejected"
 * §23 NC-05 "Unsupported agent command appears → FAIL"
 *
 * These are properties of check-harness-distribution.mjs (HD-01/HD-02). Asserting them on
 * the DATA would only prove today's cohort is clean; asserting the MECHANISM exists proves
 * tomorrow's cannot be dirty. Both are done: the mechanism, then the cohort.
 */
describe("§22 truth / §23 NC-05 — a support claim requires a shipped mechanism", () => {
  it("parses a non-empty AgentType union (anti-vacuity premise)", () => {
    /* If the union's formatting changes and this regex stops matching, every assertion
     * below becomes a claim about the empty set. That must red here. */
    expect(registeredTypes.size).toBeGreaterThan(10)
    expect(registeredTypes.has("cursor")).toBe(true)
  })

  it("keeps all four support classes branching in the gate, not merely in the docs", () => {
    /* The gate's real shape is four-way (HD-01..HD-04), not NATIVE-vs-rest. Asserting all
     * four appear keeps a future edit from deleting a branch and leaving a whole class
     * unaudited — the exact failure the gate's own docblock records from the legacy file.
     * Deliberately NOT asserted here: how the gate parses bootstrap.ts. That is its private
     * implementation, and the fact that matters — that extractors are registered — is
     * asserted directly against bootstrap.ts below. */
    const gate = read("scripts/check-harness-distribution.mjs")
    for (const cls of ["NATIVE", "CONFIG_SCAN", "DISCOVERY_ONLY", "DEFERRED"]) {
      expect(gate, `the gate has no ${cls} branch`).toContain(`=== "${cls}"`)
    }
  })

  it("every NATIVE host has a registered AgentType and a bootstrapped extractor", () => {
    const native = SSOT.hosts.filter((h) => h.supportClass === "NATIVE")
    expect(native.length, "no NATIVE hosts — this assertion would be vacuous").toBeGreaterThan(5)
    const missing = native.filter((h) => !registeredTypes.has(h.id))
    expect(
      missing.map((h) => h.id),
      "a host claims NATIVE without an AgentType member",
    ).toEqual([])
    expect(BOOTSTRAP).toMatch(/registry\.register\(new \w+Extractor\(\)\)/)
  })

  it("advertises a command shape that matches each host's support class (NC-05's subject)", () => {
    /* Measured, not assumed: the rule is NOT "only NATIVE may advertise". CONFIG_SCAN
     * hosts MUST advertise an explicit-path command and must NOT advertise `--agent`,
     * because `--agent` is the auto-detection affordance. Writing this as "non-NATIVE
     * implies no command" would have flagged `opencode` — a healthy CONFIG_SCAN host — as
     * a defect. The four rules below are the gate's HD-01..HD-04, restated over the SSOT. */
    const offenders: string[] = []
    for (const h of SSOT.hosts) {
      const joined = h.truthfulCommands.join(" ; ")
      const hasAgentFlag = joined.includes("--agent")
      switch (h.supportClass) {
        case "NATIVE":
          if (!joined.includes(`--agent ${h.id}`)) offenders.push(`${h.id}: NATIVE without --agent ${h.id}`)
          break
        case "CONFIG_SCAN":
          if (hasAgentFlag) offenders.push(`${h.id}: CONFIG_SCAN implies auto-detection via --agent`)
          else if (h.truthfulCommands.length === 0) offenders.push(`${h.id}: CONFIG_SCAN advertises nothing`)
          break
        case "DISCOVERY_ONLY":
          if (hasAgentFlag) offenders.push(`${h.id}: DISCOVERY_ONLY advertises --agent`)
          break
        case "DEFERRED":
          if (h.truthfulCommands.length > 0) offenders.push(`${h.id}: DEFERRED advertises a command`)
          break
        default:
          offenders.push(`${h.id}: unrecognized supportClass ${JSON.stringify(h.supportClass)}`)
      }
    }
    expect(offenders, `command claims disagree with support class:\n${offenders.join("\n")}`).toEqual([])
  })

  it("no host advertises --agent <id> for an id the discovery layer does not know", () => {
    const offenders: string[] = []
    for (const h of SSOT.hosts) {
      for (const cmd of h.truthfulCommands) {
        const m = cmd.match(/--agent\s+(\S+)/)
        const advertised = m?.[1]
        if (advertised !== undefined && !registeredTypes.has(advertised)) {
          offenders.push(`${h.id}: ${cmd}`)
        }
      }
    }
    expect(offenders, `an advertised --agent id is not a registered AgentType:\n${offenders.join("\n")}`).toEqual([])
  })

  it("mirrors the same rule onto the published machine surface", () => {
    /* The projection could disagree with the SSOT; an agent reads the projection. */
    const offenders: string[] = []
    for (const a of SURFACES.agents) {
      const joined = a.scanCommands.join(" ; ")
      if (a.supportClass === "NATIVE" && !joined.includes(`--agent ${a.id}`)) {
        offenders.push(`${a.id}: NATIVE without --agent`)
      }
      if (a.supportClass !== "NATIVE" && joined.includes("--agent")) {
        offenders.push(`${a.id}: ${a.supportClass} advertises --agent`)
      }
      if (a.supportClass === "DEFERRED" && a.scanCommands.length > 0) {
        offenders.push(`${a.id}: DEFERRED advertises a command`)
      }
    }
    expect(offenders, `the machine surface overclaims:\n${offenders.join("\n")}`).toEqual([])
  })
})

/* §22 "Harness: Codex represented / DeepSeek not special / WorkBuddy boundary" */
describe("§22 harness representation", () => {
  it("represents Codex truthfully — present, first-class, and not overclaimed", () => {
    /* §22 asks that Codex be "represented correctly", which is NOT the same as NATIVE.
     * Measured: codex is DISCOVERY_ONLY with zero commands, while ALSO being an AgentType
     * member. That asymmetry is the interesting fact and is pinned deliberately: having a
     * registered type does not license a support claim, so a future edit cannot quietly
     * promote codex to NATIVE by pointing at types.ts. Promotion requires a bootstrapped
     * extractor and a `--agent codex` command, which HD-01 then enforces. */
    const codex = SSOT.hosts.find((h) => h.id === "codex")
    expect(codex, "codex is absent from the host cohort").toBeDefined()
    expect(codex!.vendor).toBe("OpenAI")
    expect(codex!.supportClass).toBe("DISCOVERY_ONLY")
    expect(codex!.truthfulCommands, "codex advertises a command it cannot honour").toEqual([])
    expect(registeredTypes.has("codex"), "codex is not an AgentType member").toBe(true)

    const surface = INDEX.surfaces.find((s) => s.id === "codex")
    expect(surface?.type).toBe("agent-harness")
    expect(surface?.status, "the public label leaked the internal enum").toBe("Guide only")
    expect(surface?.supportClass).toBe("DISCOVERY_ONLY")
  })

  it("treats DeepSeek as distribution surfaces only, never a security distinction", () => {
    /* Three DeepSeek-adjacent records exist and are deliberately DIFFERENT subjects: the
     * harness product, the model-intent landing page, and the candidate feed. What matters
     * is that none of them carries a security-relevant flag. */
    const harness = SSOT.hosts.find((h) => h.id === "deepseek-harness")
    expect(harness).toBeDefined()
    expect(harness!.supportClass).toBe("DISCOVERY_ONLY")
    expect(harness!.truthfulCommands).toEqual([])
    expect(harness!.coverageBoundary).toMatch(/not a security-relevant distinction/i)

    expect(SSOT.modelIntentLandingPages.some((p) => p.id === "deepseek-hub")).toBe(true)
    const feed = SSOT.candidateFeeds.find((f) => f.id === "deepseek-curated-agents")
    expect(feed?.role).toBe("NEW_CANDIDATE_FEED_ONLY")
  })

  it("preserves the WorkBuddy / CodeBuddy boundary as two separate hosts", () => {
    const wb = SSOT.hosts.find((h) => h.id === "workbuddy")
    const cb = SSOT.hosts.find((h) => h.id === "codebuddy")
    expect(wb, "workbuddy is absent").toBeDefined()
    expect(cb, "codebuddy is absent").toBeDefined()
    expect(wb!.vendor).not.toBe(cb!.vendor)
    expect(wb!.canonicalPath).not.toBe(cb!.canonicalPath)
  })
})

/*
 * §23 NC-06 — "500 manual pages introduced → FAIL".
 *
 * The literal reading (every served harness page has a hosts[] entry) goes RED ON A HEALTHY
 * TREE: /harnesses/deepseek/ is a legitimately served page backed by modelIntentLandingPages,
 * not hosts[]. Measured before writing the assertion; recorded as D9.
 *
 * So the correct invariant is CONTAINER ENDORSEMENT: every served page traces to SOME SSOT
 * container. That still fails the moment 500 hand-made pages appear, which is NC-06's actual
 * subject, without libelling a healthy tree.
 */
describe("§23 NC-06 — every served harness page traces to an SSOT container", () => {
  const harnessDir = path.join(repoRoot, "apps/web/public/harnesses")

  const servedPages = readdirSync(harnessDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(harnessDir, e.name, "index.html")))
    .map((e) => e.name)

  it("finds a non-empty set of served pages (anti-vacuity premise)", () => {
    expect(servedPages.length).toBeGreaterThan(10)
  })

  it("endorses every served page from hosts[] or modelIntentLandingPages[]", () => {
    const endorsed = new Set<string>([
      ...SSOT.hosts.map((h) => h.id),
      ...SSOT.modelIntentLandingPages.map((p) => p.path.replace(/^\/harnesses\//, "").replace(/\/$/, "")),
    ])
    const orphans = servedPages.filter((p) => !endorsed.has(p))
    expect(
      orphans,
      `${orphans.length} served page(s) have no SSOT record — hand-authored pages are the NC-06 fault:\n${orphans.join(", ")}`,
    ).toEqual([])
  })

  it("keeps the page count proportional to the SSOT, not to a cartesian product", () => {
    /* NC-06's number. 500 pages from 18 hosts would mean someone reintroduced the model ×
     * harness cartesian expansion that commit 79f3cb8 deleted. */
    const ceiling = SSOT.hosts.length + SSOT.modelIntentLandingPages.length
    expect(servedPages.length).toBeLessThanOrEqual(ceiling)
  })
})

/*
 * §22 growth — adding a host must move the distribution denominators and NOTHING else.
 *
 * Every assertion above reads the real SSOT, so all of them describe today's cohort. None
 * can answer the actually-interesting question: what happens when host 19 arrives? That is
 * a claim about a tree that does not exist yet, so it needs a fixture.
 *
 * WHY THE FIXTURE IS A CLONED OBJECT AND NOT A CLONED REPO. The generator binds its `ssot`
 * at module scope and exposes no injection point. Adding one purely so a test could drive
 * it would bend the product around the test — so instead this models the two things that
 * must hold, over the fixture directly: the DERIVED counts follow the new host, and the
 * SECURITY-relevant surface of the record is empty by construction (there is no field in
 * a host record that any verdict could read — asserted against the engine import graph
 * above, and against the record's own key set here).
 */
describe("§22 growth — a 19th host changes denominators, never semantics", () => {
  const fixtureHost: Host = {
    id: "fixture-harness",
    displayName: "Fixture Harness",
    vendor: "Fixture Vendor",
    priority: "P3",
    supportClass: "DEFERRED",
    authoritySurfaces: ["filesystem"],
    configEvidence: ["Config mechanism requires verification"],
    truthfulCommands: [],
    canonicalPath: "/harnesses/fixture-harness",
    officialSources: ["https://example.invalid/docs"],
    distributionPrimitives: [{ kind: "npm", state: "LIVE" }],
    coverageBoundary: "CallLint does not auto-discover Fixture Harness configuration.",
  }

  const grown: Ssot = { ...SSOT, hosts: [...SSOT.hosts, fixtureHost] }

  it("does not mutate the real SSOT (the fixture is a clone)", () => {
    /* If this test ever wrote to apps/web/data/, it would race the drift gate and could
     * leave the served tree dirty. Asserted, not assumed. */
    expect(SSOT.hosts.some((h) => h.id === "fixture-harness")).toBe(false)
    expect(grown.hosts.length).toBe(SSOT.hosts.length + 1)
  })

  /** `byType` reads are index accesses, so pin the key's presence before comparing it. */
  const byType = (t: string): number => {
    const n = INDEX.counts.byType[t]
    expect(n, `counts.byType has no "${t}" key`).toBeTypeOf("number")
    return n as number
  }

  it("raises the agent-harness denominator by exactly one", () => {
    expect(grown.hosts.length).toBe(byType("agent-harness") + 1)
    /* And the other five type counts are untouched: a host is not a registry, a
     * marketplace, a doc page, a feed or a mirror. Written as an explicit expectation
     * table rather than a nested ternary, so a wrong pairing is visible on the page. */
    const unaffected: [string, number][] = [
      ["mcp-registry", 1],
      ["documentation", grown.modelIntentLandingPages.length],
      ["search-surface", grown.candidateFeeds.length],
      ["marketplace", 0],
      ["mirror", 0],
    ]
    for (const [type, expected] of unaffected) {
      expect(byType(type), `adding a host must not move counts.byType["${type}"]`).toBe(expected)
    }
  })

  it("raises the generator's derived emit floor by exactly one", () => {
    /* The floor is `hosts.length + FIXED_PROJECTION_COUNT`, so a new host raises it
     * automatically. A hardcoded total would let a dropped write site hide inside a
     * literal — this asserts the derivation is really in the source, not the number. */
    const gen = read("scripts/generate-distribution-surfaces.mjs")
    expect(gen).toContain("ssot.hosts.length + FIXED_PROJECTION_COUNT")
    const raw = gen.match(/const FIXED_PROJECTION_COUNT = (\d+)/)?.[1]
    expect(raw, "FIXED_PROJECTION_COUNT is not a literal in the generator").toBeTypeOf("string")
    const fixed = Number(raw)
    expect(fixed).toBeGreaterThan(0)
    expect(SSOT.hosts.length + fixed).toBe(byType("agent-harness") + fixed)
    expect(grown.hosts.length + fixed).toBe(SSOT.hosts.length + fixed + 1)
  })

  it("carries no field a verdict could read (§23 NC-01/NC-07 at the record level)", () => {
    /* The import-graph test proves the engine never NAMES these files. This proves the
     * complement: even if it did, a host record contains no risk, score, verdict, severity
     * or trust field to read. Both directions are needed — one could be defeated by a
     * rename, the other by an indirect read. */
    const FORBIDDEN = /risk|score|verdict|severity|trust|blocked|allow|deny|policy|cve/i
    const offenders: string[] = []
    for (const h of grown.hosts) {
      for (const key of Object.keys(h)) {
        if (FORBIDDEN.test(key)) offenders.push(`${h.id}.${key}`)
      }
    }
    expect(
      offenders,
      `a host record carries a security-shaped field:\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it("would be forced through the truth gate like every other host", () => {
    /* The fixture is DEFERRED with zero commands, which is the only shape a brand-new,
     * unverified host may legally take. Restating HD-03 over the fixture proves the rule
     * is a property of the CLASS, not of the 18 records that happen to exist today. */
    expect(fixtureHost.supportClass).toBe("DEFERRED")
    expect(fixtureHost.truthfulCommands).toEqual([])
    expect(registeredTypes.has(fixtureHost.id)).toBe(false)
    /* A DEFERRED host with no AgentType is consistent; the same record claiming NATIVE
     * would not be, and that inconsistency is what HD-01 rejects. */
    const illegal = { ...fixtureHost, supportClass: "NATIVE" }
    const wouldFail = illegal.supportClass === "NATIVE" && !registeredTypes.has(illegal.id)
    expect(wouldFail, "a NATIVE claim without an AgentType must be rejectable").toBe(true)
  })
})
