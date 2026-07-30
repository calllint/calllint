/**
 * `planUrlHandler` — the per-platform registration plan.
 *
 * Purity is what makes this testable at all: platform, home and binary path are
 * injected, so every branch runs on every CI OS. The macOS case is asserted as an
 * explicit, reasoned refusal rather than an absence, because a partially-registered
 * handler (a link that looks clickable and silently does nothing) is worse than none.
 */
import { describe, it, expect } from "vitest"
import { planUrlHandler } from "../src/gateway/urlHandlerPlan.js"

const BIN = "/usr/local/bin/calllint"
const HOME = "/home/u"

describe("planUrlHandler — win32", () => {
  const plan = planUrlHandler({ platform: "win32", binPath: "C:\\bin\\calllint.exe", home: "C:\\Users\\u" })

  it("is supported and plans exactly three registry values", () => {
    expect(plan.supported).toBe(true)
    if (!plan.supported) return
    expect(plan.records).toHaveLength(3)
    expect(plan.records.every((r) => r.kind === "REGISTRY_KEY")).toBe(true)
  })

  it("uses the per-user hive only, so no elevation is ever required", () => {
    if (!plan.supported) throw new Error("unreachable")
    for (const r of plan.records) {
      expect(r.kind).toBe("REGISTRY_KEY")
      if (r.kind !== "REGISTRY_KEY") continue
      expect(r.path.startsWith("HKCU\\")).toBe(true)
      expect(r.path).not.toContain("HKLM")
    }
  })

  it("declares URL Protocol and routes to `url-handler open` with the %1 placeholder", () => {
    if (!plan.supported) throw new Error("unreachable")
    const values = plan.records.flatMap((r) => (r.kind === "REGISTRY_KEY" ? [r] : []))
    expect(values.some((r) => r.valueName === "URL Protocol")).toBe(true)
    const cmd = values.find((r) => r.path.endsWith("shell\\open\\command"))
    expect(cmd?.value).toContain("url-handler open")
    expect(cmd?.value).toContain("%1")
  })

  it("never plans a write-capable subcommand", () => {
    if (!plan.supported) throw new Error("unreachable")
    const all = JSON.stringify(plan.records)
    expect(all).not.toContain("--apply")
    expect(all).not.toContain("--approve")
  })
})

describe("planUrlHandler — linux", () => {
  const plan = planUrlHandler({ platform: "linux", binPath: BIN, home: HOME })

  it("plans a desktop entry plus a mime default, under the user's home", () => {
    expect(plan.supported).toBe(true)
    if (!plan.supported) return
    expect(plan.records.map((r) => r.kind)).toEqual(["DESKTOP_FILE", "MIME_DEFAULT"])
    for (const r of plan.records) expect(r.path.startsWith(HOME)).toBe(true)
  })

  it("declares the scheme handler mime type and the %u single-URI placeholder", () => {
    if (!plan.supported) throw new Error("unreachable")
    const desktop = plan.records.find((r) => r.kind === "DESKTOP_FILE")
    expect(desktop?.kind).toBe("DESKTOP_FILE")
    if (desktop?.kind !== "DESKTOP_FILE") return
    expect(desktop.contents).toContain("MimeType=x-scheme-handler/calllint;")
    expect(desktop.contents).toContain(`Exec=${BIN} url-handler open %u`)
    expect(desktop.contents).toContain("Terminal=true")
  })

  it("associates the scheme with the desktop file it just planned", () => {
    if (!plan.supported) throw new Error("unreachable")
    const mime = plan.records.find((r) => r.kind === "MIME_DEFAULT")
    if (mime?.kind !== "MIME_DEFAULT") throw new Error("no mime record")
    expect(mime.scheme).toBe("x-scheme-handler/calllint")
    expect(mime.desktopFile).toBe("calllint-url.desktop")
  })

  it("never plans a write-capable subcommand", () => {
    if (!plan.supported) throw new Error("unreachable")
    const all = JSON.stringify(plan.records)
    expect(all).not.toContain("--apply")
    expect(all).not.toContain("--approve")
  })
})

describe("planUrlHandler — darwin refuses, with a reason", () => {
  const plan = planUrlHandler({ platform: "darwin", binPath: BIN, home: HOME })

  it("is an explicit UNSUPPORTED_PLATFORM, not an empty plan", () => {
    expect(plan.supported).toBe(false)
    if (plan.supported) return
    expect(plan.reason).toBe("UNSUPPORTED_PLATFORM")
  })

  it("names the cause and points at the fallback the install page shows", () => {
    if (plan.supported) throw new Error("unreachable")
    expect(plan.detail).toContain("CFBundleURLTypes")
    expect(plan.detail).toContain("fallback command")
  })

  it("carries no records at all, so nothing can be half-written", () => {
    expect("records" in plan).toBe(false)
  })
})
