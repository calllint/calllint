/**
 * `bakeInstall.ts` — the Safe-install SHADOW ingestion entry point (Phase 2.4
 * Batch 2). Bakes the acquisition surface and writes it under
 * `artifacts/phase-2.4/shadow-install-pages/` — NOT into `apps/web/public`.
 *
 * This is shadow output by design (ADR 0056; new14-integration §6): Batch 2 proves
 * the renderer + manifest + digest-consistency in an isolated tree the committed
 * reproducibility gate covers, without touching the served Trust tree, the sitemap,
 * or `index.json`. Batch 3 promotes these bytes into `/install/**`.
 *
 * Like `bake.ts`, this is the ONLY place here that touches the filesystem, runs in
 * the ingestion plane, reads the SAME committed inputs, and is guarded so importing
 * the module never writes to disk. Run it, commit the result; CI re-runs the emit
 * purely and diffs against the committed bytes.
 *
 * Usage:  tsx packages/trust-index/src/bakeInstall.ts [outDir]
 */
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { emitSafeInstall } from "./emitSafeInstall.js"
import { loadSnapshotIfPresent, loadEvidenceSnapshotIfPresent } from "./bake.js"

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The committed engine version — a deterministic bake input (INV-2.4-10: same
 * snapshot + engine + … ⇒ byte-identical assets). Read from the trust-index
 * package.json so the bin and the shadow-tree reproducibility test share ONE
 * source and can never disagree about the version stamped into every contract.
 */
export function engineVersion(pkgPath = resolve(here, "..", "package.json")): string {
  return JSON.parse(readFileSync(pkgPath, "utf8")).version as string
}

/**
 * Committed shadow output root: artifacts/phase-2.4/shadow-install-pages
 * (repo-root/artifacts/…). From packages/trust-index/src that is three levels up.
 */
export const SHADOW_INSTALL_OUT = resolve(
  here,
  "..",
  "..",
  "..",
  "artifacts",
  "phase-2.4",
  "shadow-install-pages",
)

function main(): void {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : SHADOW_INSTALL_OUT
  const snapshot = loadSnapshotIfPresent()
  const evidence = loadEvidenceSnapshotIfPresent()
  const files = emitSafeInstall(snapshot, evidence, engineVersion())

  // Clean first so a removed resource does not leave a stale shadow page behind.
  rmSync(outDir, { recursive: true, force: true })
  for (const f of files) {
    const abs = join(outDir, f.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.content, "utf8")
  }

  // eslint-disable-next-line no-console
  console.log(`baked safe-install shadow: ${files.length} file(s) → ${outDir}`)
}

const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedAsScript) main()
