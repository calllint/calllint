#!/usr/bin/env tsx
/**
 * Phase 2.4 Batch 9 — Gates 2.4-A / 2.4-D / 2.4-E / 2.4-F / 2.4-H evidence
 * (new14 §E "release boundary"; traceability gate rows A, D, E, F, H).
 *
 * The OBSERVER half of the pair. Every judgement lives in the pure evaluators in
 * `@calllint/trust-index` (`phase24Gates.ts`); this file only observes reality and
 * hands it over:
 *
 *   2.4-A  read the SERVED bytes under apps/web/public — six surfaces per identity
 *          across all 19 real registry entries — and prove they publish one truth.
 *   2.4-D  drive the REAL built binary against three deliberately falsified targets
 *          (artifact digest, contract digest, version) and prove no writable plan
 *          results; plus a source audit proving safe-install has no host-config
 *          write site at all (INV-2.4-03, one writer).
 *   2.4-E  lift the one-time-mode facts from the committed Gate 2.4-G dogfood
 *          record (one observation, two gates) and add a REAL rollback exercise
 *          that proves the host config returns byte-identical to its pre-image.
 *   2.4-F  build the shipped continuous-protection offer for every guard host and
 *          prove the rendered text discloses every component, path, uninstall
 *          command, the disable command, and `[Not now]`.
 *   2.4-H  grade the GATE SYSTEM: every gate row has a committed artifact, every
 *          machine-decidable gate is PASSED, the MCP tool count agrees between
 *          producer and assertion, every regression check is wired to something
 *          that runs it (remote-only ones bound to a real workflow job, never
 *          claimed as locally proven), and every served subtree has both a
 *          reproducibility guard and an `eol=lf` pin.
 *
 * SAFETY: every run redirects --host-config into a temp sandbox. The claude-code
 * config is HOME-scoped, so an unsandboxed run would rewrite the developer's own
 * ~/.claude.json. Nothing here executes a scanned target (INV-2.4-09).
 *
 * Modes (same contract as the other Phase-2.4 evidence scripts):
 *   (default) --check : committed artifacts must be byte-identical to a fresh run.
 *   --write           : (re)generate them.
 *   --gate            : ENFORCEMENT. Exit 2 unless all five gates are PASSED.
 * Exit codes: 0 ok · 1 drift · 2 gate not passed / unexpected error.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  evaluateOneSourceConsistency,
  evaluateLocalBinding,
  evaluateOneTimeSetup,
  evaluateConversion,
  evaluateNoRegression,
  type IdentitySurfaces,
  type SurfaceFacts,
  type MismatchRun,
  type WriteSite,
  type RollbackRun,
  type ConversionObservation,
  type GateRecord,
  type WiredCheck,
  type ServedGuard,
  type GateResult,
  type ToolNameSources,
  EVAL_ENGINE_VERSION,
  // PR P-5 — the gate edge reads the copy plane through the SHIPPED loader rather than
  // reimplementing the path and the fail-open try/catch. One loader means the gate observes
  // the same document the bake does, including the same behavior on a malformed file.
  loadPresentationIfPresent,
  PROBE_SENTINEL,
} from "@calllint/trust-index"
import { applyPlan, nodeFsPort, type ConfigFs } from "@calllint/install-planner"
import type { InstallPlan } from "@calllint/types"
// Gate 2.4-H reads workflow wiring the way the RUNNER reads it (S0-OPEN-5, ADR 0071).
// Root devDependency, pinned at 2.8.2; `scripts/phase-2.4-eval.ts` imports `ajv` the same way.
import { parse as parseYaml } from "yaml"
import {
  GUARD_HOST_IDS,
  continuousProtectionOffer,
  renderContinuousProtectionOffer,
} from "@calllint/core"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..")
const served = path.join(repoRoot, "apps", "web", "public")
const outDir = path.join(repoRoot, "artifacts", "phase-2.4")
const cli = path.join(repoRoot, "apps", "cli", "dist", "index.js")

const sha256 = (b: string): string => "sha256:" + createHash("sha256").update(b, "utf8").digest("hex")
const readText = (p: string): string => fs.readFileSync(p, "utf8")
const readJson = (p: string): Record<string, unknown> => JSON.parse(readText(p)) as Record<string, unknown>
const rel = (p: string): string => path.relative(repoRoot, p).split(path.sep).join("/")
/** Escape a script/job name for use inside a RegExp — `:` and `.` are literal here. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// --- Gate 2.4-A · observe the served surface --------------------------------

/**
 * Pull a fact out of rendered HTML by PRESENCE, not by parsing. The gate's claim
 * is "the page shows the same value", and a value that appears verbatim in the
 * served bytes is shown; a value that does not is not. This deliberately avoids
 * a DOM parser: a selector would encode today's markup and start lying the first
 * time the renderer moves a node.
 */
function htmlFact(html: string, candidate: string | null): string | null {
  if (candidate === null) return null
  return html.includes(candidate) ? candidate : `ABSENT(${candidate})`
}

/** Read every served surface for one identity. Order is stable → byte-stable output. */
function observeIdentity(canonicalName: string, discovery: Record<string, string>): IdentitySurfaces {
  const slug = canonicalName
  const trustJsonPath = path.join(served, "trust", `${slug}.json`)
  const manifestPath = path.join(served, "trust", `${slug}.manifest.json`)
  const trustHtmlPath = path.join(served, "trust", `${slug}.html`)
  const contractPath = path.join(served, "install", slug, "index.json")
  const installHtmlPath = path.join(served, "install", slug, "index.html")

  const tj = readJson(trustJsonPath)
  const mf = readJson(manifestPath) as { subject?: { artifactDigest?: string }; verdict?: string; verdictLabel?: string }
  const ct = readJson(contractPath) as {
    subject?: { artifactDigest?: string }
    publicObservation?: { verdict?: string; publicLabel?: string }
  }
  const trustHtml = readText(trustHtmlPath)
  const installHtml = readText(installHtmlPath)

  const artifact = (tj.artifactDigest as string | undefined) ?? null
  const verdict = (tj.verdict as string | undefined) ?? null
  const label = (tj.verdictLabel as string | undefined) ?? null

  const surfaces: SurfaceFacts[] = [
    { surface: rel(trustJsonPath), artifactDigest: artifact, verdict, verdictLabel: label },
    {
      surface: rel(manifestPath),
      artifactDigest: mf.subject?.artifactDigest ?? null,
      verdict: mf.verdict ?? null,
      verdictLabel: mf.verdictLabel ?? null,
    },
    {
      surface: rel(contractPath),
      artifactDigest: ct.subject?.artifactDigest ?? null,
      verdict: ct.publicObservation?.verdict ?? null,
      verdictLabel: ct.publicObservation?.publicLabel ?? null,
    },
    // HTML carries no machine fields; measured by verbatim presence of the same values.
    { surface: rel(trustHtmlPath), artifactDigest: htmlFact(trustHtml, artifact), verdict: null, verdictLabel: htmlFact(trustHtml, label) },
    { surface: rel(installHtmlPath), artifactDigest: htmlFact(installHtml, artifact), verdict: null, verdictLabel: htmlFact(installHtml, label) },
    // The lookup index is the discovery plane's own copy of the same facts.
    { surface: "apps/web/public/trust/lookup-index.json", artifactDigest: discovery.artifactDigest ?? null, verdict: discovery.verdict ?? null, verdictLabel: discovery.verdictLabel ?? null },
  ]
  return { canonicalName, surfaces }
}

/** The 19 REAL registry identities. Fixtures are excluded — they are not served truth. */
function observeGateA(): { identities: IdentitySurfaces[]; surfacesPer: number } {
  const lookup = readJson(path.join(served, "trust", "lookup-index.json")) as { entries?: Record<string, string>[] }
  const entries = lookup.entries ?? []
  const byName = new Map<string, Record<string, string>>()
  for (const e of entries) if (typeof e.canonicalName === "string") byName.set(e.canonicalName, e)

  const installRoot = path.join(served, "install", "mcp-registry")
  const slugs = fs.readdirSync(installRoot).filter((d) => fs.statSync(path.join(installRoot, d)).isDirectory()).sort()
  const identities = slugs.map((s) => {
    const canonicalName = `mcp-registry/${s}`
    const d = byName.get(canonicalName)
    if (d === undefined) throw new Error(`gate 2.4-A: ${canonicalName} is served under /install but absent from lookup-index.json`)
    return observeIdentity(canonicalName, d)
  })
  return { identities, surfacesPer: 6 }
}

// --- shared: drive the real built binary in a sandbox ------------------------

interface Run {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

function runBin(argv: readonly string[], cwd: string, input = ""): Run {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...argv], {
      cwd,
      input,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      // Negative controls are the point here: a refusal on stderr is a PASS, so
      // stderr is captured rather than inherited.
      stdio: ["pipe", "pipe", "pipe"],
    })
    return { exitCode: 0, stdout, stderr: "" }
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string }
    return { exitCode: x.status ?? 1, stdout: x.stdout ?? "", stderr: x.stderr ?? "" }
  }
}

function envelope(r: Run): Record<string, unknown> | null {
  const i = r.stdout.indexOf("{")
  if (i === -1) return null
  try {
    return JSON.parse(r.stdout.slice(i)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** A per-run sandbox. The host config NEVER points at the developer's real HOME. */
function sandbox(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `calllint-gate-${tag}-`))
}

// --- Gate 2.4-D · falsify the target, prove nothing becomes writable --------

/**
 * The identity used for the mismatch matrix: a REAL served contract, not a
 * fixture. Falsifying an assertion against bytes we actually publish is the
 * situation the gate is about — an agent handed a substituted target.
 */
const D_SUBJECT = "mcp-registry/ai.adeu-adeu"
const FALSE_DIGEST = "sha256:" + "0".repeat(64)

function observeGateD(): { runs: MismatchRun[]; writeSites: WriteSite[] } {
  const contractFile = path.join(served, "install", D_SUBJECT, "index.json")
  const cases: { id: string; flag: string; value: string; names: string }[] = [
    { id: "artifact-digest", flag: "--expect-artifact-digest", value: FALSE_DIGEST, names: "artifact digest" },
    { id: "contract-digest", flag: "--expect-contract-digest", value: FALSE_DIGEST, names: "contract digest" },
    { id: "version", flag: "--expect-version", value: "0.0.0-not-the-served-version", names: "version" },
  ]
  const runs: MismatchRun[] = []
  for (const c of cases) {
    const box = sandbox(`d-${c.id}`)
    const hostCfg = path.join(box, "claude.json")
    try {
      const r = runBin(
        ["safe-install", "--contract", contractFile, "--host", "claude-code", "--host-config", hostCfg, c.flag, c.value, "--json"],
        box,
      )
      const env = envelope(r)
      const notes = Array.isArray(env?.notes) ? (env?.notes as string[]).join(" ") : ""
      runs.push({
        id: c.id,
        outcome: typeof env?.outcome === "string" ? env.outcome : `NO_ENVELOPE(exit ${r.exitCode})`,
        exitCode: r.exitCode,
        planDigest: typeof env?.planDigest === "string" ? env.planDigest : null,
        hostConfigWritten: fs.existsSync(hostCfg),
        // The refusal must name the dimension the operator falsified, or they
        // cannot tell a substituted target from a stale one.
        explains: notes.includes(c.names) || r.stderr.includes(c.names),
      })
    } finally {
      fs.rmSync(box, { recursive: true, force: true })
    }
  }
  return { runs, writeSites: auditSafeInstallWriters() }
}

/**
 * Source audit for INV-2.4-03 (one writer). Finds every filesystem write in the
 * safe-install surface and classifies its destination. `allowed` is decided by
 * the destination expression, not by a comment: a scratch dir the command
 * created, or a path the OPERATOR named on the command line, cannot be the host
 * config. Anything else is an offender and fails the gate.
 */
/**
 * The first argument of a call, respecting nesting: a top-level comma ends it, but
 * a comma inside `join(a, b)` does not. Without this, `join(abs, "..")` truncates
 * to `join(abs` and the destination's root becomes unclassifiable.
 */
function firstArgument(after: string): string {
  let depth = 0
  for (let i = 0; i < after.length; i++) {
    const ch = after[i]
    if (ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return after.slice(0, i).trim()
      depth--
    } else if (ch === "," && depth === 0) return after.slice(0, i).trim()
  }
  return after.trim()
}

function auditSafeInstallWriters(): WriteSite[] {
  const file = path.join(repoRoot, "apps", "cli", "src", "commands", "safeInstall.ts")
  const lines = readText(file).split(/\r?\n/)

  /**
   * Resolve a destination expression to the root it derives from. A line-local
   * look would classify `writeFileSync(path, …)` as unclassified even when two
   * lines above sits `const path = join(scratch, …)` — proving less than the gate
   * claims. So a bare identifier is followed back to its nearest preceding
   * declaration, up to a small depth, and the ROOT is what gets classified.
   */
  const KEYWORDS = new Set(["join", "resolvePath", "resolve", "String", "await", "new", "return", "if", "const", "let", "var", "true", "false", "null", "undefined"])
  const declarationOf = (name: string, upto: number): { expr: string; line: number } | null => {
    for (let j = upto - 1; j >= 0; j--) {
      const d = new RegExp(String.raw`\b(?:const|let|var)\s+${name}\s*=\s*(.+?)\s*$`).exec(lines[j] ?? "")
      if (d !== null) return { expr: (d[1] ?? "").replace(/;$/, ""), line: j }
    }
    return null
  }
  /**
   * Expand every identifier the expression mentions, not just a bare one:
   * `join(abs, "..")` must still reach `abs → resolvePath(planOut)`, or a
   * legitimate operator-named path reads as unclassified and the gate cries wolf.
   */
  // String literals are DATA, not references. Blanking them before identifier
  // extraction keeps the audit sound: otherwise a literal that merely contains the
  // word `scratch` would expand into an allowed-looking root, and this classifier
  // would be arguing with itself about a string.
  const blankLiterals = (s: string): string =>
    s.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, "``")

  const resolveRoot = (expr: string, upto: number, depth = 0): string => {
    if (depth > 4) return expr
    let out = expr
    for (const name of new Set(blankLiterals(expr).match(/[A-Za-z_$][\w$]*/g) ?? [])) {
      if (KEYWORDS.has(name)) continue
      const d = declarationOf(name, upto)
      if (d === null) continue
      // Replace only OUTSIDE literals: split on literals, substitute in the code parts.
      out = out
        .split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/)
        .map((part, i) => (i % 2 === 1 ? part : part.replace(new RegExp(String.raw`\b${name}\b`, "g"), `${name}→${resolveRoot(d.expr, d.line, depth + 1)}`)))
        .join("")
    }
    return out
  }

  const sites: WriteSite[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (/^\s*(import|export|\*|\/\/)/.test(line)) continue
    const m = /\b(writeFileSync|appendFileSync|renameSync|copyFileSync|rmSync|mkdirSync)\s*\(/.exec(line)
    if (m === null) continue
    const call = m[1] ?? ""
    // Take the FIRST argument with balanced parens — `[^,)]+` would truncate
    // `join(abs, "..")` to `join(abs`, losing the very root we need to classify.
    const dest = firstArgument(line.slice(m.index + m[0].length))
    const root = resolveRoot(dest, i)
    // Classify on the literal-free expansion for the same soundness reason.
    const codeRoot = blankLiterals(root)
    // Allowed roots, and ONLY these: a scratch dir this command created and removes
    // on exit, or a path the operator typed on the command line. Anything reachable
    // from the host-config flag is an offender by construction.
    const inScratch = /\bscratch\b|\bplansDir\b|\bmkdtempSync\b/.test(codeRoot)
    const operatorNamed = /\bplanOut\b|\breceiptOut\b/.test(codeRoot)
    const hostConfigTainted = /\bhostConfig\b|\bconfigPath\b/.test(codeRoot)
    sites.push({
      file: rel(file),
      line: i + 1,
      destination: dest === root ? `${call}(${dest})` : `${call}(${dest} → ${root})`,
      allowed: (inScratch || operatorNamed) && !hostConfigTainted,
      why: hostConfigTainted
        ? `${call} → HOST-CONFIG-TAINTED destination`
        : inScratch
          ? `${call} → command-owned scratch dir (removed on exit)`
          : operatorNamed
            ? `${call} → path the operator named on the command line`
            : `${call} → UNCLASSIFIED destination`,
    })
  }
  if (sites.length === 0) {
    throw new Error("gate 2.4-D: the writer audit found ZERO write sites in safeInstall.ts — the scan is broken, not the code")
  }
  return sites
}

// --- Gate 2.4-E · one-time footprint + a real rollback ----------------------

/**
 * The one-time-mode half is LIFTED from the committed Gate 2.4-G dogfood record
 * rather than re-run. That is deliberate: two gates measuring the same flow from
 * two separate runs could disagree for reasons that have nothing to do with the
 * product. One observation, two readers.
 */
function liftOneTimeSteps(): { fixture: string; step: string; persistentComponents: string[]; workspaceFiles: string[] }[] {
  const p = path.join(outDir, "e2e-dogfood.json")
  if (!fs.existsSync(p)) {
    throw new Error("gate 2.4-E: artifacts/phase-2.4/e2e-dogfood.json is missing — run `pnpm eval:phase-2.4:dogfood:write` first (Gate 2.4-E reads the Gate 2.4-G record)")
  }
  const doc = readJson(p) as { fixtures?: { id?: string; steps?: { step?: string; persistentComponents?: string[]; workspaceFiles?: string[] }[] }[] }
  const out: { fixture: string; step: string; persistentComponents: string[]; workspaceFiles: string[] }[] = []
  for (const f of doc.fixtures ?? []) {
    for (const s of f.steps ?? []) {
      out.push({
        fixture: f.id ?? "?",
        step: s.step ?? "?",
        persistentComponents: s.persistentComponents ?? [],
        workspaceFiles: s.workspaceFiles ?? [],
      })
    }
  }
  return out
}

/**
 * A REAL rollback, on a REAL file, through the SHIPPED engine and the SHIPPED
 * node fs port — with a fault injected at exactly one point: the post-write
 * verify read returns corrupted bytes. That is the one thing the CLI cannot be
 * asked to do (a healthy disk does not lie about what it just wrote), and it is
 * the only way to observe the rollback branch end to end.
 *
 * Everything else is real: the backup, the atomic temp→rename write, the
 * rollback rename, and the digest re-read off disk afterwards. The measure the
 * gate reads is that last one — the file's actual bytes, not the engine's report.
 */
function observeGateE(): RollbackRun[] {
  const cases: { id: string; pre: string | null }[] = [
    // Pre-existing config → rollback must restore the exact prior bytes.
    { id: "restores-pre-existing-config-byte-identically", pre: '{\n  "mcpServers": {\n    "already-there": { "command": "node", "args": ["x.js"] }\n  }\n}\n' },
    // No config → rollback must restore ABSENCE, leaving nothing behind.
    { id: "restores-absence-when-it-created-the-file", pre: null },
  ]
  const runs: RollbackRun[] = []
  for (const c of cases) {
    const box = sandbox(`e-${c.id.slice(0, 12)}`)
    try {
      runs.push(rollbackExercise(box, c.id, c.pre))
    } finally {
      fs.rmSync(box, { recursive: true, force: true })
    }
  }
  return runs
}

// --- Gate 2.4-F · observe the shipped conversion offer ----------------------

/**
 * Build the shipped offer for every guard host and render it. `ASK_AFTER_SUCCESS`
 * is the state the gate is about: the moment a one-time setup just succeeded and
 * CallLint asks for persistent protection. `alreadyInstalled` /
 * `preAuthorizedByPolicy` are left off, because an offer that is never shown has
 * no disclosure to audit.
 */
function observeGateF(): ConversionObservation[] {
  // PR P-5 — grade the CONFIGURED surface, not the built-in defaults.
  //
  // This one line is what makes the gate's existing floors guard configuration. Before it,
  // every check ran against copy no document could reach, so a configured string that
  // dropped a component label or hid the disable command would have shipped ungraded. The
  // resolver has already rejected unusable values per slot and filled the rest from code,
  // so `resolved.guardConversion` is total whatever the document says — the gate never sees
  // a partial record and needs no fallback of its own.
  const resolved = loadPresentationIfPresent()
  // The second render, for the invariance measure. Sentinel copy in every configurable slot:
  // if `disclosureDigest` moves, wording reached the approval token. `PROBE_SENTINEL` is the
  // one exported sentinel convention (presentationAudit.ts) rather than a local literal, so
  // there is a single string to grep when tracing where a probe value came from.
  const sentinelCopy = {
    offerHeadline: PROBE_SENTINEL,
    offerBody: PROBE_SENTINEL,
    acceptLabel: PROBE_SENTINEL,
  }
  // `copySource` is MEASURED, never asserted, and measured from the OBSERVED render itself.
  //
  // Two weaker forms were tried and both failed negative control #8. Writing the literal
  // `"configured"` is a claim about the code above it, and a claim cannot notice its own
  // subject changing. Probing through a separate offer is no better: it measures its own
  // argument, so removing `copy:` from the observed call leaves the probe green. Both stayed
  // green because the catalog restates the shipped defaults — the render is byte-identical
  // whether or not the plane was read, which is exactly why this needs a sentinel at all.
  //
  // The form that works, and the limit of what CAN work. Because the catalog restates the
  // shipped defaults verbatim (that is what holds P-5 to zero served bytes), "the edge read the
  // plane" is unobservable from the output of the real render alone — both answers produce the
  // same bytes. A sentinel is the only discriminator, and it is only evidence about the graded
  // render if it travels through the SAME constructor. Hence one path, called twice:
  //
  //   offerFor(host, resolved.guardConversion)  → what is graded
  //   offerFor(host, sentinelCopy)              → must differ, or `copy` reaches nothing
  //
  // What this cannot catch — honestly, because nothing can — is an edit that bypasses
  // `offerFor` altogether and calls `continuousProtectionOffer` directly. That is equivalent to
  // deleting the measurement, not to defeating it. Negative control #8's faithful form is
  // therefore "drop `copy` from the shared constructor", which this does catch.
  const offerFor = (host: GuardHostId, copy: Partial<GuardOfferCopy>) =>
    continuousProtectionOffer({ hosts: [host], copy })
  return GUARD_HOST_IDS.map((host) => {
    const offer = offerFor(host, resolved.guardConversion)
    const underSentinel = offerFor(host, sentinelCopy)
    const renderedText = renderContinuousProtectionOffer(offer)
    return {
      host,
      recommendation: offer.recommendation,
      requiresSeparateAuthorization: offer.requiresSeparateAuthorization,
      declineOption: offer.declineOption,
      disableCommand: offer.disableCommand,
      disclosureDigest: offer.disclosureDigest,
      components: offer.components.map((c) => ({
        id: c.id,
        label: c.label,
        artifactPath: c.artifactPath,
        uninstallCommand: c.uninstallCommand,
      })),
      renderedText,
      // Derived, not declared. `"configured"` does NOT claim the document differed from the
      // defaults (it does not: the catalog restates them verbatim, and that is what holds P-5
      // to zero served bytes). It claims the edge read the plane AT ALL — the one thing
      // byte-identical output cannot demonstrate, and the reason the sentinel exists.
      copySource:
        renderContinuousProtectionOffer(underSentinel) === renderedText ? "defaults" : "configured",
      disclosureDigestUnderSentinelCopy: underSentinel.disclosureDigest,
    }
  })
}

/** Digest a config path, or the sentinel for "no file" — absence is a state too. */
function configDigest(p: string): string {
  return fs.existsSync(p) ? sha256(readText(p)) : "absent"
}

function rollbackExercise(box: string, id: string, pre: string | null): RollbackRun {
  const configPath = path.join(box, "claude.json")
  if (pre !== null) fs.writeFileSync(configPath, pre, "utf8")
  const digestBefore = configDigest(configPath)

  // The plan comes from the SHIPPED prepare path against a REAL served contract —
  // not hand-built here. A hand-built plan would prove the engine rolls back a
  // plan shaped the way this script imagines, which is not the claim.
  const planPath = path.join(box, "plan.json")
  const prep = runBin(
    [
      "safe-install",
      "--contract", path.join(served, "install", D_SUBJECT, "index.json"),
      "--host", "claude-code",
      "--host-config", configPath,
      "--plan-out", planPath,
      "--json",
    ],
    box,
  )
  if (!fs.existsSync(planPath)) {
    throw new Error(`gate 2.4-E/${id}: prepare produced no plan (exit ${prep.exitCode}): ${prep.stderr.slice(0, 400)}`)
  }
  const plan = readJson(planPath) as InstallPlan

  // The fault: exactly one read — the post-write verify — sees corrupted bytes.
  // Every other operation is the real shipped port on the real disk.
  const real = nodeFsPort()
  let wrote = false
  // Exactly ONE read is corrupted: the post-write verify. The engine's own
  // post-rollback confirmation read must see the truth, or the exercise would be
  // measuring the fault injector instead of the rollback.
  let faultsRemaining = 1
  const faulting: ConfigFs = {
    ...real,
    exists: (p) => real.exists(p),
    readFile: (p) => {
      if (p === configPath && wrote && faultsRemaining > 0) {
        faultsRemaining--
        return '{"mcpServers":{"corrupted-by-the-fault-injector":{}}}'
      }
      return real.readFile(p)
    },
    writeFile: (p, data) => {
      real.writeFile(p, data)
    },
    rename: (from, to) => {
      real.rename(from, to)
      if (to === configPath) wrote = true
    },
    acquireLock: (p) => real.acquireLock(p),
  }

  const result = applyPlan({
    plan,
    approvalDigest: plan.planDigest,
    configPath,
    backupPath: path.join(box, "backup.json"),
    lockPath: path.join(box, "apply.lock"),
    fs: faulting,
    now: new Date().toISOString(),
  })

  return {
    id,
    digestBefore,
    // Read the FILE, not the engine's report — the only claim an operator can check.
    digestAfter: configDigest(configPath),
    outcome: result.outcome,
    rolledBack: result.rolledBack === true,
    // Anything the exercise left in the sandbox besides the artifacts it
    // legitimately owns would be an unaccounted persistent file. `plan.json` is
    // operator-requested output, not a CallLint side effect.
    workspaceFiles: fs
      .readdirSync(box)
      .filter((f) => !["claude.json", "backup.json", "apply.lock", "plan.json"].includes(f))
      .sort(),
  }
}

// --- Gate 2.4-H · observe the gate system itself -----------------------------

/**
 * Every Phase-2.4 gate and the committed artifact that carries its status. The
 * gate id → file map is written out longhand rather than globbed: a glob would
 * report whatever is on disk, so deleting `gate-D-binding.json` would make Gate
 * 2.4-H greener. Naming all eight makes a missing artifact a failure.
 *
 * `machineDecidable: false` marks the one gate no code can close — 2.4-B needs a
 * ≥10-person panel (ADR 0053 §4).
 */
const GATE_ARTIFACTS: readonly { gate: string; file: string; machineDecidable: boolean }[] = [
  { gate: "2.4-A", file: "gate-A-consistency.json", machineDecidable: true },
  { gate: "2.4-B", file: "human-five-second-test.json", machineDecidable: false },
  { gate: "2.4-C", file: "agent-contract-eval.json", machineDecidable: true },
  { gate: "2.4-D", file: "gate-D-binding.json", machineDecidable: true },
  { gate: "2.4-E", file: "gate-E-onetime.json", machineDecidable: true },
  { gate: "2.4-F", file: "gate-F-conversion.json", machineDecidable: true },
  { gate: "2.4-G", file: "e2e-dogfood.json", machineDecidable: true },
]

/**
 * 2.4-H is deliberately NOT in the table above. It grades the other seven plus
 * the wiring, so reading its own committed status back would grade the previous
 * run instead of this one — and hardcoding it PASSED would let a FAILED artifact
 * carry a row claiming it passed. Its real status is folded into the boundary
 * roll-up after the evaluation, where it is known.
 */
const GATE_2_4_H = { gate: "2.4-H", artifact: "artifacts/phase-2.4/gate-H-no-regression.json" } as const

/** Read one gate row off disk. A malformed or absent artifact is MISSING, not a throw. */
function observeGateRow(spec: { gate: string; file: string; machineDecidable: boolean }): GateRecord {
  const p = path.join(outDir, spec.file)
  if (!fs.existsSync(p)) {
    return { gate: spec.gate, artifact: null, status: "MISSING", machineDecidable: spec.machineDecidable }
  }
  const status = (readJson(p).status as GateRecord["status"] | undefined) ?? "MISSING"
  return { gate: spec.gate, artifact: rel(p), status, machineDecidable: spec.machineDecidable }
}

/**
 * The regression checks that must stay wired, and where each is allowed to live.
 *
 * `remoteOnly` is the honest column. `pack:smoke:mcp` and the cross-OS matrix
 * cannot be proven by any local run — the CRLF-checkout failure mode only exists
 * on windows-latest — so the gate asserts they are BOUND to a real workflow job
 * and records that a local pass says nothing about them.
 */
type CheckSpec = { id: string; script: string; remoteOnly: boolean; role: "local-chain" | "check"; workflow: string; job: string }

const REGRESSION_CHECKS: readonly CheckSpec[] = [
  { id: "ci:local", script: "ci:local", remoteOnly: false, role: "local-chain", workflow: "ci.yml", job: "test" },
  { id: "typecheck", script: "typecheck", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "test", script: "test", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "check:public-copy", script: "check:public-copy", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "audit:evidence", script: "audit:evidence", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "audit:calibration", script: "audit:calibration", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "audit:coverage", script: "audit:coverage", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "eval:phase-2.4", script: "eval:phase-2.4", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "eval:phase-2.4:dogfood", script: "eval:phase-2.4:dogfood", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "eval:phase-2.4:gates", script: "eval:phase-2.4:gates", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "eval:phase-2.4:panel:validate", script: "eval:phase-2.4:panel:validate", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  // Workstream P (ADR 0058). The plane audit measures which copy reaches the
  // decision plane; the lock records the P-1 digest seams and holds the no-prose +
  // import-boundary lines. Both are in the gate table so a deleted step is drift.
  { id: "audit:presentation", script: "audit:presentation", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "audit:presentation:lock", script: "audit:presentation:lock", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  // The ENFORCEMENT halves, tracked too. A drift-check row proves the artifact is
  // current; only a gate row proves the boundary is still enforced, and deleting a
  // `:gate` step is exactly how a boundary dies quietly. (Other mechanisms'
  // `:gate` variants are not yet tracked here — a pre-existing gap, not one this
  // batch widens.)
  { id: "audit:presentation:gate", script: "audit:presentation:gate", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "audit:presentation:lock:gate", script: "audit:presentation:lock:gate", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  // P-6 — new15 §14's four acceptance-gate blocks. Both halves tracked for the same
  // reason as the pair above: the drift row proves the artifact is current, the gate
  // row proves 安全隔离 is still enforced. §14 declared these blocks and nothing ran
  // them until P-6, so an untracked step here would let them go quiet the same way.
  { id: "audit:preview", script: "audit:preview", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  { id: "audit:preview:gate", script: "audit:preview:gate", remoteOnly: false, role: "check", workflow: "ci.yml", job: "test" },
  // Remote-only: the CRLF-checkout and isolated-install failure modes exist only
  // on a fresh runner, so a local pass proves nothing about them.
  { id: "pack:smoke:mcp", script: "pack:smoke:mcp", remoteOnly: true, role: "check", workflow: "ci.yml", job: "test" },
  { id: "pack:smoke", script: "pack:smoke", remoteOnly: true, role: "check", workflow: "ci.yml", job: "test" },
  // The ONLY row bound to a job other than `test`, and the reason it exists is
  // `wired/aggregator-reachable` rather than the ledger itself (ADR 0080).
  //
  // MEASURED, not predicted: with the `ledger-authenticity` job added to ci.yml and
  // wired into `build-and-test`'s `needs`, deleting it from that `needs` list left
  // Gate 2.4-H **PASSED**. `aggregatorMeasure` computes `boundJobs` from these rows,
  // so a job no row names contributes nothing to `unreached` — the new job was a
  // status the required check happened to wait on, indistinguishable from one it did
  // not. This row is what puts `ledger-authenticity` into `boundJobs`, which is what
  // makes dropping it from `needs` a FAILING measure.
  //
  // `remoteOnly: false` is the honest value even though the job is remote: the fault
  // class is fully local-reproducible — both times it fired (#249, #293) a human found
  // it by running the suite on a full clone. So it belongs in `ci:local` too, and
  // adding it there is what moves that chain from 20 steps to 21.
  { id: "ledger:presentation:validate", script: "ledger:presentation:validate", remoteOnly: false, role: "check", workflow: "ci.yml", job: "ledger-authenticity" },
]

/** The served subtrees whose bytes are a published contract, and their two guards. */
const SERVED_SUBTREES: readonly { subtree: string; pin: string; guardTest: string }[] = [
  { subtree: "apps/web/public/trust/**", pin: "apps/web/public/trust/** text eol=lf", guardTest: "packages/trust-index/test/committed-tree.test.ts" },
  { subtree: "apps/web/public/install/**", pin: "apps/web/public/install/** text eol=lf", guardTest: "packages/trust-index/test/safe-install/committed-install-tree.test.ts" },
  { subtree: "apps/web/public/.well-known/calllint.json", pin: "apps/web/public/.well-known/calllint.json text eol=lf", guardTest: "packages/trust-index/test/safe-install/committed-install-tree.test.ts" },
  { subtree: "packages/calllint-mcp/src/data/**", pin: "packages/calllint-mcp/src/data/** text eol=lf", guardTest: "packages/calllint-mcp/test/committed-contracts-drift.test.ts" },
  { subtree: "artifacts/phase-2.4/**", pin: "artifacts/phase-2.4/** text eol=lf", guardTest: "scripts/phase-2.4-gates.ts" },
  // ADR 0059 §4 — the copy-only assist every install page references by src. Served bytes
  // with a source/served split, so both sides carry the pin and the guard test byte-compares
  // them; a pin with no row here is itself unguarded (deleting it would fail nothing).
  { subtree: "apps/web/public/scripts/**", pin: "apps/web/public/scripts/** text eol=lf", guardTest: "packages/trust-index/test/safe-install/token-plane.test.ts" },
  { subtree: "apps/web/public/styles/**", pin: "apps/web/public/styles/** text eol=lf", guardTest: "packages/trust-index/test/safe-install/token-plane.test.ts" },
]

/** The tool names each source states, for the name-agreement measure below. */
function readToolNameSources(): { declared: string[]; enumerated: string[] } {
  const toolsSrc = readText(path.join(repoRoot, "packages", "calllint-mcp", "src", "tools.ts"))
  const testSrc = readText(path.join(repoRoot, "packages", "calllint-mcp", "test", "tools.test.ts"))
  // `[^"]+`, not `[a-z_]+`: a rename to `...installX` must show up as a DRIFTED NAME, not as a
  // shortfall in the scan. Measured — both classes capture the same 13 names on today's bytes.
  const declared = [...toolsSrc.matchAll(/^ {4}name: "([^"]+)",$/gm)].map((m) => m[1])
  const enumerated = [...testSrc.matchAll(/^ {8}"([a-z_]+)",$/gm)].map((m) => m[1])
  return { declared, enumerated }
}

/** Count the MCP tools in each place that states a count. Drift here is the gate. */
function observeToolCounts(): { source: string; count: number }[] {
  const smokeSrc = readText(path.join(repoRoot, "scripts", "mcp-pack-smoke.mjs"))
  const declared = readToolNameSources().declared.length
  const asserted = smokeSrc.match(/tools\?\.length !== (\d+)/)
  return [
    { source: "packages/calllint-mcp/src/tools.ts (declared)", count: declared },
    { source: "scripts/mcp-pack-smoke.mjs (asserted)", count: asserted ? Number(asserted[1]) : -1 },
  ]
}

/**
 * The job every wired check must ultimately reach. It is the repo ruleset's
 * required check, so a step in a job this one does not `need` blocks nothing.
 */
const REQUIRED_AGGREGATOR = "build-and-test"

/** A workflow file as the RUNNER sees it: parsed, or the reason it could not be. */
interface WorkflowGraph {
  readonly exists: boolean
  /** The parser's own first line, or null when the file parsed. */
  readonly parseError: string | null
  readonly jobs: Record<string, unknown>
  /** Raw source, kept for the text precondition (see `bindCheck`). */
  readonly src: string
}

/**
 * Parse one workflow, once. S0-OPEN-5 (ADR 0071): Gate 2.4-H used to decide wiring
 * from a text match, so it reported 18 checks "wired" on the exact bytes GitHub
 * refused — an unparseable workflow starts ZERO jobs, which means a required check
 * stops EXISTING rather than going red.
 *
 * No `\r\n` normalization here on purpose, and that is measured, not assumed:
 * `.github/workflows/**` carries no `eol` pin (`git check-attr text eol` → both
 * unspecified), so windows-latest checks these out as CRLF — and `yaml@2.8.2`
 * strips `\r` from scalars itself (24 `run:` scalars, 0 containing a raw `\r`).
 * The regex path's CRLF tolerance was the accidental kind: `\s*` absorbing the
 * `\r`, and `$` under `/m` treating it as a line terminator.
 */
function readWorkflowGraph(file: string): WorkflowGraph {
  const p = path.join(repoRoot, ".github", "workflows", file)
  if (!fs.existsSync(p)) return { exists: false, parseError: null, jobs: {}, src: "" }
  const src = readText(p)
  let doc: unknown
  try {
    doc = parseYaml(src)
  } catch (err) {
    // The parser's own message, not "invalid YAML": `Nested mappings are not allowed
    // …at line 150` sends the reader to the line, while the generic form sends them
    // to a bisect. This is the string the control in the test suite asserts on.
    return {
      exists: true,
      parseError: err instanceof Error ? err.message.split("\n")[0] : String(err),
      jobs: {},
      src,
    }
  }
  const jobs = (doc as { jobs?: unknown } | null)?.jobs
  // A parse that SUCCEEDS into the wrong shape is its own failure mode: `- name: a: b`
  // can yield a nested map rather than throwing, so `jobs` must be an object too.
  if (typeof jobs !== "object" || jobs === null || Array.isArray(jobs)) {
    return { exists: true, parseError: "parsed, but `jobs` is not a mapping", jobs: {}, src }
  }
  return { exists: true, parseError: null, jobs: jobs as Record<string, unknown>, src }
}

/** Every job the required aggregator waits on, as declared by its `needs`. */
function aggregatorNeeds(graph: WorkflowGraph): string[] {
  const agg = graph.jobs[REQUIRED_AGGREGATOR]
  if (typeof agg !== "object" || agg === null) return []
  const needs = (agg as { needs?: unknown }).needs
  if (typeof needs === "string") return [needs]
  return Array.isArray(needs) ? needs.filter((n): n is string => typeof n === "string") : []
}

/**
 * Decide whether one check is wired, using TWO probes that fail on opposite things.
 *
 * The structural lookup answers the runner's question; the text match is kept as a
 * PRECONDITION rather than replaced, for the reason ADR 0069 §3 gives: a parse alone
 * goes green when a step is renamed away into a shape the parser still accepts, and a
 * scan alone goes green when the file cannot run at all. Their DISAGREEMENT is a third,
 * independent fault — it must not be absorbed by either side, because "the two ways of
 * reading this file no longer agree" is exactly the state that hid the original defect.
 *
 * Returns the binding string, or the reason there is none. The reason is carried out to
 * the measure so the observed line names the parse failure instead of the misleading
 * "bound to no workflow job", which is what 18 rows printed before ADR 0071.
 */
function bindCheck(c: CheckSpec, graph: WorkflowGraph): { binding: string | null; why: string | null } {
  if (!graph.exists) return { binding: null, why: `.github/workflows/${c.workflow} does not exist` }
  if (graph.parseError !== null) {
    return {
      binding: null,
      why: `${c.workflow} does not parse, so no runner will start a job from it — ${graph.parseError}`,
    }
  }
  const job = graph.jobs[c.job]
  const structural =
    typeof job === "object" &&
    job !== null &&
    Array.isArray((job as { steps?: unknown }).steps) &&
    ((job as { steps: unknown[] }).steps ?? []).some((s) => {
      const run = (s as { run?: unknown } | null)?.run
      // Whole token, and tolerant of the shapes a real step uses: `&&`-chained
      // commands, and the one multi-line `run:` block in ci.yml. A bare `includes`
      // would let `pnpm eval:phase-2.4` match `pnpm eval:phase-2.4:dogfood`.
      return typeof run === "string" && new RegExp(`(^|\\s|&&\\s*)pnpm ${escapeRe(c.script)}(\\s|$)`).test(run)
    })
  // The original probe, preserved verbatim as the precondition.
  const textual =
    new RegExp(`run: pnpm ${escapeRe(c.script)}\\s*$`, "m").test(graph.src) &&
    new RegExp(`^  ${escapeRe(c.job)}:$`, "m").test(graph.src)

  if (structural !== textual) {
    return {
      binding: null,
      why:
        `the two probes disagree — the parsed graph says ${structural ? "BOUND" : "not bound"} while the text ` +
        `match says ${textual ? "BOUND" : "not bound"}; one of them is reading something the runner does not`,
    }
  }
  if (!structural) {
    const jobMissing = typeof job !== "object" || job === null
    return {
      binding: null,
      why: jobMissing
        ? `${c.workflow} has no job \`${c.job}\` (jobs: ${Object.keys(graph.jobs).join(", ") || "none"})`
        : `no step in ${c.workflow}#${c.job} runs \`pnpm ${c.script}\``,
    }
  }
  return { binding: `${c.workflow}#${c.job}`, why: null }
}

function observeGateH(): {
  gates: GateRecord[]
  checks: WiredCheck[]
  served: ServedGuard[]
  toolCounts: { source: string; count: number }[]
  aggregator: AggregatorReach
  toolNames: ToolNameSources
} {
  const pkgScripts = (readJson(path.join(repoRoot, "package.json")).scripts ?? {}) as Record<string, string>
  const localChain = pkgScripts["ci:local"] ?? ""
  const gitattributes = readText(path.join(repoRoot, ".gitattributes"))

  // One parse per FILE, not per row: all 19 rows name `ci.yml` today, and parsing it
  // 19 times would also report the same parse error 19 times.
  const graphs = new Map<string, WorkflowGraph>()
  const graphFor = (file: string): WorkflowGraph => {
    let g = graphs.get(file)
    if (g === undefined) {
      g = readWorkflowGraph(file)
      graphs.set(file, g)
    }
    return g
  }

  const checks: WiredCheck[] = REGRESSION_CHECKS.map((c) => {
    const { binding, why } = bindCheck(c, graphFor(c.workflow))
    return {
      id: c.id,
      script: pkgScripts[c.script] ?? null,
      // `ci:local` is the chain itself; every other check must appear inside it.
      // Same anchoring problem inside the chain: `ci:local` is ` && `-joined, so a
      // member must be followed by ` &&` or the end of the string, never by `:`.
      inLocalChain:
        c.role === "local-chain"
          ? true
          : new RegExp(`pnpm ${escapeRe(c.script)}(\\s|$)`).test(localChain),
      workflowBinding: binding,
      bindingFault: why,
      remoteOnly: c.remoteOnly,
      role: c.role,
    }
  })

  const served: ServedGuard[] = SERVED_SUBTREES.map((s) => ({
    subtree: s.subtree,
    guardTest: fs.existsSync(path.join(repoRoot, s.guardTest)) ? s.guardTest : null,
    eolPinned: gitattributes.includes(s.pin),
  }))

  // The aggregator's reach, read from the same parsed graph. `ci.yml` is the only
  // workflow any row binds; if that ever stops being true this needs a row per file.
  const ciGraph = graphFor("ci.yml")
  const aggregator: AggregatorReach = {
    workflow: "ci.yml",
    job: REQUIRED_AGGREGATOR,
    present: Object.prototype.hasOwnProperty.call(ciGraph.jobs, REQUIRED_AGGREGATOR),
    needs: aggregatorNeeds(ciGraph),
    parseError: ciGraph.parseError,
  }

  return {
    gates: GATE_ARTIFACTS.map(observeGateRow),
    checks,
    served,
    toolCounts: observeToolCounts(),
    aggregator,
    toolNames: readToolNameSources(),
  }
}

// --- render the artifacts ----------------------------------------------------

/** One artifact per gate. Each is a byte-stable projection of its measures. */
interface Artifact {
  readonly file: string
  readonly json: string
  readonly gate: string
  readonly result: GateResult
}

function artifact(gate: string, file: string, why: string, result: GateResult, body: Record<string, unknown>): Artifact {
  const doc = {
    schema: `calllint.phase-2.4-gate-${gate.toLowerCase().replace(/^2\.4-/, "")}.v0`,
    $comment: why,
    gate,
    status: result.status,
    engine: EVAL_ENGINE_VERSION,
    ...body,
    measures: result.measures,
    blockers: result.blockers,
  }
  return { file, json: JSON.stringify(doc, null, 2) + "\n", gate, result }
}

/**
 * The release-boundary roll-up. Separate from Gate 2.4-H's own status on purpose:
 * "nothing regressed" and "the boundary is closed" are different claims, and
 * collapsing them is how a machine-run gate would silently authorize a release
 * that still owes a human panel. Gate 2.4-H can be PASSED while `closed` is
 * false — that is the correct state today.
 */
function boundaryRollUp(gates: readonly GateRecord[], selfStatus: GateRecord["status"]): Record<string, unknown> {
  // 2.4-H's own status is known only after its evaluation, so it joins here.
  const all: GateRecord[] = [
    ...gates,
    { gate: GATE_2_4_H.gate, artifact: GATE_2_4_H.artifact, status: selfStatus, machineDecidable: true },
  ]
  const open = all.filter((g) => g.status !== "PASSED")
  return {
    gatesEvaluated: all.length,
    closed: open.length === 0,
    openGates: open.map((g) => ({
      gate: g.gate,
      status: g.status,
      blockedBy: g.machineDecidable ? "code" : "human panel (≥10 responses; ADR 0053 §4) — no run of this repo can close it",
    })),
    // Named so a reader does not have to infer it from `closed: false`.
    consequence:
      open.length === 0
        ? "Gates 2.4-A…H all PASSED — the new14 release boundary is closed; Batch 10 cohort expansion is unblocked by this boundary (still gated on new15 Workstream R landing)."
        : `Batch 10 cohort expansion stays BLOCKED: ${open.map((g) => g.gate).join(", ")} not PASSED. Workstream R (Phase 2.3) is gated on this same boundary; Workstream P (Phase 2.4 presentation half) is NOT — it depends only on the shipped renderers (new15-integration §5).`,
  }
}

function buildAll(): Artifact[] {
  const a = observeGateA()
  const d = observeGateD()
  const e = { steps: liftOneTimeSteps(), rollbacks: observeGateE() }
  const f = observeGateF()
  const h = observeGateH()
  // Evaluated before the artifact is assembled: the roll-up needs 2.4-H's own status.
  const hResult = evaluateNoRegression(
    h.gates,
    h.checks,
    h.served,
    h.toolCounts,
    GATE_ARTIFACTS.length,
    h.aggregator,
    h.toolNames,
  )

  return [
    artifact(
      "2.4-A",
      "gate-A-consistency.json",
      "Gate 2.4-A evidence. Every REAL served identity is read off all six surfaces it publishes (trust JSON, evidence manifest, agent contract, trust HTML, install HTML, lookup index) and the decision-bearing facts must agree. HTML carries no machine fields, so it is measured by verbatim presence of the same value — a missing value is recorded as ABSENT(...) and fails, rather than being silently skipped. The cohort size and the per-identity surface count are asserted too, because a surface that stopped being emitted would otherwise 'agree' trivially. Regenerate with `pnpm eval:phase-2.4:gates:write`.",
      evaluateOneSourceConsistency(a.identities, a.identities.length, a.surfacesPer),
      { identitiesEvaluated: a.identities.length, surfacesPerIdentity: a.surfacesPer, identities: a.identities },
    ),
    artifact(
      "2.4-D",
      "gate-D-binding.json",
      "Gate 2.4-D evidence. Two independent claims. (1) BEHAVIOURAL: the real built binary is driven against a REAL served contract with each of the three target dimensions falsified in turn (artifact digest, contract digest, version); each run must end TARGET_MISMATCH with a non-zero exit, hand back NO plan digest, leave NO host config on disk, and name the falsified dimension so the operator can act. The decisive measure is the filesystem, not the tool's own report. (2) STRUCTURAL: every filesystem write site in the shipped safe-install surface is enumerated and classified by destination; a behavioural test can only prove the paths it exercises, while this proves there is no other path to exercise (INV-2.4-03, one writer). Regenerate with `pnpm eval:phase-2.4:gates:write`.",
      evaluateLocalBinding(d.runs, d.writeSites, 3),
      { subject: D_SUBJECT, mismatchRuns: d.runs, writeSites: d.writeSites },
    ),
    artifact(
      "2.4-E",
      "gate-E-onetime.json",
      "Gate 2.4-E evidence. The one-time footprint is LIFTED from the committed Gate 2.4-G dogfood record rather than re-measured, so the two gates cannot disagree about the same flow. The rollback half is a REAL exercise: a plan produced by the SHIPPED prepare path against a REAL served contract, applied by the SHIPPED engine through the SHIPPED node fs port on a REAL temp file, with a fault injected at exactly one point — the post-write verify read returns corrupted bytes, which is the one thing a healthy disk will never do for us. The backup, the atomic temp→rename write and the rollback rename are all real, and the measure is the file's actual digest afterwards, not the engine's report. Both pre-images are covered: an existing config must come back byte-identical, and a config CallLint created must come back absent. Regenerate with `pnpm eval:phase-2.4:gates:write`.",
      evaluateOneTimeSetup(e.steps, e.rollbacks, 2),
      { oneTimeStepsLifted: e.steps.length, oneTimeSource: "artifacts/phase-2.4/e2e-dogfood.json", rollbacks: e.rollbacks },
    ),
    artifact(
      "2.4-F",
      "gate-F-conversion.json",
      "Gate 2.4-F evidence. The shipped continuous-protection offer is built for every guard host in ASK_AFTER_SUCCESS — the state where a one-time setup just succeeded and CallLint asks for something persistent. Both the offer OBJECT and the RENDERED TEXT are measured together: an object that discloses a component the renderer then omits would satisfy either half alone while still deceiving the person deciding. Disclosure is strict — every component's label, its artifact path and its uninstall command must appear verbatim in what the human sees, alongside the disable command and a visible [Not now]. Regenerate with `pnpm eval:phase-2.4:gates:write`.",
      evaluateConversion(f, GUARD_HOST_IDS.length),
      { hostsEvaluated: f.length, observations: f },
    ),
    artifact(
      "2.4-H",
      "gate-H-no-regression.json",
      "Gate 2.4-H evidence — the only gate whose subject is the gate SYSTEM, not the product. It asks what the other seven cannot ask about themselves: is every mechanism that would CATCH a regression still present and still wired to something that runs it? Five things are measured. (1) All eight gate rows have a committed artifact and a recorded status, read from a longhand id→file map rather than a glob, so DELETING an artifact fails the gate instead of improving it. (2) Every machine-decidable gate is PASSED; 2.4-B is recorded as human-decided and excluded from the floor, because unfinished human work is not a regression — but it is never counted as passed either. (3) The MCP tool count agrees between the tool table that produces it and the pack smoke that asserts it — the Phase-2.6 N8 local-green/remote-red failure mode. (4) Every regression check resolves to a real package.json script AND to a place that runs it; the two checks a local run cannot prove (pack:smoke:mcp, the cross-OS CRLF checkout) are marked REMOTE-ONLY and asserted to be bound to a real workflow job instead of being claimed as passed. Bindings are read by PARSING the workflow the way the runner does, with the old text match kept as a precondition and any disagreement between the two probes recorded as its own fault: a parse alone would go green when a step is renamed away, a text scan alone would go green when the file cannot run at all. (5) The required `build-and-test` check exists and its `needs` covers every job those checks bind to — a bound job the required check does not wait on blocks nothing. That measure is held separately because when `ci.yml` stopped parsing, all 18 rows recited 'bound to no workflow job' and not one of them said why. Finally, every served subtree is asserted to have BOTH a reproducibility guard test and a `.gitattributes eol=lf` pin. The `releaseBoundary` block is deliberately separate from this gate's status: 'nothing regressed' and 'the boundary is closed' are different claims, and collapsing them is how a machine run would authorize a release that still owes a human panel. Regenerate with `pnpm eval:phase-2.4:gates:write`.",
      hResult,
      {
        releaseBoundary: boundaryRollUp(h.gates, hResult.status),
        gates: h.gates,
        mcpToolCounts: h.toolCounts,
        regressionChecks: h.checks,
        requiredAggregator: h.aggregator,
        servedGuards: h.served,
      },
    ),
  ]
}

// --- modes -------------------------------------------------------------------

const argv = process.argv.slice(2)
const mode = argv.includes("--write") ? "write" : argv.includes("--gate") ? "gate" : "check"

if (!fs.existsSync(cli)) {
  console.error(`missing ${rel(cli)} — run \`pnpm build\` first (Gates 2.4-D/E drive the real binary)`)
  process.exit(2)
}

const artifacts = buildAll()
const summary = artifacts.map((a) => `${a.gate} ${a.result.status}`).join(" · ")

if (mode === "write") {
  fs.mkdirSync(outDir, { recursive: true })
  for (const a of artifacts) fs.writeFileSync(path.join(outDir, a.file), a.json, "utf8")
  console.log(summary)
  console.log(`Wrote ${artifacts.map((a) => a.file).join(", ")} in ${rel(outDir)}`)
  process.exit(0)
}

if (mode === "gate") {
  console.log(summary)
  const failed = artifacts.filter((a) => a.result.status !== "PASSED")
  for (const a of failed) for (const b of a.result.blockers) console.error(`  ${a.gate} — ${b}`)
  process.exit(failed.length === 0 ? 0 : 2)
}

// --check (CI default): drift only, so a red gate is reported without breaking CI.
let drifted = false
for (const a of artifacts) {
  const p = path.join(outDir, a.file)
  if (!fs.existsSync(p)) {
    console.error(`missing ${rel(p)} — run \`pnpm eval:phase-2.4:gates:write\``)
    drifted = true
    continue
  }
  if (readText(p) !== a.json) {
    console.error(`${rel(p)} is stale — run \`pnpm eval:phase-2.4:gates:write\``)
    drifted = true
  }
}
if (drifted) process.exit(1)
console.log(`${summary} (artifacts in sync)`)
process.exit(0)
