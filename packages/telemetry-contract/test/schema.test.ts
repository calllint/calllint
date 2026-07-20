/**
 * new11 PR-04 — telemetry-event schema: compatibility + malformed (new11 §13/§14)
 * and alignment with the code contract (schema enums == ALLOWED_EVENTS/SOURCES).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, it, expect } from "vitest"
import { sanitizeEvent, ALLOWED_EVENTS, SOURCES, FORBIDDEN_FIELDS } from "../src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const schema = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "schemas/telemetry-event.schema.json"), "utf8"),
)
const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile(schema)

describe("telemetry-event schema", () => {
  it("a sanitized event validates", () => {
    const ev = sanitizeEvent({
      eventName: "decision_block",
      source: "ci",
      result: "BLOCK",
      durationMs: 80,
      anonymousInstallationId: "cli-anon-3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      productVersion: "1.6.0",
    })
    const ok = validate(ev)
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })

  it("rejects any forbidden field via additionalProperties:false", () => {
    for (const f of FORBIDDEN_FIELDS) {
      const bad = { eventVersion: "1.0.0", eventName: "decision_safe", timestamp: "", source: "cli", [f]: "x" }
      expect(validate(bad)).toBe(false)
    }
  })

  it("rejects an off-vocabulary eventName and a bad installation id", () => {
    expect(validate({ eventVersion: "1.0.0", eventName: "nope", timestamp: "", source: "cli" })).toBe(false)
    expect(
      validate({ eventVersion: "1.0.0", eventName: "badge_rendered", timestamp: "", source: "server", anonymousInstallationId: "deadbeef" }),
    ).toBe(false)
  })

  it("schema enums stay aligned with the code contract (no drift)", () => {
    expect(new Set(schema.properties.eventName.enum)).toEqual(new Set(ALLOWED_EVENTS))
    expect(new Set(schema.properties.source.enum)).toEqual(new Set(SOURCES))
  })
})
