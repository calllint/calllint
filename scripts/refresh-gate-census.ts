import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { registryCanonicalName } from "../packages/trust-index/src/snapshot.js"

const START = "<!-- generated-cohort-census:start -->"
const END = "<!-- generated-cohort-census:end -->"

/** Refresh current facts only. Dated measurements are historical evidence. */
export function refreshGateCensus(root: string): void {
  const read = (p: string) => readFileSync(resolve(root, p), "utf8")
  const snapshot = JSON.parse(read("packages/trust-index/snapshots/official-mcp-registry.json"))
  const index = JSON.parse(read("apps/web/public/trust/index.json"))
  const names = snapshot.entries.map((e: { name: string }) => registryCanonicalName(e.name))
  const served = index.entries.filter((e: { canonicalName: string }) => e.canonicalName.startsWith("mcp-registry/"))
  const actual = new Set(served.map((e: { canonicalName: string }) => e.canonicalName))
  if (snapshot.count !== names.length || new Set(names).size !== names.length ||
      served.length !== names.length || names.some((n: string) => !actual.has(n))) {
    throw new Error("Cannot publish census: snapshot and served registry membership disagree")
  }
  const n = names.length
  const paths = ["artifacts/gate-s1/open-items.md", "artifacts/gate-s2/open-items.md"]
  const updates = paths.map((p) => {
    let text = read(p)
    const start = text.indexOf(START)
    const end = text.indexOf(END)
    if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
      throw new Error(`Malformed generated census markers in ${p}`)
    }
    if (start !== -1) text = text.slice(0, start) + text.slice(end + END.length)
    // This one header was explicitly current even before generated sections existed.
    if (p.includes("gate-s2")) text = text.replace(/^\*\*Cohort now:\*\*.*\r?\n/m, "")
    const block = p.includes("gate-s1")
      ? `${n}/${n} source records reached the served tree.\n\nCohort census: source **${n} / 100 required**; served **${served.length} registry pages / ${n}\ncommitted**.`
      : `**Cohort now:** **${n}** — **${500 - n} records before its threshold**`
    return [p, `${text.trimEnd()}\n\n${START}\n## Current committed census (generated)\n\nDerived from the retained registry snapshot and served index; dated measurements above are preserved.\n\n${block}\n${END}\n`] as const
  })
  for (const [p, text] of updates) writeFileSync(resolve(root, p), text)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  refreshGateCensus(resolve(fileURLToPath(new URL("..", import.meta.url))))
}
