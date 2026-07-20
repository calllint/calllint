/**
 * `bake.ts` — the ingestion entry point (I1a): bake the fixtures cohort and write
 * the committed artifacts under `apps/web/public/trust/`.
 *
 * This is the ONLY place in the package that touches the filesystem. It runs in the
 * ingestion plane (a script / scheduled Actions job — ADR 0046 §3), never in
 * serving. Run it, commit the result; CI re-runs the emit purely and diffs against
 * the committed bytes (the reproducibility gate — ADR 0046 §4).
 *
 * The output root is the *served* directory: `deploy-web.yml` ships
 * `apps/web/public/` to Cloudflare Pages, so these committed pages are served
 * same-origin at `calllint.com/trust/…` (ADR 0046 §4 decision 4). The committed
 * tree IS the store (§2) — there is no second copy and no scan at serve time.
 *
 * Usage:  tsx packages/trust-index/src/bake.ts [outDir]
 *   default outDir = apps/web/public/trust
 */
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
// no-op marker: main() is guarded below so importing this module never bakes to disk.
import { emitAllCohorts } from "./emitCohort.js"
import { parseSnapshot, type RegistrySnapshot } from "./snapshot.js"
import { parseClaimStore, EMPTY_CLAIM_STORE, type ClaimStore } from "./claim.js"
import { parseEvidenceSnapshot, type EvidenceSnapshot } from "./evidenceSnapshot.js"

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The committed Official MCP Registry snapshot (ADR 0038 §1 retained raw input).
 * Lives under the package (an ingestion INPUT, not a served artifact). The scheduled
 * workflow refreshes it; the bake reads it. Absent ⇒ fixtures-only bake.
 */
export const SNAPSHOT_PATH = resolve(here, "..", "snapshots", "official-mcp-registry.json")

/** Load + validate the committed snapshot if present; null when there is none. */
export function loadSnapshotIfPresent(path = SNAPSHOT_PATH): RegistrySnapshot | null {
  if (!existsSync(path)) return null
  return parseSnapshot(readFileSync(path, "utf8"))
}

/**
 * The committed maintainer-claim store (ADR 0048 §2 Git store). Lives under the
 * package (an ingestion INPUT, not a served artifact). The Actions verify job (I2c-4)
 * commits records here; the bake reads them. Absent ⇒ the empty store ⇒ no flags.
 */
export const CLAIM_STORE_PATH = resolve(here, "..", "claims", "claim-store.json")

/** Load + validate the committed claim store if present; empty when there is none. */
export function loadClaimStoreIfPresent(path = CLAIM_STORE_PATH): ClaimStore {
  if (!existsSync(path)) return EMPTY_CLAIM_STORE
  return parseClaimStore(readFileSync(path, "utf8"))
}

/**
 * The committed evidence snapshot (ADR 0050 §4 retained resolution result). Lives
 * under the package (an ingestion INPUT). The scheduled workflow's resolve step
 * writes it; the bake reads it PURELY to refine remote verdicts. Absent ⇒ no
 * refinement ⇒ byte-identical unrefined pages (so this is inert until it exists).
 */
export const EVIDENCE_SNAPSHOT_PATH = resolve(here, "..", "snapshots", "evidence-snapshot.json")

/** Load + validate the committed evidence snapshot if present; null when there is none. */
export function loadEvidenceSnapshotIfPresent(path = EVIDENCE_SNAPSHOT_PATH): EvidenceSnapshot | null {
  if (!existsSync(path)) return null
  return parseEvidenceSnapshot(readFileSync(path, "utf8"))
}
/**
 * Committed output root: apps/web/public/trust (repo-root/apps/web/public/trust).
 * From packages/trust-index/src that is four levels up. This is the directory
 * `deploy-web.yml` deploys, so the committed pages are the served pages.
 */
export const DEFAULT_OUT = resolve(here, "..", "..", "..", "apps", "web", "public", "trust")

function main(): void {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT
  const snapshot = loadSnapshotIfPresent()
  const claims = loadClaimStoreIfPresent()
  const evidence = loadEvidenceSnapshotIfPresent()
  const { files, baked, incomplete } = emitAllCohorts(snapshot, claims, evidence)

  // Clean the output dir first so a removed cohort entry does not leave a stale
  // page behind (idempotent tree = reproducible tree).
  rmSync(outDir, { recursive: true, force: true })

  for (const f of files) {
    const abs = join(outDir, f.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.content, "utf8")
  }

  // eslint-disable-next-line no-console
  console.log(
    `baked ${baked} page(s), ${incomplete} incomplete, ${files.length} file(s) → ${outDir}`,
  )
}

// Run ONLY when executed as a script (tsx src/bake.ts), never on import — other
// modules import bake.ts for its path constants + loaders, and importing must have
// no side effect (previously main() ran on every import, baking to disk).
const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedAsScript) main()
