import { describe, it, expect } from "vitest"
import {
  assessServer,
  computeVerdict,
  computeRiskClass,
} from "../src/index.js"
import { analyzeServerConfig } from "@calllint/static-analyzer"
import { resolveRuntimeBinding } from "@calllint/resolver"
import { parseConfigFile } from "@calllint/config-parser"
import { goldenPath, GOLDEN_CASES } from "@calllint/fixtures"
import type { Finding, RuntimeBinding } from "@calllint/types"

function assessFile(file: string) {
  const cfg = parseConfigFile(goldenPath(file))
  const server = cfg.servers[0]!
  const binding = resolveRuntimeBinding(server)
  const findings = analyzeServerConfig(server)
  return assessServer(findings, binding)
}

describe("golden verdict contract (single-server)", () => {
  for (const c of GOLDEN_CASES) {
    if (c.expect === "parse-error") continue
    it(`${c.file} → ${c.expect}`, () => {
      expect(assessFile(c.file).verdict).toBe(c.expect)
    })
  }
})

describe("engine invariants", () => {
  it("a blocker always forces BLOCK", () => {
    const blocker: Finding = {
      id: "x",
      title: "x",
      severity: "critical",
      blocker: true,
      symbol: "EXEC",
      riskClass: "S4",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "config-analysis",
      evidence: [],
      impact: "",
      fix: "",
    }
    const binding: RuntimeBinding = {
      declaredArgs: [],
      transport: "stdio",
      runtimeKind: "node",
      isVersionPinned: true,
      sourceKnown: true,
      installMayRunScripts: false,
      runtimeExecutable: true,
    }
    expect(computeVerdict([blocker], binding)).toBe("BLOCK")
  })

  it("unknown source never becomes SAFE", () => {
    const binding: RuntimeBinding = {
      declaredArgs: [],
      transport: "http",
      runtimeKind: "http",
      isVersionPinned: false,
      remoteUrl: "https://unknown.example/sse",
      sourceKnown: false,
      installMayRunScripts: false,
      runtimeExecutable: false,
    }
    expect(computeVerdict([], binding)).toBe("UNKNOWN")
  })

  it("unrecognized shape (no url, no command) is UNKNOWN, not SAFE (ADR 0010 / RC-BLK-01)", () => {
    // The exact dangerous false-SAFE shape: the parser could not resolve a
    // runtime, so there is no remoteUrl and runtimeExecutable is false. The old
    // guard (`remoteUrl || runtimeExecutable`) skipped this and fell through to
    // SAFE. SAFE must require sourceKnown.
    const binding: RuntimeBinding = {
      declaredArgs: [],
      transport: "unknown",
      runtimeKind: "unknown",
      isVersionPinned: false,
      sourceKnown: false,
      installMayRunScripts: false,
      runtimeExecutable: false,
    }
    expect(computeVerdict([], binding)).toBe("UNKNOWN")
  })

  it("no findings + known pinned source → SAFE", () => {
    const binding: RuntimeBinding = {
      declaredArgs: [],
      transport: "stdio",
      runtimeKind: "npx",
      packageName: "x",
      packageVersionSpec: "1.0.0",
      isVersionPinned: true,
      sourceKnown: true,
      installMayRunScripts: true,
      runtimeExecutable: true,
    }
    expect(computeVerdict([], binding)).toBe("SAFE")
  })

  it("separates observed and inferred findings", () => {
    const a = assessFile("review-github.json")
    // github has SECRETS (observed) + external-mutation (inferred)
    expect(a.observed.length).toBeGreaterThan(0)
    expect(a.inferred.length).toBeGreaterThan(0)
  })

  it("reproducibility drops for unpinned packages", () => {
    const a = assessFile("review-unpinned-package.json")
    expect(a.reproducibility.level).not.toBe("HIGH")
    expect(a.reproducibility.reasons.join(" ")).toMatch(/not pinned/i)
  })

  it("block verdict denies autonomous use", () => {
    const a = assessFile("block-filesystem.json")
    expect(a.policy.autonomousUse).toBe("deny")
  })

  it("risk class reflects findings", () => {
    expect(computeRiskClass([], {
      declaredArgs: [],
      transport: "stdio",
      runtimeKind: "npx",
      isVersionPinned: true,
      sourceKnown: true,
      installMayRunScripts: true,
      runtimeExecutable: true,
    })).toBe("S1")
  })
})
