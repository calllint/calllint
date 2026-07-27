/**
 * Safe-install SHADOW-tree reproducibility gate + discovery-manifest acceptance
 * (Phase 2.4 Batch 2; ADR 0056 / new14-integration §6). Mirrors the committed-tree
 * gate: re-run the PURE `emitSafeInstall` over the SAME committed inputs and assert
 * every committed shadow file is byte-identical. If the renderer, a fixture, the
 * snapshot, or the engine version changes without a re-bake, this fails — the CI
 * `git diff --exit-code` guarantee expressed as a unit test.
 *
 * It also pins that Batch 2 stayed in its lane: the shadow tree lives under
 * artifacts/ and touches NOTHING under apps/web/public/trust (that tree's gate is
 * committed-tree.test.ts; here we assert the served tree carries no /install/**).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import {
  emitSafeInstall,
  parseSnapshot,
  parseEvidenceSnapshot,
  type RegistrySnapshot,
  type EvidenceSnapshot,
} from "../../src/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..", "..")
// Committed shadow output root (artifacts/, NOT apps/web/public).
const SHADOW = resolve(repoRoot, "artifacts", "phase-2.4", "shadow-install-pages")
const SNAPSHOT = resolve(here, "..", "..", "snapshots", "official-mcp-registry.json")
const EVIDENCE = resolve(here, "..", "..", "snapshots", "evidence-snapshot.json")
// The engine version is a deterministic bake input — read from the SAME package.json
// the bin (bakeInstall.ts) reads, so this gate and the bin can never disagree.
const ENGINE_VERSION = JSON.parse(readFileSync(resolve(here, "..", "..", "package.json"), "utf8")).version as string

const discoverySchema = JSON.parse(
  readFileSync(resolve(repoRoot, "schemas/calllint.discovery.v1.schema.json"), "utf8"),
)

const snapshot: RegistrySnapshot | null = existsSync(SNAPSHOT)
  ? parseSnapshot(readFileSync(SNAPSHOT, "utf8"))
  : null
const evidence: EvidenceSnapshot | null = existsSync(EVIDENCE)
  ? parseEvidenceSnapshot(readFileSync(EVIDENCE, "utf8"))
  : null
const files = emitSafeInstall(snapshot, evidence, ENGINE_VERSION)

describe("safe-install shadow tree matches a fresh emit (reproducibility gate)", () => {
  it("emits a manifest plus a page pair for every baked resource", () => {
    expect(files.some((f) => f.path === ".well-known/calllint.json")).toBe(true)
    const html = files.filter((f) => f.path.endsWith("/index.html")).length
    const json = files.filter((f) => f.path.endsWith("/index.json")).length
    expect(html).toBe(json)
    expect(html).toBeGreaterThanOrEqual(1)
  })

  it("re-emitting is byte-identical (pure, deterministic)", () => {
    const again = emitSafeInstall(snapshot, evidence, ENGINE_VERSION)
    expect(again).toEqual(files)
  })

  for (const f of files) {
    it(`committed shadow ${f.path} is byte-identical to a fresh emit`, () => {
      const abs = join(SHADOW, f.path)
      expect(
        existsSync(abs),
        `missing committed shadow artifact ${f.path} — run \`pnpm --filter @calllint/trust-index bake:install\``,
      ).toBe(true)
      expect(readFileSync(abs, "utf8")).toBe(f.content)
    })
  }
})

describe("Batch 2 stays in its lane — served Trust tree untouched", () => {
  it("emits no file outside install/** or .well-known/", () => {
    for (const f of files) {
      expect(
        f.path.startsWith("install/") || f.path === ".well-known/calllint.json",
        `unexpected shadow path ${f.path}`,
      ).toBe(true)
    }
  })

  it("does not write any /install/** into the served apps/web/public/trust tree", () => {
    const trust = resolve(repoRoot, "apps", "web", "public", "trust")
    if (!existsSync(trust)) return
    expect(readdirSync(trust).includes("install")).toBe(false)
  })
})

describe("discovery manifest — calllint.discovery.v1 acceptance", () => {
  const manifest = files.find((f) => f.path === ".well-known/calllint.json")!
  const doc = JSON.parse(manifest.content)

  it("validates against the committed schema", () => {
    const ok = new Ajv({ allErrors: true, strict: false }).compile(discoverySchema)(doc)
    expect(ok, JSON.stringify(new Ajv({ allErrors: true, strict: false }).errors)).toBe(true)
  })

  it("uses the canonical templates + media type (no draft drift)", () => {
    expect(doc.schema).toBe("calllint.discovery.v1")
    expect(doc.installUrlTemplate).toBe("/install/{canonicalSlug}/")
    expect(doc.contractUrlTemplate).toBe("/install/{canonicalSlug}/index.json")
    expect(doc.contractMediaType).toBe("application/vnd.calllint.agent-adoption+json;version=1")
    expect(doc.mcpResourceTemplate).toBe("calllint://adoption/{slug}[/{version}]")
  })

  it("advertises one entry per emitted page pair, sorted, non-drifting", () => {
    const slugs = files
      .filter((f) => f.path.endsWith("/index.html"))
      .map((f) => f.path.replace(/^install\//, "").replace(/\/index\.html$/, ""))
    const advertised = doc.resources.map((r: { canonicalSlug: string }) => r.canonicalSlug)
    expect(advertised).toEqual([...slugs].sort())
    for (const r of doc.resources) {
      expect(r.installUrl).toBe(`/install/${r.canonicalSlug}/`)
      expect(r.contractUrl).toBe(`/install/${r.canonicalSlug}/index.json`)
    }
  })

  it("carries no score / free-text / auto-install field (closed projection)", () => {
    expect(manifest.content).not.toContain("score")
    expect(manifest.content).not.toContain("autoInstall")
    expect(manifest.content).not.toContain("description")
  })
})
