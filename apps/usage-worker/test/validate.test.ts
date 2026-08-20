/**
 * Trust-boundary tests (new18 §19). These are adversarial by design: the ingress
 * must reject hostile input even though the CLI's own sanitizer would never
 * produce it, because an attacker posts directly and never runs that sanitizer.
 */
import { describe, expect, it } from "vitest"
import { ALLOWED_EVENTS, FORBIDDEN_FIELDS } from "@calllint/telemetry-contract"
import {
  BATCH_SCHEMA,
  MAX_EVENTS_PER_BATCH,
  dayOf,
  isAttention,
  isPreflight,
  validateBatch,
} from "../src/validate.js"

const HASH = "a".repeat(64)
const INSTALL_ID = "cli-anon-12345678-1234-1234-1234-123456789abc"

const event = (over: Record<string, unknown> = {}) => ({
  eventVersion: "1.0.0",
  eventName: "preflight_completed",
  source: "cli",
  timestamp: "2026-08-20T10:00:00Z",
  ...over,
})

const batch = (over: Record<string, unknown> = {}) => ({
  schema: BATCH_SCHEMA,
  batchId: HASH,
  events: [event()],
  ...over,
})

const expectRejected = (body: unknown, code: string) => {
  const result = validateBatch(body)
  expect(result.ok, `expected rejection with code "${code}"`).toBe(false)
  if (!result.ok) expect(result.code).toBe(code)
}

describe("validateBatch — envelope", () => {
  it("accepts a well-formed batch", () => {
    const result = validateBatch(batch())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.batch.batchId).toBe(HASH)
      expect(result.batch.events).toHaveLength(1)
    }
  })

  it.each([
    ["a non-object body", "hello", "invalid_body"],
    ["null", null, "invalid_body"],
    ["an array", [], "invalid_body"],
  ])("rejects %s", (_label, body, code) => expectRejected(body, code))

  it("rejects a wrong or missing schema discriminator", () => {
    expectRejected(batch({ schema: "calllint.telemetry-batch.v1" }), "invalid_schema")
    expectRejected({ batchId: HASH, events: [event()] }, "invalid_schema")
  })

  it.each([
    ["not hex", "z".repeat(64)],
    ["too short", "a".repeat(63)],
    ["too long", "a".repeat(65)],
    ["uppercase", "A".repeat(64)],
    ["a number", 12345],
  ])("rejects a batchId that is %s", (_label, batchId) =>
    expectRejected(batch({ batchId }), "invalid_batch_id"),
  )

  it("rejects a non-array or empty events list", () => {
    expectRejected(batch({ events: "nope" }), "invalid_events")
    expectRejected(batch({ events: [] }), "empty_batch")
  })

  it(`rejects more than ${MAX_EVENTS_PER_BATCH} events but accepts exactly that many`, () => {
    const atCap = validateBatch(batch({ events: Array.from({ length: 100 }, () => event()) }))
    expect(atCap.ok).toBe(true)
    expectRejected(
      batch({ events: Array.from({ length: 101 }, () => event()) }),
      "batch_too_large",
    )
  })
})

describe("validateBatch — closed vocabulary", () => {
  it("accepts every name in the contract's allowlist", () => {
    for (const eventName of ALLOWED_EVENTS) {
      const result = validateBatch(batch({ events: [event({ eventName })] }))
      expect(result.ok, `contract event "${eventName}" must be accepted`).toBe(true)
    }
  })

  it.each([
    ["an invented name", "totally_made_up"],
    ["a near-miss of a real name", "preflight_complete"],
    ["empty", ""],
    ["a non-string", 42],
  ])("rejects %s as eventName", (_label, eventName) =>
    expectRejected(batch({ events: [event({ eventName })] }), "unknown_event_name"),
  )

  it("rejects an off-vocabulary source and result", () => {
    expectRejected(batch({ events: [event({ source: "browser" })] }), "unknown_source")
    expectRejected(batch({ events: [event({ result: "PROBABLY_FINE" })] }), "unknown_result")
    expectRejected(batch({ events: [event({ result: "safe" })] }), "unknown_result")
  })

  it("accepts each valid result and treats an absent result as valid", () => {
    for (const result of ["SAFE", "REVIEW", "BLOCK", "UNKNOWN"]) {
      expect(validateBatch(batch({ events: [event({ result })] })).ok).toBe(true)
    }
    expect(validateBatch(batch({ events: [event()] })).ok).toBe(true)
  })
})

describe("validateBatch — privacy", () => {
  it("rejects the batch outright when ANY forbidden field is present", () => {
    // Presence is fatal, never silently stripped: a stripped leak is an
    // invisible leak, and the client sanitizer takes the same stance.
    for (const field of FORBIDDEN_FIELDS) {
      expectRejected(
        batch({ events: [event({ [field]: "whatever" })] }),
        "forbidden_field",
      )
    }
  })

  it("rejects a forbidden field even when it is null or empty", () => {
    expectRejected(batch({ events: [event({ secret: null })] }), "forbidden_field")
    expectRejected(batch({ events: [event({ command: "" })] }), "forbidden_field")
  })

  it("rejects a forbidden field on a later event, not just the first", () => {
    expectRejected(
      batch({ events: [event(), event(), event({ rawConfig: "{}" })] }),
      "forbidden_field",
    )
  })

  it("drops unknown-but-harmless fields instead of passing them through", () => {
    const result = validateBatch(batch({ events: [event({ someNewField: "x", nested: { a: 1 } })] }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.batch.events[0]).not.toHaveProperty("someNewField")
      expect(result.batch.events[0]).not.toHaveProperty("nested")
    }
  })

  it.each([
    ["a bare uuid without the prefix", "12345678-1234-1234-1234-123456789abc"],
    ["a hardware-looking value", "macbook-pro-serial-C02X1234"],
    ["a wrong prefix", "mcp-anon-12345678-1234-1234-1234-123456789abc"],
    ["uppercase hex", "cli-anon-12345678-1234-1234-1234-123456789ABC"],
    ["a truncated uuid", "cli-anon-12345678-1234-1234-1234-123456789ab"],
  ])("rejects %s as an installation ID", (_label, anonymousInstallationId) =>
    expectRejected(
      batch({ events: [event({ anonymousInstallationId })] }),
      "invalid_installation_id",
    ),
  )

  it("accepts a well-formed installation ID and an absent one", () => {
    expect(validateBatch(batch({ events: [event({ anonymousInstallationId: INSTALL_ID })] })).ok)
      .toBe(true)
    expect(validateBatch(batch({ events: [event({ anonymousInstallationId: "" })] })).ok).toBe(true)
    expect(validateBatch(batch({ events: [event()] })).ok).toBe(true)
  })
})

describe("validateBatch — timestamps and dimensions", () => {
  it("normalizes a timestamp to whole seconds in UTC", () => {
    const result = validateBatch(batch({ events: [event({ timestamp: "2026-08-20T10:00:00.987Z" })] }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.batch.events[0]?.timestamp).toBe("2026-08-20T10:00:00Z")
  })

  it.each([
    ["missing", undefined],
    ["unparseable", "last tuesday"],
    ["empty", ""],
    ["absurdly old", "1970-01-01T00:00:00Z"],
    ["far future", "2999-01-01T00:00:00Z"],
    ["a number", 1760000000],
  ])("rejects a timestamp that is %s", (_label, timestamp) =>
    expectRejected(batch({ events: [event({ timestamp })] }), "invalid_timestamp"),
  )

  it("defaults absent dimensions to empty strings rather than null", () => {
    const result = validateBatch(batch())
    expect(result.ok).toBe(true)
    if (result.ok) {
      const [first] = result.batch.events
      expect(first?.hostFamily).toBe("")
      expect(first?.inputKind).toBe("")
      expect(first?.productVersion).toBe("")
    }
  })

  it.each([
    ["a path", "/Users/alice/project/.cursor/mcp.json"],
    ["whitespace", "claude desktop"],
    ["an overlong value", "x".repeat(65)],
    ["a non-string", { nested: true }],
  ])("rejects %s as a dimension", (_label, hostFamily) =>
    expectRejected(batch({ events: [event({ hostFamily })] }), "invalid_dimension"),
  )

  it("accepts ordinary dimension tokens", () => {
    const result = validateBatch(
      batch({
        events: [event({ hostFamily: "claude-desktop", inputKind: "config", productVersion: "1.8.0" })],
      }),
    )
    expect(result.ok).toBe(true)
  })
})

describe("classification helpers", () => {
  it("derives the UTC day bucket from a timestamp", () => {
    expect(dayOf("2026-08-20T23:59:59Z")).toBe("2026-08-20")
  })

  it("counts REVIEW, BLOCK and UNKNOWN as needing attention — and SAFE as not", () => {
    // new18 §23: "need attention" is REVIEW + BLOCK + UNKNOWN. UNKNOWN counts
    // because UNKNOWN is not SAFE.
    for (const result of ["REVIEW", "BLOCK", "UNKNOWN"]) {
      expect(isAttention({ ...event({ result }) } as never)).toBe(true)
    }
    expect(isAttention({ ...event({ result: "SAFE" }) } as never)).toBe(false)
    expect(isAttention({ ...event() } as never)).toBe(false)
  })

  it("identifies a preflight event", () => {
    expect(isPreflight({ ...event() } as never)).toBe(true)
    expect(isPreflight({ ...event({ eventName: "badge_rendered" }) } as never)).toBe(false)
  })
})
