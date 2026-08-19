#!/usr/bin/env node
/**
 * Verify that mcp-v* tag protection is enabled on the calllint/calllint repo.
 *
 * Gate: G3.4 — Supply Chain Gate (mcp-v* Tag Protection)
 *
 * Usage:
 *   node scripts/verify-mcp-tag-protection.mjs
 *
 * Exit codes:
 *   0 — Protection enabled
 *   1 — Protection missing or gh CLI unavailable
 */

import { execSync } from 'node:child_process'

const REPO = 'calllint/calllint'
const PATTERN = 'mcp-v*'

console.log(`🔍 Verifying tag protection for ${PATTERN} on ${REPO}...\n`)

try {
  const output = execSync(`gh api repos/${REPO}/tags/protection`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit']
  })

  const protections = JSON.parse(output)

  const mcpProtection = protections.find(p => p.pattern === PATTERN)

  if (mcpProtection) {
    console.log(`✅ Tag protection ENABLED for pattern: ${PATTERN}`)
    console.log(`   Required approving reviews: ${mcpProtection.required_approving_review_count || 0}`)
    process.exit(0)
  } else {
    console.error(`❌ Tag protection MISSING for pattern: ${PATTERN}`)
    console.error(`\nCurrent protections:`)
    console.error(JSON.stringify(protections, null, 2))
    console.error(`\n⚠️  Supply chain risk: mcp-v* tags can be created by any collaborator with write access.`)
    console.error(`\nTo fix (requires admin):`)
    console.error(`  1. Go to: https://github.com/${REPO}/settings/tag_protection`)
    console.error(`  2. Add pattern: ${PATTERN}`)
    console.error(`\nOr via API:`)
    console.error(`  gh api --method POST repos/${REPO}/tags/protection -f pattern='${PATTERN}'`)
    process.exit(1)
  }
} catch (err) {
  if (err.code === 'ENOENT' || err.message?.includes('command not found')) {
    console.error('❌ gh CLI not found')
    console.error('Install from: https://cli.github.com/')
    process.exit(1)
  }

  if (err.status === 404) {
    console.error(`❌ Repository ${REPO} not found or no access`)
    console.error('Ensure gh CLI is authenticated: gh auth status')
    process.exit(1)
  }

  console.error('❌ Failed to query tag protection')
  console.error(err.message)
  process.exit(1)
}
