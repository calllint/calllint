import { describe, it, expect } from "vitest"
import type { Flow } from "@calllint/types"
import { foldFlowsIntoReasons } from "../src/index.js"

/**
 * Locks the F4 flow→decision fold (ADR 0040 §1 / ADR 0044). A flow FEEDS the verdict as
 * a TOXIC_FLOW_COMPOSITION reason — never a second verdict. Only BLOCK/REVIEW flows
 * contribute; ALLOW flows add nothing; every folded reason is sourced (I-07).
 */

function flow(partial: Partial<Flow>): Flow {
  return {
    schema: "calllint.flow.v0",
    flowId: "flow:sensitive-to-send-network",
    source: { trustSource: "sensitive.secret", evidence: ["server.env.API_KEY"] },
    steps: [{ action: "read", resource: "secret", scope: null }],
    sink: { action: "send", resource: "network", destination: "evil.example.com" },
    risk: { class: "critical", severity: 95 },
    decisionHint: "BLOCK",
    evidence: ["server.env.API_KEY", "SKILL.md:12"],
    authorityDigests: [`sha256:${"a".repeat(64)}`],
    digest: `sha256:${"b".repeat(64)}`,
    ...partial,
  }
}

describe("foldFlowsIntoReasons — flows feed the verdict as reasons (ADR 0044)", () => {
  it("a BLOCK flow becomes a TOXIC_FLOW_COMPOSITION reason contributing BLOCK", () => {
    const reasons = foldFlowsIntoReasons([flow({ decisionHint: "BLOCK" })])
    expect(reasons).toHaveLength(1)
    expect(reasons[0]!.code).toBe("TOXIC_FLOW_COMPOSITION")
    expect(reasons[0]!.contributes).toBe("BLOCK")
  })

  it("a REVIEW flow contributes REVIEW", () => {
    const reasons = foldFlowsIntoReasons([flow({ decisionHint: "REVIEW" })])
    expect(reasons[0]!.contributes).toBe("REVIEW")
  })

  it("an ALLOW flow contributes NOTHING (never appears)", () => {
    expect(foldFlowsIntoReasons([flow({ decisionHint: "ALLOW" })])).toEqual([])
  })

  it("every folded reason is sourced at the composition (I-07) — flowId + evidence byte", () => {
    const [r] = foldFlowsIntoReasons([flow({})])
    expect(r!.evidenceSource.length).toBeGreaterThan(0)
    expect(r!.evidenceSource).toContain("flow:sensitive-to-send-network")
    expect(r!.evidenceSource).toContain("server.env.API_KEY")
  })

  it("mixed flows: only BLOCK/REVIEW survive, ALLOW dropped", () => {
    const reasons = foldFlowsIntoReasons([
      flow({ flowId: "flow:a", evidence: ["a:1"], decisionHint: "BLOCK" }),
      flow({ flowId: "flow:b", evidence: ["b:1"], decisionHint: "ALLOW" }),
      flow({ flowId: "flow:c", evidence: ["c:1"], decisionHint: "REVIEW" }),
    ])
    expect(reasons).toHaveLength(2)
    expect(reasons.every((r) => r.code === "TOXIC_FLOW_COMPOSITION")).toBe(true)
    expect(reasons.map((r) => r.contributes).sort()).toEqual(["BLOCK", "REVIEW"])
  })

  it("is deterministic and order-independent", () => {
    const a = foldFlowsIntoReasons([
      flow({ flowId: "flow:x", evidence: ["x:1"], decisionHint: "BLOCK" }),
      flow({ flowId: "flow:y", evidence: ["y:1"], decisionHint: "REVIEW" }),
    ])
    const b = foldFlowsIntoReasons([
      flow({ flowId: "flow:y", evidence: ["y:1"], decisionHint: "REVIEW" }),
      flow({ flowId: "flow:x", evidence: ["x:1"], decisionHint: "BLOCK" }),
    ])
    expect(a).toEqual(b)
  })

  it("empty in → empty out", () => {
    expect(foldFlowsIntoReasons([])).toEqual([])
  })
})
