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
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { emitFixtureCohort } from "./emitCohort.js"

const here = dirname(fileURLToPath(import.meta.url))
/**
 * Committed output root: apps/web/public/trust (repo-root/apps/web/public/trust).
 * From packages/trust-index/src that is four levels up. This is the directory
 * `deploy-web.yml` deploys, so the committed pages are the served pages.
 */
export const DEFAULT_OUT = resolve(here, "..", "..", "..", "apps", "web", "public", "trust")

function main(): void {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT
  const { files, baked, incomplete } = emitFixtureCohort()

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

main()
