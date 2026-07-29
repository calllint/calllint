#!/usr/bin/env tsx
/**
 * Workstream P Batch 1 — the presentation lock (new15 §6.2 PR P-1, §7; ADR 0058 §5).
 *
 * A THIN observer over the SERVED bytes. It computes no policy and decides no
 * verdict; it records the two digest seams P-1 introduces and measures the
 * properties that justify them:
 *
 *   1. CONTENT PLANE — the presentation document's digest set. At P-1 there is no
 *      apps/web/content/** at all, so the lock records the canonical EMPTY
 *      document's digest with contentPlane:"absent". That is deliberate: PR P-7's
 *      rollback needs a real predecessor to restore (INV-P3), and a null would be
 *      a special case every consumer has to branch on.
 *   2. SEMANTIC CONTRACT DIGEST — computed for all 19 committed served sidecars,
 *      alongside each one's sealed `contractDigest`. Read from apps/web/public/
 *      install/**, not re-derived, so this measures the bytes users actually get.
 *   3. NO-PROSE — the gate on the omission set: zero whitespace-bearing string
 *      leaves may survive into the semantic preimage. Add a prose field to the
 *      contract and this fails until somebody classifies it, which is what keeps
 *      the omission set from rotting quietly.
 *   4. IMPORT BOUNDARY — no packages/*\/src/** file imports apps/web/content|styles
 *      (ADR 0058 §2). Added BEFORE those directories exist, because the cheapest
 *      time to forbid something is before anyone has written the line.
 *
 * WHAT THIS DOES NOT DO. new15 §2.5 says install plans SHOULD bind
 * `semanticContractDigest`. Re-pointing that binding would move
 * `expectedContractDigest` in every sealed plan — a behavior change, and P-1 is
 * declared "changes behavior: no". So this RECORDS the digest and proves its
 * stability; re-pointing the binding is a P-7 decision needing an ADR amendment.
 *
 * Modes (same contract as `pnpm audit:presentation`):
 *   (default) --check : the committed artifact must be byte-identical to a fresh run.
 *   --write           : (re)generate it.
 *   --gate            : ENFORCEMENT. Exit 2 unless every measured invariant holds.
 *
 * Exit codes: 0 ok · 1 drift (--check) · 2 gate failed (--gate) / unexpected error.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import {
  EMPTY_PRESENTATION_CONTENT,
  LEVEL_BY_SECTION,
  PRESENTATION_CONTENT_VERSION,
  PRIMARY_CTA,
  SEMANTIC_PREIMAGE_OMISSIONS,
  emptyPresentationDigest,
  presentationDigest,
  semanticContractDigest,
  validatePresentationContent,
  type PresentationContentV1,
} from "../packages/trust-index/src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outPath = path.join(repoRoot, "artifacts", "phase-2.4", "presentation-lock.json")

/** Where PR P-2 will put the content plane. Absent at P-1 — asserted, not assumed. */
const CONTENT_ROOT = "apps/web/content/safe-install"
/** The merged-document filename P-2 writes; the lock reads it once it exists. */
const CONTENT_DOC = `${CONTENT_ROOT}/presentation.v1.json`

/** Source trees that may never import the config plane (ADR 0058 §2). */
const IMPORT_BOUNDARY_ROOTS = ["packages"] as const
const FORBIDDEN_IMPORTS = ["apps/web/content", "apps/web/styles"] as const

/** Every committed served contract sidecar, in stable path order. */
function servedContracts(): { slug: string; contract: unknown }[] {
  const root = path.join(repoRoot, "apps", "web", "public", "install")
  if (!fs.existsSync(root)) return []
  const out: { slug: string; contract: unknown }[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === "index.json") {
        const slug = path.relative(root, path.dirname(p)).split(path.sep).join("/")
        out.push({ slug, contract: JSON.parse(fs.readFileSync(p, "utf8")) })
      }
    }
  }
  walk(root)
  return out
}

/** Scan for a forbidden import of the config plane. Returns offending files. */
function importBoundaryViolations(): string[] {
  const hits: string[] = []
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.(ts|tsx|mts|cts|js|mjs)$/.test(e.name)) continue
      const src = fs.readFileSync(p, "utf8")
      // Only real module specifiers count — a path inside a comment or a string
      // literal (this script's own constants, for instance) is not an import.
      for (const m of src.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = m[1] ?? ""
        if (FORBIDDEN_IMPORTS.some((f) => spec.includes(f))) {
          hits.push(`${path.relative(repoRoot, p).split(path.sep).join("/")} → ${spec}`)
        }
      }
    }
  }
  for (const root of IMPORT_BOUNDARY_ROOTS) walk(path.join(repoRoot, root))
  return hits
}

/** Build the artifact. No clock, no RNG — byte-stable across runs. */
function build(): { json: string; pass: boolean; failures: readonly string[] } {
  const failures: string[] = []

  // 1 — the content plane. Present ⇒ validate and digest it; absent ⇒ the honest
  // digest of the canonical empty document, which resolves to code defaults.
  const docPath = path.join(repoRoot, CONTENT_DOC)
  const docPresent = fs.existsSync(docPath)
  let doc: PresentationContentV1 = EMPTY_PRESENTATION_CONTENT
  let validationErrors: readonly { path: string; rule: string; message: string }[] = []
  if (docPresent) {
    const parsed = JSON.parse(fs.readFileSync(docPath, "utf8")) as PresentationContentV1
    const facts = JSON.parse(fs.readFileSync(path.join(repoRoot, "project-facts.json"), "utf8")) as {
      forbiddenPhrases: string[]
      trustPageForbiddenPhrases: string[]
    }
    validationErrors = validatePresentationContent(parsed, {
      verdictLabels: VERDICT_PUBLIC_LABEL,
      stateCtas: PRIMARY_CTA,
      forbiddenPhrases: [...facts.forbiddenPhrases, ...facts.trustPageForbiddenPhrases],
    })
    if (validationErrors.length > 0) {
      for (const e of validationErrors) failures.push(`${CONTENT_DOC}${e.path}: [${e.rule}] ${e.message}`)
    } else {
      doc = parsed
    }
  }
  const digests = docPresent && validationErrors.length === 0 ? presentationDigest(doc) : emptyPresentationDigest()

  // 2/3 — the semantic digest for every served sidecar, plus the no-prose gate.
  const served = servedContracts()
  const resources = served.map(({ slug, contract }) => {
    const r = semanticContractDigest(contract)
    if (r.proseLeaves.length > 0) {
      failures.push(
        `${slug}: ${r.proseLeaves.length} unclassified prose leaf/leaves survive into the semantic preimage ` +
          `(${r.proseLeaves.map((l) => l.path).join(", ")}) — classify each in SEMANTIC_PREIMAGE_OMISSIONS or keep it bound`,
      )
    }
    if (r.contractDigest === null) failures.push(`${slug}: served sidecar carries no contract.contractDigest`)
    return {
      canonicalSlug: slug,
      contractDigest: r.contractDigest,
      semanticContractDigest: r.semanticContractDigest,
      omissionsApplied: r.omissionsApplied,
      omissionsNotPresent: r.omissionsNotPresent,
      proseLeaves: r.proseLeaves.map((l) => l.path),
    }
  })
  if (resources.length === 0) {
    failures.push("no served install sidecars found — the lock would measure nothing")
  }
  // A semantic digest that collided across DIFFERENT sealed contracts would mean the
  // omission set had deleted something load-bearing. Distinctness is the check.
  const distinctSemantic = new Set(resources.map((r) => r.semanticContractDigest)).size
  const distinctContract = new Set(resources.map((r) => r.contractDigest)).size
  if (resources.length > 0 && distinctSemantic < distinctContract) {
    failures.push(
      `semantic digests collapsed: ${distinctContract} distinct contractDigest → ${distinctSemantic} distinct ` +
        `semanticContractDigest, so an omission removed load-bearing semantics`,
    )
  }

  // 4 — the import boundary (ADR 0058 §2).
  const violations = importBoundaryViolations()
  for (const v of violations) {
    failures.push(`forbidden config-plane import: ${v} — presentation config is a PARAMETER, not an import (ADR 0058 §2)`)
  }

  const report = {
    schema: "calllint.presentation-lock.v0",
    $comment:
      "Workstream P PR P-1 digest seams (ADR 0058 §5; new15 §7). RECORDS presentationDigest + semanticContractDigest; it does NOT re-point what install plans bind — plans still bind contractDigest, and moving that binding is a P-7 decision requiring an ADR amendment (doing it here would smuggle a behavior change into a batch declared as having none). `semanticContractDigest` is defined by DELETION from the sealed contract, so a new contract field is bound by default and omission is the reviewable exception. The gate is noProseLeaves: machine tokens carry no whitespace, prose always does, so an empty result proves no copy is bound — for any input, not just those measured. Regenerate with `pnpm audit:presentation:lock:write`; enforce with `pnpm audit:presentation:lock:gate`.",
    workstream: "P",
    pr: "P-1",
    status: failures.length === 0 ? "PASSED" : "FAILED",
    contentPlane: {
      root: CONTENT_ROOT,
      document: CONTENT_DOC,
      state: docPresent ? "present" : "absent",
      $comment:
        "absent at P-1: apps/web/content/** is greenfield, so the recorded digest is that of the canonical EMPTY document (schema+locale only), which resolves every slot to the shipped code default. This is the restorable predecessor INV-P3 needs, not a placeholder.",
      schemaTag: PRESENTATION_CONTENT_VERSION,
      locale: doc.locale,
      levelBySection: LEVEL_BY_SECTION,
      validationErrors,
      ...digests,
    },
    semanticContract: {
      $comment:
        "Read from the COMMITTED served sidecars (apps/web/public/install/**), so these are the bytes users actually receive — not a re-derivation that could agree with itself while disagreeing with production.",
      omissions: SEMANTIC_PREIMAGE_OMISSIONS,
      resourcesMeasured: resources.length,
      distinctContractDigests: distinctContract,
      distinctSemanticContractDigests: distinctSemantic,
      noProseLeaves: resources.every((r) => r.proseLeaves.length === 0),
      bindingUnchanged: true,
      resources,
    },
    importBoundary: {
      $comment:
        "ADR 0058 §2: nothing under packages/*/src/** may import the config plane, so configuration can only be reached by whoever was handed it. Enforced from P-1, before the directories exist.",
      rootsScanned: IMPORT_BOUNDARY_ROOTS,
      forbiddenSpecifiers: FORBIDDEN_IMPORTS,
      violations,
    },
    failures,
  }
  return { json: JSON.stringify(report, null, 2) + "\n", pass: failures.length === 0, failures }
}

// --- modes -------------------------------------------------------------------

const argv = process.argv.slice(2)
const { json, pass, failures } = build()
const rel = path.relative(repoRoot, outPath).split(path.sep).join("/")

if (argv.includes("--write")) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, json, "utf8")
  console.log(`wrote ${rel} — ${pass ? "PASSED" : "FAILED"}`)
  process.exit(0)
}

if (argv.includes("--gate")) {
  if (pass) {
    console.log("presentation lock: PASSED — digest seams recorded, no prose bound, import boundary clean.")
    process.exit(0)
  }
  console.error("presentation lock: FAILED")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(2)
}

// default --check: committed artifact must match a fresh run.
if (!fs.existsSync(outPath)) {
  console.error(`${rel} is missing — run \`pnpm audit:presentation:lock:write\`.`)
  process.exit(1)
}
if (fs.readFileSync(outPath, "utf8") !== json) {
  console.error(`${rel} drifted from a fresh run — run \`pnpm audit:presentation:lock:write\` and review the diff.`)
  process.exit(1)
}
console.log(`${rel} matches a fresh run — ${pass ? "PASSED" : "FAILED"}`)
process.exit(0)
