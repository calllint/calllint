/**
 * The presentation deploy ledger (new15 §14 可回滚性 line 2; PR P-7).
 *
 * §14 asks for three things, and this script owns the middle one:
 *
 *     每个 presentation config 有版本          → `configVersion`, the third identity key
 *     每次 deploy 记录 presentationDigest      → THIS FILE
 *     可按 digest 恢复上一版本                  → `gradeRollback` in previewSnapshot.ts
 *
 * WHY A COMMITTED STORE RATHER THAN A GIT QUERY. The obvious implementation reads
 * `git log` at grade time. That implementation is a trap, and the trap was MEASURED
 * rather than predicted: `ci.yml`'s checkout is bare (no `fetch-depth`), so CI clones at
 * depth 1. Cloning this repo at depth 1 and probing it gives
 *
 *     git rev-list --count HEAD                     → 1
 *     git log --follow -- <catalog>                 → 1 commit, not 8
 *     git cat-file -e <a historical blob>           → MISSING
 *     git merge-base --is-ancestor <old> HEAD       → fatal: Not a valid object name
 *
 * — note the last one FATALS rather than returning false, so a grader could not even fail
 * gracefully. A git-reading grader would pass on a developer's full clone and die on CI
 * for a reason having nothing to do with the claim: the "measure the chain that produces
 * the artifact" lesson in its most expensive form. Worse, `audit:preview` runs in CI in
 * `--check` mode, which REBUILDS the artifact and byte-compares it, so a git-derived
 * corpus would make that byte-compare fail on every CI run forever.
 *
 * WHY EACH ENTRY STORES THE DOCUMENT. That measurement forces a stronger conclusion than
 * "keep git out of the grader". If the only copy of a past document lives in git history,
 * then on a depth-1 clone the past documents DO NOT EXIST, and §14's third line — 可按
 * digest 恢复上一版本 — is not merely ungraded there, it is FALSE there. A ledger that
 * recorded digests alone would be a receipt for something unrecoverable, which is the
 * exact failure the three lines are written to prevent. So an entry carries the document
 * it describes, and rollback is then possible from a fresh shallow clone with no network.
 *
 * THE TRUST MODEL, IN TWO HONEST LAYERS. Storing the document creates a question storing
 * only a digest did not: what stops a forged pair that agrees with itself?
 *
 *   • `validateOffline` — no git, so it runs anywhere, including CI. It recomputes all five
 *     values from the STORED document, enforces distinctness and wall-clock ordering, and
 *     requires the newest entry to be the live catalog. This catches a doctored digest, a
 *     doctored document, and an unrecorded catalog change — because in each case the digest
 *     and the bytes beside it disagree. It CANNOT catch a self-consistent forgery: a
 *     fabricated document with a correctly computed digest passes.
 *   • `validate` — offline plus git. It adds the two checks that need history: each commit
 *     is an ancestor of HEAD, and the stored document is byte-identical to the document at
 *     that commit. THIS is the layer that makes an entry authentic rather than merely
 *     self-consistent, and it is why `--record` and `--validate` still use git.
 *
 * The graded path (the preview artifact's 可回滚性 block) reads the offline layer only,
 * because it must produce identical bytes on a full clone and on CI's depth-1 checkout.
 * The stronger layer is a developer/`--validate` obligation, and stating that plainly is
 * better than implying CI proves authenticity when it provably cannot.
 *
 * The precedent is `artifacts/phase-2.4/five-second-panel-store.json`, and the split is
 * copied from it deliberately:
 *
 *   • `--validate` is read-only and is the mode a gate would use. It writes nothing.
 *   • `--record` appends, refuses duplicates, and is NEVER run by a `:write` target or by
 *     a workflow. A deploy workflow that committed to the repo would be a new live writer,
 *     which this batch is not licensed to add.
 *
 * WHAT MAKES THE LEDGER TRUSTWORTHY, STATED HONESTLY. It is append-only by convention
 * plus a duplicate refusal, not by cryptography. Anyone with write access could rewrite
 * it — the identical limit the panel store has carried since new14. What makes an entry
 * checkable is that it is RECOMPUTABLE: every recorded digest must equal what
 * `presentationDigest` computes for the document at that entry's own commit. A forged
 * entry is therefore a failing check, not an unverifiable claim.
 *
 * Usage:
 *   pnpm ledger:presentation:validate          check every entry against the repo
 *   pnpm ledger:presentation:record            append an entry for the current HEAD
 *   pnpm ledger:presentation:record --at <iso> ...with an explicit timestamp
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  emptyPresentationDigest,
  presentationDigest,
  type PresentationContentV1,
} from "../packages/trust-index/src/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..")
const ledgerPath = path.join(repoRoot, "artifacts", "phase-2.4", "presentation-deploy-ledger.json")
const CATALOG = "apps/web/content/safe-install/presentation.v1.json"

export const LEDGER_SCHEMA = "calllint.presentation-deploy-ledger.v1"

export interface LedgerEntry {
  readonly at: string
  readonly commit: string
  readonly configVersion: string | null
  readonly presentationDigest: string
  readonly l0Digest: string
  readonly l1Digest: string
  readonly l2Digest: string
  readonly sections: readonly string[]
  readonly deploymentUrl: string | null
  /**
   * The document this entry describes, or `null` when the catalog did not exist yet.
   *
   * This is what makes the ledger a restore STORE rather than a receipt. `null` is a
   * measured state, not a sentinel: the oldest entry is the parent of the catalog's first
   * commit, and `--validate` proves the absence against git. Recording it as an entry
   * rather than as a special case gives rollback a floor reached by the same lookup as
   * every other version (see `emptyPresentationDigest`, whose docblock reserves this for
   * PR P-7 by name).
   */
  readonly document: PresentationContentV1 | null
}

export interface DeployLedger {
  readonly schema: string
  readonly $comment: string
  readonly deploys: readonly LedgerEntry[]
}

/**
 * Run git, capturing stderr rather than letting it reach the terminal.
 *
 * `stderr: "pipe"` is not cosmetic. Two calls here fail BY DESIGN — `git show` at the
 * predecessor commit (the catalog is absent, which is the measurement) and
 * `merge-base --is-ancestor` for a non-ancestor. Letting git narrate those to the console
 * would print "fatal:" during a run that is passing, which trains a reader to ignore the
 * word.
 */
const git = (...args: string[]): string =>
  execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })

const readLedger = (): DeployLedger => JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as DeployLedger

/**
 * The document as of a commit, or `null` when that commit predates the catalog.
 *
 * `null` is a real answer, not an error: the ledger's oldest entry is the EMPTY
 * predecessor, which exists precisely so rollback has a non-branching floor (see
 * `emptyPresentationDigest`'s own docblock, which reserves it for this batch by name).
 */
function documentAt(commit: string): PresentationContentV1 | null {
  try {
    return JSON.parse(git("show", `${commit}:${CATALOG}`)) as PresentationContentV1
  } catch {
    return null
  }
}

/** Is `a` an ancestor of (or equal to) `b`? */
function isAncestor(a: string, b: string): boolean {
  try {
    git("merge-base", "--is-ancestor", a, b)
    return true
  } catch {
    return false
  }
}

/** Is `commit` an ancestor of (or equal to) HEAD? */
const isAncestorOfHead = (commit: string): boolean => isAncestor(commit, "HEAD")

/**
 * Recompute one entry against ITS OWN STORED DOCUMENT. No git, so this runs anywhere.
 *
 * Every one of the five recorded values is re-derived from the stored bytes. A doctored
 * digest, a doctored document, or a mismatched pair is therefore a named fault. What this
 * layer cannot see is a self-consistent forgery — a fabricated document whose digest was
 * computed correctly — which is precisely what `gitFaultsForEntry` exists to catch.
 */
export function faultsForEntry(entry: LedgerEntry, index: number): string[] {
  const where = `deploys[${index}] (${entry.commit.slice(0, 8)})`
  const faults: string[] = []

  if (!/^[0-9a-f]{40}$/.test(entry.commit)) {
    faults.push(`${where}: commit must be a full 40-hex sha`)
    return faults
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(entry.at)) faults.push(`${where}: 'at' must be an ISO-8601 instant`)
  if (!("document" in entry)) {
    faults.push(`${where}: no document — a ledger without bytes cannot restore anything`)
    return faults
  }

  const doc = entry.document

  // ABSENCE IS A MEASURED STATE, NOT A SENTINEL. The oldest entry is the predecessor of
  // the catalog's first commit — a real sha (`dc7c81c`, where PR P-1 committed the lock
  // that pinned `emptyPresentationDigest()`) at which the catalog genuinely does not
  // exist. `--validate` proves that absence against git; here it is graded as the floor's
  // four digests being the empty document's, so rollback's floor is an entry reached by
  // the same lookup as every other version — no branch for a mutation to hide behind.
  if (doc === null) {
    const empty = emptyPresentationDigest()
    const expectEmpty = (name: "presentationDigest" | "l0Digest" | "l1Digest" | "l2Digest") => {
      if (entry[name] !== empty[name]) {
        faults.push(`${where}: ${CATALOG} is absent there, so ${name} must be ${empty[name]}, found ${entry[name]}`)
      }
    }
    expectEmpty("presentationDigest")
    expectEmpty("l0Digest")
    expectEmpty("l1Digest")
    expectEmpty("l2Digest")
    if (entry.configVersion !== null) faults.push(`${where}: a document that does not exist cannot carry a configVersion`)
    if (entry.sections.length !== 0) faults.push(`${where}: a document that does not exist has no sections`)
    return faults
  }

  const d = presentationDigest(doc)
  const expect = (name: keyof LedgerEntry, actual: string) => {
    if (entry[name] !== actual) {
      faults.push(`${where}: recorded ${name} ${String(entry[name])} != recomputed ${actual}`)
    }
  }
  expect("presentationDigest", d.presentationDigest)
  expect("l0Digest", d.l0Digest)
  expect("l1Digest", d.l1Digest)
  expect("l2Digest", d.l2Digest)

  const recordedVersion = doc.configVersion ?? null
  if (entry.configVersion !== recordedVersion) {
    faults.push(
      `${where}: recorded configVersion ${JSON.stringify(entry.configVersion)} != the document's ${JSON.stringify(recordedVersion)}`,
    )
  }
  if (JSON.stringify(entry.sections) !== JSON.stringify(d.sections)) {
    faults.push(`${where}: recorded sections ${JSON.stringify(entry.sections)} != recomputed ${JSON.stringify(d.sections)}`)
  }
  return faults
}

/**
 * The two checks that need history — AUTHENTICITY, as opposed to self-consistency.
 *
 * Separate from `faultsForEntry` because these cannot run on CI's depth-1 checkout: the
 * historical blobs are absent there, and `merge-base --is-ancestor` fatals on an unknown
 * sha rather than returning false. Requiring them in the graded path would fail every CI
 * run for a reason unrelated to the claim; omitting them entirely would let a fabricated
 * document pass forever. So they run in `--record` and `--validate`, on a full clone.
 */
export function gitFaultsForEntry(entry: LedgerEntry, index: number): string[] {
  const where = `deploys[${index}] (${entry.commit.slice(0, 8)})`
  const faults: string[] = []
  if (!/^[0-9a-f]{40}$/.test(entry.commit)) return faults

  if (!isAncestorOfHead(entry.commit)) {
    faults.push(`${where}: not an ancestor of HEAD — a deploy record for a document this branch never had`)
    return faults
  }

  const atCommit = documentAt(entry.commit)
  if (atCommit === null) {
    // The catalog is genuinely absent at that commit, so the entry must be the floor.
    if (entry.document !== null) {
      faults.push(`${where}: stores a document, but ${CATALOG} does not exist at that commit`)
    }
    return faults
  }
  if (entry.document === null) {
    faults.push(`${where}: stores no document, but ${CATALOG} DOES exist at that commit`)
    return faults
  }

  // Byte-level agreement via the digest rather than via JSON string equality: the stored
  // copy is re-serialized by `JSON.stringify(..., 2)` when the ledger is written, so
  // formatting legitimately differs from the committed file while the CONTENT must not.
  const stored = presentationDigest(entry.document).presentationDigest
  const real = presentationDigest(atCommit).presentationDigest
  if (stored !== real) {
    faults.push(
      `${where}: the stored document (${stored.slice(7, 19)}…) is not the document at that commit ` +
        `(${real.slice(7, 19)}…) — the entry is self-consistent but not authentic`,
    )
  }
  return faults
}

/**
 * Is this clone deep enough for the git layer to mean anything?
 *
 * `gitFaultsForEntry` and `gitFaultsForChain` need the historical commits to be present.
 * On CI they are not: `ci.yml` uses a bare `actions/checkout@v6` with no `fetch-depth`, so
 * the clone is depth-1 and every entry older than HEAD is an unknown sha. That is not a
 * fault in the ledger — it is the absence of the evidence the git layer reads.
 *
 * Exported because the TEST needs it, and needs it for a reason worth stating: a suite that
 * called the git layer unconditionally would pass on a developer's full clone and fail on
 * every CI run, which is the exact failure this file's header warns about one layer up. A
 * suite that simply deleted those assertions would lose the authenticity coverage entirely.
 * Branching on a measured probe keeps both: where history exists the git layer is asserted
 * green, and where it does not the test asserts the offline layer still is — so the split
 * itself is what gets graded, on both kinds of clone.
 */
export function historyIsReachable(ledger: DeployLedger): boolean {
  if (!Array.isArray(ledger.deploys) || ledger.deploys.length === 0) return false
  return ledger.deploys.every((e) => {
    if (!/^[0-9a-f]{40}$/.test(e.commit)) return false
    try {
      git("cat-file", "-e", `${e.commit}^{commit}`)
      return true
    } catch {
      return false
    }
  })
}

/**
 * Every fault detectable WITHOUT git: shape, per-entry recomputation, distinctness,
 * wall-clock ordering, and currency against the live catalog.
 *
 * This is the function the graded path calls, and `liveDocument` is a parameter rather
 * than a file read so the grader stays pure and the artifact stays reproducible.
 */
export function validateOffline(ledger: DeployLedger, live: PresentationContentV1): string[] {
  const faults: string[] = []
  if (ledger.schema !== LEDGER_SCHEMA) faults.push(`schema must be ${LEDGER_SCHEMA}, found ${ledger.schema}`)
  if (!Array.isArray(ledger.deploys) || ledger.deploys.length === 0) {
    faults.push("deploys[] is empty — a ledger with no entries records nothing")
    return faults
  }

  ledger.deploys.forEach((e, i) => faults.push(...faultsForEntry(e, i)))

  // Distinctness is what makes a digest a usable restore key. Two entries sharing one
  // digest would make `restoreByDigest` ambiguous, and an ambiguous restore is a guess.
  const digests = ledger.deploys.map((e) => e.presentationDigest)
  if (new Set(digests).size !== digests.length) {
    faults.push("two entries share a presentationDigest — a digest must identify exactly one document")
  }
  const keys = ledger.deploys.map((e) => `${e.commit}/${e.presentationDigest}`)
  if (new Set(keys).size !== keys.length) faults.push("duplicate (commit, presentationDigest) entry")

  // ORDER IS SEMANTICS HERE, NOT PRESENTATION. §14 asks to restore 上一版本 — "the
  // PREVIOUS version" — and "previous" is only defined if `deploys[]` is a chain. Two
  // independent orderings must therefore agree: wall-clock `at` must increase (here), and
  // each commit must be an ancestor of the next (in `gitFaultsForChain`, since ancestry
  // needs history). Time alone would accept a rebase that reordered history; ancestry
  // alone would accept a back-dated entry. Both together make `deploys[i-1]` the honest
  // predecessor of `deploys[i]`.
  for (let i = 1; i < ledger.deploys.length; i++) {
    const prev = ledger.deploys[i - 1]!
    const cur = ledger.deploys[i]!
    if (!(Date.parse(prev.at) < Date.parse(cur.at))) {
      faults.push(`deploys[${i}] (${cur.commit.slice(0, 8)}): 'at' ${cur.at} is not after deploys[${i - 1}]'s ${prev.at}`)
    }
  }

  // The newest entry must describe the document as it stands NOW. This is §14's second
  // line as an enforceable obligation: change the catalog without recording, and this is
  // the fault that names it.
  const liveDigest = presentationDigest(live)
  const newest = ledger.deploys[ledger.deploys.length - 1]!
  if (newest.presentationDigest !== liveDigest.presentationDigest) {
    faults.push(
      `the newest entry (${newest.commit.slice(0, 8)}, ${newest.presentationDigest}) is not the CURRENT document ` +
        `(${liveDigest.presentationDigest}) — the catalog changed without a ledger entry; run ` +
        `\`pnpm ledger:presentation:record\``,
    )
  }
  return faults
}

/** Ancestry over the chain — the git half of the two-ordering rule above. */
export function gitFaultsForChain(ledger: DeployLedger): string[] {
  const faults: string[] = []
  for (let i = 1; i < ledger.deploys.length; i++) {
    const prev = ledger.deploys[i - 1]!
    const cur = ledger.deploys[i]!
    if (/^[0-9a-f]{40}$/.test(prev.commit) && /^[0-9a-f]{40}$/.test(cur.commit) && !isAncestor(prev.commit, cur.commit)) {
      faults.push(
        `deploys[${i}] (${cur.commit.slice(0, 8)}): ${prev.commit.slice(0, 8)} is not an ancestor of it — ` +
          `deploys[] must be a single chain, or "the previous version" has no meaning`,
      )
    }
  }
  return faults
}

/**
 * The full check: everything offline, plus the git layer that makes entries authentic.
 *
 * Used by `--validate` and `--record`, both of which a human runs on a full clone. The
 * graded path calls `validateOffline` instead — see this file's header for why that is a
 * deliberate, stated limit rather than an oversight.
 */
export function validate(ledger: DeployLedger): string[] {
  const live = JSON.parse(fs.readFileSync(path.join(repoRoot, CATALOG), "utf8")) as PresentationContentV1
  const faults = validateOffline(ledger, live)
  if (!Array.isArray(ledger.deploys) || ledger.deploys.length === 0) return faults
  ledger.deploys.forEach((e, i) => faults.push(...gitFaultsForEntry(e, i)))
  faults.push(...gitFaultsForChain(ledger))
  return faults
}

/** Append an entry for HEAD's document. Refuses anything the validator would reject. */
function record(atOverride: string | null, deploymentUrl: string | null): number {
  const ledger = readLedger()
  const head = git("rev-parse", "HEAD").trim()
  const live = JSON.parse(fs.readFileSync(path.join(repoRoot, CATALOG), "utf8")) as PresentationContentV1
  const d = presentationDigest(live)

  // The document must be COMMITTED at HEAD and identical to the working tree, or the
  // entry would claim a digest no commit carries — unrecomputable, and so untrustworthy
  // in exactly the way the recomputation check exists to prevent.
  const committed = documentAt(head)
  if (committed === null) {
    console.error(`refusing to record — ${CATALOG} does not exist at HEAD (${head.slice(0, 8)})`)
    return 2
  }
  if (presentationDigest(committed).presentationDigest !== d.presentationDigest) {
    console.error(
      `refusing to record — the working tree's ${CATALOG} differs from HEAD's. Commit the catalog first, ` +
        `so the recorded digest is recomputable from a real commit.`,
    )
    return 2
  }

  if (ledger.deploys.some((e) => e.commit === head && e.presentationDigest === d.presentationDigest)) {
    console.error(`refusing to record — ${head.slice(0, 8)} @ ${d.presentationDigest.slice(0, 19)}… is already recorded.`)
    return 2
  }

  // The COMMITTED document is stored, not the working-tree one. They are proven identical
  // above; storing the committed copy means the bytes and the commit that vouches for them
  // can never diverge, even if this line is reached some other way later.
  const entry: LedgerEntry = {
    at: atOverride ?? new Date().toISOString(),
    commit: head,
    configVersion: live.configVersion ?? null,
    presentationDigest: d.presentationDigest,
    l0Digest: d.l0Digest,
    l1Digest: d.l1Digest,
    l2Digest: d.l2Digest,
    sections: d.sections,
    deploymentUrl,
    document: committed,
  }
  const next: DeployLedger = { ...ledger, deploys: [...ledger.deploys, entry] }
  const faults = validate(next)
  if (faults.length > 0) {
    console.error(`refusing to write — the result would be invalid:\n  ${faults.join("\n  ")}`)
    return 1
  }
  fs.writeFileSync(ledgerPath, JSON.stringify(next, null, 2) + "\n", "utf8")
  console.log(
    `recorded ${head.slice(0, 8)} — configVersion ${entry.configVersion ?? "(none)"}, ` +
      `presentationDigest ${entry.presentationDigest.slice(0, 19)}…`,
  )
  console.log(`${path.relative(repoRoot, ledgerPath)} now holds ${next.deploys.length} deploy(s).`)
  return 0
}

// --- modes -------------------------------------------------------------------
//
// Guarded so that IMPORTING this file does not run it. `validate`/`faultsForEntry` are
// exported for tests and for the rollback grader's own checks, and an unguarded top-level
// dispatch would make every import exit the process — measured the hard way: a probe that
// imported `validate` terminated with the CLI's exit code before its first assertion.

const invokedDirectly = (() => {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return path.resolve(entry) === fileURLToPath(import.meta.url)
})()

const argv = process.argv.slice(2)
const flagValue = (flag: string): string | null => {
  const i = argv.indexOf(flag)
  if (i === -1) return null
  const v = argv[i + 1]
  return v === undefined || v.startsWith("--") ? null : v
}

if (!invokedDirectly) {
  // imported as a module — expose the functions, run nothing
} else if (argv.includes("--record")) {
  process.exit(record(flagValue("--at"), flagValue("--deployment-url")))
} else {
  // `--offline` selects the git-free layer. It exists for ONE caller with a real
  // constraint: `deploy-web.yml`'s `actions/checkout@v6` is depth-1, so `git show` at a
  // historical commit reports MISSING there and `merge-base --is-ancestor` cannot even
  // fail gracefully. A deploy step that called the git layer would fail on every deploy
  // for a reason having nothing to do with the claim it is making. So the deploy verifies
  // what it CAN — that the document it is about to publish is the ledger's newest entry,
  // recomputed from stored bytes — and authenticity stays a full-clone obligation.
  const offline = argv.includes("--offline")
  const ledger = readLedger()
  const live = JSON.parse(fs.readFileSync(path.join(repoRoot, CATALOG), "utf8")) as PresentationContentV1
  const faults = offline ? validateOffline(ledger, live) : validate(ledger)
  if (faults.length > 0) {
    console.error(`${path.relative(repoRoot, ledgerPath)} is invalid:`)
    for (const f of faults) console.error(`  - ${f}`)
    process.exit(2)
  }
  const newest = ledger.deploys[ledger.deploys.length - 1]!
  console.log(
    `deploy ledger OK — ${ledger.deploys.length} entr${ledger.deploys.length === 1 ? "y" : "ies"}, ` +
      (offline
        ? `every digest recomputed from stored bytes (offline: ancestry and authenticity NOT checked).`
        : `every digest recomputed against its own commit.`),
  )
  console.log(
    `newest: ${newest.commit.slice(0, 8)} @ ${newest.at} — configVersion ${newest.configVersion ?? "(none)"}, ` +
      `presentationDigest ${newest.presentationDigest.slice(0, 19)}…`,
  )
  process.exit(0)
}
