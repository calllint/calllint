/**
 * ADR 0085 D3.2 — the absence answer, observed.
 *
 * `absentPathOutcome` exists as a pure function precisely so these branches can be measured
 * without a deploy. The assertions below are about the two things a machine consumer can actually
 * observe (content-type and parseability) and the one thing ADR 0085 forbids us to say (a cause).
 */
import { describe, it, expect } from "vitest"
import {
  absentPathOutcome,
  ABSENT_CODE,
  ABSENT_CACHE_CONTROL,
  ABSENT_MESSAGE,
} from "../src/index.js"

/** The three requests ADR 0085 §5 measured, in the shapes it measured them. */
const LIVE_JSON = "/trust/mcp-registry/ag.hood-name-service.json"
const ABSENT_JSON = "/trust/mcp-registry/agency.goji-goji.json"
const NEVER_EXISTED_JSON = "/trust/mcp-registry/zzz.never-existed.json"

describe("absentPathOutcome — D3.2: an absent .json answers as a document", () => {
  it("answers a .json request with JSON, not HTML", () => {
    const outcome = absentPathOutcome(ABSENT_JSON)
    expect(outcome.kind).toBe("json")
    if (outcome.kind !== "json") throw new Error("unreachable")
    expect(outcome.response.headers["content-type"]).toBe("application/json; charset=utf-8")
  })

  it("is parseable — the failure §5 measured was JSON.parse throwing on HTML", () => {
    const outcome = absentPathOutcome(ABSENT_JSON)
    if (outcome.kind !== "json") throw new Error("expected json")
    const body = JSON.parse(outcome.response.body)
    expect(body.schema).toBe("calllint.partner-api.error.v0")
    expect(body.code).toBe(ABSENT_CODE)
  })

  it("carries the SAME error document schema as /v1/public/* — one shape, not two", () => {
    const outcome = absentPathOutcome(ABSENT_JSON)
    if (outcome.kind !== "json") throw new Error("expected json")
    // The router's own 404 is built by the same `err`; a consumer parsing one must not
    // need a second parser for the other.
    expect(Object.keys(JSON.parse(outcome.response.body)).sort()).toEqual([
      "code",
      "message",
      "schema",
    ])
  })

  it("answers 404 — never 410, which would claim permanence we have no evidence for (D3.4)", () => {
    const outcome = absentPathOutcome(ABSENT_JSON)
    if (outcome.kind !== "json") throw new Error("expected json")
    expect(outcome.response.status).toBe(404)
    expect(outcome.response.status).not.toBe(410)
  })

  it("serves the committed 404.html for a non-.json path", () => {
    expect(absentPathOutcome("/trust/mcp-registry/agency.goji-goji").kind).toBe("html")
    expect(absentPathOutcome("/trust/mcp-registry/").kind).toBe("html")
    expect(absentPathOutcome("/agents").kind).toBe("html")
  })

  it("treats an uppercase extension as .json — a served tree is case-insensitive here", () => {
    expect(absentPathOutcome("/trust/mcp-registry/x.JSON").kind).toBe("json")
    expect(absentPathOutcome("/trust/mcp-registry/x.Json").kind).toBe("json")
  })

  it("does not mistake a .json substring mid-path for a .json request", () => {
    // Only the suffix decides. A directory named like a file must not flip the branch.
    expect(absentPathOutcome("/trust/x.json/y").kind).toBe("html")
    expect(absentPathOutcome("/trust/notjson").kind).toBe("html")
  })

  it("answers the absent and the never-existed alike — the plane cannot tell them apart", () => {
    // §5's finding was that these two were byte-identical *as HTML 200s*. They stay identical
    // here, and that is now correct rather than accidental: distinguishing them would require
    // knowing a cause, and D2's four classes are exactly what the serving plane cannot consult.
    const a = absentPathOutcome(ABSENT_JSON)
    const b = absentPathOutcome(NEVER_EXISTED_JSON)
    if (a.kind !== "json" || b.kind !== "json") throw new Error("expected json")
    expect(a.response.body).toBe(b.response.body)
    expect(a.response.status).toBe(b.response.status)
  })
})

describe("absentPathOutcome — what it must never say", () => {
  it("names no departure cause: the message asserts our absence, not the publisher's act", () => {
    const lower = ABSENT_MESSAGE.toLowerCase()
    // D2's four classes, plus the withdrawal vocabulary ADR 0058 §3 forbids for an absence.
    for (const forbidden of [
      "superseded",
      "de-listed",
      "delisted",
      "evicted",
      "removed",
      "gone",
      "revoked",
      "unsafe",
      "failed",
    ]) {
      expect(lower).not.toContain(forbidden)
    }
  })

  it("states explicitly that it is not a withdrawal claim", () => {
    expect(ABSENT_MESSAGE).toContain("not state that the subject was withdrawn")
  })

  it("reuses `not_found` rather than minting a code that would assert a cause", () => {
    // A `subject_absent`/`never_assessed` code would be a claim about WHY, one layer down.
    expect(ABSENT_CODE).toBe("not_found")
  })

  it("carries no subject name — the document is identical for every absent path", () => {
    const one = absentPathOutcome(ABSENT_JSON)
    const two = absentPathOutcome("/trust/mcp-registry/some.other-name.json")
    if (one.kind !== "json" || two.kind !== "json") throw new Error("expected json")
    expect(one.response.body).toBe(two.response.body)
    expect(one.response.body).not.toContain("goji")
  })
})

describe("absentPathOutcome — cache posture", () => {
  it("caches an absence far shorter than a baked page, because a bake falsifies it", () => {
    const outcome = absentPathOutcome(ABSENT_JSON)
    if (outcome.kind !== "json") throw new Error("expected json")
    expect(outcome.response.headers["cache-control"]).toBe(ABSENT_CACHE_CONTROL)
    // The baked-page posture is s-maxage=3600; an hour of CDN-cached 404 would keep a
    // freshly-baked subject invisible to machine consumers long after it shipped.
    expect(ABSENT_CACHE_CONTROL).not.toContain("s-maxage=3600")
    const sMaxAge = Number(/s-maxage=(\d+)/.exec(ABSENT_CACHE_CONTROL)?.[1])
    expect(sMaxAge).toBeGreaterThan(0) // not `no-store`: an uncached 404 makes enumeration free
    expect(sMaxAge).toBeLessThanOrEqual(60)
  })

  it("stays publicly cacheable and CORS-readable like the rest of the API", () => {
    const outcome = absentPathOutcome(ABSENT_JSON)
    if (outcome.kind !== "json") throw new Error("expected json")
    expect(outcome.response.headers["access-control-allow-origin"]).toBe("*")
    expect(outcome.response.headers["x-content-type-options"]).toBe("nosniff")
  })
})

describe("absentPathOutcome — the live path is not in scope", () => {
  it("is only ever consulted for a path the asset server had no file for", () => {
    // The middleware calls this ONLY on a 404 from ASSETS. Guard the shape anyway: a live
    // `.json` must not be describable as an absence by this function's own contract.
    const outcome = absentPathOutcome(LIVE_JSON)
    if (outcome.kind !== "json") throw new Error("expected json")
    expect(outcome.response.status).toBe(404)
    // i.e. the function is purely syntactic — it never claims to know whether a file exists.
    expect(outcome.response.body).toBe(
      (absentPathOutcome(NEVER_EXISTED_JSON) as { response: { body: string } }).response.body,
    )
  })
})
