/**
 * Drives the REAL `src/pages-entry.js` — the exact bytes copied into the deployment as
 * `_worker.js`. Not a re-implementation: a Pages entry can otherwise only be observed by
 * deploying it, and this one decides whether the private usage report is world-readable
 * (§29). The fault class this repo keeps hitting is a guard that cannot observe its
 * subject; importing the shipped file is how that is avoided here.
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import entry, { CANONICAL_HOST, redirectTarget } from "../src/pages-entry.js"

const ORIGIN = "calllint-usage-report.pages.dev"
const PREVIEW = "abc123.calllint-usage-report.pages.dev"

/** A stand-in asset server. `report` toggles whether /index.html exists. */
const envWith = (report: "present" | "absent" | "throws") => ({
  ASSETS: {
    fetch: async (r: Request | string) => {
      if (report === "throws") throw new Error("asset server unreachable")
      const url = new URL(typeof r === "string" ? r : r.url)
      if (url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nDisallow: /\n", { status: 200 })
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(report === "present" ? "<!doctype html>CLI package downloads" : "", {
          status: report === "present" ? 200 : 404,
        })
      }
      return new Response("", { status: 404 })
    },
  },
})

const get = (host: string, pathname = "/") =>
  new Request(`https://${host}${pathname}`, { method: "GET" })

describe("pages-entry: the canonical-host decision", () => {
  it("serves the canonical Access-protected host unchanged", async () => {
    const res = await entry.fetch(get(CANONICAL_HOST), envWith("present"))
    expect(res.status).toBe(200)
    // The whole point: behind Access, the report is served in full.
    expect(await res.text()).toContain("CLI package downloads")
  })

  it("U-1: the ungated pages.dev hostname serves NO report content", async () => {
    const res = await entry.fetch(get(ORIGIN), envWith("present"))
    expect(res.status).toBe(301)
    expect(res.headers.get("location")).toBe(`https://${CANONICAL_HOST}/`)
    // The measured defect was a 2666-byte body with all three row labels. Assert the
    // body is empty, not merely that one marker is missing — a partial leak is a leak.
    expect(await res.text()).toBe("")
  })

  it("preview hostnames are covered too, not just the production alias", async () => {
    // $DEPLOYMENT_URL is one of these. It serves the same deployment, so leaving the
    // `*.{project}.pages.dev` wildcard open would close U-1 only on paper.
    const res = await entry.fetch(get(PREVIEW, "/index.html"), envWith("present"))
    expect(res.status).toBe(301)
    expect(res.headers.get("location")).toBe(`https://${CANONICAL_HOST}/index.html`)
    expect(await res.text()).toBe("")
  })

  it("keeps robots.txt on the non-canonical host — the only Disallow it has left", async () => {
    // Redirecting this would send a crawler to a gated host and leave this hostname
    // with no Disallow at all; `x-robots-tag` is not sent on the production alias.
    const res = await entry.fetch(get(ORIGIN, "/robots.txt"), envWith("present"))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("Disallow: /")
  })

  it("the redirect reports whether a deployment is actually behind it", async () => {
    // Check 3 of the deploy probe reads this. A 301 alone proves only that code ran.
    const live = await entry.fetch(get(PREVIEW), envWith("present"))
    expect(live.headers.get("x-calllint-report")).toBe("present")

    const dead = await entry.fetch(get(PREVIEW), envWith("absent"))
    expect(dead.status).toBe(301)
    expect(dead.headers.get("x-calllint-report")).toBe("absent")
  })

  it("an asset-server fault reads absent, and never throws away the request", async () => {
    const res = await entry.fetch(get(PREVIEW), envWith("throws"))
    expect(res.status).toBe(301)
    expect(res.headers.get("x-calllint-report")).toBe("absent")
  })

  it("carries the crawler backstop the redirected page can no longer supply", async () => {
    const res = await entry.fetch(get(ORIGIN), envWith("present"))
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/)
  })
})

describe("pages-entry: the pure decision, and what actually ships", () => {
  it("redirectTarget exempts only the canonical host and robots.txt", () => {
    expect(redirectTarget(CANONICAL_HOST, "/")).toBeNull()
    expect(redirectTarget(CANONICAL_HOST, "/robots.txt")).toBeNull()
    expect(redirectTarget(ORIGIN, "/robots.txt")).toBeNull()
    expect(redirectTarget(ORIGIN, "/")).toEqual({ location: `https://${CANONICAL_HOST}/` })
    // A lookalike host must not be trusted by suffix.
    expect(redirectTarget("usage.calllint.com.evil.test", "/")).not.toBeNull()
  })

  it("the file is self-contained, so copying it into dist/usage cannot break it", () => {
    // It is deployed by byte-copy (no bundler — see the tsconfig `//js` note), so an
    // import of a sibling module would resolve at test time and 500 in production.
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "pages-entry.js"),
      "utf8",
    )
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).not.toMatch(/\brequire\s*\(/)
  })

  it("names the canonical host exactly once, so the two spellings cannot drift", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "pages-entry.js"),
      "utf8",
    )
    const assignments = src.match(/CANONICAL_HOST = "[^"]+"/g) ?? []
    expect(assignments).toEqual(['CANONICAL_HOST = "usage.calllint.com"'])
  })
})
