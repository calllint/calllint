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
import { parseAdoptionIndex, type AdoptionIndexSnapshot } from "./adoptionIndexSnapshot.js"
import {
  resolvePresentation,
  DEFAULT_PRESENTATION,
  type ResolvedPresentation,
} from "./safe-install/resolvePresentation.js"

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
 * The committed adoption index — the IDENTITY projection of the canonical adoption graph
 * (ADR 0061 §7.1). Lives under the package (an ingestion INPUT, not a served artifact).
 * `projectAdoptionIndex.ts` writes it from the compiler's store; the bake reads it PURELY, so a
 * Trust page request never causes a database read (§5).
 *
 * Absent ⇒ no identity on any index entry ⇒ byte-identical pages, so this is inert until it
 * exists — the same fail-inert shape `EVIDENCE_SNAPSHOT_PATH` has. Unlike that one it is
 * DERIVABLE offline from the committed registry snapshot, which is what lets the reproducibility
 * gate re-derive and byte-compare rather than merely validate the schema (control #117).
 */
export const ADOPTION_INDEX_PATH = resolve(here, "..", "snapshots", "adoption-index.json")

/** Load + validate the committed adoption index if present; null when there is none. */
export function loadAdoptionIndexIfPresent(path = ADOPTION_INDEX_PATH): AdoptionIndexSnapshot | null {
  if (!existsSync(path)) return null
  return parseAdoptionIndex(readFileSync(path, "utf8"))
}

/**
 * The presentation content document (Workstream P PR P-2; ADR 0058 §2).
 *
 * Built from path SEGMENTS on purpose. The lock's import-boundary check greps every
 * `packages/**` source for an import-shaped line naming the config plane, and §2's rule
 * is that configuration is a PARAMETER, never an import — so the plane is named here as
 * data, in the ONE place already licensed to touch the filesystem, and the resolved copy
 * travels inward as an argument. Nothing under `packages/*` can reach it on its own.
 *
 * Path: repo-root/apps/web/content/safe-install/presentation.v1.json (four levels up
 * from packages/trust-index/src, same as DEFAULT_OUT below).
 */
export const PRESENTATION_DOC_PATH = resolve(
  here,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "content",
  "safe-install",
  "presentation.v1.json",
)

/**
 * Load + resolve the presentation document if present. FAILS OPEN, per ADR 0058 §5
 * INV-P3: an absent file, unreadable bytes, or unparseable JSON all resolve to the
 * shipped code defaults, so the bake still emits a complete page rather than a blank
 * button. A malformed document is a LOUD failure elsewhere — `validatePresentationContent`
 * runs in `audit:presentation:lock:gate` and fails CI with a precise message — so the
 * silence here is the last-resort floor, not the only check.
 */
export function loadPresentationIfPresent(path = PRESENTATION_DOC_PATH): ResolvedPresentation {
  if (!existsSync(path)) return DEFAULT_PRESENTATION
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return DEFAULT_PRESENTATION
  }
  return resolvePresentation(parsed)
}

/**
 * Committed output root: apps/web/public/trust (repo-root/apps/web/public/trust).
 * From packages/trust-index/src that is four levels up. This is the directory
 * `deploy-web.yml` deploys, so the committed pages are the served pages.
 */
export const DEFAULT_OUT = resolve(here, "..", "..", "..", "apps", "web", "public", "trust")

/**
 * The committed engine version — a deterministic bake input (INV-2.4-10: same snapshot +
 * engine + … ⇒ byte-identical Safe-install contracts). Read from the trust-index
 * package.json so every bin and the reproducibility gate share ONE source and can never
 * disagree about the version stamped into each contract. Only the install contract bytes
 * depend on it; the trust tree is version-independent.
 */
export function engineVersion(pkgPath = resolve(here, "..", "package.json")): string {
  return JSON.parse(readFileSync(pkgPath, "utf8")).version as string
}

/**
 * Write the emitted trees to disk (the ONLY filesystem side effect of a bake). `files`
 * are the TRUST tree (→ `outDir`, e.g. apps/web/public/trust); `installFiles` are the
 * Safe-install acquisition surface rooted at the SITE root (→ `publicRoot`, one level up:
 * `install/**` + `.well-known/calllint.json`, ADR 0056). Each CallLint-owned subtree is
 * cleaned before writing so a removed resource leaves no stale page (idempotent tree =
 * reproducible tree). `.well-known/` is NOT wholesale-cleaned — a foreign `security.txt`
 * lives there — but `calllint.json` is always re-emitted, so it can never go stale.
 */
export function writeServedTree(
  outDir: string,
  publicRoot: string,
  files: readonly { path: string; content: string }[],
  installFiles: readonly { path: string; content: string }[],
): void {
  rmSync(outDir, { recursive: true, force: true })
  for (const f of files) {
    const abs = join(outDir, f.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.content, "utf8")
  }
  // CallLint owns the entire /install tree — clean it so a de-listed resource's page is
  // removed. The discovery manifest overwrites in place (no dir clean → security.txt safe).
  rmSync(join(publicRoot, "install"), { recursive: true, force: true })
  for (const f of installFiles) {
    const abs = join(publicRoot, f.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.content, "utf8")
  }
}

function main(): void {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT
  // The site root is the trust tree's parent (apps/web/public): where /install/** and
  // /.well-known/calllint.json are served from. Derived from outDir so a custom outDir
  // keeps the same relationship.
  const publicRoot = resolve(outDir, "..")
  const snapshot = loadSnapshotIfPresent()
  const claims = loadClaimStoreIfPresent()
  const evidence = loadEvidenceSnapshotIfPresent()
  const presentation = loadPresentationIfPresent()
  const adoption = loadAdoptionIndexIfPresent()
  const { files, installFiles, baked, incomplete } = emitAllCohorts(
    snapshot,
    claims,
    evidence,
    [],
    engineVersion(),
    presentation,
    adoption,
    // The freshness clock (S-2). Same env pin every other bin in this package already honors
    // (`refreshSnapshot.ts`, `projectAdoptionIndex.ts`, `resolveEvidence.ts`), so a scheduled
    // ingestion or a replay can pin it and get byte-identical output. It is echoed into
    // `index.json` as `bakedAt`, which is what keeps the committed-tree gate able to reproduce
    // this bake — see the comment on that field in `emitCohort.ts`.
    process.env.TRUST_INGEST_NOW || new Date().toISOString(),
  )

  writeServedTree(outDir, publicRoot, files, installFiles)

  // eslint-disable-next-line no-console
  console.log(
    `baked ${baked} page(s), ${incomplete} incomplete, ${files.length} trust file(s) + ` +
      `${installFiles.length} install file(s) → ${outDir} (+ ${publicRoot})`,
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
