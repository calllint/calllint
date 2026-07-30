/**
 * `calllint://adoption/…` parser + dispatch, tested as a HOSTILE-input surface.
 *
 * The registered handler is reachable by any web page, so the load-bearing tests are
 * the negative ones: what a malicious link CANNOT cause. Each rejection asserts the
 * NAMED reason, not merely a falsy result — "it failed" is not evidence it failed for
 * the reason the security argument depends on.
 */
import { describe, it, expect } from "vitest"
import {
  parseAdoptionUri,
  buildAdoptionUri,
  ADOPTION_URI_SCHEME,
} from "../src/gateway/adoptionUri.js"
import { dispatchAdoptionUri, FORBIDDEN_ARGS } from "../src/gateway/adoptionUriDispatch.js"

const SLUG = "mcp-registry/ac.tandem-docs-mcp"
const A_DIGEST = `sha256:${"a".repeat(64)}`
const C_DIGEST = `sha256:${"b".repeat(64)}`

function parsed(uri: string) {
  const r = parseAdoptionUri(uri)
  if (!r.ok) throw new Error(`expected ok, got ${r.reason} (${r.detail})`)
  return r.request
}

function rejected(uri: string) {
  const r = parseAdoptionUri(uri)
  if (r.ok) throw new Error(`expected rejection, got ${JSON.stringify(r.request)}`)
  return r
}

describe("parseAdoptionUri — accepted shapes", () => {
  it("parses a bare slug with no version and no digests", () => {
    expect(parsed(`${ADOPTION_URI_SCHEME}${SLUG}`)).toEqual({
      canonicalSlug: SLUG,
      version: null,
      expectedArtifactDigest: null,
      expectedContractDigest: null,
    })
  })

  it("pins the version at the LAST @, matching the MCP resource grammar", () => {
    const r = parsed(`${ADOPTION_URI_SCHEME}${SLUG}@0.3.2`)
    expect(r.canonicalSlug).toBe(SLUG)
    expect(r.version).toBe("0.3.2")
  })

  it("carries both digests when asserted", () => {
    const r = parsed(`${ADOPTION_URI_SCHEME}${SLUG}@0.3.2?artifact=${A_DIGEST}&contract=${C_DIGEST}`)
    expect(r.expectedArtifactDigest).toBe(A_DIGEST)
    expect(r.expectedContractDigest).toBe(C_DIGEST)
  })

  it("round-trips through buildAdoptionUri", () => {
    const req = {
      canonicalSlug: SLUG,
      version: "0.3.2",
      expectedArtifactDigest: A_DIGEST,
      expectedContractDigest: C_DIGEST,
    }
    const uri = buildAdoptionUri(req)
    expect(uri).not.toBeNull()
    expect(parsed(uri!)).toEqual(req)
  })
})

describe("parseAdoptionUri — hostile input fails closed, by name", () => {
  it("refuses a foreign scheme", () => {
    expect(rejected("https://evil.example/x").reason).toBe("NOT_AN_ADOPTION_URI")
  })

  it("refuses the banned safe-install spelling (naming drift, new14 open risks)", () => {
    expect(rejected("calllint://safe-install/mcp-registry/x").reason).toBe("NOT_AN_ADOPTION_URI")
  })

  it("refuses an empty target", () => {
    expect(rejected(ADOPTION_URI_SCHEME).reason).toBe("EMPTY_TARGET")
  })

  it.each([
    ["path traversal", "../../etc/passwd"],
    ["percent-encoded traversal", "%2e%2e%2fetc"],
    ["absolute path", "/etc/passwd"],
    ["a space", "mcp-registry/a b"],
    ["shell metacharacters", "mcp-registry/x;rm -rf /"],
    ["a pipe", "mcp-registry/x|bash"],
    ["command substitution", "mcp-registry/$(whoami)"],
    ["a backtick", "mcp-registry/`id`"],
    ["a newline", "mcp-registry/x\ny"],
    ["a UNC path", "\\\\server\\share"],
  ])("refuses %s as a malformed slug", (_label, slug) => {
    expect(rejected(`${ADOPTION_URI_SCHEME}${slug}`).reason).toBe("MALFORMED_SLUG")
  })

  it("refuses a malformed version", () => {
    expect(rejected(`${ADOPTION_URI_SCHEME}${SLUG}@0.3.2;whoami`).reason).toBe("MALFORMED_VERSION")
  })

  it.each([
    ["wrong algorithm", "md5:abc"],
    ["short hex", "sha256:abc"],
    ["uppercase hex", `sha256:${"A".repeat(64)}`],
    ["no prefix", "a".repeat(64)],
  ])("refuses a malformed artifact digest (%s)", (_label, digest) => {
    expect(rejected(`${ADOPTION_URI_SCHEME}${SLUG}?artifact=${digest}`).reason).toBe(
      "MALFORMED_DIGEST",
    )
  })

  it("refuses an unknown query parameter rather than ignoring it", () => {
    const r = rejected(`${ADOPTION_URI_SCHEME}${SLUG}?apply=true`)
    expect(r.reason).toBe("UNKNOWN_QUERY_PARAM")
    expect(r.detail).toBe("apply")
  })

  it("refuses a duplicated parameter rather than picking a winner", () => {
    expect(
      rejected(`${ADOPTION_URI_SCHEME}${SLUG}?artifact=${A_DIGEST}&artifact=${C_DIGEST}`).reason,
    ).toBe("DUPLICATE_QUERY_PARAM")
  })

  it("strips a fragment before parsing, so # cannot smuggle a digest", () => {
    const r = parsed(`${ADOPTION_URI_SCHEME}${SLUG}@0.3.2#artifact=${A_DIGEST}`)
    expect(r.version).toBe("0.3.2")
    expect(r.expectedArtifactDigest).toBeNull()
  })

  it("buildAdoptionUri refuses to emit what the parser would refuse", () => {
    expect(
      buildAdoptionUri({
        canonicalSlug: "mcp-registry/x;rm -rf /",
        version: null,
        expectedArtifactDigest: null,
        expectedContractDigest: null,
      }),
    ).toBeNull()
  })
})

describe("dispatchAdoptionUri — the write path is unreachable", () => {
  const request = {
    canonicalSlug: SLUG,
    version: "0.3.2",
    expectedArtifactDigest: A_DIGEST,
    expectedContractDigest: C_DIGEST,
  }

  it("builds argv as an array, so there is no interpolation site", () => {
    const r = dispatchAdoptionUri(request, "/local/index.json", "cursor")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Array.isArray(r.dispatch.argv)).toBe(true)
    expect(r.dispatch.argv).toEqual([
      "safe-install",
      "--contract",
      "/local/index.json",
      "--host",
      "cursor",
      "--expect-artifact-digest",
      A_DIGEST,
      "--expect-contract-digest",
      C_DIGEST,
    ])
  })

  it("never produces a write flag", () => {
    const r = dispatchAdoptionUri(request, "/local/index.json", "cursor")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const forbidden of FORBIDDEN_ARGS) expect(r.dispatch.argv).not.toContain(forbidden)
  })

  it("fails closed if a caller-supplied value looks like a write flag", () => {
    const r = dispatchAdoptionUri(request, "--apply", "cursor")
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe("FORBIDDEN_ARG_PRODUCED")
    expect(r.detail).toBe("--apply")
  })

  it("omits the assertion flags when the URI pinned no digests", () => {
    const r = dispatchAdoptionUri(
      { canonicalSlug: SLUG, version: null, expectedArtifactDigest: null, expectedContractDigest: null },
      "/local/index.json",
      "cursor",
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dispatch.argv).toEqual(["safe-install", "--contract", "/local/index.json", "--host", "cursor"])
    expect(r.dispatch.digestAsserted).toBe(false)
  })
})
