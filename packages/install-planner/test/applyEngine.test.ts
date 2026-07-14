import { describe, it, expect } from "vitest"
import { hashJson } from "@calllint/fingerprint"
import { applyPlan, buildInstallPlan, type ConfigFs } from "../src/index.js"
import type { InstallPlan, PlanContext, PlanUpstream } from "../src/index.js"
import type { AuthorityManifest, TrustDecision } from "@calllint/types"

/**
 * Locks the G6 apply engine (ADR 0036 §G.3 apply-half, ADR 0037). The engine is
 * the ONLY writer; these tests prove it fails closed at every guard and never
 * leaves a partial write:
 *  - clean apply writes atomically + verifies + backs up
 *  - re-apply is a no-op (already_applied) — no double write
 *  - approval mismatch / tamper / expiry / wrong tier → PLAN_STALE (no write)
 *  - target drift → APPLY_CONFLICT (no write)
 *  - lock held → APPLY_CONFLICT
 *  - verify failure → rollback restores the original digest
 *  - property: plan change ⇒ digest change (covered in buildPlan); here: repeat
 *    apply ⇒ no double write, rollback restores original.
 */

const NOW = "2026-07-13T00:00:00.000Z"
const FUTURE = "2026-07-13T00:30:00.000Z" // within the 1h window
const authority = { digest: "sha256:" + "c".repeat(64) } as AuthorityManifest
const decision = { digest: "sha256:" + "d".repeat(64), policyDigest: "sha256:" + "e".repeat(64), verdict: "SAFE" } as TrustDecision
const upstream: PlanUpstream = { artifactDigest: "sha256:" + "a".repeat(64), authority, decision }

/** In-memory ConfigFs with a recording of every write, for double-write checks. */
function memFs(seed: Record<string, string> = {}): ConfigFs & { store: Map<string, string>; writes: string[] } {
  const store = new Map(Object.entries(seed))
  const writes: string[] = []
  return {
    store,
    writes,
    exists: (p) => store.has(p),
    readFile: (p) => {
      const v = store.get(p)
      if (v === undefined) throw new Error("ENOENT: " + p)
      return v
    },
    writeFile: (p, data) => {
      store.set(p, data)
      writes.push(p)
    },
    fsync: () => {},
    rename: (from, to) => {
      const v = store.get(from)
      if (v === undefined) throw new Error("ENOENT rename: " + from)
      store.set(to, v)
      store.delete(from)
    },
    remove: (p) => void store.delete(p),
    ensureDir: () => {},
    acquireLock: (p) => {
      if (store.has(p)) return false
      store.set(p, "lock")
      return true
    },
  }
}

const CFG = "/home/u/.claude.json"
const BACKUP = CFG + ".calllint-backup-clrec_test"
const LOCK = "/repo/.calllint/locks/abc.lock"

/** Build a plan whose preconditionDigest matches the given seed bytes. */
function planFor(bytes: string | null, over: Partial<PlanContext> = {}): InstallPlan {
  const currentConfig = bytes === null ? null : JSON.parse(bytes)
  const configDigest = bytes === null ? "absent" : (hashJson(bytes) as `sha256:${string}`)
  const ctx: PlanContext = {
    host: "claude-code",
    tier: "A",
    configPath: CFG,
    configDigest,
    currentConfig,
    servers: [{ name: "demo", entry: { command: "node", args: ["s.js"] } }],
    backupPath: BACKUP,
    expiresAt: "2026-07-13T01:00:00.000Z",
    ...over,
  }
  return buildInstallPlan(ctx, upstream)
}

function opts(plan: InstallPlan, fs: ConfigFs, over: Partial<Parameters<typeof applyPlan>[0]> = {}) {
  return { plan, approvalDigest: plan.planDigest, configPath: CFG, backupPath: BACKUP, lockPath: LOCK, fs, now: FUTURE, ...over }
}

describe("applyPlan — clean apply", () => {
  it("writes atomically, verifies, backs up, and reports applied", () => {
    const bytes = JSON.stringify({ mcpServers: {} }, null, 2) + "\n"
    const plan = planFor(bytes)
    const fs = memFs({ [CFG]: bytes })
    const r = applyPlan(opts(plan, fs))
    expect(r.outcome).toBe("applied")
    expect(r.state).toBe("VERIFIED")
    expect(r.backupPath).toBe(BACKUP)
    expect(fs.store.get(BACKUP)).toBe(bytes) // original preserved
    const written = JSON.parse(fs.store.get(CFG)!)
    expect(written.mcpServers.demo).toEqual({ command: "node", args: ["s.js"] })
    expect(r.configDigestAfter).toBe(hashJson(fs.store.get(CFG)!))
    expect(fs.store.has(LOCK)).toBe(false) // lock released
  })

  it("creates the file when the target is absent (precondition 'absent')", () => {
    const plan = planFor(null)
    const fs = memFs() // no config on disk
    const r = applyPlan(opts(plan, fs))
    expect(r.outcome).toBe("applied")
    expect(r.configDigestBefore).toBe("absent")
    expect(JSON.parse(fs.store.get(CFG)!).mcpServers.demo).toBeDefined()
    expect(fs.store.has(BACKUP)).toBe(false) // nothing to back up
  })

  it("preserves the original indent + trailing newline (no churn)", () => {
    const bytes = JSON.stringify({ mcpServers: {} }, null, 4) + "\n" // 4-space indent
    const plan = planFor(bytes)
    const fs = memFs({ [CFG]: bytes })
    applyPlan(opts(plan, fs))
    const out = fs.store.get(CFG)!
    expect(out).toContain('\n    "mcpServers"') // 4-space preserved
    expect(out.endsWith("\n")).toBe(true)
  })
})

describe("applyPlan — idempotency", () => {
  it("re-applying the same plan is a no-op (already_applied, no double write)", () => {
    const bytes = JSON.stringify({ mcpServers: {} }, null, 2) + "\n"
    const plan = planFor(bytes)
    const fs = memFs({ [CFG]: bytes })
    const first = applyPlan(opts(plan, fs))
    expect(first.outcome).toBe("applied")
    const appliedBytes = fs.store.get(CFG)!
    fs.writes.length = 0 // reset the write log

    // Re-apply the SAME plan against the now-installed config. Precondition no
    // longer matches (config changed), but the effect is already present.
    const r2 = applyPlan(opts(plan, fs))
    expect(r2.outcome).toBe("already_applied")
    expect(r2.state).toBe("VERIFIED")
    expect(fs.store.get(CFG)).toBe(appliedBytes) // byte-identical, untouched
    expect(fs.writes.filter((p) => p === CFG)).toHaveLength(0) // NO second write
  })
})

describe("applyPlan — fail-closed guards (no write)", () => {
  const bytes = JSON.stringify({ mcpServers: {} }, null, 2) + "\n"

  it("rejects an approval digest that does not match the plan (PLAN_STALE)", () => {
    const plan = planFor(bytes)
    const fs = memFs({ [CFG]: bytes })
    const r = applyPlan(opts(plan, fs, { approvalDigest: "sha256:" + "0".repeat(64) }))
    expect(r.outcome).toBe("stale")
    expect(r.state).toBe("PLAN_STALE")
    expect(fs.writes).toHaveLength(0)
  })

  it("rejects a tampered plan (digest no longer seals contents)", () => {
    const plan = { ...planFor(bytes) }
    plan.expiresAt = "2099-01-01T00:00:00.000Z" // mutate a sealed field
    const fs = memFs({ [CFG]: bytes })
    const r = applyPlan(opts(plan, fs, { approvalDigest: plan.planDigest }))
    expect(r.outcome).toBe("stale")
    expect(fs.writes).toHaveLength(0)
  })

  it("rejects an expired plan", () => {
    const plan = planFor(bytes, { expiresAt: "2020-01-01T00:00:00.000Z" })
    const fs = memFs({ [CFG]: bytes })
    const r = applyPlan(opts(plan, fs))
    expect(r.outcome).toBe("stale")
    expect(r.notes.join(" ")).toContain("expired")
    expect(fs.writes).toHaveLength(0)
  })

  it("refuses a non-Tier-A plan even if otherwise valid", () => {
    const plan = planFor(bytes, { tier: "B" })
    const fs = memFs({ [CFG]: bytes })
    const r = applyPlan(opts(plan, fs))
    expect(r.outcome).toBe("stale")
    expect(r.notes.join(" ")).toContain("tier B")
    expect(fs.writes).toHaveLength(0)
  })

  it("rejects a target that drifted since planning (APPLY_CONFLICT, never auto-merge)", () => {
    const plan = planFor(bytes)
    // The config on disk is DIFFERENT from what the plan was built against, and
    // the plan's effect is not already present → genuine conflict.
    const drifted = JSON.stringify({ mcpServers: { other: { command: "x" } }, extra: true }, null, 2) + "\n"
    const fs = memFs({ [CFG]: drifted })
    const r = applyPlan(opts(plan, fs))
    expect(r.outcome).toBe("conflict")
    expect(r.state).toBe("APPLY_CONFLICT")
    expect(fs.writes).toHaveLength(0)
  })

  it("refuses to overwrite a config that is not valid JSON", () => {
    const plan = planFor(bytes)
    const fs = memFs({ [CFG]: "{ not json" })
    const r = applyPlan(opts(plan, fs))
    expect(r.outcome).toBe("conflict")
    expect(fs.writes).toHaveLength(0)
  })

  it("reports APPLY_CONFLICT when the config lock is held", () => {
    const plan = planFor(bytes)
    const fs = memFs({ [CFG]: bytes, [LOCK]: "held" })
    const r = applyPlan(opts(plan, fs))
    expect(r.outcome).toBe("conflict")
    expect(r.notes.join(" ")).toContain("lock")
    expect(fs.writes).toHaveLength(0)
  })
})

describe("applyPlan — roundtrip property (apply then rollback = original)", () => {
  // The plan carries typed inverse ops; applying forward then inverse must land
  // back on the exact original config. Checked across generated shapes.
  it("forward patch + plan rollback restores the original config, semantically", async () => {
    const { applyJsonPatch } = await import("../src/jsonPatch.js")
    const cases: unknown[] = [
      { mcpServers: {} },
      { mcpServers: { demo: { command: "old", args: [] } } }, // demo replaced
      { mcpServers: { keep: { url: "https://k" } } }, // demo added alongside
      { mcpServers: {}, otherKey: 1, nested: { a: [1, 2] } }, // unrelated keys survive
      {}, // no mcpServers container at all
    ]
    for (const original of cases) {
      const bytes = JSON.stringify(original, null, 2) + "\n"
      const plan = planFor(bytes)
      const forward = plan.operations[0]!.patch
      const rolled = plan.rollback[0]?.patch ?? []
      const afterApply = applyJsonPatch(original, forward)
      const afterRollback = applyJsonPatch(afterApply, rolled)
      expect(hashJson(afterRollback)).toBe(hashJson(original))
    }
  })
})

describe("applyPlan — rollback on verify failure", () => {
  it("restores the original bytes (digest match) when verify fails", () => {
    const bytes = JSON.stringify({ mcpServers: {} }, null, 2) + "\n"
    const plan = planFor(bytes)
    const base = memFs({ [CFG]: bytes })
    // Wrap the port so the post-write re-read returns corrupted bytes → verify
    // must fail and trigger rollback to the original.
    let commits = 0
    let corrupt = false
    const fs: ConfigFs = {
      ...base,
      writeFile: (p, d) => base.writeFile(p, d),
      rename: (from, to) => {
        base.rename(from, to)
        if (to === CFG && commits++ === 0) corrupt = true // ONLY the first commit
      },
      readFile: (p) => {
        if (p === CFG && corrupt) {
          corrupt = false
          return "{ corrupted after write" // the verify read sees garbage
        }
        return base.readFile(p)
      },
    }
    const r = applyPlan(opts(plan, fs))
    expect(r.outcome).toBe("rolled_back")
    expect(r.state).toBe("VERIFICATION_FAILED")
    expect(r.rolledBack).toBe(true)
    expect(base.store.get(CFG)).toBe(bytes) // original restored byte-for-byte
    expect(hashJson(base.store.get(CFG)!)).toBe(r.configDigestBefore)
  })
})
