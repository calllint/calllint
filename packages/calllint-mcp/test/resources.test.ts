/**
 * Tests for the MCP resources surface (ADR 0056 §8) — the committed adoption contracts
 * exposed under calllint://adoption/. Every read is verbatim from the bundle; nothing here
 * fetches, executes, or decides. Anti-drift vs the baked sidecars lives in a separate test.
 */
import { describe, it, expect } from "vitest"
import { RESOURCES, RESOURCE_TEMPLATES, readResource } from "../src/resources.js"
import { COMMITTED_CONTRACTS, COMMITTED_CONTRACT_SLUGS } from "../src/committedContracts.js"

const MIME = "application/vnd.calllint.agent-adoption+json;version=1"

describe("MCP resources — calllint://adoption/", () => {
  it("lists exactly one resource per committed contract, all under the adoption scheme", () => {
    expect(RESOURCES).toHaveLength(COMMITTED_CONTRACT_SLUGS.length)
    for (const r of RESOURCES) {
      expect(r.uri.startsWith("calllint://adoption/")).toBe(true)
      expect(r.mimeType).toBe(MIME)
      expect(r.description.length).toBeGreaterThan(10)
    }
  })

  it("advertises the parameterized slug template", () => {
    expect(RESOURCE_TEMPLATES.length).toBeGreaterThan(0)
    expect(RESOURCE_TEMPLATES[0]!.uriTemplate).toBe("calllint://adoption/{canonicalSlug}")
    expect(RESOURCE_TEMPLATES[0]!.mimeType).toBe(MIME)
  })

  it("reads a contract verbatim by its calllint://adoption/<slug> URI", () => {
    const slug = COMMITTED_CONTRACT_SLUGS[0]!
    const contents = readResource(`calllint://adoption/${slug}`)
    expect(contents).not.toBeNull()
    expect(contents![0]!.mimeType).toBe(MIME)
    expect(JSON.parse(contents![0]!.text)).toEqual(COMMITTED_CONTRACTS[slug]!)
  })

  it("reads a version-pinned URI when the version matches", () => {
    const slug = COMMITTED_CONTRACT_SLUGS[0]!
    const version = COMMITTED_CONTRACTS[slug]!.subject.version
    const contents = readResource(`calllint://adoption/${slug}@${version}`)
    expect(contents).not.toBeNull()
    expect(JSON.parse(contents![0]!.text)).toEqual(COMMITTED_CONTRACTS[slug]!)
  })

  it("fails closed on a version-pinned URI when the version does not match", () => {
    const slug = COMMITTED_CONTRACT_SLUGS[0]!
    expect(readResource(`calllint://adoption/${slug}@0.0.0-nope`)).toBeNull()
  })

  it("returns null (never throws) for an unknown slug or a foreign scheme", () => {
    expect(readResource("calllint://adoption/nope/does-not-exist")).toBeNull()
    expect(readResource("https://example.com/x")).toBeNull()
    expect(readResource("calllint://adoption/")).toBeNull()
    expect(readResource("")).toBeNull()
  })

  it("resource URIs round-trip through readResource for the whole bundle", () => {
    for (const r of RESOURCES) {
      const contents = readResource(r.uri)
      expect(contents, r.uri).not.toBeNull()
      const contract = JSON.parse(contents![0]!.text)
      expect(contract.subject.canonicalName).toBe(r.name)
    }
  })
})
