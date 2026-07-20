/**
 * calllint.evidence-snapshot.v0 — the committed, retained result of resolving the
 * registry cohort's remote subjects over the network (ADR 0050 §4). The producer
 * (`resolveEvidence.ts`) is the ONLY thing that fetches; it freezes the resolved
 * EvidenceBundles here. The bake then reads this file PURELY and refines verdicts
 * from it, so `(committed snapshot) → (baked bytes)` stays a pure function and the
 * reproducibility diff gate (ADR 0046 §4) is unaffected.
 *
 * Bundles are keyed by their subject id (the endpoint URL) — the same string the
 * scan reports as `report.target.source`, which is how the refinement joins them.
 * The snapshot carries ONLY resolved identity fields + coded gaps; the resolvers
 * already refuse to emit PII (the §4.7 no-private-info guard), so nothing here
 * exposes contact/whois data.
 */
import type { EvidenceBundle } from "@calllint/evidence"

/** The committed evidence-snapshot document. */
export interface EvidenceSnapshot {
  schema: "calllint.evidence-snapshot.v0"
  /** ISO-8601 UTC captured when resolution ran; pinned for a reproducible re-bake. */
  resolvedAt: string
  count: number
  /** Resolved bundles, sorted by subject id for byte-stability. */
  bundles: EvidenceBundle[]
}

/** Fields we refuse to serialize — a defense-in-depth PII guard over the resolvers. */
const PII_FIELD_PATTERN = /(^|\.)(email|phone|contact|whois|owner_?email|address)($|\.)/i

/**
 * Parse + validate a committed evidence snapshot. Pure. Throws on a wrong schema,
 * a non-array `bundles`, or any item field that looks like PII — a corrupt or
 * privacy-violating snapshot must fail the bake LOUDLY, never silently bake stale
 * or leak private data.
 */
export function parseEvidenceSnapshot(text: string): EvidenceSnapshot {
  const doc = JSON.parse(text) as Partial<EvidenceSnapshot>
  if (doc.schema !== "calllint.evidence-snapshot.v0") {
    throw new Error(`evidence-snapshot: unexpected schema ${JSON.stringify(doc.schema)}`)
  }
  if (typeof doc.resolvedAt !== "string" || doc.resolvedAt.length === 0) {
    throw new Error("evidence-snapshot: resolvedAt must be a non-empty string")
  }
  if (!Array.isArray(doc.bundles)) {
    throw new Error("evidence-snapshot: bundles must be an array")
  }
  for (const b of doc.bundles) {
    if (b?.schema !== "calllint.evidence-bundle.v0" || !b.subject?.id) {
      throw new Error("evidence-snapshot: each bundle must be a calllint.evidence-bundle.v0 with a subject id")
    }
    for (const item of b.items ?? []) {
      if (PII_FIELD_PATTERN.test(item.field)) {
        throw new Error(`evidence-snapshot: refused PII field "${item.field}" for ${b.subject.id}`)
      }
    }
  }
  return doc as EvidenceSnapshot
}

/**
 * Serialize an evidence snapshot to committed bytes. Sorts bundles by subject id so
 * the file is byte-stable regardless of the order resolution completed in.
 */
export function serializeEvidenceSnapshot(snap: EvidenceSnapshot): string {
  const bundles = [...snap.bundles].sort((a, b) =>
    a.subject.id < b.subject.id ? -1 : a.subject.id > b.subject.id ? 1 : 0,
  )
  return JSON.stringify({ ...snap, count: bundles.length, bundles }, null, 2) + "\n"
}

/** Build the subject-id → bundle lookup the bake refinement joins on. */
export function evidenceMap(snap: EvidenceSnapshot | null): Map<string, EvidenceBundle> {
  const map = new Map<string, EvidenceBundle>()
  if (!snap) return map
  for (const b of snap.bundles) map.set(b.subject.id, b)
  return map
}
