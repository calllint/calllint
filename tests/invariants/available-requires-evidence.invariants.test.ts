/**
 * new20 §15 / NC1 — AVAILABLE requires evidence.
 *
 * `AVAILABLE` is the only distribution state that makes a public claim in the present tense:
 * the projections print it as CallLint shipping through that channel today. Every other
 * member of the enum is a statement about work or impossibility (`AUDIT_REQUIRED`,
 * `READY_NOT_SUBMITTED`, `PENDING_UPSTREAM`, `BLOCKED`). So `AVAILABLE` is the one state that
 * must not be assertable for free.
 *
 * It was. Measured 2026-08-23: flipping `cursor`/`cursor-plugin` from `AUDIT_REQUIRED` to
 * `AVAILABLE`, adding nothing else, passed `check:distribution-drift`,
 * `check:agent-surface`, `check:harness-distribution` and `check:published-schema` — all four
 * green. The cause was structural rather than an oversight in any one gate:
 * `definitions.primitive` required only `["kind", "state"]` and no keyword anywhere
 * conditioned an evidence field on the value of `state`.
 *
 * THE RULE HAS TWO ARMS AND THAT IS FORCED BY THE DATA, NOT PREFERRED.
 *   `upstream: "officialMcpRegistry"`  carried by all 17 `mcp-stdio` channels. Its liveness is
 *                                      read back against the live registry API by
 *                                      `scripts/verify-registry-presence.mjs`, which fails
 *                                      closed when the API is unreachable.
 *   `liveUrl`                          the only arm a shelf channel can satisfy: 0 of the 14
 *                                      shelf channels carry `upstream`, by construction.
 * A single-arm rule is either vacuous or wrong. Requiring `liveUrl` universally would have
 * redded the three TRUE `AVAILABLE` records, because no channel in the SSOT carries a non-null
 * `liveUrl` today; requiring `upstream` universally would be unsatisfiable for every shelf.
 *
 * WHY THIS FILE EXISTS ALONGSIDE THE SCHEMA AND THE GATE. Three layers, each catching what
 * the others structurally cannot:
 *   schema (`definitions.primitive.allOf`)  ajv rejects the shape. But it reports a failed
 *                                           `anyOf` as "must match a schema in anyOf" against
 *                                           `/hosts/2/distributionPrimitives/1` — naming
 *                                           neither host, channel, nor missing evidence.
 *   HD-07 in check-harness-distribution     says the sentence out loud, and additionally
 *                                           checks the `liveUrl` points at the channel's own
 *                                           official domain — a cross-field relation no
 *                                           JSON Schema keyword can express.
 *   this file                               the committed positive/negative fixture pair. The
 *                                           controls that proved the hole were ad-hoc shell
 *                                           probes; a probe nobody re-runs is not a guard.
 *                                           CLAUDE.md requires a positive AND negative
 *                                           fixture per rule, and this is that pair, in the
 *                                           repo's established home for SSOT-shape assertions.
 *
 * MUTATION IS IN-MEMORY ONLY — a parsed structuredClone, never a write. The on-disk variant
 * belongs to the shell controls for the same reason recorded at the head of
 * `agent-discovery-v2.invariants.test.ts`: a vitest that mutated the served tree would race
 * the other suites for the same files.
 *
 * ANTI-VACUITY. Every assertion below pins its denominator before its claim. A file that
 * validated an empty cohort, or compiled a schema whose conditional arm had been deleted,
 * would print checkmarks having asserted nothing — the dominant fault class in this repo, and
 * the exact reason the hole above survived four gates.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv, { type ValidateFunction } from "ajv"
import { beforeAll, describe, expect, it } from "vitest"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8"))

const SSOT_PATH = "apps/web/data/distribution-surfaces.json"
const SCHEMA_PATH = "apps/web/data/distribution-surfaces.schema.json"

interface Primitive {
  kind: string
  state: string
  upstream?: string
  liveUrl?: string | null
  officialSource?: string
}
interface Host {
  id: string
  officialSources: string[]
  distributionPrimitives: Primitive[]
}
interface Ssot {
  hosts: Host[]
}

/** A parsed, mutable copy. Never written back to disk. */
const clone = (): Ssot => structuredClone(ssot)

/** Locate a primitive in a cloned SSOT so a test can mutate exactly one channel. */
function primitive(doc: Ssot, hostId: string, kind: string): Primitive {
  const host = doc.hosts.find((h) => h.id === hostId)
  if (!host) throw new Error(`fixture host ${hostId} is gone from the SSOT`)
  const p = host.distributionPrimitives.find((x) => x.kind === kind)
  if (!p) throw new Error(`fixture channel ${hostId}/${kind} is gone from the SSOT`)
  return p
}

let ssot: Ssot
let schema: Record<string, unknown>
let validate: ValidateFunction

beforeAll(() => {
  ssot = readJson(SSOT_PATH)
  schema = readJson(SCHEMA_PATH)
  // `strict: false` because the schema uses draft-07 `format` keywords ajv treats as unknown;
  // the no-op logger suppresses its per-keyword chatter. Same construction the two existing
  // schema gates use, deliberately, so this file cannot pass under laxer settings than they do.
  const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
  validate = ajv.compile(schema)
})

/**
 * `definitions.primitive`, fetched through an explicitly optional chain.
 *
 * The cast used to be `Record<string, Record<string, Record<string, unknown>>>`, which types
 * every level as present and let `.definitions.primitive` typecheck while being a runtime
 * throw if either key were renamed. The point of these two tests is to notice exactly that
 * rename, so the lookup is typed as possibly-absent and asserted instead of assumed.
 */
function primitiveDefinition(): Record<string, unknown> {
  const doc = schema as { definitions?: Record<string, Record<string, unknown> | undefined> }
  const def = doc.definitions?.primitive
  expect(def, "schema.definitions.primitive is gone — every assertion here is moot").toBeDefined()
  return def as Record<string, unknown>
}

describe("new20 §15 — the schema conditions evidence on AVAILABLE", () => {
  it("carries a conditional arm keyed on state === AVAILABLE", () => {
    // The denominator for every negative control below. If this arm is deleted, ajv accepts
    // an unbacked AVAILABLE and each `expect(valid).toBe(false)` would fail for the RIGHT
    // reason — but this assertion names the cause instead of leaving it to be inferred.
    const primitiveDef = primitiveDefinition()
    const allOf = primitiveDef.allOf as
      | Array<{ if?: { properties?: { state?: { const?: string } } }; then?: { anyOf?: unknown[] } }>
      | undefined

    expect(Array.isArray(allOf), "definitions.primitive must carry allOf conditions").toBe(true)
    const availableArm = allOf?.find((c) => c.if?.properties?.state?.const === "AVAILABLE")
    expect(availableArm, "no conditional arm keyed on state === AVAILABLE").toBeDefined()
    const arms = availableArm?.then?.anyOf
    expect(
      Array.isArray(arms) && arms.length === 2,
      "the AVAILABLE arm must offer exactly two evidence alternatives (upstream, liveUrl)",
    ).toBe(true)
  })

  it("still requires kind and state — the new arm did not replace the base contract", () => {
    const primitiveDef = primitiveDefinition()
    expect(primitiveDef.required).toEqual(["kind", "state"])
    expect(primitiveDef.additionalProperties).toBe(false)
  })
})

describe("positive fixture — the shipped SSOT is evidence-complete", () => {
  it("validates against its own schema", () => {
    const valid = validate(ssot)
    expect(
      valid,
      `the shipped SSOT violates its own schema:\n${JSON.stringify(validate.errors, null, 1)}`,
    ).toBe(true)
  })

  it("has a non-empty AVAILABLE cohort, each member carrying an evidence arm", () => {
    const channels = ssot.hosts.flatMap((h) => h.distributionPrimitives)
    // Denominator first: a claim about "every AVAILABLE channel" over an empty cohort is the
    // vacuous pass this repo keeps finding.
    expect(channels.length, "no channels in the SSOT — nothing to audit").toBeGreaterThan(0)

    const available = channels.filter((c) => c.state === "AVAILABLE")
    expect(
      available.length,
      "no AVAILABLE channels — the positive fixture would assert nothing",
    ).toBeGreaterThan(0)

    for (const c of available) {
      const hasUpstream = typeof c.upstream === "string" && c.upstream.length > 0
      const hasLive = typeof c.liveUrl === "string" && c.liveUrl.startsWith("https://")
      expect(hasUpstream || hasLive, `${c.kind} is AVAILABLE with no evidence arm`).toBe(true)
    }
  })

  it("records no liveUrl outside AVAILABLE (pending ≠ LIVE)", () => {
    // Vacuous today by construction: no channel carries a non-null liveUrl. Stated because it
    // constrains the FIRST one written, which is when the constraint starts mattering.
    const leaked = ssot.hosts
      .flatMap((h) => h.distributionPrimitives.map((p) => ({ host: h.id, ...p })))
      .filter((c) => typeof c.liveUrl === "string" && c.liveUrl.length > 0 && c.state !== "AVAILABLE")
    expect(leaked.map((c) => `${c.host}/${c.kind} (${c.state})`)).toEqual([])
  })
})

describe("negative fixture — an unbacked AVAILABLE claim is unrepresentable", () => {
  it("rejects the exact flip that passed all four gates on 2026-08-23", () => {
    const doc = clone()
    primitive(doc, "cursor", "cursor-plugin").state = "AVAILABLE"
    expect(
      validate(doc),
      "cursor/cursor-plugin can be marked AVAILABLE with no evidence — the measured hole is open again",
    ).toBe(false)
  })

  it("rejects the same flip on EVERY shelf channel, not just the one measured", () => {
    // The generalisation is the point: a fixture pinned to `cursor` would pass while any of
    // the other thirteen shelf kinds stayed floppable. Shelf channels are exactly those with
    // no `upstream`, so they have `liveUrl` as their only available arm.
    const shelves = ssot.hosts.flatMap((h) =>
      h.distributionPrimitives.filter((p) => !p.upstream).map((p) => ({ host: h.id, kind: p.kind })),
    )
    expect(shelves.length, "no shelf channels found — this control has no denominator").toBeGreaterThan(0)

    const stillOpen: string[] = []
    for (const s of shelves) {
      const doc = clone()
      const p = primitive(doc, s.host, s.kind)
      if (p.state === "AVAILABLE") continue // already evidence-bearing; not a hole
      p.state = "AVAILABLE"
      if (validate(doc)) stillOpen.push(`${s.host}/${s.kind}`)
    }
    expect(stillOpen, "these shelf channels accept AVAILABLE with no evidence").toEqual([])
  })

  it("rejects a liveUrl recorded under a pending state", () => {
    const doc = clone()
    primitive(doc, "cline", "cline-marketplace-pr").liveUrl = "https://cline.bot/marketplace/calllint"
    expect(
      validate(doc),
      "a channel can name where it is listed while its public label reads as not yet shipping",
    ).toBe(false)
  })
})

describe("the rule discriminates on evidence, not on the state itself", () => {
  it("accepts AVAILABLE backed by a liveUrl", () => {
    const doc = clone()
    const p = primitive(doc, "cursor", "cursor-plugin")
    p.state = "AVAILABLE"
    p.liveUrl = "https://cursor.com/marketplace/calllint"
    expect(
      validate(doc),
      `an evidence-bearing AVAILABLE was rejected — the rule over-blocks and would push somebody\n` +
        `toward deleting a true claim:\n${JSON.stringify(validate.errors, null, 1)}`,
    ).toBe(true)
  })

  it("accepts AVAILABLE backed by the upstream registry record", () => {
    const doc = clone()
    const p = primitive(doc, "cursor", "cursor-plugin")
    p.state = "AVAILABLE"
    p.upstream = "officialMcpRegistry"
    expect(validate(doc), JSON.stringify(validate.errors, null, 1)).toBe(true)
  })

  it("keeps liveUrl: null legal under a non-AVAILABLE state", () => {
    // The schema documents `liveUrl: null` as nullable BY DESIGN: it states positively that a
    // primitive has no live URL yet, which a missing key cannot distinguish from an oversight.
    // The new arms must not have quietly outlawed that, so this asserts the older contract
    // survives — a regression here would be invisible in the SSOT, which carries one such key.
    const doc = clone()
    primitive(doc, "cline", "cline-marketplace-pr").liveUrl = null
    expect(validate(doc), JSON.stringify(validate.errors, null, 1)).toBe(true)
  })
})
