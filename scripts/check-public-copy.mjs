#!/usr/bin/env node
/**
 * CallLint public-copy guard.
 *
 * Asserts that public-facing copy (website, README, agent-readable docs) stays
 * in sync with project-facts.json and within the safety boundary set by
 * LIMITATIONS.md / AGENTS.md. Run via `pnpm check:public-copy`.
 *
 * Checks:
 *   1. No primary install path uses `calllint@preview` (preview belongs only in
 *      release-channel / advanced notes).
 *   2. No forbidden overclaim phrases appear anywhere in public copy.
 *   3. Each required safety phrase appears at least once across public copy.
 *   4. SAFE verdict copy appears near "No blockers observed".
 *   5. Corpus numbers in the website match project-facts.json.
 *   6. The website corpus section reflects the current corpus phase.
 *   7. No stale `npx calllint@preview|@next scan` commands in public copy.
 *   8. No stale status phrases ("public preview", "release candidate",
 *      "After 0.3.0 ships", "0.3.0-rc.0", "pre-1.0") in public current-status copy.
 *   9. The homepage hero headline "Before your agent acts, check the blast
 *      radius" is present.
 *   9b. The homepage presents `scan --auto` (auto-discovery, v1.1.0) as a
 *      primary command — not a manual-path-only quickstart.
 *  10. The homepage corpus section states "dangerous false-SAFE = 0".
 *  11. Agent-readable status files (llms.txt, llms-full.txt) state the
 *      current stable version from project-facts.json, not a stale one.
 *  12. README must not pin a hardcoded version line (e.g. "stable 0.3.x
 *      line") as the current stable release — use version-agnostic wording
 *      so it does not drift on every release.
 *  13. Homepage provenance copy must not imply the current release is a
 *      preview ("SLSA attestation on the preview" is stale wording).
 *  14. README corpus numbers (calibrated cases, real/redacted snapshots,
 *      dangerous false-SAFE, UNKNOWN ratio) match project-facts.json.
 *  15. Generated Trust Pages (apps/web/public/trust/**) carry no forbidden
 *      overclaim — the ADR 0038 §2 language boundary (facts.trustPageForbiddenPhrases),
 *      enforced over the committed/served bytes, not just the renderer unit test.
 *  16. Every generated Trust HTML page carries the required boundary framing:
 *      the "not a certification … guarantee of safety" disclaimer and a
 *      correction link (ADR 0038 §5).
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks failed
 *   2  facts file or public files missing / unreadable
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const factsPath = path.join(repoRoot, "project-facts.json")
const publicFiles = [
  "apps/web/public/index.html",
  "apps/web/public/agents.html",
  "apps/web/public/mcp-security.html",
  "apps/web/public/cursor-mcp-security.html",
  "apps/web/public/claude-desktop-mcp-security.html",
  "apps/web/public/agent-tool-risk.html",
  "apps/web/public/agent-instructions.md",
  "apps/web/public/llms.txt",
  "apps/web/public/llms-full.txt",
  "README.md",
]

const primaryPathRegex = /npx calllint@preview scan/i
/** Stale release-channel commands that must not appear in public quickstart copy. */
const staleCommandRegex = /npx calllint@(preview|next) scan/i
/** Stale status phrases that must not appear anywhere in public current-status copy.
 *  Note: "release candidate" as a dist-tag description ("@next carries release
 *  candidates") is legitimate; only its use as a current-status claim is stale. */
const staleStatusPhrases = [
  "public preview",
  "After 0.3.0 ships",
  "0.3.0-rc.0",
  "pre-1.0",
]
/** Stale current-status claim patterns (regex, case-insensitive). */
const staleStatusPatterns = [
  /pre-1\.0 release candidate/i,
  /\bis a release candidate\b/i,
  /\bcurrently.*release candidate\b/i,
]
/** The hero headline the homepage must carry. */
const heroHeadline = "Before your agent acts, check the blast radius"

let exitCode = 0
const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  exitCode = 1
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

if (!fs.existsSync(factsPath)) {
  console.error(`Facts file not found: ${factsPath}`)
  process.exit(2)
}
const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"))

const readPublic = () =>
  publicFiles
    .map((rel) => path.join(repoRoot, rel))
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ rel: path.relative(repoRoot, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8") }))

const files = readPublic()
if (files.length === 0) {
  console.error("No public files found to check.")
  process.exit(2)
}
const allText = files.map((f) => f.text).join("\n")

console.log("Public-copy guard")
console.log(`Facts source: ${path.relative(repoRoot, factsPath)}`)
console.log(`Public files: ${files.map((f) => f.rel).join(", ")}`)
console.log("")

// 1. No primary @preview install path.
{
  const offenders = files.filter((f) => primaryPathRegex.test(f.text))
  if (offenders.length === 0) ok("no primary `npx calllint@preview scan` path")
  else for (const f of offenders) fail(`primary @preview path found in ${f.rel}`)
}

// 2. No forbidden overclaim phrases (case-insensitive).
{
  const lc = allText.toLowerCase()
  const found = facts.forbiddenPhrases.filter((p) => lc.includes(p.toLowerCase()))
  if (found.length === 0) ok("no forbidden overclaim phrases")
  else for (const p of found) fail(`forbidden phrase present: "${p}"`)
}

// 3. Required safety phrases present (at least once across all public copy).
{
  const lc = allText.toLowerCase()
  const missing = facts.requiredPhrases.filter((p) => !lc.includes(p.toLowerCase()))
  if (missing.length === 0) ok("all required safety phrases present")
  else for (const p of missing) fail(`required safety phrase missing: "${p}"`)
}

// 4. SAFE appears near "No blockers observed" (within 120 chars, case-insensitive).
{
  const re = /SAFE[\s\S]{0,120}No blockers observed/i
  if (re.test(allText)) ok("SAFE appears near \"No blockers observed\"")
  else fail("SAFE is not accompanied by \"No blockers observed\" within 120 chars")
}

// 4b. UNKNOWN appears near "never" or "not" SAFE (within 160 chars).
{
  const re = /UNKNOWN[\s\S]{0,160}(never|not)[\s\S]{0,20}SAFE/i
  if (re.test(allText)) ok("UNKNOWN appears near \"never/not ... SAFE\"")
  else fail("UNKNOWN is not accompanied by \"never/not ... SAFE\" within 160 chars")
}

// 5. Corpus numbers in the website match project-facts.json.
{
  const site = files.find((f) => f.rel === "apps/web/public/index.html")
  if (!site) fail("apps/web/public/index.html not found; cannot verify corpus numbers")
  else {
    const c = facts.corpus
    const ratioEsc = c.unknownRatio.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const checks = [
      [`calibratedCases = ${c.calibratedCases}`, new RegExp(`\\b${c.calibratedCases} calibrated cases\\b`)],
      [`realOrRedactedSnapshots = ${c.realOrRedactedSnapshots}`, new RegExp(`\\b${c.realOrRedactedSnapshots} real or redacted snapshots\\b`)],
      [`unknownRatio = ${c.unknownRatio}`, new RegExp(`UNKNOWN ratio ${ratioEsc}`)],
    ]
    for (const [label, re] of checks) {
      if (re.test(site.text)) ok(`corpus number matches: ${label}`)
      else fail(`corpus number mismatch: expected ${label}`)
    }
  }
}

// 6. Website corpus section reflects the current corpus phase.
{
  const site = files.find((f) => f.rel === "apps/web/public/index.html")
  if (!site) fail("apps/web/public/index.html not found; cannot verify corpus phase")
  else if (site.text.includes(`${facts.corpus.phase} · `)) ok(`corpus phase tag present: ${facts.corpus.phase}`)
  else fail(`corpus phase tag not found: expected "${facts.corpus.phase} · "`)
}

// 7. No stale @next/@preview quickstart commands anywhere in public copy.
{
  const offenders = files.filter((f) => staleCommandRegex.test(f.text))
  if (offenders.length === 0) ok("no stale `npx calllint@preview|@next scan` commands")
  else for (const f of offenders) fail(`stale release-channel command found in ${f.rel}`)
}

// 8. No stale status phrases anywhere in public copy.
{
  const lc = allText.toLowerCase()
  const found = staleStatusPhrases.filter((p) => lc.includes(p.toLowerCase()))
  if (found.length === 0) ok("no stale status phrases (public preview / After 0.3.0 ships / 0.3.0-rc.0)")
  else for (const p of found) fail(`stale status phrase present: "${p}"`)
  const patternHits = files.filter((f) => staleStatusPatterns.some((re) => re.test(f.text)))
  if (patternHits.length === 0) ok("no stale \"release candidate\" current-status claims")
  else for (const f of patternHits) fail(`stale "release candidate" status claim in ${f.rel}`)
}

// 9. Homepage hero headline present.
{
  const site = files.find((f) => f.rel === "apps/web/public/index.html")
  if (!site) fail("apps/web/public/index.html not found; cannot verify hero headline")
  else if (site.text.includes(heroHeadline)) ok(`hero headline present: "${heroHeadline}"`)
  else fail(`hero headline missing: expected "${heroHeadline}"`)
}

// 9b. Homepage must present `scan --auto` as the primary/zero-config command
//     (new7 A4: flagship auto-discovery must be visible on the homepage, not
//     buried behind a manual-path-only quickstart).
{
  const site = files.find((f) => f.rel === "apps/web/public/index.html")
  if (!site) fail("apps/web/public/index.html not found; cannot verify scan --auto presence")
  else if (/scan --auto/.test(site.text)) ok("homepage presents `scan --auto` (auto-discovery visible)")
  else fail("homepage does not mention `scan --auto` — auto-discovery (v1.1.0) must be visible on the homepage")
}

// 10. Homepage corpus section must state "0 dangerous false-SAFE".
{
  const site = files.find((f) => f.rel === "apps/web/public/index.html")
  if (!site) fail("apps/web/public/index.html not found; cannot verify dangerous false-SAFE line")
  else if (/dangerous false-SAFE\s*=\s*0/i.test(site.text)) ok("homepage states dangerous false-SAFE = 0")
  else fail('homepage missing "dangerous false-SAFE = 0" in corpus section')
}

// 11. Agent-readable status files state the current stable version.
{
  const sv = facts.stableVersion
  if (!sv) fail("project-facts.json missing stableVersion; cannot verify version drift")
  else {
    const statusFiles = files.filter((f) => f.rel === "apps/web/public/llms.txt" || f.rel === "apps/web/public/llms-full.txt")
    if (statusFiles.length === 0) ok("no llms status files to check (skipped)")
    else for (const f of statusFiles) {
      // The current stable version must appear; any prior stable (0.x.y != sv)
      // used as a *current status* claim is drift. We look for the bare version
      // token in a status line ("is `X.Y.Z` on the `latest`", "Version `X.Y.Z`").
      const currentStatusRe = new RegExp(String.raw`(?:is|Version)\s*\`?${sv.replace(/\./g, "\\.")}\`?\s+on\s+the\s+\`?latest\``, "i")
      if (currentStatusRe.test(f.text)) ok(`${f.rel} states current stable ${sv} on latest`)
      else fail(`${f.rel} does not state current stable ${sv} on latest (version drift)`)
    }
  }
}

// 12. README must not pin a hardcoded version line as the current stable release.
{
  const readme = files.find((f) => f.rel === "README.md")
  if (!readme) ok("README.md not in guarded set (skipped)")
  else {
    // Matches "stable `0.3.x` line" / "stable 0.3.x line" / "the 0.3.x line"
    // i.e. a specific minor segment declared as the stable line.
    const hardcodedStableLine = /stable\s*`?\d+\.\d+\.x`?\s+line/i
    if (hardcodedStableLine.test(readme.text)) fail('README pins a hardcoded version line as "stable" (use version-agnostic wording to avoid drift)')
    else ok('README uses version-agnostic stable-line wording (no hardcoded `0.x.x line`)')
  }
}

// 13. Homepage provenance copy must not imply the current release is a preview.
{
  const site = files.find((f) => f.rel === "apps/web/public/index.html")
  if (!site) fail("apps/web/public/index.html not found; cannot verify provenance copy")
  else if (/SLSA attestation\s+on\s+the\s+preview/i.test(site.text)) fail('homepage provenance says "SLSA attestation on the preview" — stale wording implying current release is a preview')
  else ok('homepage provenance copy does not imply current release is a preview')
}

// 14. README corpus numbers match project-facts.json (mirror of #5 for README,
//     which also hardcodes the calibrated/snapshot/UNKNOWN/false-SAFE figures).
{
  const readme = files.find((f) => f.rel === "README.md")
  if (!readme) fail("README.md not found; cannot verify README corpus numbers")
  else {
    const c = facts.corpus
    const ratioEsc = c.unknownRatio.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const checks = [
      [`calibratedCases = ${c.calibratedCases}`, new RegExp(`\\b${c.calibratedCases} calibrated cases\\b`)],
      [`realOrRedactedSnapshots = ${c.realOrRedactedSnapshots}`, new RegExp(`\\b${c.realOrRedactedSnapshots} real or redacted snapshots\\b`)],
      [`dangerousFalseSafe = ${c.dangerousFalseSafe}`, new RegExp(`\\b${c.dangerousFalseSafe} dangerous false-SAFE\\b`)],
      [`unknownRatio = ${c.unknownRatio}`, new RegExp(`UNKNOWN ratio ${ratioEsc}`)],
    ]
    for (const [label, re] of checks) {
      if (re.test(readme.text)) ok(`README corpus number matches: ${label}`)
      else fail(`README corpus number mismatch: expected ${label}`)
    }
  }
}

// 15/16. Generated Trust Pages language boundary (ADR 0038 §2/§5).
//   These are the committed + served bytes (apps/web/public/trust/**), not the
//   renderer's in-memory output — this guard is the serving-side backstop for the
//   package's reproducibility test. facts.trustPageForbiddenPhrases mirrors
//   TRUST_PAGE_FORBIDDEN_PHRASES in @calllint/trust-index; a repo test binds them.
{
  const trustRoot = path.join(repoRoot, "apps/web/public/trust")
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) return walk(abs)
      return /\.(html|json)$/.test(e.name) ? [abs] : []
    })
  }
  const trustFiles = walk(trustRoot).map((p) => ({
    rel: path.relative(repoRoot, p).split(path.sep).join("/"),
    text: fs.readFileSync(p, "utf8"),
  }))
  const forbidden = facts.trustPageForbiddenPhrases

  if (!Array.isArray(forbidden)) {
    fail("project-facts.json missing trustPageForbiddenPhrases; cannot guard Trust Pages")
  } else if (trustFiles.length === 0) {
    ok("no generated Trust Pages present yet (skipped 15/16)")
  } else {
    // 15. No forbidden overclaim in any served page.
    let clean = true
    for (const f of trustFiles) {
      const lc = f.text.toLowerCase()
      for (const p of forbidden) {
        if (lc.includes(p.toLowerCase())) {
          fail(`Trust Page overclaim in ${f.rel}: "${p}"`)
          clean = false
        }
      }
    }
    if (clean) ok(`no forbidden overclaim across ${trustFiles.length} Trust Page file(s)`)

    // 16. Every HTML page carries the required disclaimer + correction link.
    const htmlPages = trustFiles.filter((f) => f.rel.endsWith(".html"))
    let framed = true
    for (const f of htmlPages) {
      const hasDisclaimer = /not a certification/i.test(f.text) && /guarantee of safety/i.test(f.text)
      const hasCorrection = /Report a correction/i.test(f.text)
      if (!hasDisclaimer) { fail(`Trust Page ${f.rel} missing the "not a certification … guarantee of safety" disclaimer`); framed = false }
      if (!hasCorrection) { fail(`Trust Page ${f.rel} missing a correction link`); framed = false }
    }
    if (framed && htmlPages.length > 0) ok(`all ${htmlPages.length} Trust HTML page(s) carry the required boundary framing`)
  }
}

console.log("")
if (exitCode === 0) {
  console.log("Public-copy guard: PASS")
} else {
  console.log("Public-copy guard: FAIL — see violations above")
}
process.exit(exitCode)
