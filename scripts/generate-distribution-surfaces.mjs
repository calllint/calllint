#!/usr/bin/env node
/**
 * Generate all distribution surface projections from the single source of truth.
 *
 * INVARIANT: distribution-surfaces.json → ALL user-facing surfaces
 *
 * This generator is idempotent: re-run produces identical output.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')

// Load SSOT
const SSOT_PATH = join(ROOT, 'apps/web/data/distribution-surfaces.json')
const ssot = JSON.parse(readFileSync(SSOT_PATH, 'utf8'))

console.log('📋 Loaded distribution SSOT:')
console.log(`   - Official MCP Registry: ${ssot.officialMcpRegistry.name}`)
console.log(`   - Hosts: ${ssot.hosts.length}`)
console.log(`   - Model Intent Pages: ${ssot.modelIntentLandingPages.length}`)

/**
 * Generate .well-known/calllint.json
 */
function generateWellKnown() {
  const wellKnown = {
    version: '1.0.0',
    name: 'CallLint',
    description: 'Deterministic static preflight inspection for MCP and agent-tool configurations',
    homepage: 'https://calllint.com',
    repository: ssot.repository,

    mcp: {
      registry: {
        name: ssot.officialMcpRegistry.name,
        package: ssot.officialMcpRegistry.package,
        state: ssot.officialMcpRegistry.state,
        registryUrl: ssot.officialMcpRegistry.registryUrl,
        description: ssot.officialMcpRegistry.description
      }
    },

    discovery: {
      agentSurfaces: 'https://calllint.com/agent-surfaces.json',
      llmsTxt: 'https://calllint.com/llms.txt',
      llmsFull: 'https://calllint.com/llms-full.txt',
      agentInstructions: 'https://calllint.com/agent-instructions.md',
      harnessHub: 'https://calllint.com/harnesses/',
      sitemap: 'https://calllint.com/harnesses/sitemap.xml'
    },

    hosts: ssot.hosts.map(h => ({
      id: h.id,
      displayName: h.displayName,
      vendor: h.vendor,
      supportClass: h.supportClass,
      canonicalUrl: `https://calllint.com${h.canonicalPath}`
    })),

    generatedAt: new Date().toISOString(),
    generatedFrom: 'distribution-surfaces.json'
  }

  const outPath = join(ROOT, 'apps/web/public/.well-known/calllint.json')
  writeFileSync(outPath, JSON.stringify(wellKnown, null, 2) + '\n', 'utf8')
  console.log(`✅ Generated: .well-known/calllint.json`)
  return wellKnown
}

/**
 * Main
 */
function main() {
  console.log('🚀 Generating distribution surface projections...\n')

  // G3.1: Well-known with Registry identity
  const wellKnown = generateWellKnown()

  console.log('\n✨ Generation complete!')
  console.log('\nVerify:')
  console.log('  Registry identity:', wellKnown.mcp.registry.name)
  console.log('  Hosts projected:', wellKnown.hosts.length)
}

main()

