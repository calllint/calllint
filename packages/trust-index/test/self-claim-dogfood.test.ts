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
 *      (installationId 147742681), asserted byte-equal to the COMMITTED SERVED page.
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
import { readFileSync } from "node:fs"
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

/** The three injected observation instants (ISO-8601 UTC). The ACTIVATE instant is the
 *  committed record's own `verifiedAt`, so the activate leg reproduces CallLint's real
 *  served overlay exactly; REVOKE/REACTIVATE are later so the re-stamp is visible. */
const TIMESTAMPS = {
  activate: "2026-07-22T02:24:28.289Z",
  revoke: "2026-07-23T00:00:00.000Z",
  reactivate: "2026-07-24T00:00:00.000Z",
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

  const life = reconcileSelfClaimLifecycle({ repoIndex, bakedDigests, timestamps: TIMESTAMPS })

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

  it("VERDICT and PAGE DIGEST are byte-identical across all three legs (a claim never moves a verdict)", () => {
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
  })

  it("the overlay is OBSERVABLE and toggles present → absent → present (so the immutability is non-vacuous)", () => {
    const a = bakeSelfPage(life.activate, snapshot, evidence)
    const r = bakeSelfPage(life.revoke, snapshot, evidence)
    const re = bakeSelfPage(life.reactivate, snapshot, evidence)

    // Active legs surface the publisher; the revoked leg drops it (fails closed).
    expect((a.overlay as { owner?: string } | undefined)?.owner).toBe(SELF_CLAIM.account)
    expect(r.overlay).toBeUndefined()
    expect((re.overlay as { owner?: string } | undefined)?.owner).toBe(SELF_CLAIM.account)

    // Strongest production tie: the ACTIVATE overlay byte-equals the committed served
    // page's own overlay (owner + verifiedAt + observedArtifactDigest). The served
    // overlay carries no scopeDigest, so this holds regardless of the real installation
    // scope — it depends only on the claimed coordinates, which are CallLint's real ones.
    const committed = JSON.parse(
      readFileSync(join(DEFAULT_OUT, `${SELF_CLAIM.canonicalName}.json`), "utf8"),
    ) as { verifiedPublisher?: unknown }
    expect(a.overlay).toEqual(committed.verifiedPublisher)
  })
})
