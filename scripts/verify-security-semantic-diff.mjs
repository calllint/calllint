#!/usr/bin/env node
/**
 * §18 security-semantic zero-diff gate.
 *
 * The distribution work is allowed to change how CallLint is FOUND. It is not allowed to
 * change what CallLint DECIDES. This script measures that separation and writes the
 * result to `artifacts/authority-distribution-closure/security-semantic-diff.json`.
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
const OUT_PATH = resolve(repoRoot, 'artifacts', 'authority-distribution-closure', 'security-semantic-diff.json')

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

/* ADR 0003: Additive TARGET_KINDS exemption. Adding a new file-format kind tells discovery
 * "this format is a config", not verdict logic "this host is safe/risky". The gate permits
 * additive changes ONLY: a removal or reordering still reds, and the parse is fail-closed. */
const TARGET_KINDS_FILE = 'packages/types/src/report.ts'

/* ADR 0006, narrowing 1: a test file cannot change what the product decides.
 *
 * Measured before adding this, not assumed: NO file under any `src/` in this repo imports from
 * a `test/` directory, so a test has no path into the shipped product. A test can only ASSERT
 * behaviour; changing one changes what is CLAIMED about a verdict, never the verdict itself.
 *
 * Without this, the gate reds on merely ADDING a test to a verdict package — i.e. it penalises
 * exactly the act that strengthens it. That is a defect, not conservatism.
 *
 * The pattern is anchored to a path SEGMENT (`/test/`), not a substring: a product file named
 * `src/testUtils.ts` must stay protected, and does. */
const TEST_PATH_SEGMENT = /(^|\/)(test|tests|__tests__)\//

/* ADR 0006, narrowing 2: append-only additive-vocabulary exemption.
 *
 * Files where a purely APPENDED block is exempt. `authority.ts` is verdict-deciding and stays
 * protected for every other kind of edit: `policy/src/decideOverAuthority.ts` imports it for
 * `baseVerdict(): Verdict`. What is exempt is narrower than the file — see the safety argument
 * on `isAppendOnlyChange`. */
const APPEND_ONLY_VOCAB_FILES = ['packages/types/src/authority.ts']

/**
 * Parse TARGET_KINDS array from a ref. Returns null on parse failure or absent file — the
 * exemption MUST NOT assume success and quietly permit a broken ref; fail-closed semantics.
 */
function parseTargetKinds(ref) {
  let content
  try {
    content = execFileSync('git', ['show', `${ref}:${TARGET_KINDS_FILE}`], { cwd: repoRoot, encoding: 'utf8' })
  } catch {
    return null // file absent at this ref
  }

  const start = content.search(/export\s+const\s+TARGET_KINDS\s*=\s*\[/)
  if (start === -1) return null
  const open = content.indexOf('[', start)

  /*
   * Scan to the matching `]`, tracking depth and skipping `//` comments and string bodies.
   *
   * WHY NOT A REGEX. The obvious `\[([^\]]+)\]` was the first implementation and it was WRONG
   * on the very entry that motivated this exemption: the comment `// Codex (TOML
   * [mcp_servers.*])` contains a `]`, so the match ended early and returned 8 of 10 entries.
   * `isAdditiveChange` then read the truncation as a REMOVAL and reported a violation — which
   * is the correct fail-closed outcome for a broken parse, and therefore hid the bug behind a
   * plausible red rather than a crash. A comment must not be able to move this gate's verdict.
   */
  let depth = 0
  let end = -1
  for (let i = open; i < content.length; i++) {
    const ch = content[i]
    if (ch === '/' && content[i + 1] === '/') {
      const nl = content.indexOf('\n', i)
      i = nl === -1 ? content.length : nl
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null // unbalanced — fail closed rather than guess

  const body = content.slice(open + 1, end).replace(/\/\/[^\n]*/g, '')
  const entries = body.match(/"([^"]+)"/g)
  return entries ? entries.map((e) => e.slice(1, -1)) : null
}

/**
 * True when HEAD's kinds are a superset of the base's — i.e. every kind the base declared is
 * still declared, and HEAD may have added more.
 *
 * WHY SET SEMANTICS AND NOT PREFIX SEMANTICS. The first implementation required the base to be
 * a positional prefix of HEAD, on the assumption that a new kind is appended. It is not: the
 * two kinds that motivated this exemption were inserted mid-array, next to the harnesses they
 * relate to, so the prefix check reported `additive=false` on a change that removed nothing.
 *
 * Order is safe to ignore here for a checkable reason, not a stylistic one: `TARGET_KINDS` has
 * exactly one consumer, `export type TargetKind = (typeof TARGET_KINDS)[number]`, and a union
 * of string literals is order-independent. Nothing indexes the array. If a consumer ever does
 * depend on position, this function is the wrong check and must be revisited.
 *
 * A REMOVAL still reds: dropping a kind narrows the union, which is a breaking schema change
 * and not the discovery addition ADR 0003 exempts.
 */
function isAdditiveChange(baseKinds, headKinds) {
  if (!baseKinds || !headKinds) return false // fail closed on an unreadable side
  const head = new Set(headKinds)
  return baseKinds.every((kind) => head.has(kind))
}

/**
 * True when the ONLY difference in report.ts between `ref` and HEAD lies inside the
 * TARGET_KINDS array — i.e. the file is byte-identical once the array is elided from both
 * sides.
 *
 * This is the half that makes the exemption cover a const rather than a file. `packages/types`
 * also declares `Verdict`, `RiskClass`, `PolicyAction` and `Finding`; without this check, an
 * edit to any of them passes as long as the same commit also appends a kind.
 *
 * Fail-closed: an unreadable side, or an array that cannot be located on either side, returns
 * false and the violation stands.
 */
function isOnlyTargetKindsChange(ref) {
  const elide = (content) => {
    if (content === null) return null
    const start = content.search(/export\s+const\s+TARGET_KINDS\s*=\s*\[/)
    if (start === -1) return null
    const open = content.indexOf('[', start)
    let depth = 0
    let end = -1
    for (let i = open; i < content.length; i++) {
      const ch = content[i]
      if (ch === '/' && content[i + 1] === '/') {
        const nl = content.indexOf('\n', i)
        i = nl === -1 ? content.length : nl
        continue
      }
      if (ch === '"' || ch === "'") {
        const quote = ch
        i++
        while (i < content.length && content[i] !== quote) {
          if (content[i] === '\\') i++
          i++
        }
        continue
      }
      if (ch === '[') depth++
      else if (ch === ']') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    if (end === -1) return null
    return content.slice(0, open + 1) + '/*ELIDED*/' + content.slice(end)
  }

  const read = (r) => {
    try {
      return execFileSync('git', ['show', `${r}:${TARGET_KINDS_FILE}`], { cwd: repoRoot, encoding: 'utf8' })
    } catch {
      return null
    }
  }

  const baseElided = elide(read(ref))
  const headElided = elide(read('HEAD'))
  if (baseElided === null || headElided === null) return false
  return baseElided === headElided
}

/**
 * Append-only exemption (ADR 0006, narrowing 2). True when HEAD's blob for `file` starts with
 * the base blob verbatim — i.e. the change appends a block at the end and leaves the rest
 * untouched. Fail-closed: an unreadable blob, or a blob that does not exist at base, returns
 * false (the file stays in violations).
 *
 * Security argument: an appended unreferenced block cannot change existing behaviour unless
 * something calls it. For a caller to invoke it, the caller must itself change — and if that
 * caller lives in a verdict package, it appears as a SEPARATE file in the diff and the gate
 * catches it. The only hole would be if a function already present in the file starts calling
 * the new code; but that requires modifying the existing function's body, which breaks the
 * "HEAD starts with base" check. Therefore append-only to a whitelisted file is safe given the
 * rest of the gate.
 *
 * This check is simpler and more robust than parsing: it verifies the invariant directly in
 * bytes, with no truncation risk and no parser. ADR 0003's bracket-tracking parser was correct,
 * but the exemption was still ONE byte away from silently widening — a stray `]` in a comment
 * caused it to truncate and fail closed, as intended. Append-only needs no parser at all.
 */
function isAppendOnlyChange(file, mergeBase) {
  const read = (ref) => {
    try {
      return execFileSync('git', ['show', `${ref}:${file}`], { cwd: repoRoot, encoding: 'utf8' })
    } catch {
      return null
    }
  }

  const base = read(mergeBase)
  const head = read('HEAD')
  if (base === null || head === null) return false
  return head.startsWith(base)
}

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
  let resolvedBase = null
  /*
   * Try the given ref, then its `origin/` form. A CI checkout has NO local `main`: measured on
   * a real clone of this repo, `git merge-base main HEAD` exits 128 with "Not a valid object
   * name main" even under `fetch-depth: 0`, because a clone brings remote-tracking refs and
   * only checks out the one branch. So the historical arm below failed for a reason unrelated
   * to its subject, and — correctly, per the fail-closed comment in the catch — reported
   * SECURITY_SEMANTICS = CHANGED on a diff that touches no verdict package at all.
   *
   * Fixing the caller alone would not have been enough, which is why this loop exists rather
   * than a `--base origin/main` in the workflow: the same green must be reachable locally,
   * where `main` DOES resolve and `origin/main` may be stale.
   */
  for (const candidate of [base, base.startsWith('origin/') ? null : `origin/${base}`].filter(Boolean)) {
    try {
      mergeBase = git(['merge-base', candidate, 'HEAD']).trim()
      resolvedBase = candidate
      break
    } catch {
      // Try the next spelling; a genuine absence is reported after the loop.
    }
  }
  if (mergeBase === null) {
    // A missing base ref must not silently skip the measurement.
    violations.push(`could not resolve merge-base against "${base}" — range measurement did not run`)
    return { base, mergeBase: null, committedChanges: null, worktreeChanges: null, measured: false }
  }

  const committed = git(['diff', '--name-only', `${mergeBase}..HEAD`, '--', ...existing])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  /* ADR 0003: Apply the TARGET_KINDS exemption. If report.ts is in the diff and the change
   * is ONLY an additive TARGET_KINDS modification, filter it out. Fail-closed: a parse error
   * or non-additive change keeps it in violations. */
  const filteredCommitted = committed.filter(file => {
    /* ADR 0006 narrowing 1: a test file is not shipped and cannot move a verdict. */
    if (TEST_PATH_SEGMENT.test(file)) {
      console.log(`  [ADR 0006] ${file} filtered: test file, not reachable from src`)
      return false
    }

    /* ADR 0006 narrowing 2: purely appended vocabulary in a whitelisted file. */
    if (APPEND_ONLY_VOCAB_FILES.includes(file)) {
      if (isAppendOnlyChange(file, mergeBase)) {
        console.log(`  [ADR 0006] ${file} filtered: append-only (existing content byte-identical)`)
        return false
      }
      return true  // an existing line moved, or a blob was unreadable — keep the violation
    }

    if (file !== TARGET_KINDS_FILE) return true  // unrelated file, keep it

    const baseKinds = parseTargetKinds(mergeBase)
    const headKinds = parseTargetKinds('HEAD')
    if (!isAdditiveChange(baseKinds, headKinds)) {
      return true  // removal, rename, or unreadable — keep the violation
    }

    /*
     * TWO conditions, not one. Additive kinds are necessary but NOT sufficient: the exemption
     * covers the CONST, not the FILE. Checking only the kinds let a `Verdict` edit ride through
     * on the same commit as a legitimate kind addition — caught by NC-C in
     * tests/invariants/target-kinds-exemption.invariants.test.ts, which is why that test exists.
     *
     * So the rest of the file must be byte-identical with the array elided from both sides.
     */
    if (!isOnlyTargetKindsChange(mergeBase)) {
      return true  // something else in report.ts moved too
    }

    // Exempted by ADR 0003. Logged so the run records why the file is absent from violations.
    console.log(`  [ADR 0003] ${TARGET_KINDS_FILE} filtered: additive TARGET_KINDS (${headKinds.length - baseKinds.length} added), rest of file unchanged`)
    return false
  })

  const worktree = git(['status', '--porcelain', '--', ...existing])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  if (filteredCommitted.length > 0) {
    violations.push(`${filteredCommitted.length} verdict-deciding file(s) changed in ${mergeBase.slice(0, 7)}..HEAD: ${filteredCommitted.join(', ')}`)
  }
  if (worktree.length > 0) {
    violations.push(`${worktree.length} verdict-deciding file(s) modified in the worktree: ${worktree.join(', ')}`)
  }

  return {
    base,
    // Which spelling actually resolved. Without this the artifact cannot say whether the range
    // was measured against a local branch or a remote-tracking ref — two different claims when
    // `origin/main` is behind, and the reader has no other way to tell them apart.
    resolvedBase,
    mergeBase,
    packagesMeasured: existing,
    committedChanges: filteredCommitted,  // now holds the filtered list
    committedChangesRaw: committed,      // preserve the unfiltered list for diagnostics
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
