#!/usr/bin/env tsx
/**
 * Workstream P Batch 1 — the presentation lock (new15 §6.2 PR P-1, §7; ADR 0058 §5).
 *
 * A THIN observer over the SERVED bytes. It computes no policy and decides no
 * verdict; it records the two digest seams P-1 introduces and measures the
 * properties that justify them:
 *
 *   1. CONTENT PLANE — the presentation document's digest set. P-1 had no
 *      apps/web/content/** at all and recorded the canonical EMPTY document's digest
 *      with contentPlane:"absent" (a real predecessor for PR P-7's rollback to
 *      restore — INV-P3 — rather than a null every consumer must branch on). P-2
 *      creates the document, so the lock now validates it and digests the real bytes.
 *   1b. RESOLVER IDENTITY — the committed document resolves to copy DEEP-EQUAL to the
 *      shipped code defaults, so committing the catalog provably cannot move a served
 *      byte (ADR 0058 §4). This is measured on the SAME resolver the bake calls, so it
 *      is not a claim about an equivalent path. Changing published wording must fail
 *      here first; that failure is the reviewable seam, not an obstacle to route around.
 *   2. SEMANTIC CONTRACT DIGEST — computed for all 19 committed served sidecars,
 *      alongside each one's sealed `contractDigest`. Read from apps/web/public/
 *      install/**, not re-derived, so this measures the bytes users actually get.
 *   3. NO-PROSE — the gate on the omission set: zero whitespace-bearing string
 *      leaves may survive into the semantic preimage. Add a prose field to the
 *      contract and this fails until somebody classifies it, which is what keeps
 *      the omission set from rotting quietly.
 *   3c. TOKEN PLANE — the L0 level, populated by PR P-4. Whether `l0Digest` moved off
 *      the digest of `{}`, whether the mirrored palette still matches the served sheet
 *      per token name, whether the plane covers the `install-*` classes the renderer
 *      really emits, and whether it contains anything a token plane may never contain.
 *   4. IMPORT BOUNDARY — no packages/*\/src/** file imports apps/web/content|styles
 *      (ADR 0058 §2). Added BEFORE those directories exist, because the cheapest
 *      time to forbid something is before anyone has written the line.
 *
 * WHAT THIS DOES NOT DO. new15 §2.5 says install plans SHOULD bind
 * `semanticContractDigest`. Re-pointing that binding would move
 * `expectedContractDigest` in every sealed plan — a behavior change, and P-1 is
 * declared "changes behavior: no". So this RECORDS the digest and proves its
 * stability; re-pointing the binding is a P-7 decision needing an ADR amendment.
 *
 * Modes (same contract as `pnpm audit:presentation`):
 *   (default) --check : the committed artifact must be byte-identical to a fresh run.
 *   --write           : (re)generate it.
 *   --gate            : ENFORCEMENT. Exit 2 unless every measured invariant holds.
 *
 * Exit codes: 0 ok · 1 drift (--check) · 2 gate failed (--gate) / unexpected error.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { hashJson } from "@calllint/fingerprint"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import {
  ABOVE_FOLD_SECTION_IDS,
  DEFAULT_GROUP_ORDER,
  DEFAULT_PRESENTATION,
  DISPLAY_GROUPS,
  EMPTY_PRESENTATION_CONTENT,
  FUSED_GROUP_RUNS,
  LEVEL_BY_SECTION,
  PRESENTATION_CONTENT_VERSION,
  PRIMARY_CTA,
  SECTION_GROUPS,
  SEMANTIC_PREIMAGE_OMISSIONS,
  SHIPPED_LAYOUT_CAPS,
  // PR P-5 — the total code-owned map replaces the permanently-empty title list in the
  // artifact. `UNWIRED_SECTION_TITLES` stays imported because the artifact keeps recording
  // it: it is now provably empty, and an empty field with a history is more useful to a
  // reviewer than a field that vanished.
  CODE_OWNED_SLOTS,
  UNWIRED_SECTION_TITLES,
  decodeOverrideKey,
  type ResolvedPresentation,
  FORBIDDEN_CSS_CONSTRUCTS,
  countCssRules,
  emitSafeInstall,
  emittedInstallClasses,
  emptyPresentationDigest,
  forbiddenCssConstructs,
  isStructurallySupported,
  parseClassSelectors,
  parseEvidenceSnapshot,
  parseStyledClasses,
  parseRootTokens,
  parseSnapshot,
  presentationDigest,
  resolvePresentation,
  semanticContractDigest,
  suppressionViolations,
  tokenDrift,
  validatePresentationContent,
  BASELINE_SELECTORS,
  nonClassRuleHeads,
  resolveDeclarations,
  type PresentationContentV1,
  type ResolvedPresentation,
} from "../packages/trust-index/src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outPath = path.join(repoRoot, "artifacts", "phase-2.4", "presentation-lock.json")

/** The content plane. Absent at P-1; created by PR P-2 — measured, not assumed. */
const CONTENT_ROOT = "apps/web/content/safe-install"
/** The merged document P-2 writes; the lock validates and digests it. */
const CONTENT_DOC = `${CONTENT_ROOT}/presentation.v1.json`

/** The L0 token plane created by PR P-4. The authored SOURCE, outside apps/web/public/. */
const TOKEN_PLANE_CSS = "apps/web/styles/tokens.css"
/**
 * The SERVED copy of that plane (PR P-4b) — the bytes a visitor actually receives.
 *
 * Two files, one truth: `sync-assets.mjs` copies source → served, and this lock
 * BYTE-COMPARES them. Without that compare the arrangement would be worse than a single
 * file, because every measure below reads the SOURCE while browsers read the copy: a
 * hand-edit under `public/` would pass every token, coverage, and suppression check while
 * serving something else entirely. The compare is what makes "the plane" one object.
 */
const SERVED_TOKEN_CSS = "apps/web/public/styles/tokens.css"
/** The served marketing sheet whose `:root` block P-4 mirrors (never edits). */
const SERVED_MARKETING_CSS = "apps/web/public/styles.css"
/**
 * sha256 of the canonical empty JSON object — the value `l0Digest` held from P-1
 * until this batch, when the L0 plane carried nothing.
 *
 * Recorded as a NAMED constant so the "the plane is now populated" claim is a
 * comparison against a known prior state rather than an eyeballed hex string. If
 * a future PR empties the plane, `l0DigestWasEmpty` flips back to true and the
 * lock says so instead of silently recording a different digest.
 */
const EMPTY_OBJECT_DIGEST = "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"

/** Source trees that may never import the config plane (ADR 0058 §2). */
const IMPORT_BOUNDARY_ROOTS = ["packages"] as const
const FORBIDDEN_IMPORTS = ["apps/web/content", "apps/web/styles"] as const

/**
 * Every permutation of a list. Used to COUNT how many of the 6! group orderings the
 * renderer can actually emit, rather than trusting the arithmetic in a comment. 720 is
 * small enough to enumerate exhaustively, so the recorded number is a measurement over
 * the whole space — and it moves on its own if the section model ever changes.
 */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const p of permutations(rest)) out.push([items[i] as T, ...p])
  }
  return out
}

/**
 * Emit the install tree with a SENTINEL href and require every page to carry it (P-4b).
 * Returns a failure string, or null.
 *
 * A sentinel rather than the shipped value on purpose: asserting the real href appears
 * would also pass if the renderer hardcoded it, which is the specific defect this probe
 * exists to exclude — a value that resolves correctly and reaches the page from somewhere
 * other than the resolver. The sentinel can only appear if the argument travelled.
 */
function probeEmittedStylesheet(): string | null {
  const snapPath = path.join(repoRoot, "packages", "trust-index", "snapshots", "official-mcp-registry.json")
  if (!fs.existsSync(snapPath)) return `stylesheet wiring probe found no committed registry snapshot at ${snapPath}`
  const evPath = path.join(repoRoot, "packages", "trust-index", "snapshots", "evidence-snapshot.json")
  const snapshot = parseSnapshot(fs.readFileSync(snapPath, "utf8"))
  const evidence = fs.existsSync(evPath) ? parseEvidenceSnapshot(fs.readFileSync(evPath, "utf8")) : null
  const sentinel = "/styles/__wiring-probe__.css"
  const pages = emitSafeInstall(snapshot, evidence, "0.0.0-probe", {
    ...DEFAULT_PRESENTATION,
    tokens: { tokensVersion: "wiring-probe", stylesheetHref: sentinel },
  }).files.filter((f) => f.path.endsWith("/index.html"))
  if (pages.length === 0) return "stylesheet wiring probe emitted no install pages — it would measure nothing"
  const missing = pages.filter((f) => !f.content.includes(`href="${sentinel}"`))
  if (missing.length > 0) {
    return (
      `tokens.stylesheetHref is declared configurable but a probe value reached ${pages.length - missing.length}/` +
      `${pages.length} emitted page(s) (e.g. ${missing[0]?.path}) — the resolved href never reaches the renderer ` +
      `(ADR 0058 §3: a key that validates and then does nothing)`
    )
  }
  return null
}

/**
 * Emit the install tree twice — once with the shipped layout, once with a supported
 * reordering — and require the HTML to actually differ. Returns a failure string, or null.
 *
 * This is the only check in the lock that measures BYTES rather than a resolved value, and
 * the reason is empirical: the resolver-level version of it passed while the emit edge had
 * `presentation.layout` deleted. Byte inequality is the weakest claim that cannot be
 * satisfied by a renderer which ignores the layout it was handed.
 *
 * It reads the committed snapshots — the same inputs `bake.ts` uses — so it exercises the
 * real projection chain, not a synthetic fixture. A missing snapshot means there is nothing
 * to emit, which is reported rather than silently skipped: a probe that quietly measures
 * nothing is worse than no probe.
 */
function probeEmittedLayout(reordered: ResolvedPresentation): string | null {
  const snapPath = path.join(repoRoot, "packages", "trust-index", "snapshots", "official-mcp-registry.json")
  const evPath = path.join(repoRoot, "packages", "trust-index", "snapshots", "evidence-snapshot.json")
  if (!fs.existsSync(snapPath)) return `layout wiring probe found no committed registry snapshot at ${snapPath}`
  const snapshot = parseSnapshot(fs.readFileSync(snapPath, "utf8"))
  const evidence = fs.existsSync(evPath) ? parseEvidenceSnapshot(fs.readFileSync(evPath, "utf8")) : null
  // The engine version is a contract-bytes input only; any fixed string works here because
  // both emits use the SAME one — the comparison is layout-vs-layout, nothing else.
  const htmlOf = (p: ResolvedPresentation): Map<string, string> => {
    const out = new Map<string, string>()
    for (const f of emitSafeInstall(snapshot, evidence, "0.0.0-probe", p).files) {
      if (f.path.endsWith("/index.html")) out.set(f.path, f.content)
    }
    return out
  }
  const shipped = htmlOf(DEFAULT_PRESENTATION)
  const moved = htmlOf(reordered)
  if (shipped.size === 0) return "layout wiring probe emitted no install pages — it would measure nothing"
  const unchanged = [...shipped.keys()].filter((k) => shipped.get(k) === moved.get(k))
  if (unchanged.length > 0) {
    return (
      `layout.groupOrder is declared configurable but a supported reordering left ${unchanged.length}/${shipped.size} ` +
      `emitted page(s) byte-identical (e.g. ${unchanged[0]}) — the resolved layout never reaches the renderer ` +
      `(ADR 0058 §3: a key that validates and then does nothing)`
    )
  }
  return null
}

/** Every committed served contract sidecar, in stable path order. */
function servedContracts(): { slug: string; contract: unknown }[] {
  const root = path.join(repoRoot, "apps", "web", "public", "install")
  if (!fs.existsSync(root)) return []
  const out: { slug: string; contract: unknown }[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === "index.json") {
        const slug = path.relative(root, path.dirname(p)).split(path.sep).join("/")
        out.push({ slug, contract: JSON.parse(fs.readFileSync(p, "utf8")) })
      }
    }
  }
  walk(root)
  return out
}

/**
 * Every committed served install PAGE, in stable path order.
 *
 * Separate from `servedContracts()` on purpose: that reads the JSON sidecar, this
 * reads the HTML. The token plane's coverage claim is about markup, so it has to be
 * measured against the bytes a browser receives rather than against a class list
 * this repo could restate incorrectly in two places.
 */
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
 * PR P-5 — does every per-resource override resolve to the name the code already derives?
 *
 * The served consequence of a `displayName` override is the page's identity line, so this
 * compares against the SERVED bytes rather than against a code default: for each override
 * key, decode it back to a canonical slug, find that resource's committed page, and require
 * the configured name to be the name that page already carries. A document that renamed a
 * resource would fail here — which is what makes "committing the catalog moves no served
 * byte" a measurement for this slice too.
 *
 * Two failure modes are folded in deliberately. An override whose decoded slug matches NO
 * committed resource is a failure, not a no-op: it is the misspelling case, and silently
 * ignoring it is exactly the drift ADR 0058 §3 names. And the comparison uses the `<title>`
 * of the committed page, because that is where the derived display name is observable in
 * served bytes without re-running the projection — re-deriving it here would mean restating
 * `packageName ?? canonicalName` in a second place, which is the duplication this repo keeps
 * removing.
 */
function overridesResolveToShippedNames(resolved: ResolvedPresentation): boolean {
  return overrideNameFaults(resolved).length === 0
}

/** The same measurement, but reporting WHICH override failed and why. */
function overrideNameFaults(resolved: ResolvedPresentation): string[] {
  const pages = servedInstallPages()
  const titleBySlug = new Map<string, string>()
  for (const { slug, html } of pages) {
    const m = /<title>Add ([^<]*) with CallLint<\/title>/.exec(html)
    if (m?.[1] !== undefined) titleBySlug.set(slug, m[1])
  }
  const faults: string[] = []
  for (const [key, override] of Object.entries(resolved.overrides.resources)) {
    if (override.displayName === undefined) continue // `reason`-only entry: no served effect
    const slug = decodeOverrideKey(key)
    const shipped = titleBySlug.get(slug)
    if (shipped === undefined) {
      faults.push(
        `overrides.resources.${key} decodes to slug ${JSON.stringify(slug)}, which matches no committed ` +
          `install page — the override reaches nothing (check the / → __ encoding, and note that the ` +
          `LEAF segment alone also satisfies the schema's propertyNames pattern)`,
      )
      continue
    }
    if (override.displayName !== shipped) {
      faults.push(
        `overrides.resources.${key}.displayName is ${JSON.stringify(override.displayName)} but the committed ` +
          `page for ${slug} shows ${JSON.stringify(shipped)} — committing this would change served bytes`,
      )
    }
  }
  return faults
}

/** Scan for a forbidden import of the config plane. Returns offending files. */
function importBoundaryViolations(): string[] {
  const hits: string[] = []
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.(ts|tsx|mts|cts|js|mjs)$/.test(e.name)) continue
      const src = fs.readFileSync(p, "utf8")
      // Only real module specifiers count — a path inside a comment or a string
      // literal (this script's own constants, for instance) is not an import.
      for (const m of src.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = m[1] ?? ""
        if (FORBIDDEN_IMPORTS.some((f) => spec.includes(f))) {
          hits.push(`${path.relative(repoRoot, p).split(path.sep).join("/")} → ${spec}`)
        }
      }
    }
  }
  for (const root of IMPORT_BOUNDARY_ROOTS) walk(path.join(repoRoot, root))
  return hits
}

/** Build the artifact. No clock, no RNG — byte-stable across runs. */
function build(): { json: string; pass: boolean; failures: readonly string[] } {
  const failures: string[] = []

  // 1 — the content plane. Present ⇒ validate and digest it; absent ⇒ the honest
  // digest of the canonical empty document, which resolves to code defaults.
  const docPath = path.join(repoRoot, CONTENT_DOC)
  const docPresent = fs.existsSync(docPath)
  let doc: PresentationContentV1 = EMPTY_PRESENTATION_CONTENT
  let validationErrors: readonly { path: string; rule: string; message: string }[] = []
  if (docPresent) {
    const parsed = JSON.parse(fs.readFileSync(docPath, "utf8")) as PresentationContentV1
    const facts = JSON.parse(fs.readFileSync(path.join(repoRoot, "project-facts.json"), "utf8")) as {
      forbiddenPhrases: string[]
      trustPageForbiddenPhrases: string[]
    }
    validationErrors = validatePresentationContent(parsed, {
      verdictLabels: VERDICT_PUBLIC_LABEL,
      stateCtas: PRIMARY_CTA,
      forbiddenPhrases: [...facts.forbiddenPhrases, ...facts.trustPageForbiddenPhrases],
    })
    if (validationErrors.length > 0) {
      for (const e of validationErrors) failures.push(`${CONTENT_DOC}${e.path}: [${e.rule}] ${e.message}`)
    } else {
      doc = parsed
    }
  }
  const digests = docPresent && validationErrors.length === 0 ? presentationDigest(doc) : emptyPresentationDigest()

  // 1b — resolver identity + wiring, measured on the resolver the BAKE calls.
  //
  // Two questions, both of which have to be answered by measurement or the batch's
  // central claim ("committing the catalog moves no served byte") is only an assertion:
  //
  //   • does the committed document resolve to the shipped defaults, slot for slot?
  //     Deep equality over the three copy slices answers it directly. A transcription
  //     slip, a smart-quote, a trailing space — each shows up here as a FAILURE before
  //     it can show up in production as a changed page.
  //   • does every configured slot actually reach a renderer? A key that validates and
  //     then does nothing is the precise drift a lock exists to catch, so `unwiredSlots`
  //     is a failure rather than a note.
  //
  //     That second bullet USED to name `boundary` as "schema-valid and deliberately
  //     unwired … which is why the document must not carry it yet". Both halves are now
  //     false and are corrected rather than deleted: P-4b wired `boundary`, and the
  //     committed document carries it (`sectionTitles.boundary` is in `overriddenSlots`).
  //     The mechanism the sentence described also changed shape twice — P-4b generalized
  //     it from a deferral list to "configured but not wired", and P-5 made it TOTAL over
  //     all eight sections of `LEVEL_BY_SECTION` rather than over `sectionTitles` alone.
  //     So `unwiredSlots` now reports a dead key in guard copy, relay copy or a per-resource
  //     override too, and each report carries the measured reason it reaches nothing.
  //
  // PR P-3 adds a THIRD question and a fourth slice. The layout slice is compared the same
  // way as the copy slices — a document whose `groupOrder` resolved to a different SECTION
  // sequence would move served bytes, so it must fail here, not in production. And because
  // an unsupported order fails OPEN (INV-P3 renders the shipped page), a rejection would
  // otherwise be invisible: `rejectedSlots` is therefore a failure too, which is what keeps
  // "the document I committed is not the document being served" from being a quiet state.
  const resolved = resolvePresentation(doc)
  const resolvesToDefaults =
    JSON.stringify(resolved.primaryCta) === JSON.stringify(DEFAULT_PRESENTATION.primaryCta) &&
    JSON.stringify(resolved.authority) === JSON.stringify(DEFAULT_PRESENTATION.authority) &&
    JSON.stringify(resolved.sectionTitles) === JSON.stringify(DEFAULT_PRESENTATION.sectionTitles) &&
    JSON.stringify(resolved.layout) === JSON.stringify(DEFAULT_PRESENTATION.layout) &&
    // PR P-4b: tokens joins the identity. It has to, now that the href reaches served
    // bytes — a catalog that quietly re-pointed the stylesheet would otherwise satisfy
    // "resolves to defaults" while changing what every install page loads.
    JSON.stringify(resolved.tokens) === JSON.stringify(DEFAULT_PRESENTATION.tokens) &&
    // PR P-5 — the three sections that were declared, levelled, and dead until this batch.
    // Guard and relay copy join the identity for the same reason tokens did: they now reach
    // a real consumer (the guard render, the MCP relay line), so a catalog that reworded
    // them would change what a human or an agent is told while still passing every other
    // clause here.
    JSON.stringify(resolved.guardConversion) === JSON.stringify(DEFAULT_PRESENTATION.guardConversion) &&
    JSON.stringify(resolved.agentRelay) === JSON.stringify(DEFAULT_PRESENTATION.agentRelay) &&
    // The override slice is compared by its EFFECTIVE DISPLAY NAME, not by deep equality
    // against a default (there is no default override set — `DEFAULT_PRESENTATION.overrides`
    // is empty, so deep equality could only ever pass for a document with no overrides at
    // all, which would make the whole slice untestable). What must hold is the served
    // consequence: for every override the document carries, the name it produces equals the
    // name the shipped derivation produces. `reason` is deliberately NOT part of this — it
    // reaches the lock artifact below and no served byte, so requiring it to match a
    // "default" would be requiring a value that has no served meaning.
    overridesResolveToShippedNames(resolved)
  if (docPresent && validationErrors.length === 0 && !resolvesToDefaults) {
    failures.push(
      `${CONTENT_DOC}: resolves to copy that differs from the shipped code defaults — ` +
        // The old text ended "which ADR 0058 §4 reserves for PR P-4b". That license was
        // SPENT by P-4b and does not renew, so naming it here would read as though a served
        // byte were still available to spend. Every batch from P-5 on is under the default
        // rule, which is byte-identity.
        `committing the catalog would change served bytes, which ADR 0058 §4 forbids outside ` +
        `the single license already spent by PR P-4b`,
    )
  }
  for (const slot of resolved.unwiredSlots) {
    // `slot` already carries its own measured reason (`section.key: reason`), supplied by
    // `WIRED_SLOTS`/`CODE_OWNED_SLOTS` in the resolver. The previous form interpolated
    // `UNWIRED_SECTION_TITLES`, which P-4b had emptied — so the message rendered a literal
    // `(unwired: )` and told a reader nothing. Naming the reason at its source means there
    // is one place to state why a slot is code-owned, and it is the same place the compiler
    // checks for totality.
    failures.push(
      `${CONTENT_DOC}: configures ${slot} — a config key that validates and then does nothing ` +
        `(ADR 0058 §3). Remove it from the document, or wire it in the batch that needs it.`,
    )
  }
  // A rejected slot means the resolver silently substituted the shipped value. That is the
  // right RUNTIME behavior (INV-P3) and the wrong COMMITTED state: the served page would
  // not be the page the document describes.
  for (const slot of resolved.rejectedSlots) {
    failures.push(
      `${CONTENT_DOC}: ${slot} — the resolver fell back to the shipped value, so the committed ` +
        `document does not describe the served page (ADR 0058 §5 INV-P3 fails open by design; ` +
        `a COMMITTED document must not need it)`,
    )
  }
  // An empty override set with a PRESENT document would mean the resolver ignored every
  // slot — which would make the identity check above pass for the wrong reason.
  if (docPresent && validationErrors.length === 0 && resolved.overriddenSlots.length === 0) {
    failures.push(
      `${CONTENT_DOC}: present but supplies no recognized copy slot — the document is inert, ` +
        `so the byte-identity measurement above would hold vacuously`,
    )
  }

  // 2/3 — the semantic digest for every served sidecar, plus the no-prose gate.
  const served = servedContracts()
  const resources = served.map(({ slug, contract }) => {
    const r = semanticContractDigest(contract)
    if (r.proseLeaves.length > 0) {
      failures.push(
        `${slug}: ${r.proseLeaves.length} unclassified prose leaf/leaves survive into the semantic preimage ` +
          `(${r.proseLeaves.map((l) => l.path).join(", ")}) — classify each in SEMANTIC_PREIMAGE_OMISSIONS or keep it bound`,
      )
    }
    if (r.contractDigest === null) failures.push(`${slug}: served sidecar carries no contract.contractDigest`)
    return {
      canonicalSlug: slug,
      contractDigest: r.contractDigest,
      semanticContractDigest: r.semanticContractDigest,
      omissionsApplied: r.omissionsApplied,
      omissionsNotPresent: r.omissionsNotPresent,
      proseLeaves: r.proseLeaves.map((l) => l.path),
    }
  })
  if (resources.length === 0) {
    failures.push("no served install sidecars found — the lock would measure nothing")
  }
  // A semantic digest that collided across DIFFERENT sealed contracts would mean the
  // omission set had deleted something load-bearing. Distinctness is the check.
  const distinctSemantic = new Set(resources.map((r) => r.semanticContractDigest)).size
  const distinctContract = new Set(resources.map((r) => r.contractDigest)).size
  if (resources.length > 0 && distinctSemantic < distinctContract) {
    failures.push(
      `semantic digests collapsed: ${distinctContract} distinct contractDigest → ${distinctSemantic} distinct ` +
        `semanticContractDigest, so an omission removed load-bearing semantics`,
    )
  }

  // 3b — the structural-support space (PR P-3), enumerated rather than argued. If this
  // ever came out as the full 720, the predicate would have stopped constraining anything;
  // if it came out as 0, it would reject the shipped page. Both bounds are asserted, so a
  // future refactor cannot quietly neutralize the rule that keeps config from claiming a
  // layout the renderer has no markup for.
  const allOrderings = permutations(DISPLAY_GROUPS)
  const permutationCount = allOrderings.length
  const supportedCount = allOrderings.filter((o) => isStructurallySupported(o)).length
  if (supportedCount === 0 || supportedCount === permutationCount) {
    failures.push(
      `layout support predicate is degenerate: ${supportedCount}/${permutationCount} orderings supported — ` +
        `it either rejects the shipped page or constrains nothing (ADR 0058 §3)`,
    )
  }
  if (!isStructurallySupported(DEFAULT_GROUP_ORDER)) {
    failures.push(
      `the SHIPPED group order is not structurally supported — the model disagrees with the renderer it describes`,
    )
  }
  // The layout slot is WIRED — proven by EMITTED BYTES, not by inspection.
  //
  // Why this needs its own probe: the layout block restates the shipped order, so unlike
  // the copy slots it contributes NO entry to `overriddenSlots` (restating a default is
  // not an edit). The inert-document check therefore cannot see it, and neither can
  // `resolvesToDefaults`.
  //
  // Why it must go through `emitSafeInstall` and not `resolvePresentation`: an earlier
  // version of this check drove the RESOLVER and asserted `sectionOrder` moved. That
  // passed — measurably, as a negative control — with the `presentation.layout` argument
  // DELETED at the emit edge, because the resolver's answer was never handed to the
  // renderer. A resolver that computes the right order and an emitter that ignores it is
  // exactly the "validates and then does nothing" failure ADR 0058 §3 forbids, so the
  // probe now emits the real install tree twice and requires the HTML to differ. The
  // reordering used is emittable (the fused disposition+primary_action run stays intact),
  // so a rejection here means the wiring broke, not that the order was illegal.
  const probeOrder = ["identity", "consequence", "disposition", "primary_action", "authority_facts", "secondary_links"]
  const probeResolved = resolvePresentation({ ...EMPTY_PRESENTATION_CONTENT, layout: { groupOrder: probeOrder } })
  if (probeResolved.rejectedSlots.length > 0 || !probeResolved.overriddenSlots.includes("layout.groupOrder")) {
    failures.push(
      `layout.groupOrder did not resolve as an override (rejected: ${probeResolved.rejectedSlots.join(", ") || "none"}) ` +
        `— the probe cannot test the wiring it exists to test`,
    )
  }
  const layoutWiring = probeEmittedLayout(probeResolved)
  if (layoutWiring !== null) failures.push(layoutWiring)

  // 3c — the L0 TOKEN PLANE (PR P-4). Every value below is DERIVED from the two CSS
  // files, so a later PR that changes either one moves this block on its own instead
  // of leaving a stale number that reads as agreement.
  //
  // Four questions, each of which fails rather than merely records:
  //
  //   • Is the plane actually populated? `l0Digest` was sha256({}) from P-1 through
  //     P-3, so "the level exists" was indistinguishable from "the level does not
  //     work". Comparing against the named prior digest is what makes populating it
  //     a measurement.
  //   • Does the mirrored palette match the served one? ADR 0058 §4 forbids editing
  //     the served sheet, so duplication is forced; a per-name comparison is what
  //     keeps it measured rather than latent. `sharedNames` must be non-empty, or a
  //     file that mirrored nothing would satisfy "no drift" vacuously.
  //   • Does the plane cover the surface it claims to style? The `install-*` classes
  //     are read from REAL emitted HTML, not a hardcoded list, so the coverage check
  //     tracks the renderer.
  //   • Can the plane do anything it must not? Forbidden constructs (@import, url(,
  //     !important, http) and suppression properties inside install rules. A
  //     stylesheet cannot decide a verdict, but it can hide one, and a hidden
  //     disposition is a safety regression wearing a theme.
  const tokensBlock = (doc as { tokens?: { tokensVersion?: string; stylesheetHref?: string } }).tokens
  const tokenCssPath = path.join(repoRoot, TOKEN_PLANE_CSS)
  const tokenPlanePresent = fs.existsSync(tokenCssPath)
  const tokenCss = tokenPlanePresent ? fs.readFileSync(tokenCssPath, "utf8") : ""
  const servedCssPath = path.join(repoRoot, SERVED_MARKETING_CSS)
  const servedCss = fs.existsSync(servedCssPath) ? fs.readFileSync(servedCssPath, "utf8") : ""

  const planeTokens = parseRootTokens(tokenCss)
  const servedTokens = parseRootTokens(servedCss)
  const drift = tokenDrift(planeTokens.tokens, servedTokens.tokens)

  // PR P-4b — the served copy, and the VISUAL fact.
  const servedPlanePath = path.join(repoRoot, SERVED_TOKEN_CSS)
  const servedPlanePresent = fs.existsSync(servedPlanePath)
  const servedPlaneCss = servedPlanePresent ? fs.readFileSync(servedPlanePath, "utf8") : ""
  const servedCopyMatchesSource = servedPlanePresent && tokenPlanePresent && servedPlaneCss === tokenCss
  // The element baseline: rule heads with no class in them. Asserted as a SET against
  // BASELINE_SELECTORS, so the plane can neither drop `body` (styling the sections while
  // the page stays at browser defaults) nor add an element rule no measure looks at.
  const baselineHeads = nonClassRuleHeads(tokenCss)
  // `var()` resolved against the plane's own :root, then digested. This is the measure a
  // raw-bytes digest cannot be: a comment edit leaves it still, and a re-pointed palette
  // moves it even if every selector and token NAME is unchanged.
  const resolvedRules = resolveDeclarations(tokenCss, planeTokens.tokens)
  const visualDigest = hashJson(resolvedRules)
  // TWO selector measures, deliberately. `planeStyled` is the classes that directly
  // receive declarations — the coverage scope, because a descendant-only mention like
  // `.install-authority code` styles the `code`, not the class, and counting it would let
  // the rule that really styles the class be deleted with the coverage number unmoved.
  // `planeVocabulary` is every class mentioned anywhere, which is the right scope for the
  // opposite question: does the plane declare a class the renderer never emits.
  const planeStyled = parseStyledClasses(tokenCss)
  const planeVocabulary = parseClassSelectors(tokenCss)
  const forbiddenConstructs = forbiddenCssConstructs(tokenCss)
  const suppressions = suppressionViolations(tokenCss)
  const l0DigestWasEmpty = digests.l0Digest === EMPTY_OBJECT_DIGEST

  // The install classes the renderer really emits, taken from the committed served
  // pages — the same bytes users receive, so the coverage claim is about production
  // markup rather than a re-derivation that could agree with itself.
  const emittedClasses = new Set<string>()
  for (const { html } of servedInstallPages()) {
    for (const cls of emittedInstallClasses(html)) emittedClasses.add(cls)
  }
  const uncoveredClasses = [...emittedClasses].filter((c) => !planeStyled.includes(c)).sort()
  const deadClasses = planeVocabulary.filter((c) => c.startsWith("install-") && !emittedClasses.has(c)).sort()

  if (!tokenPlanePresent) {
    failures.push(
      `${TOKEN_PLANE_CSS} is missing — PR P-4 populates the L0 plane, and the plane audit expects it present`,
    )
  }
  if (tokensBlock === undefined) {
    failures.push(
      `${CONTENT_DOC}: no \`tokens\` block — PR P-4 populates the L0 plane, so l0Digest would stay sha256({}) and ` +
        `the level would remain indistinguishable from one that does not work`,
    )
  }
  if (tokenPlanePresent && tokensBlock !== undefined && l0DigestWasEmpty) {
    failures.push(
      `l0Digest is still ${EMPTY_OBJECT_DIGEST} (the digest of {}) while a tokens block is committed — ` +
        `the L0 section is not reaching presentationDigest`,
    )
  }
  // The declared href must resolve to a file INSIDE the served tree. P-4 checked this
  // against the authored source, which was the right check while nothing was emitted; now
  // the href is a live URL, so the path it has to resolve under is `public/`. Checking the
  // source directory would still pass for a sheet that no deploy publishes — a 404 on a
  // served trust surface, which is exactly the failure the P-4 comment anticipated here.
  if (tokensBlock?.stylesheetHref !== undefined) {
    const declared = tokensBlock.stylesheetHref.replace(/^\//, "")
    if (!fs.existsSync(path.join(repoRoot, "apps", "web", "public", declared))) {
      failures.push(
        `${CONTENT_DOC}: tokens.stylesheetHref "${tokensBlock.stylesheetHref}" resolves to ` +
          `apps/web/public/${declared}, which does not exist — the served install pages link a missing sheet ` +
          `(run \`pnpm -F @calllint/web build\`)`,
      )
    }
  }
  // The served copy must exist and be byte-identical to the authored source. Both halves
  // matter and they fail differently: no copy means the deploy has nothing to publish,
  // while a differing copy means every measure in this block is describing a file that is
  // not the one users receive.
  if (!servedPlanePresent) {
    failures.push(
      `${SERVED_TOKEN_CSS} is missing — the install pages link it (run \`pnpm -F @calllint/web build\`)`,
    )
  } else if (!servedCopyMatchesSource) {
    failures.push(
      `${SERVED_TOKEN_CSS} differs from ${TOKEN_PLANE_CSS} — the served bytes are not the plane this lock measures ` +
        `(the served copy is a build OUTPUT: edit the source, then \`pnpm -F @calllint/web build\`)`,
    )
  }
  // The element baseline, as an exact set (PR P-4b).
  for (const head of baselineHeads.filter((h) => !BASELINE_SELECTORS.includes(h))) {
    failures.push(
      `${TOKEN_PLANE_CSS} styles "${head}", which is not one of the ${BASELINE_SELECTORS.length} permitted element ` +
        `selectors (${BASELINE_SELECTORS.join(", ")}) — an element rule is outside every class-scoped measure here`,
    )
  }
  for (const want of BASELINE_SELECTORS.filter((s) => !baselineHeads.includes(s))) {
    failures.push(
      `${TOKEN_PLANE_CSS} has no "${want}" rule — the served pages would link a sheet that styles the install ` +
        `sections while leaving the page itself at browser defaults (the mechanism without the outcome)`,
    )
  }
  if (tokenPlanePresent && drift.sharedNames.length === 0) {
    failures.push(
      `${TOKEN_PLANE_CSS} shares no token name with ${SERVED_MARKETING_CSS} — the drift pin would hold vacuously`,
    )
  }
  // The pin compares SHARED names only, so a name dropped from the mirror leaves
  // `sharedTokensDrifted` empty — "no drift" would read as "the palette agrees" while the
  // plane silently covered less of it. Require the mirror to be TOTAL over the served
  // palette, so shrinking it is a failure rather than a quieter pass.
  for (const name of servedTokens.tokens.map((t) => t.name)) {
    if (!planeTokens.tokens.some((t) => t.name === name)) {
      failures.push(
        `${name} is declared in ${SERVED_MARKETING_CSS} but missing from ${TOKEN_PLANE_CSS} — the mirror covers ` +
          `only part of the served palette, and a shared-names-only comparison cannot see the gap`,
      )
    }
  }
  for (const d of drift.drifted) {
    failures.push(
      `${d.name} is "${d.plane}" in ${TOKEN_PLANE_CSS} but "${d.served}" in ${SERVED_MARKETING_CSS} — ` +
        `the palette has split in two, and PR P-4b would ship the stale half (ADR 0058 §4 forbids editing the served sheet, ` +
        `so the mirror must be updated here)`,
    )
  }
  if (planeTokens.rootBlockCount > 1) {
    failures.push(
      `${TOKEN_PLANE_CSS} declares ${planeTokens.rootBlockCount} :root blocks — token values would resolve by ` +
        `last-wins and could not be read off the file`,
    )
  }
  for (const dup of planeTokens.duplicateNames) {
    failures.push(`${TOKEN_PLANE_CSS} declares ${dup} more than once in :root`)
  }
  if (tokenPlanePresent && emittedClasses.size === 0) {
    failures.push("no install-* classes found in the served pages — the token coverage check would measure nothing")
  }
  for (const cls of uncoveredClasses) {
    failures.push(
      `.${cls} is emitted by the install renderer but has no rule in ${TOKEN_PLANE_CSS} — ` +
        `the token plane does not cover the surface it claims to style`,
    )
  }
  for (const cls of deadClasses) {
    failures.push(
      `.${cls} has a rule in ${TOKEN_PLANE_CSS} but is emitted by no served install page — ` +
        `dead configuration, and it makes the coverage count above read better than the surface it describes`,
    )
  }
  for (const c of forbiddenConstructs) {
    const why = FORBIDDEN_CSS_CONSTRUCTS.find((f) => f.pattern === c)?.why ?? ""
    failures.push(`${TOKEN_PLANE_CSS} contains "${c}" — ${why}`)
  }
  for (const s of suppressions) {
    failures.push(
      `${TOKEN_PLANE_CSS} suppresses a decision group: ${s} — configuration may style the install surface, ` +
        `never hide it (an invisible disposition is a safety regression, not a theme)`,
    )
  }
  // 3d — the plane is WIRED, proven by emitted bytes (PR P-4b).
  //
  // Same discipline as the layout wiring probe above, and for the same reason: the token
  // block could resolve perfectly while the emit edge dropped its fourth argument, and
  // every check up to here would still pass. Re-emitting and requiring the href in the
  // output is the weakest claim a renderer that ignores its tokens cannot satisfy.
  const wiring = probeEmittedStylesheet()
  if (wiring !== null) failures.push(wiring)

  // 4 — the import boundary (ADR 0058 §2).
  const violations = importBoundaryViolations()
  for (const v of violations) {
    failures.push(`forbidden config-plane import: ${v} — presentation config is a PARAMETER, not an import (ADR 0058 §2)`)
  }

  // 5 — the ZERO-SERVED-BYTE claim, measured (PR P-5).
  //
  // Everything above measures that the committed document resolves to the shipped values.
  // That is necessary and it is not sufficient: it would hold just as well if a future edit
  // routed guard or relay copy INTO the install renderer, because both sides of the identity
  // would move together and every clause would still pass. What P-5 actually claims is
  // stronger — that these two slices reach no served byte AT ALL — and the only way to
  // measure that is to look for their strings in the bytes themselves.
  //
  // So: every resolved guard and relay string, searched for in all 19 committed pages AND
  // all 19 sealed contract sidecars. Both counts must be zero. This is a STRUCTURAL claim,
  // not a coincidence of the current wording — the guard offer renders to a terminal and the
  // relay line lands in an MCP `notes[]` array, neither of which is an install page. If a
  // string ever appears here, a renderer gained a surface it should not have, and the batch's
  // headline claim is false.
  //
  // Two design notes, both load-bearing:
  //
  //   • it searches the COMMITTED corpus, so it fails on a stale tree as well as on a bad
  //     edit. `pnpm bake:trust-index` then `git status -- apps/web/public/` is the companion
  //     measurement; this one catches the case where the bake was never re-run.
  //   • the shipped `offerBody` is "CallLint can:" — short, and the kind of phrase that could
  //     plausibly appear in marketing copy. That is a feature: it makes this check sensitive.
  //     If a page ever legitimately needs that phrase, the right resolution is to reword one
  //     side, not to loosen the search — a substring test that skips short strings would be
  //     blind to precisely the accidental collisions worth knowing about.
  const configuredCopyStrings: { slot: string; value: string }[] = [
    ...Object.entries(resolved.guardConversion).map(([k, v]) => ({ slot: `guardConversion.${k}`, value: v })),
    ...Object.entries(resolved.agentRelay).map(([k, v]) => ({ slot: `agentRelay.${k}`, value: v })),
  ]
  const configuredCopyHits: { slot: string; where: string }[] = []
  for (const { slot, value } of configuredCopyStrings) {
    for (const { slug, html } of servedInstallPages()) {
      if (html.includes(value)) configuredCopyHits.push({ slot, where: `install/${slug}/index.html` })
    }
    for (const { slug, contract } of served) {
      if (JSON.stringify(contract).includes(value)) configuredCopyHits.push({ slot, where: `install/${slug}/index.json` })
    }
  }
  for (const hit of configuredCopyHits) {
    failures.push(
      `${hit.where} contains the configured ${hit.slot} string — guard and relay copy must reach NO served byte. ` +
        `The guard offer renders to a terminal and the relay line lands in an MCP notes[] array; a served page or ` +
        `sidecar carrying either means a renderer gained a surface, and PR P-5's zero-served-byte claim is false ` +
        `(ADR 0058 §4: the single license was spent by P-4b and does not renew).`,
    )
  }
  // A corpus that reads as empty would make the check above pass for the wrong reason — the
  // same vacuity trap the audit's probe rows guard against. Requiring a non-empty search
  // space costs one line and turns "found nothing" into "looked, and found nothing".
  if (configuredCopyStrings.length === 0) {
    failures.push(
      "the configured-copy containment check has no strings to search for — the guard/relay slices resolved empty, " +
        "so a zero-hit result would be vacuous",
    )
  }

  const report = {
    schema: "calllint.presentation-lock.v0",
    $comment:
      "Workstream P digest seams (ADR 0058 §5; new15 §7), re-baselined by PR P-6, which gives the five decision-relay slots a real consumer and so empties codeOwnedSlots.agentRelayCopy to {}. The surface is the MCP prepare result's non-decision `notes[]`, composed by composeRelayNotes and fact-gated: each sentence is relay wording plus a machine fact read off the SEALED contract, and a sentence whose basis is absent is not emitted — so the relay plane is a projection of the contract and cannot state what the contract does not carry. P-5's own claim stands unchanged: unwiredSlots is TOTAL over all eight sections of levelBySection, and the compiler enforces it. P-6 stays under the DEFAULT rule: byte-identity. P-4b spent ADR 0058 §4's single served-byte license and it does not renew, so `git status --porcelain -- apps/web/public/` must be EMPTY for this batch — the exact inverse of P-4b's gate. l1Digest and presentationDigest MOVE (one L1 section gained five slots); l0Digest and l2Digest must NOT. CONFIGURABILITY LIMIT, recorded rather than implied: configuration reaches these sentences at BUILD time only. apps/cli and packages/calllint-mcp both declare empty runtime dependencies (esbuild-inlined) and apps/web/content/** ships in no `files` list, so a catalog edit can never change an installed binary — the identical limit guardOffer has carried since P-5, which is why tools.ts reads DEFAULT_AGENT_RELAY_COPY. What the catalog CAN do is be measured: resolvesToDefaults proves the committed document restates the shipped defaults verbatim, so a reworded catalog turns this lock red instead of silently disagreeing with the shipped binary. Two slots still stay in code with their measured reasons rather than being wired dishonestly: guardConversion.declineLabel (Gate 2.4-F compares it as a literal and ContinuousProtectionOffer types it as one, so a document reaching it could weaken INV-2.4-07's own floor) and expiresAt (honoring it needs a clock, and the install tree is reproducibility-gated). RECORDS presentationDigest + semanticContractDigest; it does NOT re-point what install plans bind — plans still bind contractDigest, and moving that binding is a P-7 decision requiring an ADR amendment (doing it here would smuggle a behavior change into a batch declared as having none). `semanticContractDigest` is defined by DELETION from the sealed contract, so a new contract field is bound by default and omission is the reviewable exception. The gate is noProseLeaves: machine tokens carry no whitespace, prose always does, so an empty result proves no copy is bound — for any input, not just those measured. Regenerate with `pnpm audit:presentation:lock:write`; enforce with `pnpm audit:presentation:lock:gate`.",
    workstream: "P",
    pr: "P-6",
    status: failures.length === 0 ? "PASSED" : "FAILED",
    contentPlane: {
      root: CONTENT_ROOT,
      document: CONTENT_DOC,
      state: docPresent ? "present" : "absent",
      $comment:
        "PRESENT since PR P-2, which lifted the Install-surface L1/L2 copy into this one merged document (O-4: newest surface first). The recorded digests are over the real committed bytes; P-1's baseline recorded the canonical EMPTY document instead, because the plane did not exist yet. resolvesToDefaults is still the load-bearing measurement, and P-4b EXTENDS it to the tokens block: the committed document resolves DEEP-EQUAL to the shipped code defaults through the same resolver the bake calls, so this DOCUMENT still moves no served byte. That claim and P-4b's +34 B/page are not in tension — the served-byte change comes from the RENDERER (a <link> plus the refolded boundary sentence), and the document restating the shipped href is what keeps configuration out of it. Extending the identity to tokens is what stops a catalog from quietly re-pointing what every install page loads while still reading as 'resolves to defaults'. unwiredSectionTitles is now EMPTY because P-4b wired `boundary`, the slot P-2 deferred; unwiredSlots must stay empty so a key can never validate and then do nothing. PR P-5 EXTENDS resolvesToDefaults again, to guardConversion, agentRelayCopy, and the overrides slice — the first two by deep equality against the shipped code defaults (they now reach the guard render and the MCP relay line, so a reworded catalog would change what a human or an agent is told), the third by its EFFECTIVE served name: for every override the document carries, the display name it produces must equal the name the committed install page already shows. `reason` is deliberately excluded from that identity because it reaches this artifact and no served byte, so requiring it to match a default would be requiring a value with no served meaning. codeOwnedSlots replaces the permanently-empty unwiredSectionTitles as the reviewable record: slot → the measured reason it is code-owned, total over all eight sections. RELAY LEVEL, reconciled here rather than by an ADR because nothing is weakened and no digest moves on account of the reading: levelBySection.agentRelayCopy stays L1 exactly as shipped. ADR 0058 §6 is the more specific and later clause and names this section by its new15 §20.2 type name (AgentRelayCopy is L1-editable); §1's 'agent relay summaries' reads as the authority-consequence sentences an agent relays, not as this section. §5's '不能混在一个 JSON 里' is honoured as protocol-vs-relay: AgentProtocolPolicy stays code (RESERVED_KEYS rejects every protocol key at any depth, and the audit's AGENT_GUIDANCE.steps row is the negative control proving it), which is what keeps ONE merged document legitimate and creates no apps/web/content/agent/**. A named test pins levelBySection.agentRelayCopy === 'L1' so this reading cannot drift silently. RELAY SLOT COUNT, reconciled at P-6 as a SUPERSET rather than a mismatch: the schema's SIX slots against new15 §5's FOUR is not a drift, because each of the two extras is relay wording for a field the sealed contract already carries — `adds` for authorityDelta.adds and `notObserved` for authorityDelta.notObserved, both measured non-empty on the served identities (adds|notObserved = 1|8 on 17 pages, 0|9 on 2) and both gated on publicObservation.completeness === 'complete', mirroring the contract builder's own gate. So §5's four are the MINIMUM, and the reconciliation is an enforced rule rather than a count: EVERY relay slot must name a contract field or a plan fact as its basis, and a slot whose basis is absent must not be emitted. A seventh slot with no basis fails that check, which is why nothing was deleted and no $defs block moved.",
      schemaTag: PRESENTATION_CONTENT_VERSION,
      locale: doc.locale,
      levelBySection: LEVEL_BY_SECTION,
      resolvesToDefaults,
      overriddenSlots: resolved.overriddenSlots,
      unwiredSlots: resolved.unwiredSlots,
      unwiredSectionTitles: UNWIRED_SECTION_TITLES,
      // PR P-5 — the field that replaces the one above in practice. `unwiredSectionTitles`
      // is provably empty and stays for continuity; this map is the reviewable content:
      // every slot that cannot honestly be wired, with the measured reason, total over all
      // eight sections. A reviewer asking "why can't the catalog set this?" gets an answer
      // from the artifact instead of from prose.
      codeOwnedSlots: CODE_OWNED_SLOTS,
      overrideNameFaults: overrideNameFaults(resolved),
      rejectedSlots: resolved.rejectedSlots,
      validationErrors,
      ...digests,
    },
    layoutStructure: {
      $comment:
        "PR P-3. The section model the renderer actually emits, recorded so the supported-ordering claim is auditable rather than asserted. supportedOrderings is DERIVED by running checkLayoutSupport over every permutation of the six groups — not hand-counted — which is why the number is a measurement: the served markup FUSES disposition + primary_action inside one <section>, so only orderings keeping that run adjacent and in order can be emitted. NOTE displayGroupsIsEmittable=false: new14 §7's documentation numbering puts the primary action fifth, but the DOM emits it third; the vocabulary array is therefore a SET, not a layout, and three P-1 fixtures had used it as one. If a later PR (P-4b) splits the fused section, ABOVE_FOLD_SECTION_IDS changes and these numbers move on their own.",
      aboveFoldSectionIds: ABOVE_FOLD_SECTION_IDS,
      sectionGroups: SECTION_GROUPS,
      fusedGroupRuns: FUSED_GROUP_RUNS,
      emittedGroupOrder: DEFAULT_GROUP_ORDER,
      displayGroupVocabulary: DISPLAY_GROUPS,
      displayGroupsIsEmittable: isStructurallySupported([...DISPLAY_GROUPS]),
      totalOrderings: permutationCount,
      supportedOrderings: supportedCount,
      shippedCaps: SHIPPED_LAYOUT_CAPS,
    },
    tokenPlane: {
      $comment:
        "PR P-4b — the L0 level, SERVED. P-4 populated the plane and proved it unpublishable; this batch links it from all 19 install pages (+34 B each: a 56-B <link>, minus 22 B from refolding the boundary sentence onto one line, which is what let the fourth copy slot be wired at all). `served` is now true and `servedCopy` is the byte a visitor receives: sync-assets.mjs copies source → public/, and servedCopyMatchesSource BYTE-COMPARES them, because every other measure in this block reads the SOURCE while browsers read the copy — without that compare a hand-edit under public/ would pass all of them. baselineSelectors is asserted as an exact SET: the class-only parsers could not see an element rule at all, so `body`/`main` were both unmeasurable and, missing, would have shipped the <link> with none of the visual-hierarchy outcome (styled sections on a browser-default page). visualDigest digests the var()-RESOLVED declarations: a raw-bytes digest moves on a comment edit, and a name-only comparison would miss a palette re-pointed through renamed tokens. sharedTokenNames/tokensDrifted remain the DRIFT PIN against the served marketing sheet §4 forbids editing. selectorsCovered/selectorsUncovered are computed against install-* classes parsed from the COMMITTED served HTML. forbiddenConstructs and suppressionViolations must both stay empty, and suppression is now checked inside the baseline rules too — `body { display: none }` hides a disposition exactly as well as the class-scoped version did, and under the install-only scan it was not a finding.",
      plane: TOKEN_PLANE_CSS,
      planePresent: tokenPlanePresent,
      servedMirrorSource: SERVED_MARKETING_CSS,
      served: true,
      servedCopy: SERVED_TOKEN_CSS,
      servedCopyPresent: servedPlanePresent,
      servedCopyMatchesSource,
      baselineSelectors: BASELINE_SELECTORS,
      baselineSelectorsFound: baselineHeads,
      resolvedRuleCount: resolvedRules.length,
      visualDigest,
      tokensBlockPresent: tokensBlock !== undefined,
      tokensVersion: tokensBlock?.tokensVersion ?? null,
      stylesheetHref: tokensBlock?.stylesheetHref ?? null,
      emptyObjectDigest: EMPTY_OBJECT_DIGEST,
      l0DigestWasEmpty,
      tokenNames: planeTokens.tokens.map((t) => t.name),
      rootBlockCount: planeTokens.rootBlockCount,
      duplicateTokenNames: planeTokens.duplicateNames,
      servedTokenNames: servedTokens.tokens.map((t) => t.name),
      sharedTokenNames: drift.sharedNames,
      sharedTokensDrifted: drift.drifted,
      servedTokensNotMirrored: servedTokens.tokens
        .map((t) => t.name)
        .filter((n) => !planeTokens.tokens.some((t) => t.name === n)),
      cssRuleCount: countCssRules(tokenCss),
      installPagesMeasured: servedInstallPages().length,
      emittedInstallClasses: [...emittedClasses].sort(),
      selectorsStyled: planeStyled,
      selectorsCovered: [...emittedClasses].filter((c) => planeStyled.includes(c)).sort(),
      selectorsUncovered: uncoveredClasses,
      selectorsDeclaredButNeverEmitted: deadClasses,
      forbiddenConstructs,
      suppressionViolations: suppressions,
    },
    semanticContract: {
      $comment:
        "Read from the COMMITTED served sidecars (apps/web/public/install/**), so these are the bytes users actually receive — not a re-derivation that could agree with itself while disagreeing with production.",
      omissions: SEMANTIC_PREIMAGE_OMISSIONS,
      resourcesMeasured: resources.length,
      distinctContractDigests: distinctContract,
      distinctSemanticContractDigests: distinctSemantic,
      noProseLeaves: resources.every((r) => r.proseLeaves.length === 0),
      bindingUnchanged: true,
      resources,
    },
    importBoundary: {
      $comment:
        "ADR 0058 §2: nothing under packages/*/src/** may import the config plane, so configuration can only be reached by whoever was handed it. Enforced from P-1, before the directories exist.",
      rootsScanned: IMPORT_BOUNDARY_ROOTS,
      forbiddenSpecifiers: FORBIDDEN_IMPORTS,
      violations,
    },
    configuredCopy: {
      $comment:
        "PR P-5's headline claim, MEASURED rather than asserted: the guard and relay slices reach NO served byte. Every resolved string in both slices is searched for in all committed install pages AND all sealed contract sidecars; `hits` must be empty. This is stronger than the resolvesToDefaults identity above, which would still pass if a future edit routed guard copy into the install renderer — both sides of that comparison would move together. It is structural, not incidental: the guard offer renders to a terminal and the relay line lands in an MCP notes[] array. Because it reads the COMMITTED corpus, it also fails on a stale tree, which is the case `pnpm bake:trust-index && git status -- apps/web/public/` cannot distinguish from a clean one on its own.",
      slotsSearched: configuredCopyStrings.map((s) => s.slot),
      pagesSearched: servedInstallPages().length,
      contractsSearched: served.length,
      hits: configuredCopyHits,
    },
    failures,
  }
  return { json: JSON.stringify(report, null, 2) + "\n", pass: failures.length === 0, failures }
}

// --- modes -------------------------------------------------------------------

const argv = process.argv.slice(2)
const { json, pass, failures } = build()
const rel = path.relative(repoRoot, outPath).split(path.sep).join("/")

if (argv.includes("--write")) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, json, "utf8")
  console.log(`wrote ${rel} — ${pass ? "PASSED" : "FAILED"}`)
  process.exit(0)
}

if (argv.includes("--gate")) {
  if (pass) {
    console.log("presentation lock: PASSED — digest seams recorded, no prose bound, import boundary clean.")
    process.exit(0)
  }
  console.error("presentation lock: FAILED")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(2)
}

// default --check: committed artifact must match a fresh run.
if (!fs.existsSync(outPath)) {
  console.error(`${rel} is missing — run \`pnpm audit:presentation:lock:write\`.`)
  process.exit(1)
}
if (fs.readFileSync(outPath, "utf8") !== json) {
  console.error(`${rel} drifted from a fresh run — run \`pnpm audit:presentation:lock:write\` and review the diff.`)
  process.exit(1)
}
console.log(`${rel} matches a fresh run — ${pass ? "PASSED" : "FAILED"}`)
process.exit(0)
