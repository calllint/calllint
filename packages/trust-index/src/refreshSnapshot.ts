/**
 * refreshSnapshot — the scheduled-workflow entry point (ADR 0038 §3: ingestion is
 * the sole scanner, structurally decoupled from serving). It is the ONE place that
 * touches the network and then writes:
 *
 *   1. fetch the Official MCP Registry → build a PII-free snapshot (impure edge)
 *   2. write the retained snapshot to SNAPSHOT_PATH (ADR 0038 §1 raw-input retention)
 *   3. re-bake ALL cohorts from the committed tree into apps/web/public/trust
 *
 * The workflow then opens a PR with the diff; a human merges → CF Pages deploys. CI
 * on that PR re-bakes from the committed snapshot PURELY and diffs — so the network
 * result is frozen into a reviewable artifact, never trusted live at serve time.
 *
 * Usage:  tsx packages/trust-index/src/refreshSnapshot.ts
 *   env:  TRUST_INGEST_NOW (ISO-8601, optional) pins fetchedAt for a reproducible run
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fetchRegistrySnapshot, DEFAULT_MAX_ENTRIES } from "./fetchRegistry.js"
import { parseSnapshot } from "./snapshot.js"
import { emitAllCohorts } from "./emitCohort.js"
import { SNAPSHOT_PATH, DEFAULT_OUT } from "./bake.js"

/**
 * Resolve the ingestion cap (ADR 0038 §6). Defaults to DEFAULT_MAX_ENTRIES; an
 * operator raises it for a scale-out run via TRUST_INGEST_MAX_ENTRIES (workflow_dispatch
 * input). Fails SAFE: a missing, non-numeric, zero, or negative value falls back to the
 * default rather than fetching an unbounded / empty cohort. This is the ONLY knob for
 * 37 → 100+; it takes effect on the next real ingest run and touches no committed bytes.
 */
export function resolveMaxEntries(env: Record<string, string | undefined>): number {
  const raw = env.TRUST_INGEST_MAX_ENTRIES
  if (raw == null || raw.trim() === "") return DEFAULT_MAX_ENTRIES
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_MAX_ENTRIES
  return n
}

async function main(): Promise<void> {
  const now = process.env.TRUST_INGEST_NOW || new Date().toISOString()
  const maxEntries = resolveMaxEntries(process.env)

  // 1. Fetch + normalize (the only network step).
  const snapshot = await fetchRegistrySnapshot({ now, maxEntries })

  // 2. Retain the raw snapshot. Re-parse the serialized bytes so what we bake from
  //    is exactly what we commit (no in-memory drift from the on-disk artifact).
  const snapshotText = JSON.stringify(snapshot, null, 2) + "\n"
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, snapshotText, "utf8")
  const committed = parseSnapshot(snapshotText)

  // 3. Re-bake all cohorts into the served tree (clean first → no stale pages).
  const { files, baked, incomplete } = emitAllCohorts(committed)
  rmSync(DEFAULT_OUT, { recursive: true, force: true })
  for (const f of files) {
    const abs = join(DEFAULT_OUT, f.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.content, "utf8")
  }

  // eslint-disable-next-line no-console
  console.log(
    `snapshot: ${committed.count} entry(ies) @ ${committed.fetchedAt}; ` +
      `baked ${baked} page(s), ${incomplete} incomplete, ${files.length} file(s)`,
  )
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
