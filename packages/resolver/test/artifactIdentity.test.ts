import { describe, it, expect } from "vitest"
import { resolveArtifactIdentity } from "../src/index.js"

/**
 * Locks the ADR 0035 Artifact Identity invariants (pure core, no I/O):
 *  - a resolved local artifact carries an immutable resolvedRef + digest
 *  - a mutable/remote target that cannot be pinned degrades explicitly
 *    (resolution != "resolved", reasons surfaced) — never a silent pass
 *  - the tree digest is order-independent and byte-identical across runs
 *  - resolvedAt is injected (determinism); core never reads the wall clock
 */

const AT = "2026-07-13T00:00:00.000Z"

describe("resolveArtifactIdentity — local file", () => {
  it("resolves a file to a content digest + content marker ref", () => {
    const id = resolveArtifactIdentity({
      sourceType: "file",
      source: "./SKILL.md",
      content: "# skill\ndo a thing\n",
      resolvedAt: AT,
    })
    expect(id.schema).toBe("calllint.artifact.v1")
    expect(id.resolution).toBe("resolved")
    expect(id.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(id.resolvedRef).toBe(`content:${id.digest}`)
    expect(id.requestedRef).toBeNull()
    expect(id.resolvedAt).toBe(AT)
    expect(id.resolutionReasons).toBeUndefined()
  })

  it("is deterministic — same bytes ⇒ byte-identical identity", () => {
    const mk = () =>
      resolveArtifactIdentity({
        sourceType: "file",
        source: "./a.md",
        content: "hello",
        resolvedAt: AT,
      })
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()))
  })

  it("different bytes ⇒ different digest", () => {
    const a = resolveArtifactIdentity({ sourceType: "file", source: "a", content: "x", resolvedAt: AT })
    const b = resolveArtifactIdentity({ sourceType: "file", source: "a", content: "y", resolvedAt: AT })
    expect(a.digest).not.toBe(b.digest)
  })
})

describe("resolveArtifactIdentity — directory tree", () => {
  it("tree digest is order-independent", () => {
    const a = resolveArtifactIdentity({
      sourceType: "dir",
      source: "./skill",
      entries: [
        { path: "SKILL.md", content: "one" },
        { path: "handler.py", content: "two" },
      ],
      resolvedAt: AT,
    })
    const b = resolveArtifactIdentity({
      sourceType: "dir",
      source: "./skill",
      entries: [
        { path: "handler.py", content: "two" },
        { path: "SKILL.md", content: "one" },
      ],
      resolvedAt: AT,
    })
    expect(a.digest).toBe(b.digest)
    expect(a.resolution).toBe("resolved")
  })

  it("changing one file's bytes changes the tree digest", () => {
    const base = resolveArtifactIdentity({
      sourceType: "dir",
      source: "./skill",
      entries: [{ path: "SKILL.md", content: "one" }],
      resolvedAt: AT,
    })
    const changed = resolveArtifactIdentity({
      sourceType: "dir",
      source: "./skill",
      entries: [{ path: "SKILL.md", content: "one!" }],
      resolvedAt: AT,
    })
    expect(base.digest).not.toBe(changed.digest)
  })

  it("empty directory ⇒ unresolved with a reason (never a pass)", () => {
    const id = resolveArtifactIdentity({
      sourceType: "dir",
      source: "./empty",
      entries: [],
      resolvedAt: AT,
    })
    expect(id.resolution).toBe("unresolved")
    expect(id.digest).toBeNull()
    expect(id.resolutionReasons?.length).toBeGreaterThan(0)
  })
})

describe("resolveArtifactIdentity — remote targets (offline)", () => {
  it("git target with no pin ⇒ unresolved + reasons", () => {
    const id = resolveArtifactIdentity({
      sourceType: "git",
      source: "github:foo/bar",
      requestedRef: "main",
      resolutionReasons: ["offline"],
      resolvedAt: AT,
    })
    expect(id.resolution).toBe("unresolved")
    expect(id.resolvedRef).toBeNull()
    expect(id.digest).toBeNull()
    expect(id.requestedRef).toBe("main")
    expect(id.resolutionReasons).toContain("offline")
    // a remote-pin reason is added by core
    expect(id.resolutionReasons?.some((r) => /could not be pinned/.test(r))).toBe(true)
  })

  it("git target WITH an immutable ref + bytes ⇒ resolved", () => {
    const id = resolveArtifactIdentity({
      sourceType: "git",
      source: "github:foo/bar",
      requestedRef: "main",
      resolvedRef: "3f5a2c1".padEnd(40, "0"),
      content: "fetched config bytes",
      resolvedAt: AT,
    })
    expect(id.resolution).toBe("resolved")
    expect(id.resolvedRef).toBe("3f5a2c1".padEnd(40, "0"))
    expect(id.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it("npm target with a pinned version but no bytes ⇒ partial (not resolved)", () => {
    const id = resolveArtifactIdentity({
      sourceType: "npm",
      source: "npm:left-pad@1.3.0",
      requestedRef: "1.3.0",
      resolvedRef: "1.3.0",
      resolvedAt: AT,
    })
    // has an immutable ref but no digest ⇒ cannot be fully resolved
    expect(id.resolution).toBe("partial")
    expect(id.digest).toBeNull()
  })
})
