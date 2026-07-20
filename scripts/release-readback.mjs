#!/usr/bin/env node
/**
 * Release read-back orchestrator (new11 §3.2/§3.3, PR-03).
 *
 * Reads distribution/registries/registry-manifest.json, overlays the canonical
 * identity from project-facts.json, fetches OBSERVED identity from each
 * automatable platform (npm registry JSON, GitHub latest-release JSON), runs the
 * PURE reconcile core, and prints a report + a dedup-ready issue body. It writes
 * nothing and opens no issue itself — the workflow decides that from the exit
 * status and the emitted body (mirrors trust-ingest: fetch here, human/PR gates
 * the effect). Network egress is limited to the manifest's readbackUrl hosts.
 *
 * Flags:
 *   --json        emit machine-readable report to stdout
 *   --out <file>  write the issue body to <file> (for the workflow to consume)
 * Exit: 0 all MATCH/MANUAL · 3 actionable drift found · 2 config/read error.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { reconcileAll, renderIssueBody } from "./lib/readback-reconcile.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const nowIso = new Date().toISOString()

const manifestPath = path.join(repoRoot, "distribution/registries/registry-manifest.json")
const factsPath = path.join(repoRoot, "project-facts.json")
for (const p of [manifestPath, factsPath]) {
  if (!fs.existsSync(p)) {
    console.error(`release-readback: missing ${path.relative(repoRoot, p)}`)
    process.exit(2)
  }
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"))

// Canonical identity: facts wins over committed manifest defaults (single source).
const expected = {
  package: manifest.expected.package,
  repository: manifest.expected.repository,
  domain: manifest.expected.domain,
  version: facts.stableVersion,
}

const timeout = (ms) => {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  return { signal: c.signal, done: () => clearTimeout(t) }
}

async function fetchJson(url) {
  const t = timeout(10_000)
  try {
    const res = await fetch(url, { signal: t.signal, headers: { "user-agent": "calllint-release-readback" } })
    if (!res.ok) return { fetchError: { message: `HTTP ${res.status}` } }
    return { json: await res.json() }
  } catch (e) {
    return { fetchError: { message: e?.name === "AbortError" ? "timeout" : String(e?.message ?? e) } }
  } finally {
    t.done()
  }
}

/** Fetch OBSERVED identity per platform. Only automatable platforms hit network. */
async function observe(platform) {
  if (!platform.supportsAutomatedReadback || !platform.readbackUrl) return {}
  const { json, fetchError } = await fetchJson(platform.readbackUrl)
  if (fetchError) return { fetchError }

  if (platform.ownershipMethod === "npm") {
    const latest = json?.["dist-tags"]?.latest
    return { observed: { versionExists: latest != null, latestVersion: latest ?? null } }
  }
  if (platform.ownershipMethod === "github") {
    return { observed: { tagName: json?.tag_name, name: json?.name } }
  }
  return { observed: {} }
}

const observations = {}
for (const platform of manifest.platforms) {
  observations[platform.id] = await observe(platform)
}

const { results, actionable, summary } = reconcileAll({
  expected,
  platforms: manifest.platforms,
  observations,
})

const wantJson = process.argv.includes("--json")
const outIdx = process.argv.indexOf("--out")
const outFile = outIdx !== -1 ? process.argv[outIdx + 1] : null

if (wantJson) {
  console.log(JSON.stringify({ expected, summary, results, generatedAt: nowIso }, null, 2))
} else {
  console.log("Release read-back")
  console.log(`  expected: ${expected.package}@${expected.version} · ${expected.repository}`)
  for (const r of results) console.log(`  [${r.status}] ${r.id} — ${r.detail}`)
  console.log(`  summary: ${JSON.stringify(summary)}`)
}

if (outFile && actionable.length > 0) {
  fs.writeFileSync(outFile, renderIssueBody({ results, actionable, generatedAtIso: nowIso }))
}

process.exit(actionable.length > 0 ? 3 : 0)
