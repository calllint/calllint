import { it, expect } from "vitest"
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { refreshGateCensus } from "../../scripts/refresh-gate-census.js"
import { registryCanonicalName } from "../../packages/trust-index/src/snapshot.js"

it("refreshes real committed inputs idempotently, preserves history, and follows later growth", () => {
  const root = mkdtempSync(join(tmpdir(), "calllint-census-"))
  const paths = ["packages/trust-index/snapshots/official-mcp-registry.json", "apps/web/public/trust/index.json", "artifacts/gate-s1/open-items.md", "artifacts/gate-s2/open-items.md"]
  try {
    for (const p of paths) { mkdirSync(dirname(join(root, p)), { recursive: true }); copyFileSync(p, join(root, p)) }
    refreshGateCensus(root)
    const first = paths.slice(2).map((p) => readFileSync(join(root, p), "utf8"))
    refreshGateCensus(root)
    expect(paths.slice(2).map((p) => readFileSync(join(root, p), "utf8"))).toEqual(first)
    for (const n of [300, 500]) {
      const entries = Array.from({ length: n }, (_, i) => ({ name: `ai.test/server-${i}` }))
      writeFileSync(join(root, paths[0]!), JSON.stringify({ count: n, entries }))
      writeFileSync(join(root, paths[1]!), JSON.stringify({ entries: entries.map((e) => ({ canonicalName: registryCanonicalName(e.name) })) }))
      refreshGateCensus(root)
      const s1 = readFileSync(join(root, paths[2]!), "utf8")
      const s2 = readFileSync(join(root, paths[3]!), "utf8")
      expect(s1).toContain(`${n}/${n} source records reached`)
      expect(s1.split("<!-- generated-cohort-census:start -->")[0]).toBe(first[0]!.split("<!-- generated-cohort-census:start -->")[0])
      expect(s2).toContain(`**Cohort now:** **${n}**`)
      expect(s2).toContain(`**${500 - n} records before its threshold**`)
    }
    writeFileSync(join(root, paths[1]!), JSON.stringify({ entries: [] }))
    const before = readFileSync(join(root, paths[2]!), "utf8")
    expect(() => refreshGateCensus(root)).toThrow(/membership disagree/)
    expect(readFileSync(join(root, paths[2]!), "utf8")).toBe(before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
