import { describe, it, expect } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { downloadRegistry, replayRegistry } from "../src/registryDownload.js"
import { createOfficialRegistryAdapter } from "@calllint/adoption-index"

function page(name: string, cursor?: string): Response {
  return new Response(JSON.stringify({ servers: [{ server: { name, version: "1" }, _meta: {
    "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true },
  } }], metadata: cursor ? { nextCursor: cursor } : {} }))
}
async function sandbox(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "calllint-download-"))
  try { await run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
describe("durable registry download", () => {
  it("resumes a bounded chunk and replays the complete source through the real adapter", () => sandbox(async (dir) => {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(url)
      return url.includes("cursor=") ? page("ai.test/second") : page("ai.test/first", "next-page")
    }) as typeof fetch
    const first = await downloadRegistry({ dir, budgetMs: 10000, maxPages: 1, fetchImpl })
    expect(first).toEqual({ complete: false, pages: 1, records: 1, resumedPages: 0 })
    expect(() => replayRegistry(dir)).toThrow(/incomplete/)
    const second = await downloadRegistry({ dir, budgetMs: 10000, fetchImpl })
    expect(second).toEqual({ complete: true, pages: 2, records: 2, resumedPages: 1 })
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain("cursor=next-page")
    const replay = replayRegistry(dir)
    const records = []
    const truncated: string[] = []
    for await (const r of createOfficialRegistryAdapter().fullSync({ ...replay, retrievedAt: "2026-09-15T00:00:00Z", onTruncated: (r) => truncated.push(r) })) records.push(r)
    expect(records.map((r) => r.source.sourceRecordId)).toEqual(["ai.test/first", "ai.test/second"])
    expect(truncated).toEqual([])
    await expect(replay.fetchImpl("https://example.invalid/")).rejects.toThrow(/outside/)
    // Completed cache is not reused forever: a subsequent refresh must consult upstream.
    const fresh = await downloadRegistry({ dir, budgetMs: 10000, maxPages: 1, fetchImpl })
    expect(fresh.resumedPages).toBe(0)
    expect(urls).toHaveLength(3)
  }))
  it("preserves durable progress after network failure, but refuses malformed pages and cache corruption", () => sandbox(async (dir) => {
    let calls = 0
    const fetchImpl = (async () => { if (calls++ === 0) return page("ai.test/first", "next"); throw new Error("offline") }) as typeof fetch
    await expect(downloadRegistry({ dir, budgetMs: 10000, fetchImpl })).rejects.toThrow("offline")
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).pages).toHaveLength(1)
    await expect(downloadRegistry({ dir, budgetMs: 10000, fetchImpl: (async () => new Response("{}")) as typeof fetch })).rejects.toThrow(/malformed/)
    writeFileSync(join(dir, "0.json"), "{}")
    await expect(downloadRegistry({ dir, budgetMs: 10000, fetchImpl })).rejects.toThrow(/digest/)
  }))
  it("rejects a multi-page cursor cycle and cannot replay that prefix", () => sandbox(async (dir) => {
    let calls = 0
    const fetchImpl = (async () => page("ai.test/item", ["a", "b", "a"][calls++])) as typeof fetch
    await expect(downloadRegistry({ dir, budgetMs: 10000, fetchImpl })).rejects.toThrow(/cycle/)
    expect(() => replayRegistry(dir)).toThrow(/incomplete/)
  }))
  it("pauses at the elapsed budget and continues without refetching durable pages", () => sandbox(async (dir) => {
    let clock = 0
    const first = await downloadRegistry({ dir, budgetMs: 10, now: () => clock,
      fetchImpl: (async () => { clock = 11; return page("ai.test/one", "two") }) as typeof fetch })
    expect(first.complete).toBe(false)
    const second = await downloadRegistry({ dir, budgetMs: 10, now: () => clock,
      fetchImpl: (async (url: string) => { expect(url).toContain("cursor=two"); return page("ai.test/two") }) as typeof fetch })
    expect(second.complete).toBe(true)
    expect(second.resumedPages).toBe(1)
  }))
})
