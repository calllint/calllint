#!/usr/bin/env node
/**
 * Harness distribution truth gate.
 *
 * Validates that harness public pages advertise only commands that exist in
 * the shipped product, and that support-class claims match registered extractors.
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks failed
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const DATA_FILE = path.join(repoRoot, "apps/web/data/harness-surfaces.json")
const TYPES_FILE = path.join(repoRoot, "packages/discovery/src/types.ts")
const BOOTSTRAP_FILE = path.join(repoRoot, "packages/discovery/src/bootstrap.ts")

let failed = false

function fail(msg) {
  console.error(`❌ ${msg}`)
  failed = true
}

function pass(msg) {
  console.log(`✅ ${msg}`)
}

// Read harness data
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
const typesContent = fs.readFileSync(TYPES_FILE, "utf8")
const bootstrapContent = fs.readFileSync(BOOTSTRAP_FILE, "utf8")

// Extract registered agent types from types.ts
const agentTypeMatch = typesContent.match(/export type AgentType =\s*\n([^]*?)\n\s*$/m)
if (!agentTypeMatch) {
  fail("Could not parse AgentType from types.ts")
  process.exit(1)
}

const agentTypeLines = agentTypeMatch[1].split("\n")
const registeredTypes = new Set()
for (const line of agentTypeLines) {
  const match = line.match(/"([^"]+)"/)
  if (match) {
    registeredTypes.add(match[1])
  }
}

// Extract bootstrapped extractors from bootstrap.ts
const extractorMatches = bootstrapContent.matchAll(/registry\.register\(new (\w+)Extractor\(\)\)/g)
const bootstrappedExtractors = new Set()

// Manual mapping for multi-word class names
const classToAgentType = {
  "Cursor": "cursor",
  "ClaudeCode": "claude-code",
  "ClaudeDesktop": "claude-desktop",
  "WorkBuddy": "workbuddy",
  "VSCode": "vscode",
  "Windsurf": "windsurf",
  "QwenCode": "qwen-code",
  "OpenClaw": "openclaw",
  "OpenCode": "opencode",
}

for (const match of extractorMatches) {
  const className = match[1]
  const agentType = classToAgentType[className]
  if (agentType) {
    bootstrappedExtractors.add(agentType)
  }
}

console.log("\n=== Harness Distribution Truth Gate ===\n")

// Check each host
for (const cohort of Object.values(data.cohorts)) {
  for (const host of cohort) {
    const { id, displayName, calllintSupportClass, truthfulCommand } = host

    console.log(`\nChecking: ${displayName} (${id})`)

    // HD-01: NATIVE support must have registered extractor
    if (calllintSupportClass === "NATIVE") {
      if (!registeredTypes.has(id)) {
        fail(`${id}: marked NATIVE but AgentType "${id}" not in types.ts`)
      } else {
        pass(`${id}: AgentType registered`)
      }

      if (!bootstrappedExtractors.has(id)) {
        fail(`${id}: marked NATIVE but extractor not registered in bootstrap.ts`)
      } else {
        pass(`${id}: Extractor bootstrapped`)
      }

      if (!truthfulCommand || !truthfulCommand.includes(`--agent ${id}`)) {
        fail(`${id}: marked NATIVE but truthfulCommand does not match pattern "--agent ${id}"`)
      } else {
        pass(`${id}: Truthful command matches NATIVE support`)
      }
    }

    // HD-02: DISCOVERY_ONLY must not have fake CLI command
    if (calllintSupportClass === "DISCOVERY_ONLY") {
      if (truthfulCommand && truthfulCommand.includes("--agent")) {
        fail(`${id}: marked DISCOVERY_ONLY but advertises --agent command`)
      } else {
        pass(`${id}: DISCOVERY_ONLY correctly shows no auto-discovery command`)
      }
    }

    // Host command must be truthful
    if (truthfulCommand && truthfulCommand.includes("--agent")) {
      const agentArg = truthfulCommand.match(/--agent\s+([^\s]+)/)?.[1]
      if (agentArg && !registeredTypes.has(agentArg)) {
        fail(`${id}: advertises "--agent ${agentArg}" but that type does not exist`)
      }
    }
  }
}

console.log("\n=== Summary ===\n")

if (failed) {
  console.error("❌ Harness distribution truth gate FAILED")
  process.exit(1)
} else {
  console.log("✅ All harness distribution checks PASSED")
  process.exit(0)
}
