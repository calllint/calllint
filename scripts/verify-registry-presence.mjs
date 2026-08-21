#!/usr/bin/env node
/**
 * Field-level readback of CallLint's entry in the Official MCP Registry.
 *
 * This is the post-publish gate required by the Registry closure contract: a
 * `mcp-publisher publish` that exits 0 is NOT sufficient evidence of publication.
 * The registry's own API must agree, field by field, with the distribution SSOT.
 *
 * History worth keeping: the previous version of this file claimed in its own docblock
 * that "the Registry API (/v0.1/servers) does not return CallLint even though the web UI
 * clearly shows it", and fell back to printing `State: LIVE` from a string literal before
 * `process.exit(0)`. Two defects compounded:
 *
 *   1. The premise was false. The API returns CallLint fine — the old code queried
 *      /v0.1/servers with NO query parameter, read page 1 of a paginated global list,
 *      and concluded "not found". `?search=calllint` returns both published versions.
 *   2. The fallback had NO FAILING MODE. Every path led to exit 0, including a
 *      `verifyState()` call that was never defined — unreachable, so never a
 *      ReferenceError. The registry could go dark and this guard stayed green.
 *
 * So: no fallback, no manual-verification branch, no hardcoded verdict string. Every
 * assertion below reads the SSOT on one side and the live API on the other. If the API
 * is unreachable, that is a FAILURE, not an inconclusive result — a monitor that cannot
 * observe its subject must not report health.
 *
 * This script only READS. It never republishes, never opens an issue or PR, and takes no
 * external action; the watch workflow that calls it holds `contents: read`.
 *
 * Exit codes:
 *   0 = every asserted field matches the SSOT
 *   1 = mismatch, missing entry, or the registry could not be reached
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SSOT_PATH = resolve(here, '..', 'apps', 'web', 'data', 'distribution-surfaces.json')

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io'
const SEARCH_PATH = '/v0/servers?search=calllint'
const ACTIVE_STATUS = 'active'
const OFFICIAL_META = 'io.modelcontextprotocol.registry/official'

const failures = []
const checks = []

/*
 * Two callers, two notions of "the expected version".
 *
 *   distribution-watch (daily): the SSOT is the authority. If the SSOT says 0.2.0 and the
 *   registry publishes something else, one of them is wrong and a human must look.
 *
 *   publish-mcp (post-release): the tag being released is the authority. The SSOT is a
 *   committed file and may legitimately lag the release by one commit, so asserting
 *   against it would make every release red for a reason unrelated to publication.
 *
 * `--expect-version` serves the second caller. It overrides only the version; the name,
 * package identifier, repository and lifecycle status are still asserted from the SSOT,
 * so a release cannot quietly publish under a different identity.
 *
 * `--retries` covers registry index propagation, which is not instantaneous after publish.
 */
function parseArgs(argv) {
  const opts = { expectVersion: null, retries: 0, retryDelayMs: 15000 }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split('=')
    const value = inlineValue ?? argv[i + 1]
    const consumeNext = inlineValue === undefined
    if (flag === '--expect-version') {
      if (!value) {
        console.error('✗ --expect-version requires a value')
        process.exit(1)
      }
      opts.expectVersion = value.replace(/^v/, '')
      if (consumeNext) i++
    } else if (flag === '--retries') {
      opts.retries = Number.parseInt(value, 10)
      if (!Number.isFinite(opts.retries) || opts.retries < 0) {
        console.error('✗ --retries requires a non-negative integer')
        process.exit(1)
      }
      if (consumeNext) i++
    } else if (flag === '--retry-delay-ms') {
      opts.retryDelayMs = Number.parseInt(value, 10)
      if (!Number.isFinite(opts.retryDelayMs) || opts.retryDelayMs < 0) {
        console.error('✗ --retry-delay-ms requires a non-negative integer')
        process.exit(1)
      }
      if (consumeNext) i++
    }
  }
  return opts
}

const options = parseArgs(process.argv.slice(2))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function assert(label, actual, expected) {
  const pass = actual === expected
  checks.push({ label, actual, expected, pass })
  if (!pass) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${label} = ${JSON.stringify(actual)}`)
  return pass
}

/** The registry nests the server document under `.server` and its metadata under `._meta`. */
function unwrap(entry) {
  const server = entry.server || entry
  const official = (entry._meta || server._meta || {})[OFFICIAL_META] || {}
  return { server, official }
}

function readSsot() {
  const ssot = JSON.parse(readFileSync(SSOT_PATH, 'utf8'))
  const reg = ssot.officialMcpRegistry
  if (!reg) {
    console.error(`✗ ${SSOT_PATH} has no officialMcpRegistry block — nothing to verify against.`)
    process.exit(1)
  }
  for (const key of ['name', 'package', 'version', 'repositoryUrl']) {
    if (!reg[key]) {
      console.error(`✗ officialMcpRegistry.${key} is missing from the SSOT; cannot assert it.`)
      process.exit(1)
    }
  }
  return reg
}

async function fetchEntries() {
  const url = `${REGISTRY_BASE}${SEARCH_PATH}`
  console.log(`Querying ${url}`)
  let response
  try {
    response = await fetch(url)
  } catch (error) {
    console.error(`✗ Registry unreachable: ${error.message}`)
    console.error('  A monitor that cannot observe its subject reports failure, not health.')
    process.exit(1)
  }
  if (!response.ok) {
    console.error(`✗ Registry returned HTTP ${response.status} for ${SEARCH_PATH}`)
    process.exit(1)
  }
  const data = await response.json()
  const servers = data.servers || []
  if (servers.length === 0) {
    console.error('✗ Registry search returned zero servers for "calllint".')
    process.exit(1)
  }
  return servers
}

async function main() {
  console.log('Official MCP Registry — field-level readback\n')

  const ssot = readSsot()
  // The version under assertion; identity fields always come from the SSOT. See parseArgs.
  const expected = options.expectVersion
    ? { ...ssot, version: options.expectVersion }
    : ssot
  if (options.expectVersion) {
    console.log(`Version under assertion: ${expected.version} (from --expect-version)`)
    if (expected.version !== ssot.version) {
      console.log(`  SSOT currently records ${ssot.version}; it is expected to advance separately.`)
    }
  }

  let entries = await fetchEntries()
  let ours = entries.map(unwrap).filter((e) => e.server.name === expected.name)
  let current = ours.find((e) => e.server.version === expected.version)

  // Registry indexing lags publish. Retry only for the "not yet visible" case — never for
  // a mismatch, which is a real defect and must not be waited out.
  for (let attempt = 1; attempt <= options.retries && !current; attempt++) {
    console.log(
      `\n${expected.version} not visible yet; retry ${attempt}/${options.retries} in ${options.retryDelayMs}ms...`,
    )
    await sleep(options.retryDelayMs)
    entries = await fetchEntries()
    ours = entries.map(unwrap).filter((e) => e.server.name === expected.name)
    current = ours.find((e) => e.server.version === expected.version)
  }

  if (ours.length === 0) {
    const seen = entries.map((e) => unwrap(e).server.name)
    console.error(`✗ No entry named "${expected.name}". Registry returned: ${seen.join(', ')}`)
    process.exit(1)
  }
  console.log(`\nFound ${ours.length} published version(s) of ${expected.name}`)

  if (!current) {
    const versions = ours.map((e) => e.server.version)
    console.error(
      `\n✗ Expected version ${expected.version}; registry publishes ${versions.join(', ')}.`,
    )
    console.error('  Either the publish did not land, or the expected version is wrong.')
    console.error('  A `mcp-publisher publish` that exits 0 is not evidence of publication.')
    process.exit(1)
  }

  const { server, official } = current
  console.log(`\nAsserting the ${expected.version} entry:`)

  assert('name', server.name, expected.name)
  assert('version', server.version, expected.version)
  assert('lifecycle status', official.status ?? server.status, ACTIVE_STATUS)

  const pkg = (server.packages || []).find((p) => p.identifier === expected.package)
  if (!pkg) {
    const ids = (server.packages || []).map((p) => p.identifier)
    failures.push(`package identifier: expected "${expected.package}", registry lists ${ids.join(', ') || '(none)'}`)
    console.log(`  FAIL package identifier — registry lists ${ids.join(', ') || '(none)'}`)
  } else {
    assert('package identifier', pkg.identifier, expected.package)
    assert('package version', pkg.version, expected.version)
    if (expected.transport) {
      assert('transport', pkg.transport?.type ?? pkg.transport, expected.transport)
    }
  }

  const repo = server.repository?.url
  assert('repository url', repo, expected.repositoryUrl)

  console.log('')
  if (failures.length > 0) {
    console.error(`✗ Registry readback FAILED (${failures.length} of ${checks.length} assertions):`)
    for (const f of failures) console.error(`   - ${f}`)
    console.error('\n  Registry presence does not change any verdict, evidence, or certification claim.')
    console.error('  This gate exists only to keep the published identity honest.')
    process.exit(1)
  }

  console.log(`✓ Registry readback PASSED — ${checks.length} assertions, all fields agree with the SSOT.`)
  console.log(`  ${server.name} @ ${server.version} (${expected.package}@${expected.version}), status=${ACTIVE_STATUS}`)
}

main()
