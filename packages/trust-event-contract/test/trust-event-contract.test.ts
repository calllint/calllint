/**
 * Phase 2.5-B — trust-event contract: schema compatibility + malformed-input +
 * fail-closed sanitizer + anti-drift (new13 §Phase-2.5-B; ADR 0055 §2/§5).
 *
 * Mirrors packages/telemetry-contract/test/schema.test.ts exactly: every instance
 * under test is produced by the SHIPPING sanitizer (never hand-authored), so the
 * schema can never drift from the code that emits the artifact (new11 §14). This
 * dedicated test is why the schema is deliberately NOT added to the consolidated
 * tests/schema/schema-compatibility.test.ts gate — the same convention that keeps
 * telemetry-event out of that gate (it owns its schema test in its own package).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, it, expect } from "vitest"
import {
  sanitizeTrustEvent,
  TRUST_EVENT_VERSION,
  TRUST_EVENTS,
  FORBIDDEN_FIELDS,
  MAX_RAW_BYTES,
  type SanitizedTrustEvent,
} from "../src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const schema = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "schemas/calllint.trust-event.v1.schema.json"), "utf8"),
)
const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

const NOW = "2026-07-24T12:00:00.000Z"
const BUCKET = "sha256:" + "a".repeat(64)

describe("calllint.trust-event.v1 — schema compatibility", () => {
  it("a sanitized event (no dimension) validates against the schema", () => {
    const ev = sanitizeTrustEvent({ schema: TRUST_EVENT_VERSION, event: "trust_page_viewed" }, NOW)
    expect(ev).not.toBeNull()
    const ok = validate(ev)
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })

  it("a sanitized event WITH a server-hashed pageBucket validates", () => {
    const ev = sanitizeTrustEvent(
      { schema: TRUST_EVENT_VERSION, event: "trust_page_to_install", pageBucket: BUCKET },
      NOW,
    )
    expect(ev).not.toBeNull()
    expect((ev as SanitizedTrustEvent).pageBucket).toBe(BUCKET)
    expect(validate(ev)).toBe(true)
  })

  it("rejects an unknown top-level property via additionalProperties:false", () => {
    const bad = { schema: TRUST_EVENT_VERSION, event: "trust_page_viewed", ts: NOW, extra: "x" }
    expect(validate(bad)).toBe(false)
  })

  it("rejects an off-vocabulary event and a raw (unhashed) pageBucket", () => {
    expect(validate({ schema: TRUST_EVENT_VERSION, event: "nope", ts: NOW })).toBe(false)
    expect(validate({ schema: TRUST_EVENT_VERSION, event: "trust_page_viewed", ts: NOW, pageBucket: "/trust/x.html" })).toBe(false)
    expect(validate({ schema: "calllint.telemetry-event", event: "trust_page_viewed", ts: NOW })).toBe(false)
  })
})

describe("sanitizeTrustEvent — fail-closed (drops → null, never stored)", () => {
  const valid = { schema: TRUST_EVENT_VERSION, event: "claim_cta_clicked" } as const

  it("returns a stable, allowlisted object for a valid input", () => {
    const ev = sanitizeTrustEvent(valid, NOW)
    expect(ev).toEqual({ schema: TRUST_EVENT_VERSION, event: "claim_cta_clicked", ts: NOW })
  })

  it("drops a wrong wire tag", () => {
    expect(sanitizeTrustEvent({ schema: "calllint.telemetry-event", event: "trust_page_viewed" }, NOW)).toBeNull()
  })

  it("drops an unknown event name", () => {
    expect(sanitizeTrustEvent({ schema: TRUST_EVENT_VERSION, event: "surprise" }, NOW)).toBeNull()
  })

  it("drops when ANY forbidden field is present (defense in depth, never stripped)", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(sanitizeTrustEvent({ schema: TRUST_EVENT_VERSION, event: "trust_page_viewed", [f]: "x" }, NOW)).toBeNull()
    }
  })

  it("drops a malformed pageBucket (a broken caller fails the whole write closed)", () => {
    expect(sanitizeTrustEvent({ schema: TRUST_EVENT_VERSION, event: "trust_page_viewed", pageBucket: "nope" }, NOW)).toBeNull()
    expect(sanitizeTrustEvent({ schema: TRUST_EVENT_VERSION, event: "trust_page_viewed", pageBucket: "sha256:" + "Z".repeat(64) }, NOW)).toBeNull()
  })

  it("drops an oversized payload unread", () => {
    const big = { schema: TRUST_EVENT_VERSION, event: "trust_page_viewed", pageBucket: BUCKET, pad: "x".repeat(MAX_RAW_BYTES) }
    // `pad` is an unknown extra (dropped from output anyway); the size guard fires first.
    expect(sanitizeTrustEvent(big, NOW)).toBeNull()
  })

  it("drops non-objects, arrays, and a bad server clock", () => {
    expect(sanitizeTrustEvent(null, NOW)).toBeNull()
    expect(sanitizeTrustEvent("str", NOW)).toBeNull()
    expect(sanitizeTrustEvent([valid], NOW)).toBeNull()
    expect(sanitizeTrustEvent(valid, "not-a-date")).toBeNull()
  })

  it("never copies an unknown field through (allowlist output only)", () => {
    // A benign unknown field that is NOT on the denylist must be dropped from
    // OUTPUT, not carried — the closed shape is built field by field.
    const ev = sanitizeTrustEvent({ schema: TRUST_EVENT_VERSION, event: "app_created_viewed", benign: 1 }, NOW)
    expect(ev).not.toBeNull()
    expect(ev).not.toHaveProperty("benign")
  })
})

describe("no drift between code contract and schema", () => {
  it("the wire tag equals the schema const", () => {
    expect(schema.properties.schema.const).toBe(TRUST_EVENT_VERSION)
  })

  it("TRUST_EVENTS equals the schema event enum", () => {
    expect(new Set(schema.properties.event.enum)).toEqual(new Set(TRUST_EVENTS))
  })
})
