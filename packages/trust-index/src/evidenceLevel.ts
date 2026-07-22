/**
 * Gate A / PR-D2 — Evidence-level (E0–E6) + four-dimension status, as a PROJECTION
 * over already-baked data (new12 §7; ADR 0053 §5). This introduces NO new score,
 * verdict, or authority model: it reads `page.preparation.state`, `authority`, and
 * the page's digests, and maps them to a display taxonomy.
 *
 * The four status dimensions are INDEPENDENT and MUST NOT be multiplied or averaged
 * into a single "trust score" (ADR 0053 §5) — this module returns them as four
 * separate labels and never combines them.
 *
 * Evidence levels (new12 §7.1) over the shipped preparation pipeline:
 *   E0  registry listing only            ← IDENTITY_ONLY
 *   E1  identity + artifact resolved      ← ARTIFACT_RESOLVED
 *   E2  install config → static blast radius ← AUTHORITY_NORMALIZED | DECIDED
 *   E3  static tool schema obtained       ← not reached by a config-only bake
 *   E4  maintainer CI signed receipt      ← not part of a baked page (separate source)
 *   E5  isolated sandbox / runtime        ← DEFERRED (opt-in, post-scale-out)
 *   E6  user's local install plan         ← Trust Gateway (consumer plane, not a page)
 * A static Trust Page baked from a config tops out at E2 — stated honestly rather
 * than inflated (UNKNOWN honesty; ADR 0053 §1 `I-04`).
 */
import type { BakedTrustPage } from "./bakeTrustPage.js"

export type EvidenceLevel = "E0" | "E1" | "E2" | "E3" | "E4" | "E5" | "E6"

export interface EvidenceLevelMeta {
  level: EvidenceLevel
  /** Short public label for the level. */
  label: string
  /** What judgment this level supports (verbatim from new12 §7.1). */
  supports: string
}

/** The E0–E6 taxonomy metadata (new12 §7.1). Deterministic, display-only. */
export const EVIDENCE_LEVEL_META: Record<EvidenceLevel, EvidenceLevelMeta> = {
  E0: { level: "E0", label: "Registry listing", supports: "discovery only — no safety judgment" },
  E1: { level: "E1", label: "Identity resolved", supports: "provenance & version pinning" },
  E2: { level: "E2", label: "Install config observed", supports: "launch command, env, static blast radius" },
  E3: { level: "E3", label: "Tool schema observed", supports: "declared actions & prompt surface (static)" },
  E4: { level: "E4", label: "Maintainer CI receipt", supports: "maintainer ran a specific version on exact inputs" },
  E5: { level: "E5", label: "Sandbox evidence", supports: "observed behavior — still not a future guarantee" },
  E6: { level: "E6", label: "Local install plan", supports: "this authorization decision (consumer plane)" },
}

/** The four independent status dimensions of a Trust Page (ADR 0053 §5). */
export interface FourDimensionStatus {
  /** 1. Verdict — the public label, verbatim (never re-derived here). */
  verdict: BakedTrustPage["verdict"]
  /** 2. Evidence completeness — how much was actually observed. */
  completeness: "complete" | "partial"
  /** 3. Authority — namespace control present/absent (control, never safety). */
  authorityClaimed: boolean
  /** 4. Reproducibility — the digest+time that makes this observation replayable. */
  reproducibility: { pageDigest: string; observedAt: string }
  /** The evidence level reached (E0–E6), a fifth display axis — also never combined. */
  evidenceLevel: EvidenceLevel
  /** Honest one-line rationale for why this level and not higher. */
  evidenceRationale: string
}

/**
 * Derive the evidence level from what the bake ACTUALLY resolved — the presence of
 * resolved objects, not the fail-closed terminal string (which has ~13 members mixing
 * failure states). Reads only shipped fields; never re-scores.
 *   - authority manifest present ⇒ install config was observed & normalized into a
 *     static blast-radius inventory ⇒ E2 (the top a config-only page can honestly reach).
 *   - artifact resolved but no authority ⇒ identity pinned only ⇒ E1.
 *   - artifact unresolved ⇒ identity only ⇒ E0.
 * E3+ (tool schema / maintainer receipt / sandbox / local plan) require a source a
 * static Trust Page does not carry — stated honestly, never faked (ADR 0053 §1 I-04).
 */
export function evidenceLevel(page: BakedTrustPage): { level: EvidenceLevel; rationale: string } {
  const artifactResolved = page.preparation.artifact.resolution === "resolved"
  const hasAuthority = page.preparation.authority !== null
  if (artifactResolved && hasAuthority) {
    return {
      level: "E2",
      rationale:
        "install config observed → static blast radius normalized into an authority inventory. " +
        "Higher levels (E3 tool schema, E4 maintainer receipt, E5 sandbox) are not carried by a static page.",
    }
  }
  if (artifactResolved) {
    return { level: "E1", rationale: "artifact identity resolved and pinned; authority not yet normalized." }
  }
  return { level: "E0", rationale: "identity not fully resolved — discovery/listing only, no safety judgment." }
}

/** Project the four independent status dimensions (+ evidence level). Never combines them. */
export function fourDimensionStatus(page: BakedTrustPage): FourDimensionStatus {
  const ev = evidenceLevel(page)
  return {
    verdict: page.verdict,
    completeness: page.preparation.authority?.completeness ?? "partial",
    authorityClaimed: false, // set by the renderer when a verifiedPublisher overlay is present.
    reproducibility: { pageDigest: page.pageDigest, observedAt: page.observedAt },
    evidenceLevel: ev.level,
    evidenceRationale: ev.rationale,
  }
}
