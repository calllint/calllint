import { describe, it, expect } from "vitest"
import { scanConfigFile, scanConfigText, createReceipt } from "../src/index.js"
import { goldenPath } from "@calllint/fixtures"
import type { CreateReceiptInput } from "../src/receipt/index.js"

const OPTS = { now: Date.parse("2026-06-01T00:00:00Z"), generatedAt: "2026-06-01T00:00:00.000Z" }
const NOW = "2026-06-01T00:00:00.000Z"

/** Build a receipt from a golden config, mirroring how scan.ts wires it. */
function receiptFor(file: string, over: Partial<CreateReceiptInput> = {}) {
  const summary = scanConfigFile(goldenPath(file), OPTS)
  const text = "raw config text for " + file
  const input: CreateReceiptInput = {
    toolVersion: "0.8.0",
    subject: { type: "scan", target: file },
    inputForHash: text,
    effectivePolicyForHash: { policy: "default" },
    scanReport: summary,
    rulesetForHash: { tool: "calllint", version: "0.8.0" },
    ...over,
  }
  return { receipt: createReceipt(input, NOW), summary, text }
}

describe("createReceipt — reporting layer over ScanReport", () => {
  it("stamps the calllint.receipt.v0 identity + runtime tool version", () => {
    const { receipt } = receiptFor("block-filesystem.json")
    expect(receipt.schema_version).toBe("calllint.receipt.v0")
    expect(receipt.tool).toEqual({ name: "calllint", version: "0.8.0" })
  })

  it("derives verdict from the report, never recomputing it", () => {
    const { receipt, summary } = receiptFor("block-filesystem.json")
    expect(receipt.verdict).toBe(summary.verdict)
    expect(receipt.verdict).toBe("BLOCK")
  })

  it("derives risk_counts from summary.counts (integers >= 0)", () => {
    const { receipt, summary } = receiptFor("block-filesystem.json")
    expect(receipt.risk_counts).toEqual({
      safe: summary.counts.SAFE,
      review: summary.counts.REVIEW,
      block: summary.counts.BLOCK,
      unknown: summary.counts.UNKNOWN,
    })
    for (const n of Object.values(receipt.risk_counts)) {
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
    }
  })

  it("maps finding_refs from report findings (id/severity/evidence path)", () => {
    const { receipt, summary } = receiptFor("block-filesystem.json")
    const totalFindings = summary.reports.reduce((n, r) => n + r.findings.length, 0)
    expect(receipt.finding_refs.length).toBe(totalFindings)
    for (const ref of receipt.finding_refs) {
      expect(typeof ref.rule_id).toBe("string")
      expect(typeof ref.severity).toBe("string")
    }
  })

  it("all four hashes are sha256:<64 hex>", () => {
    const { receipt } = receiptFor("block-filesystem.json")
    for (const h of Object.values(receipt.hashes)) {
      expect(h).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  it("encodes the trust-boundary invariants (always-false literals)", () => {
    const { receipt } = receiptFor("block-filesystem.json")
    expect(receipt.trust_boundaries.executed_target).toBe(false)
    expect(receipt.trust_boundaries.llm_in_verdict_path).toBe(false)
    expect(receipt.trust_boundaries.secret_values_read).toBe(false)
    expect(receipt.trust_boundaries.network_used).toBe(false)
  })

  it("network_used is true only when networkUsed input is set (--online)", () => {
    const { receipt } = receiptFor("block-filesystem.json", { networkUsed: true })
    expect(receipt.trust_boundaries.network_used).toBe(true)
  })

  it("never leaks secret-shaped evidence values into the receipt", () => {
    // A config with credential-shaped env keys/values.
    const text = JSON.stringify({
      mcpServers: {
        svc: {
          command: "npx",
          args: ["-y", "some-mcp@1.0.0"],
          env: { API_TOKEN: "sk-SUPERSECRETVALUE-should-never-appear" },
        },
      },
    })
    const summary = scanConfigText(text, "<inline>", OPTS)
    const receipt = createReceipt(
      {
        toolVersion: "0.8.0",
        subject: { type: "scan", target: "<inline>" },
        inputForHash: text,
        effectivePolicyForHash: { policy: "default" },
        scanReport: summary,
        rulesetForHash: { tool: "calllint", version: "0.8.0" },
      },
      NOW,
    )
    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toContain("SUPERSECRETVALUE")
  })

  it("receipt_id is clrec_<random>, not timestamp-derived, and unique per call", () => {
    const a = receiptFor("block-filesystem.json").receipt
    const b = receiptFor("block-filesystem.json").receipt
    expect(a.receipt_id).toMatch(/^clrec_[A-Za-z0-9_-]+$/)
    expect(a.receipt_id).not.toBe(b.receipt_id)
  })

  it("same report ⇒ same report_hash; same input ⇒ same input_hash", () => {
    const a = receiptFor("block-filesystem.json")
    const b = receiptFor("block-filesystem.json")
    expect(a.receipt.hashes.report_hash).toBe(b.receipt.hashes.report_hash)
    expect(a.receipt.hashes.input_hash).toBe(b.receipt.hashes.input_hash)
  })

  it("does not mutate the source ScanReport (no receipt fields added)", () => {
    const summary = scanConfigFile(goldenPath("block-filesystem.json"), OPTS)
    const before = JSON.stringify(summary)
    createReceipt(
      {
        toolVersion: "0.8.0",
        subject: { type: "scan" },
        inputForHash: "x",
        effectivePolicyForHash: { policy: "default" },
        scanReport: summary,
        rulesetForHash: { tool: "calllint", version: "0.8.0" },
      },
      NOW,
    )
    expect(JSON.stringify(summary)).toBe(before)
  })
})
