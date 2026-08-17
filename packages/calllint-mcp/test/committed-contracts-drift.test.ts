/**
 * Anti-drift: the committed Agent-Adoption-Contracts bundled into the MCP server
 * (`src/data/adoption-contracts.json`) MUST stay byte-identical to the baked, served
 * `apps/web/public/install/<slug>/index.json` sidecars (ADR 0056 §7/§8). This is the
 * package-boundary form of the "a served route can never exist without a baked artifact"
 * invariant: the MCP may serve only contracts the site already publishes, verbatim.
 *
 * If the bake moves (a new resource, a re-observed verdict, a re-pinned version), this
 * fails until the bundle is regenerated — so the published server can never quietly serve
 * a stale or invented contract. Pure: reads committed files, no clock, no network.
 *
 * THE REMEDY IS `pnpm sync:mcp-bundle`, named in the failure messages below. It used to be
 * `scripts/regen-mcp-contracts.mjs`, which was never wired into `package.json` — so the documented
 * remedy was a file path a reader had to find, not a command. A guard whose remedy is undiscoverable
 * is satisfied by luck; the assertions now carry the command.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { COMMITTED_CONTRACTS } from "../src/committedContracts.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const INSTALL_ROOT = join(repoRoot, "apps", "web", "public", "install")

/** Recursively collect every baked contract sidecar (index.json) under the install root. */
function bakedSidecars(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...bakedSidecars(p))
    else if (e.name === "index.json") out.push(p)
  }
  return out
}

describe("committed adoption contracts — anti-drift vs the baked served sidecars", () => {
  const sidecars = bakedSidecars(INSTALL_ROOT)

  it("every baked sidecar is bundled verbatim under its canonicalSlug", () => {
    for (const file of sidecars) {
      const baked = JSON.parse(readFileSync(file, "utf8"))
      const slug = baked.subject.canonicalSlug as string
      expect(
        COMMITTED_CONTRACTS[slug],
        `no bundled contract for baked slug ${slug} — run \`pnpm sync:mcp-bundle\` and commit the result`,
      ).toBeDefined()
      expect(COMMITTED_CONTRACTS[slug], `bundled contract for ${slug} drifted from ${file}`).toEqual(
        baked,
      )
    }
  })

  it("bundles exactly the baked set — no extra, no missing contract", () => {
    const bakedSlugs = sidecars
      .map((f) => (JSON.parse(readFileSync(f, "utf8")).subject.canonicalSlug as string))
      .sort()
    expect(
      Object.keys(COMMITTED_CONTRACTS).sort(),
      "bundled contract set differs from the baked set — run `pnpm sync:mcp-bundle` and commit the result",
    ).toEqual(bakedSlugs)
  })

  it("keys equal each contract's own canonicalSlug (no key drift)", () => {
    for (const [slug, c] of Object.entries(COMMITTED_CONTRACTS)) {
      expect(c.subject.canonicalSlug).toBe(slug)
    }
  })
})
