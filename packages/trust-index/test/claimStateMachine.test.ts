import { describe, it, expect } from "vitest"
import {
  CLAIM_LIFECYCLE_STATES,
  CLAIM_REVERIFY_TRIGGERS,
  transition,
  applyReverifyTrigger,
  projectToStoreStatus,
  isServingState,
  type ClaimLifecycleState,
} from "../src/claimStateMachine.js"

describe("claim state machine — happy path (§6.3)", () => {
  it("walks UNCLAIMED → CHALLENGE_CREATED → VERIFICATION_PENDING → VERIFIED → ACTIVE", () => {
    let s: ClaimLifecycleState = "UNCLAIMED"
    for (const ev of ["create_challenge", "submit_verification", "verify_ok", "activate"] as const) {
      const r = transition(s, ev)
      expect(r.ok).toBe(true)
      if (r.ok) s = r.state
    }
    expect(s).toBe("ACTIVE")
    expect(isServingState(s)).toBe(true)
  })

  it("VERIFICATION_PENDING can fail or expire, and both restart via a fresh challenge", () => {
    const fail = transition("VERIFICATION_PENDING", "verify_fail")
    expect(fail).toEqual({ ok: true, state: "FAILED" })
    const exp = transition("VERIFICATION_PENDING", "expire")
    expect(exp).toEqual({ ok: true, state: "EXPIRED" })
    expect(transition("FAILED", "create_challenge")).toEqual({ ok: true, state: "CHALLENGE_CREATED" })
    expect(transition("EXPIRED", "create_challenge")).toEqual({ ok: true, state: "CHALLENGE_CREATED" })
  })
})

describe("claim state machine — illegal transitions rejected, never coerced", () => {
  it("rejects activate from UNCLAIMED", () => {
    expect(transition("UNCLAIMED", "activate")).toEqual({
      ok: false,
      reason: "illegal transition: activate from UNCLAIMED",
    })
  })

  it("REVOKED is terminal — no event escapes it", () => {
    for (const ev of ["create_challenge", "activate", "reverify_required", "revoke"] as const) {
      expect(transition("REVOKED", ev).ok).toBe(false)
    }
  })
})

describe("claim state machine — the 7 re-verify triggers (§6.3)", () => {
  it("exposes exactly the 7 spec triggers", () => {
    expect(CLAIM_REVERIFY_TRIGGERS).toHaveLength(7)
    expect(new Set(CLAIM_REVERIFY_TRIGGERS).size).toBe(7)
  })

  it("the 6 drift signals move an ACTIVE claim to VERIFICATION_PENDING (fail-closed)", () => {
    const drift = CLAIM_REVERIFY_TRIGGERS.filter((t) => t !== "maintainer_revoked")
    expect(drift).toHaveLength(6)
    for (const t of drift) {
      expect(applyReverifyTrigger("ACTIVE", t)).toEqual({ ok: true, state: "VERIFICATION_PENDING" })
      // ...and the claim stops serving the flag while re-verifying.
      expect(isServingState("VERIFICATION_PENDING")).toBe(false)
    }
  })

  it("maintainer_revoked terminates an ACTIVE claim directly", () => {
    expect(applyReverifyTrigger("ACTIVE", "maintainer_revoked")).toEqual({ ok: true, state: "REVOKED" })
  })

  it("a SUSPENDED claim re-verifies or revokes; a security event can suspend a live claim", () => {
    expect(applyReverifyTrigger("SUSPENDED", "provenance_broken")).toEqual({
      ok: true,
      state: "VERIFICATION_PENDING",
    })
    expect(transition("ACTIVE", "suspend")).toEqual({ ok: true, state: "SUSPENDED" })
  })

  it("triggers against a non-live claim are illegal (single transition authority)", () => {
    expect(applyReverifyTrigger("UNCLAIMED", "security_event").ok).toBe(false)
    expect(applyReverifyTrigger("VERIFIED", "provenance_broken").ok).toBe(false)
  })
})

describe("claim state machine — projection onto the committed binary status", () => {
  it("ONLY ACTIVE projects to active; every other served state fails closed to revoked", () => {
    for (const s of CLAIM_LIFECYCLE_STATES) {
      if (s === "UNCLAIMED") {
        expect(projectToStoreStatus(s)).toBeNull()
      } else if (s === "ACTIVE") {
        expect(projectToStoreStatus(s)).toBe("active")
      } else {
        expect(projectToStoreStatus(s)).toBe("revoked")
      }
    }
  })

  it("isServingState agrees with the projection (active ⇔ serving)", () => {
    for (const s of CLAIM_LIFECYCLE_STATES) {
      expect(isServingState(s)).toBe(projectToStoreStatus(s) === "active")
    }
  })
})
