import { describe, it, expect } from "vitest"
import { resolveClock } from "../src/clock.js"

const FALLBACK = () => new Date("2030-01-01T00:00:00.000Z")

describe("resolveClock", () => {
  it("uses the fallback clock when --generated-at is absent", () => {
    const c = resolveClock(["scan", "mcp.json"], FALLBACK)
    expect(c.generatedAt).toBe("2030-01-01T00:00:00.000Z")
    expect(c.now).toBe(Date.parse("2030-01-01T00:00:00.000Z"))
  })

  it("pins generatedAt and now from --generated-at <iso> (space form)", () => {
    const c = resolveClock(
      ["scan", "mcp.json", "--generated-at", "2026-06-16T00:00:00.000Z"],
      FALLBACK,
    )
    expect(c.generatedAt).toBe("2026-06-16T00:00:00.000Z")
    expect(c.now).toBe(Date.parse("2026-06-16T00:00:00.000Z"))
  })

  it("pins from the --generated-at=<iso> equals form", () => {
    const c = resolveClock(
      ["scan", "mcp.json", "--generated-at=2026-06-16T00:00:00.000Z"],
      FALLBACK,
    )
    expect(c.generatedAt).toBe("2026-06-16T00:00:00.000Z")
  })

  it("normalizes a non-canonical but valid timestamp to ISO", () => {
    const c = resolveClock(
      ["scan", "mcp.json", "--generated-at", "2026-06-16T00:00:00Z"],
      FALLBACK,
    )
    expect(c.generatedAt).toBe("2026-06-16T00:00:00.000Z")
  })

  it("throws on a malformed --generated-at value", () => {
    expect(() =>
      resolveClock(["scan", "mcp.json", "--generated-at", "not-a-date"], FALLBACK),
    ).toThrow(/Invalid --generated-at/)
  })

  it("is deterministic: same argv yields the same clock", () => {
    const argv = ["scan", "mcp.json", "--generated-at", "2026-06-16T00:00:00.000Z"]
    expect(resolveClock(argv, FALLBACK)).toEqual(resolveClock(argv, FALLBACK))
  })
})
