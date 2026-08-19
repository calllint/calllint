#!/usr/bin/env node
/**
 * Local validation for server.json using mcp-publisher.
 * Equivalent to what CI runs: `mcp-publisher validate server.json`
 *
 * Prerequisites:
 * 1. Install mcp-publisher: https://github.com/modelcontextprotocol/registry
 * 2. Run from repo root: `node scripts/validate-mcp-server.mjs`
 *
 * Gate: G3.3 — MCP Publisher Validate Integration
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SERVER_JSON = join(ROOT, 'packages/calllint-mcp/server.json')

console.log('🔍 Validating MCP server.json...\n')

if (!existsSync(SERVER_JSON)) {
  console.error('❌ server.json not found at:', SERVER_JSON)
  process.exit(1)
}

try {
  // Try to run mcp-publisher validate
  execSync('mcp-publisher validate packages/calllint-mcp/server.json', {
    cwd: ROOT,
    stdio: 'inherit'
  })
  console.log('\n✅ server.json validation passed')
} catch (err) {
  if (err.code === 'ENOENT' || err.message?.includes('command not found')) {
    console.error('\n⚠️  mcp-publisher not found in PATH')
    console.error('Install from: https://github.com/modelcontextprotocol/registry')
    console.error('\nCurl one-liner (Linux/macOS):')
    console.error(
      '  curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr \'[:upper:]\' \'[:lower:]\')_$(uname -m | sed \'s/x86_64/amd64/;s/aarch64/arm64/\').tar.gz" | tar xz'
    )
    process.exit(1)
  }
  console.error('\n❌ Validation failed')
  process.exit(err.status || 1)
}
