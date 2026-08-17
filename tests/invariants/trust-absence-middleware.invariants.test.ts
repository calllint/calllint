/**
 * ADR 0085 D3 — the serving-plane behaviour, exercised without a deploy.
 *
 * WHY THIS FILE EXISTS. `apps/web/functions/**` is outside the root tsconfig's `include`, so the
 * Pages middleware gets no compile-time observation, and a Pages Function gets no runtime
 * observation short of a deploy. That combination is this project's dominant fault class: a guard
 * that cannot observe its subject. The handler is a plain exported async function over an injected
 * `ASSETS` binding, so it can be driven directly — and it is, here.
 *
 * The fake `ASSETS` below answers from the REAL committed tree. A stub that invented its own
 * inventory would let this file stay green while the served bytes said something else.
 */
import { describe, it, expect } from "vitest"
import { readFile, readdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { onRequest } from "../../apps/web/functions/trust/_middleware.js"

const here = dirname(fileURLToPath(import.meta.url))
const PUB = resolve(here, "..", "..", "apps", "web", "public")

/**
 * A stand-in for the platform's asset server, backed by the committed tree.
 *
 * It reproduces the two behaviours D3 depends on: a hit returns the file with its content-type,
 * and a miss returns the root `404.html` at status 404 (Pages resolves the nearest `404.html`,
 * and the root one is the only one in this project).
 */
async function assetsFetch(input: Request | string | URL): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "")
  const candidates = rel.endsWith("/") || rel === "" ? [rel + "index.html"] : [rel, rel + ".html"]
  for (const c of candidates) {
    try {
      const body = await readFile(resolve(PUB, c), "utf8")
      const type = c.endsWith(".json")
        ? "application/json"
        : c.endsWith(".xml")
          ? "application/xml"
          : "text/html; charset=utf-8"
      return new Response(body, { status: 200, headers: { "content-type": type } })
    } catch {
      /* try the next candidate */
    }
  }
  const notFound = await readFile(resolve(PUB, "404.html"), "utf8")
  return new Response(notFound, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } })
}

const env = { ASSETS: { fetch: assetsFetch } }
const nextUnreachable = () => {
  throw new Error("context.next() must not be called: its 404 fallthrough is undocumented")
}

function call(path: string, method = "GET") {
  return onRequest({
    request: new Request("https://calllint.com" + path, { method }),
    env,
    next: nextUnreachable as unknown as () => Promise<Response>,
  })
}

/** A real baked subject, discovered rather than hardcoded — names churn, the shape does not. */
async function aLiveSubject(): Promise<string> {
  const files = await readdir(resolve(PUB, "trust", "mcp-registry"))
  const json = files.find((f) => f.endsWith(".json") && !f.endsWith(".manifest.json"))
  if (!json) throw new Error("no baked .json under trust/mcp-registry")
  return json.replace(/\.json$/, "")
}

describe("trust middleware — a live subject is passed through untouched", () => {
  it("serves a baked .json as JSON at 200", async () => {
    const name = await aLiveSubject()
    const res = await call(`/trust/mcp-registry/${name}.json`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = JSON.parse(await res.text())
    expect(body).toBeTruthy()
  })

  it("serves a baked HTML page at 200", async () => {
    const name = await aLiveSubject()
    const res = await call(`/trust/mcp-registry/${name}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
  })

  it("passes through the index and sitemap the lookup page depends on", async () => {
    for (const p of ["/trust/index.json", "/trust/sitemap.xml", "/trust/lookup-index.json"]) {
      const res = await call(p)
      expect(res.status, p).toBe(200)
    }
  })
})

describe("trust middleware — ADR 0085 §5's three requests, re-measured", () => {
  it("an absent subject's .json answers 404 as a PARSEABLE document", async () => {
    const res = await call("/trust/mcp-registry/agency.goji-goji.json")
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = JSON.parse(await res.text())
    expect(body.schema).toBe("calllint.partner-api.error.v0")
    expect(body.code).toBe("not_found")
  })

  it("a never-existed .json answers the same way — a typo is not a special case", async () => {
    const res = await call("/trust/mcp-registry/zzz.never-existed.json")
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("application/json")
  })

  it("no longer answers 200 with marketing HTML — the defect §5 measured is closed", async () => {
    for (const p of [
      "/trust/mcp-registry/agency.goji-goji.json",
      "/trust/mcp-registry/zzz.never-existed.json",
    ]) {
      const res = await call(p)
      expect(res.status, p).not.toBe(200)
      const text = await res.text()
      // §5's body was the marketing homepage. Its hero copy must not appear here.
      expect(text).not.toContain("Scan MCP servers before your agent runs them")
    }
  })

  it("an absent EXTENSIONLESS path answers 404 with the committed 404.html", async () => {
    const res = await call("/trust/mcp-registry/zzz.never-existed")
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("text/html")
    expect(await res.text()).toContain("We publish no assessment at this address")
  })

  it("never answers 410 — permanence is a claim we have no evidence for (D3.4)", async () => {
    for (const p of [
      "/trust/mcp-registry/zzz.never-existed",
      "/trust/mcp-registry/zzz.never-existed.json",
    ]) {
      expect((await call(p)).status, p).not.toBe(410)
    }
  })
})

describe("trust middleware — construction", () => {
  it("answers HEAD for an absence with headers and no body", async () => {
    const res = await call("/trust/mcp-registry/zzz.never-existed.json", "HEAD")
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.text()).toBe("")
  })

  it("never relies on context.next() for a GET — its fallthrough is undocumented", async () => {
    // `nextUnreachable` throws. Reaching this assertion at all proves the GET path is built
    // entirely on the documented `ASSETS.fetch` contract.
    await expect(call("/trust/mcp-registry/zzz.never-existed.json")).resolves.toBeInstanceOf(Response)
    await expect(call("/trust/index.json")).resolves.toBeInstanceOf(Response)
  })

  it("hands a non-GET/HEAD method to the platform rather than inventing a verdict", async () => {
    await expect(call("/trust/mcp-registry/zzz.never-existed.json", "POST")).rejects.toThrow(
      /next\(\) must not be called/,
    )
  })

  it("caches an absence for at most a minute, so the next bake is not hidden behind a CDN", async () => {
    const res = await call("/trust/mcp-registry/zzz.never-existed.json")
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60")
  })

  it("asserts no departure cause in the JSON absence body", async () => {
    const body = (await (await call("/trust/mcp-registry/zzz.never-existed.json")).text()).toLowerCase()
    for (const forbidden of ["superseded", "de-listed", "delisted", "evicted", "withdrawn the", "revoked"]) {
      expect(body).not.toContain(forbidden)
    }
  })
})

describe("_routes.json — the middleware is actually reachable", () => {
  it("routes /trust/* to a Function, or D3.2 is dead code in production", async () => {
    const routes = JSON.parse(await readFile(resolve(PUB, "_routes.json"), "utf8"))
    expect(routes.include).toContain("/trust/*")
    // `exclude` beats `include`; a rule carving out .json paths would silently un-ship D3.2.
    for (const rule of routes.exclude as string[]) {
      expect(rule.endsWith(".json"), `exclude ${rule} would strip the JSON absence answer`).toBe(false)
    }
  })

  it("stays inside the platform's documented limits (100 rules, 100 chars each)", async () => {
    const routes = JSON.parse(await readFile(resolve(PUB, "_routes.json"), "utf8"))
    const all = [...routes.include, ...routes.exclude] as string[]
    expect(all.length).toBeLessThanOrEqual(100)
    for (const rule of all) expect(rule.length).toBeLessThanOrEqual(100)
  })

  it("keeps the existing API route claimed — D3 must not displace I2a", async () => {
    const routes = JSON.parse(await readFile(resolve(PUB, "_routes.json"), "utf8"))
    expect(routes.include).toContain("/v1/public/*")
  })
})
