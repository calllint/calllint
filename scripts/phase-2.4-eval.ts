#!/usr/bin/env tsx
/**
 * Phase 2.4 Batch 9 — Gate 2.4-B / 2.4-C evaluation artifacts (new14 §"最重要的验收门";
 * traceability row B9).
 *
 * A THIN renderer. Every measure comes from the pure evaluators in
 * `packages/trust-index/src/phase24Eval.ts`, run over the five canonical fixtures
 * projected through the SHIPPED Batch-1/Batch-2 code. This script computes nothing
 * about safety and never writes a human judgement.
 *
 * Gate 2.4-B is deliberately split: the structural precondition is machine-checked
 * at 100%, and the "≥90% of humans" measurement is read from
 * `artifacts/phase-2.4/five-second-panel-store.json` — data a human commits. With
 * no panel recorded the gate is PENDING_HUMAN_PANEL. Code must not simulate a
 * human study.
 *
 * Modes (same contract as `pnpm audit:calibration`):
 *   (default) --check : committed artifacts must be byte-identical to a fresh run.
 *                       Exit 1 on drift; exit 0 on match REGARDLESS of gate status,
 *                       so CI stays green while a pending gate is recorded honestly.
 *   --write           : (re)generate the committed artifacts. Exit 0.
 *   --gate            : ENFORCEMENT. Exit 2 unless 2.4-B and 2.4-C both PASSED.
 *
 * Exit codes: 0 ok · 1 drift (--check) · 2 gate not passed (--gate) / unexpected error.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import {
  CANONICAL_FIXTURES,
  EVAL_ENGINE_VERSION,
  FIVE_SECOND_MIN_PANEL,
  FIVE_SECOND_QUESTIONS,
  FIVE_SECOND_THRESHOLD,
  canonicalProjection,
  decideGateB,
  evaluateAgentContract,
  evaluateHumanCapsule,
  measureFiveSecondPanel,
  partitionPanelFreshness,
  renderSafeInstall,
  type AgentContractEval,
  type FiveSecondPanelStore,
  type GateStatus,
  type HumanCapsuleStructure,
} from "../packages/trust-index/src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outDir = path.join(repoRoot, "artifacts", "phase-2.4")
const panelStorePath = path.join(outDir, "five-second-panel-store.json")
const humanPath = path.join(outDir, "human-five-second-test.json")
const contractPath = path.join(outDir, "agent-contract-eval.json")

/** Compile the shipped contract schema once; return Ajv errors as flat strings. */
function contractValidator(): (c: unknown) => string[] {
  const schema = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "schemas/calllint.agent-adoption-contract.v1.schema.json"), "utf8"),
  )
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
  return (c) =>
    validate(c) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
}

function readPanelStore(): FiveSecondPanelStore {
  if (!fs.existsSync(panelStorePath)) return { schema: "calllint.five-second-panel.v0", responses: [] }
  return JSON.parse(fs.readFileSync(panelStorePath, "utf8")) as FiveSecondPanelStore
}

/** sha256 of every served install page, keyed by canonicalSlug. */
function servedPageDigests(): Map<string, string> {
  const root = path.join(repoRoot, "apps", "web", "public", "install")
  const out = new Map<string, string>()
  if (!fs.existsSync(root)) return out
  for (const cohort of fs.readdirSync(root)) {
    const dir = path.join(root, cohort)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const name of fs.readdirSync(dir)) {
      const page = path.join(dir, name, "index.html")
      if (fs.existsSync(page)) {
        out.set(
          `${cohort}/${name}`,
          `sha256:${crypto.createHash("sha256").update(fs.readFileSync(page)).digest("hex")}`,
        )
      }
    }
  }
  return out
}

/** Build the Gate 2.4-B artifact. No clock, no RNG — byte-stable across runs. */
function buildHumanReport(): { json: string; status: GateStatus; structures: HumanCapsuleStructure[] } {
  const structures = CANONICAL_FIXTURES.map((f) => {
    const p = canonicalProjection(f)
    return evaluateHumanCapsule(p, renderSafeInstall(p))
  })
  const store = readPanelStore()
  // Recognition is evidence about ONE artifact. A response whose page has since
  // changed is not weaker evidence about the new page — it is none. Excluding it
  // makes the gate fall back to PENDING_HUMAN_PANEL, which fails closed.
  const { fresh, stale } = partitionPanelFreshness(store, servedPageDigests())
  const panel = measureFiveSecondPanel({ ...store, responses: fresh })
  const status = decideGateB(structures, panel)
  const blockers: string[] = []
  for (const s of structures) {
    for (const c of s.checks) {
      if (!c.pass) blockers.push(`${s.canonicalSlug}: ${c.id} (${c.observed})`)
    }
  }
  if (panel.responses < FIVE_SECOND_MIN_PANEL) {
    blockers.push(
      `human panel not recorded: ${panel.responses}/${FIVE_SECOND_MIN_PANEL} responses in artifacts/phase-2.4/five-second-panel-store.json`,
    )
  }
  for (const s of stale) {
    blockers.push(
      `stale panel response: ${s.participant} @ ${s.canonicalSlug} measured ${s.shownDigest} but the served page is now ` +
        `${s.currentDigest ?? "REMOVED"} — re-run that session`,
    )
  }
  const report = {
    schema: "calllint.phase-2.4-human-capsule-eval.v0",
    $comment:
      "Gate 2.4-B evidence. Two independent inputs. (1) structuralPrecondition is machine-measured by evaluateHumanCapsule() over the SHIPPED renderer and must be 100% — one CTA, <=3 authority facts, all three five-second answers present exactly once above the fold, no decision JS. (2) humanPanel is read from five-second-panel-store.json, which only a human writes; code never simulates a human study, so an unrecorded panel yields PENDING_HUMAN_PANEL rather than a pass. Each response carries the sha256 of the page the participant was actually shown; responses whose page has since changed are reported under humanPanel.stale and EXCLUDED from the rates, so a page edit demotes the gate to PENDING_HUMAN_PANEL instead of inheriting recognition it never earned. Regenerate with `pnpm eval:phase-2.4:write`; enforce with `pnpm eval:phase-2.4:gate`.",
    gate: "2.4-B",
    status,
    engineVersion: EVAL_ENGINE_VERSION,
    thresholds: {
      singlePrimaryCta: 1,
      maxAuthorityFacts: 3,
      recognitionPerQuestion: FIVE_SECOND_THRESHOLD,
      minPanelResponses: FIVE_SECOND_MIN_PANEL,
    },
    structuralPrecondition: {
      pass: structures.every((s) => s.pass),
      pagesEvaluated: structures.length,
      pages: structures,
    },
    humanPanel: {
      status: panel.responses === 0 ? "NOT_RUN" : "RECORDED",
      storePath: "artifacts/phase-2.4/five-second-panel-store.json",
      questions: FIVE_SECOND_QUESTIONS,
      ...panel,
      /** Responses excluded because the page they measured has since changed. */
      staleResponses: stale.length,
      stale,
    },
    blockers,
  }
  return { json: JSON.stringify(report, null, 2) + "\n", status, structures, blockers }
}

/** Build the Gate 2.4-C artifact. Every measure is a rate at 1 or a count at 0. */
function buildContractReport(): { json: string; status: GateStatus; evals: AgentContractEval[] } {
  const validateSchema = contractValidator()
  const evals = CANONICAL_FIXTURES.map((f) =>
    evaluateAgentContract(canonicalProjection(f), validateSchema, (d) => canonicalProjection(f, d)),
  )
  const n = evals.length
  const rate = (ok: (e: AgentContractEval) => boolean): number =>
    n === 0 ? 0 : evals.filter(ok).length / n
  const total = (get: (e: AgentContractEval) => number): number =>
    evals.reduce((acc, e) => acc + get(e), 0)

  const measures = {
    schemaValidRate: rate((e) => e.schemaValid),
    byteIdenticalRate: rate((e) => e.byteIdenticalOnReproject),
    exactlyOneRecommendedNextActionRate: rate((e) => e.recommendedNextActionCount === 1),
    digestSelfConsistentRate: rate((e) => e.digestSelfConsistent),
    publisherChangedDecision: total((e) => e.publisherChangedDecision),
    guessedHostRoute: total((e) => e.guessedHostRoute),
    blockApplyRoute: total((e) => e.blockApplyRoute),
  }
  const status: GateStatus = evals.every((e) => e.pass) && n === CANONICAL_FIXTURES.length ? "PASSED" : "FAILED"
  const blockers = evals.filter((e) => !e.pass).map((e) => `${e.canonicalSlug}: ${JSON.stringify(e)}`)

  const report = {
    schema: "calllint.phase-2.4-agent-contract-eval.v0",
    $comment:
      "Gate 2.4-C evidence. Measured by evaluateAgentContract() over the five canonical fixtures projected through the SHIPPED Batch-1 builder. publisherChangedDecision is proved by RE-PROJECTING each fixture with five adversarial publisher blurbs and diffing the decision-scoped serialization (everything except untrustedPublisherContent) — not by pattern-matching the output, so a new decision field is covered by default. Rates must be 1 and counts must be 0. Regenerate with `pnpm eval:phase-2.4:write`.",
    gate: "2.4-C",
    status,
    engineVersion: EVAL_ENGINE_VERSION,
    fixturesEvaluated: n,
    measures,
    thresholds: {
      schemaValidRate: 1,
      byteIdenticalRate: 1,
      exactlyOneRecommendedNextActionRate: 1,
      digestSelfConsistentRate: 1,
      publisherChangedDecision: 0,
      guessedHostRoute: 0,
      blockApplyRoute: 0,
    },
    fixtures: evals,
    blockers,
  }
  return { json: JSON.stringify(report, null, 2) + "\n", status, evals, blockers }
}

const argv = process.argv.slice(2)
const mode = argv.includes("--write") ? "write" : argv.includes("--gate") ? "gate" : "check"

const human = buildHumanReport()
const contract = buildContractReport()
const outputs: readonly [string, string][] = [
  [humanPath, human.json],
  [contractPath, contract.json],
]

if (mode === "write") {
  fs.mkdirSync(outDir, { recursive: true })
  for (const [p, body] of outputs) fs.writeFileSync(p, body, "utf8")
  console.log(`Gate 2.4-B ${human.status} · Gate 2.4-C ${contract.status}`)
  console.log(`Wrote ${path.relative(repoRoot, humanPath)} and ${path.relative(repoRoot, contractPath)}`)
  process.exit(0)
}

if (mode === "gate") {
  const ok = human.status === "PASSED" && contract.status === "PASSED"
  console.log(`Gate 2.4-B ${human.status} · Gate 2.4-C ${contract.status}`)
  if (!ok) {
    for (const b of [...human.blockers, ...contract.blockers]) console.error(`  - ${b}`)
  }
  process.exit(ok ? 0 : 2)
}

// --check (CI default): drift only. A pending gate is a state, not a break.
let drifted = false
for (const [p, body] of outputs) {
  const rel = path.relative(repoRoot, p)
  if (!fs.existsSync(p)) {
    console.error(`missing ${rel} — run \`pnpm eval:phase-2.4:write\``)
    drifted = true
    continue
  }
  if (fs.readFileSync(p, "utf8") !== body) {
    console.error(`${rel} is stale — run \`pnpm eval:phase-2.4:write\``)
    drifted = true
  }
}
if (drifted) process.exit(1)
console.log(`Gate 2.4-B ${human.status} · Gate 2.4-C ${contract.status} (artifacts in sync)`)
process.exit(0)
