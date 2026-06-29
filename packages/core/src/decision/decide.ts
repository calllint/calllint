import type { CapabilityFingerprint, CompactDecision, ScanReport } from "@calllint/types"
import { fingerprintHash } from "../extract/fingerprint.js"
import { sparseDecision } from "../rules/sparseRules.js"

// ---------------------------------------------------------------------------
// P1.4 — Compact Decision projection (new4 L2 output — ADR 0020).
//
// Adapter: projects an existing ScanReport into the compact decision shape,
// without rewriting the pipeline. The verdict comes straight from the report
// (the risk engine decided it); reason codes and next action come from the
// sparse kernel. The fingerprint hash comes from the report's fingerprint when
// present, else from a fingerprint passed alongside.
// ---------------------------------------------------------------------------

export function toCompactDecision(
  report: ScanReport,
  surface: string,
  fingerprint?: CapabilityFingerprint,
): CompactDecision {
  const fp = fingerprint ?? report.fingerprint
  const hash = fp ? fingerprintHash(fp) : ""
  const sparse = sparseDecision(report.verdict, report.findings)
  return {
    schemaVersion: "calllint.decision.v0",
    verdict: sparse.verdict,
    surface,
    fingerprintHash: hash,
    reasonCodes: sparse.reasonCodes,
    nextAction: sparse.nextAction,
  }
}
