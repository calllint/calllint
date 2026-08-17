#!/usr/bin/env node
/**
 * Sync the MCP server's bundled data from the baked, served tree.
 *
 * WHY THIS SCRIPT EXISTS. Two committed files under `packages/calllint-mcp/src/data/` must stay
 * byte-identical to what `apps/web/public/` serves, and each has an anti-drift test that fails until
 * they do (`committed-lookup-drift.test.ts`, `committed-contracts-drift.test.ts`). But before this
 * script there was no single command that produced them: `lookup-index.json` was synced by HAND
 * (a copy, remembered or not), and `adoption-contracts.json` had `regen-mcp-contracts.mjs` which was
 * never wired into `package.json`. So the anti-drift tests were reachable only by knowing a
 * procedure that lived nowhere — and on the 2026-08-17 ingest they were satisfied by a human
 * remembering to copy two files.
 *
 * A guard whose remedy is undocumented is a guard that gets satisfied by luck. This is the remedy,
 * named and runnable: `pnpm sync:mcp-bundle`.
 *
 * PURE. Reads the baked tree, writes two files, no clock and no network. Running it twice changes
 * nothing (verified by `--check`, which the ingest workflow uses to fail rather than to write).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BAKED_LOOKUP = join("apps", "web", "public", "trust", "lookup-index.json")
const BUNDLED_LOOKUP = join("packages", "calllint-mcp", "src", "data", "lookup-index.json")
const INSTALL_ROOT = join("apps", "web", "public", "install")
const BUNDLED_CONTRACTS = join("packages", "calllint-mcp", "src", "data", "adoption-contracts.json")

/** Every `index.json` install sidecar under the served install tree, recursively. */
function bakedSidecars(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...bakedSidecars(p))
    else if (e.name === "index.json") out.push(p)
  }
  return out
}

/**
 * The contracts bundle, keyed by canonical slug.
 *
 * Key order follows `bakedSidecars`' directory walk, which is what `regen-mcp-contracts.mjs`
 * produced and what the committed file already holds — so this is a byte-for-byte continuation of
 * that script, not a reformat. The `{ schema, contracts }` envelope is load-bearing: `committedContracts.ts`
 * imports it with a JSON import assertion and reads `.contracts`.
 */
function contractsBundle() {
  const contracts = {}
  for (const file of bakedSidecars(INSTALL_ROOT)) {
    const contract = JSON.parse(readFileSync(file, "utf8"))
    contracts[contract.subject.canonicalSlug] = contract
  }
  return JSON.stringify({ schema: "calllint.mcp-committed-contracts.v1", contracts }, null, 2) + "\n"
}

const desired = [
  { what: "lookup index", path: BUNDLED_LOOKUP, content: readFileSync(BAKED_LOOKUP, "utf8") },
  { what: "install contracts", path: BUNDLED_CONTRACTS, content: contractsBundle() },
]

// `--check` verifies without writing, for CI and for the ingest workflow: there, a drift means the
// bake and the bundle disagree, and the correct response is to FAIL loudly rather than to silently
// rewrite committed bytes inside an automated run.
const checkOnly = process.argv.includes("--check")
let drifted = 0

for (const { what, path, content } of desired) {
  let current = null
  try {
    current = readFileSync(path, "utf8")
  } catch {
    current = null
  }
  if (current === content) {
    console.log(`  ok       ${what} — ${path}`)
    continue
  }
  drifted += 1
  if (checkOnly) {
    console.error(`  DRIFTED  ${what} — ${path}`)
    continue
  }
  writeFileSync(path, content, "utf8")
  console.log(`  written  ${what} — ${path}`)
}

if (checkOnly && drifted > 0) {
  console.error(
    `\n${drifted} bundled file(s) drifted from the baked tree. Run \`pnpm sync:mcp-bundle\` and commit the result.`,
  )
  process.exit(1)
}
console.log(
  checkOnly
    ? "\nBundle is in sync with the baked tree."
    : `\nSynced ${desired.length} file(s) from the baked tree.`,
)
