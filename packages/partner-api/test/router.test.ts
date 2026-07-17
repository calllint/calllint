import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { handleApiRequest, isDigest, type AssetReader } from "../src/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const PUB = resolve(here, "..", "..", "..", "apps", "web", "public")

// Reads the REAL committed Trust artifacts — the same bytes CF Pages serves.
const read: AssetReader = async (rel) => {
  try {
    return await readFile(resolve(PUB, rel), "utf8")
  } catch {
    return null
  }
}

async function firstEntry(pred: (e: any) => boolean) {
  const idx = JSON.parse((await read("trust/index.json"))!)
  return idx.entries.find(pred)
}

describe("partner-api router — contract over real baked artifacts", () => {
  it("GET /resources/{ns}/{name} returns a versioned envelope with a digest + verdict", async () => {
    const e = await firstEntry((x) => x.status === "baked")
    const res = await handleApiRequest({ method: "GET", path: `/v1/public/resources/${e.canonicalName}` }, read)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.schema).toBe("calllint.partner-api.v0")
    expect(body.kind).toBe("resource")
    expect(body.artifactDigest).toBe(e.artifactDigest)
    expect(body.verdict).toBe(e.verdict)
    expect(res.headers.etag).toBe(`"${e.pageDigest}"`)
    expect(res.headers["access-control-allow-origin"]).toBe("*")
    expect(res.headers["cache-control"]).toContain("s-maxage")
  })

  it("honors conditional GET (If-None-Match → 304)", async () => {
    const e = await firstEntry((x) => x.status === "baked")
    const res = await handleApiRequest(
      { method: "GET", path: `/v1/public/resources/${e.canonicalName}`, headers: { "if-none-match": `"${e.pageDigest}"` } },
      read,
    )
    expect(res.status).toBe(304)
    expect(res.body).toBe("")
    expect(res.headers.etag).toBe(`"${e.pageDigest}"`)
  })

  it("GET /artifacts/{digest} resolves the same resource by immutable digest", async () => {
    const e = await firstEntry((x) => x.status === "baked")
    const res = await handleApiRequest({ method: "GET", path: `/v1/public/artifacts/${e.artifactDigest}` }, read)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.kind).toBe("artifact")
    expect(body.canonicalName).toBe(e.canonicalName)
  })

  it("GET /resources/{ns}/{name}/authority returns only the authority slice", async () => {
    const e = await firstEntry((x) => x.status === "baked")
    const res = await handleApiRequest({ method: "GET", path: `/v1/public/resources/${e.canonicalName}/authority` }, read)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.kind).toBe("authority")
    // data is either the authority object (schema calllint.authority.v0) or null.
    if (body.data) expect(body.data.schema).toBe("calllint.authority.v0")
  })
})

describe("partner-api router — errors + guards", () => {
  it("rejects a malformed digest with 400", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/v1/public/artifacts/not-a-digest" }, read)
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).code).toBe("bad_digest")
  })

  it("404s an unknown resource", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/v1/public/resources/mcp-registry/does.not-exist" }, read)
    expect(res.status).toBe(404)
  })

  it("404s an unknown digest that is well-formed", async () => {
    const d = "sha256:" + "0".repeat(64)
    const res = await handleApiRequest({ method: "GET", path: `/v1/public/artifacts/${d}` }, read)
    expect(res.status).toBe(404)
  })

  it("rejects a write method with 405", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/v1/public/resources/a/b" }, read)
    expect(res.status).toBe(405)
  })

  it("answers OPTIONS preflight with 204 + CORS", async () => {
    const res = await handleApiRequest({ method: "OPTIONS", path: "/v1/public/resources/a/b" }, read)
    expect(res.status).toBe(204)
    expect(res.headers["access-control-allow-methods"]).toContain("GET")
  })

  it("404s an off-base path", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/v1/private/secrets" }, read)
    expect(res.status).toBe(404)
  })

  it("isDigest validates the sha256 shape", () => {
    expect(isDigest("sha256:" + "a".repeat(64))).toBe(true)
    expect(isDigest("sha256:xyz")).toBe(false)
    expect(isDigest("md5:abc")).toBe(false)
  })
})
