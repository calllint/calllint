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
 *      "After 0.3.0 ships", "0.3.0-rc.0") in public current-status copy.
 *   9. The homepage hero headline "Before your agent acts, check the blast
 *      radius" is present.
 *  10. The homepage corpus section states "dangerous false-SAFE = 0".
 *  11. Agent-readable status files (llms.txt, llms-full.txt) state the
 *      current stable version from project-facts.json, not a stale one.
 *  12. README must not pin a hardcoded version line (e.g. "stable 0.3.x
 *      line") as the current stable release — use version-agnostic wording
 *      so it does not drift on every release.
 *  13. Homepage provenance copy must not imply the current release is a
 *      preview ("SLSA attestation on the preview" is stale wording).
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

console.log("")
if (exitCode === 0) {
  console.log("Public-copy guard: PASS")
} else {
  console.log("Public-copy guard: FAIL — see violations above")
}
process.exit(exitCode)
