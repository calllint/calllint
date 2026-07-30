// ---------------------------------------------------------------------------
// Workstream P Batch 0 — tests for the presentation-plane audit (ADR 0058 §1/§5).
//
// The audit passing is worth nothing on its own: a probe that cannot fail proves
// nothing. So most of this file is FALSIFICATION — deliberately break the boundary
// and assert the probe reports FAIL. Three ways it could be worthless, each tested:
//   1. it might not notice an L2 sentence leaking into the sealed contract;
//   2. it might "pass" a value that never reaches the page at all (vacuous);
//   3. it might pass a suite containing no negative control, in which case its
//      ability to detect reachability is itself unverified.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import {
  ABSENCE_CONSEQUENCE,
  AGENT_GUIDANCE,
  CANONICAL_FIXTURES,
  COPY_SITES,
  DEFAULT_TOKENS,
  OBSERVED_CONSEQUENCE,
  PRIMARY_CTA,
  SECTION_TITLES,
  canonicalProjectionInput,
  gradePresentationAudit,
  probeCopySite,
  runPresentationAudit,
  toProbeSubject,
  type CopySiteDeclaration,
} from "../src/index.js"

const inputs = CANONICAL_FIXTURES.map((f) => canonicalProjectionInput(f))
const subjects = inputs.map(toProbeSubject)

const audit = () =>
  runPresentationAudit(inputs, {
    observedConsequence: Object.values(OBSERVED_CONSEQUENCE),
    absenceConsequence: Object.values(ABSENCE_CONSEQUENCE),
    primaryCta: Object.values(PRIMARY_CTA),
    sectionTitles: Object.values(SECTION_TITLES),
    stylesheetHref: [DEFAULT_TOKENS.stylesheetHref],
    verdictLabel: Object.values(VERDICT_PUBLIC_LABEL),
    guidanceSteps: [...AGENT_GUIDANCE.steps],
  })

describe("presentation audit — the measurement itself", () => {
  it("passes over the shipped projection", () => {
    const r = audit()
    expect(r.failures).toEqual([])
    expect(r.pass).toBe(true)
  })

  it("is deterministic (pure: same inputs ⇒ deep-equal result)", () => {
    expect(audit()).toEqual(audit())
  })

  it("measures L1/L2 copy as unable to reach contractDigest (INV-P1)", () => {
    for (const p of audit().probes.filter((x) => x.declaredPlane === "presentation")) {
      expect(p.contractDigestMoved, `${p.constant} reached the contract`).toBe(false)
      expect(p.measuredPlane).toBe("presentation")
      // and the probe was not vacuous — the copy really is on the page
      expect(p.htmlMoved, `${p.constant} never renders, so isolation is untested`).toBe(true)
    }
  })

  it("measures L1/L2 copy as unable to move the decision route (INV-P2)", () => {
    for (const p of audit().probes.filter((x) => x.declaredPlane === "presentation")) {
      expect(p.decisionRouteMoved, `${p.constant} moved verdict/installability/action`).toBe(false)
    }
  })

  it("detects the L3 negative controls as reaching contractDigest", () => {
    const controls = audit().probes.filter((x) => x.declaredPlane === "decision")
    expect(controls.length).toBeGreaterThan(0)
    for (const p of controls) {
      expect(p.contractDigestMoved, `${p.constant} is L3 but was not detected`).toBe(true)
      expect(p.measuredPlane).toBe("decision")
    }
  })
})

// --- falsification: the probe must FAIL when the boundary is actually broken ---

const presentationDecl: CopySiteDeclaration = {
  constant: "TEST_SITE",
  source: "test",
  declaredLevel: "L2",
  declaredPlane: "presentation",
  configurableTo: "apps/web/content/test.json",
  rationale: "test fixture",
}

describe("presentation audit — falsification", () => {
  it("FAILS a presentation claim whose value is present in the sealed contract", () => {
    // The realistic regression: someone puts a consequence SENTENCE into
    // authorityDelta instead of the authority token. Simulate the observable
    // consequence of that — a string that is in the contract bytes — and assert the
    // probe refuses it. `publicLabel` really is in those bytes, so it stands in for
    // any leaked value without needing to fake a contract.
    const leaked = Object.values(VERDICT_PUBLIC_LABEL)
    const r = probeCopySite(presentationDecl, leaked, subjects)
    expect(r.pass).toBe(false)
    expect(r.measuredPlane).toBe("decision")
    expect(r.failures.join(" ")).toContain("declared presentation but measured decision")
    expect(r.failures.join(" ")).toContain("present in sealed contract bytes")
  })

  it("FAILS a vacuous probe — a value that never reaches any page", () => {
    const r = probeCopySite(presentationDecl, ["THIS_STRING_IS_ON_NO_PAGE_ANYWHERE"], subjects)
    expect(r.pass).toBe(false)
    expect(r.failures.join(" ")).toContain("vacuous probe")
  })

  it("FAILS a presentation claim whose mutation moves the decision route (INV-P2)", () => {
    const r = probeCopySite(
      presentationDecl,
      Object.values(PRIMARY_CTA),
      subjects,
      (s) => ({
        contractDigest: s.contractDigest,
        html: s.html + "x",
        // simulate config reaching the route — this is the thing INV-P2 forbids
        routeKey: "MUTATED|MUTATED|MUTATED",
      }),
    )
    expect(r.pass).toBe(false)
    expect(r.failures.join(" ")).toContain("INV-P2")
  })

  it("FAILS an L3 claim the probe cannot detect (negative-control integrity)", () => {
    const decisionDecl: CopySiteDeclaration = {
      ...presentationDecl,
      declaredLevel: "L3",
      declaredPlane: "decision",
      configurableTo: null,
    }
    const r = probeCopySite(decisionDecl, Object.values(PRIMARY_CTA), subjects)
    expect(r.pass).toBe(false)
    expect(r.failures.join(" ")).toContain("negative control failed")
  })

  it("FAILS a suite with no negative control at all", () => {
    const onlyPresentation = audit().probes.filter((p) => p.declaredPlane === "presentation")
    const r = gradePresentationAudit(onlyPresentation)
    expect(r.pass).toBe(false)
    expect(r.failures.join(" ")).toContain("no decision-plane row")
  })
})

describe("presentation audit — declaration table integrity", () => {
  it("declares a config destination for every presentation site and none for L3", () => {
    for (const s of COPY_SITES) {
      if (s.declaredPlane === "presentation") {
        expect(s.configurableTo, `${s.constant} is presentation but has no destination`).toBeTruthy()
        expect(s.declaredLevel).not.toBe("L3")
      } else {
        expect(s.configurableTo, `${s.constant} is L3 and must not be configurable`).toBeNull()
        expect(s.declaredLevel).toBe("L3")
      }
    }
  })

  it("probes every declared site — no row is silently skipped", () => {
    expect(audit().probes.map((p) => p.constant).sort()).toEqual(COPY_SITES.map((s) => s.constant).sort())
  })
})
