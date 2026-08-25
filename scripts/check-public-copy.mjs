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
 *  17. No PII (email-like token) on any served Trust Page — the registry is
 *      untrusted external input (ADR 0038 §5 "PII-free").
 *  18. Completeness: every retained registry snapshot entry is accounted for in
 *      the served index (baked or incomplete) — no silent drops (ADR 0038 §5).
 *  19. Claim-funnel state: every served Trust HTML page is either claimed (shows
 *      "Verified Publisher", no funnel) or unclaimed (shows the "claim this page"
 *      App install funnel + the control-not-safety framing) — DX-1, ADR 0047/0048.
 *  22. The presentation content plane (apps/web/content/**) is governed copy too
 *      (ADR 0058 §5 INV-P4): lifting wording out of TypeScript must not lift it out
 *      of the vocabulary gate. Every string leaf is scanned against the stricter
 *      corpus, must be plain text, and absence wording may never become denial
 *      wording (ADR 0058 §3).
 *  21. MCP tool descriptions (calllint-mcp) are governed like every other public
 *      string (ADR 0055 §3): the always-loaded Sentinel and every shipped tool
 *      description carry no forbidden overclaim and are never an injected instruction
 *      to the host agent (no "you must…"/"ignore…"/"always call … before…" imperative
 *      — a §七 forbidden method).
 *  25. new20 §13 trust leg: every clause of `headlines.trustLine` appears on EVERY
 *      per-host harness page, checked PER FILE. Check 3 tests the same phrases against
 *      the concatenated corpus, where one occurrence anywhere satisfies the whole site —
 *      which is why 18 pages could omit all of them while this gate printed a checkmark.
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

/**
 * The served web root whose top-level pages are governed copy. DISCOVERED, not enumerated.
 *
 * A hand-written list makes governance opt-in: a new top-level public page is ungoverned by
 * DEFAULT, and the guard reports green because it never looked. That is not hypothetical —
 * `team.html` shipped a price for an unlaunched product and was never scanned by any copy
 * gate, because adding a file to `public/` and adding a line to this script are two different
 * actions and only one of them is required to ship. Four further pages (`agent-use-cases.md`,
 * `report-schema.md`, `robots.txt`, `security-boundaries.md`) were silently unscanned for the
 * same reason. Discovery inverts the default: a page is governed because it is SERVED, and
 * removing it from the scan now requires deleting it from the web root.
 *
 * Depth 1 only: `trust/**` is generated and has its own stricter corpus (checks 15-19), and
 * `functions/**` is not copy.
 */
const PUBLIC_WEB_ROOT = "apps/web/public"
const PUBLIC_EXTENSIONS = [".html", ".md", ".txt"]
/** Governed copy outside the web root: the repo's own public front door. */
const EXTRA_PUBLIC_FILES = ["README.md"]
/** Public GitHub surfaces — the issue chooser is public product copy (see check 23). */
const ISSUE_TEMPLATE_DIR = ".github/ISSUE_TEMPLATE"

const discoverPublicFiles = () => {
  const root = path.join(repoRoot, PUBLIC_WEB_ROOT)
  const served = fs.existsSync(root)
    ? fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isFile() && PUBLIC_EXTENSIONS.includes(path.extname(e.name)))
        .map((e) => `${PUBLIC_WEB_ROOT}/${e.name}`)
        .sort()
    : []
  const templateDir = path.join(repoRoot, ISSUE_TEMPLATE_DIR)
  const templates = fs.existsSync(templateDir)
    ? fs
        .readdirSync(templateDir, { withFileTypes: true })
        .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
        .map((e) => `${ISSUE_TEMPLATE_DIR}/${e.name}`)
        .sort()
    : []
  return [...served, ...EXTRA_PUBLIC_FILES, ...templates]
}

const publicFiles = discoverPublicFiles()

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
/** The public GitHub App claim funnel (mirrors CLAIM_APP_URL in @calllint/trust-index).
 *  An UNCLAIMED Trust Page must invite a claim via this URL; a CLAIMED page must not
 *  show the funnel (it shows the Verified Publisher overlay instead) — check 19. */
const claimAppUrl = "https://github.com/apps/calllint-trust"

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

// 11c. Install commands are single-sourced from project-facts.json `install`.
//      Each advertised command must appear VERBATIM in the surface(s) that carry it,
//      so the site/llms copy can never drift from the one authoritative source
//      (new11 §1.1). `scan`/`scanCi`/`mcpServer` are advertised on the homepage AND
//      the agent-readable status files; `integrate` is surfaced only in the status
//      files today, so it is checked there (never invented on a surface that lacks it).
{
  const install = facts.install
  if (!install) fail("project-facts.json missing `install` block; cannot verify install-command single source")
  else {
    const homepage = files.find((f) => f.rel === "apps/web/public/index.html")
    const statusFiles = files.filter(
      (f) => f.rel === "apps/web/public/llms.txt" || f.rel === "apps/web/public/llms-full.txt",
    )
    // command → the surfaces that must carry it verbatim.
    const surfacesFor = (key) => {
      const onHomepage = key === "scan" || key === "scanCi" || key === "mcpServer"
      return [...(onHomepage && homepage ? [homepage] : []), ...statusFiles]
    }
    // `install.scan` is the canonical form of the legacy `defaultInstallCommand`.
    if (install.scan !== facts.defaultInstallCommand) {
      fail(`install.scan (${install.scan}) must equal defaultInstallCommand (${facts.defaultInstallCommand})`)
    } else ok("install.scan is the single source for defaultInstallCommand")
    for (const [key, cmd] of Object.entries(install)) {
      if (key === "description") continue
      const targets = surfacesFor(key)
      if (targets.length === 0) {
        fail(`install.${key}: no served surface available to verify "${cmd}"`)
        continue
      }
      const missing = targets.filter((f) => !f.text.includes(cmd))
      if (missing.length === 0) ok(`install.${key} present verbatim in served copy: "${cmd}"`)
      else for (const f of missing) fail(`install.${key} "${cmd}" missing from ${f.rel} (install-command drift)`)
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

    // 17. No PII on the public surface (ADR 0038 §5 "PII-free"). The registry is
    //   external, untrusted input; a stray contact address must never reach a served
    //   page. Flag any email-like token (also catches URL userinfo `user@host`).
    const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    let piiClean = true
    for (const f of trustFiles) {
      const m = f.text.match(EMAIL)
      if (m) { fail(`Trust Page PII (email-like) in ${f.rel}: "${m[0]}"`); piiClean = false }
    }
    if (piiClean) ok(`no PII (email-like) across ${trustFiles.length} Trust Page file(s)`)

    // 18. Completeness — no silent drops (ADR 0038 §5). Every entry in a retained
    //   snapshot must appear in the served index (baked OR incomplete). We assert the
    //   count invariant: #index entries in a source's namespace == snapshot.count.
    const snapPath = path.join(repoRoot, "packages/trust-index/snapshots/official-mcp-registry.json")
    const indexPath = path.join(trustRoot, "index.json")
    if (fs.existsSync(snapPath) && fs.existsSync(indexPath)) {
      const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"))
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8"))
      const inNs = (index.entries || []).filter((e) => (e.canonicalName || "").startsWith("mcp-registry/")).length
      if (inNs === snap.count) ok(`completeness: all ${snap.count} registry snapshot entries accounted for in the index`)
      else fail(`completeness: snapshot has ${snap.count} entries but index lists ${inNs} under mcp-registry/ (silent drop)`)
    } else {
      ok("no registry snapshot present yet (skipped 18)")
    }

    // 19. Claim funnel boundary (DX-1, ADR 0047 §1 / 0048 §6). Every served Trust
    //   HTML page is EITHER claimed (shows "Verified Publisher") OR unclaimed (shows
    //   the "claim this page" invitation into the public App install funnel). The two
    //   are mutually exclusive: an unclaimed page MUST carry the claim funnel URL and
    //   the control-not-safety framing; a claimed page MUST NOT carry the funnel.
    let claimClean = true
    // The fixed verdict-disclaimer line every claimed surface MUST carry
    // verbatim (Phase 2.5-D / ADR 0055 §1(a)). Additive strengthening of this
    // guard: it can only require one more honest sentence, never weaken a rule.
    const VERDICT_DISCLAIMER = "Identity verification does not change the CallLint verdict."
    for (const f of htmlPages) {
      const claimed = /Verified Publisher/.test(f.text)
      const hasFunnel = f.text.includes(claimAppUrl)
      if (claimed && hasFunnel) {
        fail(`Trust Page ${f.rel} is claimed yet still shows the claim funnel (should show Verified Publisher only)`)
        claimClean = false
      }
      if (!claimed && !hasFunnel) {
        fail(`Trust Page ${f.rel} is unclaimed but is missing the claim funnel (${claimAppUrl})`)
        claimClean = false
      }
      // An unclaimed page's CTA must frame claiming as control, never safety.
      if (!claimed && hasFunnel && !/not a safety claim/i.test(f.text)) {
        fail(`Trust Page ${f.rel} claim CTA is missing the "not a safety claim" framing`)
        claimClean = false
      }
      // A page that names a Verified Publisher MUST carry the fixed verdict
      // disclaimer verbatim (ADR 0055 §1(a)).
      if (claimed && !f.text.includes(VERDICT_DISCLAIMER)) {
        fail(`Trust Page ${f.rel} names a Verified Publisher but is missing the fixed line: "${VERDICT_DISCLAIMER}"`)
        claimClean = false
      }
    }
    if (claimClean && htmlPages.length > 0) ok(`all ${htmlPages.length} Trust HTML page(s) carry the correct claim-funnel state`)

    // 20. No bare SAFE (Gate A / PR-D2, ADR 0053 §5). A page that shows the public
    //   SAFE label ("No blockers observed") must never present it alone — it MUST be
    //   scoped by the four-dimension status block: the evidence level (E0–E6) AND a
    //   completeness statement. "SAFE" is always an observation at a stated evidence
    //   level, never an unqualified pass. This is the serving-side backstop for the
    //   renderer; the reproducibility test binds the two.
    const SAFE_LABEL = "No blockers observed"
    let scopedClean = true
    for (const f of htmlPages) {
      if (!f.text.includes(SAFE_LABEL)) continue
      const hasEvidenceLevel = /Evidence level:/i.test(f.text) && /\bE[0-6]\b/.test(f.text)
      const hasCompleteness = /Evidence completeness:/i.test(f.text)
      if (!hasEvidenceLevel || !hasCompleteness) {
        fail(`Trust Page ${f.rel} shows SAFE ("${SAFE_LABEL}") without the scope block (evidence level + completeness) — bare SAFE is forbidden`)
        scopedClean = false
      }
    }
    const safePages = htmlPages.filter((f) => f.text.includes(SAFE_LABEL)).length
    if (scopedClean && safePages > 0) ok(`all ${safePages} SAFE Trust Page(s) scope the label with an evidence level + completeness (no bare SAFE)`)
    else if (safePages === 0) ok("no SAFE Trust Pages present to scope (skipped 20)")
  }
}

// 15b/16b/17b. Safe-install acquisition surface language boundary (Phase 2.4 / ADR 0056).
//   The served /install/**.html pages + the /.well-known/calllint.json discovery manifest
//   are public bytes with the SAME boundary as a Trust Page — a verdict-derived install
//   route is exactly where an overclaim ("certified safe", "calllint approved") or stray
//   PII would do the most damage. We scan them under the identical guards so the boundary
//   can never be bypassed by shipping copy through the install plane instead of the trust
//   plane. Framing (16b) is required on the HTML pages only (the manifest is pure JSON with
//   no prose). These checks are ADDITIVE — they can only demand more honesty, never less.
{
  const installRoot = path.join(repoRoot, "apps/web/public/install")
  const walkI = (dir) => {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) return walkI(abs)
      return /\.(html|json)$/.test(e.name) ? [abs] : []
    })
  }
  const wellKnown = path.join(repoRoot, "apps/web/public/.well-known/calllint.json")
  const installFiles = [...walkI(installRoot), ...(fs.existsSync(wellKnown) ? [wellKnown] : [])].map(
    (p) => ({ rel: path.relative(repoRoot, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8") }),
  )
  const forbidden = facts.trustPageForbiddenPhrases
  const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
  if (installFiles.length === 0) {
    ok("no Safe-install acquisition pages present yet (skipped 15b/16b/17b)")
  } else if (!Array.isArray(forbidden)) {
    fail("project-facts.json missing trustPageForbiddenPhrases; cannot guard Safe-install pages")
  } else {
    // 15b. No forbidden overclaim on any served install page or the discovery manifest.
    let clean = true
    for (const f of installFiles) {
      const lc = f.text.toLowerCase()
      for (const p of forbidden) {
        if (lc.includes(p.toLowerCase())) { fail(`Safe-install overclaim in ${f.rel}: "${p}"`); clean = false }
      }
    }
    if (clean) ok(`no forbidden overclaim across ${installFiles.length} Safe-install file(s)`)

    // 16b. Every install HTML page carries the same boundary framing as a Trust Page.
    const installHtml = installFiles.filter((f) => f.rel.endsWith(".html"))
    let framed = true
    for (const f of installHtml) {
      const hasDisclaimer = /not a certification/i.test(f.text) && /guarantee of safety/i.test(f.text)
      const hasCorrection = /Report a correction/i.test(f.text)
      if (!hasDisclaimer) { fail(`Safe-install page ${f.rel} missing the "not a certification … guarantee of safety" disclaimer`); framed = false }
      if (!hasCorrection) { fail(`Safe-install page ${f.rel} missing a correction link`); framed = false }
    }
    if (framed && installHtml.length > 0) ok(`all ${installHtml.length} Safe-install HTML page(s) carry the required boundary framing`)

    // 17b. No PII (email-like) on any served install page or the discovery manifest.
    let piiClean = true
    for (const f of installFiles) {
      const m = f.text.match(EMAIL)
      if (m) { fail(`Safe-install PII (email-like) in ${f.rel}: "${m[0]}"`); piiClean = false }
    }
    if (piiClean) ok(`no PII (email-like) across ${installFiles.length} Safe-install file(s)`)
  }
}

// 22. The presentation CONTENT PLANE is governed public copy (ADR 0058 §5 INV-P4).
//   Workstream P moves human wording out of TypeScript and into apps/web/content/**, so
//   without this check the vocabulary gate would have a hole exactly the size of the
//   refactor: every phrase the guard forbids in a served page would become editable in a
//   file the guard never reads. Configuration is where copy is EASIEST to change and
//   hardest to review, so it gets the STRICTER corpus — trust-page forbidden phrases
//   (the served-bytes boundary) plus the general overclaim list — applied to string
//   leaves only, recursively, wherever they sit in the document.
//
//   Two additional rules, each guarding a failure this plane specifically enables:
//     (a) NO MARKUP. Renderers escape text, so a tag could not inject — it would emit
//         visible entities. Refusing `<`/`>` here keeps that from ever being tested in
//         production, and matches the resolver's structural floor.
//     (b) NO DENIAL WORDING in absence copy (ADR 0058 §3). "We did not observe X" and
//         "X is denied" are different claims; only the first is true. The plane must not
//         be the place someone quietly upgrades an observation into a verdict.
{
  const contentRoot = path.join(repoRoot, "apps/web/content")
  const walkC = (dir) => {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) return walkC(abs)
      return /\.json$/.test(e.name) ? [abs] : []
    })
  }
  const contentFiles = walkC(contentRoot)
  if (contentFiles.length === 0) {
    ok("no presentation content plane present yet (skipped 22)")
  } else {
    // Every string leaf, with its JSON pointer — so a violation names the slot to fix,
    // not just the file. Keys are skipped: they are the schema's vocabulary, not copy.
    const leaves = (value, at) => {
      if (typeof value === "string") return [{ at, value }]
      if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${at}/${i}`))
      if (value !== null && typeof value === "object") {
        return Object.entries(value).flatMap(([k, v]) => leaves(v, `${at}/${k}`))
      }
      return []
    }
    // `schema`/`locale` are machine tokens, not copy; scanning them would only produce
    // noise (and they are digest-bound identifiers, checked by the schema validator).
    const MACHINE_POINTERS = new Set(["/schema", "/locale"])
    // Denial vocabulary forbidden in ABSENCE copy (ADR 0058 §3 — absence is an
    // observation, never a verdict). Scoped to the absence slots by pointer.
    const DENIAL_WORDS = [/\bdenied\b/i, /\bimpossible\b/i, /\bcannot\b/i, /\bblocked\b/i, /\bforbidden\b/i]
    const forbidden = [
      ...(Array.isArray(facts.trustPageForbiddenPhrases) ? facts.trustPageForbiddenPhrases : []),
      ...(Array.isArray(facts.forbiddenPhrases) ? facts.forbiddenPhrases : []),
    ]
    if (forbidden.length === 0) {
      fail("project-facts.json missing forbidden-phrase corpora; cannot guard the content plane")
    }
    let contentClean = true
    let leafCount = 0
    for (const abs of contentFiles) {
      const rel = path.relative(repoRoot, abs).split(path.sep).join("/")
      let parsed
      try {
        parsed = JSON.parse(fs.readFileSync(abs, "utf8"))
      } catch (err) {
        fail(`content plane ${rel} is not parseable JSON: ${err.message}`)
        contentClean = false
        continue
      }
      for (const { at, value } of leaves(parsed, "")) {
        if (MACHINE_POINTERS.has(at)) continue
        leafCount += 1
        const lc = value.toLowerCase()
        for (const p of forbidden) {
          if (lc.includes(p.toLowerCase())) {
            fail(`content-plane overclaim in ${rel}${at}: "${p}"`)
            contentClean = false
          }
        }
        if (/[<>]/.test(value)) {
          fail(`content-plane markup in ${rel}${at}: copy must be plain text (renderers escape it)`)
          contentClean = false
        }
        if (at.includes("absencePhrases")) {
          for (const re of DENIAL_WORDS) {
            if (re.test(value)) {
              fail(`content-plane denial wording in ${rel}${at}: absence is an observation, not a verdict (ADR 0058 §3) — matched ${re}`)
              contentClean = false
            }
          }
        }
      }
    }
    if (contentClean) {
      ok(`no forbidden copy across ${leafCount} content-plane string leaf/leaves in ${contentFiles.length} file(s)`)
    }
  }
}

// 21. MCP tool descriptions are governed public copy (ADR 0055 §3). The Sentinel
//   (`calllint_guard_external_tools`) and every shipped calllint-mcp tool description
//   is a public string the host agent reads, so it must (a) carry no forbidden
//   overclaim (same corpus as check 2) and (b) never be an injected instruction —
//   copy that redirects/coerces/impersonates the agent's turn ("you must…", "ignore…",
//   "always call … before…") is a §七 forbidden method. We scan the committed source
//   text of tools.ts (this guard runs under plain `node`, so it reads bytes, never
//   imports the TS module) — the same discipline as every other check here.
{
  const toolsPath = path.join(repoRoot, "packages/calllint-mcp/src/tools.ts")
  if (!fs.existsSync(toolsPath)) {
    ok("calllint-mcp tools.ts not present (skipped 21)")
  } else {
    const src = fs.readFileSync(toolsPath, "utf8")
    // Pull every `description:` string literal from the TOOLS registry. Descriptions
    // are authored as a `description:` key followed by a single- or double-quoted
    // string (possibly wrapped across lines by the formatter); capture the literal.
    const descriptions = []
    const re = /\bdescription:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g
    let m
    while ((m = re.exec(src)) !== null) {
      // Unquote + unescape enough to scan the human text.
      const raw = m[1].slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, " ")
      descriptions.push(raw)
    }
    if (descriptions.length === 0) {
      fail("check 21: no tool descriptions found in tools.ts (regex drift?)")
    } else {
      const joined = descriptions.join("\n").toLowerCase()
      // (a) No forbidden overclaim (reuse the project-facts corpus).
      const overclaim = facts.forbiddenPhrases.filter((p) => joined.includes(p.toLowerCase()))
      if (overclaim.length === 0) ok(`no forbidden overclaim across ${descriptions.length} MCP tool description(s)`)
      else for (const p of overclaim) fail(`MCP tool description overclaim: "${p}"`)
      // (b) Never an injected instruction to the host agent (§七 forbidden method).
      const injectionPhrases = [
        "you must",
        "ignore previous",
        "ignore the",
        "always call",
        "you should always",
        "do not proceed until",
        "disregard",
      ]
      const injected = injectionPhrases.filter((p) => joined.includes(p))
      if (injected.length === 0) ok("no MCP tool description is an injected instruction (honest presence only)")
      else for (const p of injected) fail(`MCP tool description carries an injection imperative: "${p}"`)
    }
  }
}

// 23. Commercial boundary. While `facts.commercial.paidOfferLive === false`, no public
//   current-product surface may present a price, a paid tier, a purchase path, or a
//   permanence commitment about what is free. This is keyed on a FACT, not on a list of
//   banned pages: the offending page is not special, the claim is. `team.html` sold
//   "$99 / org / month" for a product with no checkout, no billing, and no launch, and the
//   design-partner issue template repeated the figure through the public issue chooser —
//   both invisible to this guard because neither was in its file list (now discovered).
//
//   Two distinct claim families, separated because they fail for different reasons:
//     (a) PRICE / PURCHASE — states a cost or a way to pay for something not for sale.
//     (b) PERMANENCE — "free forever" / "stays free" is an unbounded future commitment.
//         It reads as generous and is the harder one to walk back: it binds a pricing
//         decision that has not been made. Describing what the CLI does today is fine;
//         promising what it will cost in perpetuity is not.
//
//   Scoped to public copy (the discovered set). `docs/**` internal planning notes are not
//   a current-product surface and are deliberately out of scope. CHANGELOG is not scanned
//   anywhere in this guard, so a historical entry naming a withdrawn experiment is safe.
{
  const commercial = facts.commercial
  if (!commercial || typeof commercial.paidOfferLive !== "boolean") {
    fail(
      "check 23: project-facts.json has no `commercial.paidOfferLive` boolean — the commercial " +
        "boundary cannot be enforced without an authoritative fact stating whether a paid offer is live",
    )
  } else if (commercial.paidOfferLive) {
    // A paid offer IS live: pricing copy is legitimate, but it must agree with the fact.
    ok("commercial.paidOfferLive = true — price copy permitted (amount consistency not asserted here)")
  } else {
    if (commercial.publicPrice !== null) {
      fail(
        `check 23: commercial.paidOfferLive = false but publicPrice = ${JSON.stringify(commercial.publicPrice)} — ` +
          "a price with no live offer is the exact inconsistency this check exists to prevent",
      )
    }
    // (a) Price / purchase claims.
    const pricePatterns = [
      [/\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:\/|\bper\b)?\s*(?:org|seat|user|month|mo\b|year|yr\b)/i, "price amount with a billing unit"],
      [/\b\d+\s*(?:usd|eur|gbp)\b\s*(?:\/|\bper\b)\s*(?:month|org|seat|user|year)/i, "price amount with a billing unit"],
      [/\bper\s+(?:org|seat|user)\s*\/\s*month\b/i, "per-unit monthly billing"],
      [/\b(?:start|begin|upgrade to|subscribe to)\s+(?:a\s+)?(?:paid|pro|team|enterprise)\s+(?:plan|tier|subscription)\b/i, "purchase path for a paid tier"],
      // NOTE: bare "checkout" is NOT a payment signal in developer copy — `actions/checkout@v4`
      // appears in the homepage's CI sample. Match the payment sense only.
      [/\b(?:buy now|billing portal|enter your card|payment method|credit card|start (?:your )?free trial)\b/i, "checkout / payment surface"],
      [/\b(?:checkout|payment)\s+(?:page|flow|link|session)\b/i, "checkout / payment surface"],
    ]
    // (b) Permanence commitments about price.
    const permanencePatterns = [
      [/\bfree\s+forever\b/i, "unbounded permanence commitment"],
      [/\bforever\s+free\b/i, "unbounded permanence commitment"],
      [/\bstays?\s+free\b/i, "unbounded permanence commitment"],
      [/\bwill\s+(?:always\s+)?(?:remain|stay|be)\s+free\b/i, "unbounded permanence commitment"],
      [/\balways\s+(?:be\s+)?free\b/i, "unbounded permanence commitment"],
    ]
    let commercialClean = true
    for (const f of files) {
      for (const [re, label] of [...pricePatterns, ...permanencePatterns]) {
        const m = re.exec(f.text)
        if (m) {
          fail(
            `commercial claim in ${f.rel}: ${label} — matched "${m[0].trim()}". ` +
              "No paid offer is live (commercial.paidOfferLive = false).",
          )
          commercialClean = false
        }
      }
    }
    if (commercialClean) {
      ok(`no price, purchase path, or permanence commitment across ${files.length} public file(s) (no paid offer live)`)
    }
  }
}

// 24. new18 §29 — the private usage surface must not leak into any public surface.
//
//   §29 WAS fail-closed: Cloudflare Access on `usage.calllint.com` could not be verified from
//   CI, so the report initially shipped as an artifact only. On 2026-08-24, Access was
//   manually configured and verified (artifacts/authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md),
//   satisfying §29's requirement. The workflow can now deploy to the authenticated host.
//
//   §29 then names nine surfaces private usage "must never appear in": calllint.com nav,
//   footer, README, llms.txt, llms-full.txt, sitemap, robots, agent instructions, harness pages.
//
//   That prohibition held before this check existed — and nothing enforced it. An unguarded
//   true statement is one careless edit from being a false one, and the failure is silent:
//   a link in a footer is exactly what turns a private host into an indexed one.
//
//   TWO DESIGN DECISIONS, both learned from this guard's own history:
//
//   (a) The cohort is BUILT HERE, not inherited. `discoverPublicFiles()` takes depth-1
//       `.html/.md/.txt` under the web root, which misses two of the nine surfaces outright:
//       sitemaps are `.xml`, and harness pages live in per-host SUBDIRECTORIES. Reusing
//       `files` would have scanned neither while printing a checkmark — the repo's dominant
//       fault class. So the sitemap and harness sets are globbed separately and their sizes
//       are asserted BEFORE any claim is made about their contents.
//
//   (b) The needle is the HOST, not the word "usage". `## Basic Usage` appears in llms.txt
//       and llms-full.txt as CLI documentation, and a naive /usage/i would red on both. What
//       §29 forbids is a reference to the private surface, so the tokens are the things that
//       can only mean that surface: the hostname, a public /usage path, and the artifact name.
{
  /* Tokens that can only denote the private usage surface. Deliberately NOT the bare word
   * "usage" — see (b). `dist/usage` is the generator's out dir, which would only appear on a
   * public surface if someone pasted a build path into copy. */
  const PRIVATE_USAGE_TOKENS = [
    "usage.calllint.com",
    "calllint.com/usage",
    "/usage/",
    "dist/usage",
    "usage-report",
  ]

  /** Recursive glob by extension, relative POSIX paths. */
  const walk = (absDir, exts) => {
    if (!fs.existsSync(absDir)) return []
    const out = []
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      const full = path.join(absDir, e.name)
      if (e.isDirectory()) out.push(...walk(full, exts))
      else if (exts.includes(path.extname(e.name))) out.push(path.relative(repoRoot, full).split(path.sep).join("/"))
    }
    return out
  }

  const webRoot = path.join(repoRoot, PUBLIC_WEB_ROOT)
  const sitemaps = walk(webRoot, [".xml"]).filter((r) => r.endsWith("sitemap.xml"))
  const harnessPages = walk(path.join(webRoot, "harnesses"), [".html"])
  /* nav + footer live in the served HTML; robots/llms/agent-instructions are depth-1 text
   * files already in `files`; README is in EXTRA_PUBLIC_FILES. */
  const depthOne = files.map((f) => f.rel)

  /* ANTI-VACUITY, asserted before any prohibition. Each floor is below the measured count
   * (2 sitemaps, 20 harness pages) so ordinary growth does not red it, while a collapse to
   * an empty scan does. Without these three, deleting the web root would make §29 "pass". */
  let cohortSound = true
  if (sitemaps.length < 2) {
    fail(`check 24: found ${sitemaps.length} sitemap(s) under ${PUBLIC_WEB_ROOT}; §29 names "sitemap" and this scan would be vacuous`)
    cohortSound = false
  }
  if (harnessPages.length < 10) {
    fail(`check 24: found ${harnessPages.length} harness page(s); §29 names "harness pages" and this scan would be vacuous`)
    cohortSound = false
  }
  /* The named text surfaces must actually be in the inherited set — if one is renamed away,
   * this check must red rather than silently stop covering it. */
  const NAMED = [
    `${PUBLIC_WEB_ROOT}/llms.txt`,
    `${PUBLIC_WEB_ROOT}/llms-full.txt`,
    `${PUBLIC_WEB_ROOT}/robots.txt`,
    `${PUBLIC_WEB_ROOT}/agent-instructions.md`,
    `${PUBLIC_WEB_ROOT}/index.html`,
    "README.md",
  ]
  const missingNamed = NAMED.filter((rel) => !depthOne.includes(rel))
  if (missingNamed.length > 0) {
    fail(`check 24: §29 names surfaces absent from the scanned set: ${missingNamed.join(", ")}`)
    cohortSound = false
  }

  if (cohortSound) {
    const cohort = [...new Set([...depthOne, ...sitemaps, ...harnessPages])]
    const offenders = []
    for (const rel of cohort) {
      const abs = path.join(repoRoot, rel)
      if (!fs.existsSync(abs)) continue
      const text = fs.readFileSync(abs, "utf8")
      const hits = PRIVATE_USAGE_TOKENS.filter((t) => text.toLowerCase().includes(t.toLowerCase()))
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(", ")}`)
    }
    if (offenders.length === 0) {
      ok(
        `no private-usage reference on any of ${cohort.length} public surface(s) ` +
          `(${sitemaps.length} sitemap, ${harnessPages.length} harness, nav/footer/README/llms/robots/agent-instructions) — new18 §29`,
      )
    } else {
      for (const o of offenders) fail(`private usage surface leaked into public copy (new18 §29): ${o}`)
    }
  }

  /* §29's other half: the report is "a workflow artifact only". A guard on the nine surfaces
   * says nothing about the workflow that could publish a tenth. This asserts the workflow
   * uploads and does not deploy or commit — the fail-closed posture itself. */
  const wfRel = ".github/workflows/usage-report.yml"
  const wfAbs = path.join(repoRoot, wfRel)
  if (!fs.existsSync(wfAbs)) {
    fail(`check 24: ${wfRel} not found — §28 requires the workflow to exist in-repo`)
  } else {
    const wf = fs.readFileSync(wfAbs, "utf8")

    // After Access verification (2026-08-24), §29 permits Cloudflare Pages deploy
    // to the authenticated host, BUT ONLY IF the workflow itself verifies the gate.
    // A deploy without an automated gate-check is a fail-open posture: if Access
    // gets deleted, the deploy keeps running and the report becomes public. So:
    //
    //   - Cloudflare wrangler deploy is PERMITTED, but ONLY when a verification step
    //     is present that probes the host unauthenticated and fails if content leaks.
    //   - GitHub Pages and repo commits are FORBIDDEN (still public surfaces).
    //   - upload-artifact is REQUIRED (operator must have local access to the report).
    //
    // The fail-closed discipline: CI cannot read the Access policy object, but it
    // CAN observe its effect — an unauthenticated GET must land on the sign-in gate.
    const FORBIDDEN_ALWAYS = [
      ["actions/deploy-pages", "deploys to GitHub Pages"],
      ["peaceiris/actions-gh-pages", "pushes to a Pages branch"],
      ["git push", "commits back to the repo"],
      ["git commit", "commits back to the repo"],
    ]
    const forbidden = FORBIDDEN_ALWAYS.filter(([t]) => wf.includes(t))
    if (forbidden.length > 0) {
      for (const [t, why] of forbidden) {
        fail(`private usage report ${why} via "${t}" in ${wfRel} — §29 forbids public Pages and repo commits`)
      }
    }

    // Cloudflare deploy is only allowed when a verification step is present.
    const hasCloudflareDeploy =
      wf.includes("wrangler pages deploy") || wf.includes("cloudflare/wrangler-action")
    const hasAccessVerification = wf.includes("Verify Access gate is enforcing")

    if (hasCloudflareDeploy && !hasAccessVerification) {
      fail(
        `${wfRel} deploys via wrangler but has no "Verify Access gate is enforcing" step — ` +
          `§29 permits Cloudflare deploy only when the workflow itself checks the gate`
      )
    }

    if (!wf.includes("actions/upload-artifact")) {
      fail(`${wfRel} has no upload-artifact step; §29 requires the report to exist as a workflow artifact`)
    }

    if (hasCloudflareDeploy && hasAccessVerification) {
      ok(
        `private usage report follows §29: artifact uploaded, Cloudflare deploy with gate verification, ` +
          `no public Pages/commits`
      )
    } else if (!hasCloudflareDeploy) {
      ok(`private usage report follows §29: artifact uploaded, no deploy path (fail-closed)`)
    }
    /* hasCloudflareDeploy && !hasAccessVerification already failed above — no ok() here,
     * so the gate never prints a checkmark for a state it just rejected. */
  }
}

// 25. new20 §13 trust leg — the safety phrases must hold PER HOST PAGE, not site-wide.
//
//   WHY THIS EXISTS WHEN CHECK 3 ALREADY CHECKS THE SAME PHRASES. Check 3 tests
//   `allText` — every governed file concatenated — so ONE occurrence anywhere satisfies a
//   phrase for the whole site. That is the right semantics for a phrase that only needs to
//   be sayable somewhere, and the wrong semantics for a page a visitor lands on directly.
//   Combined with `discoverPublicFiles()`'s depth-1 scan, which excludes
//   `harnesses/<host>/index.html` entirely, 18 generated pages could omit every safety
//   phrase while this gate printed a checkmark. Both properties are deliberate and neither
//   is a bug on its own; together they left §13's trust leg unobserved.
//
//   MEASURED BEFORE THIS CHECK WAS WRITTEN (2026-08-23, on the tree at 185b8db): 0 of 18
//   host pages asserted no-execution, 0 asserted determinism. The verdict-semantics
//   paragraph sat inside the template's `{{#if activation.installCommand}}`, so the 9 hosts
//   with no start path lost the safety framing as a side effect — correlation exact, zero
//   mismatches. The negative control for check 3's blindness: replacing the sole "never
//   executes" in llms.txt with a placeholder still printed `✓ all required safety phrases
//   present` and exited 0, because the homepage satisfied it on the redacted file's behalf.
//
//   THE SUBJECT IS THE GOVERNED SENTENCE, NOT HAND-PICKED WORDING. `headlines.trustLine` is
//   the single source every host page renders verbatim, and its clauses are what §13's three
//   concepts map onto. Asserting the field rather than a literal here means editing the
//   sentence updates the gate — the alternative is a second copy of governed wording inside
//   its own guard, which is the defect this whole plane is built to avoid.
{
  /** Recursive glob by extension, relative POSIX paths. */
  const walkExt = (absDir, exts) => {
    if (!fs.existsSync(absDir)) return []
    const out = []
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      const full = path.join(absDir, e.name)
      if (e.isDirectory()) out.push(...walkExt(full, exts))
      else if (exts.includes(path.extname(e.name))) out.push(path.relative(repoRoot, full).split(path.sep).join("/"))
    }
    return out
  }

  const harnessRoot = path.join(repoRoot, PUBLIC_WEB_ROOT, "harnesses")
  /* Per-HOST pages only. `harnesses/index.html` is the hub (a link list, not a host page)
   * and `harnesses/deepseek/` is a model-intent landing page; neither carries a verdict for
   * a specific host, so neither is in this cohort. Both are still governed by checks 2/3
   * and by check 24. */
  const HUB = `${PUBLIC_WEB_ROOT}/harnesses/index.html`
  const LANDING_PREFIX = `${PUBLIC_WEB_ROOT}/harnesses/deepseek/`
  const hostPages = walkExt(harnessRoot, [".html"])
    .filter((r) => r !== HUB && !r.startsWith(LANDING_PREFIX))
    .sort()

  /* The trust sentence is the subject. Split into clauses so a failure names WHICH concept
   * is missing rather than dumping a 130-character string — a page missing determinism and a
   * page missing the whole section are different defects with different fixes. */
  const trustLine = facts.headlines?.trustLine
  /* ANTI-VACUITY, both halves asserted before any claim about the pages.
   *
   * The floor is 10 against a measured 18: ordinary growth must not red it, but a collapse
   * to an empty or near-empty scan must. Without it, deleting the harness tree would make
   * this check "pass" — the exact shape of the blindness it was written to close. The same
   * floor and the same reason as check 24. */
  let sound = true
  if (!trustLine) {
    fail("check 25: project-facts.json has no `headlines.trustLine`; the per-page trust assertion would be vacuous")
    sound = false
  }
  if (hostPages.length < 10) {
    fail(`check 25: found ${hostPages.length} host page(s) under harnesses/; §13's trust leg is about these pages and this scan would be vacuous`)
    sound = false
  }

  if (sound) {
    /* Sentence-split on ". " — trustLine is authored as independent sentences and each one
     * is a separate claim. Empty fragments are dropped, and the clause count is asserted
     * below so a reworded single-sentence trustLine cannot silently shrink the check to one
     * assertion. */
    const clauses = trustLine
      .split(/(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (clauses.length < 3) {
      fail(`check 25: trustLine split into ${clauses.length} clause(s); §13 names three concepts (no-execution, determinism, verdict semantics) and this check would under-assert`)
    } else {
      const offenders = []
      for (const rel of hostPages) {
        const text = fs.readFileSync(path.join(repoRoot, rel), "utf8")
        const missing = clauses.filter((c) => !text.includes(c))
        if (missing.length > 0) offenders.push(`${rel} is missing: ${missing.map((c) => JSON.stringify(c)).join(", ")}`)
      }
      if (offenders.length === 0) {
        ok(
          `all ${clauses.length} trustLine clause(s) present on each of ${hostPages.length} host page(s), ` +
            `checked per-file — new20 §13 trust leg`,
        )
      } else {
        for (const o of offenders) fail(`host page omits governed trust copy (new20 §13): ${o}`)
      }
    }
  }
}

console.log("")
if (exitCode === 0) {
  console.log("Public-copy guard: PASS")
} else {
  console.log("Public-copy guard: FAIL — see violations above")
}
process.exit(exitCode)
