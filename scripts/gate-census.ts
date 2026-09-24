import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CUMULATIVE_COVERAGE_CEILING } from "../packages/trust-index/src/fetchRegistry.js"
import { REGISTRY_NAMESPACE, registryCanonicalName } from "../packages/trust-index/src/snapshot.js"
import {
  renderS1Census,
  renderS2Census,
  replaceGeneratedCensus,
  assertServedMatchesSource,
  type GateCensus,
} from "./lib/gate-census.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const snapshotPath = path.join(repoRoot, "packages/trust-index/snapshots/official-mcp-registry.json")
const servedIndexPath = path.join(repoRoot, "apps/web/public/trust/index.json")
const s1Path = path.join(repoRoot, "artifacts/gate-s1/open-items.md")
const s2Path = path.join(repoRoot, "artifacts/gate-s2/open-items.md")

function readCensus(): GateCensus {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    count?: unknown
    entries?: unknown
  }
  if (!Array.isArray(snapshot.entries)) {
    throw new Error(`${path.relative(repoRoot, snapshotPath)} has no entries array`)
  }
  if (snapshot.count !== snapshot.entries.length) {
    throw new Error(
      `${path.relative(repoRoot, snapshotPath)} count (${String(snapshot.count)}) does not match entries (${snapshot.entries.length})`,
    )
  }

  const sourceNames = snapshot.entries.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof (entry as { name?: unknown }).name !== "string") {
      throw new Error(`${path.relative(repoRoot, snapshotPath)} contains an entry without a string name`)
    }
    return registryCanonicalName((entry as { name: string }).name)
  })
  const served = JSON.parse(readFileSync(servedIndexPath, "utf8")) as {
    entries?: Array<{ canonicalName?: unknown }>
  }
  if (!Array.isArray(served.entries)) {
    throw new Error(`${path.relative(repoRoot, servedIndexPath)} has no entries array`)
  }
  const servedNames = served.entries.filter(
    (entry) => typeof entry.canonicalName === "string" && entry.canonicalName.startsWith(`${REGISTRY_NAMESPACE}/`),
  ).map((entry) => entry.canonicalName as string)
  assertServedMatchesSource(sourceNames, servedNames)

  return {
    sourceCount: snapshot.entries.length,
    servedCount: servedNames.length,
    sourceNames,
    servedNames,
    requiredS1: 100,
    requiredS2: CUMULATIVE_COVERAGE_CEILING,
  }
}

function expectedDocuments(census: GateCensus): [string, string][] {
  const s1 = replaceGeneratedCensus(
    readFileSync(s1Path, "utf8").replace(/\r\n/g, "\n"),
    renderS1Census(census),
  )
  const s2 = replaceGeneratedCensus(
    readFileSync(s2Path, "utf8").replace(/\r\n/g, "\n"),
    renderS2Census(census),
  )
  return [
    [s1Path, s1],
    [s2Path, s2],
  ]
}

function main(): void {
  const write = process.argv.includes("--write")
  const check = process.argv.includes("--check") || !write
  if (write && check && process.argv.includes("--check")) {
    throw new Error("--write and --check are mutually exclusive")
  }

  const census = readCensus()
  let stale = false
  for (const [file, expected] of expectedDocuments(census)) {
    const current = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
    if (current === expected) {
      console.log(`✓ ${path.relative(repoRoot, file)} matches cohort ${census.sourceCount}`)
      continue
    }
    stale = true
    if (write) {
      writeFileSync(file, expected)
      console.log(`updated ${path.relative(repoRoot, file)} for cohort ${census.sourceCount}`)
    } else if (check) {
      console.error(`✗ ${path.relative(repoRoot, file)} is stale; run pnpm gate:census:write`)
    }
  }
  if (check && stale) process.exitCode = 1
}

main()
