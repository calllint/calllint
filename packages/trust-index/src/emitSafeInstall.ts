// ---------------------------------------------------------------------------
// Phase 2.4 Batch 2 — Safe-install SHADOW emit (ADR 0056; new14-integration §6).
//
// PURE (no I/O, no clock): given the same committed snapshot + evidence + engine
// version it returns byte-identical files, which is what makes the committed
// shadow tree a reproducibility gate (mirrors emitCohort's contract). It projects
// the REGISTRY cohort only — real, claimable resources — into the acquisition
// surface: a human Install page + a machine Contract sidecar per resource, plus
// one discovery manifest. Fixtures (synthetic reproducibility goldens) are NEVER
// an acquisition target, and registryCohort already excludes them.
//
// This is SHADOW output: Batch 2 writes it under artifacts/phase-2.4/, NOT into
// apps/web/public. It touches neither emitAllCohorts, the served Trust tree, the
// sitemap, nor index.json — so the shipped reproducibility gate is unmoved. Batch
// 3 promotes these bytes into /install/** + links them from the sitemap/lookup.
// ---------------------------------------------------------------------------

import { hashJson } from "@calllint/fingerprint"
import { bakeTrustPage, ConfigParseError } from "./bakeTrustPage.js"
import { registryCohort } from "./registryCohort.js"
import { registryCanonicalName, type RegistrySnapshot, type SnapshotEntry } from "./snapshot.js"
import { evidenceMap, type EvidenceSnapshot } from "./evidenceSnapshot.js"
import { safeInstallProjection } from "./safeInstallProjection.js"
import type { AdoptionSubjectInput } from "./agentAdoptionContract.js"
import { renderSafeInstall, renderSafeInstallContract } from "./renderSafeInstall.js"
import { renderDiscoveryManifest, type DiscoveryResourceEntry } from "./renderDiscoveryManifest.js"
import type { Installability } from "./safeInstallProjection.js"
import type { EmittedFile } from "./emitCohort.js"

/**
 * One emitted acquisition resource — the canonical name/slug plus its human/route
 * installability. Returned alongside the files so `emitAllCohorts` can link the SAME
 * set from the sitemap and enrich the matching lookup entries, without recomputing
 * membership or the route (INV-2.4-01: one membership decision drives every surface).
 */
export interface EmittedInstallResource {
  readonly canonicalName: string
  readonly canonicalSlug: string
  readonly installability: Installability
}

/** The result of the Safe-install emit: files to write + the per-resource route set. */
export interface EmittedSafeInstall {
  readonly files: EmittedFile[]
  readonly resources: EmittedInstallResource[]
}

/** The `sha256:0…` sentinel for an absent evidence snapshot (a stable, honest null). */
const NULL_DIGEST = "sha256:" + "0".repeat(64)

/**
 * Build the exact-target subject for one registry entry. The canonical slug REUSES
 * the Trust Page canonical name verbatim (no second slug function — ADR 0056 §Naming).
 * Package coordinates come from the first declared package; a remote-only entry has no
 * package (so version may be null ⇒ the contract degrades to LOCAL_PREFLIGHT_REQUIRED,
 * INV-2.4-06). `publisherDescription` is carried untrusted, for display only.
 */
function subjectForEntry(canonicalName: string, entry: SnapshotEntry): AdoptionSubjectInput {
  const pkg = entry.packages[0]
  const version = pkg?.version ?? entry.version ?? null
  const sourceLocator = pkg
    ? `${pkg.registryType}:${pkg.identifier}${pkg.version ? `@${pkg.version}` : ""}`
    : (entry.remotes[0]?.url ?? null)
  return {
    canonicalName,
    canonicalSlug: canonicalName,
    packageType: pkg?.registryType ?? null,
    packageName: pkg?.identifier ?? null,
    version,
    sourceLocator,
    publisherDescription: entry.description || null,
  }
}

/**
 * Emit the Safe-install shadow tree from a committed snapshot. Pure + deterministic.
 * `engineVersion` is a deterministic input (the trust-index package version), passed
 * by the caller so the bin and the reproducibility test agree byte-for-byte. A null
 * snapshot ⇒ no acquisition surface (empty manifest, no pages) — the surface only
 * exists once real resources are baked. Digests are hashes over the committed inputs
 * (pure), so they are stable per committed tree and re-derive identically in CI.
 */
export function emitSafeInstall(
  snapshot: RegistrySnapshot | null,
  evidence: EvidenceSnapshot | null,
  engineVersion: string,
): EmittedSafeInstall {
  const files: EmittedFile[] = []
  const discovery: DiscoveryResourceEntry[] = []
  const resources: EmittedInstallResource[] = []

  const snapshotDigest = snapshot ? hashJson(snapshot) : NULL_DIGEST
  const registrySnapshotDigest = snapshotDigest
  const evidenceDigest = evidence ? hashJson(evidence) : NULL_DIGEST
  const evidenceBundles = evidenceMap(evidence)

  // canonicalName → source entry, first-wins (parity with registryCohort's duplicate
  // handling: it keeps the first occurrence, marks the rest incomplete). Built with the
  // SAME registryCanonicalName so the acquisition surface can never disagree with the
  // index about which entry a page came from — no second slug function (ADR 0056 §Naming).
  const entryByName = new Map<string, SnapshotEntry>()
  if (snapshot) {
    for (const entry of snapshot.entries) {
      const name = registryCanonicalName(entry.name)
      if (!entryByName.has(name)) entryByName.set(name, entry)
    }
  }

  const plans = snapshot ? registryCohort(snapshot) : []
  for (const plan of plans) {
    if (plan.input === null) continue // incomplete entry — no acquisition page
    const entry = entryByName.get(plan.canonicalName)
    if (!entry) continue
    try {
      const page = bakeTrustPage({ ...plan.input, evidence: evidenceBundles })
      const subject = subjectForEntry(plan.canonicalName, entry)
      const projection = safeInstallProjection({
        page,
        subject,
        snapshotDigest,
        registrySnapshotDigest,
        evidenceDigest,
        engineVersion,
      })
      const slug = projection.canonicalSlug
      files.push({ path: `install/${slug}/index.html`, content: renderSafeInstall(projection) })
      files.push({ path: `install/${slug}/index.json`, content: renderSafeInstallContract(projection) })
      discovery.push({ canonicalName: projection.canonicalName, canonicalSlug: slug })
      resources.push({
        canonicalName: projection.canonicalName,
        canonicalSlug: slug,
        installability: projection.installability,
      })
    } catch (err) {
      if (err instanceof ConfigParseError) continue // malformed ⇒ no page (parity with emitCohort)
      throw err
    }
  }

  files.push({ path: ".well-known/calllint.json", content: renderDiscoveryManifest(discovery) })
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  // `resources` stays in discovery order (registry-cohort order); the caller sorts where
  // a stable projection is needed (the lookup index sorts by canonicalName, the sitemap
  // by slug), so no sort here keeps this a faithful "what was emitted, in emit order" list.
  return { files, resources }
}
