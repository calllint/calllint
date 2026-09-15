/** Durable public-registry pages. Partial downloads are never inputs to a projection. */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers"
type Page = { url: string; digest: string }
type Manifest = { version: 1; startedAt: string; complete: boolean; pages: Page[] }
const digest = (text: string) => createHash("sha256").update(text).digest("hex")
function pageUrl(cursor: string | null): string {
  const url = new URL(REGISTRY_URL)
  url.searchParams.set("limit", "100")
  if (cursor !== null) url.searchParams.set("cursor", cursor)
  return url.toString()
}
function parsePage(body: string): { count: number; next: string | null } {
  const page = JSON.parse(body)
  if (!Array.isArray(page.servers) || !page.metadata || typeof page.metadata !== "object") {
    throw new Error("Registry page is malformed; exhaustion is not established")
  }
  const next = page.metadata.nextCursor ?? page.metadata.next_cursor ?? null
  if (next !== null && (typeof next !== "string" || next.length === 0)) {
    throw new Error("Registry continuation cursor is malformed")
  }
  return { count: page.servers.length, next }
}
function readDownload(dir: string): { manifest: Manifest; next: string | null; count: number } {
  const manifest: Manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8"))
  if (manifest.version !== 1 || !Array.isArray(manifest.pages) ||
      !Number.isFinite(Date.parse(manifest.startedAt)) || typeof manifest.complete !== "boolean") {
    throw new Error("Invalid registry download manifest")
  }
  let next: string | null = null
  let count = 0
  const seen = new Set<string>()
  for (const [i, page] of manifest.pages.entries()) {
    if (page.url !== pageUrl(next) || seen.has(page.url) || (i > 0 && next === null)) {
      throw new Error("Registry cursor chain is broken or repeated")
    }
    seen.add(page.url)
    const body = readFileSync(resolve(dir, `${i}.json`), "utf8")
    if (digest(body) !== page.digest) throw new Error("Registry cached page digest mismatch")
    const parsed = parsePage(body)
    next = parsed.next
    count += parsed.count
  }
  if (manifest.complete !== (manifest.pages.length > 0 && next === null)) {
    throw new Error("Registry completion marker disagrees with the cursor chain")
  }
  if (next !== null && seen.has(pageUrl(next))) throw new Error("Registry cursor cycle")
  return { manifest, next, count }
}
function save(dir: string, manifest: Manifest): void {
  const target = resolve(dir, "manifest.json")
  writeFileSync(`${target}.tmp`, JSON.stringify(manifest))
  renameSync(`${target}.tmp`, target)
}

export async function downloadRegistry(opts: {
  dir: string; fetchImpl?: typeof fetch; budgetMs: number; maxPages?: number; now?: () => number
}): Promise<{ complete: boolean; pages: number; records: number; resumedPages: number }> {
  if (!Number.isFinite(opts.budgetMs) || opts.budgetMs <= 0) throw new Error("Invalid download budget")
  const now = opts.now ?? Date.now
  const deadline = now() + opts.budgetMs
  const dir = resolve(opts.dir)
  mkdirSync(dir, { recursive: true })
  let state = existsSync(resolve(dir, "manifest.json")) ? readDownload(dir) : null
  // Completed downloads belong to the preceding refresh. Start a new observation on the
  // next scheduled run; only unfinished downloads resume. Stale prefixes restart too.
  if (!state || state.manifest.complete || now() - Date.parse(state.manifest.startedAt) > 14 * 86400_000) {
    const manifest: Manifest = { version: 1, startedAt: new Date(now()).toISOString(), complete: false, pages: [] }
    save(dir, manifest)
    state = { manifest, next: null, count: 0 }
  }
  const { manifest } = state
  const resumedPages = manifest.pages.length
  let next = state.next
  let records = state.count
  const seen = new Set(manifest.pages.map((p) => p.url))
  let fetched = 0
  while (now() < deadline && fetched < (opts.maxPages ?? Infinity)) {
    const url = pageUrl(next)
    if (seen.has(url)) throw new Error("Registry cursor cycle")
    const remaining = deadline - now()
    if (remaining <= 0) break
    let response: Response
    try {
      response = await (opts.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(60_000, remaining))) })
      if (!response.ok) throw new Error(`Registry fetch failed: HTTP ${response.status}`)
      const body = await response.text()
      const parsed = parsePage(body)
      if (parsed.next !== null && (pageUrl(parsed.next) === url || seen.has(pageUrl(parsed.next)))) {
        throw new Error("Registry cursor cycle")
      }
      const index = manifest.pages.length
      writeFileSync(resolve(dir, `${index}.json.tmp`), body)
      renameSync(resolve(dir, `${index}.json.tmp`), resolve(dir, `${index}.json`))
      manifest.pages.push({ url, digest: digest(body) })
      manifest.complete = parsed.next === null
      save(dir, manifest) // publish the cursor only after its page is durable
      seen.add(url)
      next = parsed.next
      records += parsed.count
      fetched++
      if (manifest.complete) break
    } catch (error) {
      // An actual deadline is a resumable pause. HTTP/schema/cursor/disk failures are errors.
      if (now() >= deadline && error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) break
      throw error
    }
  }
  return { complete: manifest.complete, pages: manifest.pages.length, records, resumedPages }
}

export function replayRegistry(dir: string): { fetchImpl: typeof fetch; maxPages: number; maxEntries: number } {
  const state = readDownload(dir)
  if (!state.manifest.complete) throw new Error("Registry download is incomplete; projection refused")
  const pages = new Map(state.manifest.pages.map((p, i) => [p.url, { ...p, index: i }]))
  return {
    maxPages: pages.size + 1,
    maxEntries: state.count + 1,
    fetchImpl: (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const page = pages.get(url)
      if (!page) throw new Error("Request falls outside the completed registry download")
      const body = readFileSync(resolve(dir, `${page.index}.json`), "utf8")
      if (digest(body) !== page.digest) throw new Error("Registry replay digest mismatch")
      return new Response(body, { headers: { "Content-Type": "application/json" } })
    }) as typeof fetch,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dir = process.env.TRUST_REGISTRY_DOWNLOAD_DIR
  if (!dir) throw new Error("TRUST_REGISTRY_DOWNLOAD_DIR is required")
  downloadRegistry({ dir, budgetMs: 210 * 60_000 }).then((result) => {
    console.log(JSON.stringify(result))
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `complete=${result.complete}\n`, { flag: "a" })
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY,
      `\nRegistry download: **${result.complete ? "complete" : "pending; will resume next scheduled run"}**, ${result.pages} pages, ${result.records} records, ${result.resumedPages} pages reused. Partial downloads do not produce a refresh PR.\n`, { flag: "a" })
  }).catch((error) => { console.error(error); process.exitCode = 1 })
}
