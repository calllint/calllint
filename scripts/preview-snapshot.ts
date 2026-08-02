#!/usr/bin/env tsx
/**
 * Workstream P Batch 7 — the PREVIEW & SNAPSHOT harness (new15 §14 PR P-6; ADR 0058).
 *
 * The I/O half of the observer/evaluator split. Every measurement lives in
 * `packages/trust-index/src/previewSnapshot.ts` and is pure; this script does the
 * reading and hands the bytes over. That is why each of §14's four blocks is
 * unit-testable without a bake, and why the observer cannot quietly become a second
 * renderer.
 *
 * §14 declares five acceptance-gate blocks. P-6 built the first four; PR P-7 adds the
 * fifth, and until then nothing ran any of them:
 *
 *   1. 配置完整性 — every copy domain a page reads from is TOTAL, and no configured key
 *      is dead or duplicated. Duplicates are measured over the RAW catalog bytes, because
 *      `JSON.parse` collapses them last-wins and a parsed check is structurally blind.
 *   2. 页面一致性 — same CTA route ⇒ same structure; different route ⇒ DIFFERENT structure.
 *      The second half is load-bearing: a signature that collapsed to a constant would
 *      satisfy the first half perfectly while measuring nothing.
 *   3. 安全隔离 — five zero-counts, all graded. Three had no grader before P-6, including
 *      the one that matters most: nothing ever rendered a hostile publisher blurb into
 *      HTML and counted it.
 *   4. 视觉回归 — browserless, and the scope is stated rather than implied: which
 *      declarations apply (var()-resolved) and how the one grid reflows. Zero `@media`
 *      is ASSERTED, because `resolveDeclarations` is a flat rule walk with no nesting
 *      support, so a media query would be silently mis-parsed.
 *   5. 可回滚性 (PR P-7) — the version exists, every deploy is recorded, and any recorded
 *      digest restores its document. Graded as ONE block because the three are one loop.
 *
 * WHY THE ROLLBACK CORPUS COMES FROM THE COMMITTED LEDGER AND NOT FROM `git show`. This
 * script runs inside CI in `--check` mode, which REBUILDS the artifact and byte-compares
 * it, and `ci.yml`'s checkout is bare — depth 1. Measured on a depth-1 clone of this repo:
 * `git log --follow` on the catalog returns 1 commit rather than 8, the historical blobs
 * report MISSING, and `merge-base --is-ancestor` fatals on an unknown sha instead of
 * returning false. A git-derived corpus would therefore make the byte-compare fail on
 * every CI run forever. The deeper point: if past documents existed only in git history,
 * then on a shallow clone they do not exist at all, and §14's 可按 digest 恢复 would be
 * FALSE there rather than merely ungraded. So each ledger entry stores its document, and
 * this script reads committed JSON only — no git, at all, anywhere in the graded path.
 *
 * The corpus is the five canonical fixtures, NOT the served tree. Measured reason: the 19
 * committed pages carry exactly one structural signature and only two verdicts, so grading
 * "同一 verdict 的页面结构一致" against them would pass while never exercising BLOCK,
 * UNKNOWN or UNSUPPORTED. The served tree stays in scope for the zero-containment
 * measurement, where its uniformity is irrelevant.
 *
 * Modes (same contract as `pnpm audit:presentation`):
 *   (default) --check : the committed artifact must be byte-identical to a fresh run.
 *   --write           : (re)generate it.
 *   --gate            : ENFORCEMENT. Exit 2 unless every block passes.
 *
 * Exit codes: 0 ok · 1 drift (--check) · 2 gate failed (--gate) / unexpected error.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { GUARD_ARTIFACTS, GUARD_HOST_IDS, RULE_HOSTS, persistentComponentFor } from "@calllint/core"
import { HOST_ADAPTERS } from "@calllint/install-planner"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import {
  CANONICAL_FIXTURES,
  PRIMARY_CTA,
  PROBE_SENTINEL,
  PUBLISHER_INJECTION_BLURBS,
  canonicalProjection,
  ctaRoutePartition,
  signatureConditionals,
  structuralSignature,
  evaluateHumanCapsule,
  gradePreviewSnapshot,
  loadPresentationIfPresent,
  parseRootTokens,
  renderSafeInstall,
  resolvePresentation,
  safeInstallProjection,
  semanticContractDigest,
  canonicalProjectionInput,
  validatePresentationContent,
  LEVEL_BY_SECTION,
  WIRED_SLOTS,
  CODE_OWNED_SLOTS,
  type CanonicalFixture,
  type HostCopyFacts,
  type InjectionSample,
  type PageSample,
  type PresentationContentV1,
  type RollbackCorpusMember,
  type SentinelSample,
  type StylesheetSample,
} from "../packages/trust-index/src/index.js"
// The ledger's OFFLINE validator and its types. Importing the script is safe: its mode
// dispatch is guarded on `invokedDirectly`, measured the hard way — an unguarded top-level
// dispatch made a probe exit with the CLI's code before its first assertion.
import { validateOffline, type DeployLedger } from "./presentation-ledger.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outPath = path.join(repoRoot, "artifacts", "phase-2.4", "preview-snapshot.json")

/** The two committed copies of the L0 plane — source and served (PR P-4b). */
const STYLESHEETS: readonly string[] = ["apps/web/styles/tokens.css", "apps/web/public/styles/tokens.css"]

/** The committed catalog, read as RAW BYTES for the duplicate-key measurement. */
const CATALOG = "apps/web/content/safe-install/presentation.v1.json"

/**
 * Per-object duplicate keys in a JSON document, found WITHOUT parsing.
 *
 * `JSON.parse` collapses a duplicate last-wins and returns a clean object, so a parsed
 * check cannot see this class of defect at all — the document would validate, one of the
 * two values would silently win, and a reviewer diffing the parsed form would find nothing.
 * §14's "无重复 key" is therefore only measurable over the bytes.
 *
 * The walk is a minimal string-aware scanner rather than a regex: it tracks nesting depth
 * and string state so a `{` inside a copy string cannot open a phantom object, and it keys
 * duplicates by JSON pointer so the failure names WHERE rather than just WHICH.
 */
function rawDuplicateKeys(json: string): string[] {
  const dups: string[] = []
  // One frame per open object; arrays push a frame with `keys: null` so their indices are
  // not mistaken for keys. `pointer` mirrors the frame stack for the failure message.
  const stack: { keys: Set<string> | null; pointer: string }[] = []
  let i = 0
  let pendingKey: string | null = null

  const readString = (): string => {
    // `i` is at the opening quote.
    let out = ""
    i += 1
    while (i < json.length) {
      const ch = json[i] as string
      if (ch === "\\") {
        out += ch + (json[i + 1] ?? "")
        i += 2
        continue
      }
      if (ch === '"') {
        i += 1
        return out
      }
      out += ch
      i += 1
    }
    return out
  }

  while (i < json.length) {
    const ch = json[i] as string
    if (ch === '"') {
      const value = readString()
      const frame = stack.at(-1)
      // A string is a KEY only when the next non-space character is `:` and we are directly
      // inside an object. Anything else is a value, including every copy string.
      let j = i
      while (j < json.length && /\s/.test(json[j] as string)) j += 1
      if (json[j] === ":" && frame && frame.keys !== null) {
        if (frame.keys.has(value)) dups.push(`${frame.pointer}/${value}`)
        frame.keys.add(value)
        pendingKey = value
      }
      continue
    }
    if (ch === "{" || ch === "[") {
      const parent = stack.at(-1)
      const base = parent ? parent.pointer : ""
      stack.push({
        keys: ch === "{" ? new Set<string>() : null,
        pointer: pendingKey === null ? base : `${base}/${pendingKey}`,
      })
      pendingKey = null
      i += 1
      continue
    }
    if (ch === "}" || ch === "]") {
      stack.pop()
      pendingKey = null
      i += 1
      continue
    }
    if (ch === ",") pendingKey = null
    i += 1
  }
  return dups.sort()
}

/** Every committed served install page, in stable path order. */
function servedInstallPages(): { slug: string; html: string }[] {
  const root = path.join(repoRoot, "apps", "web", "public", "install")
  if (!fs.existsSync(root)) return []
  const out: { slug: string; html: string }[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === "index.html") {
        const slug = path.relative(root, path.dirname(p)).split(path.sep).join("/")
        out.push({ slug, html: fs.readFileSync(p, "utf8") })
      }
    }
  }
  walk(root)
  return out
}

/**
 * How many grid items `.install-cta-row` actually holds — MEASURED off the rendered page.
 *
 * The reflow prediction needs an item count, and assuming "2 because the deep-link page has
 * two buttons" would make the arithmetic a restatement of the assumption. Counting the row's
 * own children means a renderer that added a third CTA moves the prediction on its own.
 *
 * Both `<a>` AND `<button>` count: the shipped row is an anchor plus a copy BUTTON, so an
 * anchor-only count would report 0 items for a row that visibly holds 2 — and the reflow
 * arithmetic would then be measured on a grid with nothing in it. `install-cta-pair-note`
 * sits outside the row and is not an item.
 */
function ctaRowItemCount(html: string): number {
  const open = html.indexOf('class="install-cta-row"')
  if (open === -1) return 0
  // The row is a single `<div>`; take its body up to the matching close by scanning for the
  // next `</div>` at the same nesting depth as the row itself.
  const from = html.indexOf(">", open)
  if (from === -1) return 0
  let depth = 1
  let i = from + 1
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div", i)
    if (nextClose === -1) break
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + 4
      continue
    }
    depth -= 1
    i = nextClose + 5
  }
  const body = html.slice(from + 1, Math.max(from + 1, i - 5))
  return (body.match(/<(?:a|button)\b/g) ?? []).length
}

/**
 * A full-sentinel presentation document: every configurable copy slot set to the sentinel.
 *
 * The shape source is the COMMITTED CATALOG, not `EMPTY_PRESENTATION_CONTENT`. That choice is
 * load-bearing and was found by negative control #14: the canonical empty document is
 * `{schema, locale}` — it declares no copy section at all, so "walk the document and replace
 * every string leaf" fills NOTHING. A sentinel derived from it resolves to the shipped
 * defaults, the reprojection equals the baseline, and the invariance check passes by comparing
 * a value against itself. The catalog is the honest source because the lock's
 * `resolvesToDefaults` already proves it carries every section and restates every default, so
 * filling its leaves yields a document that differs from the baseline in copy and NOTHING else.
 *
 * Deriving the sentinel by WALKING that document (rather than hand-listing slots) is what keeps
 * it total as sections are added — a new copy section is sentinel-filled automatically instead
 * of quietly escaping the check.
 */
function sentinelPresentation(): unknown {
  const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, CATALOG), "utf8")) as Record<
    string,
    unknown
  >
  const fill = (node: unknown): unknown => {
    if (typeof node === "string") return PROBE_SENTINEL
    if (Array.isArray(node)) return node.map(fill)
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = fill(v)
      return out
    }
    return node
  }
  const filled = fill(doc) as Record<string, unknown>
  // `contentVersion` is a machine token, not copy; sentinel-filling it would make the whole
  // document invalid and the probe would measure a rejection rather than an invariance.
  filled["contentVersion"] = (doc as { contentVersion?: unknown }).contentVersion
  return filled
}

/** Build the artifact. No clock, no RNG — byte-stable across runs. */
function build(): { json: string; pass: boolean; failures: readonly string[] } {
  // --- the corpus: five canonical fixtures, one per Installability -------------
  const resolved = loadPresentationIfPresent()
  const pages: PageSample[] = CANONICAL_FIXTURES.map((fixture: CanonicalFixture) => {
    const projection = canonicalProjection(fixture)
    const html = renderSafeInstall(projection, resolved.sectionTitles, resolved.layout, resolved.tokens)
    return {
      id: fixture.id,
      installability: projection.installability,
      projection,
      html,
      capsule: evaluateHumanCapsule(projection, html),
    }
  })

  // --- block 1 inputs ---------------------------------------------------------
  const catalogBytes = fs.readFileSync(path.join(repoRoot, CATALOG), "utf8")
  const hostCopy: HostCopyFacts[] = GUARD_HOST_IDS.map((host) => {
    const component = persistentComponentFor(host)
    return {
      host,
      label: GUARD_ARTIFACTS[host].label,
      artifactPath: GUARD_ARTIFACTS[host].artifactPath,
      uninstallCommand: component.uninstallCommand,
    }
  })
  // The threshold the eval artifact DECLARES, read from the committed artifact so it is
  // graded rather than self-certifying. Before P-6 nothing read this number at all: it sat
  // at 3 while all five fixtures measured 5, and the artifact contradicted itself in the
  // same file. Reading it here is what turns a recorded number into a measured one.
  const evalArtifactPath = path.join(repoRoot, "artifacts", "phase-2.4", "human-five-second-test.json")
  const declaredMaxAuthorityFacts = fs.existsSync(evalArtifactPath)
    ? ((JSON.parse(fs.readFileSync(evalArtifactPath, "utf8")) as { thresholds?: { maxAuthorityFacts?: number } })
        .thresholds?.maxAuthorityFacts ?? 0)
    : 0

  // --- block 3 inputs: hostile publisher text through the shipped seam --------
  //
  // `canonicalProjection(fixture, blurb)` is the injection seam that already exists — the
  // second parameter IS `publisherDescription`. Using it means the blurb travels the same
  // path a real publisher string travels, rather than being spliced into HTML by the test.
  const injectionFixture = CANONICAL_FIXTURES[0] as CanonicalFixture
  const injections: InjectionSample[] = PUBLISHER_INJECTION_BLURBS.map((blurb) => {
    const projection = canonicalProjection(injectionFixture, blurb)
    return {
      fixtureId: injectionFixture.id,
      blurb,
      html: renderSafeInstall(projection, resolved.sectionTitles, resolved.layout, resolved.tokens),
      agentGuidance: projection.agentContract.agentGuidance,
      routeKey: routeKeyOf(projection),
    }
  })

  // The sentinel invariance: a full sentinel-copy presentation AND sentinel tokens must not
  // move the semantic contract digest. Derived through the SAME constructor from a sentinel,
  // never asserted against a literal — a hardcoded digest cannot detect its own subject
  // changing, which is the self-certification trap this repo keeps removing.
  const sentinelResolved = resolvePresentation(sentinelPresentation())
  const sentinels: SentinelSample[] = CANONICAL_FIXTURES.map((fixture) => {
    const baseline = canonicalProjection(fixture)
    // Re-project the SAME input under the sentinel presentation, so the only difference is
    // the copy plane. `ProjectionPresentation` is `{ primaryCta, authority }` — those are the
    // two slices that actually reach a projection, and `authority` is the one that reaches the
    // contract builder (through its `selection` argument). Passing the sentinel there is what
    // makes the invariance claim non-trivial: sentinel copy on a slice the projection never
    // reads would be an invariance nothing could have broken.
    const sentinelProjection = safeInstallProjection({
      ...canonicalProjectionInput(fixture),
      presentation: {
        primaryCta: sentinelResolved.primaryCta,
        authority: sentinelResolved.authority,
      },
    })
    // The witness that the sentinel reached a surface at all. Rendered with the SENTINEL's own
    // resolved copy, because that is the plane the sentinel occupies — rendering it with the
    // baseline's copy would look empty and make the witness lie in the safe direction.
    const sentinelHtml = renderSafeInstall(
      sentinelProjection,
      sentinelResolved.sectionTitles,
      sentinelResolved.layout,
      sentinelResolved.tokens,
    )
    const baselineHtml = renderSafeInstall(baseline, resolved.sectionTitles, resolved.layout, resolved.tokens)
    return {
      fixtureId: fixture.id,
      baselineSemanticDigest: semanticContractDigest(baseline.agentContract).semanticContractDigest,
      sentinelSemanticDigest: semanticContractDigest(sentinelProjection.agentContract).semanticContractDigest,
      baselineRouteKey: routeKeyOf(baseline),
      sentinelRouteKey: routeKeyOf(sentinelProjection),
      sentinelReachedSurface: sentinelHtml.includes(PROBE_SENTINEL),
      baselineFreeOfSentinel: !baselineHtml.includes(PROBE_SENTINEL),
    }
  })

  // --- block 4 inputs: the two stylesheet copies ------------------------------
  const stylesheets: StylesheetSample[] = STYLESHEETS.filter((rel) =>
    fs.existsSync(path.join(repoRoot, rel)),
  ).map((rel) => {
    const css = fs.readFileSync(path.join(repoRoot, rel), "utf8")
    return { path: rel, css, tokens: parseRootTokens(css).tokens }
  })

  // --- block 5 inputs: 可回滚性 ------------------------------------------------
  // Committed JSON only. See the header for the depth-1 measurement that rules git out of
  // this path, and `scripts/presentation-ledger.ts` for the two-layer trust model: the
  // offline layer called here proves each entry SELF-CONSISTENT, and `--validate` adds the
  // git layer that proves it AUTHENTIC. That limit is stated rather than papered over.
  const liveDocument = JSON.parse(catalogBytes) as PresentationContentV1
  const ledger = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "artifacts", "phase-2.4", "presentation-deploy-ledger.json"), "utf8"),
  ) as DeployLedger
  const corpus: RollbackCorpusMember[] = ledger.deploys.map((e) => ({
    commit: e.commit.slice(0, 8),
    at: e.at,
    presentationDigest: e.presentationDigest,
    l0Digest: e.l0Digest,
    l1Digest: e.l1Digest,
    l2Digest: e.l2Digest,
    configVersion: e.configVersion,
    sections: e.sections,
    document: e.document,
  }))

  const contentSchema = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "schemas", "calllint.presentation-content.v1.schema.json"), "utf8"),
  ) as { properties?: Record<string, unknown> }

  // The validator's context, built from the SHIPPED constants exactly as the lock builds it
  // (`scripts/presentation-lock.ts:368`). It is a parameter rather than an import inside the
  // validator for the reason its own docblock gives: a local copy of the label and CTA maps
  // would drift from the bytes they govern. Passing the real ones keeps both probes below
  // running through the same rules the catalog is actually held to.
  const facts = JSON.parse(fs.readFileSync(path.join(repoRoot, "project-facts.json"), "utf8")) as {
    forbiddenPhrases: string[]
    trustPageForbiddenPhrases: string[]
  }
  const validationCtx = {
    verdictLabels: VERDICT_PUBLIC_LABEL,
    stateCtas: PRIMARY_CTA,
    forbiddenPhrases: [...facts.forbiddenPhrases, ...facts.trustPageForbiddenPhrases],
  }

  // The validator's accepted key set, measured BEHAVIOURALLY rather than imported. `known`
  // is function-local inside the validator, so any exported mirror of it would be a second
  // copy free to drift from the one that actually decides. Instead: feed the validator a
  // document carrying `configVersion` and confirm it does not report the key as unknown.
  const versionRejectedAsUnknown = validatePresentationContent(
    { ...liveDocument, configVersion: "probe-1" },
    validationCtx,
  ).some((e) => e.rule === "unknown-section" && e.path === "/configVersion")
  const validatorKnownKeys = [
    ...Object.keys(LEVEL_BY_SECTION),
    "schema",
    "locale",
    ...(versionRejectedAsUnknown ? [] : ["configVersion"]),
  ]

  // A deliberately malformed version through the REAL validator. Prose is the shape that
  // must be refused, since a prose version would be renderable copy.
  const malformedVersionRules = validatePresentationContent(
    { ...liveDocument, configVersion: "August 2026 rebuild" },
    validationCtx,
  ).map((e) => e.rule)

  const deployWorkflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "deploy-web.yml"), "utf8")

  const result = gradePreviewSnapshot({
    configIntegrity: {
      catalog: {
        duplicateKeys: rawDuplicateKeys(catalogBytes),
        unwiredSlots: resolved.unwiredSlots,
        rejectedSlots: resolved.rejectedSlots,
      },
      hostCopy,
      vocabularies: {
        guardHostIds: [...GUARD_HOST_IDS],
        ruleHosts: [...RULE_HOSTS],
        hostAdapters: Object.keys(HOST_ADAPTERS),
      },
      installabilityStates: pages.map((p) => p.installability),
      declaredMaxAuthorityFacts,
      measuredAuthorityFactCounts: pages.map((p) => ({
        id: p.id,
        facts: (p.html.match(/<li data-observed=/g) ?? []).length,
      })),
    },
    pageConsistency: { pages },
    securityIsolation: {
      injections,
      sentinels,
      baselineRouteKeys: Object.fromEntries(pages.map((p) => [p.id, routeKeyOf(p.projection)])),
    },
    visualRegression: {
      stylesheets,
      pages,
      ctaRowItems: Object.fromEntries(pages.map((p) => [p.id, ctaRowItemCount(p.html)])),
    },
    rollback: {
      corpus,
      liveDocument,
      ledgerFaults: validateOffline(ledger, liveDocument),
      ledgerEntryCount: ledger.deploys.length,
      // Anchored text bindings. `REGRESSION_CHECKS` can only bind `ci.yml`#`test` — every
      // one of its 19 rows is that job — and `deploy-web.yml` has a single `deploy:` job
      // graded by nothing. So the workflow is verified AS TEXT here, which is the same
      // idiom and the same fault class as a row bound to no workflow job.
      //
      // Both probes read the workflow as LINES, and `.gitattributes` does NOT cover
      // `.github/workflows/**`, so the bytes on disk depend on the checkout: LF locally and
      // on the POSIX runners, CRLF on `windows-latest`, whose `core.autocrlf` defaults to
      // true. The first version of the permissions probe spelled the line break as a literal
      // `\n` and went red on windows-latest ALONE — reporting a write permission that
      // `deploy-web.yml` does not have. A checkout artifact must not be able to manufacture a
      // fault, so the line break is matched as `\r?\n`: what is under test is the workflow's
      // permissions, not the line endings of the machine that cloned it.
      //
      // Bind the INVOKED COMMAND, not the word. `presentationDigest` appears in that step's
      // own explanatory comment, so a probe for the word would keep passing after someone
      // deleted the command — the "mentions ≠ does" trap, which this repo has already paid
      // for once. (`\s` already spans `\r`, so this one was newline-safe by accident;
      // measured on both shapes rather than assumed.)
      deployWorkflowRecordsDigest: /^\s*pnpm ledger:presentation:validate:offline\b/m.test(deployWorkflow),
      deployWorkflowPermissionsReadOnly:
        /^permissions:\r?\n  contents: read\s*$/m.test(deployWorkflow) &&
        !/contents:\s*write/.test(deployWorkflow),
      schemaPropertyNames: Object.keys(contentSchema.properties ?? {}),
      validatorKnownKeys,
      // Every slot the resolver can fill, flattened from BOTH tables. `configVersion` must
      // appear in neither: an identity key is validated and digested, never resolved.
      resolverSlotNames: [
        ...Object.entries(WIRED_SLOTS).flatMap(([section, slots]) =>
          (slots as readonly string[]).map((s) => `${section}.${s}`),
        ),
        ...Object.entries(CODE_OWNED_SLOTS).flatMap(([section, slots]) =>
          Object.keys(slots as Record<string, string>).map((s) => `${section}.${s}`),
        ),
        ...Object.keys(WIRED_SLOTS),
        ...Object.keys(CODE_OWNED_SLOTS),
      ],
      malformedVersionRules,
      // The COMMITTED pages, so the version's value is searched for in the bytes that ship.
      // Read here rather than in the observer, which stays filesystem-free.
      servedInstallPages: servedInstallPages(),
    },
  })

  const served = servedInstallPages()

  const report = {
    schema: "calllint.preview-snapshot.v0",
    $comment:
      "Workstream P preview & snapshot harness (new15 §14 PR P-6/P-7; ADR 0058) — the FIVE acceptance-gate blocks §14 declares and nothing ran before these PRs (P-6 built the first four; P-7 added 可回滚性). The corpus is the five CANONICAL FIXTURES, not the served tree, and that is a measured choice: the 19 committed pages carry exactly ONE structural signature and only two verdicts, so grading page consistency against them would pass while never exercising BLOCK, UNKNOWN or UNSUPPORTED. pageConsistency PARTITIONS on the CTA route because dispositionBlock genuinely emits two different structures (DEEP_LINK_STATES vs its complement, 2 vs 3 states); within a partition the signature must be IDENTICAL and across partitions it must DIFFER — the cross-partition inequality is the load-bearing half, since a signature that collapsed to a constant would satisfy 'identical within a partition' perfectly while measuring nothing. Every tolerated structural variance carries the assertion of the condition that produced it (install-canonical, install-publisher, install-reason-empty, install-alt-route) rather than being smoothed away; TEXT is outside the signature by construction, which is why the UNSUPPORTED fixture's version-less <h1> does not perturb it. securityIsolation grades all five zero-counts and THREE of them had no grader before P-6 — above all publisher→HTML, where the five injection blurbs were previously checked only against the contract's decision scope (built by omission), so nothing ever rendered them into HTML and counted. That check runs in BOTH escape forms because `esc` and `escText` differ on the quote characters, and a check that guessed one form could report zero occurrences of a string that is on the page. The digest-invariance check is derived through the SAME constructor from a sentinel, never asserted against a literal: a hardcoded digest cannot detect its own subject changing. visualRegression is BROWSERLESS and says so — it measures which declarations apply (var()-resolved, so a token VALUE change is visible) and how the one grid reflows across three viewports that straddle the 452 px column boundary and the 720 px main cap; it does NOT measure glyph rasterization. Zero @media is ASSERTED rather than assumed, because resolveDeclarations is a flat rule walk with no nesting support, so a media query would be silently mis-parsed — and adding one would also spend a served-byte license this batch does not have. Duplicate catalog keys are measured over RAW BYTES: JSON.parse collapses a duplicate last-wins, so a parsed check is structurally blind to the defect. thresholds.maxAuthorityFacts is now READ from human-five-second-test.json and graded against the measured counts; before P-6 nothing read it, and it sat at 3 while all five fixtures measured 5. Regenerate with `pnpm audit:preview:write`; enforce with `pnpm audit:preview:gate`.",
    workstream: "P",
    pr: "P-7",
    status: result.pass ? "PASSED" : "FAILED",
    corpus: {
      fixtures: pages.map((p) => ({
        id: p.id,
        installability: p.installability,
        partition: ctaRoutePartition(p.installability),
        ctaRowItems: ctaRowItemCount(p.html),
        signature: structuralSignature(p.html),
        // Recorded, not compared: each of these is asserted against the projection
        // predicate that produced it by `conditional/<page>/<class>`.
        conditionals: signatureConditionals(p.html),
      })),
      servedPagesInZeroContainmentScope: served.length,
      stylesheetCopies: stylesheets.map((s) => s.path),
      $comment:
        "One fixture per Installability, which is what makes the five-state corpus real rather than a sample of the served tree's single shape. `partition` is derived from DEEP_LINK_STATES through the renderer's own predicate, so the split cannot drift from the markup it describes. ctaRowItems is COUNTED off the rendered row rather than assumed, so a renderer that added a third CTA moves the reflow prediction on its own.",
    },
    configIntegrity: result.blocks[0],
    pageConsistency: result.blocks[1],
    securityIsolation: result.blocks[2],
    visualRegression: {
      ...result.blocks[3],
      observations: result.visual.observations,
      declarationCoverage: result.visual.declarationCoverage,
    },
    rollback: {
      ...result.blocks[4],
      recoverableVersions: corpus.length,
      newest: corpus.length === 0 ? null : corpus[corpus.length - 1]!.commit,
      configVersion: liveDocument.configVersion ?? null,
      $comment:
        "§14's fifth acceptance block, ungraded until PR P-7. The corpus is the COMMITTED ledger, not `git show`, and that is a measured choice rather than a stylistic one: this script runs in CI in --check mode (which rebuilds the artifact and byte-compares it) against a bare `actions/checkout@v6`, i.e. depth 1. On a depth-1 clone of this repo `git log --follow` over the catalog returns 1 commit rather than 8, the historical blobs report MISSING, and `merge-base --is-ancestor` FATALS on an unknown sha instead of returning false — so a git-derived corpus would fail the byte-compare on every CI run forever, and could not even fail gracefully. The stronger consequence is why each ledger entry now STORES its document: if past documents existed only in git history, then on a shallow clone they do not exist, and §14's 可按 digest 恢复 would be FALSE there rather than merely ungraded. Trust is therefore two honest layers, and the split is stated rather than implied: the offline validator called here recomputes all five recorded values from the stored bytes (catching a doctored digest, doctored bytes, or an unrecorded catalog change) but CANNOT catch a self-consistent forgery — measured, not assumed: a fabricated document with a correctly recomputed digest yields 0 offline faults. `pnpm ledger:presentation:validate` adds the git layer that proves each entry AUTHENTIC by comparing the stored document to the document at its own commit. validatorKnownKeys is derived BEHAVIOURALLY (feed the validator a configVersion and see whether it reports the key unknown) because the validator's `known` set is function-local, and any exported mirror would be a second copy free to drift from the one that decides. deploy-web.yml is verified AS TEXT because every one of REGRESSION_CHECKS' 19 rows binds ci.yml#test and deploy-web.yml's single `deploy:` job is graded by nothing.",
    },
    failures: result.failures,
  }
  return { json: JSON.stringify(report, null, 2) + "\n", pass: result.pass, failures: result.failures }
}

/**
 * The decision route a projection resolves to — the shipped `routeKey` shape reused by the
 * presentation audit, so "did configured copy move the decision?" is asked in one vocabulary.
 */
function routeKeyOf(p: { installability: string; agentContract: unknown }): string {
  const c = p.agentContract as {
    publicObservation?: { verdict?: string }
    recommendedNextAction?: { action?: string }
  }
  return [p.installability, c.publicObservation?.verdict ?? "", c.recommendedNextAction?.action ?? ""].join("|")
}

// --- modes -------------------------------------------------------------------

const argv = process.argv.slice(2)
const { json, pass, failures } = build()
const rel = path.relative(repoRoot, outPath)

if (argv.includes("--write")) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, json, "utf8")
  console.log(`wrote ${rel} — ${pass ? "PASSED" : "FAILED"}`)
  process.exit(0)
}

if (argv.includes("--gate")) {
  if (pass) {
    console.log("preview & snapshot harness: PASSED — all five §14 acceptance blocks green.")
    process.exit(0)
  }
  console.error("preview & snapshot harness: FAILED")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(2)
}

// default --check: committed artifact must match a fresh run.
if (!fs.existsSync(outPath)) {
  console.error(`${rel} is missing — run \`pnpm audit:preview:write\`.`)
  process.exit(1)
}
if (fs.readFileSync(outPath, "utf8") !== json) {
  console.error(`${rel} drifted from a fresh run — run \`pnpm audit:preview:write\` and review the diff.`)
  process.exit(1)
}
console.log(`${rel} matches a fresh run — ${pass ? "PASSED" : "FAILED"}`)
process.exit(0)
