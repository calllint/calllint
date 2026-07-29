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
  UNWIRED_SECTION_TITLES,
  emitSafeInstall,
  emptyPresentationDigest,
  isStructurallySupported,
  parseEvidenceSnapshot,
  parseSnapshot,
  presentationDigest,
  resolvePresentation,
  semanticContractDigest,
  validatePresentationContent,
  type PresentationContentV1,
  type ResolvedPresentation,
} from "../packages/trust-index/src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outPath = path.join(repoRoot, "artifacts", "phase-2.4", "presentation-lock.json")

/** The content plane. Absent at P-1; created by PR P-2 — measured, not assumed. */
const CONTENT_ROOT = "apps/web/content/safe-install"
/** The merged document P-2 writes; the lock validates and digests it. */
const CONTENT_DOC = `${CONTENT_ROOT}/presentation.v1.json`

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
  //     is a failure rather than a note. `boundary` is schema-valid and deliberately
  //     unwired (see renderSafeInstall's SECTION_TITLES), which is why the document must
  //     not carry it yet.
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
    JSON.stringify(resolved.layout) === JSON.stringify(DEFAULT_PRESENTATION.layout)
  if (docPresent && validationErrors.length === 0 && !resolvesToDefaults) {
    failures.push(
      `${CONTENT_DOC}: resolves to copy that differs from the shipped code defaults — ` +
        `committing the catalog would change served bytes, which ADR 0058 §4 reserves for PR P-4b`,
    )
  }
  for (const slot of resolved.unwiredSlots) {
    failures.push(
      `${CONTENT_DOC}: configures ${slot}, which no renderer consumes yet — ` +
        `a config key that validates and then does nothing (unwired: ${UNWIRED_SECTION_TITLES.join(", ")})`,
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

  // 4 — the import boundary (ADR 0058 §2).
  const violations = importBoundaryViolations()
  for (const v of violations) {
    failures.push(`forbidden config-plane import: ${v} — presentation config is a PARAMETER, not an import (ADR 0058 §2)`)
  }

  const report = {
    schema: "calllint.presentation-lock.v0",
    $comment:
      "Workstream P digest seams (ADR 0058 §5; new15 §7), re-baselined by PR P-2 now that the content plane exists. RECORDS presentationDigest + semanticContractDigest; it does NOT re-point what install plans bind — plans still bind contractDigest, and moving that binding is a P-7 decision requiring an ADR amendment (doing it here would smuggle a behavior change into a batch declared as having none). `semanticContractDigest` is defined by DELETION from the sealed contract, so a new contract field is bound by default and omission is the reviewable exception. The gate is noProseLeaves: machine tokens carry no whitespace, prose always does, so an empty result proves no copy is bound — for any input, not just those measured. Regenerate with `pnpm audit:presentation:lock:write`; enforce with `pnpm audit:presentation:lock:gate`.",
    workstream: "P",
    pr: "P-3",
    status: failures.length === 0 ? "PASSED" : "FAILED",
    contentPlane: {
      root: CONTENT_ROOT,
      document: CONTENT_DOC,
      state: docPresent ? "present" : "absent",
      $comment:
        "PRESENT since PR P-2, which lifted the Install-surface L1/L2 copy into this one merged document (O-4: newest surface first). The recorded digests are over the real committed bytes; P-1's baseline recorded the canonical EMPTY document instead, because the plane did not exist yet. resolvesToDefaults is the load-bearing measurement: the committed document resolves DEEP-EQUAL to the shipped code defaults through the same resolver the bake calls, which is why creating this file changes no served byte (ADR 0058 §4 — a visual change is PR P-4b's own PR). overriddenSlots is recorded so the identity claim cannot hold vacuously via an inert document, and unwiredSlots must stay empty so a key can never validate and then do nothing.",
      schemaTag: PRESENTATION_CONTENT_VERSION,
      locale: doc.locale,
      levelBySection: LEVEL_BY_SECTION,
      resolvesToDefaults,
      overriddenSlots: resolved.overriddenSlots,
      unwiredSlots: resolved.unwiredSlots,
      unwiredSectionTitles: UNWIRED_SECTION_TITLES,
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
