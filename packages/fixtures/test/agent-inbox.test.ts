import { readFileSync, readdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * R5 / v0.10.0 — Agent Inbox fixture validation.
 *
 * These tests enforce the adapter contract (docs/AGENT_INBOX_ADAPTER_CONTRACT.md)
 * structurally: every `*.normalized.json` fixture must conform to the
 * `calllint.agent-inbox-event.v0` schema invariants, and must never leak
 * secrets (header VALUES, full bodies, attachment bytes).
 *
 * This is a design-phase test: it validates fixtures against the schema's
 * structural rules directly (no ajv dependency), matching the zero-runtime,
 * zero-new-dependency posture of the R5 spec release.
 */

const here = dirname(fileURLToPath(import.meta.url))
const INBOX_DIR = join(here, "..", "agent-inbox")

const VALID_EVENT_TYPES = new Set([
  "email.received",
  "message.posted",
  "mention.detected",
  "direct_message.received",
  "thread.replied",
])

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const SHA256 = /^sha256:[0-9a-f]{64}$/

/** Recursively collect every *.normalized.json path under agent-inbox/. */
function normalizedFixtures(): string[] {
  const out: string[] = []
  for (const provider of readdirSync(INBOX_DIR, { withFileTypes: true })) {
    if (!provider.isDirectory()) continue
    const providerDir = join(INBOX_DIR, provider.name)
    for (const file of readdirSync(providerDir)) {
      if (file.endsWith(".normalized.json")) {
        out.push(join(providerDir, file))
      }
    }
  }
  return out
}

describe("agent-inbox normalized fixtures (R5 design)", () => {
  const fixtures = normalizedFixtures()

  it("finds all six seeded provider patterns", () => {
    // resend, sendgrid, gmail-api, slack, discord, smtp-imap
    expect(fixtures.length).toBeGreaterThanOrEqual(6)
  })

  it("every normalized fixture is valid JSON", () => {
    for (const f of fixtures) {
      expect(() => JSON.parse(readFileSync(f, "utf8")), f).not.toThrow()
    }
  })

  it("every normalized fixture conforms to calllint.agent-inbox-event.v0 invariants", () => {
    for (const f of fixtures) {
      const ev = JSON.parse(readFileSync(f, "utf8"))

      // Required top-level fields
      expect(ev.schema_version, `${f}: schema_version`).toBe(
        "calllint.agent-inbox-event.v0",
      )
      expect(VALID_EVENT_TYPES.has(ev.event_type), `${f}: event_type=${ev.event_type}`).toBe(true)
      expect(ISO_8601.test(ev.timestamp), `${f}: timestamp=${ev.timestamp}`).toBe(true)
      expect(ev.source, `${f}: source`).toBeTypeOf("object")
      expect(ev.source.provider, `${f}: source.provider`).toBeTypeOf("string")
      expect(ev.normalized_content, `${f}: normalized_content`).toBeTypeOf("object")
      expect(ev.normalized_content.from, `${f}: normalized_content.from`).toBeTypeOf("string")

      // When attachments present, hashes must be present + well-formed
      if (ev.normalized_content.has_attachments === true) {
        const hashes = ev.normalized_content.attachment_hashes
        expect(Array.isArray(hashes), `${f}: attachment_hashes is array`).toBe(true)
        expect(hashes.length, `${f}: attachment_hashes non-empty`).toBeGreaterThan(0)
        for (const h of hashes) {
          expect(SHA256.test(h), `${f}: hash format ${h}`).toBe(true)
        }
      }
    }
  })

  it("every normalized fixture has a matching raw fixture (adapter pair)", () => {
    for (const f of fixtures) {
      const raw = f.replace(".normalized.json", ".raw.json")
      expect(existsSync(raw), `${f}: missing raw pair ${raw}`).toBe(true)
    }
  })

  it("normalized fixtures leak no secrets (header keys only, no values)", () => {
    // The normalized schema exposes header_keys (an array of NAMES). It must
    // never carry a header value map, a body string, or a bearer token.
    const SECRET_SHAPED = /Bearer\s|Authorization["']?\s*:\s*["'][^"']+["']|sk-[A-Za-z0-9]/
    for (const f of fixtures) {
      const text = readFileSync(f, "utf8")
      const ev = JSON.parse(text)

      // header_keys must be an array of strings (names), not an object of values
      const hk = ev.normalized_content.header_keys
      if (hk !== undefined) {
        expect(Array.isArray(hk), `${f}: header_keys is array of names`).toBe(true)
        for (const k of hk) expect(k, `${f}: header key is string`).toBeTypeOf("string")
      }

      // No full body string field (only body_length)
      expect(ev.normalized_content.body, `${f}: must not carry full body`).toBeUndefined()

      // No secret-shaped substrings anywhere in the normalized doc
      expect(SECRET_SHAPED.test(text), `${f}: secret-shaped content`).toBe(false)
    }
  })
})
