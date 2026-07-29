// ---------------------------------------------------------------------------
// Workstream P Batch 1 — the digest seams (new15 §6.2 PR P-1; §7 multi-digest
// model; ADR 0058 §1/§5).
//
// PURE + deterministic: no I/O, no clock, no RNG, no LLM. Hashing uses the
// shipped `hashJson` (stableStringify + sha256), so key order is irrelevant and
// digests are stable across platforms.
//
// THE PROBLEM (new15 §7). Renaming a button from "Add with CallLint" to "Add with
// protection" must not invalidate every sealed install plan. Today a single
// `contractDigest` covers the whole contract object, and that object contains two
// human-readable strings. So the repo needs a digest that binds MEANING and a
// digest that binds COPY, and they must be different digests.
//
//   presentationDigest      → human copy, layout selection, token version
//   semanticContractDigest  → the agent-executable semantics of the contract
//
// HOW `semanticContractDigest` IS DEFINED — by DELETION, not by construction.
// Building a parallel "semantic object" would create a second source of truth
// that silently drifts from the contract whenever a field is added. Instead the
// preimage is the sealed contract MINUS a declared omission set, so every new
// contract field is bound by default and omission is the reviewable exception.
//
// WHICH FIELDS, AND WHY THAT IS A MEASUREMENT. The omission set was not chosen by
// taste. Walking all 19 committed served sidecars for string leaves containing
// whitespace yields exactly three paths:
//
//     agentGuidance.goal                     1 distinct value  (constant)
//     publicObservation.publicLabel          2 distinct values (=== VERDICT_PUBLIC_LABEL[verdict], 0 mismatches)
//     untrustedPublisherContent.description  19 distinct values (already excluded from contractDigest)
//
// Everything else is a SCREAMING_SNAKE enum, a snake_case protocol identifier, a
// sha256: digest, a semver, an ISO timestamp, or a package coordinate. So "which
// contract fields are copy?" has a mechanical answer: a string leaf is prose iff
// it contains whitespace. Both prose leaves inside `contractDigest` are fully
// recomputable — `publicLabel` from `verdict` via the frozen map, `goal` from the
// schema tag — so omitting them loses exactly zero information.
//
// That yields the invariant that makes this whole seam worth having, and it is
// checked rather than claimed (`proseLeaves` must be empty):
//
//     the semantic preimage contains NO prose at all.
//
// A future contract field carrying a sentence therefore FAILS the gate until
// somebody classifies it. The rule cannot rot quietly, which is the only kind of
// rule worth writing down.
//
// WHAT THIS PR DELIBERATELY DOES NOT DO. new15 §2.5 says install plans SHOULD bind
// `semanticContractDigest`. Re-pointing that binding would change
// `expectedContractDigest` in every sealed plan — a behavior change, and PR P-1 is
// declared "changes behavior: no" (new15 §6.2). So P-1 COMPUTES and RECORDS this
// digest and proves its stability properties; actually re-pointing the binding is
// a PR P-7 decision that needs its own ADR amendment. Recording a digest is not
// the same as binding it, and conflating the two here would smuggle a behavior
// change into a batch labelled as having none.
// ---------------------------------------------------------------------------

import { hashJson } from "@calllint/fingerprint"
import {
  EMPTY_PRESENTATION_CONTENT,
  LEVEL_BY_SECTION,
  type PresentationContentV1,
  type PresentationLevel,
  type PresentationSection,
} from "./presentationContent.js"

// --- presentationDigest -----------------------------------------------------

/** Per-level digests, so the §7 dependency graph can tell what a change requires. */
export interface PresentationDigestSet {
  /** sha256 over the whole canonical document. */
  readonly presentationDigest: string
  /** sha256 over only the L0 (token) sections. */
  readonly l0Digest: string
  /** sha256 over only the L1 (cognitive copy) sections. */
  readonly l1Digest: string
  /** sha256 over only the L2 (security-explanation copy) sections. */
  readonly l2Digest: string
  /** Sections actually present in the document, in declaration order. */
  readonly sections: readonly PresentationSection[]
}

/** The document's canonical form: sections in a fixed order, absent keys omitted. */
function canonicalDocument(doc: PresentationContentV1): Record<string, unknown> {
  const out: Record<string, unknown> = { schema: doc.schema, locale: doc.locale }
  for (const section of Object.keys(LEVEL_BY_SECTION) as PresentationSection[]) {
    const value = (doc as unknown as Record<string, unknown>)[section]
    if (value !== undefined) out[section] = value
  }
  return out
}

/** Project only the sections at one level; `{}` when none are present. */
function sectionsAtLevel(doc: PresentationContentV1, level: PresentationLevel): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const section of Object.keys(LEVEL_BY_SECTION) as PresentationSection[]) {
    if (LEVEL_BY_SECTION[section] !== level) continue
    const value = (doc as unknown as Record<string, unknown>)[section]
    if (value !== undefined) out[section] = value
  }
  return out
}

/**
 * Compute the presentation digest set over one content document.
 *
 * Level digests are separate because §7's dependency graph asks a real question:
 * a CSS-only change (L0) should not force the human pages to rebuild, and a copy
 * change (L1/L2) should not touch the agent contract at all. One aggregate digest
 * cannot answer that; four can.
 */
export function presentationDigest(doc: PresentationContentV1): PresentationDigestSet {
  const canonical = canonicalDocument(doc)
  const sections = (Object.keys(LEVEL_BY_SECTION) as PresentationSection[]).filter(
    (s) => (doc as unknown as Record<string, unknown>)[s] !== undefined,
  )
  return {
    presentationDigest: hashJson(canonical),
    l0Digest: hashJson(sectionsAtLevel(doc, "L0")),
    l1Digest: hashJson(sectionsAtLevel(doc, "L1")),
    l2Digest: hashJson(sectionsAtLevel(doc, "L2")),
    sections,
  }
}

/**
 * The digest of the canonical EMPTY document — the honest digest of "there is no
 * content plane yet", which is the state at PR P-1 (apps/web/content/** does not
 * exist). The lock file records this rather than a null, so PR P-7's rollback has
 * a real predecessor to restore instead of a special case to branch on.
 */
export function emptyPresentationDigest(): PresentationDigestSet {
  return presentationDigest(EMPTY_PRESENTATION_CONTENT)
}

// --- semanticContractDigest -------------------------------------------------

/** One declared omission from the semantic preimage, with its justification. */
export interface SemanticOmission {
  /** Dotted path into the sealed contract. */
  readonly path: string
  /**
   * Why removing it loses no semantics:
   *   `self-referential` — the field IS a digest over the object containing it;
   *   `untrusted`        — publisher-controlled, already outside `contractDigest`;
   *   `recomputable`     — derivable from a machine field that remains bound;
   *   `constant`         — one value across every contract, so it carries no information.
   */
  readonly reason: "self-referential" | "untrusted" | "recomputable" | "constant"
  readonly rationale: string
}

/**
 * The EXHAUSTIVE omission set. Anything not listed here is bound by
 * `semanticContractDigest`, so adding a contract field binds it by default —
 * omission is the reviewable exception, never the silent default.
 */
export const SEMANTIC_PREIMAGE_OMISSIONS: readonly SemanticOmission[] = Object.freeze([
  {
    path: "contract.contractDigest",
    reason: "self-referential",
    rationale: "The digest cannot be part of its own preimage; sealAgentAdoptionContract already excludes it.",
  },
  {
    path: "recommendedNextAction.arguments.expectedContractDigest",
    reason: "self-referential",
    rationale: "Same digest echoed into the action arguments; excluded by the shipped seal for the same reason.",
  },
  {
    path: "untrustedPublisherContent.description",
    reason: "untrusted",
    rationale:
      "Publisher-controlled marketing text, already excluded from contractDigest so a publisher cannot invalidate every agent's expected digest. It travels for display only.",
  },
  {
    path: "publicObservation.publicLabel",
    reason: "recomputable",
    rationale:
      "VERDICT_PUBLIC_LABEL[verdict] — measured identical on all 19 served sidecars, 0 mismatches. The verdict token stays bound, so the label adds no semantics and only adds copy fragility.",
  },
  {
    path: "agentGuidance.goal",
    reason: "constant",
    rationale:
      "One distinct value across all 19 served sidecars. A constant carries no per-subject information; the protocol steps/mustAsk/mustStop/prohibitedShortcuts that DO carry semantics all remain bound.",
  },
] as const)

/** Delete one dotted path from a deeply-cloned object; returns whether it existed. */
function deletePath(root: Record<string, unknown>, dotted: string): boolean {
  const parts = dotted.split(".")
  let node: Record<string, unknown> = root
  for (const part of parts.slice(0, -1)) {
    const next = node[part]
    if (next === null || typeof next !== "object" || Array.isArray(next)) return false
    node = next as Record<string, unknown>
  }
  const leaf = parts[parts.length - 1] as string
  if (!Object.prototype.hasOwnProperty.call(node, leaf)) return false
  delete node[leaf]
  return true
}

/** Which declared omissions were actually present in this contract. */
export interface SemanticPreimageResult {
  readonly preimage: Record<string, unknown>
  /** Paths that existed and were removed. */
  readonly applied: readonly string[]
  /**
   * Declared paths absent from this contract. NOT an error: `expectedContractDigest`
   * only exists on a PREPARE_LOCALLY action, and `description` is null when the
   * publisher supplied none. Recorded so the artifact states what was actually done.
   */
  readonly notPresent: readonly string[]
}

/**
 * Build the semantic preimage: the sealed contract minus the declared omissions.
 * Pure — the input is deep-cloned, never mutated.
 */
export function semanticPreimage(contract: unknown): SemanticPreimageResult {
  const clone = JSON.parse(JSON.stringify(contract)) as Record<string, unknown>
  const applied: string[] = []
  const notPresent: string[] = []
  for (const omission of SEMANTIC_PREIMAGE_OMISSIONS) {
    if (deletePath(clone, omission.path)) applied.push(omission.path)
    else notPresent.push(omission.path)
  }
  return { preimage: clone, applied, notPresent }
}

/**
 * Every string leaf in a value that contains whitespace, with its path.
 *
 * This is the gate on the omission set (see the module header). Machine tokens —
 * enums, snake_case identifiers, sha256 digests, semver, ISO timestamps, package
 * coordinates — never contain whitespace; prose always does. So an EMPTY result
 * over the semantic preimage is a mechanical proof that no copy is bound by
 * `semanticContractDigest`, for any input rather than just the probed ones.
 */
export function proseLeaves(value: unknown, path = ""): readonly { path: string; value: string }[] {
  if (typeof value === "string") {
    return /\s/.test(value) ? [{ path, value }] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => proseLeaves(v, `${path}[${i}]`))
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((k) => proseLeaves((value as Record<string, unknown>)[k], path === "" ? k : `${path}.${k}`))
  }
  return []
}

/** A computed semantic digest plus the measurements that justify it. */
export interface SemanticContractDigestResult {
  /** sha256 over the semantic preimage. */
  readonly semanticContractDigest: string
  /** The contract's own sealed digest, for comparison. Never recomputed here. */
  readonly contractDigest: string | null
  readonly omissionsApplied: readonly string[]
  readonly omissionsNotPresent: readonly string[]
  /** MUST be empty. Non-empty ⇒ an unclassified prose field entered the contract. */
  readonly proseLeaves: readonly { path: string; value: string }[]
}

/**
 * Compute `semanticContractDigest` for one sealed contract.
 *
 * Stability property this establishes, and the reason the seam exists: the digest
 * is invariant under every L1/L2 copy edit AND under a `publicLabel` edit, while
 * `contractDigest` moves for the latter. It still moves for a real semantic change
 * (a protocol step, an authority token, a verdict), which is the negative control —
 * a digest that never moves is not binding anything.
 */
export function semanticContractDigest(contract: unknown): SemanticContractDigestResult {
  const { preimage, applied, notPresent } = semanticPreimage(contract)
  const sealed =
    contract !== null && typeof contract === "object"
      ? ((contract as { contract?: { contractDigest?: unknown } }).contract?.contractDigest ?? null)
      : null
  return {
    semanticContractDigest: hashJson(preimage),
    contractDigest: typeof sealed === "string" ? sealed : null,
    omissionsApplied: applied,
    omissionsNotPresent: notPresent,
    proseLeaves: proseLeaves(preimage),
  }
}
