#!/usr/bin/env tsx
/**
 * Workstream P Batch 0 — presentation-plane reality audit (new15 §6.2 PR P-0;
 * ADR 0058 §1/§5).
 *
 * A THIN observer. It measures three things and computes no policy:
 *   1. PLANE STAGES — is each targeted directory at the stage its PR expects, and do the
 *      served pages still carry no stylesheet? P-0 asserted both planes greenfield; P-2
 *      creates the content plane, so the expectation is now per-plane and bidirectional
 *      (see `TARGET_DIRS`) — a stronger rule, not a relaxed one.
 *   2. INVENTORY — every hardcoded copy site on the Safe-install surface, counted
 *      from source, so each lift has a denominator instead of a vibe.
 *   3. REACHABILITY — the mutation probe from `presentationAudit.ts`: which copy
 *      values can reach `contractDigest`. This is what makes an ADR 0058 level a
 *      MEASUREMENT rather than an opinion, and it is the gate that keeps
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
  SECTION_TITLES,
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

/**
 * The two directories new15 §18.2 targets, each with the stage it is EXPECTED to be at.
 *
 * P-0 asserted both absent. That assertion was correct then and is false now: P-2 creates
 * the content plane, so a blanket greenfield rule would make the batch that does the work
 * the batch that fails the gate. The fix is not to relax the rule — it is to make it
 * per-plane and bidirectional, which is strictly stronger than what P-0 had:
 *
 *   • `apps/web/content` must now be PRESENT. Deleting it would fail, so the gate now
 *     also protects the plane it used to forbid.
 *   • `apps/web/styles` must still be ABSENT. Creating it early fails, exactly as before.
 *
 * Each entry names the PR that changes its expectation, so the next flip is a one-line
 * edit with its justification already written down rather than a rediscovered argument.
 */
const TARGET_DIRS = [
  { dir: "apps/web/content", expect: "present", since: "P-2", why: "the copy catalog lifted by PR P-2" },
  { dir: "apps/web/styles", expect: "absent", since: "P-4", why: "design tokens are not lifted until PR P-4" },
] as const

/**
 * Count human-facing sentence literals in a source file. The heuristic is
 * deliberately narrow and stated rather than clever: a double-quoted literal of at
 * least 12 characters that contains a space and a lowercase letter, and that STARTS
 * with a letter. That catches prose ("Requires access to configured secrets.") and
 * skips identifiers, reason codes, paths, and enum members — which is exactly the
 * split PR P-2 must lift.
 *
 * The leading-letter clause earns its place: P-2 added an `escText` helper whose body
 * is a chain of `.replace(/</g, "&lt;")` calls, and the source fragments BETWEEN those
 * arguments (`").replace(/</g, "`) satisfied every other clause. Sorted, they landed
 * ahead of the real prose and pushed it out of the three recorded samples — a committed
 * report that had stopped illustrating what it counts. Prose does not begin with
 * punctuation, so requiring a leading letter is a statement about the target, not a
 * patch aimed at one file.
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
    if (!/^[A-Za-z]/.test(v)) continue // prose starts with a letter, not punctuation
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
    sectionTitles: Object.values(SECTION_TITLES),
    verdictLabel: Object.values(VERDICT_PUBLIC_LABEL),
    guidanceSteps: [...AGENT_GUIDANCE.steps],
  })

  const planeStages = TARGET_DIRS.map((d) => {
    const exists = fs.existsSync(path.join(repoRoot, d.dir))
    return {
      dir: d.dir,
      exists,
      expected: d.expect,
      expectedSince: d.since,
      why: d.why,
      ok: exists === (d.expect === "present"),
    }
  })
  const inventory = COPY_SOURCES.map((rel) => {
    const abs = path.join(repoRoot, rel)
    const c = countCopyLiterals(fs.readFileSync(abs, "utf8"))
    return { source: rel, copyLiterals: c.count, samples: c.samples }
  })
  const css = servedStylesheetRefs()

  const failures = [
    ...audit.failures,
    ...planeStages
      .filter((p) => !p.ok)
      .map((p) =>
        p.expected === "present"
          ? `${p.dir} is missing — expected present since ${p.expectedSince} (${p.why})`
          : `${p.dir} exists — expected absent until ${p.expectedSince} (${p.why})`,
      ),
    // The served-bytes floor (ADR 0058 §4): only PR P-4b may put CSS on a served page.
    // Measured here rather than merely recorded, so lifting copy can never quietly
    // become a visual change.
    ...(css.pagesWithStylesheet > 0
      ? [
          `${css.pagesWithStylesheet} served install page(s) reference a stylesheet — only PR P-4b may change served bytes (ADR 0058 §4)`,
        ]
      : []),
  ]

  const report = {
    schema: "calllint.presentation-plane-audit.v0",
    $comment:
      "Workstream P presentation-plane reality audit (ADR 0058 §1/§5), re-baselined by PR P-2. reachability[] is MEASURED by mutation/containment probe over the shipped projection, not declared: a row whose declaredPlane disagrees with its measuredPlane fails. The VERDICT_PUBLIC_LABEL and AGENT_GUIDANCE.steps rows are negative controls — they MUST measure as decision-plane, otherwise the probe cannot detect reachability and every other row is meaningless. planeStages replaces P-0's blanket greenfield assertion: creating apps/web/content is P-2's WORK, so the expectation is now per-plane and bidirectional (content must be present, styles must still be absent until P-4) — strictly stronger, since deleting the content plane now fails too. Regenerate with `pnpm audit:presentation:write`; enforce with `pnpm audit:presentation:gate`.",
    workstream: "P",
    pr: "P-2",
    status: failures.length === 0 ? "PASSED" : "FAILED",
    planeStages,
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
