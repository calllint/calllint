#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const INSTALL_ROOT = "apps/web/public/install"
const OUTPUT = "packages/calllint-mcp/src/data/adoption-contracts.json"

function bakedSidecars(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...bakedSidecars(p))
    else if (e.name === "index.json") out.push(p)
  }
  return out
}

const sidecars = bakedSidecars(INSTALL_ROOT)
const contracts = {}

for (const file of sidecars) {
  const contract = JSON.parse(readFileSync(file, "utf8"))
  const slug = contract.subject.canonicalSlug
  contracts[slug] = contract
}

const output = {
  schema: "calllint.mcp-committed-contracts.v1",
  contracts
}

writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n", "utf8")
console.log(`Regenerated ${OUTPUT} with ${Object.keys(contracts).length} contracts`)
