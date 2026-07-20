/**
 * new11 P2 PR-10 — platform overlay contract.
 *
 * Asserts overlays reuse the discovery host vocabulary (no fork), cover the five
 * Tier-A hosts P2 targets, and that exactly one host declares a runtime hook
 * (Claude Code) — the assumption PR-12 relies on.
 */
import { describe, it, expect } from "vitest"
import { PLATFORM_OVERLAYS, allOverlays, overlayForHost } from "../src/index.js"

describe("platform overlays (new11 §5 platform overlays)", () => {
  it("covers the five Tier-A hosts P2 targets", () => {
    const hosts = allOverlays().map((o) => o.host).sort()
    expect(hosts).toEqual(["claude-code", "claude-desktop", "cursor", "vscode", "windsurf"])
  })

  it("each overlay's host id matches its map key (reuses discovery AgentType)", () => {
    for (const [key, overlay] of Object.entries(PLATFORM_OVERLAYS)) {
      expect(overlay.host).toBe(key)
      expect(overlay.channels.length).toBeGreaterThan(0)
      expect(overlay.displayName.length).toBeGreaterThan(0)
    }
  })

  it("exactly one host declares a runtime hook — Claude Code (PR-12's assumption)", () => {
    const withHook = allOverlays().filter((o) => o.supportsRuntimeHook)
    expect(withHook.map((o) => o.host)).toEqual(["claude-code"])
  })

  it("only Claude Code lists the plugin-hook channel", () => {
    for (const o of allOverlays()) {
      const hasHookChannel = o.channels.includes("plugin-hook")
      expect(hasHookChannel).toBe(o.host === "claude-code")
    }
  })
})

describe("overlayForHost() — total, never throws", () => {
  it("returns the overlay for a known host", () => {
    expect(overlayForHost("cursor")?.displayName).toBe("Cursor")
  })
  it("returns null for an unknown host (negative fixture)", () => {
    expect(overlayForHost("emacs")).toBeNull()
  })
})
