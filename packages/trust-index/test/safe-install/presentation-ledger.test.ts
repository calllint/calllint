// ---------------------------------------------------------------------------
// Workstream P Batch 8 — the deploy ledger's two trust layers (new15 §14 可回滚性
// line 2; PR P-7).
//
// `scripts/presentation-ledger.ts` answers "每次 deploy 记录 presentationDigest" with a
// COMMITTED store, and it splits validation in two on purpose. This suite grades that
// split, and the split is the whole reason the suite exists:
//
//   • `validateOffline` — no git, so it runs on CI's depth-1 checkout. It recomputes all
//     five recorded values from each entry's STORED document.
//   • `validate` — offline plus the git layer: ancestry of HEAD, and the stored document
//     equals the document at its own commit.
//
// The load-bearing test here is THE FORGERY. A ledger entry that stores a fabricated
// document together with that document's correctly-computed digest is internally perfect:
// `validateOffline` has, by construction, nothing to compare it against and MUST report
// zero faults. Asserting that plainly is what keeps the docblock's honesty claim honest —
// it would be easy to imply CI proves authenticity, and it provably cannot. The git layer
// is then asserted to name that same entry. A test that only checked "a forgery fails"
// without pinning WHICH layer catches it would pass while the two layers were silently
// collapsed into one.
//
// Everything else is derivational. No digest appears here as a hex literal: expected
// values are computed by calling `presentationDigest` on the same document the entry
// stores, so a test cannot certify itself.
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  LEDGER_SCHEMA,
  faultsForEntry,
  findReseat,
  gitFaultsForChain,
  gitFaultsForEntry,
  historyIsReachable,
  validate,
  validateOffline,
  type DeployLedger,
  type LedgerEntry,
} from "../../../../scripts/presentation-ledger.js"
import {
  emptyPresentationDigest,
  presentationDigest,
  type PresentationContentV1,
} from "../../src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const ledgerPath = path.join(repoRoot, "artifacts", "phase-2.4", "presentation-deploy-ledger.json")

/** The COMMITTED ledger — the object every gate and the deploy step actually read. */
const committed = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as DeployLedger

/** The live catalog, read the same way the CLI reads it. */
const liveCatalog = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "apps", "web", "content", "safe-install", "presentation.v1.json"), "utf8"),
) as PresentationContentV1

/**
 * Build an entry whose five recorded values are DERIVED from the document it stores.
 *
 * Every fixture below starts here, so a fixture is self-consistent by construction and a
 * test that wants a fault has to introduce one explicitly. The alternative — hand-written
 * digests — would make each fixture a literal that cannot detect its own subject changing.
 */
function entryFor(doc: PresentationContentV1 | null, commit: string, at: string): LedgerEntry {
  const d = doc === null ? emptyPresentationDigest() : presentationDigest(doc)
  return {
    at,
    commit,
    configVersion: doc?.configVersion ?? null,
    presentationDigest: d.presentationDigest,
    l0Digest: d.l0Digest,
    l1Digest: d.l1Digest,
    l2Digest: d.l2Digest,
    sections: d.sections,
    deploymentUrl: null,
    document: doc,
  }
}

const sha = (n: number): string => String(n).repeat(40).slice(0, 40)

const ledgerOf = (deploys: readonly LedgerEntry[]): DeployLedger => ({
  schema: LEDGER_SCHEMA,
  $comment: "test fixture",
  deploys,
})

describe("the committed ledger", () => {
  it("passes the offline layer against the live catalog", () => {
    expect(validateOffline(committed, liveCatalog)).toEqual([])
  })

  // The git layer over the REAL ledger. This is the authenticity claim the offline layer
  // cannot make, asserted on the actual store rather than on a fixture — a fixture's
  // commits are synthetic, so only the committed ledger can exercise it.
  //
  // Gated on `historyIsReachable`, and the gate is the point rather than a concession. This
  // suite first shipped calling `validate` unconditionally, and it went red on all three CI
  // OSes while `pnpm ci:local` was green: `ci.yml` checks out with no `fetch-depth`, so the
  // clone is depth-1 and every historical commit is an unknown sha. That is precisely the
  // trap `presentation-ledger.ts`' header describes — and the reason `validateOffline`
  // exists — reproduced one level up, in the test instead of the grader.
  //
  // Deleting the assertion would drop the authenticity coverage; keeping it unconditional
  // would fail CI for want of evidence rather than for a fault. So each branch asserts
  // something real: with history, the git layer is green; without it, the OFFLINE layer is
  // green and the git layer is recorded as unrunnable. Neither branch is a no-op.
  it("passes the git layer too, so every stored document is authentic", () => {
    if (!historyIsReachable(committed)) {
      expect(validateOffline(committed, liveCatalog)).toEqual([])
      return
    }
    expect(validate(committed)).toEqual([])
  })

  it("stores a document for every entry, since a ledger without bytes restores nothing", () => {
    for (const e of committed.deploys) expect("document" in e).toBe(true)
    // Exactly one entry is the empty floor: the predecessor of the catalog's first commit.
    expect(committed.deploys.filter((e) => e.document === null)).toHaveLength(1)
    expect(committed.deploys[0]!.document).toBeNull()
  })

  it("records each entry's digests as the digests OF ITS OWN stored document", () => {
    for (const e of committed.deploys) {
      const d = e.document === null ? emptyPresentationDigest() : presentationDigest(e.document)
      expect(e.presentationDigest).toBe(d.presentationDigest)
      expect(e.l0Digest).toBe(d.l0Digest)
      expect(e.l1Digest).toBe(d.l1Digest)
      expect(e.l2Digest).toBe(d.l2Digest)
      expect(e.configVersion).toBe(e.document?.configVersion ?? null)
    }
  })
})

describe("the `document` field", () => {
  it("is required — an entry without one is a receipt for something unrecoverable", () => {
    const good = entryFor(liveCatalog, sha(1), "2026-08-01T00:00:00.000Z")
    const { document: _dropped, ...withoutDocument } = good
    const faults = faultsForEntry(withoutDocument as LedgerEntry, 0)
    expect(faults.join(" | ")).toMatch(/no document/)
  })

  // `null` is a MEASURED state, not a sentinel, and the floor is graded by having the
  // empty document's four digests rather than by a branch on the index.
  it("accepts null only when the four digests are the empty document's", () => {
    const floor = entryFor(null, sha(1), "2026-08-01T00:00:00.000Z")
    expect(faultsForEntry(floor, 0)).toEqual([])

    const wrong: LedgerEntry = { ...floor, presentationDigest: presentationDigest(liveCatalog).presentationDigest }
    expect(faultsForEntry(wrong, 0).join(" | ")).toMatch(/presentationDigest/)
  })

  it("must agree with the digests recorded beside it", () => {
    const e = entryFor(liveCatalog, sha(1), "2026-08-01T00:00:00.000Z")
    // Mutate the DOCUMENT and leave the digest: the pair now disagrees.
    const tampered: LedgerEntry = {
      ...e,
      document: { ...liveCatalog, configVersion: "tampered-1" },
    }
    const faults = faultsForEntry(tampered, 3)
    expect(faults.length).toBeGreaterThan(0)
    expect(faults.join(" | ")).toContain("deploys[3]")
  })
})

describe("validateOffline vs validate — what each layer can and cannot see", () => {
  // THE FORGERY. A fabricated document plus its own correctly-computed digest.
  const forgedDoc: PresentationContentV1 = { ...liveCatalog, configVersion: "9999.99.99-forged" }
  const forged = entryFor(forgedDoc, sha(9), "2099-01-01T00:00:00.000Z")

  it("offline reports ZERO faults for a self-consistent forgery, stated plainly", () => {
    // Not a defect — a boundary. The forgery is internally perfect, so the layer with
    // nothing to compare it against must not pretend to detect it. If this ever starts
    // failing, the offline layer grew a git read and stopped being CI-safe.
    expect(faultsForEntry(forged, 0)).toEqual([])
    expect(validateOffline(ledgerOf([forged]), forgedDoc)).toEqual([])
  })

  it("the git layer names it, because the stored bytes are not the bytes at that commit", () => {
    const faults = gitFaultsForEntry(forged, 0)
    expect(faults.length).toBeGreaterThan(0)
    // sha(9) is not a real commit, so ancestry is the first thing that fails. Either
    // named fault is the git layer doing its job; what matters is that it speaks and the
    // offline layer above did not.
    expect(faults.join(" | ")).toMatch(/not an ancestor of HEAD|not the document at that commit/)
  })

  it("offline catches an unrecorded catalog change — §14's second line, enforced", () => {
    const faults = validateOffline(committed, { ...liveCatalog, configVersion: "unrecorded-1" })
    expect(faults.join(" | ")).toMatch(/is not the CURRENT document/)
    expect(faults.join(" | ")).toMatch(/ledger:presentation:record/)
  })

  it("offline catches a doctored digest, since digest and bytes then disagree", () => {
    const e = entryFor(liveCatalog, sha(1), "2026-08-01T00:00:00.000Z")
    const doctored: LedgerEntry = { ...e, l1Digest: emptyPresentationDigest().l1Digest }
    expect(faultsForEntry(doctored, 0).join(" | ")).toMatch(/l1Digest/)
  })

  it("offline enforces distinctness — an ambiguous restore key is a guess", () => {
    const a = entryFor(liveCatalog, sha(1), "2026-08-01T00:00:00.000Z")
    const b = { ...a, commit: sha(2), at: "2026-08-02T00:00:00.000Z" }
    const faults = validateOffline(ledgerOf([a, b]), liveCatalog)
    expect(faults.join(" | ")).toMatch(/share a presentationDigest/)
  })

  it("offline enforces wall-clock ordering, so `上一版本` has a meaning", () => {
    const older = entryFor(null, sha(1), "2026-08-02T00:00:00.000Z")
    const newer = entryFor(liveCatalog, sha(2), "2026-08-01T00:00:00.000Z")
    const faults = validateOffline(ledgerOf([older, newer]), liveCatalog)
    expect(faults.join(" | ")).toMatch(/is not after/)
  })

  it("offline rejects a wrong schema tag and an empty deploys[]", () => {
    expect(validateOffline({ ...committed, schema: "nope.v9" }, liveCatalog).join(" | ")).toMatch(/schema must be/)
    expect(validateOffline(ledgerOf([]), liveCatalog).join(" | ")).toMatch(/deploys\[\] is empty/)
  })

  // The chain half of the two-ordering rule. Time alone would accept a rebase that
  // reordered history; ancestry alone would accept a back-dated entry.
  // The synthetic half needs no history: `sha(1)`/`sha(2)` are invented shas, so they are
  // unknown on ANY clone and the fault fires everywhere. Only the real-ledger half needs a
  // deep clone, so only that half is gated.
  it("the git layer enforces ancestry across the chain", () => {
    const a = entryFor(null, sha(1), "2026-08-01T00:00:00.000Z")
    const b = entryFor(liveCatalog, sha(2), "2026-08-02T00:00:00.000Z")
    expect(gitFaultsForChain(ledgerOf([a, b])).join(" | ")).toMatch(/is not an ancestor of it/)
    // And it is silent on the real ledger, whose entries ARE a chain — where reachable.
    if (historyIsReachable(committed)) expect(gitFaultsForChain(committed)).toEqual([])
  })

  it("`validate` is a superset of `validateOffline` on the real store", () => {
    // Both green here; the point is that validate() runs the offline checks too, so a
    // future offline-only fault cannot hide from the full mode. On a depth-1 clone the
    // superset relation is unobservable, but the offline half still is — assert that rather
    // than nothing, so the test never silently becomes a skip.
    const offline = validateOffline(committed, liveCatalog)
    expect(offline).toEqual([])
    if (!historyIsReachable(committed)) return
    expect(validate(committed)).toEqual([])
  })

  // The probe itself, so it cannot rot into a constant `false` that would neuter every gate
  // above it. A fabricated sha is unreachable on every clone; the real ledger's shas are
  // reachable on a full one. Asserting the negative unconditionally is what keeps the probe
  // honest on CI, where the positive cannot be checked.
  it("the reachability probe distinguishes a real chain from a fabricated one", () => {
    expect(historyIsReachable(ledgerOf([entryFor(liveCatalog, sha(9), "2026-08-01T00:00:00.000Z")]))).toBe(false)
    expect(historyIsReachable(ledgerOf([]))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// `--reseat` (ADR 0080). The repair for the ONE fault class this repo has hit twice
// (#249, #293): a squash-merge rewrites the sha a ledger entry recorded, so the entry
// becomes an ancestor of nothing and `validate`'s git layer names it.
//
// The subject under test is `findReseat`, not the mode wrapper — the wrapper's job is
// printing and writing, while the safety property lives entirely in the finder: it may
// only re-point an entry at a commit whose catalog is BYTE-IDENTICAL to the bytes that
// entry already stores. Every test below therefore asserts on the bytes, never on a
// hardcoded sha of this repo's history, which would rot at the next catalog commit.
//
// These need real history: a squash artifact is only recognisable against the commits
// that touched the catalog. On CI's depth-1 clone those commits do not exist, so each
// test states what it can there rather than becoming a silent skip.
// ---------------------------------------------------------------------------
describe("--reseat: repairing a post-squash dangling entry", () => {
  /** The dangling-sha fault, injected into a COPY of the committed ledger. */
  const withDanglingNewest = (): DeployLedger => ({
    ...committed,
    deploys: committed.deploys.map((e, i) => (i === committed.deploys.length - 1 ? { ...e, commit: sha(7) } : e)),
  })

  it("is a no-op on the committed ledger, so it is safe to run after any squash", () => {
    const { reseats, refusals } = findReseat(committed)
    expect(refusals).toEqual([])
    // Every entry is already an ancestor of HEAD, so there is nothing to move. On a
    // depth-1 clone nothing is an ancestor either — but then no candidate commit carries
    // the bytes, so the answer is "unexplained", never "silently rewrite".
    if (historyIsReachable(committed)) expect(reseats).toEqual([])
  })

  it("re-points a dangling entry at the commit carrying its own stored bytes", () => {
    const broken = withDanglingNewest()
    const newest = broken.deploys.length - 1

    // The fault is real on ANY clone: `sha(7)` is an unknown object everywhere, so
    // `validate` names it and the entry is what `--reseat` exists to repair.
    expect(validate(broken).join(" | ")).toMatch(/not an ancestor of HEAD/)

    const { reseats, refusals } = findReseat(broken)
    // Exhaustiveness, asserted at every depth: a dangling entry is either repaired or
    // explained. Silently dropping it is the one outcome that would make the command a
    // no-op on the fault it is named after.
    expect(reseats.length + refusals.length).toBe(1)

    // The rest needs the commits that touched the catalog, which a depth-1 clone lacks.
    // Gated on the COMMITTED ledger, never on `broken`: probing the ledger carrying the
    // injected sha measures the injection, not the clone depth, and would send a full
    // clone down the shallow branch.
    if (!historyIsReachable(committed)) return

    expect(refusals).toEqual([])
    expect(reseats).toHaveLength(1)
    expect(reseats[0]!.index).toBe(newest)
    expect(reseats[0]!.from).toBe(sha(7))
    // The recovered sha is asserted by its EFFECT, not by a literal: re-pointing there
    // makes the whole ledger validate again, git layer included.
    const repaired: DeployLedger = {
      ...broken,
      deploys: broken.deploys.map((e, i) => (i === newest ? { ...e, commit: reseats[0]!.to } : e)),
    }
    expect(validate(repaired)).toEqual([])
    // And it is the sha the committed ledger already had — the repair is a restoration.
    expect(reseats[0]!.to).toBe(committed.deploys[newest]!.commit)
  })

  it("REFUSES an entry whose stored document exists on no commit — that is not a squash", () => {
    const newest = committed.deploys.length - 1
    const orphan = committed.deploys[newest]!
    // A document nothing ever served, with its own correctly-computed digests: the
    // self-consistent forgery from the suite above, now wearing a dangling sha. The
    // finder must not "fix" it by attaching it to whatever commit is nearest.
    const fabricated = entryFor(
      { ...(orphan.document as PresentationContentV1), locale: "xx-NEVER-SERVED" },
      sha(7),
      orphan.at,
    )
    const broken: DeployLedger = {
      ...committed,
      deploys: [...committed.deploys.slice(0, newest), fabricated],
    }

    const { reseats, refusals } = findReseat(broken)
    // The load-bearing half, true at every clone depth: bytes nothing carries are never
    // reseated, and the entry is REPORTED rather than dropped.
    expect(reseats.some((r) => r.index === newest)).toBe(false)
    const forNewest = refusals.filter((r) => r.startsWith(`deploys[${newest}]`))
    expect(forNewest).toHaveLength(1)
    expect(forNewest[0]).toMatch(/matches NO commit on HEAD's history/)
    // The message must tell a human what to do instead of reseating, since the entry is
    // either a forgery or a lost commit and those want opposite responses.
    expect(forNewest[0]).toMatch(/Do not reseat it/)

    // On a full clone the OTHER nine entries are authentic, so this is the only refusal —
    // the finder does not tar a whole ledger with one bad entry. A depth-1 clone cannot
    // see that, and asserting it there would fail for want of history, not for a fault.
    if (historyIsReachable(committed)) {
      expect(refusals).toHaveLength(1)
      expect(reseats).toEqual([])
    }
  })

  it("skips entries that are already authentic, so a partial fault repairs one entry", () => {
    const broken = withDanglingNewest()
    // Gated on `committed`, not `broken` — see the note above: `broken` carries a
    // deliberately unknown sha, so probing it would report "shallow" on a full clone.
    if (!historyIsReachable(committed)) return
    const { reseats } = findReseat(broken)
    // Nine untouched entries stay untouched: `isAncestorOfHead` short-circuits before any
    // byte comparison, which is also what keeps the command cheap on a long ledger.
    expect(reseats.map((r) => r.index)).toEqual([broken.deploys.length - 1])
  })

  it("ignores a malformed commit rather than searching for it", () => {
    // A non-sha is a shape fault `faultsForEntry` already names. Reseating it would paper
    // over a hand-edit; the finder leaves it for the validator to report.
    const broken: DeployLedger = {
      ...committed,
      deploys: committed.deploys.map((e, i) => (i === 0 ? { ...e, commit: "c297708" } : e)),
    }
    const { reseats, refusals } = findReseat(broken)
    expect(reseats.some((r) => r.index === 0)).toBe(false)
    expect(refusals.some((r) => r.includes("deploys[0]"))).toBe(false)
    expect(faultsForEntry(broken.deploys[0]!, 0).join(" | ")).toMatch(/40-hex sha/)
  })
})

describe("entry shape", () => {
  it("requires a full 40-hex commit", () => {
    const e = entryFor(liveCatalog, "c297708", "2026-08-01T00:00:00.000Z")
    expect(faultsForEntry(e, 0).join(" | ")).toMatch(/40-hex sha/)
  })

  it("requires an ISO-8601 `at`", () => {
    const e = entryFor(liveCatalog, sha(1), "August 2026")
    expect(faultsForEntry(e, 0).join(" | ")).toMatch(/ISO-8601/)
  })
})
