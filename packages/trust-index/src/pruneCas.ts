/**
 * prune:cas — bound CAS growth on the worker by deleting blobs past the retention window.
 *
 * ADR 0061 §8.4 named the gap this closes: the CAS is write-once and nothing ever removed a stored
 * blob, so "CAS growth is therefore monotonic and unbounded … A retention policy must ship with
 * R-9's deployment." This bin is R-9's half of that pair, and the systemd unit runs it as the third
 * ExecStart after the mirror and the projection.
 *
 * IT MATTERS ONLY ON THE WORKER, and that asymmetry is measured rather than assumed. `.var/` is
 * gitignored and never cached between jobs, so a GitHub Actions runner starts every scheduled
 * ingest with an empty CAS and ends it with one run's worth of blobs. The worker's `.var/` persists,
 * so it is the only place where run N+1 inherits run N's bytes.
 *
 * WHY THIS LIVES IN `trust-index` AND NOT IN `adoption-index`, where the CAS itself does. A sweep
 * has to know what "now" is, and `adoption-index` forbids exactly that: INV-R6 / control #11
 * (`source-mirror.test.ts:849`) fails any file under its `src/` that calls argless `new Date()`, and
 * pins the set of files allowed to name `new Date(` AT ALL to a single entry. Putting the sweep there
 * would have meant widening a clock invariant to admit an operational script — the invariant is
 * right and the placement was wrong. `adoption-index` stays a pure library whose every timestamp is
 * injected; the clock enters here, in the service package that already owns the worker's other two
 * steps (`refreshSnapshot.ts`, `projectAdoptionIndex.ts`). The layout itself is still not duplicated:
 * `casBlobsRoot` is imported from `adoption-index`, which remains the one owner of it (INV-R7).
 *
 * THE ROOT COMES FROM `resolveIndexPaths`, not from a path joined here. INV-R7 gives the layout one
 * owner; a bin that joined `.var/calllint-adoption-index` itself would be a second definition, and
 * `resolveIndexPaths`' own docblock already names this unit as the caller that would point it at a
 * service data dir.
 *
 * A MISSING TREE IS NOT AN EMPTY TREE. `pruneOldBlobs` throws when `cas/blobs` is absent, and this
 * bin lets that throw reach the exit code instead of reporting a clean zero — a misconfigured
 * `ADOPTION_INDEX_CWD` must fail loudly rather than log "0 deleted" every night forever.
 *
 * Usage:  pnpm prune:cas
 *   env:  CAS_RETENTION_DAYS  (positive integer, default 90)
 *         ADOPTION_INDEX_CWD  (directory holding `.var/`, default `process.cwd()`)
 */

import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveIndexPaths } from "@calllint/adoption-index"
import { pruneOldBlobs, resolveRetentionDays } from "./casRetention.js"

function main(): void {
  const retentionDays = resolveRetentionDays(process.env)
  const cwd = (process.env.ADOPTION_INDEX_CWD ?? "").trim() || process.cwd()
  const { root } = resolveIndexPaths(cwd)
  const now = new Date().toISOString()

  const result = pruneOldBlobs({ root, retentionDays, now })
  const cutoff = new Date(new Date(now).getTime() - retentionDays * 86400 * 1000).toISOString()

  console.log(`prune:cas — retention ${retentionDays}d, cutoff ${cutoff}`)
  console.log(`  root      ${root}`)
  console.log(`  inspected ${result.inspected}`)
  console.log(`  deleted   ${result.deleted}`)
  console.log(`  failed    ${result.failed}`)

  // A delete that failed is a policy that did not fully apply. Report it in the exit code so the
  // systemd unit records a failure instead of a silent partial sweep.
  if (result.failed > 0) process.exitCode = 1
}

// Run ONLY when executed as a script, never on import — the same guard `refreshSnapshot.ts:403`
// carries, for the same measured reason: `main()` DELETES files under `.var/`, so an unguarded
// module body would sweep a developer's real CAS the moment anything imported this file.
//
const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedAsScript) {
  try {
    main()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}
