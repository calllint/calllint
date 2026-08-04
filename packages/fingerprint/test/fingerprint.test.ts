import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { hashJson, sha256, sha256Bytes, stableStringify, computeFingerprints } from "../src/index.js"
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

/**
 * `sha256Bytes` — the byte-level digest R-4's artifact verifier needs.
 *
 * The two functions must agree on their OVERLAP and must not be the same function: `sha256`
 * passes `"utf8"` to `update`, which is right for text and wrong for a tarball. So the first
 * test is the agreement, and the second is the reason a second function exists at all.
 */
describe("sha256Bytes", () => {
  it("agrees with sha256 on their overlap — the same convention, not a second one", () => {
    for (const s of ["abc", "", "io.test/alpha", '{"a":1}']) {
      expect(sha256Bytes(Buffer.from(s, "utf8"))).toBe(sha256(s))
    }
  })

  it("prefixes with sha256: and is the plain digest of the bytes", () => {
    const bytes = Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xfe, 0x00, 0x7f])
    expect(sha256Bytes(bytes)).toMatch(/^sha256:[0-9a-f]{64}$/)
    // Compared against `node:crypto` directly, so the assertion measures the digest rather
    // than only the shape of the string.
    expect(sha256Bytes(bytes)).toBe("sha256:" + createHash("sha256").update(bytes).digest("hex"))
  })

  it("is NOT interchangeable with sha256 for non-ASCII bytes — the defect it exists to avoid", () => {
    // A byte above 0x7f is not valid UTF-8 on its own. Routing it through `sha256` (which
    // decodes as utf8) replaces it with U+FFFD and hashes different bytes than are on the
    // wire. This is why an artifact verifier could not have reused `sha256`.
    const raw = Uint8Array.from([0x1f, 0x8b, 0xff])
    expect(sha256Bytes(raw)).not.toBe(sha256(Buffer.from(raw).toString("utf8")))
  })

  it("changes when a single byte changes — the flipped-byte control's precondition", () => {
    const a = Uint8Array.from([1, 2, 3, 4])
    const b = Uint8Array.from([1, 2, 3, 5])
    expect(sha256Bytes(a)).not.toBe(sha256Bytes(b))
  })

  it("accepts a Uint8Array as well as a Buffer, over identical bytes", () => {
    const buf = Buffer.from([9, 8, 7])
    expect(sha256Bytes(new Uint8Array(buf))).toBe(sha256Bytes(buf))
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
