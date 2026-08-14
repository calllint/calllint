/**
 * Phase 2.4 Batch 9 — tests for the Gate 2.4-B / 2.4-C evaluators.
 *
 * The point of these tests is NEGATIVE CONTROLS. An evaluator that only ever says
 * "pass" is worse than no evaluator, because it launders an unmeasured claim into a
 * committed artifact. So every measure here is also driven with a deliberately
 * broken input and asserted to FAIL. Plus the honesty property that matters most:
 * with no human panel recorded, Gate 2.4-B is PENDING_HUMAN_PANEL — never PASSED.
 */
import { describe, it, expect } from "vitest"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import {
  CANONICAL_FIXTURES,
  FIVE_SECOND_MIN_PANEL,
  PUBLISHER_INJECTION_BLURBS,
  canonicalProjection,
  DOGFOOD_SANDBOX_MARKER,
  decideGateB,
  evaluateAgentContract,
  evaluateHumanCapsule,
  measureFiveSecondPanel,
  partitionPanelFreshness,
  panelMeasuredSurface,
  panelSurfaceDigest,
  stylesheetHrefs,
  auditShownArtifact,
  extractCapsuleAnswers,
  FIVE_SECOND_QUESTIONS,
  redactRunVaryingNote,
  renderSafeInstall,
  type FiveSecondPanelStore,
  type FiveSecondResponse,
  type HumanCapsuleStructure,
} from "../src/index.js"
import { reseatResponses } from "../../../scripts/phase-2.4-panel.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

/**
 * canonicalSlug → the SERVED page's measured-surface digest (ADR 0079 D2). Uses
 * the shipped `panelSurfaceDigest`, not a local re-implementation, so this test
 * cannot disagree with `scripts/phase-2.4-panel.ts` about what freshness compares.
 */
function servedInstallSurfaceDigests(): Map<string, string> {
  const root = path.join(repoRoot, "apps", "web", "public", "install")
  const out = new Map<string, string>()
  if (!fs.existsSync(root)) return out
  for (const cohort of fs.readdirSync(root)) {
    const dir = path.join(root, cohort)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const name of fs.readdirSync(dir)) {
      const page = path.join(dir, name, "index.html")
      if (fs.existsSync(page)) out.set(`${cohort}/${name}`, panelSurfaceDigest(fs.readFileSync(page, "utf8")))
    }
  }
  return out
}
const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(
  JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas/calllint.agent-adoption-contract.v1.schema.json"), "utf8")),
)
const validateSchema = (c: unknown): string[] =>
  validate(c) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""}`)

const projections = CANONICAL_FIXTURES.map((f) => ({ f, p: canonicalProjection(f) }))

describe("canonical fixture cohort", () => {
  it("binds five REAL golden fixtures covering every verdict and route", () => {
    expect(CANONICAL_FIXTURES).toHaveLength(5)
    for (const { f, p } of projections) {
      expect(p.publicObservation.verdict).toBe(f.expectVerdict)
      expect(p.installability).toBe(f.expectInstallability)
    }
    // All five installability states are distinct — the cohort covers the surface
    // rather than testing one route five times.
    expect(new Set(projections.map((x) => x.p.installability)).size).toBe(5)
  })

  it("is projected without a clock, so the whole eval is reproducible", () => {
    for (const { f } of projections) {
      expect(canonicalProjection(f).agentContract.contract.generatedAt).toBe(
        canonicalProjection(f).agentContract.contract.generatedAt,
      )
    }
  })
})

describe("Gate 2.4-B — structural precondition", () => {
  it("passes on every shipped Install page", () => {
    for (const { p } of projections) {
      const r = evaluateHumanCapsule(p, renderSafeInstall(p))
      expect(r.pass, JSON.stringify(r.checks.filter((c) => !c.pass))).toBe(true)
      expect(r.answers.target).not.toBeNull()
      expect(r.answers.consequence).toBe(p.consequenceSummary)
      // The CTA now reads "<verb phrase> <display name>" (R-2), so this asserts
      // composition rather than equality — and asserts BOTH halves, because a CTA that
      // kept the phrase and dropped the subject is exactly the generic-chrome regression
      // this change set out to fix.
      expect(r.answers.action).toContain(p.humanDisposition.primaryCta)
      expect(r.answers.action).toContain(p.displayName)
    }
  })

  it("FAILS when a second primary CTA is introduced (negative control)", () => {
    const { p } = projections[0] as { p: ReturnType<typeof canonicalProjection> }
    const html = renderSafeInstall(p)
    const broken = html.replace("</body>", '<a class="install-cta" href="#">Install now</a></body>')
    const r = evaluateHumanCapsule(p, broken)
    expect(r.pass).toBe(false)
    expect(r.checks.find((c) => c.id === "exactly-one-primary-cta")?.pass).toBe(false)
  })

  it("FAILS when more than five authority facts are introduced (negative control)", () => {
    const { p } = projections[1] as { p: ReturnType<typeof canonicalProjection> }
    const html = renderSafeInstall(p)
    const extras = Array.from({ length: 6 }, (_, i) => `<li data-observed="true">extra${i}</li>`).join("")
    const broken = html.replace("</ul>", `${extras}</ul>`)
    const r = evaluateHumanCapsule(p, broken)
    expect(r.checks.find((c) => c.id === "at-most-five-authority-facts")?.pass).toBe(false)
  })

  it("FAILS when non-whitelist decision JavaScript appears (negative control)", () => {
    const { p } = projections[0] as { p: ReturnType<typeof canonicalProjection> }
    const broken = renderSafeInstall(p).replace("</body>", "<script>decide()</script></body>")
    const r = evaluateHumanCapsule(p, broken)
    expect(r.checks.find((c) => c.id === "copy-only-javascript-whitelist")?.pass).toBe(false)
  })

  it("PASSES the JS whitelist when only the copy-assist script is present", () => {
    const { p } = projections[0] as { p: ReturnType<typeof canonicalProjection> }
    const r = evaluateHumanCapsule(p, renderSafeInstall(p))
    expect(r.checks.find((c) => c.id === "copy-only-javascript-whitelist")?.pass).toBe(true)
  })

  it("FAILS when the consequence sentence is altered (negative control)", () => {
    const { p } = projections[1] as { p: ReturnType<typeof canonicalProjection> }
    const broken = renderSafeInstall(p).replace(p.consequenceSummary, "Totally safe, install away.")
    const r = evaluateHumanCapsule(p, broken)
    expect(r.checks.find((c) => c.id === "answer-consequence-present")?.pass).toBe(false)
  })
})

describe("Gate 2.4-B — the human panel is DATA, never simulated", () => {
  const structures: HumanCapsuleStructure[] = projections.map((x) =>
    evaluateHumanCapsule(x.p, renderSafeInstall(x.p)),
  )
  const panel = (n: number, correct = true): FiveSecondPanelStore => ({
    schema: "calllint.five-second-panel.v0",
    responses: Array.from({ length: n }, (_, i): FiveSecondResponse => ({
      participant: `p${i}`,
      canonicalSlug: "calllint-fixtures-safe-time",
      at: "2026-07-28T00:00:00.000Z",
      correct: { target: true, consequence: correct, action: true },
      shownFrom: "http://127.0.0.1",
      shownDigest: `sha256:${"a".repeat(64)}`,
    })),
  })

  it("an EMPTY panel is PENDING_HUMAN_PANEL — structure alone can never pass the gate", () => {
    const empty = measureFiveSecondPanel({ schema: "calllint.five-second-panel.v0", responses: [] })
    expect(empty.recognition.target).toBeNull()
    expect(structures.every((s) => s.pass)).toBe(true)
    expect(decideGateB(structures, empty)) .toBe("PENDING_HUMAN_PANEL")
  })

  it("the committed panel store, when recorded and fresh, has ≥10 responses and passes Gate 2.4-B", () => {
    const store = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "artifacts/phase-2.4/five-second-panel-store.json"), "utf8"),
    ) as FiveSecondPanelStore
    expect(store.schema).toBe("calllint.five-second-panel.v0")
    const { fresh, stale } = partitionPanelFreshness(store, servedInstallSurfaceDigests())
    // Honest empty or fully-stale store is PENDING — pages were rebuilt and humans must re-record.
    if (fresh.length < FIVE_SECOND_MIN_PANEL) {
      expect(decideGateB(structures, measureFiveSecondPanel({ ...store, responses: fresh }))).toBe(
        "PENDING_HUMAN_PANEL",
      )
      return
    }
    expect(stale).toEqual([])
    const panel = measureFiveSecondPanel({ ...store, responses: fresh })
    expect(panel.recognition.target).toBe(1)
    expect(panel.recognition.consequence).toBe(1)
    expect(panel.recognition.action).toBe(1)
    expect(decideGateB(structures, panel)).toBe("PASSED")
  })

  it("an UNDERSIZED panel stays pending even at 100% recognition", () => {
    const m = measureFiveSecondPanel(panel(FIVE_SECOND_MIN_PANEL - 1))
    expect(m.recognition.target).toBe(1)
    expect(decideGateB(structures, m)).toBe("PENDING_HUMAN_PANEL")
  })

  it("a recorded panel below the 90% floor FAILS rather than pends", () => {
    const store = panel(FIVE_SECOND_MIN_PANEL)
    const mixed: FiveSecondPanelStore = {
      schema: "calllint.five-second-panel.v0",
      responses: store.responses.map((r, i) =>
        i < 3 ? { ...r, correct: { ...r.correct, consequence: false } } : r,
      ),
    }
    const m = measureFiveSecondPanel(mixed)
    expect(m.recognition.consequence).toBeCloseTo(0.7, 5)
    expect(decideGateB(structures, m)).toBe("FAILED")
  })

  it("passes only when structure holds AND a sufficient panel meets the floor", () => {
    expect(decideGateB(structures, measureFiveSecondPanel(panel(FIVE_SECOND_MIN_PANEL)))).toBe("PASSED")
  })

  it("a broken capsule FAILS the gate even with a perfect panel", () => {
    const broken = [...structures, { ...(structures[0] as HumanCapsuleStructure), pass: false }]
    expect(decideGateB(broken, measureFiveSecondPanel(panel(FIVE_SECOND_MIN_PANEL)))).toBe("FAILED")
  })

  // --- freshness: recognition is evidence about ONE MEASURED SURFACE ----------
  //
  // ADR 0079: the basis is the measured surface, not the whole page. These tests
  // drive that from the SHIPPED bytes, because the failure that motivated the ADR
  // was a real rebake — a synthetic digest pair cannot tell a provenance-only edit
  // apart from a copy edit, which is the entire distinction under test.

  const SURFACE_A = `sha256:${"a".repeat(64)}`
  const SURFACE_B = `sha256:${"b".repeat(64)}`
  const servedAs = (d: string) => new Map([["calllint-fixtures-safe-time", d]])
  const seated = (n: number, surface = SURFACE_A): FiveSecondPanelStore => ({
    ...panel(n),
    responses: panel(n).responses.map((r) => ({ ...r, shownSurfaceDigest: surface })),
  })

  it("responses are FRESH while the served page still digests to the surface shown", () => {
    const f = partitionPanelFreshness(seated(FIVE_SECOND_MIN_PANEL), servedAs(SURFACE_A))
    expect(f.fresh).toHaveLength(FIVE_SECOND_MIN_PANEL)
    expect(f.stale).toEqual([])
    expect(decideGateB(structures, measureFiveSecondPanel({ ...panel(0), responses: f.fresh }))).toBe("PASSED")
  })

  it("a SURFACE edit makes every response measuring it stale, demoting a PASS to pending", () => {
    const store = seated(FIVE_SECOND_MIN_PANEL)
    // The measured surface moved: it now digests to B, but the panel saw A.
    const f = partitionPanelFreshness(store, servedAs(SURFACE_B))
    expect(f.fresh).toEqual([])
    expect(f.stale).toHaveLength(FIVE_SECOND_MIN_PANEL)
    expect(f.stale[0]).toMatchObject({
      reason: "SURFACE_CHANGED",
      shownSurfaceDigest: SURFACE_A,
      currentSurfaceDigest: SURFACE_B,
    })
    // Fails CLOSED: the new page inherits nothing.
    expect(decideGateB(structures, measureFiveSecondPanel({ ...store, responses: f.fresh }))).toBe(
      "PENDING_HUMAN_PANEL",
    )
  })

  it("a REMOVED page is stale as PAGE_GONE, not a silent pass", () => {
    const f = partitionPanelFreshness(seated(2), new Map())
    expect(f.fresh).toEqual([])
    expect(f.stale.map((s) => s.reason)).toEqual(["PAGE_GONE", "PAGE_GONE"])
    expect(f.stale.map((s) => s.currentSurfaceDigest)).toEqual([null, null])
  })

  it("names WHY each response is excluded — one absence must not answer for two faults", () => {
    // 0077's lesson: a single nullable field made one absence carry two different
    // diagnoses. Each reason must be reachable on its own, in one partition.
    const store: FiveSecondPanelStore = {
      schema: "calllint.five-second-panel.v0",
      responses: [
        { ...(seated(1).responses[0] as FiveSecondResponse), participant: "gone", canonicalSlug: "absent/page" },
        { ...(seated(1).responses[0] as FiveSecondResponse), participant: "moved", shownSurfaceDigest: SURFACE_B },
        { ...(panel(1).responses[0] as FiveSecondResponse), participant: "pre-0079" },
      ],
    }
    const f = partitionPanelFreshness(store, servedAs(SURFACE_A))
    expect(f.fresh).toEqual([])
    expect(f.stale.map((s) => [s.participant, s.reason])).toEqual([
      ["gone", "PAGE_GONE"],
      ["moved", "SURFACE_CHANGED"],
      ["pre-0079", "UNKNOWN_BASIS"],
    ])
  })

  it("a response with NO surface digest is UNKNOWN_BASIS and does not count toward the floor", () => {
    // ADR 0079 D3: absent basis is UNKNOWN, and UNKNOWN never auto-upgrades to
    // fresh. A full 10-response panel recorded pre-0079 must still PEND.
    const f = partitionPanelFreshness(panel(FIVE_SECOND_MIN_PANEL), servedAs(SURFACE_A))
    expect(f.fresh).toEqual([])
    expect(f.stale.every((s) => s.reason === "UNKNOWN_BASIS")).toBe(true)
    expect(f.stale.every((s) => s.shownSurfaceDigest === null)).toBe(true)
    expect(decideGateB(structures, measureFiveSecondPanel({ ...panel(0), responses: f.fresh }))).toBe(
      "PENDING_HUMAN_PANEL",
    )
  })

  // --- what the basis includes, measured on the SHIPPED page (ADR 0079 D1/D7) --

  const shipped = (): string =>
    fs.readFileSync(path.join(repoRoot, "apps/web/public/install/mcp-registry/ai.adeu-adeu/index.html"), "utf8")

  it("a REBAKE that moves only the contract digest leaves the surface digest UNCHANGED", () => {
    // This is the exact edit that voided all ten responses before 0079: the page's
    // whole-page digest moved, in two places, both carrying the contract digest.
    const html = shipped()
    const contract = /contract=sha256:([0-9a-f]{64})/.exec(html)?.[1]
    expect(contract, "the deep link must carry a contract digest or this control proves nothing").toBeTruthy()
    const rebaked = html.split(contract as string).join("0".repeat(64))
    expect(rebaked, "the mutation must actually change the page").not.toBe(html)
    expect(panelSurfaceDigest(rebaked)).toBe(panelSurfaceDigest(html))
  })

  it("a RESTYLE that moves only the stylesheet href CHANGES the surface digest", () => {
    // The other half of D1, able to fire alone: excluding provenance must not
    // start inheriting recognition across a page that renders differently.
    const html = shipped()
    expect(stylesheetHrefs(html)).toEqual(["/styles/tokens.css"])
    const restyled = html.replace("/styles/tokens.css", "/styles/other.css")
    expect(panelMeasuredSurface(restyled).answers).toEqual(panelMeasuredSurface(html).answers)
    expect(panelSurfaceDigest(restyled)).not.toBe(panelSurfaceDigest(html))
  })

  it("a reworded graded ANSWER changes the surface digest", () => {
    const html = shipped()
    const consequence = extractCapsuleAnswers(html).consequence
    expect(consequence).toBeTruthy()
    const reworded = html.split(consequence as string).join("Totally safe, install away.")
    expect(panelSurfaceDigest(reworded)).not.toBe(panelSurfaceDigest(html))
  })

  it("binds the surface's MEMBERSHIP, so dropping a component reds a test", () => {
    // Without this, `panelMeasuredSurface` could silently narrow to just the
    // answers and every test above would stay green — the basis would weaken with
    // no failing mode. Asserted on real bytes, so each component is non-empty.
    const s = panelMeasuredSurface(shipped())
    expect(Object.keys(s).sort()).toEqual(["answers", "sections", "stylesheets"])
    expect(Object.keys(s.answers).sort()).toEqual([...FIVE_SECOND_QUESTIONS].sort())
    expect(s.stylesheets).toEqual(["/styles/tokens.css"])
    expect(s.sections).toEqual(["install-identity", "install-disposition", "install-consequence"])
  })

  it("EXCLUDES provenance the participant cannot read in five seconds", () => {
    // Stated as a property of the surface rather than of one digest: no serialized
    // component may contain the contract digest, so adding a provenance field to
    // the surface later would red here.
    const html = shipped()
    const contract = /contract=sha256:([0-9a-f]{64})/.exec(html)?.[1] as string
    expect(JSON.stringify(panelMeasuredSurface(html))).not.toContain(contract)
  })

  it("digests the surface, rather than returning it — a basis is comparable, not readable", () => {
    const d = panelSurfaceDigest(shipped())
    expect(d).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  // --- recovery refuses rather than substitutes (ADR 0079 D4/D7) --------------
  //
  // Driven through `reseatResponses`' injected lookup, not through a real repo: the
  // committed store happens to be fully recoverable (a real `panel:reseat` run
  // reseated 10 and refused 0), so the refusal branch has no failing mode unless a
  // test can supply bytes that do NOT match a recorded `shownDigest`.

  const sha256Of = (s: string): string => `sha256:${crypto.createHash("sha256").update(s).digest("hex")}`
  const preAdr = (slug: string, shownDigest: string): FiveSecondResponse => ({
    ...(panel(1).responses[0] as FiveSecondResponse),
    canonicalSlug: slug,
    shownDigest,
  })
  const storeOf = (responses: FiveSecondResponse[]): FiveSecondPanelStore => ({
    schema: "calllint.five-second-panel.v0",
    responses,
  })

  it("RESEATS a response from bytes whose sha256 equals its recorded shownDigest", () => {
    const html = shipped()
    const store = storeOf([preAdr("mcp-registry/ai.adeu-adeu", sha256Of(html))])
    const out = reseatResponses(store, () => [Buffer.from(html, "utf8")])
    expect(out.refusals).toEqual([])
    expect(out.changed).toBe(1)
    expect(out.responses).toHaveLength(1)
    // The recovered basis is the basis the served page would produce today, so a
    // reseated response is fresh — recovery, not a widened rule.
    expect(out.responses[0]?.shownSurfaceDigest).toBe(panelSurfaceDigest(html))
  })

  it("REFUSES a response whose recorded bytes history does not offer", () => {
    // The substitution 0079 exists to prevent: today's page is offered, but this
    // response recorded different bytes. It must stay UNKNOWN-basis, not be credited.
    const store = storeOf([preAdr("mcp-registry/ai.adeu-adeu", sha256Of("what the participant actually saw"))])
    const out = reseatResponses(store, () => [Buffer.from(shipped(), "utf8")])
    expect(out.changed).toBe(0)
    expect(out.refusals).toHaveLength(1)
    expect(out.refusals[0]).toContain("the shown artifact is not recoverable")
    expect(out.responses).toHaveLength(1)
    expect(out.responses[0]?.shownSurfaceDigest).toBeUndefined()
  })

  it("REFUSES a response whose page has no history at all", () => {
    const store = storeOf([preAdr("absent/page", sha256Of("x"))])
    const out = reseatResponses(store, () => [])
    expect(out.changed).toBe(0)
    expect(out.refusals).toHaveLength(1)
  })

  it("refuses PER RESPONSE — one unrecoverable session does not discard the rest", () => {
    // The mixed case decides the exit code: `reseat` returns 2 when anything was
    // refused, even though it wrote the recoverable ones.
    const html = shipped()
    const store = storeOf([
      preAdr("mcp-registry/ai.adeu-adeu", sha256Of(html)),
      preAdr("mcp-registry/ai.adeu-adeu", sha256Of("never served")),
    ])
    const out = reseatResponses(store, () => [Buffer.from(html, "utf8")])
    expect(out.changed).toBe(1)
    expect(out.refusals).toHaveLength(1)
    expect(out.responses.map((r) => r.shownSurfaceDigest === undefined)).toEqual([false, true])
  })

  it("leaves an ALREADY-seated response untouched — reseat is not a rewrite", () => {
    const store: FiveSecondPanelStore = { ...seated(1) }
    let consulted = 0
    const out = reseatResponses(store, () => {
      consulted += 1
      return []
    })
    expect(out.changed).toBe(0)
    expect(out.refusals).toEqual([])
    expect(consulted, "a seated response must not be re-derived from history").toBe(0)
    expect(out.responses[0]?.shownSurfaceDigest).toBe(SURFACE_A)
  })

  // --- the artifact a session is allowed to measure (PR P-4b) ----------------

  const PAGE = '<html><head><link rel="stylesheet" href="/styles/tokens.css" /></head><body>x</body></html>'
  const withCss = (body: string | null) => new Map([["/styles/tokens.css", body]])

  it("accepts the served page when it matches committed and its stylesheet resolves", () => {
    const a = auditShownArtifact({ servedHtml: PAGE, committedHtml: PAGE, stylesheetBodies: withCss(":root{}") })
    expect(a.ok).toBe(true)
    expect(a.problems).toEqual([])
    expect(a.stylesheets).toEqual(["/styles/tokens.css"])
  })

  it("REFUSES when the stylesheet does not resolve — the file:// failure this guards", () => {
    const a = auditShownArtifact({ servedHtml: PAGE, committedHtml: PAGE, stylesheetBodies: withCss(null) })
    expect(a.ok).toBe(false)
    expect(a.problems.some((p) => p.includes("render unstyled"))).toBe(true)
  })

  it("REFUSES an empty stylesheet — resolving is not the same as styling", () => {
    const a = auditShownArtifact({ servedHtml: PAGE, committedHtml: PAGE, stylesheetBodies: withCss("  \n") })
    expect(a.ok).toBe(false)
    expect(a.problems.some((p) => p.includes("is empty"))).toBe(true)
  })

  it("REFUSES a page with no stylesheet at all — a post-P-4b regression", () => {
    const bare = "<html><head></head><body>x</body></html>"
    const a = auditShownArtifact({ servedHtml: bare, committedHtml: bare, stylesheetBodies: new Map() })
    expect(a.ok).toBe(false)
    expect(a.problems.some((p) => p.includes("references no stylesheet"))).toBe(true)
  })

  it("REFUSES when the served bytes drift from the committed page", () => {
    const a = auditShownArtifact({
      servedHtml: PAGE,
      committedHtml: PAGE.replace("x", "y"),
      stylesheetBodies: withCss(":root{}"),
    })
    expect(a.ok).toBe(false)
    expect(a.problems.some((p) => p.includes("differ from the committed page"))).toBe(true)
  })

  const shippedPage = (): string =>
    fs.readFileSync(path.join(repoRoot, "apps/web/public/install/mcp-registry/ai.adeu-adeu/index.html"), "utf8")

  it("finds every stylesheet the SHIPPED page references", () => {
    expect(stylesheetHrefs(shippedPage())).toEqual(["/styles/tokens.css"])
  })

  it("derives the operator's grading key from the SHIPPED page — all three present", () => {
    const a = extractCapsuleAnswers(shippedPage())
    for (const q of FIVE_SECOND_QUESTIONS) {
      expect(a[q], `${q} must be extractable or the operator cannot grade`).toBeTruthy()
    }
    // It must agree with the structural evaluator, or the gate and the operator
    // would be grading against different text.
    const { p } = projections[0] as { p: ReturnType<typeof canonicalProjection> }
    const rendered = renderSafeInstall(p)
    expect(extractCapsuleAnswers(rendered)).toEqual(evaluateHumanCapsule(p, rendered).answers)
  })

  it("reports an absent answer as null rather than inventing one", () => {
    expect(extractCapsuleAnswers("<html><body></body></html>")).toEqual({
      target: null,
      consequence: null,
      action: null,
    })
  })

  it("partitions per response — one stale session does not discard the rest", () => {
    const store = seated(FIVE_SECOND_MIN_PANEL)
    const withOneStale: FiveSecondPanelStore = {
      ...store,
      responses: store.responses.map((r, i) => (i === 0 ? { ...r, shownSurfaceDigest: SURFACE_B } : r)),
    }
    const f = partitionPanelFreshness(withOneStale, servedAs(SURFACE_A))
    expect(f.fresh).toHaveLength(FIVE_SECOND_MIN_PANEL - 1)
    expect(f.stale).toHaveLength(1)
    // 9 fresh responses is below the floor, so the gate pends rather than passing.
    expect(decideGateB(structures, measureFiveSecondPanel({ ...store, responses: f.fresh }))).toBe(
      "PENDING_HUMAN_PANEL",
    )
  })
})

describe("Gate 2.4-C — agent contract", () => {
  it("passes every assertion on all five fixtures", () => {
    for (const { f, p } of projections) {
      const r = evaluateAgentContract(p, validateSchema, (d) => canonicalProjection(f, d))
      expect(r.pass, JSON.stringify(r)).toBe(true)
      expect(r.schemaErrors).toEqual([])
      expect(r.recommendedNextActionCount).toBe(1)
      expect(r.publisherChangedDecision).toBe(0)
      expect(r.guessedHostRoute).toBe(0)
      expect(r.blockApplyRoute).toBe(0)
    }
  })

  it("never routes a BLOCK verdict to an apply, and never names a host", () => {
    for (const { p } of projections) {
      const action = p.agentContract.recommendedNextAction
      if (p.publicObservation.verdict === "BLOCK") expect(action.kind).toBe("INSPECT_BLOCKERS")
      if (action.kind === "PREPARE_LOCALLY") expect(action.arguments.host).toBeNull()
    }
  })

  it("DETECTS a publisher blurb that reaches a decision field (negative control)", () => {
    // A deliberately leaky re-projection: the blurb is spliced into a decision-scoped
    // field. If evaluateAgentContract cannot see this, the measure is worthless.
    const { f, p } = projections[0] as { f: (typeof CANONICAL_FIXTURES)[number]; p: ReturnType<typeof canonicalProjection> }
    const leaky = (d: string | null): ReturnType<typeof canonicalProjection> => {
      const base = canonicalProjection(f, d)
      if (d === null) return base
      return {
        ...base,
        agentContract: {
          ...base.agentContract,
          publicObservation: { ...base.agentContract.publicObservation, summary: d },
        },
      } as ReturnType<typeof canonicalProjection>
    }
    const r = evaluateAgentContract(p, validateSchema, leaky)
    expect(r.publisherChangedDecision).toBe(PUBLISHER_INJECTION_BLURBS.length)
    expect(r.pass).toBe(false)
  })

  it("DETECTS a contract that fails the shipped schema (negative control)", () => {
    const { f, p } = projections[0] as { f: (typeof CANONICAL_FIXTURES)[number]; p: ReturnType<typeof canonicalProjection> }
    const broken = {
      ...p,
      agentContract: { ...p.agentContract, schema: "not.a.real.schema" },
    } as unknown as ReturnType<typeof canonicalProjection>
    const r = evaluateAgentContract(broken, validateSchema, (d) => canonicalProjection(f, d))
    expect(r.schemaValid).toBe(false)
    expect(r.pass).toBe(false)
  })

  it("DETECTS a non-deterministic projection (negative control)", () => {
    const { p } = projections[0] as { p: ReturnType<typeof canonicalProjection> }
    let n = 0
    const drifting = (): ReturnType<typeof canonicalProjection> => {
      n++
      return {
        ...p,
        agentContract: {
          ...p.agentContract,
          publicObservation: { ...p.agentContract.publicObservation, summary: `drift-${n}` },
        },
      } as ReturnType<typeof canonicalProjection>
    }
    const r = evaluateAgentContract(p, validateSchema, drifting)
    expect(r.byteIdenticalOnReproject).toBe(false)
    expect(r.pass).toBe(false)
  })
})

describe("committed Phase 2.4 evidence", () => {
  const read = (f: string): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, "artifacts/phase-2.4", f), "utf8")) as Record<string, unknown>

  it("records Gate 2.4-B with a 100% structural precondition; human panel PASSED or PENDING", () => {
    const a = read("human-five-second-test.json")
    expect(a.gate).toBe("2.4-B")
    expect(["PASSED", "PENDING_HUMAN_PANEL"]).toContain(a.status)
    expect((a.structuralPrecondition as { pass: boolean }).pass).toBe(true)
    expect((a.structuralPrecondition as { pagesEvaluated: number }).pagesEvaluated).toBe(5)
    const hp = a.humanPanel as { status: string; responses: number; recognition: Record<string, number> }
    if (a.status === "PASSED") {
      expect(hp.status).toBe("RECORDED")
      expect(hp.responses).toBeGreaterThanOrEqual(FIVE_SECOND_MIN_PANEL)
      for (const q of FIVE_SECOND_QUESTIONS) expect(hp.recognition[q]).toBeGreaterThanOrEqual(0.9)
      expect((a.blockers as string[]) ?? []).toEqual([])
    } else {
      // PENDING means the FLOOR is unmet — not that the store is empty. Before ADR
      // 0079 those coincided, because the whole-page basis voided every response and
      // `fresh` was always []; `responses === 0` passed for a reason the gate never
      // asserts. Assert the gate's own condition instead, and keep the honesty
      // property that a pending artifact must still say WHY.
      expect(hp.responses).toBeLessThan(FIVE_SECOND_MIN_PANEL)
      expect(hp.status).toBe(hp.responses === 0 ? "NOT_RUN" : "RECORDED")
      expect((a.blockers as string[]) ?? []).not.toEqual([])
    }
  })

  it("records Gate 2.4-C as passed with every rate at 1 and every count at 0", () => {
    const a = read("agent-contract-eval.json")
    expect(a.gate).toBe("2.4-C")
    expect(a.status).toBe("PASSED")
    const m = a.measures as Record<string, number>
    const t = a.thresholds as Record<string, number>
    for (const k of Object.keys(t)) expect(m[k], k).toBe(t[k])
  })

  it("records the Gate 2.4-G dogfood over the whole shipped chain", () => {
    const a = read("e2e-dogfood.json")
    expect(a.gate).toBe("2.4-G")
    expect(a.fixturesEvaluated).toBe(5)
    // The status must agree with the recorded failures — an artifact that says
    // PASSED while listing failures would be the exact dishonesty these gates exist
    // to prevent.
    const failures = a.failures as string[]
    expect(a.status).toBe(failures.length === 0 ? "PASSED" : "FAILED")
    // Whatever the verdict, the safety invariants must hold on every fixture.
    for (const f of a.fixtures as { id: string; steps: { workspaceFiles: string[]; persistentComponents: string[] }[] }[]) {
      for (const s of f.steps) {
        expect(s.workspaceFiles, f.id).toEqual([])
        expect(s.persistentComponents, f.id).toEqual([])
      }
    }
  })
})

/**
 * The OS-portability of the dogfood artifact.
 *
 * This block exists because of a real failure: the redactor used to enumerate temp
 * directory prefixes (a Windows drive letter and `/tmp/`) and therefore missed
 * macOS's `/var/folders/…`. The raw sandbox path leaked into the notes, so
 * `e2e-dogfood.json` was byte-stable on Windows and Linux and PERMANENTLY STALE on
 * macOS. `ci:local` on one machine cannot see that; only the 3-OS matrix could, and
 * it did — as a red CI leg rather than a test.
 *
 * These cases feed the redactor the literal path shapes of every OS in the matrix,
 * so a machine that has only one of them still proves the claim for all three. That
 * is the whole reason the function was moved out of `scripts/`.
 */
describe("redactRunVaryingNote — cross-OS artifact stability", () => {
  // Real `os.tmpdir()` shapes. macOS is listed twice on purpose: `mkdtempSync`
  // returns the `/var/folders` form while some tools resolve the `/private` realpath,
  // and both must redact to the same token.
  const SANDBOXES: readonly { os: string; dir: string }[] = [
    { os: "windows", dir: `C:\\Users\\runner\\AppData\\Local\\Temp\\${DOGFOOD_SANDBOX_MARKER}A1b2C3` },
    { os: "linux", dir: `/tmp/${DOGFOOD_SANDBOX_MARKER}A1b2C3` },
    { os: "macos", dir: `/var/folders/q5/8n_0z1rs4tq2b/T/${DOGFOOD_SANDBOX_MARKER}A1b2C3` },
    { os: "macos-realpath", dir: `/private/var/folders/q5/8n_0z1rs4tq2b/T/${DOGFOOD_SANDBOX_MARKER}A1b2C3` },
  ]

  it("redacts the sandbox path to one identical token on every OS", () => {
    const rendered = SANDBOXES.map(({ dir }) => redactRunVaryingNote(`plan written to ${dir}/plan.json`))
    // One distinct output — the artifact is byte-identical wherever it is generated.
    expect(new Set(rendered).size).toBe(1)
    expect(rendered[0]).toBe("plan written to <sandbox>")
  })

  it("leaves no OS temp-directory fragment behind", () => {
    for (const { os: name, dir } of SANDBOXES) {
      const out = redactRunVaryingNote(`--plan ${dir}/plan.json --apply`)
      // The failure mode was a PARTIAL redaction, so assert on the fragments a
      // partial pass would leave rather than only on the happy-path string.
      for (const leak of ["Temp", "tmp", "var", "folders", "private", "Users", "C:", DOGFOOD_SANDBOX_MARKER]) {
        expect(out, `${name} leaked ${leak}`).not.toContain(leak)
      }
    }
  })

  it("fails if the marker and the redactor ever disagree", () => {
    // The redaction is only sound because every sandbox path contains the marker by
    // construction. If someone changes the mkdtemp prefix without changing the
    // marker, this is the test that notices.
    const notMine = "/var/folders/q5/8n_0z1rs4tq2b/T/some-other-tool-A1b2C3/plan.json"
    expect(redactRunVaryingNote(notMine)).toBe(notMine)
    expect(DOGFOOD_SANDBOX_MARKER).toBe("calllint-dogfood-")
  })

  it("still redacts digests and receipt ids, in full and truncated form", () => {
    expect(redactRunVaryingNote(`plan sha256:${"a".repeat(64)} computed`)).toBe("plan sha256:<redacted> computed")
    // The CLI prints a truncated digest with an ellipsis; both forms must collapse.
    expect(redactRunVaryingNote("plan sha256:1234abcd… computed")).toBe("plan sha256:<redacted> computed")
    expect(redactRunVaryingNote("receipt clrec_9f8e7d6c recorded")).toBe("receipt clrec_<redacted> recorded")
  })

  it("preserves the note's meaning, which is what the gate reads", () => {
    const out = redactRunVaryingNote(
      `to apply, re-run with:  --plan /var/folders/q5/T/${DOGFOOD_SANDBOX_MARKER}xY/plan.json --apply --approve sha256:1234abcd…`,
    )
    // The whole path token collapses, trailing filename included — that is what makes
    // the substitution OS-agnostic (a per-OS separator would otherwise survive). The
    // flags and the shape of the instruction, which is all the gate reads, remain.
    expect(out).toBe("to apply, re-run with:  --plan <sandbox> --apply --approve sha256:<redacted>")
    expect(out).toContain("--apply")
    expect(out).toContain("--approve")
  })
})
