import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, it, expect } from "vitest"
import {
  EVIDENCE_GAP_CODES,
  makeGap,
  mergeResults,
  type EvidenceSubject,
} from "../src/index.js"

/**
 * new11 PR-05 — schema compatibility + malformed-input for the evidence-model.v0
 * schemas, plus an anti-drift guard: the JSON Schema `code` enum MUST match the
 * TS EVIDENCE_GAP_CODES exactly (a generated public claim can't drift from code).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", p), "utf8"))
const subjectSchema = read("evidence-subject.schema.json")
const gapSchema = read("evidence-gap.schema.json")
const bundleSchema = read("evidence-bundle.schema.json")

const ajv = new Ajv({ allErrors: true })
ajv.addSchema(subjectSchema)
ajv.addSchema(gapSchema)
const validateSubject = ajv.compile(subjectSchema)
const validateGap = ajv.compile(gapSchema)
const validateBundle = ajv.compile(bundleSchema)

const subject: EvidenceSubject = {
  schema: "calllint.evidence-subject.v0",
  subjectType: "npm-package",
  id: "npm:foo@1.2.3",
}

describe("evidence-model schemas", () => {
  it("a valid subject validates; a bad subjectType is rejected", () => {
    expect(validateSubject(subject)).toBe(true)
    expect(validateSubject({ ...subject, subjectType: "banana" })).toBe(false)
  })

  it("a valid gap validates; an off-vocabulary code is rejected", () => {
    const gap = makeGap("PACKAGE_NOT_FOUND", "no such package", { missingFields: ["identity.version"] })
    expect(validateGap(gap)).toBe(true)
    expect(validateGap({ ...gap, code: "NOPE" })).toBe(false)
  })

  it("a merged bundle validates against the bundle schema", () => {
    const bundle = mergeResults(subject, [
      { resolver: "R1", status: "complete", items: [{ field: "identity.version", value: "1.2.3", tier: "artifact-bound", source: "R1" }], gaps: [] },
    ])
    const ok = validateBundle(bundle)
    if (!ok) console.error(validateBundle.errors)
    expect(ok).toBe(true)
  })

  it("rejects a bundle with additional properties (additionalProperties:false)", () => {
    expect(validateBundle({ schema: "calllint.evidence-bundle.v0", subject, state: "COMPLETE", items: [], gaps: [], extra: 1 })).toBe(false)
  })

  it("the schema code enum matches the TS gap-code vocabulary exactly (no drift)", () => {
    const schemaCodes = [...gapSchema.properties.code.enum].sort()
    const tsCodes = [...EVIDENCE_GAP_CODES].sort()
    expect(schemaCodes).toEqual(tsCodes)
  })
})
