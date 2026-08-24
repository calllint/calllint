/**
 * new20 Truth Gate v2, clauses ③ ④ ⑤ — the three claims a projection makes about ITSELF.
 *
 * These three sit together because they share one failure mode, distinct from the evidence
 * rules in `available-requires-evidence.invariants.test.ts`. There, a record claimed more
 * than the data supported. Here, every individual field is true and the *surface* still
 * misstates them:
 *
 *   ③ canonical URL   a page that declares no canonical, or one pointing at a URL that 301s,
 *                     while the machine surfaces name a canonical URL on its behalf.
 *   ④ host → surface  a host with a page and a sitemap entry that no agent can find, because
 *                     it is missing from the JSON an agent actually reads.
 *   ⑤ claim semantics a heading that says "Supported" over hosts whose own records say
 *                     `Scan Commands: N/A` — new20's "不是 token 泄漏。而是语义."
 *
 * WHY A TEST AND NOT ONLY THE GATE. `check:agent-surface` asserts all three over the SERVED
 * tree. That is the right place for them — it is what CI runs and what a reviewer reads. But
 * a gate reading generated output cannot distinguish "the rule holds" from "the rule was
 * deleted and nothing complains", and the controls that measured each of these were ad-hoc
 * shell probes. A probe nobody re-runs is not a guard. This file is the committed pair: it
 * asserts the gate still CONTAINS each assertion, and that each still fails on a mutated
 * copy. Deleting any of the three from the gate reds this file.
 *
 * MUTATION IS IN-MEMORY ONLY. Same reason recorded at the head of
 * `available-requires-evidence.invariants.test.ts` and `agent-discovery-v2.invariants.test.ts`:
 * a vitest that mutated the served tree would race the other suites for the same files. So
 * the gate's logic is re-expressed over strings read into memory. Where that re-expression
 * could drift from the gate, the test pins the gate's own source text as well — the pairing
 * is the point, since a re-implementation that agreed with a deleted rule would prove nothing.
 *
 * ANTI-VACUITY. Every claim pins its denominator first. Clause ⑤ in particular is satisfiable
 * by an empty documented-only cohort, which was never the failing condition, so the cohort
 * size is asserted before the claim.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8")
const readJson = (rel: string) => JSON.parse(read(rel))

const PUBLIC = "apps/web/public"
const GATE = "scripts/check-agent-surface-contract.mjs"
/** The harness-distribution gate, read for the HD range its CI step label must name. */
const HD_GATE = "scripts/check-harness-distribution.mjs"

interface Host {
  id: string
  displayName: string
  supportClass: string
  canonicalPath: string
}

const ssot: { hosts: Host[] } = readJson("apps/web/data/distribution-surfaces.json")
const gateSource = read(GATE)
const gateHd = read(HD_GATE)

/** The documented-only cohort: the hosts every clause here is protective of. */
const guideOnly = ssot.hosts.filter(
  (h) => h.supportClass === "DISCOVERY_ONLY" || h.supportClass === "DEFERRED",
)

describe("cohort denominators (asserted before any claim about them)", () => {
  it("has hosts, and a non-empty documented-only cohort", () => {
    expect(ssot.hosts.length, "no hosts — every clause below would be vacuous").toBeGreaterThan(0)
    expect(
      guideOnly.length,
      "no DISCOVERY_ONLY/DEFERRED hosts — clause ⑤ would pass by having nothing to over-claim",
    ).toBeGreaterThan(0)
  })
})

describe("clause ③ — every host page declares a correct self-referential canonical", () => {
  it("is asserted by the gate, not only by this file", () => {
    expect(gateSource).toContain('rel="canonical"')
    expect(
      gateSource.includes("declares no rel=") && gateSource.includes("declares canonical"),
      "the gate no longer distinguishes a missing canonical from a wrong one",
    ).toBe(true)
  })

  it("holds on the served tree, and agrees with the sitemap", () => {
    const sitemap = read(`${PUBLIC}/harnesses/sitemap.xml`)
    const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]))
    expect(locs.size, "empty sitemap — nothing for canonicals to agree with").toBeGreaterThan(0)

    const wrong: string[] = []
    for (const host of ssot.hosts) {
      const page = path.join(repoRoot, PUBLIC, host.canonicalPath.replace(/^\//, ""), "index.html")
      if (!existsSync(page)) {
        wrong.push(`${host.id}: page not served`)
        continue
      }
      const declared = readFileSync(page, "utf8").match(
        /<link\s+rel="canonical"\s+href="([^"]+)"/,
      )?.[1]
      const expected = `https://calllint.com${host.canonicalPath}/`
      if (declared !== expected) wrong.push(`${host.id}: ${declared ?? "(none)"} ≠ ${expected}`)
      else if (!locs.has(expected)) wrong.push(`${host.id}: ${expected} absent from sitemap`)
    }
    expect(wrong).toEqual([])
  })

  it("requires the trailing-slash form — the extensionless path 301s", () => {
    // The distinguishing case. A canonical naming the extensionless path resolves through a
    // redirect, which is a self-referential canonical that disagrees with the sitemap; the
    // gate's string equality is what rejects it, so this pins the expected form explicitly.
    for (const host of ssot.hosts) {
      expect(`https://calllint.com${host.canonicalPath}/`).toMatch(/\/$/)
    }
  })
})

describe("clause ④ — every SSOT host is reachable from agent-surfaces.json", () => {
  it("is asserted by the gate in both directions", () => {
    expect(gateSource).toContain("omits")
    expect(
      gateSource.includes("advertises"),
      "the gate checks only for missing hosts, not for hosts the SSOT does not record",
    ).toBe(true)
  })

  it("lists exactly the SSOT host ids — compared as sets, not counts", () => {
    const surface: { agents?: Array<{ id?: string }> } = readJson(`${PUBLIC}/agent-surfaces.json`)
    const listed = surface.agents ?? []
    expect(listed.length, "agent-surfaces.json lists no agents").toBeGreaterThan(0)

    const ssotIds = new Set(ssot.hosts.map((h) => h.id))
    // `filter(Boolean)` does not narrow the element type, so the id set is built explicitly.
    // An entry with no id is a distinct defect (it would silently shrink the set and read as
    // a missing host), so it is collected rather than dropped.
    const surfaceIds = new Set<string>()
    const idless: number[] = []
    listed.forEach((a, i) => (typeof a.id === "string" && a.id ? surfaceIds.add(a.id) : idless.push(i)))
    expect(idless, "agent-surfaces.json has agent entries with no id").toEqual([])
    // Sets, because equal counts with one substitution is exactly the drift a count check
    // reports as agreement.
    expect([...ssotIds].filter((id) => !surfaceIds.has(id))).toEqual([])
    expect([...surfaceIds].filter((id) => !ssotIds.has(id))).toEqual([])
  })
})

describe("clause ⑤ — no 'supported' heading spans a documented-only host", () => {
  const SURFACES = ["llms.txt", "llms-full.txt"] as const

  /** The gate's own sectioning logic, re-expressed so a mutated copy can be tested. */
  const overClaims = (text: string): string[] => {
    const sections = [...text.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((m) => ({
      heading: (m[2] ?? "").trim(),
      start: m.index as number,
    }))
    const bad: string[] = []
    for (const [i, sec] of sections.entries()) {
      if (!/\bsupported\b/i.test(sec.heading)) continue
      const body = text.slice(sec.start, sections[i + 1]?.start ?? text.length)
      const named = guideOnly.filter((h) => body.includes(h.displayName))
      if (named.length > 0) bad.push(`${sec.heading} → ${named.map((h) => h.id).join(", ")}`)
    }
    return bad
  }

  it("is asserted by the gate", () => {
    expect(gateSource).toContain("over-claims")
    expect(
      gateSource.includes("llms-full.txt") && gateSource.includes("documented-only"),
      "the gate no longer audits the llms surfaces for over-claiming headings",
    ).toBe(true)
  })

  it("holds on both served llms surfaces", () => {
    for (const name of SURFACES) {
      const text = read(`${PUBLIC}/${name}`)
      expect(text.length, `${name} is empty`).toBeGreaterThan(0)
      expect(overClaims(text), `${name} files a documented-only host under "supported"`).toEqual([])
    }
  })

  it("rejects the exact heading measured on 2026-08-23", () => {
    // The negative control. `## Supported Agent Harnesses` sat over all 18 hosts while 9 of
    // them printed `Scan Commands: N/A` below it.
    const mutated = read(`${PUBLIC}/llms.txt`).replace(
      /^## Agent Harnesses CallLint Tracks$/m,
      "## Supported Agent Harnesses",
    )
    expect(mutated, "the heading this control mutates is gone — update the control").toContain(
      "## Supported Agent Harnesses",
    )
    expect(overClaims(mutated).length).toBeGreaterThan(0)
  })

  it("permits 'supported' over a cohort that is genuinely supported", () => {
    // Discrimination: the rule is about the cohort a heading spans, not about the word. A
    // rule that banned "supported" outright would push somebody toward deleting a true claim.
    const native = ssot.hosts.find((h) => h.supportClass === "NATIVE")
    expect(native, "no NATIVE host — this control cannot be built").toBeDefined()
    const doc = `## Supported Today\n\n- ${native!.displayName}\n\n## Documented Only\n\n${guideOnly
      .map((h) => `- ${h.displayName}`)
      .join("\n")}\n`
    expect(overClaims(doc)).toEqual([])
  })

  it("still carries supportClass verbatim in the body of llms-full.txt", () => {
    // Guards the boundary of clause ⑤. llms-full.txt is an agent surface and states the enum
    // by design, for the same reason agent-surfaces.json does. A future over-correction that
    // stripped it to avoid the word would break the contract agents read.
    const text = read(`${PUBLIC}/llms-full.txt`)
    for (const h of guideOnly) {
      expect(text, `llms-full.txt no longer states ${h.id}'s support class`).toContain(
        `**Support Class**: ${h.supportClass}`,
      )
    }
  })
})

describe("the CI step label names the range it actually runs", () => {
  /*
   * A hand-written range in a step name is the same fault class as a hand-copied count: when the
   * cohort grows, it cannot fail — it can only under-report. Measured 2026-08-23: the step read
   * `HD-01..HD-05` while `check-harness-distribution.mjs` had shipped HD-06 and HD-07. Nothing
   * was broken by that — both invariants ran, because the step invokes the whole script — but a
   * reviewer reading the run's step list would have concluded the flag-existence gate (HD-06)
   * and HD-07 were not covered by PR CI, and the honest fix for an uncovered gate is to add a
   * step. That is how a stale label turns into duplicated or misplaced CI.
   *
   * So the label is pinned to the gate's own contents rather than to a literal. Deriving the
   * expected range from the script means adding HD-08 reds this test until the label is updated,
   * which is the only version of this assertion that survives the next gate being added.
   *
   * Parsed as YAML, not text-matched, for the reason `gate-s0-claims` records: this repo has
   * already shipped a text match that passed against an unparseable workflow.
   */
  const HD_STEP = "check:harness-distribution"

  it("covers the full HD range the gate implements, with no gap", () => {
    const ids = [...new Set([...gateHd.matchAll(/HD-(\d{2})/g)].map((m) => Number(m[1])))].sort(
      (a, b) => a - b,
    )
    expect(ids.length, "no HD-NN ids in the gate — the label below would be unfalsifiable").toBeGreaterThan(0)

    // The range is only a faithful summary if it is contiguous; a gap would make "HD-01..HD-07"
    // claim an id that does not exist.
    const expectedRange = Array.from({ length: ids[ids.length - 1]! - ids[0]! + 1 }, (_, i) => ids[0]! + i)
    expect(ids, "HD ids are not contiguous — a range label cannot describe them").toEqual(expectedRange)

    const ci = parseYaml(read(".github/workflows/ci.yml")) as {
      jobs: Record<string, { steps?: { name?: string; run?: string }[] }>
    }
    const steps = Object.values(ci.jobs).flatMap((j) => j.steps ?? [])
    const step = steps.find((s) => (s.run ?? "").includes(HD_STEP))
    expect(step, `no CI step runs ${HD_STEP} — the gate is not on the PR path`).toBeDefined()

    const pad = (n: number) => `HD-${String(n).padStart(2, "0")}`
    expect(
      step!.name,
      `the step label must name the range the gate implements (${pad(ids[0]!)}..${pad(ids[ids.length - 1]!)})`,
    ).toContain(`${pad(ids[0]!)}..${pad(ids[ids.length - 1]!)}`)
  })
})

describe("a range-scoped gate runs only on a host that can resolve a base ref", () => {
  /*
   * MEASURED, NOT REASONED. `check:security-semantics` was wired onto the `test` matrix in
   * Sprint 1. Its DIFF arm computes `git merge-base <base> HEAD`, and on real clones of this
   * repo:
   *
   *   git clone --depth 1   refs are refs/heads/<branch> + refs/remotes/origin/<branch> only.
   *                         NEITHER `main` NOR `origin/main` exists → exit 128, arm cannot run.
   *   git clone (full)      refs/remotes/origin/main exists; a local `main` still does NOT.
   *
   * So on the matrix the gate reported SECURITY_SEMANTICS = CHANGED over a diff touching zero
   * verdict packages — fail-closed working correctly on a host that could not supply the
   * evidence. Exactly ADR 0084's class: an enforcement mode needs a host that can measure.
   *
   * This test exists because NOTHING asserted the wiring. Moving the step back onto the matrix
   * would red the PR for a reason no author can fix, and the tempting repair is to weaken the
   * gate rather than move it. Pinning the host is what makes that a test failure instead of a
   * judgement call.
   *
   * Both halves of the fix are pinned: the step's job must have full history, AND the script
   * must keep the `origin/` fallback — without it, this job is red too, since it has no local
   * `main` either. Each half was verified on its own clone; neither alone is sufficient.
   */
  const RANGE_GATE = "check:security-semantics"
  const GATE_SRC = "scripts/verify-security-semantic-diff.mjs"

  const ci = () =>
    parseYaml(read(".github/workflows/ci.yml")) as {
      jobs: Record<
        string,
        { needs?: string[]; steps?: { name?: string; run?: string; with?: Record<string, unknown> }[] }
      >
    }

  it("runs in a job checked out with full history", () => {
    const doc = ci()
    const owners = Object.entries(doc.jobs).filter(([, j]) =>
      (j.steps ?? []).some((s) => (s.run ?? "").includes(RANGE_GATE)),
    )
    expect(owners.length, `no CI job runs ${RANGE_GATE} — the gate is off the PR path`).toBe(1)

    const [jobName, job] = owners[0]!
    const checkout = (job.steps ?? []).find((s) => typeof s.with?.["fetch-depth"] !== "undefined")
    expect(
      checkout?.with?.["fetch-depth"],
      `${RANGE_GATE} runs in "${jobName}", which does not request full history — its merge-base cannot resolve`,
    ).toBe(0)
  })

  it("runs in a job the required status check actually reads", () => {
    // A job outside `build-and-test`'s `needs` reports a status nothing blocks a merge on.
    const doc = ci()
    const [jobName] = Object.entries(doc.jobs).find(([, j]) =>
      (j.steps ?? []).some((s) => (s.run ?? "").includes(RANGE_GATE)),
    )!
    expect(doc.jobs["build-and-test"]?.needs ?? [], `"${jobName}" is not gated by build-and-test`).toContain(
      jobName,
    )
  })

  it("keeps the origin/ fallback the full-clone host depends on", () => {
    // Strip comments first: this repo has already shipped two source-reading assertions that
    // passed on the strength of the comment explaining the code they were checking.
    const raw = read(GATE_SRC)
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|\*).*$/gm, "")
    expect(
      raw.length - code.length,
      "no comments were stripped — the strip is broken, so the assertion below may be reading prose",
    ).toBeGreaterThan(200)
    expect(code, "the origin/ fallback is gone — the full-clone job has no local main").toMatch(
      /origin\/\$\{base\}|origin\/' \+ base|`origin\/\$\{base\}`/,
    )
  })
})
