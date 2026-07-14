import { describe, it, expect } from "vitest"
import { applyJsonPatch, JsonPatchError } from "../src/index.js"
import type { JsonPatchOp } from "@calllint/types"

/**
 * Locks the RFC-6902 applier the apply engine relies on (ADR 0036): typed,
 * immutable (never mutates the input), and fail-closed on any illegal op so a
 * bad patch can never produce a partial write.
 */
describe("applyJsonPatch", () => {
  it("adds a nested key without mutating the input", () => {
    const doc = { mcpServers: {} }
    const out = applyJsonPatch(doc, [{ op: "add", path: "/mcpServers/demo", value: { command: "node" } }])
    expect(out).toEqual({ mcpServers: { demo: { command: "node" } } })
    expect(doc).toEqual({ mcpServers: {} }) // input untouched
  })

  it("creates a container then adds under it", () => {
    const out = applyJsonPatch({}, [
      { op: "add", path: "/mcpServers", value: {} },
      { op: "add", path: "/mcpServers/demo", value: { url: "https://x" } },
    ])
    expect(out).toEqual({ mcpServers: { demo: { url: "https://x" } } })
  })

  it("replaces and removes", () => {
    const doc = { mcpServers: { a: { command: "old" }, b: { command: "keep" } } }
    const replaced = applyJsonPatch(doc, [{ op: "replace", path: "/mcpServers/a", value: { command: "new" } }])
    expect((replaced as typeof doc).mcpServers.a.command).toBe("new")
    const removed = applyJsonPatch(doc, [{ op: "remove", path: "/mcpServers/a" }])
    expect((removed as { mcpServers: Record<string, unknown> }).mcpServers).toEqual({ b: { command: "keep" } })
  })

  it("escapes JSON-Pointer tokens (~1 = /, ~0 = ~)", () => {
    const out = applyJsonPatch({ mcpServers: {} }, [{ op: "add", path: "/mcpServers/a~1b", value: 1 }])
    expect(out).toEqual({ mcpServers: { "a/b": 1 } })
  })

  it("supports array add/remove with '-' append", () => {
    const out = applyJsonPatch({ xs: [1, 2] }, [{ op: "add", path: "/xs/-", value: 3 }])
    expect(out).toEqual({ xs: [1, 2, 3] })
  })

  it("throws on replace of a missing key (fail-closed)", () => {
    expect(() => applyJsonPatch({ mcpServers: {} }, [{ op: "replace", path: "/mcpServers/x", value: 1 }])).toThrow(JsonPatchError)
  })

  it("throws on remove of a missing key", () => {
    expect(() => applyJsonPatch({}, [{ op: "remove", path: "/nope" }])).toThrow(JsonPatchError)
  })

  it("throws on a malformed pointer", () => {
    expect(() => applyJsonPatch({}, [{ op: "add", path: "nope", value: 1 } as JsonPatchOp])).toThrow(JsonPatchError)
  })

  it("test op passes on match and throws on mismatch", () => {
    const doc = { v: 1 }
    expect(applyJsonPatch(doc, [{ op: "test", path: "/v", value: 1 }])).toEqual(doc)
    expect(() => applyJsonPatch(doc, [{ op: "test", path: "/v", value: 2 }])).toThrow(JsonPatchError)
  })

  it("a mid-patch failure leaves the caller's document intact", () => {
    const doc = { mcpServers: { a: 1 } }
    expect(() =>
      applyJsonPatch(doc, [
        { op: "add", path: "/mcpServers/b", value: 2 },
        { op: "remove", path: "/mcpServers/missing" }, // fails
      ]),
    ).toThrow(JsonPatchError)
    expect(doc).toEqual({ mcpServers: { a: 1 } })
  })
})
