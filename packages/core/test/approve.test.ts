import { describe, it, expect } from "vitest"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CompactDecision } from "@calllint/types"
import {
  buildApproved,
  writeApproved,
  readApproved,
  defaultApprovedPath,
} from "../src/state/approve.js"

const AT = "2026-06-29T00:00:00.000Z"

function decision(
  surface: string,
  fingerprintHash: string,
  verdict: CompactDecision["verdict"] = "REVIEW",
): CompactDecision {
  return {
    schemaVersion: "calllint.decision.v0",
    verdict,
    surface,
    fingerprintHash,
    reasonCodes: ["UNPINNED_PACKAGE"],
    nextAction: "ask_before_continue",
  }
}

describe("buildApproved", () => {
  it("projects decisions into a calllint.approved.v0 state", () => {
    const state = buildApproved(
      [decision(".cursor/mcp.json", "sha256:aaa"), decision(".vscode/mcp.json", "sha256:bbb", "SAFE")],
      AT,
    )
    expect(state.schemaVersion).toBe("calllint.approved.v0")
    expect(state.approved).toHaveLength(2)
    expect(state.approved[0]).toMatchObject({
      surface: ".cursor/mcp.json",
      fingerprintHash: "sha256:aaa",
      verdict: "REVIEW",
      approvedAt: AT,
    })
  })

  it("dedups identical surface+hash and sorts for reproducible diffs", () => {
    const state = buildApproved(
      [
        decision("b.json", "sha256:2"),
        decision("a.json", "sha256:1"),
        decision("b.json", "sha256:2"), // dup
      ],
      AT,
    )
    expect(state.approved.map((e) => e.surface)).toEqual(["a.json", "b.json"])
  })

  it("omits reasonCodes when empty", () => {
    const d = decision("x.json", "sha256:x")
    d.reasonCodes = []
    const state = buildApproved([d], AT)
    expect(state.approved[0]!.reasonCodes).toBeUndefined()
  })
})

describe("writeApproved / readApproved", () => {
  it("round-trips through disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "calllint-approved-"))
    try {
      const path = defaultApprovedPath(dir)
      const state = buildApproved([decision("a.json", "sha256:1")], AT)
      writeApproved(state, path)
      expect(existsSync(path)).toBe(true)
      const back = readApproved(path)
      expect(back).toEqual(state)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("returns undefined when the file is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "calllint-approved-"))
    try {
      expect(readApproved(defaultApprovedPath(dir))).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
