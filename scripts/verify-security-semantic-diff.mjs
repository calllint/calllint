#!/usr/bin/env node
/**
 * §18 security-semantic zero-diff gate.
 *
 * The distribution work is allowed to change how CallLint is FOUND. It is not allowed to
 * change what CallLint DECIDES. This script measures that separation and writes the
 * result to `artifacts/global-distribution/security-semantic-diff.json`.
 *
 * Why a script and not a hand-written artifact: a committed JSON file saying
 * `"changed": false` is a claim that costs nothing to write and nothing to keep true. The
 * same defect this repo keeps hitting — a guard that cannot observe its subject. Here the
 * subject is a diff, so the artifact must be a diff's OUTPUT, regenerable on demand and
 * falsifiable by construction.
 *
 * Three independent measurements, all of which must hold:
 *
 *   1. DIFF     — no file under a verdict-deciding package changed over the branch range.
 *   2. FIELDS   — none of the forbidden risk fields exists anywhere in shipped source.
 *   3. COUPLING — host/model identity does not appear in the risk engine at all, so it
 *                 cannot participate in a verdict even accidentally.
 *
 * (1) is range-scoped and therefore historical; (2) and (3) are properties of the tree at
 * HEAD and hold regardless of range. A failure in any one is a real violation of the
 * core invariant: MODEL IDENTITY ⟂ SECURITY VERDICT.
 *
 * Usage:
 *   node scripts/verify-security-semantic-diff.mjs --base <ref>   # default: main
 *   node scripts/verify-security-semantic-diff.mjs --check        # verify, do not write
 *
 * Exit codes:
 *   0 = security semantics unchanged
 *   1 = a security-deciding surface moved, or a forbidden field/coupling appeared
 */

import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const OUT_PATH = resolve(repoRoot, 'artifacts', 'global-distribution', 'security-semantic-diff.json')

/*
 * The packages that decide a verdict. Sourced from CLAUDE.md's architecture section:
 * static-analyzer produces findings, risk-engine computes the verdict, policy can block,
 * fingerprint decides reproducibility, types is the schema all output conforms to, and
 * core wires the pipeline. A change under any of these can move a verdict.
 *
 * `resolver` and `config-parser` are deliberately excluded: they decide what gets scanned,
 * not what the scan concludes. Discovery of a new host legitimately touches them, which is
 * exactly the kind of change this gate must permit.
 */
const VERDICT_PACKAGES = [
  'packages/risk-engine',
  'packages/static-analyzer',
  'packages/policy',
  'packages/types',
  'packages/fingerprint',
  'packages/core',
]

/* Forbidden by the distribution contract: each would make presence or popularity into a
 * security input. Searched as literals because that is how they would be introduced. */
const FORBIDDEN_FIELDS = [
  'HarnessRisk',
  'ModelRisk',
  'PlatformRisk',
  'MarketplaceRisk',
  'PopularityScore',
  'DemandScore',
  'SEOScore',
  'HarnessDatabase',
]

/* Identity tokens that must never appear in the risk engine. If a verdict can read the
 * host it runs under, the orthogonality claim is void. */
const IDENTITY_TOKENS = ['supportClass', 'agentType', 'harness', 'marketplace', 'popularity']

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function parseArgs(argv) {
  const opts = { base: 'main', check: false }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=')
    const value = inline ?? argv[i + 1]
    if (flag === '--base') {
      opts.base = value
      if (inline === undefined) i++
    } else if (flag === '--check') {
      opts.check = true
    }
  }
  return opts
}

const options = parseArgs(process.argv.slice(2))
const violations = []

/** (1) Did any verdict-deciding file change over the range, committed or not? */
function measureDiff(base) {
  const existing = VERDICT_PACKAGES.filter((p) => existsSync(resolve(repoRoot, p)))
  let mergeBase = null
  try {
    mergeBase = git(['merge-base', base, 'HEAD']).trim()
  } catch {
    // A missing base ref must not silently skip the measurement.
    violations.push(`could not resolve merge-base against "${base}" — range measurement did not run`)
    return { base, mergeBase: null, committedChanges: null, worktreeChanges: null, measured: false }
  }

  const committed = git(['diff', '--name-only', `${mergeBase}..HEAD`, '--', ...existing])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const worktree = git(['status', '--porcelain', '--', ...existing])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  if (committed.length > 0) {
    violations.push(`${committed.length} verdict-deciding file(s) changed in ${mergeBase.slice(0, 7)}..HEAD: ${committed.join(', ')}`)
  }
  if (worktree.length > 0) {
    violations.push(`${worktree.length} verdict-deciding file(s) modified in the worktree: ${worktree.join(', ')}`)
  }

  return {
    base,
    mergeBase,
    packagesMeasured: existing,
    committedChanges: committed,
    worktreeChanges: worktree,
    measured: true,
  }
}

/** (2) Do any forbidden risk fields exist in shipped source or published data? */
function measureForbiddenFields() {
  const found = {}
  for (const field of FORBIDDEN_FIELDS) {
    let hits = []
    try {
      hits = git(['grep', '-l', '--fixed-strings', field, '--', 'packages/', 'apps/', 'scripts/'])
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        // This gate names the fields in order to forbid them; that is not an occurrence.
        .filter((f) => f !== relative(repoRoot, fileURLToPath(import.meta.url)).replace(/\\/g, '/'))
    } catch {
      hits = [] // git grep exits 1 on no match, which is the passing case.
    }
    if (hits.length > 0) {
      found[field] = hits
      violations.push(`forbidden field "${field}" appears in: ${hits.join(', ')}`)
    }
  }
  return { fieldsChecked: FORBIDDEN_FIELDS, occurrences: found }
}

/** (3) Can the risk engine see host/model identity at all? */
function measureCoupling() {
  const found = {}
  for (const token of IDENTITY_TOKENS) {
    let hits = []
    try {
      hits = git(['grep', '-l', '--fixed-strings', token, '--', 'packages/risk-engine/src'])
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    } catch {
      hits = []
    }
    if (hits.length > 0) {
      found[token] = hits
      violations.push(`identity token "${token}" reaches the risk engine: ${hits.join(', ')}`)
    }
  }
  return { tokensChecked: IDENTITY_TOKENS, scope: 'packages/risk-engine/src', occurrences: found }
}

function main() {
  console.log('§18 security-semantic zero-diff\n')

  const diff = measureDiff(options.base)
  const fields = measureForbiddenFields()
  const coupling = measureCoupling()

  const changed = violations.length > 0

  const report = {
    schema: 'calllint.security-semantic-diff.v0',
    invariant: 'MODEL IDENTITY ⟂ SECURITY VERDICT',
    changed,
    violations,
    measurements: { diff, forbiddenFields: fields, coupling },
    howToReproduce: 'node scripts/verify-security-semantic-diff.mjs --base <ref>',
    note:
      'Generated by scripts/verify-security-semantic-diff.mjs. Do not hand-edit: a hand-written ' +
      '"changed": false is an unfalsifiable claim. Regenerate instead.',
  }

  console.log(`  diff:      ${diff.measured ? `${(diff.committedChanges || []).length} committed, ${(diff.worktreeChanges || []).length} worktree` : 'NOT MEASURED'} across ${VERDICT_PACKAGES.length} verdict packages`)
  console.log(`  fields:    ${Object.keys(fields.occurrences).length} of ${FORBIDDEN_FIELDS.length} forbidden fields present`)
  console.log(`  coupling:  ${Object.keys(coupling.occurrences).length} of ${IDENTITY_TOKENS.length} identity tokens reach the risk engine`)
  console.log('')

  if (changed) {
    console.error(`✗ SECURITY_SEMANTICS = CHANGED (${violations.length} violation(s)):`)
    for (const v of violations) console.error(`   - ${v}`)
  } else {
    console.log('✓ SECURITY_SEMANTICS = UNCHANGED')
  }

  if (options.check) {
    if (!existsSync(OUT_PATH)) {
      console.error(`\n✗ --check: ${relative(repoRoot, OUT_PATH)} does not exist`)
      process.exit(1)
    }
    const onDisk = JSON.parse(readFileSync(OUT_PATH, 'utf8'))
    if (onDisk.changed !== changed) {
      console.error(`\n✗ --check: committed artifact says changed=${onDisk.changed}, measured ${changed}`)
      process.exit(1)
    }
    console.log(`\n✓ --check: committed artifact agrees with the live measurement`)
  } else {
    mkdirSync(dirname(OUT_PATH), { recursive: true })
    writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(`\nWrote ${relative(repoRoot, OUT_PATH)}`)
  }

  process.exit(changed ? 1 : 0)
}

main()
