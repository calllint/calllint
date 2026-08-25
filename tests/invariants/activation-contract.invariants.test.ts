/**
 * new20 Sprint 2 — the activation contract.
 *
 * A host page used to end at a support level. It told a visitor what CallLint could do for
 * their harness and then stopped, so the discovery funnel terminated on a page that never
 * named a next action. `activation` is the fix, and it is a data contract rather than page
 * copy so that the promise cannot be half-kept: a host record either carries the path from
 * "why this matters here" to "how you know it worked", or it fails validation.
 *
 * THE RULE HAS TWO ARMS AND THE DATA FORCES BOTH.
 *   over-claim   a DISCOVERY_ONLY or DEFERRED host must NOT carry `installRef` or
 *                `firstSuccessAction`. There is no first success to describe for a host
 *                CallLint cannot yet scan, and describing one is precisely the fabrication
 *                the `truthfulCommands` gates exist to prevent — see below for why it would
 *                have been INVISIBLE to all of them.
 *   under-claim  a NATIVE or CONFIG_SCAN host MUST carry all three fields. Without this arm
 *                the contract is satisfiable by `whyHere` alone on all 18 hosts: the field
 *                would exist, validate, and leave every page as actionless as before. That
 *                is the vacuous case, and it is the one a single-arm rule would have shipped.
 *
 * WHY `activation` CARRIES NO COMMAND TEXT — the load-bearing design decision here.
 * Every command-truthfulness gate in `check-harness-distribution.mjs` has ONE subject:
 * `truthfulCommands`. HD-01 requires a NATIVE host to advertise `--agent <id>`; HD-02/HD-03
 * forbid DISCOVERY_ONLY/DEFERRED hosts from advertising a command at all; HD-06 audits that
 * every flag in an advertised command is a flag the CLI actually reads. A free-form
 * `installCommand: "..."` string inside `activation` would therefore be a SECOND, UNAUDITED
 * place to advertise a command: HD-03 would not see a command smuggled into a DEFERRED host's
 * activation block, and HD-06 would not enter its flags into the denominator — the same
 * `--config`-shaped defect that was published on eight surfaces for months, reintroduced one
 * field over from the gate written to catch it.
 *
 * So the two command-bearing values are REFERENCES, not text:
 *   `installRef`     a key into project-facts.json's `install` block, resolved by
 *                    `resolveActivation()` in the generator, which THROWS on an unknown key
 *                    rather than emitting `undefined` into a published page.
 *   verify command   read straight off `truthfulCommands` by the generator — the field every
 *                    HD gate already audits. Never restated.
 * One writer per fact. That is what this file's third describe block pins.
 *
 * WHY THIS FILE EXISTS ALONGSIDE THE SCHEMA AND THE GENERATOR. Three layers, each catching
 * what the others structurally cannot:
 *   schema (`definitions.host.allOf`)   ajv rejects the shape. But it reports a failed `not`
 *                                       as "must NOT be valid" against `/hosts/11/activation`,
 *                                       naming neither the host nor which field over-claimed.
 *   generator (`resolveActivation`)     resolves the cross-file half a JSON Schema cannot
 *                                       express — `installRef` must be a key another document
 *                                       holds — and fails closed.
 *   this file                           the committed positive/negative fixture pair, and the
 *                                       only layer that notices a rule being DELETED. A gate
 *                                       reading its own green cannot distinguish "the rule
 *                                       holds" from "the arm was removed and nothing objects".
 *
 * MUTATION IS IN-MEMORY ONLY — a `structuredClone`, never a write. Same reason recorded at the
 * head of `available-requires-evidence.invariants.test.ts`: a vitest that mutated the served
 * tree would race the other suites for the same files.
 *
 * ANTI-VACUITY. Every claim pins its denominator first. Both cohorts are asserted non-empty
 * before anything is asserted about them, because each arm is trivially satisfied by an empty
 * cohort — and "no DEFERRED hosts exist" was never the condition this rule is protective of.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv, { type ValidateFunction } from "ajv"
import { beforeAll, describe, expect, it } from "vitest"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8")
const readJson = (rel: string) => JSON.parse(read(rel))

const SSOT_PATH = "apps/web/data/distribution-surfaces.json"
const SCHEMA_PATH = "apps/web/data/distribution-surfaces.schema.json"
const FACTS_PATH = "project-facts.json"
const GENERATOR = "scripts/generate-distribution-surfaces.mjs"
const TEMPLATE = "scripts/templates/host-page.hbs"

/** The support classes CallLint can act on today, and therefore owes a full activation path. */
const ACTIONABLE = ["NATIVE", "CONFIG_SCAN"] as const
/** The documented-only classes, which must not carry an install or first-success claim. */
const GUIDE_ONLY = ["DISCOVERY_ONLY", "DEFERRED"] as const

interface Activation {
  whyHere?: string
  installRef?: string
  firstSuccessAction?: string
}
interface Host {
  id: string
  supportClass: string
  truthfulCommands: string[]
  activation?: Activation
}
interface Ssot {
  hosts: Host[]
}

let ssot: Ssot
let schema: Record<string, unknown>
let validate: ValidateFunction

beforeAll(() => {
  ssot = readJson(SSOT_PATH)
  schema = readJson(SCHEMA_PATH)
  // Same ajv construction as the two schema gates, deliberately: this file must not be able
  // to pass under laxer settings than the gates it stands behind.
  const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
  validate = ajv.compile(schema)
})

const clone = (): Ssot => structuredClone(ssot)

/**
 * A host of the given support class, synthesizing one if the SSOT holds none.
 *
 * WHY SYNTHESIS AND NOT A THROW. This used to throw, on the reasoning that a missing cohort
 * is a fixture defect. That was right while every class was populated, and became wrong on
 * 2026-08-25: opencode was the SSOT's ONLY CONFIG_SCAN host, and once its normalization was
 * fixed it became genuinely NATIVE, emptying the class. The two `ACTIONABLE` controls then
 * failed for a reason that had nothing to do with the rule they audit — the schema's
 * requirement on CONFIG_SCAN was untouched and still correct.
 *
 * The subject of these controls is the SCHEMA RULE, not the census. Both classes are held
 * to the identical `activation` requirement (one `then` branch covers the pair), so a
 * relabelled clone exercises the rule faithfully while surviving an empty class. The
 * denominator that still matters — that the actionable and guide-only cohorts are both
 * non-empty in the SHIPPED SSOT — is asserted separately in "cohort denominators", against
 * `ssot` rather than a clone, so this helper cannot mask a real cohort collapse.
 */
function hostOfClass(doc: Ssot, supportClass: string): Host {
  const existing = doc.hosts.find((x) => x.supportClass === supportClass)
  if (existing) return existing

  const template = doc.hosts.find((x) => ACTIONABLE.includes(x.supportClass as never))
  if (!template) {
    throw new Error(
      `no actionable host to clone for ${supportClass} — every host lost its activation ` +
        `block, so this control cannot be built`,
    )
  }
  const synthesized: Host = structuredClone(template)
  // `id` is pinned to ^[a-z0-9-]+$ — an underscore here would make the clone schema-invalid
  // on its own, and every control built from it would red without testing activation at all.
  synthesized.id = `${template.id}-as-${supportClass.toLowerCase().replace(/_/g, "-")}`
  synthesized.supportClass = supportClass as Host["supportClass"]
  doc.hosts.push(synthesized)
  return synthesized
}

describe("cohort denominators (asserted before any claim about them)", () => {
  it("has a non-empty actionable cohort and a non-empty guide-only cohort", () => {
    const actionable = ssot.hosts.filter((h) => ACTIONABLE.includes(h.supportClass as never))
    const guideOnly = ssot.hosts.filter((h) => GUIDE_ONLY.includes(h.supportClass as never))
    expect(ssot.hosts.length, "no hosts — every claim below is vacuous").toBeGreaterThan(0)
    expect(
      actionable.length,
      "no NATIVE/CONFIG_SCAN hosts — the under-claim arm would pass having nothing to require",
    ).toBeGreaterThan(0)
    expect(
      guideOnly.length,
      "no DISCOVERY_ONLY/DEFERRED hosts — the over-claim arm would pass having nothing to reject",
    ).toBeGreaterThan(0)
  })

  it("every host carries an activation block, and the schema requires it", () => {
    const without = ssot.hosts.filter((h) => !h.activation).map((h) => h.id)
    expect(without, "host(s) with no activation block").toEqual([])

    const hostDef = (schema as { definitions?: Record<string, { required?: string[] }> })
      .definitions?.host
    expect(hostDef, "schema.definitions.host is gone — every claim here is moot").toBeDefined()
    expect(
      hostDef?.required,
      "activation is not required of a host — a new host could enter with no next action",
    ).toContain("activation")
  })

  /*
   * `hostOfClass` synthesizes a host when a class is empty (CONFIG_SCAN is, as of
   * 2026-08-25). A synthesized host must be schema-VALID before any control mutates it —
   * otherwise every control built on it reds for its own malformedness rather than for the
   * rule under test, which is the failure mode this file exists to avoid.
   *
   * Caught by measurement, not by reading: the first version built ids like
   * `cursor-as-config_scan`, and `id` is pinned to ^[a-z0-9-]+$. Both CONFIG_SCAN controls
   * "passed" while their error lists carried an `id pattern` violation — they would have
   * kept passing with the activation rule deleted.
   */
  it.each(ACTIONABLE)("synthesizes a schema-valid %s host before any mutation", (supportClass) => {
    const doc = clone()
    const h = hostOfClass(doc, supportClass)
    expect(h.supportClass).toBe(supportClass)
    expect(
      validate(doc),
      `the ${supportClass} control subject is itself invalid, so controls built on it prove ` +
        `nothing: ${JSON.stringify(validate.errors?.slice(0, 3) ?? [])}`,
    ).toBe(true)
  })
})

describe("the schema conditions activation on supportClass, in both directions", () => {
  /** Both arms, located by the classes they key on rather than by array position. */
  function arms() {
    const hostDef = (schema as {
      definitions?: Record<
        string,
        { allOf?: Array<{ if?: { properties?: { supportClass?: { enum?: string[] } } } }> }
      >
    }).definitions?.host
    const allOf = hostDef?.allOf
    expect(Array.isArray(allOf), "definitions.host carries no allOf conditions").toBe(true)
    const find = (classes: readonly string[]) =>
      allOf?.find((c) => classes.every((k) => c.if?.properties?.supportClass?.enum?.includes(k)))
    return { overClaim: find(GUIDE_ONLY), underClaim: find(ACTIONABLE) }
  }

  it("carries an arm keyed on the guide-only classes", () => {
    expect(
      arms().overClaim,
      "no conditional arm keyed on DISCOVERY_ONLY/DEFERRED — a guide-only host could claim an install path",
    ).toBeDefined()
  })

  it("carries an arm keyed on the actionable classes", () => {
    expect(
      arms().underClaim,
      "no conditional arm keyed on NATIVE/CONFIG_SCAN — activation would be satisfiable by whyHere alone",
    ).toBeDefined()
  })

  it("accepts the SSOT as committed", () => {
    // The positive control. Without it every negative control below could be passing because
    // the schema rejects everything.
    expect(validate(clone()), JSON.stringify(validate.errors?.slice(0, 4) ?? [])).toBe(true)
  })

  // ---- over-claim arm: a guide-only host may not claim an install or a first success ----

  it.each(GUIDE_ONLY)("rejects %s gaining an installRef", (supportClass) => {
    const doc = clone()
    hostOfClass(doc, supportClass).activation!.installRef = "scan"
    expect(validate(doc), `a ${supportClass} host was allowed to claim an install command`).toBe(
      false,
    )
  })

  it.each(GUIDE_ONLY)("rejects %s gaining a firstSuccessAction", (supportClass) => {
    const doc = clone()
    hostOfClass(doc, supportClass).activation!.firstSuccessAction = "Read the verdict line."
    expect(validate(doc), `a ${supportClass} host was allowed to describe a first success`).toBe(
      false,
    )
  })

  it("permits a guide-only host to carry whyHere — the rule is about claims, not about the field", () => {
    // Discrimination. A rule that banned `activation` outright for guide-only hosts would push
    // somebody toward deleting the one honest thing such a page can say: why the host's own
    // authority surfaces are worth caring about, which does not depend on CallLint's coverage.
    const doc = clone()
    for (const supportClass of GUIDE_ONLY) {
      const h = hostOfClass(doc, supportClass)
      h.activation = { whyHere: "Because this host grants an agent real authority." }
    }
    expect(validate(doc), JSON.stringify(validate.errors?.slice(0, 4) ?? [])).toBe(true)
  })

  // ---- under-claim arm: an actionable host owes the whole path ----

  it.each(ACTIONABLE)("rejects %s degraded to whyHere only", (supportClass) => {
    const doc = clone()
    const h = hostOfClass(doc, supportClass)
    h.activation = { whyHere: h.activation!.whyHere }
    expect(validate(doc), `a ${supportClass} host was allowed to state no next action`).toBe(false)
  })

  it.each(ACTIONABLE)("rejects %s losing just its installRef", (supportClass) => {
    const doc = clone()
    delete hostOfClass(doc, supportClass).activation!.installRef
    expect(validate(doc), `a ${supportClass} host was allowed to omit its install path`).toBe(false)
  })

  // ---- the shape of the block itself ----

  it("rejects an installRef that is not a key of the install block", () => {
    const doc = clone()
    hostOfClass(doc, "NATIVE").activation!.installRef = "bogus"
    expect(validate(doc), "installRef is not pinned to a closed enum").toBe(false)
  })

  it("rejects a command string smuggled in as a new activation field", () => {
    // The defect this design exists to prevent, asserted directly: `additionalProperties: false`
    // is what stops `activation` from becoming a second, unaudited advertiser of commands.
    const doc = clone()
    ;(hostOfClass(doc, "NATIVE").activation as Record<string, unknown>).installCommand =
      "npx calllint scan --auto"
    expect(validate(doc), "activation accepted a free-form command string").toBe(false)
  })

  it("rejects an empty whyHere", () => {
    const doc = clone()
    doc.hosts[0]!.activation!.whyHere = ""
    expect(validate(doc), "an empty reason satisfies the contract").toBe(false)
  })
})

describe("installRef resolves against the install block it names", () => {
  it("names keys project-facts.json actually holds", () => {
    // The cross-file half of the contract. JSON Schema cannot read another document, so the
    // enum in the schema and the keys in project-facts.json are two hand-maintained lists that
    // could silently disagree — and the direction of that disagreement is a published page
    // carrying "undefined" as its install command.
    const install = (readJson(FACTS_PATH) as { install: Record<string, string> }).install
    const keys = Object.keys(install).filter((k) => k !== "description")
    expect(keys.length, "project-facts.json install block is empty").toBeGreaterThan(0)

    const refs = ssot.hosts.map((h) => h.activation?.installRef).filter((r): r is string => !!r)
    expect(refs.length, "no host carries an installRef — this claim would be vacuous").toBeGreaterThan(0)
    expect(refs.filter((r) => !keys.includes(r))).toEqual([])
  })

  it("the generator fails closed on an unknown installRef rather than publishing undefined", () => {
    // A SOURCE PROBE, and worth saying so: it reads `resolveActivation`'s body and asserts the
    // shape of the failure path. It cannot prove the throw fires, because the generator writes
    // 29 files into the served tree on import and this suite may not mutate that tree (see the
    // header). What makes the probe proportionate is that the risk it guards is already covered
    // behaviourally one test up — the committed refs are compared against project-facts.json's
    // real keys — so this layer only has to notice the fail-closed branch being DELETED.
    //
    // Scoped to the function body, not the file. An earlier version matched `activation.
    // installRef` anywhere in the source and then looked ahead for a `throw`; the only literal
    // occurrence of that string is INSIDE the throw's own message, so the probe searched forward
    // from the message and found nothing. It reported a missing guard that was present — the
    // failure mode a probe should be assumed to have until it is negative-controlled.
    const src = read(GENERATOR)
    const start = src.indexOf("function resolveActivation")
    expect(start, "resolveActivation is gone from the generator").toBeGreaterThan(-1)
    // Bounded by the next top-level `function` — enough to hold the body, not the whole file.
    const next = src.indexOf("\nfunction ", start + 1)
    const body = src.slice(start, next === -1 ? src.length : next)

    const lookup = body.search(/INSTALL\[\s*installRef\s*\]/)
    expect(lookup, "resolveActivation no longer looks installRef up in the install block").toBeGreaterThan(-1)

    // The throw must be AFTER the lookup. `resolveActivation` throws twice — once for a host
    // with no activation block at all, once for an unresolvable ref — and an unscoped
    // /throw new Error/ over the body is satisfied by either. Mutating the installRef throw
    // away and re-running proved that: the probe stayed green on the strength of the other
    // one. Anchoring on the lookup position is what makes this assertion about its own subject.
    expect(
      /throw new Error/.test(body.slice(lookup)),
      "resolveActivation no longer throws on an unresolvable installRef — it would publish `undefined`",
    ).toBe(true)

    // The fallback this design exists to forbid: `INSTALL[installRef] || 'npx calllint …'`
    // would satisfy both assertions above while publishing a command nobody chose.
    expect(
      /INSTALL\[\s*installRef\s*\]\s*(?:\|\||\?\?)/.test(body),
      "resolveActivation falls back on an unknown installRef instead of failing closed",
    ).toBe(false)
  })
})

describe("no command text lives outside truthfulCommands", () => {
  it("no activation field carries a calllint invocation", () => {
    // The whole point of `installRef`. A `calllint …` string anywhere in an activation block is
    // a command advertised outside the field HD-01..HD-04 and HD-06 audit.
    const offenders: string[] = []
    for (const h of ssot.hosts) {
      for (const [field, value] of Object.entries(h.activation ?? {})) {
        if (typeof value === "string" && /\b(?:npx\s+)?calllint\s+\w/.test(value)) {
          offenders.push(`${h.id}.activation.${field}`)
        }
      }
    }
    expect(offenders, "activation carries command text, which no HD gate audits").toEqual([])
  })

  it("the template prints no command literal of its own", () => {
    // Pins the rendering layer too: a literal in the template would be invisible to every
    // assertion above, since none of them reads the template.
    const src = read(TEMPLATE)
    const literals = [...src.matchAll(/(?:npx\s+)?calllint\s+[a-z-]+/g)].map((m) => m[0])
    expect(literals, "host-page.hbs hardcodes a command instead of interpolating one").toEqual([])
  })

  it("the verify command a page prints is the host's own truthful command", () => {
    // Read off the served pages rather than the generator, so this measures what shipped.
    const actionable = ssot.hosts.filter((h) => ACTIONABLE.includes(h.supportClass as never))
    expect(actionable.length, "no actionable hosts — vacuous").toBeGreaterThan(0)

    const wrong: string[] = []
    for (const h of actionable) {
      const page = read(`apps/web/public/harnesses/${h.id}/index.html`)
      const expected = h.truthfulCommands[0]
      if (!expected) {
        wrong.push(`${h.id}: actionable but carries no truthful command`)
        continue
      }
      // The page escapes nothing here except `<`/`>` in `<path>`; compare on the escaped form.
      const escaped = expected.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      if (!page.includes(escaped)) wrong.push(`${h.id}: page does not print "${expected}"`)
    }
    expect(wrong).toEqual([])
  })
})

describe("the rendered pages carry the activation path, and only where it is honest", () => {
  const pageOf = (id: string) => read(`apps/web/public/harnesses/${id}/index.html`)

  it("every host page states why scanning that host matters", () => {
    const missing: string[] = []
    for (const h of ssot.hosts) {
      const page = pageOf(h.id)
      if (!page.includes('id="why"')) missing.push(`${h.id}: no #why section`)
      // The reason must be the host's OWN sentence, not a generic one shared by every page.
      else if (!page.includes(h.activation!.whyHere!.slice(0, 40))) {
        missing.push(`${h.id}: #why does not carry the SSOT's whyHere`)
      }
    }
    expect(missing).toEqual([])
  })

  it("actionable hosts get a start and a verify section", () => {
    const actionable = ssot.hosts.filter((h) => ACTIONABLE.includes(h.supportClass as never))
    expect(actionable.length).toBeGreaterThan(0)
    const missing: string[] = []
    for (const h of actionable) {
      const page = pageOf(h.id)
      if (!page.includes('id="start"')) missing.push(`${h.id}: no #start`)
      if (!page.includes('id="verify"')) missing.push(`${h.id}: no #verify`)
    }
    expect(missing).toEqual([])
  })

  it("guide-only hosts get NEITHER — a page with no honest next step must not fake one", () => {
    const guideOnly = ssot.hosts.filter((h) => GUIDE_ONLY.includes(h.supportClass as never))
    expect(guideOnly.length).toBeGreaterThan(0)
    const overClaiming: string[] = []
    for (const h of guideOnly) {
      const page = pageOf(h.id)
      if (page.includes('id="start"')) overClaiming.push(`${h.id}: has #start`)
      if (page.includes('id="verify"')) overClaiming.push(`${h.id}: has #verify`)
    }
    expect(overClaiming).toEqual([])
  })

  it("the SAFE label never appears unqualified on a host page", () => {
    // NOTE (§13 trust leg): this test passed for all 18 pages BEFORE the trust paragraph was
    // made unconditional, because the #verify section it describes carried the qualification —
    // and #verify is guarded, so on the 9 guide-only pages the label was absent and the loop
    // `continue`d. A test that skips the cohort at risk is not evidence about it. The
    // unconditional arm is asserted below, over all hosts with no early exit.
    // `check:public-copy` rule 20 forbids a bare SAFE label, but its subject is
    // `apps/web/public/trust/**`, so harness pages are outside it. The REASON applies here
    // anyway: the #verify section prints the public SAFE label, and CLAUDE.md's verdict
    // semantics are that SAFE means "no blockers observed under current evidence" and is never
    // a guarantee. So any page carrying the label must also carry the qualification.
    const SAFE_LABEL = "No blockers observed"
    const unqualified: string[] = []
    for (const h of ssot.hosts) {
      const page = pageOf(h.id)
      if (!page.includes(SAFE_LABEL)) continue
      const qualified =
        /not a guarantee/i.test(page) && /Insufficient evidence/.test(page)
      if (!qualified) unqualified.push(h.id)
    }
    expect(unqualified, "a host page shows SAFE without saying it is not a guarantee").toEqual([])
  })
})

/**
 * new20 §13 trust leg — the safety framing must not be a side effect of having an install path.
 *
 * WHAT WENT WRONG, MEASURED. The verdict-semantics paragraph used to sit INSIDE
 * `{{#if activation.installCommand}}`, next to "How to verify it worked". So the 9 hosts with no
 * `installRef` lost "CallLint never executes the server it judges" as a CONSEQUENCE of having no
 * start path — two unrelated concerns fused by one conditional. Across the 18 pages the
 * correlation was exact, zero mismatches: `never executes` 0/18, `determinist` 2/18 (both stray
 * hits being SSOT coverage-boundary prose about the extractor, not the claim), `reproducib` 0/18.
 * The hosts a visitor is least able to verify were the ones told least about what CallLint does.
 *
 * WHY A TEST AND NOT JUST THE COPY GATE. `check-public-copy.mjs` check 25 now asserts the clauses
 * per host page, and it is the behavioural gate — it reads what shipped. But it reads the OUTPUT.
 * Re-nesting the section inside any `{{#if}}` whose condition happens to hold for all 18 hosts
 * today would keep every page green while restoring the exact fragility that produced the defect;
 * the next host to enter with a falsy condition would ship bare, and the gate would first object
 * at that point rather than at the change that caused it. So this block pins the STRUCTURE.
 *
 * ANTI-VACUITY, AND A CONTROL ON THE WALKER ITSELF. `depthOfSection` is the load-bearing helper
 * here, and a helper that silently returned 0 for everything would make the structural claim pass
 * unconditionally. It is therefore controlled in both directions against a section whose nesting
 * is KNOWN and must stay known: `#start` is guarded by design, so it must measure > 0, while
 * `#trust` must measure exactly 0. A single-direction assertion would have been satisfiable by a
 * broken walker.
 */
describe("the trust framing is unconditional (new20 §13)", () => {
  const pageOf = (id: string) => read(`apps/web/public/harnesses/${id}/index.html`)

  /**
   * How many unclosed `{{#if}}`/`{{#unless}}`/`{{#each}}` blocks enclose `id="<section>"`.
   *
   * Counts opens minus closes over the template text preceding the anchor. `{{/if}}` and friends
   * all close one block, and handlebars has no way to close a block out of order, so the running
   * balance at the anchor IS its nesting depth. `{{!-- … --}}` comments are stripped first: this
   * file's own docblocks discuss `{{#if activation.installCommand}}` by name inside template
   * comments, and counting those would report phantom depth.
   */
  function depthOfSection(src: string, section: string): number {
    const withoutComments = src.replace(/\{\{!--[\s\S]*?--\}\}/g, "")
    const anchor = withoutComments.indexOf(`id="${section}"`)
    expect(anchor, `the template has no id="${section}" section`).toBeGreaterThan(-1)
    const before = withoutComments.slice(0, anchor)
    const opens = (before.match(/\{\{#(?:if|unless|each)\b/g) ?? []).length
    const closes = (before.match(/\{\{\/(?:if|unless|each)\}\}/g) ?? []).length
    return opens - closes
  }

  it("the walker measures a known-guarded section as nested — the control on the walker", () => {
    // #start is inside `{{#if activation.installCommand}}` by design and must stay there: a
    // guide-only host has no honest start path. If this ever reads 0, the helper is broken and
    // the assertion below is worthless rather than reassuring.
    expect(
      depthOfSection(read(TEMPLATE), "start"),
      "#start reads as unguarded — either the walker is broken or guide-only hosts now print an install path",
    ).toBeGreaterThan(0)
  })

  it("the trust section is enclosed by no conditional at all", () => {
    expect(
      depthOfSection(read(TEMPLATE), "trust"),
      "the trust section is nested inside a conditional — the §13 defect, where safety framing is " +
        "collateral of some other condition holding",
    ).toBe(0)
  })

  it("the template renders the governed sentence verbatim rather than restating it", () => {
    // One writer per fact, the same rule `installRef` exists to enforce for commands. The trust
    // claim's writer is project-facts.json's `headlines.trustLine`; the template must interpolate
    // it. Rebuilding the sentence here — or from `facts.claims`'s booleans, which carry the same
    // three properties — would make this template a second, unaudited author of governed copy.
    const src = read(TEMPLATE)
    expect(src, "the template does not interpolate trustLine").toContain("{{trustLine}}")

    const trustLine = (readJson(FACTS_PATH) as { headlines: { trustLine?: string } }).headlines
      .trustLine
    expect(trustLine, "project-facts.json has no headlines.trustLine to render").toBeTruthy()

    // Its distinctive clause must NOT be written out as a literal — but the subject is RENDERED
    // text, so `{{!-- … --}}` is stripped first, exactly as `depthOfSection` does. The template's
    // own docblock names this phrase while explaining that the template must not author it; the
    // first version of this assertion read the raw source and failed on that comment, reporting a
    // hardcoded claim on a template that hardcodes nothing. A comment is not a published string.
    const rendered = src.replace(/\{\{!--[\s\S]*?--\}\}/g, "")
    expect(
      rendered.includes("Never executes the server it judges"),
      "the template hardcodes the trust claim instead of interpolating trustLine",
    ).toBe(false)
  })

  it("every host page carries every clause of the governed sentence", () => {
    // The behavioural half, over ALL hosts with no `continue` and no cohort filter. Duplicates
    // check 25's subject on purpose: this layer notices the copy gate's check being DELETED,
    // which a gate reading its own green cannot.
    const trustLine = (readJson(FACTS_PATH) as { headlines: { trustLine?: string } }).headlines
      .trustLine
    expect(trustLine, "no governed trust sentence — this claim would be vacuous").toBeTruthy()

    const clauses = trustLine!
      .split(/(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    expect(clauses.length, "trustLine did not split into clauses — the per-clause check is vacuous")
      .toBeGreaterThanOrEqual(3)
    expect(ssot.hosts.length, "no hosts — vacuous").toBeGreaterThan(0)

    const offenders: string[] = []
    for (const h of ssot.hosts) {
      const page = pageOf(h.id)
      if (!page.includes('id="trust"')) offenders.push(`${h.id}: no #trust section`)
      const missing = clauses.filter((c) => !page.includes(c))
      if (missing.length > 0) offenders.push(`${h.id}: missing ${JSON.stringify(missing)}`)
    }
    expect(offenders, "host page(s) omit the governed trust copy").toEqual([])
  })

  it("the guide-only hosts specifically carry it — the cohort the defect hit", () => {
    // Named separately from the all-hosts assertion above. That one would still pass if the
    // section became conditional on something true for 9 of 18 pages, provided the SSOT shrank to
    // those 9; this one pins the cohort that had 0/9 coverage, so it cannot pass by attrition.
    const guideOnly = ssot.hosts.filter((h) => GUIDE_ONLY.includes(h.supportClass as never))
    expect(guideOnly.length, "no guide-only hosts — the regression cohort is empty").toBeGreaterThan(
      0,
    )
    const bare: string[] = []
    for (const h of guideOnly) {
      const page = pageOf(h.id)
      // These pages have NO #start and NO #verify, and must still say what CallLint does.
      if (page.includes('id="start"')) bare.push(`${h.id}: unexpectedly has #start`)
      if (!page.includes('id="trust"')) bare.push(`${h.id}: no #trust`)
      if (!/Never executes the server it judges/.test(page)) {
        bare.push(`${h.id}: does not state that CallLint never executes the server`)
      }
    }
    expect(bare, "a host with no install path also has no safety framing — the §13 defect").toEqual(
      [],
    )
  })
})
