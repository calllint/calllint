import { randomBytes } from "node:crypto"
import { sha256, hashJson } from "@calllint/fingerprint"
import type { ConfigSummaryReport, Finding, Verdict } from "@calllint/types"
import type { CallLintReceipt, CreateReceiptInput } from "./types.js"

/** `clrec_<base64url>` from 128 bits of randomness. Never timestamp-derived. */
function newReceiptId(): string {
  const b64 = randomBytes(16)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `clrec_${b64}`
}

/** Map the four-verdict count record to the receipt's flat integer counts. */
function riskCounts(counts: Record<Verdict, number>): CallLintReceipt["risk_counts"] {
  return {
    safe: counts.SAFE ?? 0,
    review: counts.REVIEW ?? 0,
    block: counts.BLOCK ?? 0,
    unknown: counts.UNKNOWN ?? 0,
  }
}

/**
 * Flatten findings across all server reports into evidence references.
 * Maps ONLY `id`, `severity`, and `evidence[0].path` — never `evidence.value`
 * (which can hold secret-shaped text). This is the secret-safety boundary.
 */
function findingRefs(reports: { findings: Finding[] }[]): CallLintReceipt["finding_refs"] {
  const refs: CallLintReceipt["finding_refs"] = []
  for (const report of reports) {
    for (const f of report.findings ?? []) {
      const path = f.evidence?.find((e) => typeof e.path === "string")?.path
      refs.push({
        rule_id: f.id,
        severity: f.severity,
        ...(path ? { evidence_path: path } : {}),
      })
    }
  }
  return refs
}

/**
 * Build a `calllint.receipt.v0` from an existing scan.
 *
 * Pure reporting layer: `verdict`, `risk_counts`, and `finding_refs` are read
 * straight from the passed report — this function contains no risk logic and
 * never re-judges. Hashes reuse `@calllint/fingerprint` so a receipt's hashes
 * are byte-consistent with the rest of the toolchain. `receipt_id` and
 * `created_at` are intentionally non-deterministic and are NOT hashed.
 */
export function createReceipt(input: CreateReceiptInput, now: string): CallLintReceipt {
  const summary = input.scanReport as ConfigSummaryReport

  const receipt: CallLintReceipt = {
    schema_version: "calllint.receipt.v0",
    receipt_id: newReceiptId(),
    created_at: now,
    tool: { name: "calllint", version: input.toolVersion },
    subject: input.subject,
    verdict: summary.verdict,
    hashes: {
      input_hash: hashInput(input.inputForHash) as `sha256:${string}`,
      policy_hash: hashJson(input.effectivePolicyForHash) as `sha256:${string}`,
      report_hash: hashJson(input.scanReport) as `sha256:${string}`,
      ruleset_hash: hashJson(input.rulesetForHash) as `sha256:${string}`,
    },
    risk_counts: riskCounts(summary.counts),
    finding_refs: findingRefs(summary.reports ?? []),
    trust_boundaries: {
      executed_target: false,
      network_used: input.networkUsed === true,
      llm_in_verdict_path: false,
      secret_values_read: false,
    },
    ...(input.corpus ? { corpus: input.corpus } : {}),
  }
  return receipt
}

/** Hash raw string inputs directly; hash structured inputs stably. Both return `sha256:…`. */
function hashInput(value: unknown): string {
  return typeof value === "string" ? sha256(value) : hashJson(value)
}
