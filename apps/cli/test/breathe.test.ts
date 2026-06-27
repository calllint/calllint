import { describe, it, expect } from "vitest"
import { shouldBreathe, breathe } from "../src/breathe.js"

function ttyStream() {
  const chunks: string[] = []
  return {
    isTTY: true as const,
    write: (s: string) => {
      chunks.push(s)
      return true
    },
    chunks,
  }
}

const noSleep = () => Promise.resolve()

describe("shouldBreathe", () => {
  it("renders on an interactive TTY with a plain scan", () => {
    expect(
      shouldBreathe(["scan", "mcp.json"], { stream: ttyStream(), env: {} }),
    ).toBe(true)
  })

  it("is silent when stderr is not a TTY", () => {
    const s = ttyStream()
    s.isTTY = false as unknown as true
    expect(shouldBreathe(["scan"], { stream: s, env: {} })).toBe(false)
  })

  it("respects NO_COLOR and CI", () => {
    expect(shouldBreathe(["scan"], { stream: ttyStream(), env: { NO_COLOR: "1" } })).toBe(false)
    expect(shouldBreathe(["scan"], { stream: ttyStream(), env: { CI: "true" } })).toBe(false)
  })

  it("is silent for every machine-output / non-interactive mode", () => {
    for (const flag of ["--json", "--sarif", "--markdown", "--html", "--compact", "--no-color", "--no-emoji", "--stdin"]) {
      expect(
        shouldBreathe(["scan", "mcp.json", flag], { stream: ttyStream(), env: {} }),
        `expected silence for ${flag}`,
      ).toBe(false)
    }
  })
})

describe("breathe", () => {
  it("writes the mark and wordmark to the stream, then restores the cursor", async () => {
    const s = ttyStream()
    await breathe(["scan"], { stream: s, env: {}, sleep: noSleep })
    const out = s.chunks.join("")
    expect(out).toContain("CallLint")
    expect(out).toContain("⛨")
    expect(out).toContain("\x1b[?25l") // cursor hidden
    expect(out).toContain("\x1b[?25h") // cursor restored
    expect(out.endsWith("\x1b[?25h")).toBe(true)
  })

  it("writes nothing when suppressed", async () => {
    const s = ttyStream()
    await breathe(["scan", "--json"], { stream: s, env: {}, sleep: noSleep })
    expect(s.chunks.join("")).toBe("")
  })

  it("restores the cursor even if a write throws mid-animation", async () => {
    let calls = 0
    const restored: string[] = []
    const stream = {
      isTTY: true as const,
      write: (str: string) => {
        calls += 1
        if (str.includes("\x1b[?25h")) restored.push(str)
        // throw on the 3rd write (mid-animation), but allow the finally cleanup
        if (calls === 3) throw new Error("boom")
        return true
      },
    }
    await expect(
      breathe(["scan"], { stream, env: {}, sleep: noSleep }),
    ).rejects.toThrow("boom")
    // the finally block still attempted the cursor-restore write
    expect(restored.length).toBe(1)
  })
})
