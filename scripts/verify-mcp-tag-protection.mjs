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
 * both npm and the Official MCP Registry. If any actor with plain write access can push such a
 * tag, they can trigger a release. The `environment: npm` reviewer gate is a second barrier but
 * not a substitute: it is one approval, and both publishes sit in the same job.
 *
 * WHAT "ANY ACTOR WITH WRITE ACCESS" MEANS HERE, MEASURED RATHER THAN ASSUMED. On
 * `calllint/calllint` today there is exactly one collaborator and they are an admin, and the
 * ruleset this script demands grants the admin role `bypass_mode: always`. So a PASS from this
 * script restricts nobody on the current human roster. It binds the actors that are not on it: a
 * future non-admin collaborator, a deploy key, and a `GITHUB_TOKEN` with `contents: write` (an
 * Actions token is not the admin role, so a workflow cannot create a release tag). The reason to
 * say this in the script is that its own PASS line is short enough to be misread as "no
 * unauthorized release is possible", which is a stronger claim than a tag ruleset can carry —
 * which commit a tag may point at is `verify-release-ancestry.mjs`, a separate control.
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
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.CALLLINT_REPO ?? 'calllint/calllint'
const PATTERN = 'mcp-v*'
const EXPLAIN = process.argv.includes('--explain')

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RULESET_BODY_PATH = 'artifacts/authority-distribution-closure/mcp-tag-ruleset.json'

/*
 * The request body is READ FROM THE CHECKED-IN FILE, never re-typed here. `--explain` tells
 * an operator to POST that file, so a literal in this script would be a second copy of the
 * same body and the two would drift — and the copy that drifted would be the one printed as
 * "the exact ruleset to create". One file, one answer.
 */
let RULESET_BODY = null
try {
  RULESET_BODY = JSON.parse(readFileSync(resolve(ROOT, RULESET_BODY_PATH), 'utf8'))
} catch {
  /* Left null; --explain degrades to the UI steps rather than printing a guessed body. */
}

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
console.error('publishes to npm and the Official MCP Registry. Without a tag ruleset, any actor')
console.error('with plain write access — a non-admin collaborator, a deploy key, or a workflow')
console.error('token carrying contents: write — can start a release by pushing such a tag.')

if (EXPLAIN) {
  console.error('')
  console.error('To fix (requires admin on the repository):')
  console.error(`  Settings > Rules > Rulesets > New ruleset > New tag ruleset`)
  console.error(`    Name:        Protect mcp-v* release tags`)
  console.error(`    Enforcement: Active`)
  console.error(`    Target tags: ${PATTERN}`)
  console.error(`    Rules:       Restrict creations  (and Restrict deletions)`)
  console.error('')
  /*
   * The API call is printed as a JSON body on stdin, NOT as a list of `-f` flags.
   *
   * The `-f` form was printed here first and is not runnable — it was measured failing
   * twice, with two DIFFERENT 422s, and each one rules out a repair of the other:
   *   -f 'bypass_actors[][actor_id]=5'  → "Invalid request. \"5\" is not of type \"integer\"."
   *      `-f` sends every value as a string; `actor_id` is an integer field.
   *   -F 'bypass_actors[][actor_id]=5'  → "Invalid request. Missing required parameter
   *      \"exclude\"." `-F` fixes the typing, but neither `-f` nor `-F` can express an
   *      EMPTY ARRAY: `-f 'conditions[ref_name][exclude][]=' ` sends `[""]`, and omitting
   *      it sends nothing, while the endpoint requires `exclude` to be present.
   * So there is no flag-only spelling of this body. `--input` is the only correct form,
   * and the body below is byte-for-byte the one that created the live ruleset.
   *
   * Printed at column 0 with an unindented terminator on purpose: a heredoc whose `JSON`
   * terminator carries leading whitespace does not close, so an indented "copy-pasteable"
   * command would be the same defect this comment exists to record.
   */
  console.error('  Equivalent API call (JSON body on stdin — see the comment in this script')
  console.error('  for why the -f/-F flag forms cannot express this body):')
  if (RULESET_BODY) {
    console.error(`    gh api --method POST repos/${REPO}/rulesets --input - <<'JSON'`)
    console.error(JSON.stringify(RULESET_BODY, null, 2))
    console.error('JSON')
    console.error('')
    console.error('  The same body is checked in, if you would rather not paste a heredoc:')
    console.error(`    gh api --method POST repos/${REPO}/rulesets --input ${RULESET_BODY_PATH}`)
  } else {
    // The body file is the only source for this text; printing a re-typed one would risk
    // handing the operator a body that no longer matches what is checked in.
    console.error(`    gh api --method POST repos/${REPO}/rulesets --input ${RULESET_BODY_PATH}`)
    console.error('')
    console.error(`  NOTE: ${RULESET_BODY_PATH} could not be read from this checkout, so the`)
    console.error('  body itself is not shown. Use the UI steps above, or restore that file.')
  }
} else {
  console.error('')
  console.error('Run with --explain to print the exact ruleset to create.')
}

process.exit(1)
