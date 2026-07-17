/**
 * I2c-2 acceptance tests — the claim overlay threaded through the bake (ADR 0048 §2).
 *
 * The load-bearing properties: (1) an EMPTY committed claim store bakes byte-identical
 * pages to no store at all — so the committed-tree reproducibility gate holds and no
 * unclaimed page ever shows a flag; (2) a real active record surfaces a
 * `verifiedPublisher` overlay on exactly that resource's sidecar; (3) the overlay is
 * NOT part of the page digest and never touches the HTML or the index (I2c-2 scope).
 */
import { describe, it, expect } from "vitest"
import { emitAllCohorts, type ClaimStore } from "../src/index.js"

// Pick a fixture that is always baked so we can assert the overlay lands on it.
const TARGET = "calllint-fixtures/safe-time"

const claimStore = (canonicalName: string): ClaimStore => ({
  schema: "calllint.claim-store.v0",
  records: [
    {
      schema: "calllint.claim.v0",
      canonicalName,
      owner: "octo-org",
      installationId: 7,
      artifactDigest: "sha256:deadbeef",
      scopeDigest: "sha256:cafef00d",
      verifiedAt: "2026-07-17T00:00:00.000Z",
      status: "active",
    },
  ],
})

const sidecarOf = (files: { path: string; content: string }[], name: string) =>
  files.find((f) => f.path === `${name}.json`)!.content

describe("bake claim overlay (fixtures cohort, no snapshot)", () => {
  it("empty store bakes byte-identical to no store (reproducibility gate holds)", () => {
    const none = emitAllCohorts(null)
    const empty = emitAllCohorts(null, { schema: "calllint.claim-store.v0", records: [] })
    expect(empty.files).toEqual(none.files)
  })

  it("no claim ⇒ no verifiedPublisher key in any sidecar (undefined dropped)", () => {
    const { files } = emitAllCohorts(null)
    const jsonFiles = files.filter((f) => f.path.endsWith(".json") && f.path !== "index.json")
    expect(jsonFiles.length).toBeGreaterThan(0)
    for (const f of jsonFiles) expect(f.content).not.toContain("verifiedPublisher")
  })

  it("an active record surfaces verifiedPublisher on exactly that sidecar", () => {
    const { files } = emitAllCohorts(null, claimStore(TARGET))
    const target = JSON.parse(sidecarOf(files, TARGET))
    expect(target.verifiedPublisher).toEqual({
      owner: "octo-org",
      verifiedAt: "2026-07-17T00:00:00.000Z",
      observedArtifactDigest: "sha256:deadbeef",
    })
  })

  it("the overlay does not change the page digest, the HTML, or the index", () => {
    const plain = emitAllCohorts(null)
    const claimed = emitAllCohorts(null, claimStore(TARGET))
    // pageDigest is inside the sidecar JSON — must match (overlay ≠ observation).
    const plainDigest = JSON.parse(sidecarOf(plain.files, TARGET)).pageDigest
    const claimedDigest = JSON.parse(sidecarOf(claimed.files, TARGET)).pageDigest
    expect(claimedDigest).toBe(plainDigest)
    // HTML byte-identical (badge rendering is I2c-3, not here).
    const html = (fs: { path: string; content: string }[]) =>
      fs.find((f) => f.path === `${TARGET}.html`)!.content
    expect(html(claimed.files)).toBe(html(plain.files))
    // index.json byte-identical (claim never appears in the index).
    const idx = (fs: { path: string; content: string }[]) =>
      fs.find((f) => f.path === "index.json")!.content
    expect(idx(claimed.files)).toBe(idx(plain.files))
  })

  it("a record for an absent namespace surfaces nothing (fails closed)", () => {
    const { files } = emitAllCohorts(null, claimStore("calllint-fixtures/does-not-exist"))
    const jsonFiles = files.filter((f) => f.path.endsWith(".json") && f.path !== "index.json")
    for (const f of jsonFiles) expect(f.content).not.toContain("verifiedPublisher")
  })
})
