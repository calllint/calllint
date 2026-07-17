import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
// Import the SERVED file directly: the bytes shipped from the CDN are the ones
// under test — no separate source, so there is nothing to drift.
import * as embed from "../public/embed/calllint-trust.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const jsPath = fileURLToPath(new URL("../public/embed/calllint-trust.js", import.meta.url))
const src = readFileSync(jsPath, "utf8")
const facts = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../project-facts.json", import.meta.url)), "utf8"),
)

describe("buildApiUrl", () => {
  it("builds a resources URL from {ns}/{name}", () => {
    expect(embed.buildApiUrl({ resource: "mcp-registry/ai.1325-mcp" })).toBe(
      "https://calllint.com/v1/public/resources/mcp-registry/ai.1325-mcp",
    )
  })
  it("prefers digest over resource and validates the digest shape", () => {
    const d = "sha256:" + "a".repeat(64)
    expect(embed.buildApiUrl({ digest: d, resource: "x/y" })).toBe(
      `https://calllint.com/v1/public/artifacts/${encodeURIComponent(d)}`,
    )
  })
  it("honours a base-origin override", () => {
    expect(embed.buildApiUrl({ origin: "https://staging.example.com/", resource: "a/b" })).toBe(
      "https://staging.example.com/v1/public/resources/a/b",
    )
  })
  it("returns null for a missing or malformed identifier", () => {
    expect(embed.buildApiUrl({})).toBeNull()
    expect(embed.buildApiUrl({ digest: "nope" })).toBeNull()
    expect(embed.buildApiUrl({ resource: "no-slash" })).toBeNull()
  })
})

describe("envelopeToView", () => {
  const base = {
    schema: embed.EMBED_SCHEMA,
    canonicalName: "mcp-registry/x",
    verdict: "REVIEW",
    verdictLabel: "Review required",
    observedAt: "2026-07-17T00:00:00.000Z",
    artifactDigest: "sha256:" + "b".repeat(64),
    trustPageUrl: "/trust/mcp-registry/x.html",
  }
  it("flattens fields and derives an absolute page URL + short date", () => {
    const v = embed.envelopeToView(base, "https://calllint.com")
    expect(v.verdict).toBe("REVIEW")
    expect(v.observed).toBe("2026-07-17")
    expect(v.pageUrl).toBe("https://calllint.com/trust/mcp-registry/x.html")
  })
  it("degrades an unknown verdict to UNKNOWN, never SAFE", () => {
    const v = embed.envelopeToView({ ...base, verdict: "WILD" }, "https://calllint.com")
    expect(v.verdict).toBe("UNKNOWN")
    expect(v.verdict).not.toBe("SAFE")
  })
})

describe("viewToHtml", () => {
  it("renders a fallback anchor carrying the boundary note + verdict data attr", () => {
    const v = embed.envelopeToView(
      { schema: embed.EMBED_SCHEMA, verdict: "BLOCK", verdictLabel: "Blocked by policy", trustPageUrl: "/trust/" },
      "https://calllint.com",
    )
    const html = embed.viewToHtml(v)
    expect(html).toContain('data-verdict="BLOCK"')
    expect(html).toContain(embed.BOUNDARY_NOTE)
    expect(html.startsWith("<a")).toBe(true)
  })
  it("escapes interpolated values", () => {
    expect(embed.esc('<img src=x onerror="1">')).not.toContain("<img")
  })
})

describe("served-file invariants", () => {
  it("only SAFE carries a green tone (mirrors the CLI badge red line)", () => {
    for (const [verdict, tone] of Object.entries(embed.VERDICT_TONE)) {
      const isGreen = embed.GREEN_TONES.includes(tone.fg)
      expect(isGreen, `${verdict} tone`).toBe(verdict === "SAFE")
    }
  })
  it("carries no forbidden overclaim phrase", () => {
    const lc = src.toLowerCase()
    for (const p of facts.forbiddenPhrases) expect(lc, p).not.toContain(p.toLowerCase())
    for (const p of facts.trustPageForbiddenPhrases) expect(lc, p).not.toContain(p.toLowerCase())
  })
  it("imports no scanner package (read-only consumer of the public API)", () => {
    const scanners = ["@calllint/core", "@calllint/static-analyzer", "@calllint/resolver", "@calllint/risk-engine", "@calllint/flow-analyzer", "@calllint/online", "@calllint/trust-index", "@calllint/partner-api"]
    for (const s of scanners) expect(src, s).not.toContain(s)
    expect(src).not.toMatch(/\bimport\s.+\sfrom\b/)
  })
  it("the example embed keeps a no-JS fallback link inside every widget", () => {
    const ex = readFileSync(fileURLToPath(new URL("../public/embed/example.html", import.meta.url)), "utf8")
    const tags = ex.match(/<calllint-trust[\s\S]*?<\/calllint-trust>/g) || []
    expect(tags.length).toBeGreaterThan(0)
    for (const t of tags) expect(t).toMatch(/<a\s[^>]*href=/)
  })
  void here
})
