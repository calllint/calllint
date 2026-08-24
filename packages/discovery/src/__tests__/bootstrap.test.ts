import { describe, it, expect, beforeEach } from "vitest"
import { registry } from "../registry.js"
import { bootstrapExtractors } from "../bootstrap.js"
import type { AgentType } from "../types.js"

describe("bootstrap", () => {
  beforeEach(() => {
    // Clear registry before each test
    registry.clear()
  })

  it("should auto-register P0 + P1 + P2 + P3 (harness distribution) extractors", () => {
    // Bootstrap should have been called during module import
    bootstrapExtractors()

    const registered = registry.getAll()

    // The NAME SET is the assertion; the length is derived from it. Asserting a hardcoded
    // count alongside a hardcoded list makes the count redundant when they agree and
    // ambiguous when they don't — and this test carried `9` while bootstrap registered 13,
    // because kiro, gemini-cli and codex were added without updating either line.
    const expected = [
      "claude-code", "claude-desktop", "cline", "codex", "cursor", "gemini-cli",
      "kiro", "openclaw", "opencode", "qwen-code", "vscode", "windsurf", "workbuddy",
    ]
    expect(registered.map(e => e.agentType).sort()).toEqual(expected)
    expect(registered).toHaveLength(expected.length)
  })

  it("should register the P2 extractors with correct priority", () => {
    bootstrapExtractors()

    const p2Extractors = registry.getByPriority("P2")
    expect(p2Extractors.map(e => e.agentType).sort()).toEqual(["cline", "codex", "gemini-cli", "kiro"])

    for (const extractor of p2Extractors) {
      expect(extractor.priority).toBe("P2")
    }
  })

  it("should register all P3 extractors with correct priority", () => {
    bootstrapExtractors()

    const p3Extractors = registry.getByPriority("P3")
    expect(p3Extractors.map(e => e.agentType).sort()).toEqual(["opencode", "openclaw"].sort())

    for (const extractor of p3Extractors) {
      expect(extractor.priority).toBe("P3")
    }
  })

  it("should register all P0 extractors with correct priority", () => {
    bootstrapExtractors()

    const p0Extractors = registry.getByPriority("P0")
    expect(p0Extractors).toHaveLength(4) // cursor, claude-code, claude-desktop, workbuddy

    for (const extractor of p0Extractors) {
      expect(extractor.priority).toBe("P0")
    }
  })

  it("should register all P1 extractors with correct priority", () => {
    bootstrapExtractors()

    const p1Extractors = registry.getByPriority("P1")
    expect(p1Extractors).toHaveLength(3) // vscode, windsurf, qwen-code

    for (const extractor of p1Extractors) {
      expect(extractor.priority).toBe("P1")
    }
  })

  it("should register extractors that can discover configs", () => {
    bootstrapExtractors()

    // P0
    const cursor = registry.get("cursor")
    expect(cursor).toBeDefined()
    expect(cursor?.agentType).toBe("cursor")

    const claudeCode = registry.get("claude-code")
    expect(claudeCode).toBeDefined()
    expect(claudeCode?.agentType).toBe("claude-code")

    const claudeDesktop = registry.get("claude-desktop")
    expect(claudeDesktop).toBeDefined()
    expect(claudeDesktop?.agentType).toBe("claude-desktop")

    // P1
    const vscode = registry.get("vscode")
    expect(vscode).toBeDefined()
    expect(vscode?.agentType).toBe("vscode")

    const windsurf = registry.get("windsurf")
    expect(windsurf).toBeDefined()
    expect(windsurf?.agentType).toBe("windsurf")
  })

  it("should not throw when called multiple times", () => {
    // First call
    expect(() => bootstrapExtractors()).not.toThrow()

    // Second call should throw because extractors are already registered
    expect(() => bootstrapExtractors()).toThrow(/already registered/)
  })
})
