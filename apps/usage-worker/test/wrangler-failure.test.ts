/**
 * Wrangler failure-description tests (new18 §25, §28).
 *
 * The property under test is that a degraded report says *why* it degraded. The
 * regression these guard is real and was observed: before this module existed the
 * generator printed execFileSync's own message, so a Cloudflare authentication
 * failure and a missing table both read as
 *
 *   ! D1 unavailable: Command failed: C:\...\wrangler.js d1 execute ... SELECT ...
 *
 * which names no cause and echoes the interpolated SQL into a CI log. The
 * authentication case here is the exact envelope wrangler 4.86.0 produced.
 */
import { describe, expect, it } from "vitest"
import {
  MAX_CAUSE_LENGTH,
  describeWranglerFailure,
  type WranglerFailure,
} from "../src/wrangler-failure.js"

/** The real envelope, as observed from wrangler 4.86.0 with no credentials. */
const authFailureStdout = JSON.stringify({
  error: {
    text: "A request to the Cloudflare API (/memberships) failed.",
    notes: [{ text: "Authentication failed (status: 400) [code: 9106]" }],
  },
})

const failure = (over: Partial<WranglerFailure> = {}): WranglerFailure => ({
  message: "Command failed: node wrangler.js d1 execute calllint-usage --command SELECT 1",
  status: 1,
  signal: null,
  ...over,
})

describe("describeWranglerFailure — the JSON envelope", () => {
  it("names the Cloudflare reason rather than the failed command", () => {
    const described = describeWranglerFailure(failure({ stdout: authFailureStdout }))
    expect(described).toContain("Authentication failed")
    expect(described).toContain("9106")
    // The regression: execFileSync's wrapper must not be what an operator reads.
    expect(described).not.toContain("Command failed")
  })

  it("never echoes the SQL or the argv", () => {
    // The command line carries an interpolated SQL string. It is not a secret,
    // but it is noise that pushed the actual cause out of the message entirely.
    const described = describeWranglerFailure(failure({ stdout: authFailureStdout }))
    expect(described).not.toContain("SELECT")
    expect(described).not.toContain("wrangler.js")
  })

  it("joins the generic wrapper with the specific note", () => {
    const described = describeWranglerFailure(failure({ stdout: authFailureStdout }))
    expect(described).toBe(
      "A request to the Cloudflare API (/memberships) failed. — Authentication failed (status: 400) [code: 9106]",
    )
  })

  it("distinguishes a missing table from a credentials failure", () => {
    // These two must never read alike: one is fixed by setting a secret, the
    // other by running a migration.
    const described = describeWranglerFailure(
      failure({
        stdout: JSON.stringify({
          error: { text: "no such table: usage_daily_counts" },
        }),
      }),
    )
    expect(described).toBe("no such table: usage_daily_counts")
    expect(described).not.toContain("Authentication")
  })

  it("accepts plain-string and bare-message envelopes", () => {
    expect(describeWranglerFailure(failure({ stdout: '{"error":"D1_ERROR: bad SQL"}' }))).toBe(
      "D1_ERROR: bad SQL",
    )
    expect(
      describeWranglerFailure(failure({ stdout: '{"message":"database not found"}' })),
    ).toBe("database not found")
  })

  it("reads an envelope preceded by ordinary log lines", () => {
    // wrangler prints its banner before the JSON; the object does not start at
    // byte zero, which is why the parser seeks the first brace.
    const described = describeWranglerFailure(
      failure({ stdout: `⛅️ wrangler 4.86.0\n---\n${authFailureStdout}` }),
    )
    expect(described).toContain("Authentication failed")
  })

  it("reads the envelope from stderr when stdout is empty", () => {
    const described = describeWranglerFailure(
      failure({ stdout: "", stderr: authFailureStdout }),
    )
    expect(described).toContain("Authentication failed")
  })
})

describe("describeWranglerFailure — fallbacks", () => {
  it("falls back to the first meaningful stderr line for non-JSON output", () => {
    expect(
      describeWranglerFailure(
        failure({ stderr: "\n  \n ✘ [ERROR] Not logged in.\n  more detail\n" }),
      ),
    ).toBe("✘ [ERROR] Not logged in.")
  })

  it("falls back to the line scan when the JSON is truncated", () => {
    // A parse failure must describe wrangler's problem, not ours.
    const described = describeWranglerFailure(
      failure({ stdout: '{"error": {"text": "half a mess', stderr: "✘ connection reset" }),
    )
    expect(described).toBe("✘ connection reset")
  })

  it("names the timeout when the process was killed", () => {
    const described = describeWranglerFailure(
      failure({ stdout: "", stderr: "", signal: "SIGTERM", status: null }),
    )
    expect(described).toContain("SIGTERM")
    expect(described).toContain("timeout")
  })

  it("reports the exit status when nothing was written to either stream", () => {
    expect(
      describeWranglerFailure(failure({ stdout: "", stderr: "", status: 127 })),
    ).toBe("wrangler exited 127 with no diagnostic output")
  })

  it("never returns an empty string, even for a shapeless error", () => {
    for (const input of [null, undefined, {} as WranglerFailure]) {
      expect(describeWranglerFailure(input).length).toBeGreaterThan(0)
    }
  })
})

describe("describeWranglerFailure — log hygiene", () => {
  it("masks a token-shaped run", () => {
    // wrangler does not echo secret values today; this is defence against a
    // version that does, since this line lands in a CI log.
    const token = "A".repeat(40)
    const described = describeWranglerFailure(
      failure({ stdout: JSON.stringify({ error: { text: `bad token ${token}` } }) }),
    )
    expect(described).not.toContain(token)
    expect(described).toContain("[redacted]")
  })

  it("keeps a short hex-ish identifier that is not token-shaped", () => {
    // Over-masking would hide the D1 database id, which is useful and public.
    const described = describeWranglerFailure(
      failure({ stdout: JSON.stringify({ error: { text: "database 98626b00 not found" } }) }),
    )
    expect(described).toContain("98626b00")
  })

  it("collapses newlines so the cause stays one line", () => {
    const described = describeWranglerFailure(
      failure({ stdout: JSON.stringify({ error: { text: "line one\nline two" } }) }),
    )
    expect(described).not.toContain("\n")
    expect(described).toBe("line one line two")
  })

  it("truncates a runaway cause", () => {
    const described = describeWranglerFailure(
      failure({ stdout: JSON.stringify({ error: { text: "x ".repeat(500) } }) }),
    )
    expect(described.length).toBeLessThanOrEqual(MAX_CAUSE_LENGTH)
  })
})
