import type {
  DecisionReceipt,
  DriftChange,
  DriftClass,
  DriftSignal,
  ReceiptDriftInput,
  ReceiptDriftReport,
} from "@calllint/types"

/** The fixed signal → class mapping (ADR 0039 §4). */
const SIGNAL_CLASS: Record<DriftSignal, DriftClass> = {
  artifact: "artifact",
  config: "artifact",
  "tool-metadata": "artifact",
  permission: "authority",
  authority: "authority",
  evidence: "evidence",
  "evidence-expiry": "evidence",
  policy: "policy",
  "scanner-version": "policy",
}

function change(signal: DriftSignal, was: string | null, now: string | null, reason: string): DriftChange {
  return { signal, class: SIGNAL_CLASS[signal], was, now, reason }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

/**
 * Classify drift between a decision receipt and a `current` snapshot (ADR 0039
 * §4). PURE: the caller computes the current digests; this does no I/O, never
 * re-scans, and never executes the target. Every field of `current` is optional
 * — a field left undefined is NOT compared (missing data is never drift).
 *
 * Emits one DriftChange per fired signal, labels each into its change class, and
 * reports `expired` (now > receipt.expiration) as an integrity flag alongside.
 */
export function classifyReceiptDrift(
  receipt: DecisionReceipt,
  current: ReceiptDriftInput,
): ReceiptDriftReport {
  const changes: DriftChange[] = []

  // 1 artifact
  if (current.artifactDigest !== undefined && current.artifactDigest !== receipt.artifactDigest) {
    changes.push(change("artifact", receipt.artifactDigest, current.artifactDigest, "artifact digest changed since approval"))
  }
  // 2 config (gateway-downstream: the applied change was reverted/overwritten)
  if (current.configDigest !== undefined && receipt.configDigestAfter !== null && current.configDigest !== receipt.configDigestAfter) {
    changes.push(change("config", receipt.configDigestAfter, current.configDigest, "live config no longer matches the applied state"))
  }
  // 3 tool-metadata
  if (current.toolMetadataDigest !== undefined && receipt.artifactDigest !== null && current.toolMetadataDigest !== receipt.artifactDigest) {
    // tool metadata is only comparable when the caller supplies its own baseline;
    // when it differs from the recorded artifact identity, surface it explicitly.
    changes.push(change("tool-metadata", receipt.artifactDigest, current.toolMetadataDigest, "tool/skill metadata digest changed"))
  }
  // 4 permission
  if (current.permissionDigest !== undefined && current.permissionDigest !== receipt.authorityDigest) {
    changes.push(change("permission", receipt.authorityDigest, current.permissionDigest, "authority permission/capability set changed"))
  }
  // 5 authority
  if (current.authorityDigest !== undefined && current.authorityDigest !== receipt.authorityDigest) {
    changes.push(change("authority", receipt.authorityDigest, current.authorityDigest, "authority manifest digest changed"))
  }
  // 6 evidence
  if (current.evidenceDigests !== undefined && !sameSet(current.evidenceDigests, receipt.evidenceDigests)) {
    changes.push(change("evidence", receipt.evidenceDigests.join(","), current.evidenceDigests.join(","), "attached evidence set changed"))
  }
  // 7 evidence-expiry
  if (current.evidenceExpiresAt != null && !Number.isNaN(Date.parse(current.evidenceExpiresAt))) {
    if (Date.parse(current.now) > Date.parse(current.evidenceExpiresAt)) {
      changes.push(change("evidence-expiry", current.evidenceExpiresAt, current.now, "attached evidence has expired"))
    }
  }
  // 8 policy
  if (current.policyDigest !== undefined && current.policyDigest !== receipt.policyDigest) {
    changes.push(change("policy", receipt.policyDigest, current.policyDigest, "policy digest changed"))
  } else if (current.policyVersion !== undefined && current.policyVersion !== receipt.policyVersion) {
    changes.push(change("policy", receipt.policyVersion, current.policyVersion, "policy version changed"))
  }
  // 9 scanner-version
  if (current.scannerVersion !== undefined && current.scannerVersion !== receipt.scannerVersion) {
    changes.push(change("scanner-version", receipt.scannerVersion, current.scannerVersion, "scanner version changed since approval"))
  }

  const classes = [...new Set(changes.map((c) => c.class))].sort() as DriftClass[]
  const expired = Date.parse(current.now) > Date.parse(receipt.expiration)

  return {
    schema: "calllint.receipt-drift.v1",
    receiptId: receipt.receiptId,
    drifted: changes.length > 0,
    expired,
    classes,
    changes,
    generatedAt: current.now,
  }
}
