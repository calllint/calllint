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
 *   pnpm ledger:presentation:reseat            re-point post-squash dangling entries
 *   pnpm ledger:presentation:reseat --dry-run  ...printing the repair without writing
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
 * Does git itself say this clone's history has been TRUNCATED?
 *
 * Deliberately not the same question as `historyIsReachable`, and the difference is the
 * whole reason this exists. That function asks "can I see every commit this ledger names",
 * which is false both when the clone is shallow AND when an entry is genuinely dangling —
 * one bit standing in for two causes that want opposite responses
 * ([[a-boolean-standing-in-for-a-reason]]). This one asks git directly, so absence of
 * evidence can be told apart from evidence of a fault
 * ([[absence-must-not-become-a-category]]).
 */
export function repositoryIsShallow(): boolean {
  try {
    return git("rev-parse", "--is-shallow-repository").trim() === "true"
  } catch {
    return false
  }
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
 * The outcome of a full check — three states, not two (ADR 0082).
 *
 * `refused` exists because "nothing was wrong" and "nothing was checked" must not be
 * spellable the same way. The obvious shape for the shallow-clone guard was to return an
 * empty fault list, and that is strictly worse than the bug it fixes: `ledger-authenticity`
 * is this layer's only automated reader and its only protection is one `fetch-depth: 0`
 * line, so a silent pass would let deleting that line leave the job green while verifying
 * nothing ([[absence-makes-a-gate-skip-itself]]). Making refusal a separate variant means a
 * caller that ignores it does not typecheck.
 */
export type ValidationOutcome =
  | { readonly kind: "checked"; readonly faults: string[] }
  | { readonly kind: "refused"; readonly reason: string }

/**
 * The full check: everything offline, plus the git layer that makes entries authentic.
 *
 * Used by `--validate` and `--record`, both of which a human runs on a full clone. The
 * graded path calls `validateOffline` instead — see this file's header for why that is a
 * deliberate, stated limit rather than an oversight.
 *
 * REFUSES ON A SHALLOW CLONE, for the same reason `findReseat` does and in the same class of
 * fault (ADR 0081 fixed that function; ADR 0082 found the conflation still live here). The
 * git layer keys on ancestry, and `!isAncestorOfHead` is true for a dangling entry AND for a
 * commit that was merely never fetched. Measured on a real `--depth 1` clone of `02288fd2`:
 * this function produced NINETEEN faults over ten authentic entries, each saying "a deploy
 * record for a document this branch never had". Every one was false. It fails closed — no
 * write happens — but it still accuses a human of a forgery on evidence that cannot support
 * one, which is what 0081 D1 forbids. `--offline` is the mode that can answer honestly here.
 */
export function validate(ledger: DeployLedger): ValidationOutcome {
  if (repositoryIsShallow()) {
    return {
      kind: "refused",
      reason:
        "this clone is SHALLOW, so an entry that is merely unfetched is indistinguishable from one that names " +
        "a commit this branch never had. Refusing to grade authenticity rather than accuse every entry: re-run " +
        "with full history (`git fetch --unshallow`, or `actions/checkout` with `fetch-depth: 0`), or use " +
        "`--offline` to check recomputation from stored bytes without the git layer.",
    }
  }
  const live = JSON.parse(fs.readFileSync(path.join(repoRoot, CATALOG), "utf8")) as PresentationContentV1
  const faults = validateOffline(ledger, live)
  if (!Array.isArray(ledger.deploys) || ledger.deploys.length === 0) return { kind: "checked", faults }
  ledger.deploys.forEach((e, i) => faults.push(...gitFaultsForEntry(e, i)))
  faults.push(...gitFaultsForChain(ledger))
  return { kind: "checked", faults }
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
  // The result is graded by the FULL validator, git layer included — which is why `record`
  // inherits 0082's refusal rather than implementing one. 0081 left open "whether `record`
  // should also refuse, since it reads only HEAD"; it does not, and never did: this call
  // reads every entry's commit, so on a truncated clone it produced nineteen false
  // accusations about ten authentic entries. Refusing here writes nothing, same as a fault.
  const outcome = validate(next)
  if (outcome.kind === "refused") {
    console.error(`refusing to record — ${outcome.reason}`)
    return 3
  }
  if (outcome.faults.length > 0) {
    console.error(`refusing to write — the result would be invalid:\n  ${outcome.faults.join("\n  ")}`)
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

/**
 * One dangling entry and the commit that actually carries its bytes (ADR 0080).
 *
 * `reason` is carried out rather than reduced to a boolean, because the two ways an entry
 * can be unreseatable need OPPOSITE fixes and a bare `null` cannot tell them apart: an
 * entry whose document exists nowhere on this branch is a forgery or a lost commit (do not
 * touch it), while an entry that is simply already correct needs no command at all
 * ([[a-boolean-standing-in-for-a-reason]]).
 */
export interface Reseat {
  readonly index: number
  readonly from: string
  readonly to: string
}

/**
 * Find the commit on HEAD's history that carries an entry's ALREADY-STORED document.
 *
 * This is the whole safety argument for `--reseat`, so it is worth stating precisely: the
 * command never computes a new digest, never reads the working tree, and never invents a
 * document. It searches the commits that touched the catalog for one whose catalog is
 * byte-identical to the bytes the entry already carries, and re-points `commit` at that.
 * Every digest in the entry stays as recorded, and `validate` then re-derives all of them
 * against the new commit — so a reseat that changed meaning is a FAILING validation, not a
 * silent success.
 *
 * Why this is not "trusting the squash": a squash preserves the tree, so the post-squash
 * commit carries byte-identical catalog bytes and is found here. A rebase that EDITED the
 * catalog does not, and is correctly refused. The distinction is measured, not assumed.
 *
 * REFUSES WHOLESALE ON A SHALLOW CLONE, and that is a safety property rather than a
 * convenience. `isAncestorOfHead` is false for a dangling entry and equally false for a
 * commit that was simply never fetched, so on a depth-1 clone every entry looks dangling.
 * Measured on a real `--depth 1` clone of this repo: `rev-list HEAD -- <catalog>` yields
 * ONE candidate, and the ten-entry ledger produced nine "matches NO commit" refusals plus
 * one reseat — the newest entry, re-pointed onto HEAD. That reseat is the dangerous half:
 * `record` guarantees the newest entry's document equals HEAD's catalog, so on a truncated
 * clone the byte comparison always succeeds for it and the command would rewrite an
 * AUTHENTIC pointer while calling nine authentic entries forgeries. Absence of history is
 * not evidence of a fault, so the answer is neither "repair" nor "accuse".
 */
export function findReseat(ledger: DeployLedger): { reseats: Reseat[]; refusals: string[] } {
  const reseats: Reseat[] = []
  const refusals: string[] = []
  if (repositoryIsShallow()) {
    return {
      reseats: [],
      refusals: [
        "this clone is SHALLOW, so an entry that is merely unfetched is indistinguishable from one that is " +
          "dangling. Refusing to reseat anything: re-run with full history (`git fetch --unshallow`, or " +
          "`actions/checkout` with `fetch-depth: 0`).",
      ],
    }
  }
  // Only commits that touched the catalog can carry a different version of it. `--follow`
  // is deliberately absent: a rename would change the path this ledger is about, and
  // silently following it would reseat onto a document at a path the entry never described.
  const candidates = git("rev-list", "HEAD", "--", CATALOG).trim().split("\n").filter(Boolean)

  ledger.deploys.forEach((entry, index) => {
    if (!/^[0-9a-f]{40}$/.test(entry.commit)) return
    if (isAncestorOfHead(entry.commit)) return // already authentic — nothing to reseat

    const stored = JSON.stringify(entry.document)
    const match = candidates.find((c) => JSON.stringify(documentAt(c)) === stored)
    if (match === undefined) {
      refusals.push(
        `deploys[${index}] (${entry.commit.slice(0, 8)}): its stored document matches NO commit on HEAD's history — ` +
          `this is not a squash artifact. Do not reseat it; find the commit that carries these bytes, or the entry is wrong.`,
      )
      return
    }
    reseats.push({ index, from: entry.commit, to: match })
  })
  return { reseats, refusals }
}

/**
 * Re-point dangling entries at the commit that carries their bytes (ADR 0080).
 *
 * A squash-merge rewrites the sha a ledger entry recorded, so the entry becomes an ancestor
 * of nothing and `validate` reds. This happened twice (#249 `4efe131`, #293 `7a6b0a5`) and
 * both times the fix was a human hand-editing one 40-hex field in a JSON file — a fix that
 * is correct and is also indistinguishable, in the diff, from fabricating a pointer. This
 * mode makes the same repair a command whose safety is checked rather than trusted.
 *
 * `--dry-run` prints the repair and writes nothing, so the fix can be reviewed before it is
 * applied. Without it, the write still happens only if `validate` passes on the result.
 */
function reseat(dryRun: boolean): number {
  const ledger = readLedger()
  const { reseats, refusals } = findReseat(ledger)

  for (const r of refusals) console.error(`refusing — ${r}`)
  if (reseats.length === 0) {
    if (refusals.length > 0) return 2
    // Not an error, and saying so matters: the mode is meant to be safe to run after any
    // squash, including the ones that needed nothing.
    console.log("nothing to reseat — every entry's commit is already an ancestor of HEAD.")
    return 0
  }

  const deploys = ledger.deploys.map((e, i) => {
    const r = reseats.find((x) => x.index === i)
    return r === undefined ? e : { ...e, commit: r.to }
  })
  const next: DeployLedger = { ...ledger, deploys }

  for (const r of reseats) {
    console.log(
      `deploys[${r.index}]: ${r.from.slice(0, 8)} → ${r.to.slice(0, 8)} ` +
        `(same catalog bytes; every recorded digest left untouched)`,
    )
  }

  // Ordered BEFORE validate() on purpose. An unexplained entry is never an ancestor of HEAD,
  // so validate() is guaranteed to fail on it — putting this check after would make it
  // unreachable and report a partial repair as a digest fault, hiding the real reason.
  if (refusals.length > 0) {
    console.error("refusing to write — some entries could be reseated but others are unexplained (see above).")
    return 2
  }

  // The result is graded by the FULL validator, git layer included. That is what makes this
  // a repair rather than an assertion: if re-pointing the entry made any recorded digest
  // stop recomputing against its own commit, this refuses instead of writing.
  //
  // Unreachable on a shallow clone in practice — `findReseat` already returned a refusal
  // above, so `reseats` was empty and this line was never reached. Handled explicitly
  // anyway: an unhandled variant here would be a silent write on any future path that
  // produced reseats without consulting `findReseat`'s guard.
  const outcome = validate(next)
  if (outcome.kind === "refused") {
    console.error(`refusing to write — ${outcome.reason}`)
    return 3
  }
  if (outcome.faults.length > 0) {
    console.error(`refusing to write — the reseated ledger would still be invalid:\n  ${outcome.faults.join("\n  ")}`)
    return 1
  }
  if (dryRun) {
    console.log("\n--dry-run: nothing written. The repair above validates.")
    return 0
  }
  fs.writeFileSync(ledgerPath, JSON.stringify(next, null, 2) + "\n", "utf8")
  console.log(`\n${path.relative(repoRoot, ledgerPath)} reseated — ${reseats.length} entr${reseats.length === 1 ? "y" : "ies"}.`)
  console.log("The preview snapshot embeds the newest pointer; run `pnpm audit:preview:write` next.")
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
} else if (argv.includes("--reseat")) {
  process.exit(reseat(argv.includes("--dry-run")))
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
  const outcome: ValidationOutcome = offline
    ? { kind: "checked", faults: validateOffline(ledger, live) }
    : validate(ledger)

  // EXIT 3, deliberately not 0 and not 2 (ADR 0082 D3). Not 0, because `ledger-authenticity`
  // is this layer's only automated reader and its only protection is one `fetch-depth: 0`
  // line — passing here would mean deleting that line disarms the job silently. Not 2,
  // because "this clone cannot answer the question" is not "your ledger is broken", and a
  // human reading CI needs to tell those apart.
  if (outcome.kind === "refused") {
    console.error(`cannot verify ${path.relative(repoRoot, ledgerPath)} — ${outcome.reason}`)
    process.exit(3)
  }
  if (outcome.faults.length > 0) {
    console.error(`${path.relative(repoRoot, ledgerPath)} is invalid:`)
    for (const f of outcome.faults) console.error(`  - ${f}`)
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
