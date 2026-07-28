#!/usr/bin/env tsx
/**
 * Workstream P Batch 0 — presentation-plane reality audit (new15 §6.2 PR P-0;
 * ADR 0058 §1/§5).
 *
 * A THIN observer. It measures three things and computes no policy:
 *   1. GREENFIELD — are `apps/web/content/**` and `apps/web/styles/**` really absent,
 *      and do the served pages really carry no stylesheet? (new15 §"reality check")
 *   2. INVENTORY — every hardcoded copy site on the Safe-install surface, counted
 *      from source, so the lift in PR P-2 has a denominator instead of a vibe.
 *   3. REACHABILITY — the mutation probe from `presentationAudit.ts`: which copy
 *      values can reach `contractDigest`. This is what makes an ADR 0058 level a
 *      MEASUREMENT rather than an opinion, and it is the gate that will keep
 *      PR P-2..P-7 from quietly moving an L3 string into a config file.
 *
 * Modes (same contract as `pnpm eval:phase-2.4`):
 *   (default) --check : the committed artifact must be byte-identical to a fresh run.
 *   --write           : (re)generate it.
 *   --gate            : ENFORCEMENT. Exit 2 unless every probe passes.
 *
 * Exit codes: 0 ok · 1 drift (--check) · 2 gate failed (--gate) / unexpected error.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import {
  ABSENCE_CONSEQUENCE,
  AGENT_GUIDANCE,
  CANONICAL_FIXTURES,
  OBSERVED_CONSEQUENCE,
  PRIMARY_CTA,
  canonicalProjectionInput,
  runPresentationAudit,
} from "../packages/trust-index/src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outPath = path.join(repoRoot, "artifacts", "phase-2.4", "presentation-plane-audit.json")

/** Repo-relative source files that own Safe-install copy today (new15 §4.2 P2). */
const COPY_SOURCES = [
  "packages/trust-index/src/renderSafeInstall.ts",
  "packages/trust-index/src/safeInstallProjection.ts",
  "packages/trust-index/src/selectDecisionAuthorities.ts",
  "packages/trust-index/src/agentAdoptionContract.ts",
  "packages/trust-index/src/language.ts",
  "packages/core/src/gateway/continuousProtection.ts",
] as const

/** Directories new15 §18.2 targets, asserted greenfield at P-0. */
const TARGET_DIRS = ["apps/web/content", "apps/web/styles"] as const

/**
 * Count human-facing sentence literals in a source file. The heuristic is
 * deliberately narrow and stated rather than clever: a double-quoted literal of at
 * least 12 characters that contains a space and a lowercase letter. That catches
 * prose ("Requires access to configured secrets.") and skips identifiers, reason
 * codes, paths, and enum members — which is exactly the split PR P-2 must lift.
 *
 * This is an INVENTORY, not a boundary: the boundary is the reachability probe. A
 * count that is slightly off changes a number in a report; it cannot let an L3
 * string escape into configuration.
 */
function countCopyLiterals(source: string): { count: number; samples: string[] } {
  const found = new Set<string>()
  for (const m of source.matchAll(/"((?:[^"\\\n]|\\.){12,})"/g)) {
    const v = m[1]
    if (!/ /.test(v)) continue
    if (!/[a-z]/.test(v)) continue
    if (/^(?:https?:|\.{0,2}\/|[a-z-]+\/)/.test(v)) continue // urls & paths
    found.add(v)
  }
  const all = [...found].sort()
  return { count: all.length, samples: all.slice(0, 3) }
}

/** Does any served install page reference a stylesheet? (the P-4b precondition) */
function servedStylesheetRefs(): { pagesScanned: number; pagesWithStylesheet: number } {
  const root = path.join(repoRoot, "apps", "web", "public", "install")
  if (!fs.existsSync(root)) return { pagesScanned: 0, pagesWithStylesheet: 0 }
  const pages: string[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === "index.html") pages.push(p)
    }
  }
  walk(root)
  const withCss = pages.filter((p) => {
    const html = fs.readFileSync(p, "utf8")
    return /rel="stylesheet"/.test(html) || /<style[\s>]/.test(html)
  })
  return { pagesScanned: pages.length, pagesWithStylesheet: withCss.length }
}

/** Build the artifact. No clock, no RNG — byte-stable across runs. */
function build(): { json: string; pass: boolean; failures: readonly string[] } {
  const inputs = CANONICAL_FIXTURES.map((f) => canonicalProjectionInput(f))
  const audit = runPresentationAudit(inputs, {
    observedConsequence: Object.values(OBSERVED_CONSEQUENCE),
    absenceConsequence: Object.values(ABSENCE_CONSEQUENCE),
    primaryCta: Object.values(PRIMARY_CTA),
    verdictLabel: Object.values(VERDICT_PUBLIC_LABEL),
    guidanceSteps: [...AGENT_GUIDANCE.steps],
  })

  const greenfield = TARGET_DIRS.map((d) => ({
    dir: d,
    exists: fs.existsSync(path.join(repoRoot, d)),
  }))
  const inventory = COPY_SOURCES.map((rel) => {
    const abs = path.join(repoRoot, rel)
    const c = countCopyLiterals(fs.readFileSync(abs, "utf8"))
    return { source: rel, copyLiterals: c.count, samples: c.samples }
  })
  const css = servedStylesheetRefs()

  const failures = [
    ...audit.failures,
    ...greenfield.filter((g) => g.exists).map((g) => `${g.dir} already exists — P-0 expects greenfield`),
  ]

  const report = {
    schema: "calllint.presentation-plane-audit.v0",
    $comment:
      "Workstream P PR P-0 reality audit (ADR 0058 §1/§5). reachability[] is MEASURED by mutation/containment probe over the shipped projection, not declared: a row whose declaredPlane disagrees with its measuredPlane fails. The VERDICT_PUBLIC_LABEL and AGENT_GUIDANCE.steps rows are negative controls — they MUST measure as decision-plane, otherwise the probe cannot detect reachability and every other row is meaningless. Regenerate with `pnpm audit:presentation:write`; enforce with `pnpm audit:presentation:gate`.",
    workstream: "P",
    pr: "P-0",
    status: failures.length === 0 ? "PASSED" : "FAILED",
    greenfield,
    servedStylesheets: {
      ...css,
      $comment:
        "pagesWithStylesheet must be 0 until PR P-4b, the only Workstream P PR permitted to change served bytes (ADR 0058 §4).",
    },
    inventory,
    inventoryTotal: inventory.reduce((n, i) => n + i.copyLiterals, 0),
    reachability: {
      sitesProbed: audit.sitesProbed,
      presentationSites: audit.presentationSites,
      decisionSites: audit.decisionSites,
      pass: audit.pass,
      probes: audit.probes,
    },
    failures,
  }
  return { json: JSON.stringify(report, null, 2) + "\n", pass: failures.length === 0, failures }
}

// --- modes -------------------------------------------------------------------

const argv = process.argv.slice(2)
const { json, pass, failures } = build()
const rel = path.relative(repoRoot, outPath)

if (argv.includes("--write")) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, json, "utf8")
  console.log(`wrote ${rel} — ${pass ? "PASSED" : "FAILED"}`)
  process.exit(0)
}

if (argv.includes("--gate")) {
  if (pass) {
    console.log("presentation-plane audit: PASSED — every copy site measured at its declared plane.")
    process.exit(0)
  }
  console.error("presentation-plane audit: FAILED")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(2)
}

// default --check: committed artifact must match a fresh run.
if (!fs.existsSync(outPath)) {
  console.error(`${rel} is missing — run \`pnpm audit:presentation:write\`.`)
  process.exit(1)
}
if (fs.readFileSync(outPath, "utf8") !== json) {
  console.error(`${rel} drifted from a fresh audit — run \`pnpm audit:presentation:write\` and review the diff.`)
  process.exit(1)
}
console.log(`${rel} matches a fresh audit — ${pass ? "PASSED" : "FAILED"}`)
process.exit(0)
