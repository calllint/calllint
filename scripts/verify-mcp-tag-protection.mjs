#!/usr/bin/env node
/**
 * Verify that `mcp-v*` tags cannot be created by anyone with plain write access.
 *
 * Gate: G3.4 — Supply Chain Gate (mcp-v* tag protection)
 *
 * WHY THIS SCRIPT WAS REWRITTEN. The first version queried
 * `GET /repos/{owner}/{repo}/tags/protection`. GitHub has removed that endpoint: it now
 * returns 404 even for a caller with `admin: true`, so the check could never pass and its
 * red said nothing about the property. A guard that cannot observe its subject is worse
 * than no guard, because its failure is indistinguishable from the thing it guards
 * against. Tag protection now lives in repository *rulesets* with `target: "tag"`.
 *
 * WHAT THIS GUARDS. `.github/workflows/publish-mcp.yml` fires on `mcp-v*` and publishes to
 * both npm and the Official MCP Registry. If any collaborator with write access can push
 * such a tag, they can trigger a release. The `environment: npm` reviewer gate is a second
 * barrier but not a substitute: it is one approval, and both publishes sit in the same job.
 *
 * Usage:
 *   node scripts/verify-mcp-tag-protection.mjs          # assert protection exists
 *   node scripts/verify-mcp-tag-protection.mjs --explain # also print how to create it
 *
 * Exit codes:
 *   0 — an active tag ruleset covers mcp-v* and restricts creation
 *   1 — no such ruleset, or the API could not be queried (fails closed)
 */

import { execSync } from 'node:child_process'

const REPO = process.env.CALLLINT_REPO ?? 'calllint/calllint'
const PATTERN = 'mcp-v*'
const EXPLAIN = process.argv.includes('--explain')

/** Run a gh api call, returning parsed JSON. Throws with a readable message. */
function ghApi(path) {
  const raw = execSync(`gh api ${path}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return JSON.parse(raw)
}

/**
 * Does `rulesetPattern` (fnmatch-style, as GitHub stores it) cover every tag that would
 * trigger the publish workflow?
 *
 * Deliberately conservative: only patterns that provably cover the whole `mcp-v*` space
 * count. `mcp-v1.*` protects some release tags and leaves `mcp-v2.0.0` open, so it is NOT
 * accepted — a partial guard reported as green is the failure mode this file exists to
 * avoid. `refs/tags/` prefixes and `**` globs are normalized first.
 */
function coversMcpTags(rulesetPattern) {
  if (typeof rulesetPattern !== 'string') return false
  const p = rulesetPattern.trim().replace(/^refs\/tags\//, '').replace(/\*\*/g, '*')
  return p === '*' || p === 'mcp-*' || p === 'mcp-v*'
}

console.log(`Verifying ${PATTERN} tag protection on ${REPO}\n`)

let rulesets
try {
  rulesets = ghApi(`repos/${REPO}/rulesets`)
} catch (err) {
  if (err.code === 'ENOENT' || /command not found/.test(err.message ?? '')) {
    console.error('FAIL: gh CLI not found. Install from https://cli.github.com/')
  } else {
    console.error(`FAIL: could not query rulesets for ${REPO}.`)
    console.error(String(err.stderr || err.message || err).trim())
    console.error('\nCheck auth with: gh auth status')
  }
  process.exit(1)
}

const tagRulesets = rulesets.filter(r => r.target === 'tag')

console.log(`Rulesets on ${REPO}: ${rulesets.length} total, ${tagRulesets.length} targeting tags`)
for (const r of rulesets) {
  console.log(`  ${r.id}  ${JSON.stringify(r.name)}  target=${r.target}  enforcement=${r.enforcement}`)
}
console.log('')

/*
 * A ruleset is only a guard if it is `active`. `evaluate` mode reports violations without
 * blocking, and `disabled` does nothing; both would let a release tag through while
 * appearing in this list.
 */
const matching = []
for (const summary of tagRulesets) {
  if (summary.enforcement !== 'active') {
    console.log(`  skipped ${summary.id}: enforcement=${summary.enforcement} (not blocking)`)
    continue
  }

  let full
  try {
    full = ghApi(`repos/${REPO}/rulesets/${summary.id}`)
  } catch (err) {
    console.error(`FAIL: ruleset ${summary.id} could not be read.`)
    console.error(String(err.stderr || err.message || err).trim())
    process.exit(1)
  }

  const include = full.conditions?.ref_name?.include ?? []
  const exclude = full.conditions?.ref_name?.exclude ?? []
  const covering = include.filter(coversMcpTags)

  if (covering.length === 0) {
    console.log(`  skipped ${summary.id}: include=${JSON.stringify(include)} does not cover ${PATTERN}`)
    continue
  }
  if (exclude.some(coversMcpTags)) {
    console.log(`  skipped ${summary.id}: exclude=${JSON.stringify(exclude)} carves ${PATTERN} back out`)
    continue
  }

  /*
   * `creation` is the rule that matters. Tags are created, not pushed to; a ruleset that
   * only restricts `update`/`deletion` leaves the release trigger wide open.
   */
  const rules = (full.rules ?? []).map(r => r.type)
  if (!rules.includes('creation')) {
    console.log(`  skipped ${summary.id}: rules=${JSON.stringify(rules)} lacks "creation"`)
    continue
  }

  matching.push({ id: summary.id, name: full.name, include: covering, rules })
}

if (matching.length > 0) {
  console.log(`\nPASS: ${PATTERN} tag creation is restricted.`)
  for (const m of matching) {
    console.log(`  ruleset ${m.id} ${JSON.stringify(m.name)}`)
    console.log(`    covers: ${m.include.join(', ')}`)
    console.log(`    rules:  ${m.rules.join(', ')}`)
  }
  process.exit(0)
}

console.error(`\nFAIL: no active tag ruleset restricts creation of ${PATTERN}.`)
console.error('')
console.error('Supply chain risk: .github/workflows/publish-mcp.yml triggers on mcp-v* and')
console.error('publishes to npm and the Official MCP Registry. Without a tag ruleset, any')
console.error('collaborator with write access can start a release by pushing such a tag.')

if (EXPLAIN) {
  console.error('')
  console.error('To fix (requires admin on the repository):')
  console.error(`  Settings > Rules > Rulesets > New ruleset > New tag ruleset`)
  console.error(`    Name:        Protect mcp-v* release tags`)
  console.error(`    Enforcement: Active`)
  console.error(`    Target tags: ${PATTERN}`)
  console.error(`    Rules:       Restrict creations  (and Restrict deletions)`)
  console.error('')
  console.error('  Equivalent API call:')
  console.error(`    gh api --method POST repos/${REPO}/rulesets \\`)
  console.error(`      -f name='Protect mcp-v* release tags' -f target=tag -f enforcement=active \\`)
  console.error(`      -f 'conditions[ref_name][include][]=refs/tags/${PATTERN}' \\`)
  console.error(`      -f 'conditions[ref_name][exclude][]=' \\`)
  console.error(`      -f 'rules[][type]=creation' -f 'rules[][type]=deletion' \\`)
  console.error(`      -f 'bypass_actors[][actor_id]=5' -f 'bypass_actors[][actor_type]=RepositoryRole' \\`)
  console.error(`      -f 'bypass_actors[][bypass_mode]=always'`)
} else {
  console.error('')
  console.error('Run with --explain to print the exact ruleset to create.')
}

process.exit(1)
