/**
 * Workstream P Batch 7 — the decision-relay surface (new15 §5 / PR P-6).
 *
 * Five of the six `agentRelayCopy` slots shipped at P-5 with no consumer at all: the
 * resolver's `CODE_OWNED_SLOTS.agentRelayCopy` carried five identical reasons reading "no
 * consumer exists: no code produces a decision-relay surface (P-6)". P-6 gives them one —
 * `composeRelayNotes` in `@calllint/trust-index/agentRelay`, pushed into the existing
 * `notes[]` of `calllint_prepare_safe_install`, exactly as `guardOffer` has been pushed
 * since P-5.
 *
 * WHAT MAKES THE SURFACE HONEST, and therefore what this suite grades: the composer is
 * FACT-GATED. Each sentence is relay wording plus a machine fact read off the sealed
 * contract, and a sentence whose fact is ABSENT is not emitted. So the tests below are not
 * "does the sentence appear" — they are "does the sentence appear exactly when its basis
 * does, and vanish when it does not". That is the 6-vs-4 reconciliation made enforceable
 * rather than asserted: §5 names four slots, the schema declares six, and the two extras
 * (`adds`, `notObserved`) each name a contract field (`authorityDelta.adds`,
 * `authorityDelta.notObserved`) rather than inventing copy. A seventh slot with no basis
 * would have no gate to pass.
 *
 * Two invariants are load-bearing beyond the rest:
 *
 *   • `notObserved` is gated on `completeness === "complete"` — the contract builder's OWN
 *     gate, restated. When the authority inventory is partial, silence is a GAP, and a
 *     sentence saying "not observed" would read as reassurance. "Absence of evidence is
 *     recorded as absence, never as safety" is the wording; the gate is what makes it true.
 *   • The result must VALIDATE against `calllint.safe-install-result.v1`, whose
 *     `additionalProperties` is `false`. Adding sentences to `notes[]` without a validator
 *     would ship the new surface at its least measured moment, and the schema forbade eight
 *     properties the code has always emitted — so every outcome path is validated here.
 *
 * The publisher is never a source: `notes` is typed "Never carries publisher content", and
 * the composer reads only verdict, label, reason codes, evidence level, completeness, the
 * authority tokens, and the plan digest — engine vocabulary throughout.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import Ajv from "ajv"
import { TOOLS_BY_NAME } from "../src/tools.js"
import { COMMITTED_CONTRACTS } from "../src/committedContracts.js"
import { resetPlanAnchors } from "../src/planAnchors.js"
import {
  composeRelayNotes,
  DEFAULT_AGENT_RELAY_COPY,
  WIRED_AGENT_RELAY,
  type AgentRelayCopy,
  type RelayFacts,
} from "@calllint/trust-index/agentRelay"
import type { ScanOptions } from "@calllint/core"

const OPTS: ScanOptions = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
}

function call(name: string, args: Record<string, unknown>): { text: unknown; isError?: boolean } {
  const tool = TOOLS_BY_NAME.get(name)
  if (!tool) throw new Error(`no tool ${name}`)
  const r = tool.handler(args, OPTS)
  const raw = r.content[0]!.text
  return { text: r.isError ? raw : JSON.parse(raw), isError: r.isError }
}

// Scratch host-config dirs, verbatim from `adoption-tools.test.ts`: apply is the one tool
// that WRITES, so every apply case targets an isolated temp path — never a real host config.
const scratches: string[] = []
function scratchConfig(initial?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "calllint-mcp-relay-test-"))
  scratches.push(dir)
  const path = join(dir, "mcp.json")
  if (initial !== undefined) writeFileSync(path, initial, "utf8")
  return path
}

afterEach(() => {
  for (const d of scratches.splice(0)) rmSync(d, { recursive: true, force: true })
  resetPlanAnchors()
})

// The committed bundle's own subjects — a pinned npm SAFE target (plannable) and a remote
// one. Read from `COMMITTED_CONTRACTS` rather than hardcoded so a bundle change cannot leave
// this suite asserting against a slug that no longer exists.
const NPM_SLUG = "mcp-registry/ai.adeu-adeu"
const REMOTE_SLUG = "mcp-registry/ac.inference.sh-mcp"

interface PrepResult {
  readonly schema: string
  readonly outcome: string
  readonly canonicalName: string
  readonly planDigest: string | null
  readonly notes: readonly string[]
}

/** The five decision-relay slots, plus `guardOffer` which P-5 already wired. */
const DECISION_RELAY_SLOTS = ["headline", "reason", "adds", "notObserved", "approvalQuestion"] as const

/**
 * A fully-populated fact set: every gate open, so each slot's ABSENCE in a later case is
 * attributable to the gate under test and to nothing else. Built once and narrowed per case.
 */
const FULL_FACTS: RelayFacts = Object.freeze({
  verdict: "SAFE",
  publicLabel: "No blockers observed",
  reasonCodes: ["network-egress"],
  evidenceLevel: "static",
  completeness: "complete",
  adds: ["network_egress"],
  notObserved: ["financial_action", "secret_access"],
  planDigest: "sha256:" + "a".repeat(64),
})

const facts = (over: Partial<RelayFacts> = {}): RelayFacts => ({ ...FULL_FACTS, ...over })
const composed = (over: Partial<RelayFacts> = {}): readonly string[] =>
  composeRelayNotes(DEFAULT_AGENT_RELAY_COPY, facts(over))
const carries = (notes: readonly string[], slot: keyof AgentRelayCopy): boolean =>
  notes.some((n) => n.includes(DEFAULT_AGENT_RELAY_COPY[slot]))

// ---------------------------------------------------------------------------
// composeRelayNotes — the fact gates
// ---------------------------------------------------------------------------

describe("composeRelayNotes — all six slots have a consumer", () => {
  it("declares all six slots wired, with no duplicates", () => {
    expect([...WIRED_AGENT_RELAY].sort()).toEqual(
      ["adds", "approvalQuestion", "guardOffer", "headline", "notObserved", "reason"].sort(),
    )
    expect(new Set(WIRED_AGENT_RELAY).size).toBe(WIRED_AGENT_RELAY.length)
  })

  it("emits all five decision-relay slots when every basis is present", () => {
    const notes = composed()
    for (const slot of DECISION_RELAY_SLOTS) {
      expect(carries(notes, slot), `${slot} missing from a fully-populated relay`).toBe(true)
    }
    expect(notes).toHaveLength(5)
  })

  it("pairs each sentence with the machine fact behind it, not wording alone", () => {
    // A relay sentence that carried only wording would be decoration. Each must name the
    // contract field it projects, so an agent echoing it repeats a measurement.
    const notes = composed()
    expect(notes.find((n) => n.startsWith(DEFAULT_AGENT_RELAY_COPY.headline))).toContain("SAFE")
    expect(notes.find((n) => n.startsWith(DEFAULT_AGENT_RELAY_COPY.reason))).toContain("network-egress")
    expect(notes.find((n) => n.startsWith(DEFAULT_AGENT_RELAY_COPY.adds))).toContain("network_egress")
    expect(notes.find((n) => n.startsWith(DEFAULT_AGENT_RELAY_COPY.notObserved))).toContain("financial_action")
    expect(notes.find((n) => n.startsWith(DEFAULT_AGENT_RELAY_COPY.approvalQuestion))).toContain("sha256:aaa")
  })

  it("GATE — `adds` is absent when `authorityDelta.adds` is empty", () => {
    const notes = composed({ adds: [] })
    expect(carries(notes, "adds")).toBe(false)
    // The other four are unaffected: one closed gate must not silence the rest.
    expect(carries(notes, "headline")).toBe(true)
    expect(carries(notes, "notObserved")).toBe(true)
  })

  it("GATE — `notObserved` is absent when completeness is not `complete`", () => {
    // The contract builder's own gate, restated. Under a PARTIAL inventory, silence is a gap
    // and an absence sentence would read as reassurance (§4.1: never over-trust silence).
    for (const completeness of ["partial", null] as const) {
      const notes = composed({ completeness })
      expect(carries(notes, "notObserved"), `completeness=${completeness}`).toBe(false)
      expect(carries(notes, "headline"), `completeness=${completeness}`).toBe(true)
    }
  })

  it("GATE — `notObserved` is absent when complete but nothing is unobserved", () => {
    // Complete inventory, empty complement: the sentence has nothing to relay. Both halves
    // of the conjunction are graded, so dropping either one from the gate is caught.
    expect(carries(composed({ notObserved: [] }), "notObserved")).toBe(false)
  })

  it("GATE — `approvalQuestion` is absent without a plan digest", () => {
    // No plan ⇒ no exact plan to approve, so the question would invite approval of something
    // unnamed. This is the `approvalPreview` discipline applied to relay copy.
    const notes = composed({ planDigest: null })
    expect(carries(notes, "approvalQuestion")).toBe(false)
    expect(carries(notes, "headline")).toBe(true)
  })

  it("GATE — `headline` is absent without a verdict", () => {
    expect(carries(composed({ verdict: null }), "headline")).toBe(false)
  })

  it("GATE — `reason` is absent with neither reason codes nor an evidence level", () => {
    expect(carries(composed({ reasonCodes: [], evidenceLevel: null }), "reason")).toBe(false)
    // Either fact alone is enough — the sentence projects whichever is present.
    expect(carries(composed({ reasonCodes: [], evidenceLevel: "static" }), "reason")).toBe(true)
    expect(carries(composed({ reasonCodes: ["x"], evidenceLevel: null }), "reason")).toBe(true)
  })

  it("emits nothing at all when the contract carries no fact", () => {
    // The honest floor: a relay surface with no basis is EMPTY, not a set of hedged
    // sentences. Every gate closed ⇒ zero notes.
    expect(
      composeRelayNotes(DEFAULT_AGENT_RELAY_COPY, {
        verdict: null,
        publicLabel: null,
        reasonCodes: [],
        evidenceLevel: null,
        completeness: null,
        adds: [],
        notObserved: [],
        planDigest: null,
      }),
    ).toEqual([])
  })

  it("is pure — the same facts compose the same sentences", () => {
    expect(composed()).toEqual(composed())
  })

  it("relays configured WORDING without relaying configured MEANING", () => {
    // Configuration may reword a slot; it may never remove the machine fact, because the
    // fact is appended by the composer rather than embedded in the string.
    const reworded: AgentRelayCopy = { ...DEFAULT_AGENT_RELAY_COPY, headline: "REWORDED" }
    const notes = composeRelayNotes(reworded, facts())
    const headline = notes.find((n) => n.startsWith("REWORDED"))
    expect(headline).toBeDefined()
    expect(headline).toContain("SAFE")
  })
})

// ---------------------------------------------------------------------------
// The MCP surface — the sentences reach a real `prepare` result
// ---------------------------------------------------------------------------

describe("calllint_prepare_safe_install — relay notes on the wire", () => {
  it("carries the relay sentences in `notes[]` on a planned prepare", () => {
    const { text } = call("calllint_prepare_safe_install", {
      canonicalName: NPM_SLUG,
      host: "claude-code",
    }) as { text: PrepResult }
    expect(text.outcome).toBe("PREPARED")
    expect(text.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    // headline + reason are unconditional once a contract resolved; approvalQuestion follows
    // the plan digest this call computed.
    for (const slot of ["headline", "reason", "approvalQuestion"] as const) {
      expect(carries(text.notes, slot), `${slot} absent from a planned prepare`).toBe(true)
    }
  })

  it("omits `approvalQuestion` when no host is named, since no plan exists", () => {
    const { text } = call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG }) as {
      text: PrepResult
    }
    expect(text.planDigest).toBeNull()
    expect(carries(text.notes, "approvalQuestion")).toBe(false)
    // The unconditional pair still lands: no plan is not the same as no decision.
    expect(carries(text.notes, "headline")).toBe(true)
    expect(carries(text.notes, "reason")).toBe(true)
  })

  it("gates every slot on the SEALED contract, over EVERY plannable subject in the bundle", () => {
    // Measured against the bundle itself: whichever way each contract's fields fall, the
    // sentences must agree with them. This is the check that would catch a sentence emitted
    // from a default rather than from the contract.
    //
    // The subject list is DERIVED, not named: only a pinned-npm target reaches `runPrepare`
    // at all (every other route returns LOCAL_PREFLIGHT_REQUIRED before the composer runs),
    // so hardcoding a pair of slugs would silently grade whichever of them happened to be
    // plannable. Measured on the committed bundle: 2 of 19 contracts reach PREPARED.
    const plannable = Object.keys(COMMITTED_CONTRACTS).filter(
      (slug) =>
        (
          call("calllint_prepare_safe_install", { canonicalName: slug, host: "claude-code" })
            .text as PrepResult
        ).outcome === "PREPARED",
    )
    expect(plannable.length, "no contract in the bundle is plannable — nothing graded").toBeGreaterThan(0)

    for (const slug of plannable) {
      const contract = COMMITTED_CONTRACTS[slug]!
      const obs = contract.publicObservation as { completeness?: string; verdict?: string }
      const delta = contract.authorityDelta as
        | { adds?: readonly unknown[]; notObserved?: readonly unknown[] }
        | undefined
      const { text } = call("calllint_prepare_safe_install", {
        canonicalName: slug,
        host: "claude-code",
      }) as { text: PrepResult }

      expect(carries(text.notes, "adds"), `${slug} adds`).toBe((delta?.adds ?? []).length > 0)
      expect(carries(text.notes, "notObserved"), `${slug} notObserved`).toBe(
        obs.completeness === "complete" && (delta?.notObserved ?? []).length > 0,
      )
      expect(carries(text.notes, "headline"), `${slug} headline`).toBe(Boolean(obs.verdict))
    }
  })

  it("records that `adds` has no on-the-wire witness, and grades the gate that decides it", () => {
    // HONEST SCOPE, measured rather than assumed. `adds` is non-empty on 17 of 19 committed
    // contracts, but every one of those 17 is a remote/unpinned target that returns
    // LOCAL_PREFLIGHT_REQUIRED *before* `runPrepare` — and both PREPARED subjects carry
    // `adds: []`. So no bundle subject can make the `adds` sentence appear on the wire today.
    //
    // Two things follow, and both are graded instead of narrated:
    //   • the ABSENCE is correct for the corpus as it stands (the loop above proves the
    //     sentence tracks the field, in the false direction);
    //   • the wire PATH is nonetheless real, because the tool passes `delta.adds` straight
    //     through — so the gate is graded here against the composer, which is the same
    //     function the tool calls, with the mapping the tool performs applied by hand.
    // The day a pinned npm contract ships a non-empty `adds`, the loop above starts asserting
    // presence with no edit needed. This case exists so that gap is a recorded measurement
    // rather than a blind spot.
    const withAdds = Object.entries(COMMITTED_CONTRACTS).filter(
      ([, c]) => ((c.authorityDelta as { adds?: readonly unknown[] } | undefined)?.adds ?? []).length > 0,
    )
    expect(withAdds.length, "no contract carries authorityDelta.adds — the gate has no subject").toBeGreaterThan(0)

    for (const [slug, contract] of withAdds) {
      // Not PREPARED — which is exactly why the sentence cannot be witnessed on the wire.
      const { text } = call("calllint_prepare_safe_install", {
        canonicalName: slug,
        host: "claude-code",
      }) as { text: PrepResult }
      expect(text.outcome).not.toBe("PREPARED")

      // The composer, fed the same fields through the same mapping `runPrepare` uses.
      const delta = contract.authorityDelta as { adds: readonly { authority: string }[] }
      const notes = composeRelayNotes(
        DEFAULT_AGENT_RELAY_COPY,
        facts({ adds: delta.adds.map((a) => a.authority) }),
      )
      expect(carries(notes, "adds"), `${slug} adds`).toBe(true)
      expect(notes.find((n) => n.startsWith(DEFAULT_AGENT_RELAY_COPY.adds))).toContain(
        delta.adds[0]!.authority,
      )
    }
  })

  it("never relays publisher content", () => {
    // `notes` is typed "Never carries publisher content." The publisher's description is in
    // the contract bytes, so this is a real containment question, not a tautology.
    const contract = COMMITTED_CONTRACTS[NPM_SLUG]!
    const publisher = (contract.publisherProvided as { description?: string } | undefined)?.description
    const { text } = call("calllint_prepare_safe_install", {
      canonicalName: NPM_SLUG,
      host: "claude-code",
    }) as { text: PrepResult }
    const joined = text.notes.join(" ")
    if (publisher && publisher.trim() !== "") {
      // Compare on a substantive fragment: a short word could co-occur innocently.
      const fragment = publisher.trim().slice(0, 40)
      expect(joined).not.toContain(fragment)
    }
    expect(joined).not.toMatch(/<script|javascript:|<iframe/i)
  })

  it("keeps every pre-P-6 note assertion satisfied", () => {
    // The additive claim, measured rather than asserted: the shipped regex-shaped
    // assertions still find their sentences with five more notes present. No length
    // assertion existed anywhere, which is what made the surface additively compatible.
    const { text } = call("calllint_prepare_safe_install", {
      canonicalName: NPM_SLUG,
      host: "claude-code",
    }) as { text: PrepResult }
    expect(text.notes.some((n) => /NOT applied/.test(n))).toBe(true)
    const { text: hostless } = call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG }) as {
      text: PrepResult
    }
    expect(hostless.notes.some((n) => /no host named/.test(n))).toBe(true)
  })

  it("pushes the guard offer from the same catalog slot", () => {
    const { text } = call("calllint_enable_continuous_guard", { host: "claude-code" }) as {
      text: { notes: readonly string[] }
    }
    expect(carries(text.notes, "guardOffer")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Schema conformance — `additionalProperties: false` over a REAL result
// ---------------------------------------------------------------------------

describe("calllint.safe-install-result.v1 — every outcome path validates", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

  /** The `contractValidator()` idiom: Ajv lives in the harness, never in the package. */
  const validate = (() => {
    const schema = JSON.parse(
      readFileSync(join(repoRoot, "schemas/calllint.safe-install-result.v1.schema.json"), "utf8"),
    )
    const compiled = new Ajv({ allErrors: true, strict: false }).compile(schema)
    return (r: unknown): string[] =>
      compiled(r)
        ? []
        : (compiled.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
  })()

  /** Prepare against a scratch config, returning the digest a caller would approve. */
  const prepareFor = (hostConfigPath: string, host = "cursor"): string => {
    const { text } = call("calllint_prepare_safe_install", {
      canonicalName: NPM_SLUG,
      host,
      hostConfigPath,
    }) as { text: PrepResult }
    return text.planDigest!
  }

  it("validates EVERY outcome path the tool can emit, including a real apply", () => {
    // Six of the eight properties P-6 declared (`receipt`, `configPath`,
    // `configDigest{Before,After}`, `backupPath`, `rolledBack`) appear ONLY on the
    // successful-apply envelope. Validating prepare alone would leave them ungraded — the
    // same defect class as a schema that forbids what the code emits, which is precisely
    // what this block exists to catch. So the apply path runs for real, against a scratch
    // config, and its envelope is validated too.
    const cfg = scratchConfig()
    const digest = prepareFor(cfg)
    const applied = call("calllint_apply_prepared_install", {
      canonicalName: NPM_SLUG,
      host: "cursor",
      hostConfigPath: cfg,
      approvalDigest: digest,
    }).text as Record<string, unknown>
    expect(applied.outcome, "apply did not reach APPLIED_AND_VERIFIED — the envelope under test").toBe(
      "APPLIED_AND_VERIFIED",
    )

    const results: readonly (readonly [string, unknown])[] = [
      [
        "prepare+host",
        call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG, host: "claude-code" }).text,
      ],
      ["prepare-hostless", call("calllint_prepare_safe_install", { canonicalName: NPM_SLUG }).text],
      ["prepare-remote", call("calllint_prepare_safe_install", { canonicalName: REMOTE_SLUG }).text],
      ["apply-verified", applied],
    ]
    for (const [label, result] of results) {
      expect(validate(result), `${label} failed schema validation`).toEqual([])
    }

    // Non-vacuity for the six apply-only declarations: the envelope must actually carry them,
    // else "the apply path validates" would be true of a result that omitted every one.
    for (const key of [
      "receipt",
      "receiptDigest",
      "configPath",
      "configDigestBefore",
      "configDigestAfter",
      "backupPath",
      "rolledBack",
      "persistentComponents",
      "tool",
      "note",
    ]) {
      expect(Object.hasOwn(applied, key), `apply envelope is missing ${key}`).toBe(true)
    }
  })

  it("the guard tool emits a DIFFERENT wire object, and this schema correctly rejects it", () => {
    // Measured, not assumed: `calllint_enable_continuous_guard` returns
    // `calllint.continuous-protection-result.v1`. It shares the `notes` array (which is why
    // `guardOffer` lands there) but it is NOT a safe-install result, and the tag is the
    // contract — so validating it here must FAIL. Asserting that keeps the two envelopes from
    // being conflated the next time a slot is wired into one of them.
    const guard = call("calllint_enable_continuous_guard", { host: "claude-code" }).text as {
      schema: string
    }
    expect(guard.schema).toBe("calllint.continuous-protection-result.v1")
    expect(validate(guard)).not.toEqual([])
  })

  it("is a REAL constraint — an undeclared property is rejected", () => {
    // Self-check on the validator itself: `additionalProperties: false` must actually bite,
    // else "every result validates" would be true of any object at all.
    const { text } = call("calllint_prepare_safe_install", {
      canonicalName: NPM_SLUG,
      host: "claude-code",
    }) as { text: Record<string, unknown> }
    expect(validate({ ...text, undeclaredField: 1 })).not.toEqual([])
  })

  it("types `notes` as strings, so a relay sentence cannot smuggle structure", () => {
    const { text } = call("calllint_prepare_safe_install", {
      canonicalName: NPM_SLUG,
      host: "claude-code",
    }) as { text: PrepResult }
    for (const n of text.notes) expect(typeof n).toBe("string")
    expect(validate({ ...text, notes: [{ not: "a string" }] })).not.toEqual([])
  })
})
