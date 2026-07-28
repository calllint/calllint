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
  decideGateB,
  evaluateAgentContract,
  evaluateHumanCapsule,
  measureFiveSecondPanel,
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
