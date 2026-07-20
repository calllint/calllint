/**
 * new11 PR-03 — registry-manifest schema validation (compatibility + malformed).
 * Required by new11 §13: every new schema has compatibility and malformed tests.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, it, expect } from "vitest"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas/registry-listing.schema.json"), "utf8"))
const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "distribution/registries/registry-manifest.json"), "utf8"),
)

const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile(schema)

describe("registry-manifest schema", () => {
  it("the committed manifest validates against the schema", () => {
    const ok = validate(manifest)
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })

  it("rejects a wrong schema tag", () => {
    expect(validate({ ...manifest, schema: "wrong.v0" })).toBe(false)
  })

  it("rejects a platform missing required fields", () => {
    const bad = { ...manifest, platforms: [{ id: "x" }] }
    expect(validate(bad)).toBe(false)
  })

  it("rejects an unknown top-level property (additionalProperties:false)", () => {
    expect(validate({ ...manifest, sneaky: true })).toBe(false)
  })

  it("rejects an invalid ownershipMethod enum", () => {
    const bad = {
      ...manifest,
      platforms: [{ ...manifest.platforms[0], ownershipMethod: "carrier-pigeon" }],
    }
    expect(validate(bad)).toBe(false)
  })

  it("every automatable platform declares a readbackUrl", () => {
    for (const p of manifest.platforms) {
      if (p.supportsAutomatedReadback) expect(p.readbackUrl && p.readbackUrl.length > 0).toBe(true)
    }
  })

  // --- new11 §3.2 coverage contract (Wave 4) ------------------------------
  // §3.2 (docs/new11.md:1145) requires the manifest to cover AT LEAST npm,
  // GitHub Marketplace, official MCP Registry, Forge, PulseMCP, mcpservers.org.

  it("covers every platform new11 §3.2 requires", () => {
    const ids = new Set()
    for (const p of manifest.platforms) ids.add(p.id)
    // npm and the official MCP Registry are present under these ids; the four
    // directory listings were added in Wave 4.
    for (const required of [
      "npm",
      "mcp-registry",
      "github-marketplace",
      "forge",
      "pulsemcp",
      "mcpservers-org",
    ]) {
      expect(ids.has(required)).toBe(true)
    }
  })

  it("a manual platform is never silently marked automatable (no false-clean surface)", () => {
    for (const p of manifest.platforms) {
      if (p.manualActionRequired === true) {
        expect(p.supportsAutomatedReadback).toBe(false)
        // A manual listing has no anonymous read-back endpoint, so it carries none.
        expect(p.readbackUrl ?? "").toBe("")
      }
    }
  })
})
