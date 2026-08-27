/**
 * new20 §4 / Sprint 4 — `submission` records the human act, on its own axis.
 *
 * THE DEFECT, MEASURED 2026-08-23. `state` was carrying two questions at once: where the
 * LISTING sits, and whether a human has ACTED. Those come apart. `cline`/`cline-marketplace-pr`
 * had a real submission — PR cline/marketplace#49, opened 2026-08-18, still open — and the SSOT
 * could not say so. The record held a `submissionUrl` and a prose `note` reading "open, verified
 * 2026-08-23"; that date is when we last CHECKED, not when anyone acted, so the date of the act
 * was recorded nowhere in the repository. Every other shelf channel, which nobody has touched,
 * was structurally indistinguishable from this one to any consumer reading `state`.
 *
 * WHY THERE IS NO `status` FIELD, THOUGH §4 ASKS FOR ONE. Every value it would carry is already
 * representable, by a field a gate already checks:
 *   submitted at all  →  this block existing
 *   accepted          →  `state: AVAILABLE` + `liveUrl`, evidence required by HD-07
 *   rejected          →  `state: BLOCKED` + `blocker`, a reason required by HD-05
 *   withdrawn         →  no record, no consumer
 * A `status` enum would therefore be one redundant member, two restating `state`, and one
 * unpopulated — the second lifecycle §3 forbids, in the same shape ADR 0001 already rejected
 * when §4 asked for six `surfaceStatus` values. What was genuinely missing was the DATE, so
 * that is what the field carries. See artifacts/adr/0002-submission-records-the-act.md.
 *
 * WHAT EACH LAYER CATCHES:
 *   schema arm 3 (`submissionUrl` ⇒ `submission`)
 *                            ajv rejects a recorded submission whose date has no home. This arm
 *                            had a LIVE subject on the commit that introduced it: the shipped
 *                            SSOT violated it until the date was added, which is the opposite of
 *                            the usual "vacuous today, constrains the first one written".
 *   schema arm 4 (`submission` ⇒ state ≠ READY_NOT_SUBMITTED)
 *                            the one corner where the two axes contradict, made
 *                            unrepresentable. Also gives that enum member a checkable job:
 *                            ADR 0001 left it with zero records and nothing constraining it.
 *   HD-08                    the two things a JSON Schema regex structurally cannot say — that
 *                            `2026-02-31` is not a day, and that a date is not in the future —
 *                            plus the readable sentence for arm 4, which ajv reports only as
 *                            "must NOT be valid" against a JSON Pointer.
 *   this file                the committed pair. The seven shell controls that proved each arm
 *                            bites were ad-hoc; a probe nobody re-runs is not a guard. Only this
 *                            layer notices an ARM BEING DELETED — ajv over a schema with no arm
 *                            reports success, and HD-08's own premise check would too if the
 *                            cohort emptied at the same time.
 *
 * MUTATION IS IN-MEMORY ONLY — a `structuredClone`, never a write, for the reason recorded at
 * the head of `available-requires-evidence.invariants.test.ts`: a vitest that mutated the served
 * tree would race the other suites for the same files.
 *
 * ANTI-VACUITY. Every claim pins its denominator first. The cohort here is ONE channel, which
 * makes that discipline load-bearing rather than ceremonial: a lookup that silently found no
 * submission would leave every assertion below trivially satisfied.
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
const GATE_PATH = "scripts/check-harness-distribution.mjs"

interface Primitive {
  kind: string
  state: string
  submissionUrl?: string
  submission?: { date?: string }
  note?: string
}
interface Host {
  id: string
  distributionPrimitives: Primitive[]
}
interface Ssot {
  hosts: Host[]
}

let ssot: Ssot
let schema: Record<string, unknown>
let validate: ValidateFunction

const clone = (): Ssot => structuredClone(ssot)

function primitive(doc: Ssot, hostId: string, kind: string): Primitive {
  const host = doc.hosts.find((h) => h.id === hostId)
  if (!host) throw new Error(`fixture host ${hostId} is gone from the SSOT`)
  const p = host.distributionPrimitives.find((x) => x.kind === kind)
  if (!p) throw new Error(`fixture channel ${hostId}/${kind} is gone from the SSOT`)
  return p
}

/** Every channel, flattened, with its host id — the denominator for the cohort assertions. */
function allChannels(doc: Ssot = ssot): Array<Primitive & { host: string }> {
  return doc.hosts.flatMap((h) => h.distributionPrimitives.map((p) => ({ host: h.id, ...p })))
}

beforeAll(() => {
  ssot = readJson(SSOT_PATH)
  schema = readJson(SCHEMA_PATH)
  // Same construction as the two schema gates, deliberately: this file must not pass under
  // laxer settings than the gates that ship.
  const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
  validate = ajv.compile(schema)
})

function primitiveDefinition(): Record<string, unknown> {
  const doc = schema as { definitions?: Record<string, Record<string, unknown> | undefined> }
  const def = doc.definitions?.primitive
  expect(def, "schema.definitions.primitive is gone — every assertion here is moot").toBeDefined()
  return def as Record<string, unknown>
}

type Arm = {
  if?: { required?: string[]; properties?: Record<string, { const?: string }> }
  then?: { required?: string[]; properties?: Record<string, unknown> }
}

function arms(): Arm[] {
  const allOf = primitiveDefinition().allOf as Arm[] | undefined
  expect(Array.isArray(allOf), "definitions.primitive carries no allOf conditions").toBe(true)
  return allOf ?? []
}

describe("the schema declares the submission axis", () => {
  it("keeps the field optional, dated, and closed", () => {
    const props = primitiveDefinition().properties as Record<string, Record<string, unknown>>
    const sub = props?.submission
    expect(sub, "definitions.primitive.properties.submission is gone").toBeDefined()

    expect(sub?.required, "submission must require a date — a submission with no time is prose").toEqual(["date"])
    expect(
      sub?.additionalProperties,
      "submission must be closed, or a misspelled key becomes a silently ignored fact",
    ).toBe(false)

    const dateProp = (sub?.properties as Record<string, Record<string, unknown>>)?.date
    expect(dateProp?.pattern, "submission.date carries no shape constraint").toBe(
      "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    )
  })

  it("does NOT add a status enum — §4's other values are already representable", () => {
    /* This asserts an ABSENCE, which needs its reason attached or it reads as an oversight.
     * ADR 0002 records the argument; the assertion exists so that adding `status` later has to
     * confront it rather than accreting a second lifecycle by increments. */
    const props = primitiveDefinition().properties as Record<string, unknown>
    const sub = (props?.submission as Record<string, unknown>)?.properties as Record<string, unknown>
    expect(Object.keys(sub ?? {}), "submission grew a second key — see ADR 0002 before adding one").toEqual([
      "date",
    ])
  })

  it("does NOT extend the state enum — the axis is new, the lifecycle is not", () => {
    // The binding constraint on this sprint was "不要增加新 lifecycle". The enum is the thing
    // that would have grown if the field had been implemented as a state, so it is pinned.
    const props = primitiveDefinition().properties as Record<string, Record<string, unknown>>
    expect(props?.state?.enum).toEqual([
      "AVAILABLE",
      "AUDIT_REQUIRED",
      "READY_NOT_SUBMITTED",
      "PENDING_UPSTREAM",
      "BLOCKED",
    ])
  })

  it("carries both submission arms alongside the two AVAILABLE arms, not instead of them", () => {
    /* The failure this catches is mine, from the first draft: appending a second `allOf` key to
     * the same object. JSON.parse keeps the LAST duplicate key silently, so both
     * AVAILABLE-evidence arms vanished while the file still looked correct in a diff. Counting
     * the arms by their subject is what makes that unrepresentable here. */
    const list = arms()
    const byIf = (pred: (a: Arm) => boolean, what: string) => {
      const found = list.filter(pred)
      expect(found.length, `no arm found for ${what}`).toBe(1)
      return found[0]!
    }

    byIf((a) => a.if?.properties?.state?.const === "AVAILABLE", "state === AVAILABLE")
    byIf((a) => a.if?.required?.[0] === "liveUrl", "liveUrl ⇒ AVAILABLE")

    const urlArm = byIf((a) => a.if?.required?.[0] === "submissionUrl", "submissionUrl ⇒ submission")
    expect(urlArm.then?.required, "a submissionUrl no longer forces a recorded date").toEqual(["submission"])

    const orthArm = byIf((a) => a.if?.required?.[0] === "submission", "submission ⇒ not READY_NOT_SUBMITTED")
    const stateThen = orthArm.then?.properties?.state as { not?: { const?: string } } | undefined
    expect(
      stateThen?.not?.const,
      "a submission may sit under READY_NOT_SUBMITTED — the two axes can contradict again",
    ).toBe("READY_NOT_SUBMITTED")
  })
})

describe("positive fixture — the shipped SSOT records the one act that happened", () => {
  it("validates against its own schema", () => {
    expect(
      validate(ssot),
      `the shipped SSOT violates its own schema:\n${JSON.stringify(validate.errors, null, 1)}`,
    ).toBe(true)
  })

  it("has a non-empty submission cohort, every member a real past day", () => {
    const channels = allChannels()
    expect(channels.length, "no channels in the SSOT — nothing to audit").toBeGreaterThan(0)

    const recorded = channels.filter((c) => c.submission)
    expect(
      recorded.length,
      "no channel records a submission — every assertion in this file is vacuous",
    ).toBeGreaterThan(0)

    const today = new Date().toISOString().slice(0, 10)
    for (const c of recorded) {
      const d = c.submission?.date
      expect(typeof d, `${c.host}/${c.kind}: submission has no date`).toBe("string")
      // Round-trip, not `new Date()` alone: that constructor rolls 2026-02-31 to March 3 rather
      // than failing, so re-serialising is the only way to learn the input was not a day.
      expect(
        new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10),
        `${c.host}/${c.kind}: submission.date ${d} is not a real calendar day`,
      ).toBe(d)
      expect(d! <= today, `${c.host}/${c.kind}: submission.date ${d} is in the future`).toBe(true)
    }
  })

  it("records a date for every channel that names where it was submitted", () => {
    const withUrl = allChannels().filter((c) => typeof c.submissionUrl === "string" && c.submissionUrl)
    expect(
      withUrl.length,
      "no channel carries a submissionUrl — the arm this pairs with has no subject",
    ).toBeGreaterThan(0)

    const undated = withUrl.filter((c) => !c.submission?.date)
    expect(undated.map((c) => `${c.host}/${c.kind}`), "a submission URL with no recorded date").toEqual([])
  })

  it("keeps cline's PR #49 as the concrete subject, dated when it was opened", () => {
    /* Pinned deliberately, and it is the only host-specific assertion here. This record is the
     * reason the field exists: the act was real, its date was in no field, and `note` said
     * 2026-08-23 — the day we checked. If someone reverts the date to the verification date,
     * this is what objects, and the distinction is the whole point of the field. */
    const p = primitive(ssot, "cline", "cline-marketplace-pr")
    expect(p.submissionUrl).toBe("https://github.com/cline/marketplace/pull/49")
    expect(p.submission?.date, "the recorded date is not when PR #49 was opened").toBe("2026-08-18")
    expect(p.state, "the listing axis must still say the PR is with upstream").toBe("PENDING_UPSTREAM")
  })

  it("holds every READY_NOT_SUBMITTED record to the claim its own name makes", () => {
    /* This replaced an emptiness assertion on 2026-08-27, and the reason is recorded because the
     * diff looks like a guard being relaxed. The old test said arm 4 constrains a state no record
     * uses — true under ADR 0001, and it said in its own comment that it was an observation rather
     * than a rule, and that whoever populated the state would come here to read why. That happened:
     * the E-2 audit resolved `copilot-cli/github-copilot-plugin`, whose PR target is real and whose
     * PR nobody has opened. Asserting emptiness again would mean the SSOT may never record a
     * ready-but-unsubmitted channel, which is a state the world can be in.
     *
     * So the emptiness claim is replaced by the claim arm 4 exists to make, now with a subject: a
     * channel asserting in its own name that nobody acted must carry no evidence that anyone did.
     * That is strictly stronger than counting rows — it is checked per record, so it also binds
     * every future one. `submissionUrl` is included because the schema requires a date alongside it,
     * so carrying one here is the same contradiction reached one step earlier. */
    const users = allChannels().filter((c) => c.state === "READY_NOT_SUBMITTED")
    expect(users.length, "the state has no record, so this is vacuous again — see the ADR").toBeGreaterThan(0)

    for (const c of users) {
      expect(c.submission, `${c.host}/${c.kind}: labelled not-submitted while recording an act`).toBeUndefined()
      expect(
        c.submissionUrl,
        `${c.host}/${c.kind}: carries a submissionUrl, which the schema reads as evidence a human ` +
          `acted (it forces a date). A PR target that nobody has opened belongs in \`note\`.`,
      ).toBeUndefined()
    }
  })
})

describe("negative fixture — the two arms reject what they exist to reject", () => {
  it("rejects a submissionUrl whose date has no home", () => {
    const doc = clone()
    delete primitive(doc, "cline", "cline-marketplace-pr").submission
    expect(
      validate(doc),
      "a channel can name where it was submitted while recording no date — the state the SSOT " +
        "was actually in before this field existed",
    ).toBe(false)
  })

  it("rejects a submission recorded under READY_NOT_SUBMITTED", () => {
    const doc = clone()
    primitive(doc, "cline", "cline-marketplace-pr").state = "READY_NOT_SUBMITTED"
    expect(
      validate(doc),
      "a channel can be labelled not-submitted while recording a submission — the projections " +
        "would queue the work again",
    ).toBe(false)
  })

  it("rejects the contradiction on EVERY channel, not just the one measured", () => {
    /* The generalisation, for the reason the AVAILABLE fixture states: a control pinned to
     * `cline` passes while any other channel stays floppable. Each clone gets a submission AND
     * the contradicting state, so the only thing standing between it and validity is arm 4. */
    const channels = allChannels()
    expect(channels.length).toBeGreaterThan(0)

    const stillOpen: string[] = []
    for (const c of channels) {
      const doc = clone()
      const p = primitive(doc, c.host, c.kind)
      p.submission = { date: "2026-08-18" }
      p.state = "READY_NOT_SUBMITTED"
      // A BLOCKED channel keeps its blocker, which HD-05 pairs with the state; ajv does not
      // check that relation, so this stays a clean single-variable probe of arm 4.
      if (validate(doc)) stillOpen.push(`${c.host}/${c.kind}`)
    }
    expect(stillOpen, "these channels accept a submission under READY_NOT_SUBMITTED").toEqual([])
  })

  it("rejects a misspelled key inside the block", () => {
    const doc = clone()
    // `submittedOn` is the name I would have reached for first, which is exactly why the block
    // is closed: an ignored key would read as a recorded date to a human skimming the diff.
    primitive(doc, "cline", "cline-marketplace-pr").submission = { submittedOn: "2026-08-18" } as {
      date?: string
    }
    expect(validate(doc), "an unknown key inside submission is silently accepted").toBe(false)
  })

  it("rejects a submission block with no date at all", () => {
    const doc = clone()
    primitive(doc, "cline", "cline-marketplace-pr").submission = {}
    expect(validate(doc), "an empty submission block asserts an act with no time").toBe(false)
  })
})

describe("the rule discriminates on the axis, not on the record", () => {
  it("accepts a submission under any state that does not deny it", () => {
    /* The over-blocking check. A rule that rejected every state but one would push somebody
     * toward deleting a true record to satisfy it. All four other members must stay legal:
     * a submitted channel can be awaiting upstream, unverified, live, or subsequently rejected. */
    const legal = ["AVAILABLE", "AUDIT_REQUIRED", "PENDING_UPSTREAM", "BLOCKED"]
    for (const state of legal) {
      const doc = clone()
      const p = primitive(doc, "cline", "cline-marketplace-pr")
      p.state = state
      p.submission = { date: "2026-08-18" }
      // Satisfy the OTHER arms so this probe isolates the submission axis: AVAILABLE needs
      // evidence (HD-07's rule), BLOCKED needs a blocker (HD-05's, gate-side only).
      if (state === "AVAILABLE") (p as { upstream?: string }).upstream = "officialMcpRegistry"
      if (state === "BLOCKED") (p as { blocker?: string }).blocker = "fixture"
      expect(
        validate(doc),
        `a submission under ${state} was rejected — the rule over-blocks:\n${JSON.stringify(validate.errors, null, 1)}`,
      ).toBe(true)
    }
  })

  it("keeps the field optional — an untouched channel records nothing", () => {
    /* The 30 channels nobody has submitted to must stay valid with no block. A `required` here
     * would have forced a fabricated date onto every one of them, which is the failure mode this
     * field exists to prevent, arrived at from the other direction. */
    const untouched = allChannels().filter((c) => !c.submission)
    expect(untouched.length, "every channel records a submission — optionality is untested").toBeGreaterThan(0)
    expect(validate(ssot)).toBe(true)
  })
})

describe("HD-08 is wired and cannot pass over an empty cohort", () => {
  /* The gate's source is the subject here, for the reason `derived-projection-totality` records
   * about the generator: a fixture that only checks the DATA cannot notice the gate being
   * deleted. Anchored on the checks that make HD-08 more than a restatement of the schema. */
  let gate: string

  beforeAll(() => {
    gate = read(GATE_PATH)
  })

  it("is registered with its own heading", () => {
    expect(gate, "HD-08 is gone from the harness distribution gate").toContain("[HD-08]")
  })

  it("checks the two things the schema pattern cannot", () => {
    const start = gate.indexOf("[HD-08]")
    expect(start, "cannot locate HD-08 — the assertions below would read another gate").toBeGreaterThan(-1)
    const body = gate.slice(start)

    // The real-day check must round-trip rather than trust the constructor.
    expect(body, "HD-08 no longer round-trips the date — new Date() rolls 2026-02-31 silently").toMatch(
      /toISOString\(\)\.slice\(0, 10\) !== raw/,
    )
    // The tense check.
    expect(body, "HD-08 no longer rejects a future date").toMatch(/raw > today/)
    // The readable form of arm 4.
    expect(body, "HD-08 no longer names the READY_NOT_SUBMITTED contradiction").toContain(
      "READY_NOT_SUBMITTED",
    )
  })

  it("fails rather than shrinking when its cohort empties", () => {
    /* HD-08's premise: the schema requires `submission` wherever `submissionUrl` appears, so a
     * non-empty cohort is derivable rather than assumed. If the arm were removed AND the date
     * deleted, a gate that merely iterated would report success over zero records. */
    const start = gate.indexOf("[HD-08]")
    const body = gate.slice(start)
    expect(
      body,
      "HD-08 does not check that a submissionUrl cohort implies a submission cohort — it would " +
        "print a checkmark over zero records",
    ).toMatch(/withUrl\.length > 0 && withSubmission\.length === 0/)
  })
})
