import { describe, it, expect } from "vitest"
import { expandHome, safeConfigPath, PathSafetyError } from "../src/index.js"
import { isAbsolute } from "node:path"

/**
 * Locks the apply edge's path safety (ADR 0037). The engine only ever receives
 * absolute, home-expanded paths; anything that could smuggle a surprising write
 * target across OSes (NUL byte, un-anchored "~", "~user" form) is refused.
 */
describe("expandHome", () => {
  const home = process.platform === "win32" ? "C:\\Users\\u" : "/home/u"

  it("expands a leading ~ and ~/", () => {
    expect(expandHome("~", home)).toBe(home)
    expect(expandHome("~/.claude.json", home)).toBe(home + "/.claude.json")
  })

  it("leaves an absolute path unchanged", () => {
    const abs = process.platform === "win32" ? "C:\\x\\y.json" : "/x/y.json"
    expect(expandHome(abs, home)).toBe(abs)
  })

  it("rejects a NUL byte", () => {
    expect(() => expandHome("a\0b", home)).toThrow(PathSafetyError)
  })

  it("rejects the ~user form (only ~ / ~/ expand)", () => {
    expect(() => expandHome("~root/.claude.json", home)).toThrow(PathSafetyError)
  })
})

describe("safeConfigPath", () => {
  const home = process.platform === "win32" ? "C:\\Users\\u" : "/home/u"
  const cwd = process.platform === "win32" ? "C:\\repo" : "/repo"

  it("always yields an absolute path", () => {
    expect(isAbsolute(safeConfigPath("~/.claude.json", { cwd, home }))).toBe(true)
    expect(isAbsolute(safeConfigPath("sub/dir/cfg.json", { cwd, home }))).toBe(true)
  })

  it("resolves a relative path against cwd", () => {
    const p = safeConfigPath("cfg.json", { cwd, home })
    expect(p.startsWith(cwd)).toBe(true)
  })

  it("rejects a NUL byte anywhere", () => {
    expect(() => safeConfigPath("a\0b.json", { cwd, home })).toThrow(PathSafetyError)
  })
})
