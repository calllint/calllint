import { describe, expect, it } from "vitest"
import { parseConfigFile, parseConfigText } from "@calllint/config-parser"
import { goldenPath } from "@calllint/fixtures"
import { resolveRuntimeBinding } from "@calllint/resolver"
import { detectFinancialAction } from "../src/detectors/financialAction.js"

function findings(packageName: string, toolName?: string) {
  const config = parseConfigText(JSON.stringify({ mcpServers: { test: {
    command: "npx", args: ["-y", `${packageName}@1.0.0`],
  } } }), "<financial-name-fixture>")
  const server = config.servers[0]!
  if (toolName) server.providedTools = [{ name: toolName }]
  return detectFinancialAction({ server, binding: resolveRuntimeBinding(server) })
}

describe("financial hints distinguish the ACH acronym from unrelated words (ADR 0101)", () => {
  it.each([
    ["safe-achromat-name.json", undefined],
    ["block-ach-observed-transfer.json", "action.financial-observed"],
  ])("paired golden fixture %s preserves the financial boundary", (file, expected) => {
    const server = parseConfigFile(goldenPath(file!)).servers[0]!
    const result = detectFinancialAction({ server, binding: resolveRuntimeBinding(server) })
    expect(result.map((f) => f.id)).toEqual(expected ? [expected] : [])
    if (expected) expect(result[0]!.blocker).toBe(true)
  })

  it.each(["@achromat-ai/mcp-server", "mcp-cache", "apache-tools", "attachment-mcp"])(
    "negative package fixture: %s contains letters, not an ACH capability",
    (name) => expect(findings(name)).toEqual([]),
  )

  it.each(["ach", "ach-client", "@acme/ach", "ACHClient", "stripe", "payments", "banking"])(
    "positive package fixture: %s still requires review",
    (name) => {
      expect(findings(name)).toEqual([expect.objectContaining({
        id: "action.financial", severity: "high", blocker: false, mode: "INFERRED",
      })])
    },
  )

  it.each(["process_ach", "processACH", "ACHDebit", "ach.debit"])(
    "positive tool fixture: %s still exposes the ACH hint",
    (name) => expect(findings("ordinary-mcp", name).some((f) => f.id === "action.financial")).toBe(true),
  )

  it("observed money movement remains a blocker even on an unrelated package name", () => {
    expect(findings("@achromat-ai/mcp-server", "transfer_funds")).toEqual([
      expect.objectContaining({ id: "action.financial-observed", blocker: true, mode: "OBSERVED" }),
    ])
  })
})
