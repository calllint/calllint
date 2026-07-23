/**
 * PR-D5 — the publish-channel GATE (ADR 0053 §4; new12 §2.6). The regression tripwire.
 *
 * This binds the classifier to the committed served tree + the Gate-B review store and
 * asserts the load-bearing publishing invariant:
 *
 *   A page may be SERVED publicly IFF it is AUTO_PUBLISH, OR it is a negative
 *   (REVIEW_HOLD / SECURITY_HOLD) that has passed Gate B — i.e. carries ≥2 distinct
 *   human sign-offs in the committed review store.
 *
 * It runs in the normal suite on all three OSes, so if a future registry refresh (or an
 * expansion candidate) bakes a NEW party-negative page about a real third party and it
 * is NOT dual-reviewed, this fails — the same "fail the PR before it can reach the
 * public" guarantee the committed-tree gate gives, applied to the §4 channel boundary.
 * The agent never signs a review here; it only reads the committed human sign-offs.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  bakeTrustPage,
  fixtureCohort,
  registryCohort,
  parseSnapshot,
  parseEvidenceSnapshot,
  evidenceMap,
  publishChannel,
  CALIBRATION_THRESHOLDS,
  type BakedTrustPage,
  type ReviewStore,
} from "../src/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = resolve(here, "..", "snapshots", "official-mcp-registry.json")
const EVIDENCE = resolve(here, "..", "snapshots", "evidence-snapshot.json")
const REVIEW_STORE = resolve(here, "..", "calibration", "review-store.json")

// Bake the full committed cohort EXACTLY as the bin/CI does: fixtures (local goldens,
// no evidence) + the registry snapshot refined by the committed evidence snapshot.
const fixtures: BakedTrustPage[] = fixtureCohort()
  .filter((e) => e.case.expect !== "parse-error")
  .map((e) => bakeTrustPage(e.input))
const evidence = existsSync(EVIDENCE)
  ? evidenceMap(parseEvidenceSnapshot(readFileSync(EVIDENCE, "utf8")))
  : new Map()
const registry: BakedTrustPage[] = existsSync(SNAPSHOT)
  ? registryCohort(parseSnapshot(readFileSync(SNAPSHOT, "utf8")))
      .filter((p) => p.input !== null)
      .map((p) => bakeTrustPage({ ...p.input!, evidence }))
  : []
const allPages = [...fixtures, ...registry]

// The committed human sign-offs (read, never written). A digest is "Gate-B passed"
// when it carries ≥ the required number of DISTINCT reviewers.
const store: ReviewStore = JSON.parse(readFileSync(REVIEW_STORE, "utf8")) as ReviewStore
const distinctReviewers = (digest: string) =>
  new Set((store.signoffs[digest] ?? []).map((s) => s.reviewer)).size
const gateBPassed = (page: BakedTrustPage) =>
  distinctReviewers(page.artifactDigest) >= CALIBRATION_THRESHOLDS.reviewersPerArtifact

describe("publish-channel gate — every served page is AUTO_PUBLISH or Gate-B signed", () => {
  it("baked a non-trivial cohort (fixtures + registry)", () => {
    expect(allPages.length).toBeGreaterThanOrEqual(20)
  })

  it("NO served page is a negative (REVIEW_HOLD/SECURITY_HOLD) without dual sign-off", () => {
    const unsignedNegatives = allPages
      .filter((p) => publishChannel(p) !== "AUTO_PUBLISH" && !gateBPassed(p))
      .map((p) => `${p.canonicalName} [${publishChannel(p)}]`)
    expect(
      unsignedNegatives,
      `these negative pages are served without Gate-B dual review: ${unsignedNegatives.join(", ")}`,
    ).toEqual([])
  })

  it("the ENTIRE real registry cohort is AUTO_PUBLISH (no party-negative third-party page today)", () => {
    // Real third-party pages must not carry a negative claim about a named party
    // without human review. Today every registry page is AUTO_PUBLISH (SAFE, or the
    // evidence-limitation supply.unknown-remote REVIEW). A future refresh that changes
    // this trips the assertion above (fail-closed) until a human signs off.
    for (const page of registry) expect(publishChannel(page)).toBe("AUTO_PUBLISH")
  })

  it("the non-AUTO_PUBLISH served pages are EXACTLY the Gate-B-signed set (no drift)", () => {
    // The set that NEEDS human review (§4) equals the set that HAS it — the calibration
    // store and the channel classifier are consistent by construction.
    const nonAuto = allPages.filter((p) => publishChannel(p) !== "AUTO_PUBLISH")
    for (const page of nonAuto) expect(gateBPassed(page)).toBe(true)
    // Count parity: exactly the committed signed digests, nothing more, nothing less.
    const signedDigests = new Set(
      Object.keys(store.signoffs).filter(
        (d) => new Set(store.signoffs[d]!.map((s) => s.reviewer)).size >= CALIBRATION_THRESHOLDS.reviewersPerArtifact,
      ),
    )
    const nonAutoDigests = new Set(nonAuto.map((p) => p.artifactDigest))
    expect(nonAutoDigests).toEqual(signedDigests)
  })
})
