/**
 * Safe-install SERVED-tree reproducibility gate + discovery-manifest acceptance
 * (Phase 2.4 Batch 3; ADR 0056). The successor to the Batch-2 shadow-tree gate: the
 * acquisition surface is now PROMOTED into the served site root (`apps/web/public/`),
 * so this re-runs the PURE `emitAllCohorts` over the SAME committed inputs the bin
 * bakes from and asserts every emitted `installFiles` entry is byte-identical to the
 * committed served bytes under `apps/web/public/`. If the renderer, a fixture, the
 * snapshot, or the engine version changes without a re-bake, this fails — the CI
 * `git diff --exit-code` guarantee expressed as a unit test, on all three OSes.
 *
 * The engine version is a deterministic bake input: read from the SAME package.json
 * `bake.ts` reads (via the emit's 5th arg), so this gate and the bin can never disagree.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import {
  emitAllCohorts,
  parseSnapshot,
  parseClaimStore,
  parseEvidenceSnapshot,
  EMPTY_CLAIM_STORE,
  type RegistrySnapshot,
  type EvidenceSnapshot,
} from "../../src/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, "..", "..")
const repoRoot = resolve(pkgRoot, "..", "..")
// Served + committed SITE root: repo-root/apps/web/public (install/** + .well-known live here).
const PUBLIC = resolve(repoRoot, "apps", "web", "public")
const SNAPSHOT = resolve(pkgRoot, "snapshots", "official-mcp-registry.json")
const CLAIMS = resolve(pkgRoot, "claims", "claim-store.json")
const EVIDENCE = resolve(pkgRoot, "snapshots", "evidence-snapshot.json")
// The engine version stamped into the contract bytes — the SAME source the bin reads.
const ENGINE_VERSION = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"))
  .version as string
const discoverySchema = JSON.parse(
  readFileSync(resolve(repoRoot, "schemas/calllint.discovery.v1.schema.json"), "utf8"),
)

const snapshot: RegistrySnapshot | null = existsSync(SNAPSHOT)
  ? parseSnapshot(readFileSync(SNAPSHOT, "utf8"))
  : null
const claims = existsSync(CLAIMS) ? parseClaimStore(readFileSync(CLAIMS, "utf8")) : EMPTY_CLAIM_STORE
const evidence: EvidenceSnapshot | null = existsSync(EVIDENCE)
  ? parseEvidenceSnapshot(readFileSync(EVIDENCE, "utf8"))
  : null
const { installFiles } = emitAllCohorts(snapshot, claims, evidence, [], ENGINE_VERSION)

describe("committed served Safe-install tree matches a fresh emit (reproducibility gate)", () => {
  it("emits a manifest plus a page pair for every acquisition resource", () => {
    expect(installFiles.some((f) => f.path === ".well-known/calllint.json")).toBe(true)
    const html = installFiles.filter((f) => f.path.endsWith("/index.html")).length
    const json = installFiles.filter((f) => f.path.endsWith("/index.json")).length
    expect(html).toBe(json)
    expect(html).toBeGreaterThanOrEqual(1)
  })

  it("re-emitting is byte-identical (pure, deterministic)", () => {
    const again = emitAllCohorts(snapshot, claims, evidence, [], ENGINE_VERSION).installFiles
    expect(again).toEqual(installFiles)
  })

  it("emits nothing outside install/** or .well-known/calllint.json", () => {
    for (const f of installFiles) {
      expect(
        f.path.startsWith("install/") || f.path === ".well-known/calllint.json",
        `unexpected install path ${f.path}`,
      ).toBe(true)
    }
  })

  for (const f of installFiles) {
    it(`committed ${f.path} is byte-identical to a fresh bake`, () => {
      const abs = join(PUBLIC, f.path)
      expect(
        existsSync(abs),
        `missing committed artifact ${f.path} — run \`pnpm --filter @calllint/trust-index bake\``,
      ).toBe(true)
      expect(
        readFileSync(abs, "utf8"),
        `${f.path} is stale — re-run the bake and commit the result`,
      ).toBe(f.content)
    })
  }
})

describe("discovery manifest — calllint.discovery.v1 acceptance", () => {
  const manifest = installFiles.find((f) => f.path === ".well-known/calllint.json")!
  const doc = JSON.parse(manifest.content)

  it("validates against the committed schema", () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const ok = ajv.compile(discoverySchema)(doc)
    expect(ok, JSON.stringify(ajv.errors)).toBe(true)
  })

  it("uses the canonical templates + media type (no draft drift)", () => {
    expect(doc.schema).toBe("calllint.discovery.v1")
    expect(doc.installUrlTemplate).toBe("/install/{canonicalSlug}/")
    expect(doc.contractUrlTemplate).toBe("/install/{canonicalSlug}/index.json")
    expect(doc.contractMediaType).toBe("application/vnd.calllint.agent-adoption+json;version=1")
    expect(doc.mcpResourceTemplate).toBe("calllint://adoption/{slug}[/{version}]")
  })

  it("advertises one entry per emitted page pair, sorted, non-drifting", () => {
    const slugs = installFiles
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
