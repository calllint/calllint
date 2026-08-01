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
  DEFAULT_GUARD_OFFER_COPY,
  GUARD_ARTIFACTS,
  GUARD_HOST_IDS,
  continuousProtectionOffer,
  disclosureDigest,
  isGuardHostId,
  persistentComponentFor,
  renderContinuousProtectionOffer,
  resolveGuardOfferCopy,
  type ContinuousProtectionOffer,
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

/**
 * Host copy completeness (PR P-6, §14 Config 完整性).
 *
 * `GUARD_ARTIFACTS` became exported at P-6 so the preview harness can grade host copy at the
 * plane where it actually lives: the install page names no host at all, so a missing label
 * would have nowhere else to surface. These assertions are the package-side floor the harness
 * reads — the compiler already proves the table is TOTAL (`Record<GuardHostId, …>`), so what
 * is left to grade is that no entry is present-but-empty, which a `Record` cannot see.
 */
describe("guard host copy is complete for every host (P-6)", () => {
  it("gives all seven hosts a non-empty label, artifact path and uninstall command", () => {
    // Driven off `GUARD_HOST_IDS`, so a host added without copy fails here as well as at the
    // typecheck — a list is what the harness enumerates, and it can always be one entry short.
    expect(Object.keys(GUARD_ARTIFACTS)).toHaveLength(GUARD_HOST_IDS.length)
    for (const host of GUARD_HOST_IDS) {
      const facts = GUARD_ARTIFACTS[host]
      expect(facts.label.trim().length, `${host} has no label`).toBeGreaterThan(0)
      expect(facts.artifactPath.trim().length, `${host} has no artifact path`).toBeGreaterThan(0)
      // The uninstall command is derived, not stored, so it is graded through the discloser
      // that the surfaces actually call rather than off the table.
      const uninstall = persistentComponentFor(host).uninstallCommand
      expect(uninstall.trim().length, `${host} has no uninstall command`).toBeGreaterThan(0)
      // INV-2.4-08: a shared-posture artifact must never claim an automated removal.
      if (facts.posture === "shared") expect(uninstall).toContain("by hand")
    }
  })

  it("names a DISTINCT artifact for each host, so no removal instruction is ambiguous", () => {
    // Two hosts sharing an artifact path would make one host's uninstall command silently
    // remove another's protection. `git` and `git-pre-push` are the near-collision this guards.
    const paths = GUARD_HOST_IDS.map((h) => GUARD_ARTIFACTS[h].artifactPath)
    expect(new Set(paths).size, `duplicate artifact path in ${paths.join(", ")}`).toBe(paths.length)
    const labels = GUARD_HOST_IDS.map((h) => GUARD_ARTIFACTS[h].label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("exports the SAME table the discloser reads — not a copy that could drift", () => {
    // Exporting a table invites a second source of truth. This asserts the export IS the input
    // to `persistentComponentFor`, so the harness grades the shipped facts rather than a
    // parallel record that agrees today.
    for (const host of GUARD_HOST_IDS) {
      const component = persistentComponentFor(host)
      expect(component.label).toBe(GUARD_ARTIFACTS[host].label)
      expect(component.artifactPath).toBe(GUARD_ARTIFACTS[host].artifactPath)
      expect(component.posture).toBe(GUARD_ARTIFACTS[host].posture)
    }
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

/**
 * The configured-copy seam (PR P-5).
 *
 * Three literals in the render moved behind `offer.copy`. What has to be true afterwards
 * splits cleanly in two: configured wording must actually reach the render (or the seam is
 * decoration), and it must reach NOTHING ELSE — not the disclosure lines, not the decline
 * affordance, not the approval token. The tests below are ordered that way.
 */
describe("configured offer copy (PR P-5)", () => {
  const HOSTILE = {
    offerHeadline: "Speed up your workflow instantly",
    offerBody: "One click and you are done:",
    acceptLabel: "Yes, protect everything",
  }

  it("renders the configured headline, lead-in and accept label", () => {
    const text = renderContinuousProtectionOffer(continuousProtectionOffer({ hosts: ["git"], copy: HOSTILE }))
    expect(text).toContain(HOSTILE.offerHeadline)
    expect(text).toContain(HOSTILE.offerBody)
    expect(text).toContain(`[${HOSTILE.acceptLabel}]`)
    // And the shipped wording is gone — otherwise "configured copy renders" could pass
    // while the render printed both.
    expect(text).not.toContain(DEFAULT_GUARD_OFFER_COPY.offerHeadline)
    expect(text).not.toContain(DEFAULT_GUARD_OFFER_COPY.acceptLabel)
  })

  it("renders byte-identically to the shipped output when no copy is supplied", () => {
    // The whole zero-served-byte claim rests on this: every existing call site passes no
    // `copy`, so the seam must be invisible to them. Asserting the exact template rather
    // than a substring is what makes an accidental reflow of the lines a failure here
    // rather than a surprise in Gate 2.4-F's `renderedText`.
    const text = renderContinuousProtectionOffer(continuousProtectionOffer({ hosts: ["git"] }))
    expect(text).toContain("\nProtect future agent-tool changes\n")
    expect(text).toContain("  CallLint can:")
    expect(text).toContain("  [Enable continuous protection]   [Not now]")
  })

  it("fills unsupplied slots from the shipped defaults, per slot", () => {
    // Fail open PER SLOT, the same convention the content resolver uses. A partial
    // document must not blank the slots it does not mention.
    const text = renderContinuousProtectionOffer(
      continuousProtectionOffer({ hosts: ["git"], copy: { offerHeadline: HOSTILE.offerHeadline } }),
    )
    expect(text).toContain(HOSTILE.offerHeadline)
    expect(text).toContain(DEFAULT_GUARD_OFFER_COPY.offerBody)
    expect(text).toContain(`[${DEFAULT_GUARD_OFFER_COPY.acceptLabel}]`)
  })

  it("falls back for an empty or non-string slot instead of rendering a blank affordance", () => {
    // An edge can hand over junk — a document that validated elsewhere, a hand-built
    // object in a test. `[]` as the accept affordance would be an unlabelled button, so
    // the resolver treats blank as absent.
    expect(resolveGuardOfferCopy({ acceptLabel: "   " }).acceptLabel).toBe(DEFAULT_GUARD_OFFER_COPY.acceptLabel)
    expect(resolveGuardOfferCopy({ offerBody: undefined }).offerBody).toBe(DEFAULT_GUARD_OFFER_COPY.offerBody)
    expect(resolveGuardOfferCopy({ offerHeadline: 42 as unknown as string }).offerHeadline).toBe(
      DEFAULT_GUARD_OFFER_COPY.offerHeadline,
    )
    expect(resolveGuardOfferCopy()).toEqual(DEFAULT_GUARD_OFFER_COPY)
  })

  it("cannot move the disclosureDigest, whatever the copy says", () => {
    // The approval token a human reviewed is bound to the COMPONENT set. If configured
    // wording could move it, a re-worded offer would invalidate an approval that is still
    // materially the same — or worse, a changed component set could hide behind a copy
    // edit. The preimage covers id/artifactPath/posture/install/uninstall and NOT `label`.
    const hosts = [...GUARD_HOST_IDS]
    const shipped = continuousProtectionOffer({ hosts })
    const configured = continuousProtectionOffer({ hosts, copy: HOSTILE })
    const sentinel = continuousProtectionOffer({
      hosts,
      copy: { offerHeadline: "__PROBE__", offerBody: "__PROBE__", acceptLabel: "__PROBE__" },
    })
    expect(configured.disclosureDigest).toBe(shipped.disclosureDigest)
    expect(sentinel.disclosureDigest).toBe(shipped.disclosureDigest)
  })

  it("keeps every disclosure line and the decline affordance under hostile copy", () => {
    // INV-2.4-07's floor, restated against the configured surface. Configuration owns
    // three strings; it does not own the separate-decision framing, the exits, the
    // per-component disclosure, or `[Not now]`.
    const offer = continuousProtectionOffer({ hosts: [...GUARD_HOST_IDS], copy: HOSTILE })
    const text = renderContinuousProtectionOffer(offer)
    expect(text).toContain("This installs persistent components (a separate decision from the install above):")
    expect(text).toContain("Nothing persistent was installed by the step above")
    expect(text).toContain(`disable later: ${offer.disableCommand}`)
    expect(text).toContain("[Not now]")
    expect(text).not.toMatch(/\[x\]|\[X\]|checked|pre-selected/)
    for (const c of offer.components) {
      expect(text).toContain(c.label)
      expect(text).toContain(c.uninstallCommand)
    }
    expect(text.indexOf("remove:")).toBeLessThan(text.indexOf("enable:"))
  })

  it("derives the decline affordance from declineOption rather than printing a literal", () => {
    // Negative control #10 from the P-5 plan, as a unit test. Gate 2.4-F now checks
    // `[${declineOption}]`, so a render that hardcoded `[Not now]` while the field said
    // something else would satisfy the gate and lie to the user. Nothing else in the
    // suite fires on that, so without this the derivation is only a convention.
    //
    // The offer's own `declineOption` is the literal type `"Not now"`, so asserting
    // `` toContain(`[${offer.declineOption}]`) `` on a REAL offer is textually identical to
    // asserting `toContain("[Not now]")` — a hardcoded template satisfies it, and the
    // control passes while measuring nothing. The derivation is only observable when the
    // field says something the literal does not, which the type deliberately forbids
    // constructing through `continuousProtectionOffer`. So the probe offer is cast in
    // directly: the render is a total function of the offer, and this is the one input
    // that separates "reads the field" from "prints the string".
    const offer = continuousProtectionOffer({ hosts: ["git"], copy: HOSTILE })
    const probe = { ...offer, declineOption: "Keep it off" } as unknown as ContinuousProtectionOffer
    const text = renderContinuousProtectionOffer(probe)
    expect(text).toContain("[Keep it off]")
    expect(text).not.toContain("[Not now]")
    // The accept and decline affordances sit on ONE line, so a template that dropped the
    // decline half cannot pass by printing the token somewhere else entirely.
    const line = text.split("\n").find((l) => l.includes(`[${HOSTILE.acceptLabel}]`))
    expect(line).toBeDefined()
    expect(line).toContain("[Keep it off]")
    // And the shipped path still prints the shipped token — the cast probes the template,
    // it does not license a render that stops saying `[Not now]` to a real user.
    expect(renderContinuousProtectionOffer(offer)).toContain(`[${offer.declineOption}]`)
  })

  it("does not let configured copy reach the ALREADY_PROTECTED path's disclosure", () => {
    // The early return renders no offer at all, so there is nothing for copy to change —
    // asserted rather than assumed, because a future edit that threaded `copy` into that
    // branch would be adding an affordance to a surface that deliberately has none.
    const text = renderContinuousProtectionOffer(
      continuousProtectionOffer({ hosts: ["git"], alreadyInstalled: true, copy: HOSTILE }),
    )
    expect(text).not.toContain(HOSTILE.offerHeadline)
    expect(text).not.toContain(`[${HOSTILE.acceptLabel}]`)
    expect(text).toContain("already enabled")
  })
})
