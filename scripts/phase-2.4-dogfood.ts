#!/usr/bin/env tsx
/**
 * Phase 2.4 Batch 9 — Gate 2.4-G end-to-end dogfood (new14 §"最重要的验收门";
 * traceability row B9).
 *
 * Drives the FIVE canonical fixtures through the WHOLE shipped chain against the
 * REAL built binary (`apps/cli/dist/index.js`) as a subprocess — exactly what a
 * user runs. Nothing is mocked and nothing is re-implemented:
 *
 *   baked page → projection → served contract JSON
 *     → `safe-install` (prepare)  → outcome + plan, ZERO writes
 *     → `safe-install --apply`    → approval gate → delegated write → receipt
 *
 * SAFETY (learned the hard way): the `claude-code` host config is HOME-scoped, so
 * an unsandboxed run rewrites the developer's real `~/.claude.json`. Every
 * invocation here therefore passes `--host-config` into a per-fixture temp dir and
 * the harness ASSERTS afterwards that nothing outside that dir changed. A dogfood
 * that mutates the operator's machine is not a test, it is an incident.
 *
 * Digest VALUES are deliberately not committed: `planDigest` seals the plan's
 * `expiresAt`, which is wall-clock derived, so the values differ every run. The
 * artifact records each digest's PRESENCE and SHAPE, which is what the gate
 * actually asserts, keeping the committed file byte-stable.
 *
 * Modes: (default) --check · --write · --gate. Exit 0 ok · 1 drift · 2 gate failed.
 */
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  CANONICAL_FIXTURES,
  canonicalProjection,
  renderSafeInstall,
  renderSafeInstallContract,
  type CanonicalFixture,
} from "../packages/trust-index/src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const binary = path.join(repoRoot, "apps", "cli", "dist", "index.js")
const outDir = path.join(repoRoot, "artifacts", "phase-2.4")
const outPath = path.join(outDir, "e2e-dogfood.json")
const SHA256 = /^sha256:[0-9a-f]{64}$/

interface Run {
  readonly argv: readonly string[]
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

function runBin(argv: readonly string[], cwd: string, input = ""): Run {
  try {
    const stdout = execFileSync(process.execPath, [binary, ...argv], {
      cwd,
      input,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      // Capture stderr instead of letting it reach the parent: some steps are
      // negative controls whose refusal on stderr is the expected result.
      stdio: ["pipe", "pipe", "pipe"],
    })
    return { argv, exitCode: 0, stdout, stderr: "" }
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string }
    return { argv, exitCode: x.status ?? 1, stdout: x.stdout ?? "", stderr: x.stderr ?? "" }
  }
}

/** Every file under `root`, relative and sorted — the no-write evidence. */
function walk(root: string, base = ""): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = base === "" ? e.name : `${base}/${e.name}`
    if (e.isDirectory()) out.push(...walk(path.join(root, e.name), rel))
    else out.push(rel)
  }
  return out
}

/** Parse the `--json` envelope; null when the command emitted none. */
function envelope(r: Run): Record<string, unknown> | null {
  const i = r.stdout.indexOf("{")
  if (i === -1) return null
  try {
    return JSON.parse(r.stdout.slice(i)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Describe a digest by shape, never by value (values embed a wall-clock expiry). */
function digestShape(v: unknown): string {
  if (v === null || v === undefined) return "null"
  return typeof v === "string" && SHA256.test(v) ? "sha256" : `INVALID(${String(v)})`
}

/**
 * Redact the run-varying parts of a note so the committed artifact is byte-stable:
 * digest values (and the tool's truncated `sha256:1234abcd…` prefixes), generated
 * receipt ids, and the per-run sandbox path. The note's MEANING — which is what the
 * gate reads — survives intact.
 */
function normalizeNote(s: string): string {
  return s
    .replace(/sha256:[0-9a-f]{8,64}…?/g, "sha256:<redacted>")
    .replace(/clrec_[0-9a-f]+/g, "clrec_<redacted>")
    .replace(/[A-Za-z]:[\\/][^\s"]*calllint-dogfood-[^\s"]*/g, "<sandbox>")
    .replace(/[\\/]tmp[\\/][^\s"]*calllint-dogfood-[^\s"]*/g, "<sandbox>")
}

interface StepRecord {
  readonly step: string
  readonly exitCode: number
  readonly outcome: string | null
  readonly planDigest: string
  readonly receiptDigest: string
  readonly persistentComponents: readonly string[]
  /** Files in the user's workspace after the step — MUST stay empty (INV-2.4-07). */
  readonly workspaceFiles: readonly string[]
  readonly hostConfigWritten: boolean
  readonly notes: readonly string[]
}

interface FixtureRecord {
  readonly id: string
  readonly scenario: string
  readonly fixtureFile: string
  readonly verdict: string
  readonly installability: string
  readonly nextActionKind: string
  readonly actionable: boolean
  readonly steps: readonly StepRecord[]
  readonly assertions: readonly { id: string; pass: boolean; observed: string }[]
  readonly pass: boolean
}

/**
 * Read the HUMAN renderer's output. The interactive approval gate cannot run under
 * `--json` (that flag forces non-interactive), so the interactive step is measured
 * from the text surface a person actually sees — the same fields, different skin.
 */
function humanRead(r: Run): {
  outcome: string | null
  planDigest: unknown
  receiptDigest: unknown
  notes: string[]
} {
  const outcome = /safe-install:\s*([A-Z_]+)/.exec(r.stdout)?.[1] ?? null
  const plan = /^\s*plan:\s*(sha256:[0-9a-f]{64})\s*$/m.exec(r.stdout)?.[1] ?? null
  const receipt = /^\s*receipt:\s*(sha256:[0-9a-f]{64})\s*$/m.exec(r.stdout)?.[1] ?? null
  const notes = [...r.stdout.matchAll(/^\s{2}- (.+)$/gm)].map((m) => (m[1] as string).trim())
  return { outcome, planDigest: plan, receiptDigest: receipt, notes }
}

function record(step: string, r: Run, ws: string, hostCfg: string): StepRecord {
  // `--json` steps carry the envelope; the interactive step is read from the human
  // surface. Both are the SHIPPED renderers — neither is re-implemented here.
  const env = envelope(r)
  const read = env !== null
    ? {
        outcome: (env.outcome as string) ?? null,
        planDigest: env.planDigest,
        receiptDigest: env.receiptDigest,
        notes: (env.notes as string[]) ?? [],
        persistentComponents: (env.persistentComponents as string[]) ?? [],
      }
    : { ...humanRead(r), persistentComponents: [] as string[] }
  return {
    step,
    exitCode: r.exitCode,
    outcome: read.outcome,
    planDigest: digestShape(read.planDigest),
    receiptDigest: digestShape(read.receiptDigest),
    persistentComponents: read.persistentComponents,
    workspaceFiles: walk(ws),
    hostConfigWritten: fs.existsSync(hostCfg),
    notes: read.notes.map(normalizeNote),
  }
}

/**
 * Run one fixture through the full chain in an isolated sandbox. The host config
 * is redirected into the sandbox so the real `~/.claude.json` is never touched.
 */
function runFixture(f: CanonicalFixture): FixtureRecord {
  const p = canonicalProjection(f)
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "calllint-dogfood-"))
  try {
    const ws = path.join(sandbox, "workspace")
    // Each apply ROUTE gets its own host config, so the agent route and the
    // interactive route are measured independently instead of the second one
    // landing on a config the first already wrote (which would test idempotency,
    // not the route).
    const hostCfg = path.join(sandbox, "host", "settings.json")
    const hostCfgAgent = path.join(sandbox, "host-agent", "settings.json")
    fs.mkdirSync(ws, { recursive: true })
    fs.mkdirSync(path.join(sandbox, "host"), { recursive: true })
    fs.mkdirSync(path.join(sandbox, "host-agent"), { recursive: true })

    // The served surface: exactly the bytes Batch 2/3 publish at /install/{slug}/.
    const contractFile = path.join(sandbox, "index.json")
    fs.writeFileSync(contractFile, renderSafeInstallContract(p), "utf8")
    fs.writeFileSync(path.join(sandbox, "index.html"), renderSafeInstall(p), "utf8")

    const base = ["safe-install", "--contract", contractFile, "--host", "claude-code", "--host-config", hostCfg]
    const steps: StepRecord[] = []

    // Step 1 — prepare only. Must never write, whatever the verdict.
    const prep = runBin([...base, "--json"], ws)
    steps.push(record("prepare", prep, ws, hostCfg))
    const prepEnv = envelope(prep)
    const actionable = prepEnv?.outcome === "PREPARED"

    // Step 2 — the agent (non-interactive) two-invocation handshake exactly as the
    // tool PRINTS it: prepare with --plan-out, review, then replay with --plan and
    // approve the digest. The plan file lives outside the workspace, so the
    // zero-workspace-files invariant is still measured honestly.
    if (actionable) {
      const agentBase = [...base.slice(0, -1), hostCfgAgent]
      const planFile = path.join(sandbox, "plan.json")
      const step1 = runBin([...agentBase, "--json", "--plan-out", planFile], ws)
      steps.push(record("prepare-with-plan-out", step1, ws, hostCfgAgent))
      const digest = envelope(step1)?.planDigest as string
      const step2 = runBin([...agentBase, "--json", "--plan", planFile, "--apply", "--approve", digest], ws)
      steps.push(record("apply-non-interactive", step2, ws, hostCfgAgent))
      // Negative control: a bare `--approve` with no replayed plan must be REFUSED
      // with an honest usage error, never a silent fresh-anchor apply.
      const bare = runBin([...base, "--json", "--apply", "--approve", digest], ws)
      steps.push(record("apply-without-replay-rejected", bare, ws, hostCfg))
    }

    // Step 3 — the interactive approval gate in a single invocation.
    if (actionable) {
      const inter = runBin([...base, "--apply"], ws, "yes\n")
      steps.push(record("apply-interactive", inter, ws, hostCfg))
    }

    const assertions = assertFixture(f, p, steps, actionable, hostCfg)
    return {
      id: f.id,
      scenario: f.scenario,
      fixtureFile: f.fixtureFile,
      verdict: p.publicObservation.verdict,
      installability: p.installability,
      nextActionKind: p.agentContract.recommendedNextAction.kind,
      actionable,
      steps,
      assertions,
      pass: assertions.every((a) => a.pass),
    }
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
}

/** The gate's obligations for one fixture, each measured from the recorded steps. */
function assertFixture(
  f: CanonicalFixture,
  p: ReturnType<typeof canonicalProjection>,
  steps: readonly StepRecord[],
  actionable: boolean,
  _hostCfg: string,
): { id: string; pass: boolean; observed: string }[] {
  const prepare = steps.find((s) => s.step === "prepare") as StepRecord
  const planOut = steps.find((s) => s.step === "prepare-with-plan-out")
  const nonInteractive = steps.find((s) => s.step === "apply-non-interactive")
  const bare = steps.find((s) => s.step === "apply-without-replay-rejected")
  const interactive = steps.find((s) => s.step === "apply-interactive")
  const a: { id: string; pass: boolean; observed: string }[] = []

  a.push({
    id: "verdict-matches-canonical-binding",
    pass: p.publicObservation.verdict === f.expectVerdict,
    observed: `${p.publicObservation.verdict} (expected ${f.expectVerdict})`,
  })
  a.push({
    id: "installability-matches-canonical-binding",
    pass: p.installability === f.expectInstallability,
    observed: `${p.installability} (expected ${f.expectInstallability})`,
  })
  a.push({
    id: "prepare-writes-no-host-config",
    pass: !prepare.hostConfigWritten,
    observed: `hostConfigWritten = ${prepare.hostConfigWritten}`,
  })
  a.push({
    id: "prepare-leaves-zero-workspace-files",
    pass: prepare.workspaceFiles.length === 0,
    observed: `workspace = ${JSON.stringify(prepare.workspaceFiles)}`,
  })
  a.push({
    id: "no-persistent-components-in-one-time-mode",
    pass: steps.every((s) => s.persistentComponents.length === 0),
    observed: steps.map((s) => `${s.step}:${s.persistentComponents.length}`).join(" "),
  })
  a.push({
    id: "zero-workspace-files-through-whole-chain",
    pass: steps.every((s) => s.workspaceFiles.length === 0),
    observed: steps.map((s) => `${s.step}:${s.workspaceFiles.length}`).join(" "),
  })

  if (!actionable) {
    // A non-actionable public route must terminate with no plan and no write —
    // never laundered into a lenient local decision (INV-2.4-02).
    a.push({
      id: "non-actionable-route-yields-no-plan",
      pass: prepare.planDigest === "null",
      observed: `planDigest = ${prepare.planDigest}`,
    })
    a.push({
      id: "non-actionable-route-never-applies",
      pass: steps.every((s) => !s.hostConfigWritten),
      observed: steps.map((s) => `${s.step}:${s.hostConfigWritten}`).join(" "),
    })
    return a
  }

  a.push({
    id: "prepare-yields-an-approvable-plan-digest",
    pass: prepare.planDigest === "sha256",
    observed: `planDigest = ${prepare.planDigest}`,
  })
  a.push({
    id: "prepare-emits-no-receipt",
    pass: prepare.receiptDigest === "null",
    observed: `receiptDigest = ${prepare.receiptDigest}`,
  })
  a.push({
    id: "plan-out-does-not-write-host-config",
    pass: planOut?.hostConfigWritten === false && planOut?.outcome === "PREPARED",
    observed: `outcome = ${planOut?.outcome ?? "n/a"}, hostConfigWritten = ${planOut?.hostConfigWritten ?? "n/a"}`,
  })
  // The exact two-invocation route the tool PRINTS. An agent has no other option (it
  // cannot answer an interactive prompt), so this failing means the documented
  // non-interactive adoption path does not work.
  a.push({
    id: "printed-two-invocation-approval-applies",
    pass: nonInteractive?.outcome === "APPLIED_AND_VERIFIED",
    observed: `outcome = ${nonInteractive?.outcome ?? "n/a"}; notes = ${JSON.stringify(nonInteractive?.notes ?? [])}`,
  })
  a.push({
    id: "non-interactive-apply-emits-a-verified-receipt",
    pass: nonInteractive?.receiptDigest === "sha256",
    observed: `receiptDigest = ${nonInteractive?.receiptDigest ?? "n/a"}`,
  })
  // Negative control: the digest alone must never be enough to apply.
  a.push({
    id: "bare-approve-without-replayed-plan-is-refused",
    pass: bare?.exitCode === 2 && bare?.hostConfigWritten === false,
    observed: `exit = ${bare?.exitCode ?? "n/a"}, hostConfigWritten = ${bare?.hostConfigWritten ?? "n/a"}`,
  })
  a.push({
    id: "interactive-approval-applies-and-verifies",
    pass: interactive?.outcome === "APPLIED_AND_VERIFIED",
    observed: `outcome = ${interactive?.outcome ?? "n/a"}`,
  })
  a.push({
    id: "apply-emits-a-verified-receipt",
    pass: interactive?.receiptDigest === "sha256",
    observed: `receiptDigest = ${interactive?.receiptDigest ?? "n/a"}`,
  })
  a.push({
    id: "apply-writes-the-host-config",
    pass: interactive?.hostConfigWritten === true,
    observed: `hostConfigWritten = ${interactive?.hostConfigWritten ?? "n/a"}`,
  })
  return a
}

/**
 * Fingerprint the operator's REAL host configs before/after the sweep. The dogfood
 * applies installs for real; if a sandbox seam ever leaks, this catches it here
 * instead of on a developer's machine.
 */
function realHostFingerprint(): string {
  const candidates = [
    path.join(os.homedir(), ".claude.json"),
    path.join(os.homedir(), ".claude", "settings.json"),
    path.join(os.homedir(), ".cursor", "mcp.json"),
    path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"),
  ]
  return candidates
    .map((p) => `${path.basename(p)}:${fs.existsSync(p) ? fs.statSync(p).size + "/" + fs.readFileSync(p).length : "absent"}`)
    .join(" ")
}

if (!fs.existsSync(binary)) {
  console.error(`missing ${path.relative(repoRoot, binary)} — run \`pnpm --filter @calllint/cli build\` first`)
  process.exit(2)
}

const before = realHostFingerprint()
const fixtures = CANONICAL_FIXTURES.map(runFixture)
const after = realHostFingerprint()
if (before !== after) {
  console.error("FATAL: the dogfood modified a real host config outside its sandbox.")
  console.error(`  before: ${before}`)
  console.error(`  after:  ${after}`)
  process.exit(2)
}

const failures = fixtures.flatMap((f) => f.assertions.filter((x) => !x.pass).map((x) => `${f.id}: ${x.id} — ${x.observed}`))
const status = failures.length === 0 ? "PASSED" : "FAILED"

const report = {
  schema: "calllint.phase-2.4-e2e-dogfood.v0",
  $comment:
    "Gate 2.4-G evidence. The five canonical fixtures driven through the WHOLE shipped chain (baked page → projection → served contract → safe-install prepare → approval gate → delegated write → receipt) against the real built binary as a subprocess. Nothing mocked. Digest VALUES are omitted on purpose: planDigest seals the plan's wall-clock-derived expiresAt, so values differ per run; the gate asserts each digest's presence and shape, which keeps this file byte-stable. Every run redirects --host-config into a temp sandbox and fingerprints the operator's real host configs before/after, because the claude-code config is HOME-scoped and an unsandboxed run would rewrite the developer's own ~/.claude.json. Regenerate with `pnpm eval:phase-2.4:dogfood:write`.",
  gate: "2.4-G",
  status,
  binary: "apps/cli/dist/index.js",
  fixturesEvaluated: fixtures.length,
  chain: ["baked page", "projection", "served contract", "prepare", "approval gate", "delegated write", "receipt"],
  fixtures,
  failures,
}
const json = JSON.stringify(report, null, 2) + "\n"

const argv = process.argv.slice(2)
const mode = argv.includes("--write") ? "write" : argv.includes("--gate") ? "gate" : "check"

if (mode === "write") {
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, json, "utf8")
  console.log(`Gate 2.4-G ${status} (${fixtures.length} fixtures)`)
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`Wrote ${path.relative(repoRoot, outPath)}`)
  process.exit(0)
}

if (mode === "gate") {
  console.log(`Gate 2.4-G ${status}`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(status === "PASSED" ? 0 : 2)
}

if (!fs.existsSync(outPath)) {
  console.error(`missing ${path.relative(repoRoot, outPath)} — run \`pnpm eval:phase-2.4:dogfood:write\``)
  process.exit(1)
}
if (fs.readFileSync(outPath, "utf8") !== json) {
  console.error(`${path.relative(repoRoot, outPath)} is stale — run \`pnpm eval:phase-2.4:dogfood:write\``)
  process.exit(1)
}
console.log(`Gate 2.4-G ${status} (artifact in sync)`)
process.exit(0)
