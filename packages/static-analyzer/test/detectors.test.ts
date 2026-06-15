import { describe, it, expect } from "vitest"
import {
  analyzeServerConfig,
  detectBroadFilesystemPath,
  detectDangerousCommand,
  detectPromptPoisoning,
  detectUnpinnedPackage,
  detectUnknownRemote,
  detectSecretEnvKeys,
} from "../src/index.js"
import type { DetectorContext } from "../src/index.js"
import { parseConfigFile } from "@mcpguard/config-parser"
import { resolveRuntimeBinding } from "@mcpguard/resolver"
import { goldenPath } from "@mcpguard/fixtures"

function ctxFor(file: string): DetectorContext {
  const cfg = parseConfigFile(goldenPath(file))
  const server = cfg.servers[0]!
  return { server, binding: resolveRuntimeBinding(server) }
}

describe("broad filesystem detector", () => {
  it("positive: home path triggers a critical blocker", () => {
    const f = detectBroadFilesystemPath(ctxFor("block-filesystem.json"))
    expect(f).toHaveLength(1)
    expect(f[0]!.blocker).toBe(true)
    expect(f[0]!.symbol).toBe("FILES")
  })
  it("negative: workspace-scoped path does not trigger", () => {
    expect(detectBroadFilesystemPath(ctxFor("safe-filesystem-workspace.json"))).toHaveLength(0)
  })
})

describe("dangerous command detector", () => {
  it("positive: bash -c triggers a critical blocker", () => {
    const f = detectDangerousCommand(ctxFor("block-dangerous-command.json"))
    expect(f).toHaveLength(1)
    expect(f[0]!.symbol).toBe("EXEC")
    expect(f[0]!.blocker).toBe(true)
  })
  it("negative: npx package does not trigger", () => {
    expect(detectDangerousCommand(ctxFor("safe-time.json"))).toHaveLength(0)
  })
})

describe("prompt poisoning detector", () => {
  it("positive: model-directed instruction triggers a blocker", () => {
    const f = detectPromptPoisoning(ctxFor("block-prompt-poison.json"))
    expect(f).toHaveLength(1)
    expect(f[0]!.symbol).toBe("PROMPT")
    expect(f[0]!.blocker).toBe(true)
  })
  it("negative: clean server does not trigger", () => {
    expect(detectPromptPoisoning(ctxFor("safe-time.json"))).toHaveLength(0)
  })
})

describe("unpinned package detector", () => {
  it("positive: @latest triggers", () => {
    const f = detectUnpinnedPackage(ctxFor("review-unpinned-package.json"))
    expect(f).toHaveLength(1)
    expect(f[0]!.symbol).toBe("SUPPLY")
    expect(f[0]!.blocker).toBe(false)
  })
  it("negative: pinned version does not trigger", () => {
    expect(detectUnpinnedPackage(ctxFor("safe-time.json"))).toHaveLength(0)
  })
})

describe("unknown remote detector", () => {
  it("positive: unverified remote triggers", () => {
    const f = detectUnknownRemote(ctxFor("unknown-remote.json"))
    expect(f).toHaveLength(1)
    expect(f[0]!.symbol).toBe("NETWORK")
  })
  it("negative: local npx server does not trigger", () => {
    expect(detectUnknownRemote(ctxFor("safe-time.json"))).toHaveLength(0)
  })
})

describe("secret env keys detector", () => {
  it("positive: GITHUB_TOKEN triggers SECRETS", () => {
    const f = detectSecretEnvKeys(ctxFor("review-github.json"))
    expect(f).toHaveLength(1)
    expect(f[0]!.symbol).toBe("SECRETS")
    // never leak values: evidence reports the key name only
    expect(f[0]!.evidence[0]!.value).toBe("GITHUB_TOKEN")
  })
  it("negative: no env does not trigger", () => {
    expect(detectSecretEnvKeys(ctxFor("safe-time.json"))).toHaveLength(0)
  })
})

describe("analyzeServerConfig integration", () => {
  it("safe-time produces no findings", () => {
    const cfg = parseConfigFile(goldenPath("safe-time.json"))
    expect(analyzeServerConfig(cfg.servers[0]!)).toHaveLength(0)
  })
  it("block-filesystem produces a blocker finding", () => {
    const cfg = parseConfigFile(goldenPath("block-filesystem.json"))
    const findings = analyzeServerConfig(cfg.servers[0]!)
    expect(findings.some((f) => f.blocker)).toBe(true)
  })
})
