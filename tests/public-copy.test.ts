import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const factsPath = path.join(repoRoot, "project-facts.json")
const facts = JSON.parse(fs.readFileSync(factsPath, "utf8")) as {
  corpus: { phase: string; status: string; calibratedCases: number; realOrRedactedSnapshots: number; unknownRatio: string }
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

  it("website corpus tag agrees with facts on shipped-vs-in-progress status", () => {
    // The corpus tag drifted to "R2.2 · in progress" while facts said the phase
    // was "shipped; expansion beyond 60 ongoing" — a status conflict, not just a
    // number. Bind the tag's shipped/in-progress word to facts so they can't
    // disagree again. facts.corpus.status begins with "shipped" today.
    const site = files.find((f) => f.rel === "apps/web/public/index.html")
    expect(site).toBeTruthy()
    const shippedInFacts = /^shipped/i.test(facts.corpus.status)
    if (shippedInFacts) {
      expect(site!.text, "corpus tag must say 'shipped' when facts.corpus.status is shipped").toMatch(
        new RegExp(`${facts.corpus.phase}\\s*·\\s*shipped`, "i"),
      )
      expect(site!.text, "corpus tag must not say 'in progress' when facts says shipped").not.toMatch(
        new RegExp(`${facts.corpus.phase}\\s*·\\s*in[ -]?progress`, "i"),
      )
    }
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

  it("README does not pin a hardcoded version line as the current stable release", () => {
    const readme = files.find((f) => f.rel === "README.md")
    expect(readme).toBeTruthy()
    expect(readme!.text).not.toMatch(/stable\s*`?\d+\.\d+\.x`?\s+line/i)
  })

  it("README status line states the current stable version (not a drifted one)", () => {
    // The README carries a free-text `Status: X.Y.Z stable CLI release` line that
    // the version guard above does NOT cover — it drifted to 1.0.0 while npm was
    // on 1.0.1 (the 1.0.1 release-prep PR bumped package.json/facts/llms but not
    // this prose line). This guard binds it to project-facts.stableVersion so any
    // future bump that forgets the README fails CI instead of shipping stale.
    const readme = files.find((f) => f.rel === "README.md")
    expect(readme).toBeTruthy()
    const sv = facts.stableVersion
    // Find any `Status: <semver> stable ... release` line and assert it is sv.
    const m = readme!.text.match(/Status:\s*(\d+\.\d+\.\d+(?:-[\w.]+)?)\s+stable[^\n]*release/i)
    expect(m, "README must have a `Status: <version> stable ... release` line").toBeTruthy()
    expect(m![1], `README status line states ${m![1]}, but project-facts.stableVersion is ${sv}`).toBe(sv)
  })

  it("homepage provenance copy does not imply the current release is a preview", () => {
    const site = files.find((f) => f.rel === "apps/web/public/index.html")
    expect(site).toBeTruthy()
    expect(site!.text).not.toMatch(/SLSA attestation\s+on\s+the\s+preview/i)
  })
})
