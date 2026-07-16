/**
 * Bake a single Trust Page artifact (I1a) — the ingestion plane's core step.
 *
 * PURE and DETERMINISTIC: given the same config text, the same pinned timestamps,
 * and the same engine version, this returns a byte-identical `BakedTrustPage`.
 * It orchestrates only the shipped, already-audited engines — it introduces no new
 * verdict logic and no new scan (ADR 0046 §1; same rule as Phase F/G/H):
 *
 *   scanConfigText  (@calllint/core)          → the verdict + evidence
 *   parseConfigText (@calllint/config-parser) → the normalized servers
 *   buildAuthorityManifest (@calllint/core)   → the digest-sealed capability inventory
 *   hashJson (@calllint/fingerprint)          → the artifact + page digests
 *   prepare  (@calllint/core)                 → the read-only TrustPreparation (page content)
 *
 * The whole reuse chain is clock-free and RNG-free in `src` (verified), so the only
 * non-deterministic inputs are the two timestamps, which the caller injects. This is
 * what makes the page reproducible (ADR 0046 §4 CI diff gate; ADR 0038 §5).
 *
 * A page never claims "certified/verified safe" — it states a verdict "observed at
 * digest D at time T" under stated completeness (ADR 0038 §2). The `verdict` here is
 * exactly the engine's `SAFE/REVIEW/BLOCK/UNKNOWN`, never re-scored.
 */
import type {
  ArtifactIdentity,
  AuthorityManifest,
  ConfigSummaryReport,
  TrustPreparation,
  Verdict,
} from "@calllint/types"
import { parseConfigText, ConfigParseError } from "@calllint/config-parser"
import { scanConfigText, buildAuthorityManifest, prepare } from "@calllint/core"
import { hashJson, sha256 } from "@calllint/fingerprint"

/** A single resource to bake: raw config bytes + a stable canonical name. */
export interface BakeInput {
  /**
   * Canonical `{namespace}/{name}` identity of the resource (stable across runs).
   * For the fixtures cohort this is derived from the fixture file name.
   */
  canonicalName: string
  /** The raw config text (mcp.json) — the exact bytes we evaluated and retain. */
  configText: string
  /**
   * A stable path label for parse diagnostics / the artifact `source`. Never a
   * machine-specific absolute path (that would break reproducibility across hosts).
   */
  sourceLabel: string
  /**
   * ISO-8601 UTC, injected. Used as BOTH `generatedAt` (scan) and `resolvedAt` /
   * `preparedAt` (identity / preparation). Pinning it is what makes the bake
   * reproducible. The caller supplies a fixed value for the fixtures cohort.
   */
  observedAt: string
}

/** The baked page: the page content object + its addressing digests + a flat header. */
export interface BakedTrustPage {
  /** `sha256:` content digest of the artifact bytes — the primary key (digest-addressed). */
  artifactDigest: `sha256:${string}`
  /** `sha256:` digest of the canonical page content — changes iff the page content changes. */
  pageDigest: `sha256:${string}`
  canonicalName: string
  /** The engine verdict, verbatim. Never re-scored, never upgraded. */
  verdict: Verdict
  /** The read-only preparation (artifact + authority + decision + notes + state). */
  preparation: TrustPreparation
  /** The full scan summary (per-server reports + counts), for the JSON sidecar. */
  scan: ConfigSummaryReport
  /** ISO-8601 UTC this page was observed at (the injected, pinned timestamp). */
  observedAt: string
}

/**
 * Canonicalize config text so the artifact digest is a property of content, not of
 * how the file was checked out. Normalizes CRLF/CR to LF and strips a leading UTF-8
 * BOM. Idempotent — applying it twice is the same as once.
 */
export function canonicalizeConfigText(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
}

/**
 * Build a fully-pinned Artifact Identity for a local config we own (an `mcp-config`
 * source). Because the bytes are in hand, the artifact is `resolved`: `resolvedRef`
 * and `digest` are the content hash, so it passes the G1 gate in `prepare` and is
 * byte-reproducible. This mirrors how the CLI edge constructs identity, but for a
 * local fixture there is nothing to fetch. Canonicalizes the text first so the
 * digest matches `bakeTrustPage` regardless of the caller's line endings.
 */
export function fixtureArtifactIdentity(input: BakeInput): ArtifactIdentity {
  const digest = sha256(canonicalizeConfigText(input.configText)) as `sha256:${string}`
  return {
    schema: "calllint.artifact.v1",
    sourceType: "mcp-config",
    source: input.sourceLabel,
    requestedRef: null,
    resolvedRef: digest,
    digest,
    resolvedAt: input.observedAt,
    resolution: "resolved",
  }
}

/**
 * Bake one Trust Page. Throws `ConfigParseError` for a malformed config — the caller
 * decides whether that is a page marked `incomplete` (never silently dropped; ADR
 * 0038 completeness) or a hard error. We surface it rather than swallowing it.
 */
export function bakeTrustPage(input: BakeInput): BakedTrustPage {
  // 0. Canonicalize line endings BEFORE anything reads the bytes. A config's
  //    meaning is line-ending-independent, so the artifact digest must be too —
  //    otherwise the same source checked out CRLF on Windows vs LF on Linux would
  //    hash differently and the page would not be reproducible across platforms.
  //    This is the single point where OS-dependent input becomes canonical.
  const configText = canonicalizeConfigText(input.configText)
  const canon: BakeInput = { ...input, configText }

  // 1. Scan (the only scan) — verdict + evidence, with a pinned generatedAt.
  const scan = scanConfigText(configText, canon.sourceLabel, {
    generatedAt: canon.observedAt,
  })

  // 2. Parse for the authority inventory (servers only; no clock).
  const parsed = parseConfigText(configText, canon.sourceLabel)

  // 3. Artifact identity (fully pinned — local bytes in hand). The digest is the
  //    content hash and is always present for a resolved local fixture; hold it in
  //    a non-null local so downstream types stay `sha256:${string}`, not `| null`.
  const artifactDigest = sha256(configText) as `sha256:${string}`
  const artifact = fixtureArtifactIdentity(canon)

  // 4. Authority manifest — digest-sealed capability inventory over the servers.
  const authority: AuthorityManifest = buildAuthorityManifest({
    artifactDigest,
    servers: parsed.servers,
  })

  // 5. Read-only preparation = the page content. Pure; preparedAt injected.
  //    We attach the authority inventory; the decision object is out of I1a's
  //    scope (I1b wires decideOverAuthority), so the preparation stops honestly at
  //    AUTHORITY_NORMALIZED rather than fabricating a decision.
  const preparation = prepare({
    artifact,
    authority,
    preparedAt: input.observedAt,
  })

  // 6. Page digest = hashJson over the canonical, address-independent content.
  //    Excludes the two addressing digests themselves so the digest is stable and
  //    self-consistent (same pattern as every sealed object: hash the body).
  const pageContent = {
    canonicalName: input.canonicalName,
    verdict: scan.verdict,
    preparation,
    scan,
    observedAt: input.observedAt,
  }
  const pageDigest = hashJson(pageContent) as `sha256:${string}`

  return {
    artifactDigest,
    pageDigest,
    canonicalName: input.canonicalName,
    verdict: scan.verdict,
    preparation,
    scan,
    observedAt: input.observedAt,
  }
}

export { ConfigParseError }
