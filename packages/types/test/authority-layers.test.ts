/**
 * Authority Model v2 mapping test (ADR 0005 / new21 Phase B).
 *
 * Pins ADR 0005's layer → realizing-construct table so it cannot drift silently.
 * The direction matters: this asserts **layer → construct**, not capability →
 * layer. Each layer names a shipped vocabulary, or names its own absence; the
 * failure worth catching is a realizing construct being renamed, emptied, or
 * quietly given a second meaning.
 */
import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import {
  AUTHORITY_LAYERS,
  AUTHORITY_LAYER_STATES,
  authorityLayerVerdictFloor,
  AUTHORITY_ACTIONS,
  AUTHORITY_RESOURCES,
  TRUST_SOURCES,
  FP_EFFECTS,
  VERDICTS,
  VERDICT_SEVERITY,
  mostSevereVerdict,
  type AuthorityLayerState,
} from "../src/index.js"

const AUTHORITY_SRC = new URL("../src/authority.ts", import.meta.url)
const TAXONOMY_SRC = new URL("../../agent-triggers/src/taxonomy.ts", import.meta.url)

describe("AUTHORITY_LAYERS — the enum shape", () => {
  it("has exactly 5 members, in the authority-chain order", () => {
    expect([...AUTHORITY_LAYERS]).toEqual([
      "identity",
      "entrypoint",
      "execution",
      "tool",
      "effect",
    ])
  })

  it("is a closed vocabulary with no duplicates", () => {
    expect(new Set(AUTHORITY_LAYERS).size).toBe(AUTHORITY_LAYERS.length)
  })
})

describe("layer → realizing construct (ADR 0005's table)", () => {
  it("identity ⇒ TRUST_SOURCES, carrying its fail-safe member", () => {
    expect(TRUST_SOURCES.length).toBeGreaterThan(0)
    // Dropping `unknown` would remove the "absent reads as not trusted" floor (I-04).
    expect(TRUST_SOURCES).toContain("unknown")
  })

  it("execution ⇒ AUTHORITY_RESOURCES covers process, filesystem, configuration", () => {
    for (const r of ["process", "filesystem", "configuration"] as const) {
      expect(AUTHORITY_RESOURCES).toContain(r)
    }
  })

  it("tool ⇒ the action × resource grid is 9 × 10", () => {
    expect(AUTHORITY_ACTIONS.length).toBe(9)
    expect(AUTHORITY_RESOURCES.length).toBe(10)
    const pairs = AUTHORITY_ACTIONS.flatMap((a) => AUTHORITY_RESOURCES.map((r) => `${a}×${r}`))
    expect(pairs.length).toBe(90)
    expect(new Set(pairs).size).toBe(90)
  })

  it("effect ⇒ FP_EFFECTS, the shipped normalization vocabulary", () => {
    // ADR 0005 corrects ADR 0004 here: Effect is NOT absent. FP_EFFECTS normalizes
    // "different tools, same consequence" — new21 §Layer 5's stated purpose —
    // derived from finding symbols in core/extract/fingerprint.ts.
    expect(FP_EFFECTS.length).toBe(9)
    expect(new Set(FP_EFFECTS).size).toBe(FP_EFFECTS.length)
    for (const e of ["network_egress", "payment", "messaging"] as const) {
      expect(FP_EFFECTS).toContain(e)
    }
  })

  it("effect is NOT bound to AuthorityCapability (that binding is ADR-gated)", () => {
    const src = readFileSync(AUTHORITY_SRC, "utf8")
    const iface = src.slice(src.indexOf("export interface AuthorityCapability"))
    const body = iface.slice(0, iface.indexOf("\n}"))
    expect(body).not.toMatch(/^\s*effect\??:/m)
  })
})

describe("entrypoint ⇒ no realizing construct, and it is NOT `trigger`", () => {
  /**
   * The row that earns this test. `@calllint/agent-triggers`' TRIGGER_IDS answer
   * *when should CallLint preflight* (`grant-shell-exec`); new21 Layer 2 answers
   * *what event started the agent* (a GitHub PR, cron). Read from source text
   * because `@calllint/types` must not depend on a package that depends on it.
   */
  const shippedTriggerIds = (): string[] => {
    const src = readFileSync(TAXONOMY_SRC, "utf8")
    const decl = src.slice(src.indexOf("export const TRIGGER_IDS"))
    const body = decl.slice(0, decl.indexOf("] as const"))
    // Strip trailing `// …` comments so quoted tokens inside them are not counted.
    const code = body.replace(/\/\/[^\n]*/g, "")
    return [...code.matchAll(/"([a-z-]+)"/g)].map((m) => m[1] ?? "")
  }

  it("the instrument reads the shipped taxonomy (10 ids, no comment tokens)", () => {
    const ids = shippedTriggerIds()
    expect(ids.length).toBe(10)
    expect(ids).toContain("grant-shell-exec")
    expect(ids).toContain("supply-chain-change")
  })

  it("no authority layer name collides with a shipped trigger id", () => {
    const ids = new Set(shippedTriggerIds())
    for (const layer of AUTHORITY_LAYERS) expect(ids.has(layer)).toBe(false)
  })

  it("the layer is named `entrypoint`; `trigger` is not a layer", () => {
    expect(AUTHORITY_LAYERS).toContain("entrypoint")
    expect(AUTHORITY_LAYERS).not.toContain("trigger")
  })
})

describe("new21 §10.A/§10.B — the overlay changes no verdict semantics", () => {
  it("VERDICTS is still exactly the four; UNSUPPORTED is not a fifth", () => {
    expect([...VERDICTS]).toEqual(["SAFE", "REVIEW", "BLOCK", "UNKNOWN"])
    expect(VERDICTS).not.toContain("UNSUPPORTED")
  })

  it("no layer state smuggles a new verdict in — only `unknown` overlaps, by design", () => {
    const verdicts = new Set<string>(VERDICTS)
    // `unknown` deliberately shares its name with the UNKNOWN verdict: that
    // correspondence IS the floor rule (an unobservable layer reads as UNKNOWN).
    expect(verdicts.has("UNKNOWN")).toBe(true)
    // The others must not be verdicts. `unsupported` becoming one is the §6 risk.
    for (const s of AUTHORITY_LAYER_STATES) {
      if (s === "unknown") continue
      expect(verdicts.has(s.toUpperCase())).toBe(false)
    }
  })
})

describe("new21 §6 / Phase C — unobservable authority must not read as SAFE", () => {
  it("has exactly the three states", () => {
    expect([...AUTHORITY_LAYER_STATES]).toEqual(["observed", "unknown", "unsupported"])
  })

  it("observed contributes no floor; unknown and unsupported floor at UNKNOWN", () => {
    expect(authorityLayerVerdictFloor("observed")).toBe("SAFE")
    expect(authorityLayerVerdictFloor("unknown")).toBe("UNKNOWN")
    expect(authorityLayerVerdictFloor("unsupported")).toBe("UNKNOWN")
  })

  it("the floor rests on VERDICT_SEVERITY's composition, not on a constant", () => {
    // UNKNOWN outranks REVIEW so "insufficient evidence" is not softened into
    // "someone should look at this". This is the property the floor relies on.
    expect(VERDICT_SEVERITY.UNKNOWN).toBeGreaterThan(VERDICT_SEVERITY.REVIEW)
    expect(VERDICT_SEVERITY.UNKNOWN).toBeGreaterThan(VERDICT_SEVERITY.SAFE)
    expect(VERDICT_SEVERITY.BLOCK).toBeGreaterThan(VERDICT_SEVERITY.UNKNOWN)
  })

  it("composing the floor can only raise severity, never lower it", () => {
    expect(mostSevereVerdict(["SAFE", authorityLayerVerdictFloor("unsupported")])).toBe("UNKNOWN")
    // A blocker stays a blocker — the floor never downgrades a verdict.
    expect(mostSevereVerdict(["BLOCK", authorityLayerVerdictFloor("unsupported")])).toBe("BLOCK")
    expect(mostSevereVerdict(["REVIEW", authorityLayerVerdictFloor("observed")])).toBe("REVIEW")
  })
})

describe("new21 §10.D/§10.E — the coverage boundary, stated generically", () => {
  /** §7's cloud wakeups. All four are entrypoint authority we cannot statically see. */
  const CLOUD_WAKEUPS: ReadonlyArray<[string, AuthorityLayerState]> = [
    ["cursor cloud agent subscription", "unsupported"],
    ["github event wakeup", "unsupported"],
    ["slack wakeup", "unsupported"],
    ["platform timer execution", "unsupported"],
  ]

  it("each cloud-managed wakeup maps to entrypoint/unsupported, never SAFE", () => {
    for (const [, state] of CLOUD_WAKEUPS) {
      expect(AUTHORITY_LAYERS).toContain("entrypoint")
      expect(AUTHORITY_LAYER_STATES).toContain(state)
      expect(authorityLayerVerdictFloor(state)).not.toBe("SAFE")
    }
  })

  it("the boundary is a generic rule — no platform name is in the vocabulary", () => {
    // §8 forbids platform-specific authority engines. A future platform maps in by
    // reusing these five layers; it must not need a new member to be describable.
    const vocab = [...AUTHORITY_LAYERS, ...AUTHORITY_LAYER_STATES].join(" ")
    for (const name of ["cursor", "github", "slack", "linear", "claude"]) {
      expect(vocab).not.toContain(name)
    }
  })
})
