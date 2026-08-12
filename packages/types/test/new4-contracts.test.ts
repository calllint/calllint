import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
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
  it("is 13 codes: the 12 frozen v0 codes (indices 0–11) + TOXIC_FLOW_COMPOSITION (ADR 0044)", () => {
    expect(REASON_CODES).toHaveLength(13)
    // The frozen order 0–11 is unchanged (append-only); #13 is last.
    expect(REASON_CODES[12]).toBe("TOXIC_FLOW_COMPOSITION")
    expect(REASON_CODES.indexOf("UNPINNED_PACKAGE")).toBe(0)
    expect(REASON_CODES.indexOf("LONG_RUNNING_GATEWAY_RUNTIME")).toBe(11)
  })

  it("every code has metadata with a label", () => {
    for (const code of REASON_CODES) {
      expect(REASON_CODE_META[code]).toBeTruthy()
      expect(REASON_CODE_META[code].label).toBeTruthy()
    }
  })

  it("all 13 codes are wired (no pending)", () => {
    const wired = REASON_CODES.filter(
      (c) => REASON_CODE_META[c].status === "wired",
    )
    const pending = REASON_CODES.filter(
      (c) => REASON_CODE_META[c].status === "pending",
    )
    // Phase 2 (ADR 0021/0022/0023) wired MESSAGING / OAUTH / GATEWAY. Phase F (ADR
    // 0044) added TOXIC_FLOW_COMPOSITION. All 13 are backed: 11 by detectors,
    // TOOL_DESCRIPTOR_CHANGED by the drift signal, TOXIC_FLOW_COMPOSITION by the flow object.
    expect(wired).toHaveLength(13)
    expect(pending).toEqual([])
  })

  it("wired codes name a backing id; pending codes do not", () => {
    for (const code of REASON_CODES) {
      const meta = REASON_CODE_META[code]
      if (meta.status === "wired") expect(meta.backedBy.length).toBeGreaterThan(0)
      else expect(meta.backedBy).toEqual([])
    }
  })

  it("TOXIC_FLOW_COMPOSITION is flow-backed, and no detector projects onto it", () => {
    // It is wired (names a backing id) but that id is the flow object, not a detector.
    expect(REASON_CODE_META.TOXIC_FLOW_COMPOSITION.status).toBe("wired")
    expect(REASON_CODE_META.TOXIC_FLOW_COMPOSITION.backedBy).toEqual(["flow:toxic-composition"])
    // reasonCodeForFinding maps the synthetic backing id, but a real detector finding
    // id never resolves to it — the scan path can't fabricate a toxic-flow reason.
    expect(reasonCodeForFinding("action.external-mutation")).not.toBe("TOXIC_FLOW_COMPOSITION")
  })

  it("maps all wired detector finding ids", () => {
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
      // Phase 2 (ADR 0021/0022/0023):
      ["action.messaging-send", "MESSAGING_OR_EMAIL_SEND"],
      ["auth.oauth-scope", "OAUTH_SCOPE_UNKNOWN_OR_EXPANDED"],
      ["runtime.gateway", "LONG_RUNNING_GATEWAY_RUNTIME"],
    ]
    for (const [id, code] of cases) {
      expect(reasonCodeForFinding(id)).toBe(code)
    }
  })

  it("every emitted finding id is backed by a reason code (reverse direction)", () => {
    // Reverse guard: scan static-analyzer src for emitted ids, assert each is in some
    // backedBy. The vocabulary-side readers (this file's other cases, previewSnapshot.ts)
    // only check that backedBy is non-empty, so a NEW detector id could never enter their
    // view. Read detector → vocabulary instead. Walks with fs only: @calllint/types
    // declares zero dependencies by design (it is the schema source of truth), so this
    // must not reach for glob.
    const here = dirname(fileURLToPath(import.meta.url))
    const srcDir = join(here, "..", "..", "static-analyzer", "src")
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name)
        if (e.isDirectory()) return walk(full)
        return e.isFile() && e.name.endsWith(".ts") ? [full] : []
      })
    const files = walk(srcDir)
    // The file this guard exists for (documentSurface.ts) sits at src/ ROOT, not in
    // detectors/ — a subdirectory-only scan would miss it and be vacuous on its subject.
    expect(
      files.some((f) => f.endsWith("documentSurface.ts")),
      "scan must reach src/ root, not only src/detectors/",
    ).toBe(true)
    const emittedIds = new Set<string>()
    for (const file of files) {
      const content = readFileSync(file, "utf8")
      // Match `id: "xxx.yyy"` literals
      const matches = content.matchAll(/\bid:\s*"([a-z][a-z.-]*)"/g)
      for (const m of matches) emittedIds.add(m[1]!)
    }
    // Non-vacuity: the scan must find ids at all, or every assertion below is skipped.
    expect(emittedIds.size).toBeGreaterThan(10)
    // Union all backedBy arrays
    const backedIds = new Set<string>()
    for (const code of REASON_CODES) {
      for (const id of REASON_CODE_META[code].backedBy) backedIds.add(id)
    }
    // Legitimate non-detector sources: drift signal, flow object
    const exemptIds = new Set(["drift:toolMetadataHash", "flow:toxic-composition"])
    // Every emitted id must be backed or explicitly exempt
    for (const id of emittedIds) {
      expect(
        backedIds.has(id) || exemptIds.has(id),
        `Finding id "${id}" is emitted but not backed by any reason code`,
      ).toBe(true)
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
