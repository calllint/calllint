/**
 * PR-D5 — the publish-channel classifier (new12 §2.6; ADR 0053 §4).
 *
 * ADR 0053 §4 locks THREE publish channels so "a scan succeeded" is never silently
 * equated with "safe to publish publicly". This module makes that classification a
 * single PURE function over an already-baked page — it reads the shipped verdict +
 * finding `severity`/`blocker` VERBATIM and only ROUTES a page to a channel. It
 * introduces NO new verdict, score, or authority model, and it NEVER moves a verdict
 * (ADR 0053 §2). The channel is a gate on *publishing*, not a judgment of the artifact.
 *
 *   • AUTO_PUBLISH  — verdict unchanged / UNKNOWN→REVIEW under the same evidence, with
 *                     NO negative claim about the party. Ships through the existing
 *                     PR-gated bake. (SAFE, UNKNOWN, ordinary REVIEW, and the
 *                     evidence-limitation high-sev REVIEW allow-set below.)
 *   • REVIEW_HOLD   — a high-severity REVIEW that makes a party-negative claim. Held
 *                     for Gate-B dual human review (§4 exit condition) before publish.
 *   • SECURITY_HOLD — any BLOCK / blocker / critical finding. Held until the Gate-B
 *                     thresholds are demonstrated on a human-verified sample (§6.1).
 *
 * Fail-closed: an UNRECOGNIZED high-severity REVIEW defaults to REVIEW_HOLD (a human
 * must look), never silently AUTO_PUBLISH. The allow-set is a narrow, explicit list of
 * reason-code ids whose finding asserts CallLint's OWN non-verification (evidence
 * limitation) rather than a negative claim about the publisher — which ADR 0053 §4
 * names AUTO_PUBLISH. `supply.unknown-remote` (impact: "Remote server source cannot be
 * verified … cannot be inspected statically") is the canonical member; every one of the
 * shipped registry REVIEW pages is exactly this, so they stay AUTO_PUBLISH (a gate test
 * asserts it).
 */
import type { BakedTrustPage } from "./bakeTrustPage.js"

/** The three publish channels (ADR 0053 §4). */
export type PublishChannel = "AUTO_PUBLISH" | "REVIEW_HOLD" | "SECURITY_HOLD"

/** Severities that make a REVIEW verdict "high-severity" for channel purposes (§4). */
const HIGH_SEVERITIES: ReadonlySet<string> = new Set(["critical", "high"])

/**
 * Finding ids whose high-severity REVIEW is an EVIDENCE-LIMITATION self-claim (CallLint
 * could not verify), NOT a negative claim about the publisher — so ADR 0053 §4 routes
 * them to AUTO_PUBLISH. Kept deliberately NARROW: add an id here only when its finding
 * asserts CallLint's own non-observation, never party conduct. Anything not listed
 * falls through to REVIEW_HOLD (fail-closed).
 */
export const AUTO_PUBLISH_EVIDENCE_LIMITATION: ReadonlySet<string> = new Set([
  "supply.unknown-remote",
])

/** Every finding across a page's per-server reports (shipped shape; read verbatim). */
function findingsOf(page: BakedTrustPage): Array<{ id?: string; severity?: string; blocker?: boolean }> {
  const out: Array<{ id?: string; severity?: string; blocker?: boolean }> = []
  for (const report of page.scan.reports ?? []) {
    for (const f of report.findings ?? []) {
      out.push(f as { id?: string; severity?: string; blocker?: boolean })
    }
  }
  return out
}

/**
 * Classify a baked page into its ADR 0053 §4 publish channel. PURE, deterministic,
 * verdict-preserving — it reads shipped fields and returns a label, nothing more.
 */
export function publishChannel(page: BakedTrustPage): PublishChannel {
  const findings = findingsOf(page)

  // SECURITY_HOLD: any BLOCK, any critical-blocker finding, any critical finding.
  if (
    page.verdict === "BLOCK" ||
    findings.some((f) => f.blocker === true) ||
    findings.some((f) => f.severity === "critical")
  ) {
    return "SECURITY_HOLD"
  }

  // REVIEW_HOLD: a high-severity REVIEW that is NOT purely an evidence-limitation
  // self-claim. If EVERY high-severity finding is in the allow-set, the REVIEW carries
  // no party-negative claim → AUTO_PUBLISH; otherwise a human must review it.
  if (page.verdict === "REVIEW") {
    const highSev = findings.filter((f) => HIGH_SEVERITIES.has(f.severity ?? ""))
    if (highSev.length > 0) {
      const allEvidenceLimitation = highSev.every(
        (f) => f.id !== undefined && AUTO_PUBLISH_EVIDENCE_LIMITATION.has(f.id),
      )
      return allEvidenceLimitation ? "AUTO_PUBLISH" : "REVIEW_HOLD"
    }
  }

  // Everything else — SAFE, UNKNOWN, low/medium REVIEW — publishes automatically.
  return "AUTO_PUBLISH"
}
