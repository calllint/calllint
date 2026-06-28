import { describe, it, expect } from "vitest"
import {
  REASON_CODES,
  REASON_CODE_META,
  reasonCodeForFinding,
  NEXT_ACTIONS,
  VERDICT_NEXT_ACTION,
  VERDICTS,
  FP_KINDS,
  FP_LAUNCH,
  FP_TRANSPORT,
  FP_SCOPE,
  FP_EFFECTS,
  FP_IDENTITY,
  type ReasonCode,
} from "../src/index.js"

// ---------------------------------------------------------------------------
// new4 L1/L2 contracts (ADR 0019 + 0020). These freeze the public vocabulary;
// failing here means a contract drifted and a downstream consumer would break.
// ---------------------------------------------------------------------------

describe("reason-code vocabulary (ADR 0020)", () => {
  it("is exactly 12 codes, frozen for v0", () => {
    expect(REASON_CODES).toHaveLength(12)
  })

  it("every code has metadata with a label", () => {
    for (const code of REASON_CODES) {
      expect(REASON_CODE_META[code]).toBeTruthy()
      expect(REASON_CODE_META[code].label).toBeTruthy()
    }
  })

  it("splits into 9 wired + 3 pending, with the pending three named", () => {
    const wired = REASON_CODES.filter(
      (c) => REASON_CODE_META[c].status === "wired",
    )
    const pending = REASON_CODES.filter(
      (c) => REASON_CODE_META[c].status === "pending",
    )
    // 8 detector relabels + TOOL_DESCRIPTOR_CHANGED (drift) = 9 wired.
    // (exec.*, action.financial*, prompt.* each fold two finding ids into one code.)
    expect(wired).toHaveLength(9)
    expect(pending).toEqual([
      "MESSAGING_OR_EMAIL_SEND",
      "OAUTH_SCOPE_UNKNOWN_OR_EXPANDED",
      "LONG_RUNNING_GATEWAY_RUNTIME",
    ])
  })

  it("wired codes name a backing detector; pending codes do not", () => {
    for (const code of REASON_CODES) {
      const meta = REASON_CODE_META[code]
      if (meta.status === "wired") expect(meta.backedBy.length).toBeGreaterThan(0)
      else expect(meta.backedBy).toEqual([])
    }
  })

  it("reasonCodeForFinding maps the 10 detector finding ids correctly", () => {
    const cases: Array<[string, ReasonCode]> = [
      ["supply.unpinned-package", "UNPINNED_PACKAGE"],
      ["supply.unknown-remote", "UNKNOWN_REMOTE"],
      ["secrets.env-key", "SECRET_IN_WORKSPACE_CONFIG"],
      ["files.broad-path", "BROAD_FILESYSTEM_ACCESS"],
      ["exec.dangerous-command", "SHELL_OR_DOCKER_EXECUTION"],
      ["exec.unverified-local-source", "SHELL_OR_DOCKER_EXECUTION"],
      ["action.external-mutation", "EXTERNAL_MUTATION_UNKNOWN"],
      ["action.financial", "MONEY_OR_PAYMENT_CAPABILITY"],
      ["action.financial-observed", "MONEY_OR_PAYMENT_CAPABILITY"],
      ["prompt.hidden-instructions", "PROMPT_METADATA_INSTRUCTION"],
      ["prompt.poisoning", "PROMPT_METADATA_INSTRUCTION"],
    ]
    for (const [id, code] of cases) {
      expect(reasonCodeForFinding(id)).toBe(code)
    }
  })

  it("returns undefined for an unmapped finding id", () => {
    expect(reasonCodeForFinding("not.a.real.finding")).toBeUndefined()
  })
})

describe("compact decision next-action map (ADR 0020)", () => {
  it("is total over all four verdicts", () => {
    for (const v of VERDICTS) {
      expect(NEXT_ACTIONS).toContain(VERDICT_NEXT_ACTION[v])
    }
  })

  it("UNKNOWN never maps to continue (UNKNOWN ≠ SAFE)", () => {
    expect(VERDICT_NEXT_ACTION.UNKNOWN).not.toBe("continue")
    expect(VERDICT_NEXT_ACTION.UNKNOWN).toBe("gather_more_evidence")
  })

  it("only SAFE maps to continue", () => {
    const continueVerdicts = VERDICTS.filter(
      (v) => VERDICT_NEXT_ACTION[v] === "continue",
    )
    expect(continueVerdicts).toEqual(["SAFE"])
  })
})

describe("capability fingerprint vocabularies (ADR 0019)", () => {
  it("closed vocabularies include unknown as a safe default", () => {
    expect(FP_KINDS).toContain("unknown")
    expect(FP_LAUNCH).toContain("unknown")
    expect(FP_TRANSPORT).toContain("unknown")
    expect(FP_SCOPE).toContain("unknown")
    expect(FP_IDENTITY).toContain("unknown")
  })

  it("identity cannot silently become verified (must be explicit in the union)", () => {
    expect(FP_IDENTITY).toEqual(["verified", "known", "unknown"])
  })

  it("effects vocabulary covers the v0 risk surface", () => {
    expect(FP_EFFECTS).toContain("local_execution")
    expect(FP_EFFECTS).toContain("payment")
    expect(FP_EFFECTS).toContain("gateway_runtime")
  })
})
