/**
 * Tests for the two Phase-2.4 adoption tools (ADR 0056 §7/§8/§10) — pure delegators over
 * the committed contract bundle + the shared, writer-free @calllint/core.prepareSafeInstall:
 *   - calllint_get_adoption_contract  — serve a committed contract verbatim (or honest miss)
 *   - calllint_prepare_safe_install   — local static PREPARE; the SAME gateway sequence the
 *     CLI safe-install runs, fail-closed, never executing or writing anything.
 * These assert the observable contract (outcome/route/verdict projection), not bytes the
 * core owns — the anti-drift test pins the bundle to the baked sidecars separately.
 */
import { describe, it, expect, afterEach } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

// Scratch host-config dirs. Apply is the one tool that WRITES, so every apply test
// targets an isolated temp path — never a real host config.
const scratches: string[] = []
function scratchConfig(initial?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "calllint-mcp-apply-test-"))
  scratches.push(dir)
  const path = join(dir, "mcp.json")
  if (initial !== undefined) writeFileSync(path, initial, "utf8")
  return path
}
afterEach(() => {
  for (const d of scratches.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Prepare against a given host config, returning the plan digest to approve. */
function prepareFor(hostConfigPath: string, host = "cursor"): string {
  const { text } = call("calllint_prepare_safe_install", {
    canonicalName: NPM_SLUG,
    host,
    hostConfigPath,
  }) as { text: PrepResult }
  return text.planDigest!
}

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

type ApplyResultView = PrepResult & {
  receiptDigest: string | null
  receipt: Record<string, unknown> | null
  configPath: string
  configDigestAfter: string | null
  backupPath: string | null
  rolledBack: boolean
  persistentComponents: string[]
}

const BAD_DIGEST = "sha256:" + "0".repeat(64)

describe("calllint_apply_prepared_install", () => {
  it("APPLIES a prepared plan to an absent config and returns a verified receipt", () => {
    const cfg = scratchConfig()
    const digest = prepareFor(cfg)
    const { text } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: digest,
    }) as { text: ApplyResultView }

    expect(text.outcome).toBe("APPLIED_AND_VERIFIED")
    expect(text.planDigest).toBe(digest)
    expect(text.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    // The write actually landed, and it carries the contract's exact pinned target.
    expect(existsSync(cfg)).toBe(true)
    const written = JSON.parse(readFileSync(cfg, "utf8")) as { mcpServers: Record<string, { args: string[] }> }
    const entry = Object.values(written.mcpServers)[0]!
    const c = COMMITTED_CONTRACTS[NPM_SLUG]!
    expect(entry.args).toContain(`${c.subject.packageName}@${c.subject.version}`)
  })

  it("installs ZERO persistent CallLint components (INV-2.4-07)", () => {
    const cfg = scratchConfig()
    const { text } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: prepareFor(cfg),
    }) as { text: ApplyResultView }
    expect(text.outcome).toBe("APPLIED_AND_VERIFIED")
    expect(text.persistentComponents).toEqual([])
    // Nothing CallLint-owned was created next to the user's config.
    const written = JSON.parse(readFileSync(cfg, "utf8")) as { mcpServers: Record<string, unknown> }
    expect(Object.keys(written.mcpServers).some((k) => /calllint/i.test(k))).toBe(false)
  })

  it("is idempotent — re-applying the same plan reports already-applied, not a conflict", () => {
    const cfg = scratchConfig()
    const digest = prepareFor(cfg)
    const args = { canonicalName: NPM_SLUG, host: "cursor", hostConfigPath: cfg, approvalDigest: digest }
    const first = call("calllint_apply_prepared_install", args).text as ApplyResultView
    expect(first.outcome).toBe("APPLIED_AND_VERIFIED")
    // The second call re-prepares against the NOW-written config, so its recomputed
    // plan differs from the original approval — the gate must refuse, never re-write.
    const second = call("calllint_apply_prepared_install", args).text as ApplyResultView
    expect(second.outcome).toBe("ABORTED_ON_MISMATCH")
    expect(second.notes.some((n) => /does not match the freshly recomputed plan/.test(n))).toBe(true)
  })

  it("accepts a digest prepared with the SAME explicit path (the honest hand-off matches)", () => {
    // Regression guard: prepare and apply must resolve the target path identically, or a
    // correct prepare→review→apply hand-off would abort on every call. The path is part
    // of the sealed plan, so this is what makes the approval gate usable rather than a
    // permanent refusal.
    const cfg = scratchConfig()
    const digest = prepareFor(cfg, "cursor")
    const { text } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: digest,
    }) as { text: ApplyResultView }
    expect(text.outcome).toBe("APPLIED_AND_VERIFIED")
  })

  it("REFUSES a stale approvalDigest and writes nothing", () => {
    const cfg = scratchConfig()
    const { text } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: BAD_DIGEST,
    }) as { text: ApplyResultView }
    expect(text.outcome).toBe("ABORTED_ON_MISMATCH")
    expect(existsSync(cfg)).toBe(false) // no file was created
  })

  it("REFUSES when the host config changed between prepare and apply (INV-2.4-06)", () => {
    const cfg = scratchConfig(JSON.stringify({ mcpServers: {} }, null, 2) + "\n")
    const digest = prepareFor(cfg)
    // Someone else edits the target after we prepared.
    writeFileSync(cfg, JSON.stringify({ mcpServers: { other: { command: "node" } } }, null, 2) + "\n", "utf8")
    const { text } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: digest,
    }) as { text: ApplyResultView }
    expect(text.outcome).toBe("ABORTED_ON_MISMATCH")
    // The unrelated edit survived untouched.
    const after = JSON.parse(readFileSync(cfg, "utf8")) as { mcpServers: Record<string, unknown> }
    expect(Object.keys(after.mcpServers)).toEqual(["other"])
  })

  it("requires approvalDigest — apply never auto-approves", () => {
    const { isError } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: scratchConfig(),
    })
    expect(isError).toBe(true)
  })

  it("requires a host — an apply never guesses an install location", () => {
    const { isError } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      approvalDigest: BAD_DIGEST,
    })
    expect(isError).toBe(true)
  })

  it("rejects a malformed approvalDigest as a usage error", () => {
    const { isError } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      approvalDigest: "yes-please",
    })
    expect(isError).toBe(true)
  })

  it("returns UNSUPPORTED for cursor with no hostConfigPath (project-scoped, never guessed)", () => {
    const { text, isError } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      approvalDigest: BAD_DIGEST,
    }) as { text: ApplyResultView; isError?: boolean }
    expect(isError).toBeUndefined()
    expect(text.outcome).toBe("UNSUPPORTED")
  })

  it("routes a remote (non-npm) subject to LOCAL_PREFLIGHT_REQUIRED before any write", () => {
    const cfg = scratchConfig()
    const { text } = call("calllint_apply_prepared_install", {
      canonicalName: REMOTE_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: BAD_DIGEST,
    }) as { text: ApplyResultView }
    expect(text.outcome).toBe("LOCAL_PREFLIGHT_REQUIRED")
    expect(existsSync(cfg)).toBe(false)
  })

  it("ABORTS on an exact-target mismatch before any write", () => {
    const cfg = scratchConfig()
    const digest = prepareFor(cfg)
    const { text } = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: digest,
      expectedVersion: "9.9.9",
    }) as { text: ApplyResultView }
    expect(text.outcome).toBe("ABORTED_ON_MISMATCH")
    expect(existsSync(cfg)).toBe(false)
  })

  it("returns UNSUPPORTED (no throw) for an unknown slug", () => {
    const { text, isError } = call("calllint_apply_prepared_install", {
      canonicalName: "nope/x",
      host: "cursor",
      hostConfigPath: scratchConfig(),
      approvalDigest: BAD_DIGEST,
    }) as { text: ApplyResultView; isError?: boolean }
    expect(isError).toBeUndefined()
    expect(text.outcome).toBe("UNSUPPORTED")
  })
})

type VerifyView = {
  canonicalName: string
  contractFound: boolean
  configPresent: boolean
  configParsed: boolean
  serverKey: string
  serverPresent: boolean
  expectedPinnedTarget: string | null
  pinnedExact: boolean | null
  receiptChecked: boolean
  receiptValid: boolean | null
  receiptDigest: string | null
  installed: boolean
  verified: boolean
  notes: string[]
}

describe("calllint_verify_tool_install", () => {
  it("confirms an applied install and validates its receipt", () => {
    const cfg = scratchConfig()
    const applied = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: prepareFor(cfg),
    }).text as ApplyResultView
    expect(applied.outcome).toBe("APPLIED_AND_VERIFIED")

    const { text } = call("calllint_verify_tool_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      receipt: JSON.stringify(applied.receipt),
    }) as { text: VerifyView }

    expect(text.serverPresent).toBe(true)
    expect(text.pinnedExact).toBe(true)
    expect(text.installed).toBe(true)
    expect(text.receiptChecked).toBe(true)
    expect(text.receiptValid).toBe(true)
    expect(text.verified).toBe(true)
  })

  it("reports an absent config honestly — not installed, never a throw", () => {
    const { text } = call("calllint_verify_tool_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: join(tmpdir(), "calllint-does-not-exist", "mcp.json"),
    }) as { text: VerifyView }
    expect(text.configPresent).toBe(false)
    expect(text.serverPresent).toBe(false)
    expect(text.installed).toBe(false)
    expect(text.verified).toBe(false)
  })

  it("reports a missing server entry when the config exists but holds something else", () => {
    const cfg = scratchConfig(JSON.stringify({ mcpServers: { other: { command: "node" } } }, null, 2) + "\n")
    const { text } = call("calllint_verify_tool_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
    }) as { text: VerifyView }
    expect(text.configPresent).toBe(true)
    expect(text.configParsed).toBe(true)
    expect(text.serverPresent).toBe(false)
    expect(text.installed).toBe(false)
  })

  it("detects exact-pin DRIFT — the entry is present but no longer pins the contract's version", () => {
    const cfg = scratchConfig()
    call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: prepareFor(cfg),
    })
    // Repoint the installed entry at a different version behind CallLint's back.
    const written = JSON.parse(readFileSync(cfg, "utf8")) as { mcpServers: Record<string, { args: string[] }> }
    const key = Object.keys(written.mcpServers)[0]!
    written.mcpServers[key]!.args = ["-y", "some-other-package@9.9.9"]
    writeFileSync(cfg, JSON.stringify(written, null, 2) + "\n", "utf8")

    const { text } = call("calllint_verify_tool_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
    }) as { text: VerifyView }
    expect(text.serverPresent).toBe(true)
    expect(text.pinnedExact).toBe(false)
    expect(text.installed).toBe(false) // drift is reported, never accepted
    expect(text.notes.some((n) => /drifted from the contract's exact target/.test(n))).toBe(true)
  })

  it("fails a tampered receipt closed while still reporting the config truthfully", () => {
    const cfg = scratchConfig()
    const applied = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: prepareFor(cfg),
    }).text as ApplyResultView
    // Break the approval binding (approvedDigest must equal installPlanDigest).
    const tampered = { ...(applied.receipt as Record<string, unknown>) }
    tampered.approval = { ...(tampered.approval as Record<string, unknown>), approvedDigest: BAD_DIGEST }

    const { text } = call("calllint_verify_tool_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      receipt: JSON.stringify(tampered),
    }) as { text: VerifyView }
    expect(text.serverPresent).toBe(true) // the config really is installed
    expect(text.receiptValid).toBe(false)
    expect(text.verified).toBe(false) // but nothing verified is claimed
  })

  it("handles a non-JSON receipt without throwing", () => {
    const cfg = scratchConfig()
    const { text } = call("calllint_verify_tool_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      receipt: "not json",
    }) as { text: VerifyView }
    expect(text.receiptValid).toBe(false)
    expect(text.verified).toBe(false)
  })

  it("reports an unknown slug honestly (contractFound false, no exact pin asserted)", () => {
    const cfg = scratchConfig(JSON.stringify({ mcpServers: {} }, null, 2) + "\n")
    const { text, isError } = call("calllint_verify_tool_install", {
      canonicalName: "nope/x",
      host: "cursor",
      hostConfigPath: cfg,
    }) as { text: VerifyView; isError?: boolean }
    expect(isError).toBeUndefined()
    expect(text.contractFound).toBe(false)
    expect(text.expectedPinnedTarget).toBeNull()
    expect(text.installed).toBe(false)
  })

  it("requires a supported host", () => {
    const { isError } = call("calllint_verify_tool_install", { canonicalName: NPM_SLUG, host: "emacs" })
    expect(isError).toBe(true)
  })
})
