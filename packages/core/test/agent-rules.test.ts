import { describe, it, expect } from "vitest"
import {
  UNIVERSAL_AGENT_RULE,
  AGENT_RULE_MAX_LINES,
  renderHostRule,
  RULE_HOSTS,
  RULE_TARGETS,
} from "../src/index.js"

describe("universal agent rule (P3.1)", () => {
  it("is present and non-empty", () => {
    expect(UNIVERSAL_AGENT_RULE).toBeTruthy()
    expect(UNIVERSAL_AGENT_RULE.length).toBeGreaterThan(100)
  })

  it("stays within the token budget (≤50 lines)", () => {
    const lines = UNIVERSAL_AGENT_RULE.split("\n").length
    expect(lines).toBeLessThanOrEqual(AGENT_RULE_MAX_LINES)
  })

  it("names all four verdicts (SAFE/REVIEW/BLOCK/UNKNOWN)", () => {
    expect(UNIVERSAL_AGENT_RULE).toContain("SAFE")
    expect(UNIVERSAL_AGENT_RULE).toContain("REVIEW")
    expect(UNIVERSAL_AGENT_RULE).toContain("BLOCK")
    expect(UNIVERSAL_AGENT_RULE).toContain("UNKNOWN")
  })

  it("forbids executing the server to decide (ADR 0003)", () => {
    expect(UNIVERSAL_AGENT_RULE.toLowerCase()).toContain("never execute")
  })

  it("clarifies SAFE is not runtime safety proof (ADR 0002/0010)", () => {
    expect(UNIVERSAL_AGENT_RULE.toLowerCase()).toContain("no blockers observed")
    expect(UNIVERSAL_AGENT_RULE.toLowerCase()).toContain("not as proof of runtime safety")
  })
})

describe("per-host rules (P3.2)", () => {
  it("every RULE_HOSTS entry has a target and can render", () => {
    for (const host of RULE_HOSTS) {
      expect(RULE_TARGETS[host]).toBeTruthy()
      expect(RULE_TARGETS[host].path).toBeTruthy()
      const rendered = renderHostRule(host)
      expect(rendered.length).toBeGreaterThan(100)
      expect(rendered).toContain("CallLint")
    }
  })

  it("cursor rule has frontmatter for alwaysApply", () => {
    const cursor = renderHostRule("cursor")
    expect(cursor).toContain("---")
    expect(cursor).toContain("alwaysApply: true")
  })

  it("command rule (/calllint) is a slash-command format", () => {
    const cmd = renderHostRule("command")
    expect(cmd).toContain("# /calllint")
    expect(cmd).toContain("Steps:")
  })

  it("every host rule embeds the universal rule verbatim", () => {
    for (const host of RULE_HOSTS) {
      const rendered = renderHostRule(host)
      expect(rendered).toContain("npx -y calllint check")
      expect(rendered).toContain("Decision policy:")
    }
  })

  it("CLAUDE.md and AGENTS.md are the two primary repo-level files", () => {
    expect(RULE_TARGETS.claude.path).toBe("CLAUDE.md")
    expect(RULE_TARGETS.agents.path).toBe("AGENTS.md")
  })
})
