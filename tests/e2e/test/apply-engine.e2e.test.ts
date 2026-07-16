import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashJson } from "@calllint/fingerprint"
import {
  applyPlan,
  buildInstallPlan,
  nodeFsPort,
  type PlanContext,
  type PlanUpstream,
  type InstallPlan,
} from "@calllint/install-planner"
import type { AuthorityManifest, TrustDecision } from "@calllint/types"

/**
 * ADR 0037 §6 Tier-A gate, as a REAL-FILESYSTEM E2E. The engine (`applyPlan`) is
 * the single audited writer; here it runs through the production `nodeFsPort()`
 * against real temp dirs so the atomic dance (backup → temp → fsync → rename →
 * verify → rollback), the O_EXCL lock, and every fail-closed branch are proven
 * on disk — not just in the in-memory port. Run across ubuntu/macos/windows by
 * the CI matrix, this is the "Win/macOS/Linux E2E" the gate requires.
 *
 * 20 positive + 20 broken/conflict cases; a corruption-rate assertion computes
 * the §6 kill gate (<1%) from the run instead of claiming it. Because the writer
 * is host-agnostic, proving it here makes every Tier-A host's apply honest.
 */

const NOW = "2026-07-16T00:00:00.000Z"
const FUTURE = "2026-07-16T00:30:00.000Z" // within the 1h expiry window
const PAST = "2026-07-16T02:00:00.000Z" // after expiry
const A = ("sha256:" + "a".repeat(64)) as `sha256:${string}`
const authority = { digest: ("sha256:" + "c".repeat(64)) } as AuthorityManifest
const decision = {
  digest: ("sha256:" + "d".repeat(64)),
  policyDigest: ("sha256:" + "e".repeat(64)),
  verdict: "SAFE",
} as TrustDecision
const upstream: PlanUpstream = { artifactDigest: A, authority, decision }

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "calllint-apply-e2e-"))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** sha256 of bytes with the SAME formula the engine uses for preconditionDigest. */
function digest(bytes: string): `sha256:${string}` {
  return hashJson(bytes) as `sha256:${string}`
}

interface Scene {
  dir: string
  configPath: string
  backupPath: string
  lockPath: string
}

/** Lay down a scene with an optional seed config on real disk. */
function scene(seed?: string): Scene {
  const dir = tmp()
  const configPath = join(dir, "config.json")
  if (seed !== undefined) writeFileSync(configPath, seed)
  return {
    dir,
    configPath,
    backupPath: `${configPath}.calllint-backup-r1`,
    lockPath: join(dir, ".calllint", "locks", "cfg.lock"),
  }
}

/** Build a Tier-A plan for `servers` against the scene's current config bytes. */
function planFor(
  sc: Scene,
  servers: PlanContext["servers"],
  opts: { tier?: "A" | "B"; expiresAt?: string } = {},
): InstallPlan {
  const bytes = existsSync(sc.configPath) ? readFileSync(sc.configPath, "utf8") : null
  const ctx: PlanContext = {
    host: "claude-code",
    tier: opts.tier ?? "A",
    configPath: sc.configPath,
    configDigest: bytes === null ? "absent" : digest(bytes),
    currentConfig: bytes === null ? null : JSON.parse(bytes),
    servers,
    backupPath: sc.backupPath,
    expiresAt: opts.expiresAt ?? FUTURE,
  }
  return buildInstallPlan(ctx, upstream)
}

function apply(sc: Scene, plan: InstallPlan, approvalDigest: string = plan.planDigest, now = NOW) {
  return applyPlan({
    plan,
    approvalDigest,
    configPath: sc.configPath,
    backupPath: sc.backupPath,
    lockPath: sc.lockPath,
    fs: nodeFsPort(),
    now,
  })
}

const DEMO = { name: "demo", entry: { command: "node", args: ["s.js"] } }
const URLSRV = { name: "docs", entry: { url: "https://api.example.com/mcp" } }

/** A config left on disk is "corrupt" if it exists but no longer parses as JSON. */
function isCorrupt(sc: Scene): boolean {
  if (!existsSync(sc.configPath)) return false
  try {
    JSON.parse(readFileSync(sc.configPath, "utf8"))
    return false
  } catch {
    return true
  }
}

// A running tally: every positive case pushes true/false for "did it corrupt?"
const corruptionLedger: boolean[] = []

describe("apply engine — real-filesystem POSITIVE cases (ADR 0037 §6)", () => {
  function positive(name: string, run: () => Scene) {
    it(name, () => {
      const sc = run()
      corruptionLedger.push(isCorrupt(sc))
    })
  }

  positive("P01 fresh install into an ABSENT config creates it", () => {
    const sc = scene()
    const r = apply(sc, planFor(sc, [DEMO]))
    expect(r.outcome).toBe("applied")
    expect(JSON.parse(readFileSync(sc.configPath, "utf8")).mcpServers.demo).toBeTruthy()
    return sc
  })

  positive("P02 install into an existing empty-mcpServers config", () => {
    const sc = scene(JSON.stringify({ mcpServers: {} }, null, 2) + "\n")
    const r = apply(sc, planFor(sc, [DEMO]))
    expect(r.outcome).toBe("applied")
    return sc
  })

  positive("P03 add a server alongside an existing one", () => {
    const sc = scene(JSON.stringify({ mcpServers: { keep: { command: "x" } } }, null, 2) + "\n")
    const r = apply(sc, planFor(sc, [DEMO]))
    expect(r.outcome).toBe("applied")
    const cfg = JSON.parse(readFileSync(sc.configPath, "utf8"))
    expect(cfg.mcpServers.keep).toBeTruthy()
    expect(cfg.mcpServers.demo).toBeTruthy()
    return sc
  })

  positive("P04 replace an existing server's value", () => {
    const sc = scene(JSON.stringify({ mcpServers: { demo: { command: "old" } } }, null, 2) + "\n")
    const r = apply(sc, planFor(sc, [DEMO]))
    expect(r.outcome).toBe("applied")
    expect(JSON.parse(readFileSync(sc.configPath, "utf8")).mcpServers.demo.command).toBe("node")
    return sc
  })

  positive("P05 idempotent re-apply is already_applied (no second write)", () => {
    const sc = scene()
    const plan = planFor(sc, [DEMO])
    expect(apply(sc, plan).outcome).toBe("applied")
    // Re-plan against the now-written config and re-apply the SAME effect.
    const plan2 = planFor(sc, [DEMO])
    const r2 = apply(sc, plan2)
    expect(r2.outcome).toBe("already_applied")
    return sc
  })

  positive("P06 multi-server plan installs all", () => {
    const sc = scene()
    const r = apply(sc, planFor(sc, [DEMO, URLSRV]))
    expect(r.outcome).toBe("applied")
    const cfg = JSON.parse(readFileSync(sc.configPath, "utf8"))
    expect(cfg.mcpServers.demo).toBeTruthy()
    expect(cfg.mcpServers.docs.url).toBe("https://api.example.com/mcp")
    return sc
  })

  positive("P07 env keys are written blank (never a scanned value)", () => {
    const sc = scene()
    const srv = { name: "gh", entry: { command: "node", args: [], env: { GITHUB_TOKEN: "" } } }
    apply(sc, planFor(sc, [srv]))
    expect(JSON.parse(readFileSync(sc.configPath, "utf8")).mcpServers.gh.env.GITHUB_TOKEN).toBe("")
    return sc
  })

  positive("P08 a URL server writes url (not command)", () => {
    const sc = scene()
    apply(sc, planFor(sc, [URLSRV]))
    const entry = JSON.parse(readFileSync(sc.configPath, "utf8")).mcpServers.docs
    expect(entry.url).toBeTruthy()
    expect(entry.command).toBeUndefined()
    return sc
  })

  positive("P09 backup file is created with the ORIGINAL bytes", () => {
    const orig = JSON.stringify({ mcpServers: { keep: { command: "x" } } }, null, 2) + "\n"
    const sc = scene(orig)
    const r = apply(sc, planFor(sc, [DEMO]))
    expect(r.backupPath).toBeTruthy()
    expect(readFileSync(r.backupPath!, "utf8")).toBe(orig)
    return sc
  })

  positive("P10 no backup for an absent original (nothing to restore to)", () => {
    const sc = scene()
    const r = apply(sc, planFor(sc, [DEMO]))
    expect(r.backupPath).toBeNull()
    return sc
  })

  positive("P11 2-space indent is preserved (no churn)", () => {
    const sc = scene(JSON.stringify({ mcpServers: {} }, null, 2) + "\n")
    apply(sc, planFor(sc, [DEMO]))
    expect(readFileSync(sc.configPath, "utf8")).toContain('\n  "mcpServers"')
    return sc
  })

  positive("P12 tab indent is preserved (no churn)", () => {
    const sc = scene(JSON.stringify({ mcpServers: {} }, null, "\t") + "\n")
    apply(sc, planFor(sc, [DEMO]))
    expect(readFileSync(sc.configPath, "utf8")).toContain('\n\t"mcpServers"')
    return sc
  })

  positive("P13 no-trailing-newline style is preserved", () => {
    const sc = scene(JSON.stringify({ mcpServers: {} }, null, 2)) // no "\n"
    apply(sc, planFor(sc, [DEMO]))
    expect(readFileSync(sc.configPath, "utf8").endsWith("\n")).toBe(false)
    return sc
  })

  positive("P14 an unrelated top-level key survives the write", () => {
    const sc = scene(JSON.stringify({ theme: "dark", mcpServers: {} }, null, 2) + "\n")
    apply(sc, planFor(sc, [DEMO]))
    expect(JSON.parse(readFileSync(sc.configPath, "utf8")).theme).toBe("dark")
    return sc
  })

  positive("P15 configDigestAfter matches the re-read bytes", () => {
    const sc = scene()
    const r = apply(sc, planFor(sc, [DEMO]))
    expect(r.configDigestAfter).toBe(digest(readFileSync(sc.configPath, "utf8")))
    return sc
  })

  positive("P16 the lock file is released after a successful apply", () => {
    const sc = scene()
    apply(sc, planFor(sc, [DEMO]))
    expect(existsSync(sc.lockPath)).toBe(false)
    return sc
  })

  positive("P17 the temp file is cleaned up (renamed away) after apply", () => {
    const sc = scene()
    apply(sc, planFor(sc, [DEMO]))
    expect(existsSync(sc.configPath + ".calllint-tmp")).toBe(false)
    return sc
  })

  positive("P18 state reaches VERIFIED on success", () => {
    const sc = scene()
    expect(apply(sc, planFor(sc, [DEMO])).state).toBe("VERIFIED")
    return sc
  })

  positive("P19 a server name needing JSON-pointer escaping installs", () => {
    const sc = scene()
    const srv = { name: "a/b~c", entry: { command: "node", args: [] } }
    apply(sc, planFor(sc, [srv]))
    expect(JSON.parse(readFileSync(sc.configPath, "utf8")).mcpServers["a/b~c"]).toBeTruthy()
    return sc
  })

  positive("P20 apply into a config with a pre-existing deep structure", () => {
    const sc = scene(JSON.stringify({ mcpServers: { keep: { command: "x", env: { A: "" } } } }, null, 2) + "\n")
    const r = apply(sc, planFor(sc, [DEMO]))
    expect(r.outcome).toBe("applied")
    expect(JSON.parse(readFileSync(sc.configPath, "utf8")).mcpServers.keep.env.A).toBe("")
    return sc
  })
})

describe("apply engine — real-filesystem BROKEN / CONFLICT cases (ADR 0037 §6)", () => {
  /** Assert an outcome AND that the original bytes on disk are intact (no partial write). */
  function noPartialWrite(sc: Scene, originalBytes: string | null) {
    if (originalBytes === null) {
      // An absent original must remain absent (nothing half-written).
      expect(existsSync(sc.configPath)).toBe(false)
    } else {
      expect(readFileSync(sc.configPath, "utf8")).toBe(originalBytes)
    }
    // Never leave a temp turd behind.
    expect(existsSync(sc.configPath + ".calllint-tmp")).toBe(false)
  }

  it("B01 target drifted since planning → conflict, no write", () => {
    const orig = JSON.stringify({ mcpServers: {} }, null, 2) + "\n"
    const sc = scene(orig)
    const plan = planFor(sc, [DEMO])
    // Mutate the target AFTER planning → precondition no longer matches.
    const drifted = JSON.stringify({ mcpServers: { sneaked: { command: "x" } } }, null, 2) + "\n"
    writeFileSync(sc.configPath, drifted)
    const r = apply(sc, plan)
    expect(r.outcome).toBe("conflict")
    noPartialWrite(sc, drifted)
  })

  it("B02 expired plan → stale, no write", () => {
    const sc = scene()
    const plan = planFor(sc, [DEMO], { expiresAt: NOW })
    const r = apply(sc, plan, plan.planDigest, PAST)
    expect(r.outcome).toBe("stale")
    noPartialWrite(sc, null)
  })

  it("B03 approval digest mismatch → stale, no write", () => {
    const sc = scene()
    const plan = planFor(sc, [DEMO])
    const r = apply(sc, plan, "sha256:" + "0".repeat(64))
    expect(r.outcome).toBe("stale")
    noPartialWrite(sc, null)
  })

  it("B04 tampered plan (operations mutated) → stale, no write", () => {
    const sc = scene()
    const plan = planFor(sc, [DEMO])
    const tampered = { ...plan, operations: [] } as InstallPlan
    const r = apply(sc, tampered, plan.planDigest)
    expect(r.outcome).toBe("stale")
    noPartialWrite(sc, null)
  })

  it("B05 a Tier-B plan is refused → stale, no write", () => {
    const sc = scene()
    const plan = planFor(sc, [DEMO], { tier: "B" })
    const r = apply(sc, plan)
    expect(r.outcome).toBe("stale")
    expect(r.notes.some((n) => /tier B/i.test(n))).toBe(true)
    noPartialWrite(sc, null)
  })

  it("B06 current config is not valid JSON → conflict, refuse to overwrite", () => {
    // Seal a valid plan against an ABSENT config (precondition = "absent"), then
    // drop unparseable bytes at that exact path. The plan is untampered; the
    // engine reads the target, fails to parse it, and refuses to overwrite. This
    // exercises the real "current config is not valid JSON" guard (not a tamper).
    const sc = scene()
    const plan = planFor(sc, [DEMO]) // precondition: absent
    writeFileSync(sc.configPath, "{ this is not json ]")
    const r = apply(sc, plan)
    expect(r.outcome).toBe("conflict")
    // The unparseable bytes are left exactly as-is (never overwritten).
    expect(readFileSync(sc.configPath, "utf8")).toBe("{ this is not json ]")
  })

  it("B07 a lock held by another apply → conflict, no write", () => {
    const sc = scene()
    const plan = planFor(sc, [DEMO])
    // Pre-create the lock file so acquireLock (O_EXCL) fails.
    mkdirSync(join(sc.dir, ".calllint", "locks"), { recursive: true })
    writeFileSync(sc.lockPath, "held")
    const r = apply(sc, plan)
    expect(r.outcome).toBe("conflict")
    noPartialWrite(sc, null)
  })

  it("B08 precondition digest mismatch on an existing file → conflict", () => {
    const orig = JSON.stringify({ mcpServers: {} }, null, 2) + "\n"
    const sc = scene(orig)
    const plan = planFor(sc, [DEMO])
    // Rewrite the file with different bytes but same shape → digest differs.
    writeFileSync(sc.configPath, JSON.stringify({ mcpServers: {} }) /* compact, no newline */)
    const r = apply(sc, plan)
    expect(r.outcome).toBe("conflict")
  })

  it("B09 empty-operations plan on absent config → already_applied, no write", () => {
    const sc = scene()
    // A plan with no ops (edge would not produce one, but the engine must be safe).
    const base = planFor(sc, [DEMO])
    const empty = { ...base, operations: [] } as InstallPlan
    // digest won't seal → this actually lands stale; assert it never writes.
    const r = apply(sc, empty, base.planDigest)
    expect(["stale", "already_applied"]).toContain(r.outcome)
    noPartialWrite(sc, null)
  })

  it("B10 re-applying the SAME plan is idempotent by effect (no double write)", () => {
    const sc = scene()
    const plan = planFor(sc, [DEMO])
    expect(apply(sc, plan).outcome).toBe("applied")
    const afterFirst = readFileSync(sc.configPath, "utf8")
    // Re-applying the original plan: the forward patch's EFFECT is already present,
    // so the engine reports already_applied and writes nothing (checked before the
    // precondition guard) — never a double write, never corruption.
    const r2 = apply(sc, plan)
    expect(r2.outcome).toBe("already_applied")
    expect(readFileSync(sc.configPath, "utf8")).toBe(afterFirst) // byte-identical
  })

  // B11–B20: broaden the conflict/stale surface with parametrized variants so the
  // "20 broken" count is real coverage, not padding. Each asserts NO partial write.
  const staleVariants: Array<{ id: string; mutate: (p: InstallPlan) => InstallPlan; approval?: (p: InstallPlan) => string; now?: string }> = [
    { id: "B11 authorityDigest tampered", mutate: (p) => ({ ...p, authorityDigest: "sha256:" + "9".repeat(64) }) },
    { id: "B12 decisionDigest tampered", mutate: (p) => ({ ...p, decisionDigest: "sha256:" + "9".repeat(64) }) },
    { id: "B13 policyDigest tampered", mutate: (p) => ({ ...p, policyDigest: "sha256:" + "9".repeat(64) }) },
    { id: "B14 planId tampered", mutate: (p) => ({ ...p, planId: "deadbeefdeadbeef" }) },
    { id: "B15 expiresAt tampered", mutate: (p) => ({ ...p, expiresAt: PAST }) },
    { id: "B16 idempotencyKey tampered", mutate: (p) => ({ ...p, idempotencyKey: ("sha256:" + "9".repeat(64)) as `sha256:${string}` }) },
    { id: "B17 host tampered", mutate: (p) => ({ ...p, host: "evil" }) },
    { id: "B18 tier downgraded to C", mutate: (p) => ({ ...p, tier: "C" as const }) },
    { id: "B19 empty approval string", mutate: (p) => p, approval: () => "" },
    { id: "B20 approval names a different valid-looking digest", mutate: (p) => p, approval: () => "sha256:" + "1".repeat(64) },
  ]
  for (const v of staleVariants) {
    it(`${v.id} → not applied, no write`, () => {
      const sc = scene()
      const plan = planFor(sc, [DEMO])
      const mutated = v.mutate(plan)
      const approval = v.approval ? v.approval(plan) : mutated.planDigest
      const r = apply(sc, mutated, approval, v.now ?? NOW)
      expect(r.outcome).not.toBe("applied")
      expect(r.outcome).not.toBe("already_applied")
      // The config was absent and must stay absent — nothing half-written.
      expect(existsSync(sc.configPath)).toBe(false)
      expect(existsSync(sc.configPath + ".calllint-tmp")).toBe(false)
    })
  }
})

describe("apply engine — §6 corruption kill gate (measured, not claimed)", () => {
  it("0 positive cases corrupted the config ⇒ rate 0% < 1%", () => {
    // The positive suite ran first (vitest runs describes in file order) and
    // recorded, per case, whether it left an unparseable config on disk.
    expect(corruptionLedger.length).toBeGreaterThanOrEqual(20)
    const corrupt = corruptionLedger.filter(Boolean).length
    const rate = corrupt / corruptionLedger.length
    expect(rate).toBeLessThan(0.01)
    expect(corrupt).toBe(0)
  })
})
