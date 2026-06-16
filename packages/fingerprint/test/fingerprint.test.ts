import { describe, it, expect } from "vitest"
import { hashJson, stableStringify, computeFingerprints } from "../src/index.js"
import type { NormalizedMcpServer, RuntimeBinding } from "@calllint/types"

describe("stable hashing", () => {
  it("is order-independent for object keys", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
    expect(hashJson({ a: 1, b: 2 })).toBe(hashJson({ b: 2, a: 1 }))
  })
  it("differs for different values", () => {
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }))
  })
  it("prefixes with sha256:", () => {
    expect(hashJson({})).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

const server: NormalizedMcpServer = {
  name: "fs",
  sourceConfigPath: "<inline>",
  transport: "stdio",
  command: "npx",
  args: ["-y", "pkg@1.0.0", "/Users/x"],
  envKeys: ["TOKEN"],
  env: { TOKEN: "secret" },
  providedTools: [],
  raw: { command: "npx" },
}
const binding: RuntimeBinding = {
  declaredCommand: "npx",
  declaredArgs: ["-y", "pkg@1.0.0", "/Users/x"],
  transport: "stdio",
  runtimeKind: "npx",
  packageName: "pkg",
  packageVersionSpec: "1.0.0",
  isVersionPinned: true,
  sourceKnown: true,
  installMayRunScripts: true,
  runtimeExecutable: true,
}

describe("computeFingerprints", () => {
  it("produces required hashes", () => {
    const fp = computeFingerprints({ server, binding, symbols: ["FILES"], findingIds: ["files.broad-path"] })
    expect(fp.configHash).toMatch(/^sha256:/)
    expect(fp.targetSpecHash).toMatch(/^sha256:/)
    expect(fp.riskSurfaceHash).toMatch(/^sha256:/)
    expect(fp.packageSpecHash).toMatch(/^sha256:/)
  })

  it("risk surface hash is independent of symbol/finding order", () => {
    const a = computeFingerprints({ server, binding, symbols: ["FILES", "EXEC"], findingIds: ["b", "a"] })
    const b = computeFingerprints({ server, binding, symbols: ["EXEC", "FILES"], findingIds: ["a", "b"] })
    expect(a.riskSurfaceHash).toBe(b.riskSurfaceHash)
  })

  it("config hash changes when raw config changes", () => {
    const a = computeFingerprints({ server, binding, symbols: [], findingIds: [] })
    const b = computeFingerprints({
      server: { ...server, raw: { command: "node" } },
      binding,
      symbols: [],
      findingIds: [],
    })
    expect(a.configHash).not.toBe(b.configHash)
  })
})
