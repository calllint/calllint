#!/usr/bin/env node
/**
 * Verify that the commit being released is reachable from the protected default branch.
 *
 * Gate: AC-32 — an `mcp-v*` tag pointing at an unreviewed side branch must not publish.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE TAG RULESET. `verify-mcp-tag-protection.mjs` answers
 * *who* may create a release tag (a repository ruleset restricting `creation`). This script
 * answers a different question: *which commit* the tag points at. Both are required, and
 * neither substitutes for the other — an admin, or any actor with a ruleset bypass, can
 * still tag an arbitrary side-branch commit, and `new18.md` §45 asks for the code-level
 * ancestry gate "regardless" of the account-level configuration.
 *
 * WHAT IT GUARDS — BOTH publish workflows, not just the MCP one:
 *   - `.github/workflows/publish-mcp.yml` fires on `mcp-v*` and publishes `calllint-mcp`
 *     to npm (trusted publishing) and to the Official MCP Registry.
 *   - `.github/workflows/release.yml` fires on `release: published` and publishes the
 *     flagship `calllint` CLI to npm. A GitHub Release can be created against ANY target
 *     (`gh release create v9.9.9 --target <side-branch-sha>`), so the same property is
 *     needed there — on the more widely installed package. AC-32's own text names only
 *     `mcp-v*` tags, which is why that workflow sat uncovered.
 * All of these are irreversible: npm versions are immutable and a registry entry is
 * public. Without this gate, tagging any SHA publishes code that never passed review.
 *
 * WHY THE COMPARE API AND NOT `git merge-base --is-ancestor`. `actions/checkout` clones at
 * `fetch-depth: 1` by default, so the local history does not contain `main` and a perfectly
 * authentic commit looks unreachable. That exact shape has produced false accusations in
 * this repository before. Asking GitHub compares against the *real* graph, independent of
 * how much history the runner fetched.
 *
 * FAILS CLOSED. Any inability to determine the answer — network error, bad ref, missing
 * `gh` — exits 1. A publish gate whose failure mode is "publish anyway" is not a gate.
 *
 * Usage:
 *   node scripts/verify-release-ancestry.mjs                     # uses $GITHUB_SHA / $GITHUB_REF_NAME
 *   node scripts/verify-release-ancestry.mjs --sha <sha>          # check an explicit commit
 *   node scripts/verify-release-ancestry.mjs --sha <sha> --base main
 *
 * Exit codes:
 *   0 — the commit is contained in (identical to, or behind) the protected base branch
 *   1 — it is not, or the answer could not be established
 */

import { execFileSync } from 'node:child_process'

const REPO = process.env.CALLLINT_REPO ?? 'calllint/calllint'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/*
 * `GITHUB_SHA` on a tag push is the commit the tag points at, which is exactly the subject.
 * There is deliberately no default that falls back to the local HEAD: in CI that would be
 * the same commit, but locally it would silently check something else and print a green.
 */
const sha = arg('sha', process.env.GITHUB_SHA)
const base = arg('base', process.env.CALLLINT_RELEASE_BASE ?? 'main')
const tagName = process.env.GITHUB_REF_NAME ?? '(no tag in env)'

if (!sha) {
  console.error('FAIL: no commit to check.')
  console.error('Pass --sha <sha>, or run where GITHUB_SHA is set (a tag-push workflow).')
  process.exit(1)
}

/** Run a gh api call, returning parsed JSON. execFileSync avoids shell interpolation. */
function ghApi(path) {
  const raw = execFileSync('gh', ['api', path], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return JSON.parse(raw)
}

console.log(`Verifying release ancestry on ${REPO}`)
console.log(`  tag:    ${tagName}`)
console.log(`  commit: ${sha}`)
console.log(`  base:   ${base}\n`)

/*
 * Resolve the base branch's tip and report it. The gate's own inputs are printed because a
 * verdict string alone cannot be audited: if `base` is ever wrong (a renamed default
 * branch, say), the numbers below are what make that visible.
 */
let baseSha
try {
  baseSha = ghApi(`repos/${REPO}/commits/${encodeURIComponent(base)}`).sha
} catch (err) {
  console.error(`FAIL: could not resolve base branch ${JSON.stringify(base)} on ${REPO}.`)
  console.error(String(err.stderr || err.message || err).trim())
  console.error('\nCheck auth with: gh auth status')
  process.exit(1)
}
console.log(`  ${base} tip is ${baseSha}`)

/*
 * `compare/BASE...HEAD` reports how HEAD relates to BASE:
 *   identical  — same commit
 *   behind     — HEAD is an ancestor of BASE (a commit already merged; the normal case for
 *                a tag cut at, or before, the current tip)
 *   ahead      — HEAD has commits BASE does not: NOT reviewed on main
 *   diverged   — both have unique commits: a side branch
 * Only the first two mean "reachable from the protected branch".
 */
let cmp
try {
  cmp = ghApi(`repos/${REPO}/compare/${encodeURIComponent(base)}...${encodeURIComponent(sha)}`)
} catch (err) {
  console.error(`FAIL: could not compare ${base}...${sha} on ${REPO}.`)
  console.error(String(err.stderr || err.message || err).trim())
  process.exit(1)
}

const status = cmp.status
console.log(`  compare ${base}...${sha.slice(0, 12)} → status=${status}`)
console.log(`    ahead_by=${cmp.ahead_by}  behind_by=${cmp.behind_by}\n`)

if (status === 'identical' || status === 'behind') {
  console.log(`PASS: ${sha.slice(0, 12)} is reachable from ${base} (status=${status}).`)
  process.exit(0)
}

console.error(`FAIL: ${sha.slice(0, 12)} is NOT reachable from ${base} (status=${status}).`)
console.error('')
console.error(`Supply chain risk: this commit carries ${cmp.ahead_by} commit(s) that ${base}`)
console.error('does not contain, so it has not passed the reviewed-PR path. Publishing it')
console.error('would release unreviewed code under the calllint identity through an')
console.error('irreversible channel (npm versions are immutable; a registry entry is public).')
console.error('')
console.error('If this release is legitimate, merge it to')
console.error(`  ${base}`)
console.error('through a pull request first, then re-cut the tag at the merge commit.')
process.exit(1)
