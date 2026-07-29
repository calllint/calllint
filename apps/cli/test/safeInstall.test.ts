/**
 * `calllint safe-install` — the Safe-Install orchestrator (new14 Phase 2.4 Batch 5;
 * ADR 0056 §10). These tests drive the SHIPPED command through the same seams the
 * real CLI uses: `computeContractFetch(argv, …)` resolves the contract at the async
 * edge (exactly as index.ts main() does), then its result is injected as
 * `deps.contract` into the synchronous `run(argv, deps)` — no private internals are
 * poked. child_process is mocked so ANY attempt to execute the target is observable:
 * the orchestrator must NEVER execute/start/connect/authenticate/test the artifact
 * (INV-2.4-09), it only pins its identity and delegates the write to the apply engine.
 *
 * The proof obligations for Batch 5:
 *   - a public BLOCK / UNKNOWN / unsupported route is NEVER laundered into a lenient
 *     local decision (INV-2.4-02) — the public floor short-circuits before prepare;
 *   - an exact-target identity mismatch ABORTs before any writable plan (INV-2.4-06);
 *   - every live write is delegated to `trust apply` (the ONE writer, INV-2.4-03) —
 *     the orchestrator makes zero direct host-config writes;
 *   - one-time mode leaves ZERO persistent CallLint files in the user's tree
 *     (INV-2.4-07): all working files live in an ephemeral scratch dir;
 *   - an unsupported host / non-exact subject yields an honest UNSUPPORTED /
 *     LOCAL_PREFLIGHT_REQUIRED, never a guessed command.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * child_process is mocked so ANY execution of the target is observable. The
 * orchestrator digests bytes and writes JSON via json-patch — it spawns nothing.
 */
const spawnMock = vi.fn()
const execMock = vi.fn()
const execSyncMock = vi.fn()
const execFileMock = vi.fn()
const execFileSyncMock = vi.fn()
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (...a: unknown[]) => spawnMock(...a),
    exec: (...a: unknown[]) => execMock(...a),
    execSync: (...a: unknown[]) => execSyncMock(...a),
    execFile: (...a: unknown[]) => execFileMock(...a),
    execFileSync: (...a: unknown[]) => execFileSyncMock(...a),
  }
})

const { run } = await import("../src/run.js")
const { computeContractFetch } = await import("../src/commands/safeInstall/contractFetch.js")
const { mapPrepareToOutcome, mapAppliedToOutcome, outcomeExitCode } = await import(
  "../src/commands/safeInstall/result.js"
)
import type { ResolvedContract, ContractResponse } from "../src/commands/safeInstall/contractFetch.js"

const BASE = {
  now: Date.parse("2026-07-13T00:00:00Z"),
  generatedAt: "2026-07-13T00:00:00.000Z",
}

/** Deterministic sha256 literals for fixtures. */
const SHA = (ch: string): string => "sha256:" + ch.repeat(64)
const CONTRACT_DIGEST = SHA("c")
const ARTIFACT_DIGEST = SHA("d")

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "calllint-si-test-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  spawnMock.mockClear()
  execMock.mockClear()
  execSyncMock.mockClear()
  execFileMock.mockClear()
  execFileSyncMock.mockClear()
})

function noExec() {
  expect(spawnMock).not.toHaveBeenCalled()
  expect(execMock).not.toHaveBeenCalled()
  expect(execSyncMock).not.toHaveBeenCalled()
  expect(execFileMock).not.toHaveBeenCalled()
  expect(execFileSyncMock).not.toHaveBeenCalled()
}

/**
 * A fully schema-valid `calllint.agent-adoption-contract.v1`, overridable per test.
 * The default is the exact-target, actionable happy path: a pinned npm subject with
 * a SAFE public observation whose single next action is PREPARE_LOCALLY. The pinned
 * package mirrors the known server the Trust Gateway tests apply; the local re-decode
 * runs under the adoption-basis policy (arbitraryCommandExecution:warn), so a pinned
 * stdio launch decides REVIEW → a Tier-A applyable plan (still gated by the single
 * human approval before any write — REVIEW is never auto-applied).
 */
type NextAction =
  | { kind: "PREPARE_LOCALLY"; tool: "calllint_prepare_safe_install"; arguments: Record<string, unknown> }
  | { kind: "INSPECT_BLOCKERS"; tool: "explain_finding" }
  | { kind: "LOCAL_PREFLIGHT_REQUIRED"; tool: "calllint_prepare_safe_install" }
  | { kind: "EXPLAIN_ONLY" }

function makeContract(
  over: {
    verdict?: "SAFE" | "REVIEW" | "BLOCK" | "UNKNOWN"
    nextAction?: NextAction
    subject?: Record<string, unknown>
    contractDigest?: string
  } = {},
): Record<string, unknown> {
  const verdict = over.verdict ?? "SAFE"
  const nextAction: NextAction =
    over.nextAction ?? {
      kind: "PREPARE_LOCALLY",
      tool: "calllint_prepare_safe_install",
      arguments: {
        canonicalName: "acme/tool",
        expectedVersion: "1.0.0",
        expectedArtifactDigest: ARTIFACT_DIGEST,
        expectedContractDigest: over.contractDigest ?? CONTRACT_DIGEST,
        host: null,
      },
    }
  return {
    schema: "calllint.agent-adoption-contract.v1",
    contract: {
      contractDigest: over.contractDigest ?? CONTRACT_DIGEST,
      generatedAt: BASE.generatedAt,
      expiresAt: null,
      generatorVersion: "1.7.3",
      snapshotDigest: SHA("a"),
    },
    subject: {
      canonicalName: "acme/tool",
      canonicalSlug: "acme-tool",
      packageType: "npm",
      packageName: "@modelcontextprotocol/server-time",
      version: "1.0.0",
      artifactDigest: ARTIFACT_DIGEST,
      sourceLocator: "npm:@modelcontextprotocol/server-time@1.0.0",
      ...over.subject,
    },
    publicObservation: {
      verdict,
      publicLabel: verdict === "SAFE" ? "No blockers observed" : verdict,
      reasonCodes: [],
      evidenceLevel: "E3",
      evidenceDigest: SHA("e"),
      completeness: "complete",
    },
    authorityDelta: { adds: [], notObserved: [] },
    trustedSources: {
      registrySnapshotDigest: SHA("b"),
      evidenceDigest: SHA("f"),
      engineVersion: "1.7.3",
    },
    untrustedPublisherContent: { description: null, usedForSafetyDecision: false },
    recommendedNextAction: nextAction,
    agentGuidance: {
      goal: "Adopt with locally approved authority",
      steps: ["Run a local pre-flight and review the plan"],
      mustAskBefore: [],
      mustStopWhen: [],
      prohibitedShortcuts: [],
    },
  }
}

/** Inject a contract exactly as the async edge would, via a local file + computeContractFetch. */
async function contractDeps(
  contract: Record<string, unknown>,
  extra: { readStdin?: () => string; generatedAt?: string } = {},
): Promise<{ cwd: string; readStdin: () => string; now: number; generatedAt: string; contract?: ResolvedContract }> {
  const file = join(dir, "contract.json")
  writeFileSync(file, JSON.stringify(contract))
  const resolved = await computeContractFetch(["safe-install", "--contract", file], {
    cwd: dir,
    readStdin: () => "",
    fetchImpl: async () => {
      throw new Error("no network for a local file")
    },
  })
  // `generatedAt` is overridable so a test can ADVANCE the clock between the
  // prepare and apply invocations — the real two-process condition. Pinning one
  // clock for both is what hid the unreproducible-digest defect (Gate 2.4-G).
  const clock = extra.generatedAt
    ? { generatedAt: extra.generatedAt, now: Date.parse(extra.generatedAt) }
    : BASE
  return { cwd: dir, readStdin: extra.readStdin ?? (() => ""), ...clock, contract: resolved }
}

/** Run safe-install with a resolved contract already in deps. */
async function runSafeInstall(
  argv: string[],
  contract: Record<string, unknown>,
  extra: { readStdin?: () => string; generatedAt?: string } = {},
) {
  const deps = await contractDeps(contract, extra)
  return run(["safe-install", ...argv], deps)
}

describe("safe-install — contract acquisition at the edge (guarded)", () => {
  it("resolves a local contract file (no network)", async () => {
    const file = join(dir, "c.json")
    writeFileSync(file, JSON.stringify(makeContract()))
    const resolved = await computeContractFetch(["safe-install", "--contract", file], {
      cwd: dir,
      readStdin: () => "",
      fetchImpl: async () => {
        throw new Error("must not fetch for a local file")
      },
    })
    expect(resolved?.error).toBeUndefined()
    expect(resolved?.text).toContain("agent-adoption-contract.v1")
    noExec()
  })

  it("resolves a contract from stdin", async () => {
    const resolved = await computeContractFetch(["safe-install", "--stdin"], {
      cwd: dir,
      readStdin: () => JSON.stringify(makeContract()),
      fetchImpl: async () => {
        throw new Error("must not fetch for stdin")
      },
    })
    expect(resolved?.error).toBeUndefined()
    expect(resolved?.text).toContain("acme/tool")
    noExec()
  })

  it("rejects a wrong schema tag (fail-closed, EXIT.USAGE) — never a guessed install", async () => {
    const file = join(dir, "bad.json")
    writeFileSync(file, JSON.stringify({ schema: "something.else", subject: {} }))
    const resolved = await computeContractFetch(["safe-install", "--contract", file], {
      cwd: dir,
      readStdin: () => "",
      fetchImpl: async () => {
        throw new Error("no network")
      },
    })
    expect(resolved?.text).toBeUndefined()
    expect(resolved?.error?.exitCode).toBe(2)
  })

  it("rejects a non-calllint.com https origin (only the CallLint origin is allowed in v1)", async () => {
    let fetched = false
    const resolved = await computeContractFetch(["safe-install", "--contract", "https://evil.example/contract.json"], {
      cwd: dir,
      readStdin: () => "",
      fetchImpl: async () => {
        fetched = true
        throw new Error("should never be reached — origin is gated before any network touch")
      },
    })
    expect(fetched).toBe(false) // origin gate fires BEFORE any network touch
    expect(resolved?.error?.exitCode).toBe(2)
    expect(resolved?.error?.message).toContain("not allowed")
  })

  it("fetches from https://calllint.com via the guarded reader (200 → text)", async () => {
    const body = JSON.stringify(makeContract())
    const fetchImpl = async (): Promise<ContractResponse> => ({
      ok: true,
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === "content-length" ? String(body.length) : null) },
      text: async () => body,
    })
    const resolved = await computeContractFetch(
      ["safe-install", "--contract", "https://calllint.com/install/acme/tool/index.json"],
      { cwd: dir, readStdin: () => "", fetchImpl },
    )
    expect(resolved?.error).toBeUndefined()
    expect(resolved?.text).toContain("acme/tool")
    // The surfaced source is origin+path only — never a query string.
    expect(resolved?.source).toBe("https://calllint.com/install/acme/tool/index.json")
  })

  it("returns undefined for a non-safe-install command (network-free, byte-identical)", async () => {
    const resolved = await computeContractFetch(["scan", "mcp.json"], {
      cwd: dir,
      readStdin: () => "",
      fetchImpl: async () => {
        throw new Error("no network")
      },
    })
    expect(resolved).toBeUndefined()
  })
})

describe("safe-install — usage / degraded (honest, never a guessed command)", () => {
  it("missing --contract → usage error (exit 2)", () => {
    const r = run(["safe-install"], { cwd: dir, readStdin: () => "", ...BASE })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("Missing contract")
    noExec()
  })

  it("a contract that passes the shape gate but has no subject identity → usage error, no guess", async () => {
    // subject is an object (shape gate passes) but lacks canonicalName → the
    // orchestrator degrades to a usage error rather than inventing a target.
    const r = await runSafeInstall([], { schema: "calllint.agent-adoption-contract.v1", subject: {} } as unknown as Record<string, unknown>)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("no subject identity")
    noExec()
  })

  it("help subcommand prints usage, exit 0", () => {
    const r = run(["safe-install", "help"], { cwd: dir, readStdin: () => "", ...BASE })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("adopt a tool from its Agent Adoption Contract")
    expect(r.stdout).toContain("delegates")
  })
})

describe("safe-install — exact-target identity gate (INV-2.4-06, offline)", () => {
  it("a mismatched --expect-artifact-digest → ABORTED_ON_MISMATCH, exit 20, no writable plan", async () => {
    const r = await runSafeInstall(
      ["--host", "cursor", "--expect-artifact-digest", SHA("0"), "--json"],
      makeContract(),
    )
    expect(r.exitCode).toBe(20)
    const res = JSON.parse(r.stdout)
    expect(res.outcome).toBe("ABORTED_ON_MISMATCH")
    expect(res.planDigest).toBeNull()
    expect(res.notes.some((n: string) => /identity assertion failed/.test(n))).toBe(true)
    // Nothing was ever written to the user's tree.
    expect(existsSync(join(dir, ".cursor"))).toBe(false)
    noExec()
  })

  it("a matching --expect-contract-digest is a no-op (proceeds to PREPARED)", async () => {
    const r = await runSafeInstall(
      ["--host", "cursor", "--expect-contract-digest", CONTRACT_DIGEST, "--json"],
      makeContract(),
    )
    const res = JSON.parse(r.stdout)
    expect(res.outcome).toBe("PREPARED")
    expect(res.contractDigest).toBe(CONTRACT_DIGEST)
    noExec()
  })

  it("a malformed --expect-artifact-digest fails-closed as a usage error (exit 2)", async () => {
    const r = await runSafeInstall(["--host", "cursor", "--expect-artifact-digest", "not-a-digest"], makeContract())
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("must be a sha256")
    noExec()
  })
})

describe("safe-install — public-verdict floor (INV-2.4-02: a public route is never laundered)", () => {
  it("a public BLOCK (INSPECT_BLOCKERS) → BLOCKED, exit 30, WITHOUT delegating a local prepare", async () => {
    const r = await runSafeInstall(
      ["--host", "cursor", "--json"],
      makeContract({ verdict: "BLOCK", nextAction: { kind: "INSPECT_BLOCKERS", tool: "explain_finding" } }),
    )
    expect(r.exitCode).toBe(30)
    const res = JSON.parse(r.stdout)
    expect(res.outcome).toBe("BLOCKED")
    expect(res.planDigest).toBeNull()
    // A public BLOCK short-circuits — no plan, no synthesized config, no write.
    expect(existsSync(join(dir, ".cursor"))).toBe(false)
    noExec()
  })

  it("a public UNKNOWN (LOCAL_PREFLIGHT_REQUIRED) → LOCAL_PREFLIGHT_REQUIRED, exit 20", async () => {
    const r = await runSafeInstall(
      ["--host", "cursor", "--json"],
      makeContract({
        verdict: "UNKNOWN",
        nextAction: { kind: "LOCAL_PREFLIGHT_REQUIRED", tool: "calllint_prepare_safe_install" },
      }),
    )
    expect(r.exitCode).toBe(20)
    expect(JSON.parse(r.stdout).outcome).toBe("LOCAL_PREFLIGHT_REQUIRED")
    noExec()
  })

  it("an EXPLAIN_ONLY route → UNSUPPORTED, exit 20 (no supported install plan)", async () => {
    const r = await runSafeInstall(["--host", "cursor", "--json"], makeContract({ nextAction: { kind: "EXPLAIN_ONLY" } }))
    expect(r.exitCode).toBe(20)
    expect(JSON.parse(r.stdout).outcome).toBe("UNSUPPORTED")
    noExec()
  })
})

describe("safe-install — actionable prepare/apply (delegates to the Trust Gateway)", () => {
  it("npm pinned + no --host → LOCAL_PREFLIGHT_REQUIRED (a host is required to plan)", async () => {
    const r = await runSafeInstall(["--json"], makeContract())
    expect(r.exitCode).toBe(20)
    expect(JSON.parse(r.stdout).outcome).toBe("LOCAL_PREFLIGHT_REQUIRED")
    noExec()
  })

  it("a non-npm subject → LOCAL_PREFLIGHT_REQUIRED (never a guessed launch)", async () => {
    const r = await runSafeInstall(
      ["--host", "cursor", "--json"],
      makeContract({ subject: { packageType: "pypi", packageName: "acme", version: "1.0.0" } }),
    )
    expect(r.exitCode).toBe(20)
    const res = JSON.parse(r.stdout)
    expect(res.outcome).toBe("LOCAL_PREFLIGHT_REQUIRED")
    expect(res.notes.some((n: string) => /npm subject/.test(n))).toBe(true)
    noExec()
  })

  it("an unsupported host → UNSUPPORTED (honest; no guessed location)", async () => {
    const r = await runSafeInstall(["--host", "jetbrains", "--json"], makeContract())
    expect(r.exitCode).toBe(20)
    const res = JSON.parse(r.stdout)
    expect(res.outcome).toBe("UNSUPPORTED")
    expect(res.host).toBeNull()
    noExec()
  })

  it("npm pinned + --host cursor (no --apply) → PREPARED with a plan digest, writes nothing", async () => {
    const r = await runSafeInstall(["--host", "cursor", "--json"], makeContract())
    expect(r.exitCode).toBe(0)
    const res = JSON.parse(r.stdout)
    expect(res.outcome).toBe("PREPARED")
    expect(res.host).toBe("cursor")
    expect(res.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(res.receiptDigest).toBeNull()
    // Prepare-only: no host config written, and ZERO persistent CallLint files
    // in the user's tree (all working files were in an ephemeral scratch dir).
    expect(existsSync(join(dir, ".cursor"))).toBe(false)
    expect(existsSync(join(dir, ".calllint"))).toBe(false)
    noExec()
  })

  it("--json emits ONLY the calllint.safe-install-result.v1 envelope", async () => {
    const r = await runSafeInstall(["--host", "cursor", "--json"], makeContract())
    const res = JSON.parse(r.stdout) // parses cleanly — no prose leaked
    expect(res.schema).toBe("calllint.safe-install-result.v1")
    expect(res.mode).toBe("ONE_TIME_PROTECTED_SETUP")
  })

  it("--apply + matching --approve → APPLIED_AND_VERIFIED; the WRITE is delegated to the apply engine", async () => {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    // 1) Prepare-only, writing out the plan the caller reviews. `--plan-out` is what
    // makes the digest reproducible on the apply step: the plan's validity window is
    // sealed into planDigest, so the reviewed plan must be REPLAYED, not recomputed
    // from a fresh clock (which is why a bare re-run could never match).
    const prepared = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan-out", planFile, "--json"],
      makeContract(),
    )
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    expect(planDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(existsSync(hostConfig)).toBe(false) // prepare wrote nothing
    expect(existsSync(planFile)).toBe(true)

    // 2) Replay the reviewed plan and approve its exact digest.
    const applied = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", planDigest, "--json"],
      makeContract(),
    )
    expect(applied.exitCode).toBe(0)
    const res = JSON.parse(applied.stdout)
    expect(res.outcome).toBe("APPLIED_AND_VERIFIED")
    expect(res.planDigest).toBe(planDigest)
    expect(res.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    // The host config was written by the DELEGATED apply engine (the one writer).
    expect(existsSync(hostConfig)).toBe(true)
    const cfg = JSON.parse(readFileSync(hostConfig, "utf8"))
    expect(cfg.mcpServers["acme-tool"]).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-time@1.0.0"],
    })
    noExec()
  })

  it("one-time mode leaves ZERO persistent CallLint components (INV-2.4-07)", async () => {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    const prepared = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan-out", planFile, "--json"],
      makeContract(),
    )
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    const applied = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", planDigest, "--json"],
      makeContract(),
    )
    const res = JSON.parse(applied.stdout)
    expect(res.mode).toBe("ONE_TIME_PROTECTED_SETUP")
    expect(res.persistentComponents).toEqual([])
    // The caller-requested plan file is NOT a persistent CallLint component: it is
    // an output the caller asked for, holds no CallLint-owned key in any host
    // config, and installs nothing.
    expect(res.persistentComponents).toEqual([])
    // The only durable write is the host config — NO CallLint plugin/guard/hook dir
    // appears in the user's tree (working files lived in an ephemeral scratch dir).
    expect(existsSync(join(dir, ".calllint"))).toBe(false)
    noExec()
  })
})

describe("safe-install — single approval gate (§10.7 never auto-applies)", () => {
  it("interactive: an operator who declines → DECLINED, exit 0, zero writes", async () => {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    // interactive (no --json / --non-interactive), --apply, and stdin says 'no'.
    const r = await runSafeInstall(["--host", "cursor", "--host-config", hostConfig, "--apply"], makeContract(), {
      readStdin: () => "no\n",
    })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("DECLINED")
    // A decline writes nothing.
    expect(existsSync(hostConfig)).toBe(false)
    noExec()
  })

  it("non-interactive --json --apply WITHOUT --approve → usage error (never auto-applies)", async () => {
    const r = await runSafeInstall(["--host", "cursor", "--apply", "--json"], makeContract())
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--approve")
    noExec()
  })

  it("--apply + a WRONG --approve digest is refused by the apply engine → not verified, nothing durable", async () => {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan-out", planFile, "--json"],
      makeContract(),
    )
    const r = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", SHA("0"), "--json"],
      makeContract(),
    )
    // The apply engine fails closed on a non-matching approval; the orchestrator
    // degrades to a fail-closed preflight and writes nothing durable.
    const res = JSON.parse(r.stdout)
    expect(res.outcome).toBe("LOCAL_PREFLIGHT_REQUIRED")
    expect(res.receiptDigest).toBeNull()
    expect(existsSync(hostConfig)).toBe(false)
    noExec()
  })

  it("the agent handshake survives a MOVING clock — the replayed plan digest still applies", async () => {
    // The defect Gate 2.4-G caught: two invocations are two processes with two
    // clocks. `expiresAt` is sealed into planDigest, so recomputing on the apply
    // step yielded a different digest and the approval could never match. Replaying
    // the reviewed plan inherits its anchor, so the digest reproduces.
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    const prepared = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan-out", planFile, "--json"],
      makeContract(),
      { generatedAt: "2026-07-13T00:00:00.000Z" },
    )
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    // 11 minutes later, in a different process.
    const applied = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", planDigest, "--json"],
      makeContract(),
      { generatedAt: "2026-07-13T00:11:00.000Z" },
    )
    const res = JSON.parse(applied.stdout)
    expect(res.outcome).toBe("APPLIED_AND_VERIFIED")
    expect(res.planDigest).toBe(planDigest)
    expect(res.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(existsSync(hostConfig)).toBe(true)
    noExec()
  })

  it("a plan replayed AFTER its validity window is refused as stale — nothing durable", async () => {
    // Inheriting the anchor does not disable expiry: the shipped apply engine still
    // enforces the window against real `now`, so an old plan cannot be replayed
    // indefinitely.
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    const prepared = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan-out", planFile, "--json"],
      makeContract(),
      { generatedAt: "2026-07-13T00:00:00.000Z" },
    )
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    // Well past the one-hour window.
    const applied = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", planDigest, "--json"],
      makeContract(),
      { generatedAt: "2026-07-14T00:00:00.000Z" },
    )
    const res = JSON.parse(applied.stdout)
    expect(res.outcome).not.toBe("APPLIED_AND_VERIFIED")
    expect(res.receiptDigest).toBeNull()
    expect(existsSync(hostConfig)).toBe(false)
    noExec()
  })

  it("a TAMPERED replayed plan aborts on mismatch — drift is never applied", async () => {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    const prepared = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan-out", planFile, "--json"],
      makeContract(),
    )
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    // Re-seal the plan under a DIFFERENT window: the digest no longer reproduces.
    const plan = JSON.parse(readFileSync(planFile, "utf8"))
    plan.expiresAt = "2026-07-13T05:00:00.000Z"
    writeFileSync(planFile, JSON.stringify(plan))
    const applied = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", planDigest, "--json"],
      makeContract(),
    )
    const res = JSON.parse(applied.stdout)
    expect(res.outcome).toBe("ABORTED_ON_MISMATCH")
    expect(res.receiptDigest).toBeNull()
    expect(existsSync(hostConfig)).toBe(false)
    noExec()
  })

  it("--plan-out writes ONLY where asked — no .calllint/ workspace footprint (INV-2.4-07)", async () => {
    // The shipped `trust`/`integrate` convention is a boolean --write-plan that
    // persists into the workspace. safe-install must not: one-time mode leaves ZERO
    // workspace files, so the destination is caller-chosen and explicit.
    const planFile = join(dir, "out", "plan.json")
    const r = await runSafeInstall(
      ["--host", "cursor", "--host-config", join(dir, ".cursor", "mcp.json"), "--plan-out", planFile, "--json"],
      makeContract(),
    )
    expect(JSON.parse(r.stdout).outcome).toBe("PREPARED")
    expect(existsSync(planFile)).toBe(true)
    expect(existsSync(join(dir, ".calllint"))).toBe(false)
    expect(JSON.parse(r.stdout).persistentComponents).toEqual([])
    noExec()
  })

  it("replaying an already-applied plan aborts and says the DECISION is unchanged", async () => {
    // A benign retry: the config moved because our own apply succeeded. Still an
    // abort (we never substitute a digest the operator did not name), but the note
    // must point at the host config rather than implying the tool changed.
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    const prepared = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan-out", planFile, "--json"],
      makeContract(),
    )
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    const argv = ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", planDigest, "--json"]
    expect(JSON.parse((await runSafeInstall(argv, makeContract())).stdout).outcome).toBe("APPLIED_AND_VERIFIED")

    const retry = JSON.parse((await runSafeInstall(argv, makeContract())).stdout)
    expect(retry.outcome).toBe("ABORTED_ON_MISMATCH")
    expect(retry.notes.join(" ")).toContain("decision is unchanged")
    expect(retry.notes.join(" ")).toContain("already be installed")
    expect(retry.receiptDigest).toBeNull()
    noExec()
  })

  it("a CONTRACT swapped between review and apply aborts as decision drift — nothing written", async () => {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    const prepared = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan-out", planFile, "--json"],
      makeContract(),
    )
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    // Same host, same flags — but the served contract now describes a different tool.
    const swapped = makeContract({ subject: { canonicalName: "other-tool", packageName: "@acme/other", version: "9.9.9", registry: "npm" } })
    const r = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", planDigest, "--json"],
      swapped,
    )
    const res = JSON.parse(r.stdout)
    expect(res.outcome).toBe("ABORTED_ON_MISMATCH")
    expect(res.notes.join(" ")).toContain("decision-relevant input changed")
    expect(res.receiptDigest).toBeNull()
    expect(existsSync(hostConfig)).toBe(false)
    noExec()
  })

  it("a malformed --plan file is an honest usage error, never a fresh-anchor fallback", async () => {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    writeFileSync(planFile, "{ not a plan }")
    const r = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", SHA("0"), "--json"],
      makeContract(),
    )
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--plan")
    expect(existsSync(hostConfig)).toBe(false)

    const missing = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", join(dir, "nope.json"), "--apply", "--approve", SHA("0"), "--json"],
      makeContract(),
    )
    expect(missing.exitCode).toBe(2)
    expect(missing.stderr).toContain("not found")
    noExec()
  })

  it("non-interactive --apply WITHOUT --plan is refused, naming the cause and the working route", async () => {
    // Regression guard for the defect Gate 2.4-G caught: `--approve <digest>` alone
    // can never match, because the digest seals the plan's validity window. Refuse
    // with an honest usage error rather than a confusing digest mismatch.
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const r = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--apply", "--approve", SHA("0"), "--json"],
      makeContract(),
    )
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--plan <file>")
    expect(r.stderr).toContain("--plan-out")
    expect(existsSync(hostConfig)).toBe(false)
    noExec()
  })
})

describe("safe-install — outcome projection is total + fail-closed (unit)", () => {
  it("mapPrepareToOutcome never launders a BLOCK/UNKNOWN local decision into PREPARED", () => {
    const block = { state: "PLAN_READY", decision: { verdict: "BLOCK" }, plan: {} } as never
    const unknown = { state: "POLICY_UNKNOWN", decision: { verdict: "UNKNOWN" } } as never
    const safe = { state: "PLAN_READY", decision: { verdict: "SAFE" }, plan: {} } as never
    const mismatch = { state: "TARGET_MISMATCH", decision: null } as never
    expect(mapPrepareToOutcome(block)).toBe("BLOCKED")
    expect(mapPrepareToOutcome(unknown)).toBe("LOCAL_PREFLIGHT_REQUIRED")
    expect(mapPrepareToOutcome(safe)).toBe("PREPARED")
    expect(mapPrepareToOutcome(mismatch)).toBe("ABORTED_ON_MISMATCH")
  })

  it("mapAppliedToOutcome requires BOTH a durable apply AND a valid receipt", () => {
    const applied = { outcome: "applied" } as never
    const conflict = { outcome: "conflict" } as never
    expect(mapAppliedToOutcome(applied, true)).toBe("APPLIED_AND_VERIFIED")
    expect(mapAppliedToOutcome(applied, false)).toBe("LOCAL_PREFLIGHT_REQUIRED") // receipt unverified → fail-closed
    expect(mapAppliedToOutcome(conflict, true)).toBe("LOCAL_PREFLIGHT_REQUIRED") // not durable → fail-closed
  })

  it("exit codes: clean terminals 0, BLOCK 30, every fail-closed terminal 20", () => {
    expect(outcomeExitCode("APPLIED_AND_VERIFIED")).toBe(0)
    expect(outcomeExitCode("PREPARED")).toBe(0)
    expect(outcomeExitCode("DECLINED")).toBe(0)
    expect(outcomeExitCode("BLOCKED")).toBe(30)
    expect(outcomeExitCode("ABORTED_ON_MISMATCH")).toBe(20)
    expect(outcomeExitCode("LOCAL_PREFLIGHT_REQUIRED")).toBe(20)
    expect(outcomeExitCode("UNSUPPORTED")).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Batch 8 — the post-success continuous-protection offer (INV-2.4-07).
// "Value first, commitment second": the offer appears only after a durably
// verified one-time install, discloses every persistent component with its
// removal command, always shows [Not now], and installs nothing itself.
// ---------------------------------------------------------------------------
describe("safe-install — continuous-protection conversion (INV-2.4-07)", () => {
  async function applyInteractive(): Promise<{ stdout: string; exitCode: number }> {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const prepared = await runSafeInstall(["--host", "cursor", "--host-config", hostConfig, "--json"], makeContract())
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    const r = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--apply", "--approve", planDigest],
      makeContract(),
    )
    return { stdout: r.stdout, exitCode: r.exitCode }
  }

  it("offers the conversion after a verified install, with both choices visible", async () => {
    const r = await applyInteractive()
    expect(r.stdout).toContain("APPLIED_AND_VERIFIED")
    expect(r.stdout).toContain("Protect future agent-tool changes")
    expect(r.stdout).toContain("[Enable continuous protection]")
    expect(r.stdout).toContain("[Not now]")
    noExec()
  })

  it("enumerates each persistent component with its removal command BEFORE the enable command", async () => {
    const r = await applyInteractive()
    expect(r.stdout).toContain("calllint-guard:git")
    expect(r.stdout).toContain("rm .git/hooks/pre-commit")
    expect(r.stdout).toContain("calllint guard install --host git")
    expect(r.stdout.indexOf("remove:")).toBeLessThan(r.stdout.indexOf("enable:"))
    expect(r.stdout).toContain("disclosure: sha256:")
    noExec()
  })

  it("the offer itself installs nothing — zero persistent CallLint files appear", async () => {
    await applyInteractive()
    expect(existsSync(join(dir, ".calllint"))).toBe(false)
    expect(existsSync(join(dir, ".git", "hooks", "pre-commit"))).toBe(false)
    expect(existsSync(join(dir, ".github"))).toBe(false)
    noExec()
  })
})

describe("safe-install — the offer is never shown where it would be dishonest", () => {
  it("--json emits ONLY the envelope; the offer never leaks into machine output", async () => {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const planFile = join(dir, "plan.json")
    const prepared = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan-out", planFile, "--json"],
      makeContract(),
    )
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    const applied = await runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--plan", planFile, "--apply", "--approve", planDigest, "--json"],
      makeContract(),
    )
    const res = JSON.parse(applied.stdout) // still parses cleanly
    expect(res.outcome).toBe("APPLIED_AND_VERIFIED")
    expect(applied.stdout).not.toContain("[Not now]")
    // The envelope is unchanged: one-time mode still reports zero components.
    expect(res.persistentComponents).toEqual([])
    expect(res.mode).toBe("ONE_TIME_PROTECTED_SETUP")
  })

  it("no offer on a prepare-only run — there is no success to convert yet", async () => {
    const r = await runSafeInstall(["--host", "cursor"], makeContract())
    expect(r.stdout).toContain("PREPARED")
    expect(r.stdout).not.toContain("[Not now]")
    noExec()
  })

  it("no offer when the operator declined the install", async () => {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const r = await runSafeInstall(["--host", "cursor", "--host-config", hostConfig, "--apply"], makeContract(), {
      readStdin: () => "no\n",
    })
    expect(r.stdout).toContain("DECLINED")
    expect(r.stdout).not.toContain("[Not now]")
    noExec()
  })

  it("does not re-offer when guard is already installed for the host", async () => {
    // Seed a git pre-commit hook that carries our marker.
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true })
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\nnpx -y calllint guard --no-emoji\n")
    const r = await applyOnce()
    expect(r.stdout).toContain("APPLIED_AND_VERIFIED")
    expect(r.stdout).toContain("already enabled")
    expect(r.stdout).not.toContain("[Enable continuous protection]")
    noExec()
  })

  async function applyOnce(): Promise<{ stdout: string }> {
    const hostConfig = join(dir, ".cursor", "mcp.json")
    const prepared = await runSafeInstall(["--host", "cursor", "--host-config", hostConfig, "--json"], makeContract())
    const planDigest: string = JSON.parse(prepared.stdout).planDigest
    return runSafeInstall(
      ["--host", "cursor", "--host-config", hostConfig, "--apply", "--approve", planDigest],
      makeContract(),
    )
  }
})
