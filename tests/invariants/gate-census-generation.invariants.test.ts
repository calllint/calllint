import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  assertServedMatchesSource,
  renderS1Census,
  renderS2Census,
  replaceGeneratedCensus,
  type GateCensus,
} from "../../scripts/lib/gate-census"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n")

const census: GateCensus = {
  sourceCount: 400,
  servedCount: 400,
  sourceNames: ["mcp-registry/a", "mcp-registry/b"],
  servedNames: ["mcp-registry/a", "mcp-registry/b"],
  requiredS1: 100,
  requiredS2: 500,
}

describe("generated Gate S1/S2 cohort census", () => {
  it("renders all current values from one census object", () => {
    expect(renderS1Census(census)).toContain("400/400 source records reached the served tree")
    expect(renderS1Census(census)).toContain("served **400 registry pages / 400\ncommitted**")
    expect(renderS2Census(census)).toContain("**Cohort now:** **400** — **100 records before its threshold**")
  })

  it("replaces exactly the generated block and preserves historical prose", () => {
    const source = [
      "historical measurement: 350/350",
      "",
      "<!-- generated-cohort-census:start -->",
      "old generated content",
      "<!-- generated-cohort-census:end -->",
      "",
      "later historical measurement: 350",
    ].join("\n")
    const updated = replaceGeneratedCensus(source, renderS1Census(census))
    expect(updated).toContain("historical measurement: 350/350")
    expect(updated).toContain("later historical measurement: 350")
    expect(updated).toContain("400/400 source records reached the served tree")
    expect(updated.match(/generated-cohort-census:start/g)).toHaveLength(1)
  })

  it("refuses mismatched, duplicate, or wrong identities", () => {
    expect(() => assertServedMatchesSource(["mcp-registry/a"], [])).toThrow(/refusing to write/)
    expect(() => assertServedMatchesSource(["mcp-registry/a"], ["mcp-registry/b"])).toThrow(/identities/)
    expect(() => assertServedMatchesSource(["mcp-registry/a"], ["mcp-registry/a", "mcp-registry/a"])).toThrow(/unique/)
    expect(() => assertServedMatchesSource(["mcp-registry/a"], ["mcp-registry/a"])).not.toThrow()
  })

  it("does not claim an unmet threshold or produce a negative remainder", () => {
    expect(renderS1Census({ ...census, sourceCount: 99, servedCount: 99 })).toContain("(not met)")
    expect(renderS2Census({ ...census, sourceCount: 600, servedCount: 600 })).toContain("threshold reached")
    expect(renderS2Census({ ...census, sourceCount: 600, servedCount: 600 })).not.toContain("-100")
  })

  it("keeps the committed documents tied to the writer's generated contract", () => {
    const s1 = read("artifacts/gate-s1/open-items.md")
    const s2 = read("artifacts/gate-s2/open-items.md")
    expect(s1).toMatch(/<!-- generated-cohort-census:start -->[\s\S]*<!-- generated-cohort-census:end -->/)
    expect(s2).toMatch(/<!-- generated-cohort-census:start -->[\s\S]*<!-- generated-cohort-census:end -->/)
    const workflow = read(".github/workflows/trust-ingest.yml")
    expect(workflow).toContain("pnpm gate:census:write")
    expect(workflow).toContain("pnpm eval:phase-2.4:gate")
    expect(read(".github/workflows/ci.yml")).toContain("run: pnpm gate:census")
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> }
    expect(packageJson.scripts["gate:census"]).toBe("tsx scripts/gate-census.ts --check")
    expect(packageJson.scripts["gate:census:write"]).toBe("tsx scripts/gate-census.ts --write")
  })
})
