#!/usr/bin/env node
/**
 * CallLint facts derivation (new11 PR-02 / ADR 0049 §8).
 *
 * The single machine-readable facts source is project-facts.json. A subset of
 * its fields are CAPABILITY facts that must never drift from the code:
 *
 *   capabilities.detectorCount  ← count of `export { detect* }` in
 *                                  packages/static-analyzer/src/index.ts
 *   capabilities.tierAHosts     ← *_HOST_ID constants declared by the apply-capable
 *                                  adapters in packages/install-planner/src/adapters/
 *
 * This script derives those from the code and either VERIFIES the committed facts
 * match (default / `--check`) or REWRITES them (`--write`). Deriving from code —
 * not prose — means a 14th detector or a new Tier-A host can never silently
 * disagree with the public claims (ADR 0049 §1/§8: no new ordinary detectors
 * without an explicit decision; the count is self-verifying evidence of that).
 *
 * Exit codes: 0 match/written · 1 drift (in --check) · 2 unreadable source.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const factsPath = path.join(repoRoot, "project-facts.json")

const read = (rel) => {
  const p = path.join(repoRoot, rel)
  if (!fs.existsSync(p)) {
    console.error(`derive-facts: source not found: ${rel}`)
    process.exit(2)
  }
  return fs.readFileSync(p, "utf8")
}

/** Count `export { detectXxx } from "./detectors/..."` lines — the runtime detector set. */
function deriveDetectorCount() {
  const idx = read("packages/static-analyzer/src/index.ts")
  const names = new Set(
    [...idx.matchAll(/export\s*\{\s*(detect[A-Za-z0-9]+)\b/g)].map((m) => m[1]),
  )
  return names.size
}

/** Collect *_HOST_ID string literals from the apply-capable adapters. */
function deriveTierAHosts() {
  const dir = "packages/install-planner/src/adapters"
  const abs = path.join(repoRoot, dir)
  if (!fs.existsSync(abs)) {
    console.error(`derive-facts: adapters dir not found: ${dir}`)
    process.exit(2)
  }
  const ids = new Set()
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith(".ts") || f === "index.ts") continue
    const text = fs.readFileSync(path.join(abs, f), "utf8")
    for (const m of text.matchAll(/_HOST_ID\s*=\s*"([a-z0-9-]+)"/g)) ids.add(m[1])
  }
  return [...ids].sort()
}

const write = process.argv.includes("--write")

const derived = {
  detectorCount: deriveDetectorCount(),
  tierAHosts: deriveTierAHosts(),
}

const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"))
const current = facts.capabilities || {}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const drift = []
if (current.detectorCount !== derived.detectorCount)
  drift.push(`detectorCount: facts=${current.detectorCount} code=${derived.detectorCount}`)
if (!eq(current.tierAHosts, derived.tierAHosts))
  drift.push(`tierAHosts: facts=${JSON.stringify(current.tierAHosts)} code=${JSON.stringify(derived.tierAHosts)}`)

console.log("Facts derivation (code → project-facts.json)")
console.log(`  detectorCount = ${derived.detectorCount}`)
console.log(`  tierAHosts    = ${JSON.stringify(derived.tierAHosts)}`)
console.log("")

if (drift.length === 0) {
  console.log("Facts derivation: PASS — capabilities match code")
  process.exit(0)
}

if (write) {
  facts.capabilities = {
    ...current,
    detectorCount: derived.detectorCount,
    tierAHosts: derived.tierAHosts,
  }
  fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2) + "\n")
  console.log("Facts derivation: WROTE updated capabilities to project-facts.json")
  process.exit(0)
}

for (const d of drift) console.error(`  ✗ ${d}`)
console.error("")
console.error("Facts derivation: FAIL — capabilities drifted from code. Run `pnpm facts:write`.")
process.exit(1)
