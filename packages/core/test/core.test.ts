import { describe, it, expect } from "vitest"
import { scanConfigFile, scanConfigText, ConfigParseError } from "../src/index.js"
import { goldenPath, GOLDEN_CASES } from "@calllint/fixtures"

const OPTS = { now: Date.parse("2026-06-01T00:00:00Z"), generatedAt: "2026-06-01T00:00:00.000Z" }

describe("core pipeline — golden contract", () => {
  for (const c of GOLDEN_CASES) {
    if (c.expect === "parse-error") {
      it(`${c.file} → parse error`, () => {
        expect(() => scanConfigFile(goldenPath(c.file), OPTS)).toThrow(ConfigParseError)
      })
    } else {
      it(`${c.file} → ${c.expect}`, () => {
        const summary = scanConfigFile(goldenPath(c.file), OPTS)
        expect(summary.verdict).toBe(c.expect)
        expect(summary.reports[0]!.verdict).toBe(c.expect)
      })
    }
  }
})

describe("scan report shape", () => {
  it("includes fingerprints, public label, and deterministic timestamp", () => {
    const s = scanConfigFile(goldenPath("block-filesystem.json"), OPTS)
    const r = s.reports[0]!
    expect(r.schemaVersion).toBe("calllint.report.v0")
    expect(r.publicVerdictLabel).toBe("Blocked by policy")
    expect(r.fingerprints.configHash).toMatch(/^sha256:/)
    expect(r.generatedAt).toBe("2026-06-01T00:00:00.000Z")
    expect(r.findings.some((f) => f.blocker)).toBe(true)
    // evidence is mandatory for the blocker
    const blocker = r.findings.find((f) => f.blocker)!
    expect(blocker.evidence.length).toBeGreaterThan(0)
  })

  it("is deterministic: same input → identical report", () => {
    const a = scanConfigFile(goldenPath("review-github.json"), OPTS)
    const b = scanConfigFile(goldenPath("review-github.json"), OPTS)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it("aggregates multiple servers to the most severe verdict", () => {
    const text = JSON.stringify({
      mcpServers: {
        time: { command: "npx", args: ["-y", "@modelcontextprotocol/server-time@1.0.0"] },
        fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/x"] },
      },
    })
    const s = scanConfigText(text, "<inline>", OPTS)
    expect(s.verdict).toBe("BLOCK")
    expect(s.counts.SAFE).toBe(1)
    expect(s.counts.BLOCK).toBe(1)
  })

  it("a config with no servers is UNKNOWN, not SAFE (ADR 0010)", () => {
    // An empty server map or a wrong-schema file examines nothing; reporting SAFE
    // would reassure a user who scanned the wrong file. Insufficient evidence.
    for (const text of ['{"mcpServers":{}}', '{"foo":"bar"}']) {
      const s = scanConfigText(text, "<inline>", OPTS)
      expect(s.verdict).toBe("UNKNOWN")
      expect(s.reports.length).toBe(0)
    }
  })
})

describe("policy integration", () => {
  it("downgrades a blocker with a valid override and labels it", () => {
    const policy = {
      schemaVersion: "calllint.policy.v0" as const,
      defaults: {
        unknownSource: "deny" as const,
        unpinnedPackage: "warn" as const,
        broadFilesystemAccess: "deny" as const,
        arbitraryCommandExecution: "deny" as const,
        promptPoisoning: "deny" as const,
        externalMutation: "warn" as const,
        financialAction: "deny" as const,
      },
      ci: { failOn: ["BLOCK", "UNKNOWN"] as ("BLOCK" | "UNKNOWN")[], failOnReview: false },
      allowedSources: [],
      allowedPaths: [],
      overrides: [
        {
          target: "filesystem",
          reason: "local experiment",
          expiresAt: "2999-01-01T00:00:00Z",
          allow: ["FILES" as const],
        },
      ],
    }
    const s = scanConfigFile(goldenPath("block-filesystem.json"), { ...OPTS, policy })
    expect(s.verdict).toBe("REVIEW")
    expect(s.reports[0]!.policyApplied).toBe(true)
    expect(s.reports[0]!.diagnostics.some((d) => d.code === "policy.applied")).toBe(true)
  })
})
