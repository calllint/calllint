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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
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
      expect(r.answers.action).toBe(p.humanDisposition.primaryCta)
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

  it("FAILS when a fourth authority fact is introduced (negative control)", () => {
    const { p } = projections[1] as { p: ReturnType<typeof canonicalProjection> }
    const html = renderSafeInstall(p)
    const broken = html.replace("</ul>", '<li data-observed="true">extra</li><li data-observed="true">more</li></ul>')
    const r = evaluateHumanCapsule(p, broken)
    expect(r.checks.find((c) => c.id === "at-most-three-authority-facts")?.pass).toBe(false)
  })

  it("FAILS when decision JavaScript appears (negative control)", () => {
    const { p } = projections[0] as { p: ReturnType<typeof canonicalProjection> }
    const broken = renderSafeInstall(p).replace("</body>", "<script>decide()</script></body>")
    const r = evaluateHumanCapsule(p, broken)
    expect(r.checks.find((c) => c.id === "no-decision-javascript")?.pass).toBe(false)
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

  it("the committed panel store is empty, so the shipped gate status is pending", () => {
    const store = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "artifacts/phase-2.4/five-second-panel-store.json"), "utf8"),
    ) as FiveSecondPanelStore
    expect(store.schema).toBe("calllint.five-second-panel.v0")
    expect(store.responses).toEqual([])
    expect(decideGateB(structures, measureFiveSecondPanel(store))).toBe("PENDING_HUMAN_PANEL")
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

  // --- freshness: recognition is evidence about ONE artifact ------------------

  const DIGEST_A = `sha256:${"a".repeat(64)}`
  const DIGEST_B = `sha256:${"b".repeat(64)}`
  const servedAs = (d: string) => new Map([["calllint-fixtures-safe-time", d]])

  it("responses are FRESH while the served page still digests to what was shown", () => {
    const f = partitionPanelFreshness(panel(FIVE_SECOND_MIN_PANEL), servedAs(DIGEST_A))
    expect(f.fresh).toHaveLength(FIVE_SECOND_MIN_PANEL)
    expect(f.stale).toEqual([])
    expect(decideGateB(structures, measureFiveSecondPanel({ ...panel(0), responses: f.fresh }))).toBe("PASSED")
  })

  it("a page EDIT makes every response measuring it stale, demoting a PASS to pending", () => {
    const store = panel(FIVE_SECOND_MIN_PANEL)
    // The page moved: it now digests to B, but the panel saw A.
    const f = partitionPanelFreshness(store, servedAs(DIGEST_B))
    expect(f.fresh).toEqual([])
    expect(f.stale).toHaveLength(FIVE_SECOND_MIN_PANEL)
    expect(f.stale[0]).toMatchObject({ shownDigest: DIGEST_A, currentDigest: DIGEST_B })
    // Fails CLOSED: the new page inherits nothing.
    expect(decideGateB(structures, measureFiveSecondPanel({ ...store, responses: f.fresh }))).toBe(
      "PENDING_HUMAN_PANEL",
    )
  })

  it("a REMOVED page is stale with a null current digest, not a silent pass", () => {
    const f = partitionPanelFreshness(panel(2), new Map())
    expect(f.fresh).toEqual([])
    expect(f.stale.map((s) => s.currentDigest)).toEqual([null, null])
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
    const store = panel(FIVE_SECOND_MIN_PANEL)
    const withOneStale: FiveSecondPanelStore = {
      ...store,
      responses: store.responses.map((r, i) => (i === 0 ? { ...r, shownDigest: DIGEST_B } : r)),
    }
    const f = partitionPanelFreshness(withOneStale, servedAs(DIGEST_A))
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

  it("records Gate 2.4-B as pending with a 100% structural precondition", () => {
    const a = read("human-five-second-test.json")
    expect(a.gate).toBe("2.4-B")
    expect(a.status).toBe("PENDING_HUMAN_PANEL")
    expect((a.structuralPrecondition as { pass: boolean }).pass).toBe(true)
    expect((a.structuralPrecondition as { pagesEvaluated: number }).pagesEvaluated).toBe(5)
    expect((a.humanPanel as { status: string }).status).toBe("NOT_RUN")
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
