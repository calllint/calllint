/**
 * refreshSnapshot — the scheduled-workflow entry point (ADR 0038 §3: ingestion is
 * the sole scanner, structurally decoupled from serving). It is the ONE place that
 * touches the network and then writes:
 *
 *   1. mirror the Official MCP Registry into the adoption index (impure edge)
 *   2. PROJECT the PII-free snapshot from the mirror and write it to SNAPSHOT_PATH
 *      (ADR 0038 §1 raw-input retention)
 *   3. MEASURE and REPORT whether the served tree needs rebuilding (§16.1/§16.2, R-2)
 *
 * It does NOT bake. That is the change R-2 made, and the reason is measured — see the
 * inverted claim below.
 *
 * The workflow then opens a PR with the diff; a human merges → CF Pages deploys. CI
 * on that PR re-bakes from the committed snapshot PURELY and diffs — so the network
 * result is frozen into a reviewable artifact, never trusted live at serve time.
 *
 * INVERTED, R-2 (do not restore). Until this batch step 3 called `emitAllCohorts` +
 * `writeServedTree` here, and its comment claimed the emitted trust and Safe-install trees
 * were "byte-identical" to `bake.ts`'s. MEASURED, they are not: 94 of the 158 committed
 * served files differ, over the SAME file set. `bake.ts:165-184` passes
 * `loadClaimStoreIfPresent()` and `loadEvidenceSnapshotIfPresent()`; this bin passed
 * `undefined, undefined, []`, so its tree was claims- and evidence-STRIPPED. The original
 * claim was true only of the two arguments it was written about — `engineVersion()` and the
 * presentation document, whose own comments at `emitCohort.ts:226-236` say they flow ONLY
 * into `installFiles` — and false of everything else.
 *
 * It never shipped a wrong page for one reason, and it is an accident of ORDERING rather
 * than a safeguard: `.github/workflows/trust-ingest.yml` runs `ingest:trust-index`,
 * then `resolve-evidence:trust-index`, then `bake:trust-index`, and `writeServedTree`
 * `rmSync`s both roots before writing — so the stripped bytes were deleted and rewritten
 * by the correct bin seconds later, inside the same job. The two committed-tree gates
 * (`test/committed-tree.test.ts:49`, `test/safe-install/committed-install-tree.test.ts:51`)
 * compare on-disk bytes against the BAKE shape, which is why the stripped shape could never
 * reach a merge.
 *
 * DELETED rather than made conditional. R-2's mandate is "replace the unconditional full
 * re-bake", and a bake of the wrong shape stays the wrong shape when it runs less often.
 * Gating it behind the change detector would have made the defect RARER, which is strictly
 * worse: a bake that emits a stripped tree on every run is found the first time anyone
 * looks, while one that does it on the runs where upstream happened to move is not.
 *
 * WHY THE MIRROR SITS IN FRONT OF THE SNAPSHOT (R-1, ADR 0061). Until this batch the
 * snapshot WAS the record of upstream, so everything the emitter dropped at ingestion —
 * deprecated servers, superseded versions, anything past the cap — was unrecoverable, and
 * the cap kept the alphabetically-first entries rather than a considered cohort. Step 1 now
 * mirrors the FULL cursor-paginated source into `source_records` and the snapshot becomes a
 * projection of it. R-0's own capability matrix names this reduction
 * (`artifacts/adoption-index-v1/current-capability-matrix.json:231` — "refreshSnapshot.ts —
 * reduce to an orchestrator over job primitives"), so the file keeps the same three steps
 * and delegates the first.
 *
 * The projection is byte-identical to what `fetchRegistrySnapshot` produced for the same
 * upstream — asserted over the shipped emitter's own output in
 * `packages/adoption-index/test/snapshot-projection.test.ts`, not claimed here. That
 * matters because these bytes feed the reproducibility gate.
 *
 * `@calllint/adoption-index` is private and carries a NATIVE driver, so this import is only
 * safe because nothing publishable reaches this module: `refreshSnapshot` is imported by no
 * source file in the repo (the one test importing this module takes `resolveMaxEntries`
 * alone), and the boundary scan asserts it rather than trusting it.
 *
 * ARTIFACT RESOLUTION (R-4) is step 1b, and it is DEFAULT ON. Safe to default on because it
 * writes only under `.var/calllint-adoption-index/` — gitignored, never cached — so a scheduled
 * run's PR DIFF IS UNCHANGED by it. What it adds to a run is public HTTP GETs whose bytes are
 * hashed, statically inspected, and stored; never executed, extracted, or installed (ADR 0061 §2).
 * `TRUST_INGEST_ARTIFACTS=0` disables it, following the `resolveMaxEntries` fail-safe precedent.
 *
 * EVIDENCE COMPILATION (R-5) is step 1c, added by S-1, and it is DEFAULT ON for a STRICTLY
 * STRONGER reason than R-4's: it touches no network at all. `CompileEvidenceInput` has no
 * `fetchImpl` field, so offline is a property of the TYPE rather than a promise in a comment
 * (`compileEvidence.ts:15-19`); it reads bytes R-4 already put in the CAS and writes only
 * `evidence_records`, under the same gitignored `.var/`. So this clause adds neither a public
 * request nor a committed byte. `TRUST_INGEST_EVIDENCE=0` disables it, same one-spelling rule.
 *
 * R-5 SHIPPED THIS PORT WITH NO PRODUCTION CONSUMER, and it said so itself:
 * `compileEvidence.ts:33-39` names the shape it was avoiding — "the A-08 'shipped-not-wired'
 * grading" — and then stopped on it. Measured at HEAD `994a2b6`, every reference to
 * `evidencePort` in the repo was inside `refresh-artifacts-e2e.test.ts`, whose helper defaults
 * `withEvidencePort ?? false`. This module is where that ends; the repo's own rhythm is
 * write-then-consume (R-7 wrote `adoption_records`, R-8 consumed them).
 *
 * DO NOT CONFUSE THIS WITH THE `resolve-evidence` WORKFLOW STEP. They are different things
 * that share a word. `resolveEvidence.ts` (ADR 0050) resolves REMOTE IDENTITY over the network
 * and writes the committed `evidence-snapshot.json` that `bake.ts` reads; R-5's
 * `compileEvidence` reads already-fetched artifact bytes out of the CAS and writes
 * `evidence_records` rows that reach no served byte. Nothing here duplicates that step, which
 * is why `trust-ingest.yml` needs no new step: this compilation happens INSIDE
 * `refreshFromMirror`, i.e. inside the existing `ingest:trust-index`.
 *
 * Usage:  tsx packages/trust-index/src/refreshSnapshot.ts
 *   env:  TRUST_INGEST_NOW (ISO-8601, optional) pins fetchedAt for a reproducible run
 *         TRUST_INGEST_MIRROR_MAX_ENTRIES (optional) raises the raw-read ceiling
 *         TRUST_INGEST_MIRROR_MAX_PAGES (optional) raises the page-count ceiling
 *         TRUST_INGEST_ARTIFACTS (optional) `0` skips artifact resolution entirely
 *         TRUST_INGEST_EVIDENCE (optional) `0` skips evidence compilation entirely
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  compileEvidence,
  createAdapterRegistry,
  createOfficialRegistryAdapter,
  describeArtifactResolution,
  describeEvidenceCompilation,
  npmArtifactAdapter,
  openBetterSqlite3,
  refreshFromMirror,
  resolveArtifacts,
  resolveIndexPaths,
  describeSourceChange,
  DEFAULT_MIRROR_MAX_ENTRIES,
  DEFAULT_MAX_PAGES,
  MIGRATIONS_DIRNAME,
} from "@calllint/adoption-index"
import { hashJson } from "@calllint/fingerprint"
// A POLICY NAME, in the INGESTION plane. Not a decision: `hashJson(policy)` is a FINGERPRINT,
// and the digest it produces is a grouping key on an `evidence_records` row — "which policy was
// this row graded under" — never an input to a verdict. ADR 0061 §5 forbids the SERVING plane
// from reaching the compiler or a second decision authority, and this module is the ingestion
// edge: `tests/invariants/adoption-index-unreachable.invariants.test.ts:225` uses this very file
// as its POSITIVE CONTROL that a shipped ingestion module legitimately DOES reach the store.
//
// The distinction is enforced, not asserted: `adoption-identity-wiring.test.ts` scans the six
// PURE BAKE modules for decision tokens, and this file is deliberately not among them — which is
// exactly why that scan's module set stays at six while its token set grew in this batch. This
// line is in fact that scan's POSITIVE CONTROL for the `@calllint/policy` pattern: an ingestion
// module that legitimately names a policy is how the scan proves its own regexes still match.
import { adoptionBasisPolicy } from "@calllint/policy"
import { DEFAULT_ENDPOINT, DEFAULT_MAX_ENTRIES } from "./fetchRegistry.js"
import { parseSnapshot } from "./snapshot.js"
import { SNAPSHOT_PATH, engineVersion } from "./bake.js"

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

/**
 * Resolve the RAW-READ ceiling — a different quantity from `resolveMaxEntries`, and the
 * distinction is load-bearing.
 *
 * `TRUST_INGEST_MAX_ENTRIES` sizes the SERVED cohort: it is applied after filtering to
 * live records and sorting by name, so it selects which pages get baked. This one bounds
 * how many raw records the mirror reads at all, in arrival order, before any filter. The
 * mirror must read strictly more than the snapshot emits, because it also stores the
 * records the snapshot drops.
 *
 * Fails SAFE the same way: a missing, blank, non-integer, zero or negative value falls back
 * to the default rather than reading unbounded.
 *
 * A value that is not STRICTLY GREATER than the snapshot cap is raised to the default rather
 * than honoured, and the strictness is the point. Live records are a subset of read records,
 * so emitting N entries requires reading at least N; `paginate` reports `capReached` at
 * `yielded >= maxEntries`. An equal pair therefore makes the snapshot's own cap structurally
 * unreachable — the read fails closed on exactly the run where the snapshot would first fill.
 * Accepting `<=` would look correct and be wrong precisely when the source grows, which is
 * the same reason `DEFAULT_MIRROR_MAX_ENTRIES` is a multiple of the snapshot cap and not
 * equal to it. A configuration mistake worth correcting rather than obeying.
 */
export function resolveMirrorMaxEntries(
  env: Record<string, string | undefined>,
  snapshotMaxEntries: number,
): number {
  // The fallback is DERIVED, not the constant. `TRUST_INGEST_MAX_ENTRIES` can raise the
  // snapshot cap above `DEFAULT_MIRROR_MAX_ENTRIES`, and returning the bare constant then
  // would violate the very inequality this function exists to enforce — silently, on the
  // fallback path, which is the path a run with no mirror override takes.
  const floor = Math.max(DEFAULT_MIRROR_MAX_ENTRIES, snapshotMaxEntries + 1)
  const raw = env.TRUST_INGEST_MIRROR_MAX_ENTRIES
  if (raw == null || raw.trim() === "") return floor
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return floor
  if (n <= snapshotMaxEntries) return floor
  return n
}

/**
 * Resolve the PAGE-COUNT ceiling — the third bound on a read, and the one that had no knob.
 *
 * A read stops at whichever of three limits it reaches first: the served-cohort cap, the
 * raw-record cap, or this. The first two were already operator-settable; this one was a bare
 * constant, so an operator facing a page-ceiling truncation had no env var to raise and the
 * only remedy was a code change. That asymmetry is what this closes — `MirrorIncompleteError`
 * now names `TRUST_INGEST_MIRROR_MAX_PAGES` in its `page-cap` remedy, and a remedy that names
 * a knob the operator does not have is not a remedy.
 *
 * Fails SAFE identically to the two caps above: missing, blank, non-integer, zero or negative
 * falls back to `DEFAULT_MAX_PAGES` rather than reading unbounded. There is deliberately NO
 * inequality to enforce here — unlike the record cap, which must stay strictly above the
 * snapshot cap or the snapshot can never fill, a page count has no fixed relationship to a
 * record count, since the records-per-page is the source's choice and not ours.
 */
export function resolveMirrorMaxPages(env: Record<string, string | undefined>): number {
  const raw = env.TRUST_INGEST_MIRROR_MAX_PAGES
  if (raw == null || raw.trim() === "") return DEFAULT_MAX_PAGES
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_MAX_PAGES
  return n
}

/**
 * Whether this run resolves artifacts (R-4).
 *
 * Defaults ON, which is the opposite polarity from the two caps above, and the asymmetry is
 * deliberate: those two bound a quantity, so their fail-safe direction is "fall back to the
 * conservative number", while this one enables a capability whose entire write surface is
 * gitignored. A run that silently skipped artifact resolution would leave `artifact_versions`
 * holding four permanently-null columns and `rebuild.artifact` reporting `null` forever — the
 * shipped-not-wired shape, arriving by default.
 *
 * Only the exact string `0` disables it. Not `false`, not `no`, not any non-empty value: a
 * three-way spelling contest over an off switch is how an operator ends up believing a run is
 * skipping work it is doing. One spelling, and everything else means on — including a typo, which
 * fails toward doing the measurement rather than toward quietly not doing it.
 */
export function resolveArtifactsEnabled(env: Record<string, string | undefined>): boolean {
  return (env.TRUST_INGEST_ARTIFACTS ?? "").trim() !== "0"
}

/**
 * Whether this run compiles evidence from already-fetched artifacts (R-5, wired by S-1).
 *
 * Defaults ON, and the argument is R-4's with its one cost removed. R-4 had to weigh a default-on
 * capability that adds public HTTP GETs; this one adds NONE. `CompileEvidenceInput` carries no
 * `fetchImpl`, so a compilation that reached the network could not typecheck — offline is a
 * property of the type, not a claim in a docblock. Its whole write surface is `evidence_records`
 * under the gitignored `.var/`, so a scheduled run's PR diff is byte-identical either way.
 *
 * What default-OFF would cost is the same thing R-4 named: `evidence_records` empty forever and
 * `rebuild.evidence` reporting `null` on every run, which is the shipped-not-wired shape arriving
 * by default — the shape R-5's own docblock said it was trying to avoid.
 *
 * Only the exact string `0` disables it, deliberately identical to the artifact switch rather than
 * more permissive. Two switches on one bin with two different spellings of "off" is worse than
 * either spelling alone, and a typo here fails toward doing the measurement.
 */
export function resolveEvidenceEnabled(env: Record<string, string | undefined>): boolean {
  return (env.TRUST_INGEST_EVIDENCE ?? "").trim() !== "0"
}

/**
 * Absolute path of the adoption index's migrations directory.
 *
 * Resolved from THIS module's URL rather than from `process.cwd()`, because the store's
 * `cwd` option and its migrations source are two independent things: `cwd` decides where
 * `.var/` lands (the repo root, when this runs from the workflow), while the migrations
 * ship inside the package and must be found wherever it is installed from.
 */
function migrationsDir(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "adoption-index", MIGRATIONS_DIRNAME)
}

async function main(): Promise<void> {
  const now = process.env.TRUST_INGEST_NOW || new Date().toISOString()
  const maxEntries = resolveMaxEntries(process.env)
  const mirrorMaxEntries = resolveMirrorMaxEntries(process.env, maxEntries)
  const maxPages = resolveMirrorMaxPages(process.env)

  // 1. Mirror the full source into the adoption index, then project the snapshot from it
  //    (the only network step). The store self-migrates on open, so a cold CI checkout —
  //    which every scheduled run is, since `.var/` is gitignored and never cached — takes
  //    the same path as a warm one.
  const cwd = process.cwd()
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: migrationsDir(), db, now })
  let mirrored: Awaited<ReturnType<typeof refreshFromMirror>>
  try {
    // 1b. Artifact resolution (R-4), passed as a PORT rather than imported by the operation.
    //     The closure is built here, at the one place in the repo that already holds `fetch`
    //     and the store, so `refreshFromMirror` stays a function of its arguments and the
    //     no-port path — every existing test — is untouched. `undefined` when disabled, which
    //     is what keeps `rebuild.artifact` at `null`: a run that was not asked to resolve
    //     artifacts must not report "no artifact rebuild needed".
    const artifactPort = resolveArtifactsEnabled(process.env)
      ? (ctx: { now: string }) =>
          resolveArtifacts({
            store,
            adapters: createAdapterRegistry([npmArtifactAdapter]),
            fetchImpl: fetch,
            now: ctx.now,
          })
      : undefined

    // 1c. Evidence compilation (R-5), the SECOND port — and the one R-5 shipped without a caller.
    //     It is built here for the same reason as 1b (this is where the store lives) and it comes
    //     AFTER it for a reason that is not ordering preference: `refreshFromMirror` awaits the
    //     artifact port first and the evidence port second, and R-5 reads exactly the bytes R-4
    //     just wrote into the CAS. A cold run therefore fetches and compiles in ONE pass; swapping
    //     them would make evidence perpetually one run stale.
    //
    //     `Promise.resolve` is not decoration. `compileEvidence` is SYNCHRONOUS on purpose
    //     (`compileEvidence.ts:130-135`: an `async` signature would imply a network round trip it
    //     must never take), while the port's type is the seam. Wrapping states both facts at once.
    //
    //     The two injected inputs both come from sources that already exist here — no new
    //     dependency edge is invented for them. `engineVersion()` is `bake.ts`'s one definition,
    //     from the module this file already imports `SNAPSHOT_PATH` from. `policyDigest` is
    //     `hashJson(adoptionBasisPolicy())`: `adoptionBasisPolicy` because the adoption surface
    //     already has exactly ONE policy source, shared by the CLI and the MCP surfaces, and
    //     `defaultPolicy()` here would create a second one. It moves no verdict either way — the
    //     compiled row's verdict is the literal `"UNKNOWN"` at `compileEvidence.ts:278`, because
    //     R-5 deliberately compiles no decision.
    const evidencePort = resolveEvidenceEnabled(process.env)
      ? (ctx: { now: string }) =>
          Promise.resolve(
            compileEvidence({
              store,
              now: ctx.now,
              policyDigest: hashJson(adoptionBasisPolicy()),
              engineVersion: engineVersion(),
            }),
          )
      : undefined

    mirrored = await refreshFromMirror({
      store,
      adapter: createOfficialRegistryAdapter(DEFAULT_ENDPOINT),
      fetchImpl: fetch,
      now,
      endpoint: DEFAULT_ENDPOINT,
      snapshotMaxEntries: maxEntries,
      mirrorMaxEntries,
      maxPages,
      mode: "full",
      ...(artifactPort === undefined ? {} : { artifactPort }),
      ...(evidencePort === undefined ? {} : { evidencePort }),
    })
  } finally {
    store.close()
  }

  // 2. Retain the projected snapshot. Re-parse the serialized bytes so what we bake from
  //    is exactly what we commit (no in-memory drift from the on-disk artifact).
  const snapshotText = mirrored.snapshotText
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, snapshotText, "utf8")
  const committed = parseSnapshot(snapshotText)

  // 3. REPORT the change verdict. This bin measures; it does not rebuild. `bake.ts` is the
  //    one bin that bakes, because it is the one that loads the COMPLETE input set (claims,
  //    evidence, presentation), and the workflow already runs it on the next line
  //    (`trust-ingest.yml`, the `bake:trust-index` step — named rather than numbered, because
  //    this batch's own edit to that file shifted the lines a `:53` used to point at). The
  //    verdict is stdout, not an exit code: a run that mirrored
  //    successfully and found nothing changed SUCCEEDED, and reporting that as a failure
  //    would make the common case red.
  const change = mirrored.change

  // The artifact clause is OMITTED when no port ran, rather than printed as a row of zeros.
  // "0 considered, 0 fetched" and "not asked to resolve" are different facts about a run, and
  // the log is the only place an operator sees either — the same distinction the `null` tier
  // and the `null` summary keep in the data.
  const artifactClause =
    mirrored.artifacts === null ? "" : `${describeArtifactResolution(mirrored.artifacts)}; `

  // The evidence clause inherits that rule verbatim, for the same reason: `null` means the port
  // was never invoked, and printing "0 considered, 0 compiled" for it would assert a measurement
  // nobody took. Placed after the artifact clause because that is the order the data flows in.
  //
  // A SMALL NUMBER HERE IS CORRECT, not a symptom. `isEvidenceCompilable` is a positive whitelist
  // containing `FETCHED` alone (`evidenceInputs.ts:29-35`), and 17 of the 19 live registry entries
  // are remote-only with no package to download. So the expected line on this corpus is 2
  // considered / 2 compiled cold, and 2 unchanged warm — those two are the only entries that have
  // bytes at all.
  const evidenceClause =
    mirrored.evidence === null ? "" : `${describeEvidenceCompilation(mirrored.evidence)}; `

  // eslint-disable-next-line no-console
  console.log(
    `mirror: ${mirrored.sync.records} record(s) read (${mirrored.sync.persisted.inserted} new, ` +
      `${mirrored.sync.persisted.unchanged} unchanged), ${mirrored.mirroredRecords} row(s) stored, ` +
      `${mirrored.currentSubjects} current subject(s); ` +
      `snapshot: ${committed.count} entry(ies) @ ${committed.fetchedAt}; ` +
      `cohort digest ${mirrored.snapshotDigest}; ` +
      artifactClause +
      evidenceClause +
      `${describeSourceChange(change)}`,
  )
}

// Run ONLY when executed as a script (tsx src/refreshSnapshot.ts), never on import — the
// same guard `bake.ts:196` and `resolveEvidence.ts:88` already carry, and this module needs
// it MORE than either of them: `main()` opens a SQLite database under `.var/`, fetches the
// live registry, and rewrites the committed snapshot. `expansion-eligibility.test.ts` imports
// this file for `resolveMaxEntries`/`resolveMirrorMaxEntries` alone, and without the guard
// that import performed a real network read and left `.var/calllint-adoption-index/` behind —
// a test that passed only because the rejection landed after the suite had finished.
const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedAsScript) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
}
