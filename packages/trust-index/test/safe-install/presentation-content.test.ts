// ---------------------------------------------------------------------------
// Workstream P Batch 1 — Structured Content Schema tests (new15 §6.2 PR P-1;
// ADR 0058 §1/§3/§6).
//
// The suite is organized around one question: what could a future PR do to let an
// L3 value into apps/web/content/**? Each describe block closes one of those
// routes, and every rule is FALSIFIED as well as confirmed — a boundary test that
// only ever feeds valid documents proves nothing about the boundary.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import Ajv from "ajv"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import {
  DEFAULT_GROUP_ORDER,
  DISPLAY_GROUPS,
  EMPTY_PRESENTATION_CONTENT,
  LEVEL_BY_SECTION,
  PRESENTATION_CONTENT_VERSION,
  PRESENTATION_STATES,
  PRIMARY_CTA,
  RESERVED_KEYS,
  validatePresentationContent,
  type PresentationValidationContext,
} from "../../src/index.js"

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..")
const schemaPath = path.join(repoRoot, "schemas", "calllint.presentation-content.v1.schema.json")
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>

const facts = JSON.parse(fs.readFileSync(path.join(repoRoot, "project-facts.json"), "utf8")) as {
  forbiddenPhrases: string[]
  trustPageForbiddenPhrases: string[]
}

/** The real shipped constants — never a local copy, or the rule checks nothing. */
const ctx: PresentationValidationContext = {
  verdictLabels: VERDICT_PUBLIC_LABEL,
  stateCtas: PRIMARY_CTA,
  forbiddenPhrases: [...facts.forbiddenPhrases, ...facts.trustPageForbiddenPhrases],
}

const ajv = new Ajv({ allErrors: true, strict: false })
const validateSchema = ajv.compile(schema)

/** A realistic document exercising every section — what PR P-2 will actually write. */
const FULL_DOC = {
  schema: PRESENTATION_CONTENT_VERSION,
  locale: "en-US",
  decisionCopy: {
    states: {
      PREPARE_AVAILABLE: {
        headline: "No blockers observed",
        primaryAction: "Open in CallLint",
        supportingText: "Exact package · Preview changes · Verify what was written",
      },
      REVIEW_REQUIRED: { headline: "Review required", primaryAction: "Review in CallLint" },
      BLOCKED: { headline: "Blocked by policy", primaryAction: "See why it is blocked" },
      LOCAL_PREFLIGHT_REQUIRED: { headline: "Insufficient evidence", primaryAction: "Check it on your machine" },
      UNSUPPORTED: { headline: "No supported install plan", primaryAction: "See manual setup" },
    },
  },
  authorityCopy: {
    observedPhrases: {
      secret_access: "Requires access to configured secrets.",
      shell_execution: "Can run shell commands with access to configured paths.",
    },
    absencePhrases: {
      financial_action: "No financial or payment capability was observed.",
      secret_access: "No secret access was observed.",
    },
  },
  sectionTitles: {
    authorityFacts: "What it can do",
    provenance: "Provenance",
    publisherBlock: "Publisher-provided description — not used for CallLint's safety decision.",
  },
  guardConversion: {
    offerHeadline: "Keep checking after install",
    declineLabel: "Not now",
    acceptLabel: "Turn on continuous checks",
  },
  agentRelayCopy: {
    headline: "This tool needs your approval.",
    approvalQuestion: "Add this tool with the authority listed above?",
  },
  // `DEFAULT_GROUP_ORDER`, not `[...DISPLAY_GROUPS]`: the vocabulary array is new14 §7's
  // documentation numbering (CTA fifth), while the renderer emits the CTA third, fused
  // into `install-disposition`. PR P-3's structural rule rejects the §7 numbering as
  // `fused-run-split` — correctly, since no served page has ever had that shape.
  layout: { groupOrder: [...DEFAULT_GROUP_ORDER], maxAuthorityFacts: 3, maxSecondaryLinks: 2 },
  tokens: { tokensVersion: "safe-install-1", stylesheetHref: "/styles/safe-install/tokens.css" },
  overrides: {
    resources: {
      "io.github.example-mcp": {
        displayName: "Example MCP",
        originalSetupUrl: "https://example.com/docs/setup",
        expiresAt: "2027-01-01T00:00:00Z",
        reason: "Publisher requested the shorter display name.",
      },
    },
  },
}

describe("presentation-content schema — the shape boundary", () => {
  it("the canonical empty document is valid (greenfield is expressible, not special-cased)", () => {
    expect(validateSchema(EMPTY_PRESENTATION_CONTENT)).toBe(true)
    expect(validatePresentationContent(EMPTY_PRESENTATION_CONTENT, ctx)).toEqual([])
  })

  it("the full realistic document PR P-2 will write is valid under BOTH schema and validator", () => {
    const ok = validateSchema(FULL_DOC)
    if (!ok) console.error(validateSchema.errors)
    expect(ok).toBe(true)
    expect(validatePresentationContent(FULL_DOC, ctx)).toEqual([])
  })

  it("every object in the schema is closed — additionalProperties:false or a constrained map", () => {
    // Walk the schema itself. This is the rule that stops a future PR from widening
    // the schema rather than from writing a bad document: closedness has to hold in
    // the FILE, not just in the documents we happened to test.
    const open: string[] = []
    const walk = (node: unknown, at: string): void => {
      if (node === null || typeof node !== "object") return
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, `${at}[${i}]`))
        return
      }
      const obj = node as Record<string, unknown>
      if (obj.type === "object") {
        const ap = obj.additionalProperties
        // Closed either by `false`, or by a schema every value must satisfy
        // (a constrained map — `overrides.resources` is the one such case).
        const closed = ap === false || (ap !== null && typeof ap === "object")
        if (!closed) open.push(at)
      }
      for (const [k, v] of Object.entries(obj)) walk(v, `${at}/${k}`)
    }
    walk(schema, "#")
    expect(open).toEqual([])
  })

  it("no property name anywhere in the schema is a reserved L3 key", () => {
    // The vocabulary boundary, applied to the schema. If someone adds a
    // `properties.verdictLabel` in a later batch, this fails before any document does.
    const offenders: string[] = []
    const walk = (node: unknown, at: string): void => {
      if (node === null || typeof node !== "object") return
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, `${at}[${i}]`))
        return
      }
      const obj = node as Record<string, unknown>
      const props = obj.properties
      if (props !== null && typeof props === "object" && !Array.isArray(props)) {
        for (const name of Object.keys(props as Record<string, unknown>)) {
          if (RESERVED_KEYS.includes(name)) offenders.push(`${at}/properties/${name}`)
        }
      }
      for (const [k, v] of Object.entries(obj)) walk(v, `${at}/${k}`)
    }
    walk(schema, "#")
    expect(offenders).toEqual([])
  })

  it("$id follows the calllint.com domain convention (ADR 0043)", () => {
    expect(schema.$id).toBe(
      "https://calllint.com/schemas/calllint.presentation-content.v1.schema.json",
    )
  })

  it("schema enums match the shipped vocabularies exactly — config selects, never invents", () => {
    const defs = schema.$defs as Record<string, { enum?: string[] }>
    expect(defs.installability?.enum).toEqual([...PRESENTATION_STATES])
    expect(defs.displayGroup?.enum).toEqual([...DISPLAY_GROUPS])
  })

  it("every top-level section carries a declared level, and none is L3", () => {
    const props = Object.keys(schema.properties as Record<string, unknown>).filter(
      (k) => k !== "schema" && k !== "locale",
    )
    expect(props.sort()).toEqual(Object.keys(LEVEL_BY_SECTION).sort())
    for (const level of Object.values(LEVEL_BY_SECTION)) {
      expect(["L0", "L1", "L2"]).toContain(level)
    }
  })
})

/** Rules are only real if they FAIL on the thing they claim to forbid. */
describe("presentation-content validator — falsifications", () => {
  const rulesFor = (doc: unknown): string[] =>
    validatePresentationContent(doc, ctx).map((e) => e.rule)

  it("rejects an unknown top-level section", () => {
    expect(rulesFor({ ...EMPTY_PRESENTATION_CONTENT, mystery: { a: "b" } })).toContain(
      "unknown-section",
    )
  })

  it("rejects a reserved L3 key nested deep inside a permitted section", () => {
    // The important case: not at the top level, where anyone would look, but buried
    // where only a depth-independent rule finds it.
    const doc = {
      ...EMPTY_PRESENTATION_CONTENT,
      overrides: { resources: { "io.github.x": { displayName: "X", installability: "PREPARE_AVAILABLE" } } },
    }
    expect(rulesFor(doc)).toContain("reserved-key")
  })

  it("rejects every reserved key individually — no member of the list is decorative", () => {
    for (const key of RESERVED_KEYS) {
      const doc = { ...EMPTY_PRESENTATION_CONTENT, guardConversion: { [key]: "x" } }
      expect(validatePresentationContent(doc, ctx).some((e) => e.rule === "reserved-key")).toBe(true)
    }
  })

  it("rejects a layout that DELETES a shipped group (hiding consequence)", () => {
    const doc = {
      ...EMPTY_PRESENTATION_CONTENT,
      layout: { groupOrder: DISPLAY_GROUPS.filter((g) => g !== "consequence") },
    }
    const errs = validatePresentationContent(doc, ctx)
    expect(errs.map((e) => e.rule)).toContain("layout-groups")
    expect(errs.some((e) => e.message.includes("consequence"))).toBe(true)
    // and the schema catches it independently, via minItems
    expect(validateSchema(doc)).toBe(false)
  })

  it("rejects a layout that duplicates a group to pad the count back to six", () => {
    const doc = {
      ...EMPTY_PRESENTATION_CONTENT,
      layout: { groupOrder: ["identity", "identity", "disposition", "consequence", "authority_facts", "primary_action"] },
    }
    expect(rulesFor(doc)).toContain("layout-groups")
    expect(validateSchema(doc)).toBe(false) // uniqueItems
  })

  it("accepts a REORDERING the renderer can emit — config selects among shipped orderings", () => {
    // Moving the whole `install-consequence` section above the fused disposition section
    // is a real reordering (the sequence is not the shipped one) AND emittable: the fused
    // `disposition`+`primary_action` run stays adjacent and in order, so there is a
    // section permutation that produces it.
    const reordered = ["identity", "consequence", "disposition", "primary_action", "authority_facts", "secondary_links"]
    const doc = { ...EMPTY_PRESENTATION_CONTENT, layout: { groupOrder: reordered } }
    expect(validatePresentationContent(doc, ctx)).toEqual([])
    expect(validateSchema(doc)).toBe(true)
    // Anti-vacuity: this must be a DIFFERENT order from the shipped one, or "accepts a
    // reordering" is really just "accepts the default".
    expect(reordered).not.toEqual([...DEFAULT_GROUP_ORDER])
  })

  it("rejects an ordering that SPLITS the fused disposition + primary_action section", () => {
    // Schema-perfect: six distinct groups from the enum, so `minItems`/`uniqueItems`/
    // `items` all pass. Only the structural rule can catch it, and it must — the renderer
    // emits both groups from ONE <section>, so there is no markup that separates them. A
    // validator that accepted this would let a document claim a layout the renderer
    // silently ignores: a config key that validates and then does nothing (ADR 0058 §3).
    const split = ["identity", "disposition", "consequence", "primary_action", "authority_facts", "secondary_links"]
    const doc = { ...EMPTY_PRESENTATION_CONTENT, layout: { groupOrder: split } }
    expect(validateSchema(doc)).toBe(true) // shape alone cannot catch this
    expect(rulesFor(doc)).toContain("layout-unsupported")
  })

  it("rejects new14 §7's own documentation numbering — the DOM never had that shape", () => {
    // The trap this rule exists for, and the one it actually caught in-PR: §7 numbers the
    // primary action fifth, so `[...DISPLAY_GROUPS]` reads like the shipped order. It is
    // not one; the served CTA is third, fused into `install-disposition`. Pinning it here
    // keeps the vocabulary/order distinction from being rediscovered by a failing build.
    const doc = { ...EMPTY_PRESENTATION_CONTENT, layout: { groupOrder: [...DISPLAY_GROUPS] } }
    expect(validateSchema(doc)).toBe(true)
    expect(rulesFor(doc)).toContain("layout-unsupported")
    // The emitted order, by contrast, is accepted — the two arrays are genuinely different.
    expect(rulesFor({ ...EMPTY_PRESENTATION_CONTENT, layout: { groupOrder: [...DEFAULT_GROUP_ORDER] } })).toEqual([])
    expect([...DISPLAY_GROUPS]).not.toEqual([...DEFAULT_GROUP_ORDER])
  })

  it("rejects a REVIEW page whose headline impersonates the SAFE label", () => {
    // Schema-perfect, and exactly the drift ADR 0058 exists to prevent.
    const doc = {
      ...EMPTY_PRESENTATION_CONTENT,
      decisionCopy: { states: { REVIEW_REQUIRED: { headline: VERDICT_PUBLIC_LABEL.SAFE } } },
    }
    expect(validateSchema(doc)).toBe(true) // shape alone cannot catch this
    expect(rulesFor(doc)).toContain("label-impersonation") // the value rule does
  })

  it("catches label impersonation through casing and whitespace", () => {
    const doc = {
      ...EMPTY_PRESENTATION_CONTENT,
      decisionCopy: { states: { BLOCKED: { headline: "  no   BLOCKERS Observed " } } },
    }
    expect(rulesFor(doc)).toContain("label-impersonation")
  })

  it("allows a state to keep its OWN shipped label and CTA (rewording is not impersonation)", () => {
    const doc = {
      ...EMPTY_PRESENTATION_CONTENT,
      decisionCopy: {
        states: {
          PREPARE_AVAILABLE: { headline: VERDICT_PUBLIC_LABEL.SAFE, primaryAction: PRIMARY_CTA.PREPARE_AVAILABLE },
          REVIEW_REQUIRED: { headline: "Check the authority change first", primaryAction: "Review and add" },
        },
      },
    }
    expect(validatePresentationContent(doc, ctx)).toEqual([])
  })

  it("rejects a BLOCKED page whose CTA impersonates the SAFE 'Open in CallLint' action", () => {
    const doc = {
      ...EMPTY_PRESENTATION_CONTENT,
      decisionCopy: { states: { BLOCKED: { primaryAction: PRIMARY_CTA.PREPARE_AVAILABLE } } },
    }
    expect(rulesFor(doc)).toContain("cta-impersonation")
  })

  it("rejects absence wording that turns 'not observed' into a denial claim", () => {
    for (const bad of [
      "This server cannot access secrets.",
      "Secret access is impossible.",
      "Secret access was denied.",
      "This server never touches your secrets.",
    ]) {
      const doc = { ...EMPTY_PRESENTATION_CONTENT, authorityCopy: { absencePhrases: { secret_access: bad } } }
      expect(rulesFor(doc)).toContain("absence-vocabulary")
    }
  })

  it("accepts neutral absence wording", () => {
    const doc = {
      ...EMPTY_PRESENTATION_CONTENT,
      authorityCopy: { absencePhrases: { secret_access: "No secret access was observed." } },
    }
    expect(validatePresentationContent(doc, ctx)).toEqual([])
  })

  it("rejects the shipped forbidden-phrase set inside configuration (INV-P4)", () => {
    // The teeth of extending check:public-copy to the config plane: enforced from
    // P-1, so it is already true the moment P-2 creates the first content file.
    for (const phrase of ["100% safe", "certified safe", "guaranteed safe", "trusted publisher"]) {
      const doc = {
        ...EMPTY_PRESENTATION_CONTENT,
        decisionCopy: { states: { PREPARE_AVAILABLE: { supportingText: `This server is ${phrase}.` } } },
      }
      expect(rulesFor(doc)).toContain("forbidden-phrase")
    }
  })

  it("rejects an empty string — a blank slot is a deletion disguised as an edit", () => {
    const doc = { ...EMPTY_PRESENTATION_CONTENT, sectionTitles: { provenance: "   " } }
    expect(rulesFor(doc)).toContain("empty-value")
  })

  it("rejects an unknown authority token and an unknown state key (config cannot coin one)", () => {
    const authority = { ...EMPTY_PRESENTATION_CONTENT, authorityCopy: { observedPhrases: { telepathy: "x" } } }
    const state = { ...EMPTY_PRESENTATION_CONTENT, decisionCopy: { states: { MAYBE_FINE: { headline: "x" } } } }
    expect(validateSchema(authority)).toBe(false)
    expect(validateSchema(state)).toBe(false)
  })

  it("rejects a stylesheetHref pointing off-origin, and a wrong schema tag", () => {
    expect(
      validateSchema({ ...EMPTY_PRESENTATION_CONTENT, tokens: { tokensVersion: "v1", stylesheetHref: "https://evil.example/x.css" } }),
    ).toBe(false)
    expect(rulesFor({ ...EMPTY_PRESENTATION_CONTENT, schema: "calllint.presentation-content.v2" })).toContain(
      "schema-tag",
    )
  })

  it("rejects a per-resource override outside the five permitted fields (ADR 0058 §3)", () => {
    for (const forbidden of ["html", "css", "javascript", "agentInstructions"]) {
      const doc = {
        ...EMPTY_PRESENTATION_CONTENT,
        overrides: { resources: { "io.github.x": { [forbidden]: "<p>hi</p>" } } },
      }
      expect(validateSchema(doc)).toBe(false)
    }
  })

  it("returns a stable error order for the same document (byte-stable artifacts)", () => {
    const doc = { ...EMPTY_PRESENTATION_CONTENT, mystery: {}, sectionTitles: { provenance: "" } }
    expect(JSON.stringify(validatePresentationContent(doc, ctx))).toBe(
      JSON.stringify(validatePresentationContent(doc, ctx)),
    )
  })
})
