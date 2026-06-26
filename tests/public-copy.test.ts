import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const factsPath = path.join(repoRoot, "docs", "project-facts.json")
const facts = JSON.parse(fs.readFileSync(factsPath, "utf8")) as {
  corpus: { phase: string; calibratedCases: number; realOrRedactedSnapshots: number; unknownRatio: string }
  forbiddenPhrases: string[]
  requiredPhrases: string[]
}

const publicFiles = [
  "apps/web/public/index.html",
  "apps/web/public/agent-instructions.md",
  "apps/web/public/llms.txt",
  "README.md",
]

const readPublic = () =>
  publicFiles
    .map((rel) => path.join(repoRoot, rel))
    .filter((p): p is string => fs.existsSync(p))
    .map((p: string) => ({ rel: path.relative(repoRoot, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8") }))

const files = readPublic()
const allText = files.map((f) => f.text).join("\n")

describe("public copy guard", () => {
  it("no public file uses `npx calllint@preview scan` as a primary path", () => {
    const offenders = files.filter((f) => /npx calllint@preview scan/i.test(f.text))
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  it("contains no forbidden overclaim phrases", () => {
    const lc = allText.toLowerCase()
    const found = facts.forbiddenPhrases.filter((p) => lc.includes(p.toLowerCase()))
    expect(found).toEqual([])
  })

  it("contains every required safety phrase at least once", () => {
    const lc = allText.toLowerCase()
    const missing = facts.requiredPhrases.filter((p) => !lc.includes(p.toLowerCase()))
    expect(missing).toEqual([])
  })

  it("shows SAFE near \"No blockers observed\" within 120 chars", () => {
    expect(allText).toMatch(/SAFE[\s\S]{0,120}No blockers observed/i)
  })

  it("keeps UNKNOWN near \"never\" or \"not\" SAFE within 160 chars", () => {
    expect(allText).toMatch(/UNKNOWN[\s\S]{0,160}(never|not)[\s\S]{0,20}SAFE/i)
  })

  it("website corpus numbers match project-facts.json", () => {
    const site = files.find((f) => f.rel === "apps/web/public/index.html")
    expect(site).toBeTruthy()
    const c = facts.corpus
    expect(site!.text).toContain(`${c.calibratedCases} calibrated cases`)
    expect(site!.text).toContain(`${c.realOrRedactedSnapshots} real or redacted snapshots`)
    expect(site!.text).toContain(`UNKNOWN ratio ${c.unknownRatio}`)
  })

  it("website corpus section reflects the current corpus phase", () => {
    const site = files.find((f) => f.rel === "apps/web/public/index.html")
    expect(site).toBeTruthy()
    expect(site!.text).toContain(`${facts.corpus.phase} · `)
  })
})
