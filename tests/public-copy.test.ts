import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const factsPath = path.join(repoRoot, "docs", "project-facts.json")
const facts = JSON.parse(fs.readFileSync(factsPath, "utf8")) as {
  corpus: { phase: string; calibratedCases: number; realOrRedactedSnapshots: number; unknownRatio: string }
  stableVersion: string
  forbiddenPhrases: string[]
  requiredPhrases: string[]
}

const publicFiles = [
  "apps/web/public/index.html",
  "apps/web/public/agents.html",
  "apps/web/public/mcp-security.html",
  "apps/web/public/cursor-mcp-security.html",
  "apps/web/public/claude-desktop-mcp-security.html",
  "apps/web/public/agent-tool-risk.html",
  "apps/web/public/agent-instructions.md",
  "apps/web/public/llms.txt",
  "apps/web/public/llms-full.txt",
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

  it("no public file uses stale `npx calllint@preview|@next scan` commands", () => {
    const offenders = files.filter((f) => /npx calllint@(preview|next) scan/i.test(f.text))
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  it("contains no stale status phrases (public preview / After 0.3.0 ships / 0.3.0-rc.0)", () => {
    const lc = allText.toLowerCase()
    const stale = ["public preview", "after 0.3.0 ships", "0.3.0-rc.0"]
    const found = stale.filter((p) => lc.includes(p.toLowerCase()))
    expect(found).toEqual([])
  })

  it("contains no stale \"release candidate\" current-status claims", () => {
    const patterns = [/pre-1\.0 release candidate/i, /\bis a release candidate\b/i, /\bcurrently.*release candidate\b/i]
    const offenders = files.filter((f) => patterns.some((re) => re.test(f.text)))
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  it("homepage hero headline is \"Before your agent acts, check the blast radius\"", () => {
    const site = files.find((f) => f.rel === "apps/web/public/index.html")
    expect(site).toBeTruthy()
    expect(site!.text).toContain("Before your agent acts, check the blast radius")
  })

  it("homepage corpus section states dangerous false-SAFE = 0", () => {
    const site = files.find((f) => f.rel === "apps/web/public/index.html")
    expect(site).toBeTruthy()
    expect(site!.text).toMatch(/dangerous false-SAFE\s*=\s*0/i)
  })

  it("agent-readable status files state the current stable version on latest", () => {
    const sv = facts.stableVersion
    expect(sv).toBeTruthy()
    const statusFiles = files.filter(
      (f) => f.rel === "apps/web/public/llms.txt" || f.rel === "apps/web/public/llms-full.txt",
    )
    expect(statusFiles.length).toBeGreaterThan(0)
    const re = new RegExp(`(?:is|Version)\\s*\`?${sv.replace(/\./g, "\\.")}\`?\\s+on\\s+the\\s\`?latest\``, "i")
    for (const f of statusFiles) {
      expect(f.text, `${f.rel} must state stable ${sv} on latest`).toMatch(re)
    }
  })
})
