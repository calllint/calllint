/**
 * Tests for the two Phase-2.4 adoption tools (ADR 0056 §7/§8/§10) — pure delegators over
 * the committed contract bundle + the shared, writer-free @calllint/core.prepareSafeInstall:
 *   - calllint_get_adoption_contract  — serve a committed contract verbatim (or honest miss)
 *   - calllint_prepare_safe_install   — local static PREPARE; the SAME gateway sequence the
 *     CLI safe-install runs, fail-closed, never executing or writing anything.
 * These assert the observable contract (outcome/route/verdict projection), not bytes the
 * core owns — the anti-drift test pins the bundle to the baked sidecars separately.
 */
import { describe, it, expect } from "vitest"
import { TOOLS_BY_NAME } from "../src/tools.js"
import { COMMITTED_CONTRACTS } from "../src/committedContracts.js"
import type { ScanOptions } from "@calllint/core"

const OPTS: ScanOptions = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
}

function call(name: string, args: Record<string, unknown>): { text: unknown; isError?: boolean } {
  const tool = TOOLS_BY_NAME.get(name)
  if (!tool) throw new Error(`no tool ${name}`)
  const r = tool.handler(args, OPTS)
  // Error results carry a plain-text message; success results carry JSON.
  const raw = r.content[0]!.text
  return { text: r.isError ? raw : JSON.parse(raw), isError: r.isError }
}

// The only npm SAFE subject we assert against (grounded in the committed bundle).
const NPM_SLUG = "mcp-registry/ai.adeu-adeu"
const REMOTE_SLUG = "mcp-registry/ac.inference.sh-mcp"

describe("calllint_get_adoption_contract", () => {
  it("serves a committed contract verbatim under its canonicalName", () => {
    const { text } = call("calllint_get_adoption_contract", { canonicalName: NPM_SLUG }) as {
      text: { found: boolean; contract: unknown }
    }
    expect(text.found).toBe(true)
    expect(text.contract).toEqual(COMMITTED_CONTRACTS[NPM_SLUG]!)
  })

  it("requires canonicalName", () => {
    const { isError } = call("calllint_get_adoption_contract", {})
    expect(isError).toBe(true)
  })

  it("returns an honest not-found (no throw) for an unknown slug — absence is not a verdict", () => {
    const { text, isError } = call("calllint_get_adoption_contract", { canonicalName: "nope/x" }) as {
      text: { found: boolean }
      isError?: boolean
    }
    expect(isError).toBeUndefined()
    expect(text.found).toBe(false)
  })

  it("treats a non-matching version as not-found (never a different version)", () => {
    const { text } = call("calllint_get_adoption_contract", { canonicalName: NPM_SLUG, version: "9.9.9" }) as {
      text: { found: boolean }
    }
    expect(text.found).toBe(false)
  })
})

type PrepResult = {
  outcome: string
  planDigest: string | null
  host: string | null
  version: string | null
  artifactDigest: string | null
  contractDigest: string | null
  notes: string[]
}

describe("calllint_prepare_safe_install", () => {
  it("PREPARES a pinned npm SAFE subject with a plan when a host is named", () => {
    const { text } = call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG, host: "claude-code" }) as {
      text: PrepResult
    }
    expect(text.outcome).toBe("PREPARED")
    expect(text.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(text.host).toBe("claude-code")
  })

  it("returns a plan-less local decision when no host is named", () => {
    const { text } = call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG }) as { text: PrepResult }
    expect(text.outcome).toBe("PREPARED")
    expect(text.planDigest).toBeNull()
    expect(text.notes.some((n) => /no host named/.test(n))).toBe(true)
  })

  it("is deterministic — same inputs, same planDigest (no clock/network drift)", () => {
    const a = call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG, host: "cursor" }).text as PrepResult
    const b = call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG, host: "cursor" }).text as PrepResult
    expect(a.planDigest).toBe(b.planDigest)
  })

  it("routes a remote (non-npm) subject to LOCAL_PREFLIGHT_REQUIRED — never a guessed command", () => {
    const { text } = call("calllint_prepare_safe_install", { canonicalName: REMOTE_SLUG, host: "claude-code" }) as {
      text: PrepResult
    }
    expect(text.outcome).toBe("LOCAL_PREFLIGHT_REQUIRED")
    expect(text.planDigest).toBeNull()
  })

  it("ABORTS on an exact-target version mismatch — the contract exists, the assertion fails", () => {
    const { text } = call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG, expectedVersion: "9.9.9" }) as {
      text: PrepResult
    }
    expect(text.outcome).toBe("ABORTED_ON_MISMATCH")
    expect(text.planDigest).toBeNull()
  })

  it("ABORTS on an artifact-digest mismatch", () => {
    const bad = "sha256:" + "0".repeat(64)
    const { text } = call("calllint_prepare_safe_install", {
      canonicalName: NPM_SLUG,
      expectedArtifactDigest: bad,
    }) as { text: PrepResult }
    expect(text.outcome).toBe("ABORTED_ON_MISMATCH")
  })

  it("rejects a malformed digest assertion as a usage error", () => {
    const { isError } = call("calllint_prepare_safe_install", {
      canonicalName: NPM_SLUG,
      expectedArtifactDigest: "not-a-digest",
    })
    expect(isError).toBe(true)
  })

  it("rejects an unsupported host", () => {
    const { isError } = call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG, host: "emacs" })
    expect(isError).toBe(true)
  })

  it("returns UNSUPPORTED (honest, no throw) for an unknown slug", () => {
    const { text, isError } = call("calllint_prepare_safe_install", { canonicalName: "nope/x" }) as {
      text: PrepResult
      isError?: boolean
    }
    expect(isError).toBeUndefined()
    expect(text.outcome).toBe("UNSUPPORTED")
  })

  it("carries the contract's exact target identity through into the result", () => {
    const c = COMMITTED_CONTRACTS[NPM_SLUG]!
    const { text } = call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG, host: "windsurf" }) as {
      text: PrepResult
    }
    expect(text.version).toBe(c.subject.version)
    expect(text.artifactDigest).toBe(c.subject.artifactDigest)
    expect(text.contractDigest).toBe(c.contract.contractDigest)
  })
})
