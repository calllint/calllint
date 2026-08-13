/**
 * Phase 2.5-A — self-claim production-dogfood proof (new13 §Phase-2.5-A; ADR 0055 §7).
 *
 * Proves the load-bearing invariant on CallLint's OWN namespace, in PRODUCTION
 * coordinates, across the FULL three-leg lifecycle ACTIVATE → REVOKE → REACTIVATE:
 * a maintainer claim states namespace CONTROL, never safety — it may appear, be
 * revoked, and reappear WITHOUT ever moving the observed verdict or the page digest
 * (ADR 0047 §1 / 0053 §3).
 *
 * This is DELIBERATELY not a re-proof of `bake-claim.test.ts`. That test proves the
 * overlay↛pageDigest property for a SYNTHETIC fixture (`calllint-fixtures/safe-time`,
 * owner `octo-org`) across TWO states (active vs. empty). This test raises the bar on
 * three axes shipped code did not yet cover:
 *   1. PRODUCTION coordinates — CallLint's real record `mcp-registry/io.github.calllint-calllint`
 *      (installationId 148693982, the reactivate-leg grant; 147742681 is the revoked audit
 *      record), asserted byte-equal to the COMMITTED SERVED page.
 *   2. the FULL three-leg lifecycle, driven through the SHIPPED `reconcileClaims` core
 *      (activate → revoke → reactivate), not a single toggle.
 *   3. an OBSERVABLE overlay (present → absent → present) so the digest-immutability is
 *      non-vacuous: the claim provably DOES something, yet the verdict never moves.
 *
 * Everything here is PURE over committed inputs (snapshot + evidence + baked digests);
 * no clock, no network. The three real-world legs are driven by a HUMAN GitHub-UI App
 * uninstall/re-install (the one action the ingestion plane cannot self-trigger); this
 * test models the reconciliation deterministically so the property is machine-provable
 * OFFLINE around that human action. The human ledger lives in
 * `artifacts/phase-2.5-self-claim/`.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { emitAllCohorts } from "../src/emitCohort.js"
import {
  DEFAULT_OUT,
  loadSnapshotIfPresent,
  loadEvidenceSnapshotIfPresent,
} from "../src/bake.js"
import { registryRepoIndex } from "../src/reconcileClaims.js"
import { EMPTY_CLAIM_STORE, type ClaimStore } from "../src/claim.js"
import {
  reconcileSelfClaimLifecycle,
  activeSelfClaimCount,
  SELF_CLAIM,
} from "../src/selfClaimDogfood.js"

/** The three injected observation instants (ISO-8601 UTC) — the REAL production instants
 *  recorded in `artifacts/phase-2.5-self-claim/ledger.json`, now that the live lifecycle has
 *  completed 3/3. The REACTIVATE instant is the committed served record's own `verifiedAt`,
 *  so the reactivate leg reproduces CallLint's CURRENT real served overlay exactly; ACTIVATE
 *  and REVOKE are the earlier real instants (REVOKE = the revoked audit record's `verifiedAt`). */
const TIMESTAMPS = {
  activate: "2026-07-22T02:24:28.289Z",
  revoke: "2026-07-24T08:45:34.399Z",
  reactivate: "2026-07-24T09:44:55.534Z",
} as const

/** The subset of an `index.json` entry this proof reads. */
interface IndexEntry {
  canonicalName: string
  status: string
  verdict: string | null
  pageDigest: string | null
  artifactDigest: string | null
}

/** Bake every cohort with `store` and pull CallLint's own page: its index entry (verdict
 *  + pageDigest — both overlay-INDEPENDENT) and its sidecar overlay (which DOES toggle). */
function bakeSelfPage(
  store: ClaimStore,
  snapshot: ReturnType<typeof loadSnapshotIfPresent>,
  evidence: ReturnType<typeof loadEvidenceSnapshotIfPresent>,
): { verdict: string | null; pageDigest: string | null; overlay: unknown } {
  const { files } = emitAllCohorts(snapshot, store, evidence)
  const index = JSON.parse(
    files.find((f) => f.path === "index.json")!.content,
  ) as { entries: IndexEntry[] }
  const entry = index.entries.find((e) => e.canonicalName === SELF_CLAIM.canonicalName)
  if (!entry) throw new Error(`self page ${SELF_CLAIM.canonicalName} not baked`)
  const sidecar = JSON.parse(
    files.find((f) => f.path === `${SELF_CLAIM.canonicalName}.json`)!.content,
  ) as { verifiedPublisher?: unknown }
  return { verdict: entry.verdict, pageDigest: entry.pageDigest, overlay: sidecar.verifiedPublisher }
}

describe("Phase 2.5-A — self-claim production dogfood (activate → revoke → reactivate)", () => {
  const snapshot = loadSnapshotIfPresent()
  const evidence = loadEvidenceSnapshotIfPresent()

  it("has a committed snapshot to claim against (else the whole dogfood is moot)", () => {
    // The loop can only close on CallLint's own namespace if that page exists to claim.
    expect(snapshot, "committed registry snapshot must be present").not.toBeNull()
    expect(registryRepoIndex(snapshot!).size).toBeGreaterThan(0)
  })

  /**
   * Is CallLint's own name in the committed upstream snapshot?
   *
   * Two of the three proofs below need it and one does NOT, and that split is the whole
   * point of this block. The lifecycle proof (1 active → 0 → 1) is PURE over two Maps the
   * caller supplies — `repoIndex` and `bakedDigests` — so it is provable against a SYNTHETIC
   * one-entry snapshot fed through the SHIPPED `registryRepoIndex`, with no dependency on
   * what upstream published. Only the two proofs that byte-compare against the COMMITTED
   * SERVED page need the real corpus, because that page is what they read.
   *
   * The earlier form of this block skipped ALL THREE on absence with a single `it.skip`, so
   * when upstream dropped `io.github.calllint/calllint` the suite went green by switching off
   * every check that could have observed the loss — including the lifecycle property, which
   * never needed the corpus at all. A guard that disarms itself on the condition it exists to
   * report is not a guard. So: the lifecycle proof always runs, and the corpus-gated pair
   * ASSERTS the shape of the absence (name absent, page absent, no orphan served bytes)
   * instead of asserting nothing.
   */
  const CLAIMED_NAME = "io.github.calllint/calllint"
  const claimedInSnapshot = snapshot?.entries.some((e) => e.name === CLAIMED_NAME) ?? false

  // Reference bake with the EMPTY store gives the overlay-independent baked digests the
  // reconciler needs (a claim is only minted for a page that is actually baked).
  const refBake = emitAllCohorts(snapshot, EMPTY_CLAIM_STORE, evidence)
  const refIndex = JSON.parse(
    refBake.files.find((f) => f.path === "index.json")!.content,
  ) as { entries: IndexEntry[] }
  const bakedDigests = new Map<string, `sha256:${string}`>(
    refIndex.entries
      .filter((e) => e.status === "baked" && e.artifactDigest)
      .map((e) => [e.canonicalName, e.artifactDigest as `sha256:${string}`]),
  )
  const repoIndex = registryRepoIndex(snapshot!)

  /**
   * The lifecycle inputs, built so the proof holds whether or not upstream carries our name.
   *
   * When the real corpus has it, these ARE the real corpus values — identical to what the
   * previous form used. When it does not, the two Maps are synthesized through the SHIPPED
   * `registryRepoIndex` over a one-entry snapshot bearing CallLint's real coordinates, plus a
   * baked-digest entry for the same canonical name. Both are the reconciler's ONLY inputs
   * besides the injected instants, and it reads them purely, so a synthetic corpus exercises
   * the same code path — what it cannot prove is the served-page comparison, which is exactly
   * why the two tests that DO compare served bytes stay gated below.
   *
   * The digest is a fixed, obviously-synthetic literal: `reconcileClaims` only requires that a
   * digest EXIST for the name (an unbaked page mints no claim) and records it as observed; no
   * assertion here reads its value. A real-looking hash would invite the misreading that this
   * is a served digest.
   */
  const SYNTHETIC_DIGEST = `sha256:${"0".repeat(64)}` as const
  const lifecycleRepoIndex = claimedInSnapshot
    ? repoIndex
    : registryRepoIndex({
        schema: "calllint.trust-snapshot.v0",
        source: "official-mcp-registry",
        endpoint: "synthetic://self-claim-lifecycle",
        fetchedAt: TIMESTAMPS.activate,
        count: 1,
        entries: [
          {
            name: CLAIMED_NAME,
            description: "synthetic lifecycle input — not a served entry",
            version: "0.0.0",
            repositoryUrl: `https://github.com/${SELF_CLAIM.repo.owner}/${SELF_CLAIM.repo.name}`,
            packages: [],
            remotes: [],
            status: "active",
            publishedAt: TIMESTAMPS.activate,
          },
        ],
      })
  const lifecycleBakedDigests = claimedInSnapshot
    ? bakedDigests
    : new Map<string, `sha256:${string}`>([[SELF_CLAIM.canonicalName, SYNTHETIC_DIGEST]])

  const life = reconcileSelfClaimLifecycle({
    repoIndex: lifecycleRepoIndex,
    bakedDigests: lifecycleBakedDigests,
    timestamps: TIMESTAMPS,
  })

  it("the lifecycle inputs resolve CallLint's real coordinates to its real canonical name", () => {
    // Guards the synthetic branch against proving the lifecycle over inputs that miss the
    // subject entirely: `reconcileClaims` mints nothing for a name it cannot resolve or that
    // has no baked digest, so 1 → 0 → 1 would collapse to 0 → 0 → 0 and every count below
    // would still need to be asserted against SOMETHING. Pin the resolution first.
    const key = `${SELF_CLAIM.repo.owner}/${SELF_CLAIM.repo.name}`.toLowerCase()
    expect(
      lifecycleRepoIndex.get(key),
      "the repo grant must resolve to the canonical name the claim is minted under",
    ).toBe(SELF_CLAIM.canonicalName)
    expect(
      lifecycleBakedDigests.has(SELF_CLAIM.canonicalName),
      "an unbaked page mints no claim, so the digest must be present for the lifecycle to be non-vacuous",
    ).toBe(true)
  })

  it("drives the store through the exact reconcile lifecycle: 1 active → 0 active → 1 active", () => {
    // activate: minted fresh (empty → observed). revoke: flipped (not observed).
    // reactivate: fresh active minted, prior revoked kept as an audit trail.
    expect(activeSelfClaimCount(life.activate)).toBe(1)
    expect(activeSelfClaimCount(life.revoke)).toBe(0)
    expect(activeSelfClaimCount(life.reactivate)).toBe(1)

    expect(life.activate.records).toHaveLength(1)
    expect(life.revoke.records).toHaveLength(1) // the same record, now revoked
    expect(life.revoke.records[0]!.status).toBe("revoked")
    expect(life.reactivate.records).toHaveLength(2) // 1 fresh active + 1 revoked audit trail
    expect(life.reactivate.records.filter((r) => r.status === "revoked")).toHaveLength(1)
  })

  it("the served-page proofs' precondition is measured, and its absence is a stated shape", () => {
    // The two tests after this one read `apps/web/public/trust/<self>.json`. This one records
    // WHY they can or cannot, so the reason is asserted rather than assumed. On absence it
    // pins all three halves of the expected shape — name absent upstream, page absent from
    // the served index, no orphan sidecar — so a page that reappears WITHOUT the upstream
    // name (a projection bug, i.e. bytes we serve for a subject the registry never listed)
    // reds here instead of being skipped past.
    const sidecar = join(DEFAULT_OUT, `${SELF_CLAIM.canonicalName}.json`)
    if (claimedInSnapshot) {
      expect(existsSync(sidecar), "upstream carries the name, so the served page must exist").toBe(true)
      return
    }
    expect(
      snapshot!.entries.some((e) => e.name === CLAIMED_NAME),
      "precondition: the committed snapshot does not carry CallLint's own name",
    ).toBe(false)
    const servedIndex = JSON.parse(readFileSync(join(DEFAULT_OUT, "index.json"), "utf8")) as {
      entries: { canonicalName: string }[]
    }
    expect(
      servedIndex.entries.some((e) => e.canonicalName === SELF_CLAIM.canonicalName),
      "and nothing may serve a page for a subject absent from the snapshot it is projected from",
    ).toBe(false)
    expect(existsSync(sidecar), "nor may an orphan sidecar survive the subject's removal").toBe(false)
  })

  it.skipIf(!claimedInSnapshot)(
    "VERDICT and PAGE DIGEST are byte-identical across all three legs (a claim never moves a verdict)",
    () => {
    const a = bakeSelfPage(life.activate, snapshot, evidence)
    const r = bakeSelfPage(life.revoke, snapshot, evidence)
    const re = bakeSelfPage(life.reactivate, snapshot, evidence)

    // The load-bearing property (ADR 0047 §1 / 0053 §3): identical across the full lifecycle.
    expect(r.verdict).toBe(a.verdict)
    expect(re.verdict).toBe(a.verdict)
    expect(r.pageDigest).toBe(a.pageDigest)
    expect(re.pageDigest).toBe(a.pageDigest)

    // Production specificity: that invariant digest is the ACTUAL committed served page,
    // not a synthetic fixture. Read the committed sidecar as the single source of truth
    // (never a hard-coded hex — the committed tree is the reference).
    const committed = JSON.parse(
      readFileSync(join(DEFAULT_OUT, `${SELF_CLAIM.canonicalName}.json`), "utf8"),
    ) as { verdict: string; pageDigest: string }
    expect(a.pageDigest).toBe(committed.pageDigest)
    expect(a.verdict).toBe(committed.verdict)
  },
  )

  it.skipIf(!claimedInSnapshot)(
    "the overlay is OBSERVABLE and toggles present → absent → present (so the immutability is non-vacuous)",
    () => {
    const a = bakeSelfPage(life.activate, snapshot, evidence)
    const r = bakeSelfPage(life.revoke, snapshot, evidence)
    const re = bakeSelfPage(life.reactivate, snapshot, evidence)

    // Active legs surface the publisher; the revoked leg drops it (fails closed).
    expect((a.overlay as { owner?: string } | undefined)?.owner).toBe(SELF_CLAIM.account)
    expect(r.overlay).toBeUndefined()
    expect((re.overlay as { owner?: string } | undefined)?.owner).toBe(SELF_CLAIM.account)

    // Strongest production tie: the REACTIVATE overlay byte-equals the committed served
    // page's own overlay (owner + verifiedAt + observedArtifactDigest). The committed page
    // is now the REACTIVATED page (the live lifecycle completed 3/3), so the current served
    // overlay carries the reactivate-leg `verifiedAt`. The served overlay carries no
    // scopeDigest, so this holds regardless of the real installation scope — it depends only
    // on the claimed coordinates, which are CallLint's real ones.
    const committed = JSON.parse(
      readFileSync(join(DEFAULT_OUT, `${SELF_CLAIM.canonicalName}.json`), "utf8"),
    ) as { verifiedPublisher?: unknown }
    expect(re.overlay).toEqual(committed.verifiedPublisher)
  },
  )
})
