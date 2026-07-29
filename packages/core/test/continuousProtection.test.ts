/**
 * Continuous-protection disclosure (new14 Batch 8; ADR 0056 §7 / INV-2.4-07).
 *
 * The red line under test is the dark-pattern one: a one-time install must never imply
 * permission to install a persistent component, every component must arrive with its
 * removal command, and `[Not now]` must always be present. These are structural
 * assertions on the shared disclosure, so neither surface can quietly soften it.
 */
import { describe, it, expect } from "vitest"
import {
  GUARD_HOST_IDS,
  continuousProtectionOffer,
  disclosureDigest,
  isGuardHostId,
  persistentComponentFor,
  renderContinuousProtectionOffer,
} from "../src/index.js"

describe("continuous-protection disclosure (INV-2.4-07)", () => {
  it("always requires a separate authorization and always offers a decline", () => {
    const offer = continuousProtectionOffer({ hosts: ["git"] })
    expect(offer.requiresSeparateAuthorization).toBe(true)
    expect(offer.declineOption).toBe("Not now")
    expect(offer.recommendation).toBe("ASK_AFTER_SUCCESS")
    expect(offer.reason).toBe("future_tool_changes_not_currently_guarded")
  })

  it("enumerates every persistent component with a non-empty uninstall command", () => {
    const offer = continuousProtectionOffer({ hosts: [...GUARD_HOST_IDS] })
    expect(offer.components).toHaveLength(GUARD_HOST_IDS.length)
    for (const c of offer.components) {
      expect(c.uninstallCommand.length).toBeGreaterThan(0)
      expect(c.artifactPath.length).toBeGreaterThan(0)
      expect(c.installCommand).toContain("calllint guard install --host")
    }
  })

  it("discloses a shared-config component as a hand edit, never a fake automated removal", () => {
    const shared = persistentComponentFor("claude-code")
    expect(shared.posture).toBe("shared")
    expect(shared.uninstallCommand).toContain("by hand")
    const dedicated = persistentComponentFor("git")
    expect(dedicated.posture).toBe("dedicated")
    expect(dedicated.uninstallCommand).toBe("rm .git/hooks/pre-commit")
  })

  it("reports ALREADY_PROTECTED instead of re-offering when guard is installed", () => {
    const offer = continuousProtectionOffer({ hosts: ["git"], alreadyInstalled: true })
    expect(offer.recommendation).toBe("ALREADY_PROTECTED")
    expect(offer.reason).toBe("guard_already_installed_for_host")
    // Even then the separate-authorization fact does not flip.
    expect(offer.requiresSeparateAuthorization).toBe(true)
  })

  it("records an org pre-authorization without inventing one", () => {
    expect(continuousProtectionOffer({ hosts: ["git"], preAuthorizedByPolicy: true }).recommendation).toBe(
      "AUTO_ENABLE_BY_POLICY",
    )
    // Default is never auto-enable.
    expect(continuousProtectionOffer({ hosts: ["git"] }).recommendation).toBe("ASK_AFTER_SUCCESS")
  })

  it("rejects an unknown guard host rather than guessing a hook location", () => {
    expect(isGuardHostId("git")).toBe(true)
    expect(isGuardHostId("emacs")).toBe(false)
    expect(isGuardHostId(null)).toBe(false)
    expect(isGuardHostId(undefined)).toBe(false)
  })
})

describe("disclosure digest", () => {
  it("is deterministic and independent of how the offer was surfaced", () => {
    const asked = continuousProtectionOffer({ hosts: ["git", "github"] })
    const preAuthorized = continuousProtectionOffer({ hosts: ["git", "github"], preAuthorizedByPolicy: true })
    expect(asked.disclosureDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(preAuthorized.disclosureDigest).toBe(asked.disclosureDigest)
  })

  it("changes the moment the component set changes", () => {
    const one = continuousProtectionOffer({ hosts: ["git"] })
    const two = continuousProtectionOffer({ hosts: ["git", "github"] })
    expect(two.disclosureDigest).not.toBe(one.disclosureDigest)
    expect(disclosureDigest(one.components)).toBe(one.disclosureDigest)
  })
})

describe("human offer rendering", () => {
  it("prints both choices, never pre-selects, and shows removal before enable", () => {
    const text = renderContinuousProtectionOffer(continuousProtectionOffer({ hosts: ["git"] }))
    expect(text).toContain("[Enable continuous protection]")
    expect(text).toContain("[Not now]")
    expect(text).not.toMatch(/\[x\]|\[X\]|checked|pre-selected/)
    expect(text.indexOf("remove:")).toBeLessThan(text.indexOf("enable:"))
    expect(text).toContain("nothing is")
  })

  it("shows the human-readable label, not just the machine id", () => {
    // Found by Gate 2.4-F: the offer object carried `label` but the renderer only
    // printed `id`, leaving the person consenting to decode `calllint-guard:vscode`.
    const offer = continuousProtectionOffer({ hosts: [...GUARD_HOST_IDS] })
    const text = renderContinuousProtectionOffer(offer)
    for (const c of offer.components) expect(text).toContain(c.label)
  })

  it("discloses BOTH exits before the decision: disable and remove", () => {
    // Also found by Gate 2.4-F: only `remove` was shown, so turning Guard off
    // looked like it required taking files back out.
    const offer = continuousProtectionOffer({ hosts: ["vscode"] })
    const text = renderContinuousProtectionOffer(offer)
    expect(text).toContain(offer.disableCommand)
    expect(text.indexOf(offer.disableCommand)).toBeLessThan(text.indexOf("[Enable continuous protection]"))
    for (const c of offer.components) expect(text).toContain(c.uninstallCommand)
  })

  it("states plainly that the offer itself installs nothing", () => {
    const text = renderContinuousProtectionOffer(continuousProtectionOffer({ hosts: [...GUARD_HOST_IDS] }))
    expect(text).toContain("Nothing persistent was installed by the step above")
    for (const host of GUARD_HOST_IDS) expect(text).toContain(`calllint-guard:${host}`)
  })

  it("does not re-offer when already protected", () => {
    const text = renderContinuousProtectionOffer(
      continuousProtectionOffer({ hosts: ["git"], alreadyInstalled: true }),
    )
    expect(text).toContain("already enabled")
    expect(text).not.toContain("[Enable continuous protection]")
    expect(text).toContain("calllint guard disable")
  })
})
